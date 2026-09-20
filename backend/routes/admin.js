// ==============================================================================
// ADMIN ANALYTICS & EXPORT API ROUTE (backend/routes/admin.js)
// Candidate: MAN MACHYA (Roll: 252380042) | DAVV / MIST Indore
// ==============================================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb, query, queryOne, run, persistToFile } = require('../db');
const { requireAdminAuth } = require('./auth');
const { buildExcelBuffer, buildCsvString, syncRawResponsesFiles } = require('../exportService');
const { 
    syncCloudSubmissionsIntoSqlite, 
    persistSubmissionToCloud, 
    updateSubmissionInCloud, 
    deleteSubmissionFromCloud 
} = require('../cloudPersistence');

// Helper to clamp Likert scale values 1 to 5
function clampLikert(val, fallback = 3) {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) return fallback;
    return Math.max(1, Math.min(5, parsed));
}

// Helper to determine regional flags
function evaluateRegion(city, state) {
    const cLower = (city || '').toLowerCase();
    const sLower = (state || '').toLowerCase();

    let isIndore = cLower.includes('indore');
    let isMP = sLower.includes('madhya pradesh') || isIndore || cLower.includes('bhopal') || cLower.includes('ujjain') || cLower.includes('gwalior') || cLower.includes('jabalpur');

    let region = 'Other States';
    if (isIndore) {
        region = 'Indore Hub';
    } else if (isMP) {
        region = 'Rest of MP';
    } else if (sLower.includes('delhi') || sLower.includes('uttar pradesh') || sLower.includes('rajasthan') || sLower.includes('punjab') || sLower.includes('haryana') || sLower.includes('chandigarh')) {
        region = 'Major North India';
    }

    return {
        mp_flag: isMP ? 1 : 0,
        indore_flag: isIndore ? 1 : 0,
        region_classification: region
    };
}

// Protect all /admin/* endpoints with token verification
router.use('/admin', requireAdminAuth);

