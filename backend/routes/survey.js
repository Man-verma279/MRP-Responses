// ==============================================================================
// PUBLIC SURVEY API ROUTE (backend/routes/survey.js)
// Handles POST /api/responses for real participant submissions
// ==============================================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { run, query } = require('../db');
const { syncRawResponsesFiles } = require('../exportService');
const { persistSubmissionToCloud } = require('../cloudPersistence');

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

        // Generate unique UUID and readable response code
        const uuid = uuidv4();
        const countRes = await query("SELECT COUNT(*) AS total FROM responses;");
        const nextNum = (countRes[0] ? countRes[0].total : 0) + 1;
        const respCode = 'RESP-2026-' + nextNum.toString().padStart(4, '0');
        const submittedAt = new Date().toISOString();

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
            parseInt(body.q10_need_for_touch, 10), parseInt(body.q11_visual_displays, 10),
            parseInt(body.q12_checkout_placement, 10), parseInt(body.q13_salesperson_advice, 10),
            parseInt(body.q14_ai_recommendations, 10), parseInt(body.q15_countdown_timers, 10),
            parseInt(body.q16_scarcity_fomo, 10), parseInt(body.q17_social_proof_reviews, 10),
            parseInt(body.q18_push_notifications, 10), payMode,
            parseInt(body.q20_upi_pain_reduction, 10), parseInt(body.q21_bnpl_spend_encouragement, 10),
            fintechUser, parseInt(body.q22_online_impulse_regret, 10),
            parseInt(body.q23_offline_satisfaction, 10), parseInt(body.q24_return_exchange_freq, 10),
            parseInt(body.q25_fake_timers_loss_of_trust, 10),
            userAgent, submittedAt
        ];

        const runResult = await run(insertSql, insertParams);

        // 4. Asynchronously persist to permanent cloud store & local files
        persistSubmissionToCloud({
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
            q10_need_for_touch: parseInt(body.q10_need_for_touch, 10),
            q11_visual_displays: parseInt(body.q11_visual_displays, 10),
            q12_checkout_placement: parseInt(body.q12_checkout_placement, 10),
            q13_salesperson_advice: parseInt(body.q13_salesperson_advice, 10),
            q14_ai_recommendations: parseInt(body.q14_ai_recommendations, 10),
            q15_countdown_timers: parseInt(body.q15_countdown_timers, 10),
            q16_scarcity_fomo: parseInt(body.q16_scarcity_fomo, 10),
            q17_social_proof_reviews: parseInt(body.q17_social_proof_reviews, 10),
            q18_push_notifications: parseInt(body.q18_push_notifications, 10),
            q19_primary_payment_mode: payMode,
            q20_upi_pain_reduction: parseInt(body.q20_upi_pain_reduction, 10),
            q21_bnpl_spend_encouragement: parseInt(body.q21_bnpl_spend_encouragement, 10),
            fintech_user_flag: fintechUser,
            q22_online_impulse_regret: parseInt(body.q22_online_impulse_regret, 10),
            q23_offline_satisfaction: parseInt(body.q23_offline_satisfaction, 10),
            q24_return_exchange_freq: parseInt(body.q24_return_exchange_freq, 10),
            q25_fake_timers_loss_of_trust: parseInt(body.q25_fake_timers_loss_of_trust, 10),
            client_user_agent: userAgent,
            created_at: submittedAt
        }).catch(err => {
            console.error('[CLOUD-SYNC] Error persisting submission:', err.message);
        });

        syncRawResponsesFiles().catch(err => {
            console.error('[SYNC] Background sync failed:', err.message);
        });

        console.log(`[SURVEY] New real response accepted: ${respCode} (RowID: ${runResult.lastInsertRowid})`);

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
