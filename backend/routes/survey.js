// ==============================================================================
// PUBLIC SURVEY API ROUTE (backend/routes/survey.js)
// Handles POST /api/responses for real participant submissions
// ==============================================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { run, query, queryOne, getDb, persistToFile } = require('../db');
const { syncRawResponsesFiles } = require('../exportService');
const { persistSubmissionToCloud, syncCloudSubmissionsIntoSqlite, appendImmutableLedger } = require('../cloudPersistence');

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

// POST /api/responses - Submit survey response
router.post('/responses', async (req, res) => {
    try {
        const body = req.body || {};

        // 1. Mandatory Fields Validation
        const respondentName = (body.name || body.full_name || '').trim();
        if (!respondentName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: name (or full_name)'
            });
        }

        const requiredFields = [
            'age_group', 'gender', 'city', 'state', 'occupation',
            'q07_online_impulse_freq', 'q08_offline_impulse_freq', 'q09_avg_unplanned_spend',
            'q10_need_for_touch', 'q11_visual_displays', 'q12_checkout_placement', 'q13_salesperson_advice',
            'q14_ai_recommendations', 'q15_countdown_timers', 'q16_scarcity_fomo', 'q17_social_proof_reviews', 'q18_push_notifications',
            'q19_primary_payment_mode', 'q20_upi_pain_reduction', 'q21_bnpl_spend_encouragement',
            'q22_online_impulse_regret', 'q23_offline_satisfaction', 'q24_return_exchange_freq', 'q25_fake_timers_loss_of_trust'
        ];

        for (const f of requiredFields) {
            if (body[f] === undefined || body[f] === null || body[f] === '') {
                return res.status(400).json({
                    success: false,
                    error: `Missing required field: ${f}`
                });
            }
        }

        // Validate Likert scale integer ranges (1-5)
        const likertFields = [
            'q10_need_for_touch', 'q11_visual_displays', 'q12_checkout_placement', 'q13_salesperson_advice',
            'q14_ai_recommendations', 'q15_countdown_timers', 'q16_scarcity_fomo', 'q17_social_proof_reviews', 'q18_push_notifications',
            'q20_upi_pain_reduction', 'q21_bnpl_spend_encouragement',
            'q22_online_impulse_regret', 'q23_offline_satisfaction', 'q24_return_exchange_freq', 'q25_fake_timers_loss_of_trust'
        ];

        for (const lf of likertFields) {
            const val = parseInt(body[lf], 10);
            if (isNaN(val) || val < 1 || val > 5) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid scale value for ${lf}: must be an integer between 1 and 5`
                });
            }
        }

        // 2. Derive Regional & Behavioral Variables
        const cityClean = String(body.city).trim();
        const stateClean = String(body.state).trim();
        const { mp_flag, indore_flag, region_classification } = evaluateRegion(cityClean, stateClean);

        // Derive preferred channel based on frequencies
        const onFreq = body.q07_online_impulse_freq;
        const offFreq = body.q08_offline_impulse_freq;
        let prefChannel = 'Hybrid';
        if (onFreq.includes('3 to 4') || onFreq.includes('5+')) {
            prefChannel = 'Online';
        } else if (offFreq.includes('3 to 4') || offFreq.includes('5+')) {
            prefChannel = 'Offline';
        }

        const payMode = String(body.q19_primary_payment_mode);
        const fintechUser = (payMode.includes('UPI') || payMode.includes('BNPL')) ? 1 : 0;

        function clampLikert(val, def = 3) {
            const n = parseInt(val, 10);
            if (isNaN(n) || n < 1) return 1;
            if (n > 5) return 5;
            return n;
        }

        // 2. Synchronize existing cloud submissions so response code calculation is 100% accurate
        try {
            const db = await getDb();
            await syncCloudSubmissionsIntoSqlite(db, true);
        } catch (syncErr) {
            console.warn('[SURVEY] Pre-submission sync warning:', syncErr.message);
        }

        // Generate unique UUID and readable collision-free response code
        const uuid = uuidv4();
        const submittedAt = new Date().toISOString();

        const maxCodeRow = await queryOne(`
            SELECT MAX(CAST(SUBSTR(response_code, 11) AS INTEGER)) AS maxNum 
            FROM responses 
            WHERE response_code LIKE 'RESP-2026-%';
        `);
        let nextNum = Math.max(206, (maxCodeRow && maxCodeRow.maxNum ? maxCodeRow.maxNum : 206)) + 1;
        let respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');

        while (await queryOne("SELECT id FROM responses WHERE response_code = ?;", [respCode])) {
            nextNum++;
            respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');
        }

        // 3. Store Real Response in SQLite
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

        const userAgent = req.headers['user-agent'] || 'Unknown';
        const finalName = respondentName || 'Anonymous Respondent';

        const insertParams = [
            uuid, respCode, submittedAt,
            finalName, finalName, body.age_group, body.gender, cityClean, stateClean, region_classification, mp_flag, indore_flag,
            body.occupation, body.income_group || 'Not Specified',
            body.q07_online_impulse_freq, body.q08_offline_impulse_freq, body.q09_avg_unplanned_spend, prefChannel,
            clampLikert(body.q10_need_for_touch), clampLikert(body.q11_visual_displays),
            clampLikert(body.q12_checkout_placement), clampLikert(body.q13_salesperson_advice),
            clampLikert(body.q14_ai_recommendations), clampLikert(body.q15_countdown_timers),
            clampLikert(body.q16_scarcity_fomo), clampLikert(body.q17_social_proof_reviews),
            clampLikert(body.q18_push_notifications), payMode,
            clampLikert(body.q20_upi_pain_reduction), clampLikert(body.q21_bnpl_spend_encouragement),
            fintechUser, clampLikert(body.q22_online_impulse_regret),
            clampLikert(body.q23_offline_satisfaction), clampLikert(body.q24_return_exchange_freq, 2),
            clampLikert(body.q25_fake_timers_loss_of_trust, 4),
            userAgent, submittedAt
        ];

        let runResult = null;
        let inserted = false;
        let insertAttempts = 0;

        while (!inserted && insertAttempts < 5) {
            insertAttempts++;
            try {
                insertParams[1] = respCode;
                runResult = await run(insertSql, insertParams);
                inserted = true;
            } catch (insertErr) {
                if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
                    nextNum++;
                    respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');
                    console.warn(`[SURVEY] Response code collision caught, retrying with: ${respCode}`);
                } else {
                    throw insertErr;
                }
            }
        }
        if (!inserted) {
            throw new Error('Could not assign a unique response code after multiple attempts.');
        }

        persistToFile();

        // 4. Construct record and CRITICAL: AWAIT permanent cloud persistence before responding!
        // In Vercel serverless, returning early terminates the execution environment and kills un-awaited requests!
        const recordToSave = {
            response_uuid: uuid,
            response_code: respCode,
            submitted_at: submittedAt,
            name: finalName,
            full_name: finalName,
            age_group: body.age_group,
            gender: body.gender,
            city: cityClean,
            state: stateClean,
            region_classification: region_classification,
            mp_flag: mp_flag,
            indore_flag: indore_flag,
            occupation: body.occupation,
            income_group: body.income_group || 'Not Specified',
            q07_online_impulse_freq: body.q07_online_impulse_freq,
            q08_offline_impulse_freq: body.q08_offline_impulse_freq,
            q09_avg_unplanned_spend: body.q09_avg_unplanned_spend,
            preferred_channel: prefChannel,
            q10_need_for_touch: clampLikert(body.q10_need_for_touch),
            q11_visual_displays: clampLikert(body.q11_visual_displays),
            q12_checkout_placement: clampLikert(body.q12_checkout_placement),
            q13_salesperson_advice: clampLikert(body.q13_salesperson_advice),
            q14_ai_recommendations: clampLikert(body.q14_ai_recommendations),
            q15_countdown_timers: clampLikert(body.q15_countdown_timers),
            q16_scarcity_fomo: clampLikert(body.q16_scarcity_fomo),
            q17_social_proof_reviews: clampLikert(body.q17_social_proof_reviews),
            q18_push_notifications: clampLikert(body.q18_push_notifications),
            q19_primary_payment_mode: payMode,
            q20_upi_pain_reduction: clampLikert(body.q20_upi_pain_reduction),
            q21_bnpl_spend_encouragement: clampLikert(body.q21_bnpl_spend_encouragement),
            fintech_user_flag: fintechUser,
            q22_online_impulse_regret: clampLikert(body.q22_online_impulse_regret),
            q23_offline_satisfaction: clampLikert(body.q23_offline_satisfaction),
            q24_return_exchange_freq: clampLikert(body.q24_return_exchange_freq, 2),
            q25_fake_timers_loss_of_trust: clampLikert(body.q25_fake_timers_loss_of_trust, 4),
            client_user_agent: userAgent,
            created_at: submittedAt
        };

        try {
            const cloudPersistOk = await persistSubmissionToCloud(recordToSave);
            if (!cloudPersistOk) {
                console.warn(`[SURVEY] Warning: Cloud persistence could not confirm GitHub commit for ${respCode}`);
            }
        } catch (cloudErr) {
            console.error('[SURVEY] Cloud persistence error:', cloudErr.message);
        }

        // 5. Append to WORM (Write Once, Read Many) Immutable Research Ledger
        try {
            await appendImmutableLedger(recordToSave);
        } catch (ledgerErr) {
            console.error('[SURVEY] Immutable ledger error:', ledgerErr.message);
        }

        try {
            await syncRawResponsesFiles();
        } catch (syncErr) {
            console.warn('[SURVEY] Export files sync warning:', syncErr.message);
        }

        console.log(`[SURVEY] New real response permanently saved: ${respCode} (RowID: ${runResult ? runResult.lastInsertRowid : 'unknown'})`);

        return res.status(201).json({
            success: true,
            message: 'Your research survey response has been successfully recorded.',
            response_id: respCode,
            submitted_at: submittedAt
        });

    } catch (err) {
        console.error('[SURVEY] Submission error:', err);
        return res.status(500).json({
            success: false,
            error: 'Internal server error while processing survey response.'
        });
    }
});

module.exports = router;
