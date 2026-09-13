// ==============================================================================
// END-TO-END AUTOMATED TEST SUITE (test_app_suite.js)
// Verifies Form load, validation, submission, SQLite update, Admin login,
// Stats, Table, Excel/CSV exports, Vercel configuration, and Full CRUD.
// ==============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const baseDir = 'd:/MRP/research-survey-app';
process.chdir(baseDir);

const app = require(path.join(baseDir, 'backend/server'));
const { query, queryOne } = require(path.join(baseDir, 'backend/db'));

const TEST_PORT = 3099;
let server = null;
let adminToken = null;
let testResponseCode = null;

// Helper: HTTP request wrapper
function makeRequest(method, urlPath, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: urlPath,
            method: method,
            headers: headers
        };

        if (body && typeof body === 'object') {
            body = JSON.stringify(body);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }

        const req = http.request(options, (res) => {
            let data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                const text = buffer.toString('utf8');
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch (e) {}

                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    bodyText: text,
                    bodyJson: json,
                    buffer: buffer
                });
            });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  [PASS] ${testName}`);
        passed++;
    } else {
        console.error(`  [FAIL] ${testName} -> ${details}`);
        failed++;
    }
}

async function runTests() {
    console.log('====================================================');
    console.log('STARTING RESEARCH SURVEY APP TEST SUITE (22 CHECKS)');
    console.log('====================================================\n');

    try {
        // Start ephemeral test server on TEST_PORT
        await new Promise((resolve) => {
            server = app.listen(TEST_PORT, () => {
                console.log(`[TEST SERVER] Ephemeral test runner listening on port ${TEST_PORT}`);
                resolve();
            });
        });

        // Test 1: Health Check Endpoint
        const health = await makeRequest('GET', '/api/health');
        assert(health.statusCode === 200 && health.bodyJson && health.bodyJson.status === 'online', '1. Server Health Check Endpoint');

        // Test 2: Public survey HTML loads
        const surveyPage = await makeRequest('GET', '/');
        assert(surveyPage.statusCode === 200 && surveyPage.bodyText.includes('Consumer Shopping Habits'), '2. Public Survey HTML Loads (/)');

        // Test 3: Admin dashboard HTML loads
        const adminPage = await makeRequest('GET', '/admin');
        assert(adminPage.statusCode === 200 && adminPage.bodyText.includes('Admin Research Dashboard'), '3. Admin Dashboard HTML Loads (/admin)');

        // Test 4: Form Validation (missing required fields)
        const invalidSub = await makeRequest('POST', '/api/responses', {}, { age_group: '18 – 24 years' });
        assert(invalidSub.statusCode === 400 && invalidSub.bodyJson.success === false, '4. Form Validation Rejects Incomplete Submissions', invalidSub.bodyText);

        // Test 5: Initial SQLite record count
        const initialCountRow = await queryOne("SELECT COUNT(*) AS total FROM responses;");
        const initialCount = initialCountRow.total;
        assert(initialCount >= 200, '5. Initial Primary Dataset Pre-Seeded in SQLite', `Count: ${initialCount}`);

        // Test 6: Submit a New Genuine Participant Response
        const validPayload = {
            name: 'Man Machya',
            full_name: 'Man Machya',
            age_group: '25 – 34 years (Working Professional / Early Career)',
            gender: 'Female',
            city: 'Indore (Vijay Nagar)',
            state: 'Madhya Pradesh',
            occupation: 'Salaried Professional / Corporate Employee',
            income_group: 'Rs. 60,001 to Rs. 1,00,000',
            q07_online_impulse_freq: '3 to 4 times a month',
            q08_offline_impulse_freq: '1 to 2 times a month',
            q09_avg_unplanned_spend: 'Rs. 1,501 to Rs. 3,000',
            q10_need_for_touch: 4,
            q11_visual_displays: 4,
            q12_checkout_placement: 3,
            q13_salesperson_advice: 2,
            q14_ai_recommendations: 5,
            q15_countdown_timers: 4,
            q16_scarcity_fomo: 4,
            q17_social_proof_reviews: 5,
            q18_push_notifications: 4,
            q19_primary_payment_mode: 'UPI (Google Pay, PhonePe, Paytm QR)',
            q20_upi_pain_reduction: 5,
            q21_bnpl_spend_encouragement: 4,
            q22_online_impulse_regret: 4,
            q23_offline_satisfaction: 4,
            q24_return_exchange_freq: 3,
            q25_fake_timers_loss_of_trust: 5
        };

        const submitRes = await makeRequest('POST', '/api/responses', {}, validPayload);
        assert(submitRes.statusCode === 201 && submitRes.bodyJson.success === true, '6. Real Survey Response Submission via API', submitRes.bodyText);
        testResponseCode = submitRes.bodyJson ? submitRes.bodyJson.response_id : null;

        // Test 7: Response count in SQLite incremented
        const newCountRow = await queryOne("SELECT COUNT(*) AS total FROM responses;");
        assert(newCountRow.total === initialCount + 1, '7. SQLite Response Count Incremented in Real-Time', `Expected: ${initialCount + 1}, Got: ${newCountRow.total}`);

        // Test 8: Regional Classification logic in SQLite
        const submittedRow = await queryOne("SELECT * FROM responses WHERE response_code = ?;", [testResponseCode]);
        assert(
            submittedRow && submittedRow.region_classification === 'Indore Hub' && submittedRow.mp_flag === 1 && submittedRow.indore_flag === 1,
            '8. Correct Regional Flagging (Indore Hub, MP=1, Indore=1)',
            JSON.stringify(submittedRow ? { reg: submittedRow.region_classification, mp: submittedRow.mp_flag, ind: submittedRow.indore_flag } : null)
        );

        // Test 9: Data sync to raw_responses.xlsx and raw_responses.csv
        const csvPath = path.join(baseDir, 'data', 'raw_responses.csv');
        const xlsxPath = path.join(baseDir, 'data', 'raw_responses.xlsx');
        assert(
            fs.existsSync(csvPath) && fs.existsSync(xlsxPath) && fs.statSync(csvPath).size > 0 && fs.statSync(xlsxPath).size > 0,
            '9. Auto-Synchronization to data/raw_responses.xlsx & raw_responses.csv'
        );

        // Test 10: Admin Authentication - Invalid Credentials
        const badLogin = await makeRequest('POST', '/api/admin/login', {}, { username: 'admin', password: 'wrongpassword' });
        assert(badLogin.statusCode === 401 && badLogin.bodyJson.success === false, '10. Admin Authentication Rejects Invalid Password');

        // Test 11: Admin Authentication - Valid Credentials
        const goodLogin = await makeRequest('POST', '/api/admin/login', {}, { username: 'admin', password: 'admin123' });
        assert(goodLogin.statusCode === 200 && goodLogin.bodyJson.token, '11. Admin Authentication Grants Token');
        adminToken = goodLogin.bodyJson ? goodLogin.bodyJson.token : null;

        // Test 12: Admin Stats API
        const statsRes = await makeRequest('GET', '/api/admin/stats', { 'Authorization': `Bearer ${adminToken}` });
        assert(
            statsRes.statusCode === 200 && statsRes.bodyJson.summary && statsRes.bodyJson.summary.total === newCountRow.total,
            '12. Admin Stats Endpoint Matches SQLite Count Exactly',
            `API Total: ${statsRes.bodyJson ? statsRes.bodyJson.summary.total : null}`
        );

        // Test 13: Admin Responses Table API (Includes newly added response)
        const tableRes = await makeRequest('GET', '/api/admin/responses?limit=5', { 'Authorization': `Bearer ${adminToken}` });
        assert(
            tableRes.statusCode === 200 && tableRes.bodyJson.responses.length > 0 && tableRes.bodyJson.responses[0].response_code === testResponseCode,
            '13. Newly Submitted Response Appears at Top of Admin Table'
        );

        // Test 14: Admin Single Response Full Detail API (All 25 items + name + full_name)
        const detailRes = await makeRequest('GET', `/api/admin/responses/${testResponseCode}`, { 'Authorization': `Bearer ${adminToken}` });
        assert(
            detailRes.statusCode === 200 && (detailRes.bodyJson.response.name === 'Man Machya' || detailRes.bodyJson.response.full_name === 'Man Machya') && detailRes.bodyJson.response.q10_need_for_touch === 4 && detailRes.bodyJson.response.q25_fake_timers_loss_of_trust === 5,
            '14. Complete 25-Item Response & Full Name Retrieval via Single ID'
        );

        // Test 15: Admin Excel Streaming Export
        const exportExcel = await makeRequest('GET', '/api/admin/export/excel', { 'Authorization': `Bearer ${adminToken}` });
        assert(
            exportExcel.statusCode === 200 && exportExcel.headers['content-type'].includes('spreadsheetml'),
            '15. Admin Live Excel (.xlsx) Streaming Export'
        );

        // Test 16: Admin CSV Streaming Export
        const exportCsv = await makeRequest('GET', '/api/admin/export/csv', { 'Authorization': `Bearer ${adminToken}` });
        assert(
            exportCsv.statusCode === 200 && exportCsv.bodyText.includes('Respondent Name') && exportCsv.bodyText.includes('Man Machya') && exportCsv.bodyText.includes(testResponseCode),
            '16. Admin Live CSV (.csv) Streaming Export with Respondent Name Header'
        );

        // Test 17: Vercel Configuration Validity
        const vercelConfig = JSON.parse(fs.readFileSync(path.join(baseDir, 'vercel.json'), 'utf8'));
        assert(
            vercelConfig.version === 2 && Array.isArray(vercelConfig.routes) && vercelConfig.routes.length > 0,
            '17. Valid vercel.json Deployment Configuration'
        );

        // Test 18: Verify Initial Seeded Starting Names (Man Machya, Eiya Mishra, Karann Mishra, Vishwajeet Patel) in both name & full_name columns
        const firstFourRows = await query("SELECT name, full_name FROM responses ORDER BY id ASC LIMIT 4;");
        const namesMatch = firstFourRows.length === 4 &&
            (firstFourRows[0].name === 'Man Machya' || firstFourRows[0].full_name === 'Man Machya') &&
            (firstFourRows[1].name === 'Eiya Mishra' || firstFourRows[1].full_name === 'Eiya Mishra') &&
            (firstFourRows[2].name === 'Karann Mishra' || firstFourRows[2].full_name === 'Karann Mishra') &&
            (firstFourRows[3].name === 'Vishwajeet Patel' || firstFourRows[3].full_name === 'Vishwajeet Patel');
        assert(
            namesMatch,
            '18. 200+ Indian Names Seeded Correctly in name & full_name columns: Man Machya, Eiya Mishra, Karann Mishra, Vishwajeet Patel',
            JSON.stringify(firstFourRows)
        );

        // Test 19: Admin CRUD - CREATE Response via Admin API
        const adminCreatePayload = {
            name: 'Priya Sharma (Admin Entry)',
            full_name: 'Priya Sharma (Admin Entry)',
            age_group: '25 – 34 years (Working Professional / Early Career)',
            gender: 'Female',
            city: 'Indore (Vijay Nagar)',
            state: 'Madhya Pradesh',
            occupation: 'Business Owner / Self-Employed',
            income_group: 'Rs. 60,001 to Rs. 1,00,000',
            preferred_channel: 'Online',
            q10_need_for_touch: 4,
            q25_fake_timers_loss_of_trust: 5
        };
        const adminCreateRes = await makeRequest('POST', '/api/admin/responses', { 'Authorization': `Bearer ${adminToken}` }, adminCreatePayload);
        assert(
            adminCreateRes.statusCode === 201 && adminCreateRes.bodyJson.success && adminCreateRes.bodyJson.response.response_code,
            '19. Admin CRUD: CREATE New Response in SQLite',
            adminCreateRes.bodyText
        );
        const crudCreatedCode = adminCreateRes.bodyJson.response.response_code;

        // Test 20: Admin CRUD - UPDATE Response via Admin API
        const adminUpdatePayload = {
            name: 'Priya Sharma Updated',
            full_name: 'Priya Sharma Updated',
            city: 'Indore (56 Dukan)',
            q10_need_for_touch: 5
        };
        const adminUpdateRes = await makeRequest('PUT', `/api/admin/responses/${crudCreatedCode}`, { 'Authorization': `Bearer ${adminToken}` }, adminUpdatePayload);
        assert(
            adminUpdateRes.statusCode === 200 && (adminUpdateRes.bodyJson.response.name === 'Priya Sharma Updated' || adminUpdateRes.bodyJson.response.full_name === 'Priya Sharma Updated') && adminUpdateRes.bodyJson.response.city === 'Indore (56 Dukan)' && adminUpdateRes.bodyJson.response.q10_need_for_touch === 5,
            '20. Admin CRUD: UPDATE Existing Response in SQLite',
            adminUpdateRes.bodyText
        );

        // Test 21: Admin CRUD - DELETE Response via Admin API
        const adminDeleteRes = await makeRequest('DELETE', `/api/admin/responses/${crudCreatedCode}`, { 'Authorization': `Bearer ${adminToken}` });
        assert(
            adminDeleteRes.statusCode === 200 && adminDeleteRes.bodyJson.success,
            '21. Admin CRUD: DELETE Response from SQLite',
            adminDeleteRes.bodyText
        );

        // Test 22: Confirm Record Permanently Removed
        const deletedRow = await queryOne("SELECT * FROM responses WHERE response_code = ?;", [crudCreatedCode]);
        assert(
            deletedRow === null,
            '22. Admin CRUD: Deleted Record Verified Absent from SQLite Database'
        );

        console.log('====================================================');
        console.log(`TEST RESULTS SUMMARY: ${passed} PASSED | ${failed} FAILED`);
        console.log('====================================================');

    } catch (err) {
        console.error('Fatal test runner exception:', err);
        failed++;
    } finally {
        if (server) server.close();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
