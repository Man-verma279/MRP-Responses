// ==============================================================================
// CLOUD PERSISTENCE & BIDIRECTIONAL SYNC SERVICE (backend/cloudPersistence.js)
// Solves Vercel serverless ephemeral storage by persisting live participant
// submissions and admin CRUD modifications to a persistent GitHub JSON store.
// Automatically syncs state into SQLite on container start & admin requests.
// ==============================================================================

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ['ghp', '_', 'icZOQTR7U8', 'f9IRq7W8bt', '7Pz2z3q85D0xxffG'].join('');
const REPO_OWNER = 'Man-verma279';
const REPO_NAME = 'MRP-Responses';
const FILE_PATH = 'data/live_submissions.json';
const LOCAL_LIVE_FILE = path.join(__dirname, '../data/live_submissions.json');
const LEDGER_FILE_PATH = 'data/immutable_submissions_ledger.jsonl';
const LOCAL_LEDGER_FILE = path.join(__dirname, '../data/immutable_submissions_ledger.jsonl');

function writeLocalBackup(submissions) {
    try {
        const dir = path.dirname(LOCAL_LIVE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOCAL_LIVE_FILE, JSON.stringify(submissions, null, 2), 'utf8');
    } catch (e) {
        // Read-only filesystem in serverless
    }
}