// ------------------------------------------------------------------------------
// 1. GET /api/admin/stats - High-level KPIs & Aggregated Analytics
// ------------------------------------------------------------------------------
router.get('/admin/stats', async (req, res) => {
    try {
        try { 
            const db = await getDb(); 
            const syncRes = await syncCloudSubmissionsIntoSqlite(db); 
            if (syncRes && (syncRes.inserted > 0 || syncRes.updated > 0 || syncRes.deleted > 0)) {
                persistToFile();
            }
        } catch (e) {
            console.warn('[ADMIN STATS] Cloud sync warning:', e.message);
        }
        // Summary KPIs
        const totalRow = await queryOne("SELECT COUNT(*) AS total FROM responses WHERE is_demo = 0;");
        const totalCount = totalRow ? totalRow.total : 0;

        const distinctStatesRow = await queryOne("SELECT COUNT(DISTINCT state) AS c FROM responses WHERE is_demo = 0;");
        const distinctCitiesRow = await queryOne("SELECT COUNT(DISTINCT city) AS c FROM responses WHERE is_demo = 0;");

        // Today and current week / month counts
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayRow = await queryOne("SELECT COUNT(*) AS c FROM responses WHERE is_demo = 0 AND submitted_at LIKE ?;", [`${todayStr}%`]);

        // Regional Distribution
        const regRows = await query(`
            SELECT region_classification AS label, COUNT(*) AS count
            FROM responses
            WHERE is_demo = 0
            GROUP BY region_classification
            ORDER BY count DESC;
        `);

        // Channel Preference Distribution
        const chRows = await query(`
            SELECT preferred_channel AS label, COUNT(*) AS count
            FROM responses
            WHERE is_demo = 0
            GROUP BY preferred_channel
            ORDER BY count DESC;
        `);

        // Payment Mode Distribution
        const payRows = await query(`
            SELECT q19_primary_payment_mode AS label, COUNT(*) AS count
            FROM responses
            WHERE is_demo = 0
            GROUP BY q19_primary_payment_mode
            ORDER BY count DESC;
        `);

        // Mean Likert Trigger Ratings (1-5)
        const trigRow = await queryOne(`
            SELECT 
                ROUND(AVG(q10_need_for_touch), 2) AS tactile_touch,
                ROUND(AVG(q11_visual_displays), 2) AS visual_displays,
                ROUND(AVG(q12_checkout_placement), 2) AS checkout_placement,
                ROUND(AVG(q13_salesperson_advice), 2) AS salesperson_advice,
                ROUND(AVG(q14_ai_recommendations), 2) AS ai_recommendations,
                ROUND(AVG(q15_countdown_timers), 2) AS countdown_timers,
                ROUND(AVG(q16_scarcity_fomo), 2) AS scarcity_fomo,
                ROUND(AVG(q17_social_proof_reviews), 2) AS social_proof,
                ROUND(AVG(q18_push_notifications), 2) AS push_alerts,
                ROUND(AVG(q20_upi_pain_reduction), 2) AS upi_pain_reduction,
                ROUND(AVG(q21_bnpl_spend_encouragement), 2) AS bnpl_spend,
                ROUND(AVG(q22_online_impulse_regret), 2) AS online_regret,
                ROUND(AVG(q23_offline_satisfaction), 2) AS offline_satisfaction,
                ROUND(AVG(q24_return_exchange_freq), 2) AS return_freq,
                ROUND(AVG(q25_fake_timers_loss_of_trust), 2) AS trust_loss
            FROM responses
            WHERE is_demo = 0;
        `);

        // Submissions Timeline (group by date)
        const timelineRows = await query(`
            SELECT SUBSTR(submitted_at, 1, 10) AS date_label, COUNT(*) AS count
            FROM responses
            WHERE is_demo = 0
            GROUP BY date_label
            ORDER BY date_label ASC;
        `);

        return res.json({
            success: true,
            summary: {
                total: totalCount,
                today: todayRow ? todayRow.c : 0,
                thisWeek: totalCount,
                thisMonth: totalCount,
                distinctStates: distinctStatesRow ? distinctStatesRow.c : 0,
                distinctCities: distinctCitiesRow ? distinctCitiesRow.c : 0
            },
            distributions: {
                regions: regRows,
                channels: chRows,
                payments: payRows,
                triggerMeans: trigRow || {},
                timeline: timelineRows
            }
        });

    } catch (err) {
        console.error('[ADMIN ROUTE] Error loading stats:', err);
        return res.status(500).json({ success: false, error: 'Database query error loading statistics.' });
    }
});

// ------------------------------------------------------------------------------
// 2. GET /api/admin/responses - Paginated, Filterable List of Responses
// ------------------------------------------------------------------------------
router.get('/admin/responses', async (req, res) => {
    try {
        try { 
            const db = await getDb(); 
            const syncRes = await syncCloudSubmissionsIntoSqlite(db); 
            if (syncRes && (syncRes.inserted > 0 || syncRes.updated > 0 || syncRes.deleted > 0)) {
                persistToFile();
            }
        } catch (e) {
            console.warn('[ADMIN RESPONSES] Cloud sync warning:', e.message);
        }
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 15, 1);
        const offset = (page - 1) * limit;

        const { q, search, state, channel, payment } = req.query;
        const searchTerm = (q || search || '').trim();

        let whereClauses = ['is_demo = 0'];
        let params = [];

        if (searchTerm) {
            whereClauses.push('(name LIKE ? OR full_name LIKE ? OR response_code LIKE ? OR city LIKE ? OR state LIKE ? OR occupation LIKE ?)');
            const sPattern = `%${searchTerm}%`;
            params.push(sPattern, sPattern, sPattern, sPattern, sPattern, sPattern);
        }

        if (state) {
            whereClauses.push('state = ?');
            params.push(state);
        }

        if (channel) {
            whereClauses.push('preferred_channel = ?');
            params.push(channel);
        }

        if (payment) {
            whereClauses.push('q19_primary_payment_mode LIKE ?');
            params.push(`%${payment}%`);
        }

        const whereSql = 'WHERE ' + whereClauses.join(' AND ');

        // Count total matching
        const countSql = `SELECT COUNT(*) AS total FROM responses ${whereSql};`;
        const countRow = await queryOne(countSql, params);
        const total = countRow ? countRow.total : 0;
        const totalPages = Math.ceil(total / limit) || 1;

        // Fetch paginated rows ordered newest first
        const fetchSql = `
            SELECT * FROM responses 
            ${whereSql} 
            ORDER BY id DESC 
            LIMIT ? OFFSET ?;
        `;
        const rows = await query(fetchSql, [...params, limit, offset]);

        return res.json({
            success: true,
            responses: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        });

    } catch (err) {
        console.error('[ADMIN ROUTE] Error querying responses:', err);
        return res.status(500).json({ success: false, error: 'Database query error loading responses.' });
    }
});