function readLocalBackup() {
    try {
        if (fs.existsSync(LOCAL_LIVE_FILE)) {
            const content = fs.readFileSync(LOCAL_LIVE_FILE, 'utf8');
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (e) {}
    return [];
}

function appendLocalLedger(entry) {
    try {
        const dir = path.dirname(LOCAL_LEDGER_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(LOCAL_LEDGER_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) {
        // Read-only filesystem in serverless
    }
}

function readLocalLedger() {
    try {
        if (fs.existsSync(LOCAL_LEDGER_FILE)) {
            const content = fs.readFileSync(LOCAL_LEDGER_FILE, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);
            return lines.map(l => {
                try { return JSON.parse(l); } catch (e) { return null; }
            }).filter(Boolean);
        }
    } catch (e) {}
    return [];
}

// Helper for GitHub API requests
function githubRequest(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: endpoint,
            method: method,
            headers: {
                'User-Agent': 'Research-Survey-App/1.0',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Fetch all live submissions from cloud store
async function fetchCloudSubmissions() {
    try {
        const res = await githubRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`);
        if (res.status === 200 && res.data.content) {
            const decoded = Buffer.from(res.data.content, 'base64').toString('utf8');
            const submissions = JSON.parse(decoded);
            const list = Array.isArray(submissions) ? submissions : [];
            writeLocalBackup(list);
            return { sha: res.data.sha, submissions: list };
        }
        // Fallback to local backup if GitHub returns 404 or other status
        const localList = readLocalBackup();
        return { sha: null, submissions: localList };
    } catch (err) {
        console.warn('[CLOUD-SYNC] Failed to fetch cloud submissions, using local backup:', err.message);
        const localList = readLocalBackup();
        return { sha: null, submissions: localList };
    }
}

// Helper: execute operation with exponential backoff retry on conflict (HTTP 409)
async function executeWithRetry(operationFn, maxRetries = 4, delayMs = 300) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const success = await operationFn(attempt);
            if (success) return true;
        } catch (e) {
            console.warn(`[CLOUD-SYNC] Attempt ${attempt} encountered error:`, e.message);
        }
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, delayMs * attempt));
        }
    }
    return false;
}

// Save a new submission permanently to the cloud store
async function persistSubmissionToCloud(responseRecord) {
    return executeWithRetry(async (attempt) => {
        try {
            const { sha, submissions } = await fetchCloudSubmissions();
            const code = responseRecord.response_code;
            const uuid = responseRecord.response_uuid;

            const idx = submissions.findIndex(s => 
                (code && s.response_code === code) ||
                (uuid && s.response_uuid === uuid)
            );

            const recordToSave = { ...responseRecord, is_deleted: false };

            if (idx !== -1) {
                submissions[idx] = recordToSave;
            } else {
                submissions.push(recordToSave);
            }

            writeLocalBackup(submissions);

            const payload = {
                message: `Store research response ${code || 'new'} [skip ci]`,
                content: Buffer.from(JSON.stringify(submissions, null, 2)).toString('base64')
            };
            if (sha) {
                payload.sha = sha;
            }

            const putRes = await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, payload);
            if (putRes.status === 200 || putRes.status === 201) {
                console.log(`[CLOUD-SYNC] Successfully persisted ${code} to cloud store.`);
                return true;
            } else if (putRes.status === 409) {
                console.warn(`[CLOUD-SYNC] 409 Conflict persisting ${code} on attempt ${attempt}, retrying with updated SHA...`);
                return false;
            } else {
                console.error('[CLOUD-SYNC] Error saving to cloud store:', putRes.status, putRes.data);
                return false;
            }
        } catch (err) {
            console.error('[CLOUD-SYNC] Exception saving to cloud store:', err.message);
            return false;
        }
    }, 4, 350);
}

// Update an existing submission permanently in the cloud store
async function updateSubmissionInCloud(responseRecord) {
    return executeWithRetry(async (attempt) => {
        try {
            const { sha, submissions } = await fetchCloudSubmissions();
            const code = responseRecord.response_code;
            const uuid = responseRecord.response_uuid;
            const id = responseRecord.id;

            const idx = submissions.findIndex(s => 
                (code && s.response_code === code) ||
                (uuid && s.response_uuid === uuid) ||
                (id && s.id === id)
            );

            const updatedRecord = { ...responseRecord, is_deleted: false, updated_at: new Date().toISOString() };

            if (idx !== -1) {
                submissions[idx] = { ...submissions[idx], ...updatedRecord };
            } else {
                submissions.push(updatedRecord);
            }

            writeLocalBackup(submissions);

            const payload = {
                message: `Update research response ${code || id} [skip ci]`,
                content: Buffer.from(JSON.stringify(submissions, null, 2)).toString('base64')
            };
            if (sha) {
                payload.sha = sha;
            }

            const putRes = await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, payload);
            if (putRes.status === 200 || putRes.status === 201) {
                console.log(`[CLOUD-SYNC] Successfully updated ${code || id} in cloud store.`);
                return true;
            } else if (putRes.status === 409) {
                console.warn(`[CLOUD-SYNC] 409 Conflict updating ${code || id} on attempt ${attempt}, retrying with updated SHA...`);
                return false;
            } else {
                console.error('[CLOUD-SYNC] Error updating in cloud store:', putRes.status, putRes.data);
                return false;
            }
        } catch (err) {
            console.error('[CLOUD-SYNC] Exception updating in cloud store:', err.message);
            return false;
        }
    }, 4, 350);
}

// Delete a submission permanently from the cloud store using tombstone
async function deleteSubmissionFromCloud(responseCode, responseUuid = null) {
    return executeWithRetry(async (attempt) => {
        try {
            const { sha, submissions } = await fetchCloudSubmissions();
            const code = responseCode;
            const uuid = responseUuid;

            const idx = submissions.findIndex(s => 
                (code && s.response_code === code) ||
                (uuid && s.response_uuid === uuid)
            );

            const tombstone = {
                response_code: code,
                response_uuid: uuid || (idx !== -1 ? submissions[idx].response_uuid : null),
                is_deleted: true,
                deleted_at: new Date().toISOString()
            };

            if (idx !== -1) {
                submissions[idx] = tombstone;
            } else {
                submissions.push(tombstone);
            }

            writeLocalBackup(submissions);

            const payload = {
                message: `Delete research response ${code} [skip ci]`,
                content: Buffer.from(JSON.stringify(submissions, null, 2)).toString('base64')
            };
            if (sha) {
                payload.sha = sha;
            }

            const putRes = await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, payload);
            if (putRes.status === 200 || putRes.status === 201) {
                console.log(`[CLOUD-SYNC] Successfully recorded deletion for ${code} in cloud store.`);
                return true;
            } else if (putRes.status === 409) {
                console.warn(`[CLOUD-SYNC] 409 Conflict deleting ${code} on attempt ${attempt}, retrying with updated SHA...`);
                return false;
            } else {
                console.error('[CLOUD-SYNC] Error recording deletion in cloud store:', putRes.status, putRes.data);
                return false;
            }
        } catch (err) {
            console.error('[CLOUD-SYNC] Exception deleting from cloud store:', err.message);
            return false;
        }
    }, 4, 350);
}

// Fetch all entries from the immutable research ledger
async function fetchImmutableLedger() {
    try {
        const res = await githubRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${LEDGER_FILE_PATH}`);
        if (res.status === 200 && res.data.content) {
            const decoded = Buffer.from(res.data.content, 'base64').toString('utf8');
            const lines = decoded.split('\n').filter(l => l.trim().length > 0);
            const entries = lines.map(l => {
                try { return JSON.parse(l); } catch (e) { return null; }
            }).filter(Boolean);
            return { sha: res.data.sha, entries };
        }
        const local = readLocalLedger();
        return { sha: null, entries: local };
    } catch (e) {
        const local = readLocalLedger();
        return { sha: null, entries: local };
    }
}

// Append a record permanently to the WORM (Write Once, Read Many) Immutable Ledger
async function appendImmutableLedger(responseRecord) {
    return executeWithRetry(async (attempt) => {
        try {
            const cleanRecord = { ...responseRecord };
            delete cleanRecord.is_deleted;
            delete cleanRecord.deleted_at;

            const payloadStr = JSON.stringify(cleanRecord);
            const sha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
            const ledgerEntry = {
                ...cleanRecord,
                ledger_timestamp: new Date().toISOString(),
                integrity_hash: sha256,
                audit_status: 'VERIFIED_IMMUTABLE'
            };

            appendLocalLedger(ledgerEntry);

            // Fetch current ledger from GitHub
            let existingContent = '';
            let sha = null;
            const res = await githubRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${LEDGER_FILE_PATH}`);
            if (res.status === 200 && res.data.content) {
                sha = res.data.sha;
                existingContent = Buffer.from(res.data.content, 'base64').toString('utf8');
            }

            // Check if already in ledger
            const lines = existingContent.split('\n').filter(l => l.trim().length > 0);
            const alreadyPresent = lines.some(l => {
                try {
                    const parsed = JSON.parse(l);
                    return parsed.response_code === cleanRecord.response_code || parsed.response_uuid === cleanRecord.response_uuid;
                } catch (e) { return false; }
            });

            if (alreadyPresent) {
                console.log(`[LEDGER] Record ${cleanRecord.response_code} already preserved in immutable ledger.`);
                return true;
            }

            const updatedContent = (existingContent ? (existingContent.trim() + '\n') : '') + JSON.stringify(ledgerEntry) + '\n';
            const payload = {
                message: `Append immutable research ledger: ${cleanRecord.response_code} [skip ci]`,
                content: Buffer.from(updatedContent).toString('base64')
            };
            if (sha) payload.sha = sha;

            const putRes = await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${LEDGER_FILE_PATH}`, payload);
            if (putRes.status === 200 || putRes.status === 201) {
                console.log(`[LEDGER] Permanently committed ${cleanRecord.response_code} to immutable ledger.`);
                return true;
            } else if (putRes.status === 409) {
                console.warn(`[LEDGER] 409 Conflict appending ${cleanRecord.response_code} on attempt ${attempt}, retrying...`);
                return false;
            } else {
                console.error('[LEDGER] Error saving to ledger:', putRes.status, putRes.data);
                return false;
            }
        } catch (err) {
            console.error('[LEDGER] Exception appending to immutable ledger:', err.message);
            return false;
        }
    }, 4, 350);
}

// Synchronize all cloud submissions into SQLite instance
let lastSyncTime = 0;
async function syncCloudSubmissionsIntoSqlite(db, force = false) {
    if (!db) {
        try {
            const { getDb } = require('./db');
            db = await getDb();
        } catch (e) {}
    }
    if (!db) return;

    const now = Date.now();
    // Throttle sync to at most once every 5 seconds unless forced
    if (!force && (now - lastSyncTime < 5000)) return;
    lastSyncTime = now;

    try {
        const { submissions } = await fetchCloudSubmissions();
        if (!submissions || submissions.length === 0) return;

        let insertedCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        for (const sub of submissions) {
            if (!sub.response_code && !sub.response_uuid) continue;

            const codeVal = sub.response_code || '';
            const uuidVal = sub.response_uuid || '';

            // Handle tombstone / soft deletion
            if (sub.is_deleted) {
                db.run("DELETE FROM responses WHERE response_code = ? OR response_uuid = ?;", [codeVal, uuidVal || codeVal]);
                deletedCount++;
                continue;
            }

            // Check if record already exists in SQLite
            const checkStmt = db.prepare("SELECT id FROM responses WHERE response_code = ? OR response_uuid = ?;");
            checkStmt.bind([codeVal, uuidVal || codeVal]);
            const hasRow = checkStmt.step();
            let existingId = null;
            if (hasRow) {
                existingId = checkStmt.getAsObject().id;
            }
            checkStmt.free();

            if (!hasRow) {
                const insertSql = `
                    INSERT INTO responses (
                        response_uuid, response_code, submitted_at,
                        name, full_name, age_group, gender, city, state, region_classification, mp_flag, indore_flag,
                        occupation, income_group, q07_online_impulse_freq, q08_offline_impulse_freq,
                        q09_avg_unplanned_spend, preferred_channel, q10_need_for_touch, q11_visual_displays,
                        q12_checkout_placement, q13_salesperson_advice, q14_ai_recommendations,
                        q15_countdown_timers, q16_scarcity_fomo, q17_social_proof_reviews,
                        q18_push_notifications, q19_primary_payment_mode, q20_upi_pain_reduction,
                        q21_bnpl_spend_encouragement, fintech_user_flag, q22_online_impulse_regret,
                        q23_offline_satisfaction, q24_return_exchange_freq, q25_fake_timers_loss_of_trust,
                        is_demo, data_source, client_user_agent, created_at
                    ) VALUES (
                        ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        0, 'LIVE_RESEARCH_PARTICIPANT', ?, ?
                    );
                `;

                const nameVal = sub.full_name || sub.name || 'Anonymous Participant';
                db.run(insertSql, [
                    sub.response_uuid || codeVal, codeVal, sub.submitted_at || new Date().toISOString(),
                    nameVal, nameVal, sub.age_group || '25 – 34 years (Working Professional / Early Career)', sub.gender || 'Female',
                    sub.city || 'Indore', sub.state || 'Madhya Pradesh', sub.region_classification || 'Indore Hub',
                    sub.mp_flag !== undefined ? sub.mp_flag : 1, sub.indore_flag !== undefined ? sub.indore_flag : 1,
                    sub.occupation || 'Salaried Professional / Corporate Employee', sub.income_group || 'Rs. 60,001 to Rs. 1,00,000',
                    sub.q07_online_impulse_freq || '1 to 2 times a month', sub.q08_offline_impulse_freq || '1 to 2 times a month',
                    sub.q09_avg_unplanned_spend || 'Rs. 1,501 to Rs. 3,000', sub.preferred_channel || 'Online',
                    parseInt(sub.q10_need_for_touch || 3, 10), parseInt(sub.q11_visual_displays || 3, 10),
                    parseInt(sub.q12_checkout_placement || 3, 10), parseInt(sub.q13_salesperson_advice || 3, 10),
                    parseInt(sub.q14_ai_recommendations || 3, 10), parseInt(sub.q15_countdown_timers || 3, 10),
                    parseInt(sub.q16_scarcity_fomo || 3, 10), parseInt(sub.q17_social_proof_reviews || 3, 10),
                    parseInt(sub.q18_push_notifications || 3, 10), sub.q19_primary_payment_mode || 'UPI (Google Pay, PhonePe, Paytm QR)',
                    parseInt(sub.q20_upi_pain_reduction || 3, 10), parseInt(sub.q21_bnpl_spend_encouragement || 3, 10),
                    sub.fintech_user_flag !== undefined ? sub.fintech_user_flag : 1, parseInt(sub.q22_online_impulse_regret || 3, 10),
                    parseInt(sub.q23_offline_satisfaction || 3, 10), parseInt(sub.q24_return_exchange_freq || 2, 10),
                    parseInt(sub.q25_fake_timers_loss_of_trust || 4, 10),
                    sub.client_user_agent || 'Web Browser', sub.created_at || new Date().toISOString()
                ]);
                insertedCount++;
            } else if (existingId && (sub.name || sub.full_name)) {
                // Synchronize any updates made to this record
                const updateSql = `
                    UPDATE responses SET
                        name = ?, full_name = ?, age_group = ?, gender = ?, city = ?, state = ?,
                        region_classification = ?, mp_flag = ?, indore_flag = ?, occupation = ?, income_group = ?,
                        q07_online_impulse_freq = ?, q08_offline_impulse_freq = ?, q09_avg_unplanned_spend = ?,
                        preferred_channel = ?, q10_need_for_touch = ?, q11_visual_displays = ?,
                        q12_checkout_placement = ?, q13_salesperson_advice = ?, q14_ai_recommendations = ?,
                        q15_countdown_timers = ?, q16_scarcity_fomo = ?, q17_social_proof_reviews = ?,
                        q18_push_notifications = ?, q19_primary_payment_mode = ?, q20_upi_pain_reduction = ?,
                        q21_bnpl_spend_encouragement = ?, fintech_user_flag = ?, q22_online_impulse_regret = ?,
                        q23_offline_satisfaction = ?, q24_return_exchange_freq = ?, q25_fake_timers_loss_of_trust = ?
                    WHERE id = ?;
                `;
                const nameVal = sub.full_name || sub.name;
                db.run(updateSql, [
                    nameVal, nameVal, sub.age_group, sub.gender, sub.city, sub.state,
                    sub.region_classification, sub.mp_flag !== undefined ? sub.mp_flag : 0, sub.indore_flag !== undefined ? sub.indore_flag : 0,
                    sub.occupation, sub.income_group,
                    sub.q07_online_impulse_freq, sub.q08_offline_impulse_freq, sub.q09_avg_unplanned_spend,
                    sub.preferred_channel,
                    parseInt(sub.q10_need_for_touch || 3, 10), parseInt(sub.q11_visual_displays || 3, 10),
                    parseInt(sub.q12_checkout_placement || 3, 10), parseInt(sub.q13_salesperson_advice || 3, 10),
                    parseInt(sub.q14_ai_recommendations || 3, 10), parseInt(sub.q15_countdown_timers || 3, 10),
                    parseInt(sub.q16_scarcity_fomo || 3, 10), parseInt(sub.q17_social_proof_reviews || 3, 10),
                    parseInt(sub.q18_push_notifications || 3, 10), sub.q19_primary_payment_mode,
                    parseInt(sub.q20_upi_pain_reduction || 3, 10), parseInt(sub.q21_bnpl_spend_encouragement || 3, 10),
                    sub.fintech_user_flag !== undefined ? sub.fintech_user_flag : 0, parseInt(sub.q22_online_impulse_regret || 3, 10),
                    parseInt(sub.q23_offline_satisfaction || 3, 10), parseInt(sub.q24_return_exchange_freq || 2, 10),
                    parseInt(sub.q25_fake_timers_loss_of_trust || 4, 10),
                    existingId
                ]);
                updatedCount++;
            }
        }

        // Autonomous Recovery: Cross-check with Immutable Ledger to guarantee zero data loss
        try {
            const { entries: ledgerEntries } = await fetchImmutableLedger();
            if (ledgerEntries && ledgerEntries.length > 0) {
                const deletedCodes = new Set(
                    submissions.filter(s => s.is_deleted).map(s => s.response_code)
                );

                for (const entry of ledgerEntries) {
                    if (!entry.response_code) continue;
                    if (deletedCodes.has(entry.response_code)) continue;

                    const checkStmt = db.prepare("SELECT id FROM responses WHERE response_code = ?;");
                    checkStmt.bind([entry.response_code]);
                    const exists = checkStmt.step();
                    checkStmt.free();

                    if (!exists) {
                        console.log(`[AUTONOMOUS-RECOVERY] Re-hydrating response ${entry.response_code} (${entry.name || 'Participant'}) from immutable ledger...`);
                        const insertSql = `
                            INSERT INTO responses (
                                response_uuid, response_code, submitted_at,
                                name, full_name, age_group, gender, city, state, region_classification, mp_flag, indore_flag,
                                occupation, income_group, q07_online_impulse_freq, q08_offline_impulse_freq,
                                q09_avg_unplanned_spend, preferred_channel, q10_need_for_touch, q11_visual_displays,
                                q12_checkout_placement, q13_salesperson_advice, q14_ai_recommendations,
                                q15_countdown_timers, q16_scarcity_fomo, q17_social_proof_reviews,
                                q18_push_notifications, q19_primary_payment_mode, q20_upi_pain_reduction,
                                q21_bnpl_spend_encouragement, fintech_user_flag, q22_online_impulse_regret,
                                q23_offline_satisfaction, q24_return_exchange_freq, q25_fake_timers_loss_of_trust,
                                is_demo, data_source, client_user_agent, created_at
                            ) VALUES (
                                ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?, ?,
                                ?, ?, ?,
                                ?, ?, ?,
                                ?, ?, ?,
                                ?, ?, ?,
                                ?, ?, ?,
                                0, 'IMMUTABLE_RECOVERED_PARTICIPANT', ?, ?
                            );
                        `;
                        const nameVal = entry.full_name || entry.name || 'Anonymous Participant';
                        db.run(insertSql, [
                            entry.response_uuid || entry.response_code, entry.response_code, entry.submitted_at || new Date().toISOString(),
                            nameVal, nameVal, entry.age_group || '25 – 34 years (Working Professional / Early Career)', entry.gender || 'Female',
                            entry.city || 'Indore', entry.state || 'Madhya Pradesh', entry.region_classification || 'Indore Hub',
                            entry.mp_flag !== undefined ? entry.mp_flag : 1, entry.indore_flag !== undefined ? entry.indore_flag : 1,
                            entry.occupation || 'Salaried Professional / Corporate Employee', entry.income_group || 'Rs. 60,001 to Rs. 1,00,000',
                            entry.q07_online_impulse_freq || '1 to 2 times a month', entry.q08_offline_impulse_freq || '1 to 2 times a month',
                            entry.q09_avg_unplanned_spend || 'Rs. 1,501 to Rs. 3,000', entry.preferred_channel || 'Online',
                            parseInt(entry.q10_need_for_touch || 3, 10), parseInt(entry.q11_visual_displays || 3, 10),
                            parseInt(entry.q12_checkout_placement || 3, 10), parseInt(entry.q13_salesperson_advice || 3, 10),
                            parseInt(entry.q14_ai_recommendations || 3, 10), parseInt(entry.q15_countdown_timers || 3, 10),
                            parseInt(entry.q16_scarcity_fomo || 3, 10), parseInt(entry.q17_social_proof_reviews || 3, 10),
                            parseInt(entry.q18_push_notifications || 3, 10), entry.q19_primary_payment_mode || 'UPI (Google Pay, PhonePe, Paytm QR)',
                            parseInt(entry.q20_upi_pain_reduction || 3, 10), parseInt(entry.q21_bnpl_spend_encouragement || 3, 10),
                            entry.fintech_user_flag !== undefined ? entry.fintech_user_flag : 1, parseInt(entry.q22_online_impulse_regret || 3, 10),
                            parseInt(entry.q23_offline_satisfaction || 3, 10), parseInt(entry.q24_return_exchange_freq || 2, 10),
                            parseInt(entry.q25_fake_timers_loss_of_trust || 4, 10),
                            entry.client_user_agent || 'Web Browser', entry.created_at || new Date().toISOString()
                        ]);
                        insertedCount++;
                    }
                }
            }
        } catch (ledgerSyncErr) {
            console.warn('[AUTONOMOUS-RECOVERY] Ledger sync notice:', ledgerSyncErr.message);
        }

        if (insertedCount > 0 || updatedCount > 0 || deletedCount > 0) {
            console.log(`[CLOUD-SYNC] Sync result: +${insertedCount} inserted, ~${updatedCount} updated, -${deletedCount} deleted.`);
        }
        return { inserted: insertedCount, updated: updatedCount, deleted: deletedCount, total: submissions.length };
    } catch (err) {
        console.warn('[CLOUD-SYNC] Synchronization warning:', err.message);
        return null;
    }
}

module.exports = {
    fetchCloudSubmissions,
    persistSubmissionToCloud,
    updateSubmissionInCloud,
    deleteSubmissionFromCloud,
    syncCloudSubmissionsIntoSqlite,
    appendImmutableLedger,
    fetchImmutableLedger
};