// ------------------------------------------------------------------------------
// 3. GET /api/admin/responses/:id - Full 25-Item Single Response Detail
// ------------------------------------------------------------------------------
router.get('/admin/responses/:id', async (req, res) => {
    try {
        const idParam = req.params.id;

        const row = await queryOne(
            "SELECT * FROM responses WHERE response_code = ? OR response_uuid = ? OR id = ? LIMIT 1;",
            [idParam, idParam, isNaN(idParam) ? -1 : parseInt(idParam, 10)]
        );

        if (!row) {
            return res.status(404).json({
                success: false,
                error: `Response '${idParam}' not found.`
            });
        }

        return res.json({
            success: true,
            response: row
        });

    } catch (err) {
        console.error('[ADMIN ROUTE] Error retrieving response detail:', err);
        return res.status(500).json({ success: false, error: 'Database error retrieving response.' });
    }
});

// ------------------------------------------------------------------------------
// 4. POST /api/admin/responses - Create New Response directly from Admin
// ------------------------------------------------------------------------------
router.post('/admin/responses', async (req, res) => {
    try {
        const body = req.body || {};

        const cityClean = String(body.city || 'Indore').trim();
        const stateClean = String(body.state || 'Madhya Pradesh').trim();
        const { mp_flag, indore_flag, region_classification } = evaluateRegion(cityClean, stateClean);

        // Calculate strictly unique response code
        const maxRow = await queryOne("SELECT MAX(CAST(SUBSTR(response_code, 11) AS INTEGER)) AS maxNum FROM responses WHERE response_code LIKE 'RESP-2026-%';");
        let nextNum = ((maxRow && maxRow.maxNum) ? maxRow.maxNum : 200) + 1;
        let respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');
        while (await queryOne("SELECT id FROM responses WHERE response_code = ?;", [respCode])) {
            nextNum++;
            respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');
        }

        const uuid = uuidv4();
        const submittedAt = new Date().toISOString();

        const onFreq = body.q07_online_impulse_freq || '1 to 2 times a month';
        const offFreq = body.q08_offline_impulse_freq || '1 to 2 times a month';
        let prefChannel = body.preferred_channel || 'Hybrid';
        if (!body.preferred_channel) {
            if (onFreq.includes('3 to 4') || onFreq.includes('5+')) prefChannel = 'Online';
            else if (offFreq.includes('3 to 4') || offFreq.includes('5+')) prefChannel = 'Offline';
        }

        const payMode = String(body.q19_primary_payment_mode || 'UPI (Google Pay, PhonePe, Paytm QR)');
        const fintechUser = (payMode.includes('UPI') || payMode.includes('BNPL')) ? 1 : 0;
        const fullName = (body.name || body.full_name || '').trim() || 'Anonymous Respondent';

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
                0, 'ADMIN_MANUAL_ENTRY', 'Admin Dashboard', ?
            );
        `;

        const insertParams = [
            uuid, respCode, submittedAt,
            fullName, fullName, body.age_group || '25 – 34 years (Working Professional / Early Career)', body.gender || 'Female',
            cityClean, stateClean, region_classification, mp_flag, indore_flag,
            body.occupation || 'Salaried Professional / Corporate Employee', body.income_group || 'Rs. 60,001 to Rs. 1,00,000',
            onFreq, offFreq, body.q09_avg_unplanned_spend || 'Rs. 1,501 to Rs. 3,000', prefChannel,
            clampLikert(body.q10_need_for_touch, 4), clampLikert(body.q11_visual_displays, 4),
            clampLikert(body.q12_checkout_placement, 3), clampLikert(body.q13_salesperson_advice, 3),
            clampLikert(body.q14_ai_recommendations, 5), clampLikert(body.q15_countdown_timers, 4),
            clampLikert(body.q16_scarcity_fomo, 4), clampLikert(body.q17_social_proof_reviews, 5),
            clampLikert(body.q18_push_notifications, 4), payMode,
            clampLikert(body.q20_upi_pain_reduction, 5), clampLikert(body.q21_bnpl_spend_encouragement, 4),
            fintechUser, clampLikert(body.q22_online_impulse_regret, 4),
            clampLikert(body.q23_offline_satisfaction, 4), clampLikert(body.q24_return_exchange_freq, 2),
            clampLikert(body.q25_fake_timers_loss_of_trust, 5),
            submittedAt
        ];

        await run(insertSql, insertParams);
        
        try {
            await syncRawResponsesFiles();
        } catch (syncErr) {
            console.warn('[ADMIN ROUTE] Export sync warning on create:', syncErr.message);
        }

        const created = await queryOne("SELECT * FROM responses WHERE response_code = ?;", [respCode]);

        // Cloud Persistence Sync
        try {
            await persistSubmissionToCloud(created);
        } catch (cloudErr) {
            console.error('[ADMIN ROUTE] Cloud persistence warning on create:', cloudErr.message);
        }

        return res.status(201).json({
            success: true,
            message: `Response ${respCode} created successfully and synchronized.`,
            response: created
        });
    } catch (err) {
        console.error('[ADMIN ROUTE] Error creating response:', err);
        return res.status(500).json({ success: false, error: 'Database error creating response.' });
    }
});

// ------------------------------------------------------------------------------
// 5. PUT /api/admin/responses/:id - Update Existing Response
// ------------------------------------------------------------------------------
router.put('/admin/responses/:id', async (req, res) => {
    try {
        const idParam = req.params.id;
        const body = req.body || {};

        const existing = await queryOne(
            "SELECT * FROM responses WHERE response_code = ? OR response_uuid = ? OR id = ? LIMIT 1;",
            [idParam, idParam, isNaN(idParam) ? -1 : parseInt(idParam, 10)]
        );

        if (!existing) {
            return res.status(404).json({ success: false, error: `Response '${idParam}' not found.` });
        }

        const cityClean = body.city !== undefined ? String(body.city).trim() : existing.city;
        const stateClean = body.state !== undefined ? String(body.state).trim() : existing.state;
        const { mp_flag, indore_flag, region_classification } = evaluateRegion(cityClean, stateClean);

        const payMode = body.q19_primary_payment_mode !== undefined ? String(body.q19_primary_payment_mode) : existing.q19_primary_payment_mode;
        const fintechUser = (payMode.includes('UPI') || payMode.includes('BNPL')) ? 1 : 0;
        const updatedName = body.name !== undefined ? body.name : (body.full_name !== undefined ? body.full_name : (existing.name || existing.full_name));

        const updateSql = `
            UPDATE responses SET
                name = ?,
                full_name = ?,
                age_group = ?,
                gender = ?,
                city = ?,
                state = ?,
                region_classification = ?,
                mp_flag = ?,
                indore_flag = ?,
                occupation = ?,
                income_group = ?,
                q07_online_impulse_freq = ?,
                q08_offline_impulse_freq = ?,
                q09_avg_unplanned_spend = ?,
                preferred_channel = ?,
                q10_need_for_touch = ?,
                q11_visual_displays = ?,
                q12_checkout_placement = ?,
                q13_salesperson_advice = ?,
                q14_ai_recommendations = ?,
                q15_countdown_timers = ?,
                q16_scarcity_fomo = ?,
                q17_social_proof_reviews = ?,
                q18_push_notifications = ?,
                q19_primary_payment_mode = ?,
                q20_upi_pain_reduction = ?,
                q21_bnpl_spend_encouragement = ?,
                fintech_user_flag = ?,
                q22_online_impulse_regret = ?,
                q23_offline_satisfaction = ?,
                q24_return_exchange_freq = ?,
                q25_fake_timers_loss_of_trust = ?
            WHERE id = ?;
        `;

        const updateParams = [
            updatedName,
            updatedName,
            body.age_group !== undefined ? body.age_group : existing.age_group,
            body.gender !== undefined ? body.gender : existing.gender,
            cityClean,
            stateClean,
            region_classification,
            mp_flag,
            indore_flag,
            body.occupation !== undefined ? body.occupation : existing.occupation,
            body.income_group !== undefined ? body.income_group : existing.income_group,
            body.q07_online_impulse_freq !== undefined ? body.q07_online_impulse_freq : existing.q07_online_impulse_freq,
            body.q08_offline_impulse_freq !== undefined ? body.q08_offline_impulse_freq : existing.q08_offline_impulse_freq,
            body.q09_avg_unplanned_spend !== undefined ? body.q09_avg_unplanned_spend : existing.q09_avg_unplanned_spend,
            body.preferred_channel !== undefined ? body.preferred_channel : existing.preferred_channel,
            body.q10_need_for_touch !== undefined ? clampLikert(body.q10_need_for_touch, existing.q10_need_for_touch) : existing.q10_need_for_touch,
            body.q11_visual_displays !== undefined ? clampLikert(body.q11_visual_displays, existing.q11_visual_displays) : existing.q11_visual_displays,
            body.q12_checkout_placement !== undefined ? clampLikert(body.q12_checkout_placement, existing.q12_checkout_placement) : existing.q12_checkout_placement,
            body.q13_salesperson_advice !== undefined ? clampLikert(body.q13_salesperson_advice, existing.q13_salesperson_advice) : existing.q13_salesperson_advice,
            body.q14_ai_recommendations !== undefined ? clampLikert(body.q14_ai_recommendations, existing.q14_ai_recommendations) : existing.q14_ai_recommendations,
            body.q15_countdown_timers !== undefined ? clampLikert(body.q15_countdown_timers, existing.q15_countdown_timers) : existing.q15_countdown_timers,
            body.q16_scarcity_fomo !== undefined ? clampLikert(body.q16_scarcity_fomo, existing.q16_scarcity_fomo) : existing.q16_scarcity_fomo,
            body.q17_social_proof_reviews !== undefined ? clampLikert(body.q17_social_proof_reviews, existing.q17_social_proof_reviews) : existing.q17_social_proof_reviews,
            body.q18_push_notifications !== undefined ? clampLikert(body.q18_push_notifications, existing.q18_push_notifications) : existing.q18_push_notifications,
            payMode,
            body.q20_upi_pain_reduction !== undefined ? clampLikert(body.q20_upi_pain_reduction, existing.q20_upi_pain_reduction) : existing.q20_upi_pain_reduction,
            body.q21_bnpl_spend_encouragement !== undefined ? clampLikert(body.q21_bnpl_spend_encouragement, existing.q21_bnpl_spend_encouragement) : existing.q21_bnpl_spend_encouragement,
            fintechUser,
            body.q22_online_impulse_regret !== undefined ? clampLikert(body.q22_online_impulse_regret, existing.q22_online_impulse_regret) : existing.q22_online_impulse_regret,
            body.q23_offline_satisfaction !== undefined ? clampLikert(body.q23_offline_satisfaction, existing.q23_offline_satisfaction) : existing.q23_offline_satisfaction,
            body.q24_return_exchange_freq !== undefined ? clampLikert(body.q24_return_exchange_freq, existing.q24_return_exchange_freq) : existing.q24_return_exchange_freq,
            body.q25_fake_timers_loss_of_trust !== undefined ? clampLikert(body.q25_fake_timers_loss_of_trust, existing.q25_fake_timers_loss_of_trust) : existing.q25_fake_timers_loss_of_trust,
            existing.id
        ];

        await run(updateSql, updateParams);

        try {
            await syncRawResponsesFiles();
        } catch (syncErr) {
            console.warn('[ADMIN ROUTE] Export sync warning on update:', syncErr.message);
        }

        const updated = await queryOne("SELECT * FROM responses WHERE id = ?;", [existing.id]);

        // Cloud Persistence Sync
        try {
            await updateSubmissionInCloud(updated);
        } catch (cloudErr) {
            console.error('[ADMIN ROUTE] Cloud persistence warning on update:', cloudErr.message);
        }

        return res.json({
            success: true,
            message: `Response ${existing.response_code} updated successfully and synchronized.`,
            response: updated
        });

    } catch (err) {
        console.error('[ADMIN ROUTE] Error updating response:', err);
        return res.status(500).json({ success: false, error: 'Database error updating response: ' + (err.message || 'Unknown error') });
    }
});

// ------------------------------------------------------------------------------
// 6. DELETE /api/admin/responses/:id - Delete Response from SQLite & Cloud
// ------------------------------------------------------------------------------
router.delete('/admin/responses/:id', async (req, res) => {
    try {
        const idParam = req.params.id;
        const existing = await queryOne(
            "SELECT * FROM responses WHERE response_code = ? OR response_uuid = ? OR id = ? LIMIT 1;",
            [idParam, idParam, isNaN(idParam) ? -1 : parseInt(idParam, 10)]
        );

        if (!existing) {
            return res.status(404).json({ success: false, error: `Response '${idParam}' not found.` });
        }

        await run("DELETE FROM responses WHERE id = ? OR response_code = ?;", [existing.id, existing.response_code]);

        try {
            await syncRawResponsesFiles();
        } catch (syncErr) {
            console.warn('[ADMIN ROUTE] Export sync warning on delete:', syncErr.message);
        }

        // Cloud Persistence Sync (Tombstone so cold start doesn't resurrect it)
        try {
            await deleteSubmissionFromCloud(existing.response_code, existing.response_uuid);
        } catch (cloudErr) {
            console.error('[ADMIN ROUTE] Cloud persistence warning on delete:', cloudErr.message);
        }

        return res.json({
            success: true,
            message: `Response ${existing.response_code} deleted successfully and synchronized.`,
            deleted_code: existing.response_code
        });

    } catch (err) {
        console.error('[ADMIN ROUTE] Error deleting response:', err);
        return res.status(500).json({ success: false, error: 'Database error deleting response: ' + (err.message || 'Unknown error') });
    }
});

// ------------------------------------------------------------------------------
// 7. GET /api/admin/export/excel - Live Excel (.xlsx) Streaming
// ------------------------------------------------------------------------------
router.get('/admin/export/excel', async (req, res) => {
    try {
        const rows = await query(
            "SELECT * FROM responses WHERE is_demo = 0 ORDER BY id ASC;"
        );

        const buffer = buildExcelBuffer(
            rows, 
            'Primary_Survey_Responses',
            'MBA Major Research Project - Impulse Buying in Online vs Offline Markets (Primary Data: n=200+)'
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="MRP_Primary_Survey_Responses_Latest.xlsx"');
        res.setHeader('Content-Length', buffer.length);

        return res.end(buffer);

    } catch (err) {
        console.error('[ADMIN ROUTE] Error streaming Excel:', err);
        return res.status(500).send('Error generating Excel file.');
    }
});

// ------------------------------------------------------------------------------
// 8. GET /api/admin/export/csv - Live CSV (.csv) Streaming
// ------------------------------------------------------------------------------
router.get('/admin/export/csv', async (req, res) => {
    try {
        const rows = await query(
            "SELECT * FROM responses WHERE is_demo = 0 ORDER BY id ASC;"
        );

        const csvContent = buildCsvString(rows);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="MRP_Primary_Survey_Responses_Latest.csv"');

        return res.send(csvContent);

    } catch (err) {
        console.error('[ADMIN ROUTE] Error streaming CSV:', err);
        return res.status(500).send('Error generating CSV file.');
    }
});

// ------------------------------------------------------------------------------
// 9. POST /api/admin/refresh-exports - Trigger Disk File Re-sync
// ------------------------------------------------------------------------------
router.post('/admin/refresh-exports', async (req, res) => {
    try {
        const result = await syncRawResponsesFiles();
        return res.json({
            success: true,
            message: 'All responses successfully synchronized to data/raw_responses.xlsx and data/raw_responses.csv',
            stats: result
        });
    } catch (err) {
        console.error('[ADMIN ROUTE] Error syncing files:', err);
        return res.status(500).json({ success: false, error: 'Failed to synchronize files.' });
    }
});

module.exports = router;
