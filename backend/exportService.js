// ==============================================================================
// DATA EXPORT & SYNCHRONIZATION SERVICE (backend/exportService.js)
// Single source of truth: SQLite -> Synchronized to data/ and exports/
// ==============================================================================

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('./db');

const DATA_DIR = path.join(__dirname, '../data');
const EXPORTS_DIR = path.join(__dirname, '../exports');

// Friendly Excel Column Headers mapping
const COLUMN_HEADERS = [
    { key: 'response_code', title: 'Response ID' },
    { key: 'full_name', title: 'Respondent Name' },
    { key: 'submitted_at', title: 'Submission Date & Time' },
    { key: 'state', title: 'State' },
    { key: 'city', title: 'City' },
    { key: 'region_classification', title: 'Region Classification' },
    { key: 'age_group', title: 'Age Group' },
    { key: 'gender', title: 'Gender' },
    { key: 'occupation', title: 'Occupation' },
    { key: 'income_group', title: 'Monthly Income Group' },
    { key: 'q07_online_impulse_freq', title: 'Q07: Online Impulse Freq' },
    { key: 'q08_offline_impulse_freq', title: 'Q08: Offline Impulse Freq' },
    { key: 'q09_avg_unplanned_spend', title: 'Q09: Typical Unplanned Spend' },
    { key: 'preferred_channel', title: 'Preferred Shopping Mode' },
    { key: 'q10_need_for_touch', title: 'Q10: Need for Touch (1-5)' },
    { key: 'q11_visual_displays', title: 'Q11: In-Store Displays (1-5)' },
    { key: 'q12_checkout_placement', title: 'Q12: Cashier Counter Impulse (1-5)' },
    { key: 'q13_salesperson_advice', title: 'Q13: Salesperson Influence (1-5)' },
    { key: 'q14_ai_recommendations', title: 'Q14: AI Personalization (1-5)' },
    { key: 'q15_countdown_timers', title: 'Q15: Countdown Urgency (1-5)' },
    { key: 'q16_scarcity_fomo', title: 'Q16: Stock Scarcity FOMO (1-5)' },
    { key: 'q17_social_proof_reviews', title: 'Q17: Social Proof Reviews (1-5)' },
    { key: 'q18_push_notifications', title: 'Q18: Push Notification Alerts (1-5)' },
    { key: 'q19_primary_payment_mode', title: 'Q19: Primary Payment Method' },
    { key: 'q20_upi_pain_reduction', title: 'Q20: UPI Pain of Paying (1-5)' },
    { key: 'q21_bnpl_spend_encouragement', title: 'Q21: BNPL Spend Lift (1-5)' },
    { key: 'q22_online_impulse_regret', title: 'Q22: Online Impulse Regret (1-5)' },
    { key: 'q23_offline_satisfaction', title: 'Q23: Offline Satisfaction (1-5)' },
    { key: 'q24_return_exchange_freq', title: 'Q24: Online Return Frequency (1-5)' },
    { key: 'q25_fake_timers_loss_of_trust', title: 'Q25: Deceptive Urgency Trust Loss (1-5)' },
    { key: 'data_source', title: 'Data Integrity Source Tag' }
];

// Ensure directories exist
function ensureDirs() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    } catch (e) {
        // Read-only filesystem in serverless
    }
});
    if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Convert an array of row objects into formatted dataset array with human-readable headers
function formatRowsForExport(rows) {
    return rows.map(r => {
        const rowObj = {};
        COLUMN_HEADERS.forEach(col => {
            let val = r[col.key];
            if ((val === undefined || val === null || val === '') && (col.key === 'full_name' || col.key === 'name')) {
                val = r.name || r.full_name || 'Anonymous Respondent';
            }
            rowObj[col.title] = val !== undefined && val !== null ? val : '';
        });
        return rowObj;
    });
}

// Synchronize all genuine SQLite responses into data/raw_responses.xlsx & data/raw_responses.csv
async function syncRawResponsesFiles() {
    ensureDirs();
    
    // Fetch ONLY real participant responses (is_demo = 0)
    const rows = await query(
        "SELECT * FROM responses WHERE is_demo = 0 ORDER BY id ASC;"
    );

    const formattedData = formatRowsForExport(rows);

    // 1. Write CSV
    const csvPath = path.join(DATA_DIR, 'raw_responses.csv');
    if (formattedData.length === 0) {
        // Write header only
        const headersOnly = COLUMN_HEADERS.map(c => '"' + c.title + '"').join(',');
        fs.writeFileSync(csvPath, headersOnly + '\n', 'utf8');
    } else {
        const ws = XLSX.utils.json_to_sheet(formattedData);
        const csvContent = XLSX.utils.sheet_to_csv(ws);
        fs.writeFileSync(csvPath, csvContent, 'utf8');
    }

    // 2. Write Excel XLSX
    const xlsxPath = path.join(DATA_DIR, 'raw_responses.xlsx');
    const latestXlsxPath = path.join(EXPORTS_DIR, 'latest_responses.xlsx');

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formattedData.length > 0 ? formattedData : [
        COLUMN_HEADERS.reduce((acc, c) => { acc[c.title] = ''; return acc; }, {})
    ]);

    // Set column widths
    const colWidths = COLUMN_HEADERS.map(c => ({ wch: Math.max(c.title.length + 2, 14) }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Real_Responses');
    XLSX.writeFile(wb, xlsxPath);
    XLSX.writeFile(wb, latestXlsxPath);

    console.log(`[EXPORT] Synchronized ${rows.length} real responses to:`);
    console.log(`  - ${xlsxPath}`);
    console.log(`  - ${csvPath}`);
    console.log(`  - ${latestXlsxPath}`);

    return { totalReal: rows.length, xlsxPath, csvPath };
}

// Build Excel buffer on the fly for HTTP streaming downloads
function buildExcelBuffer(rows, sheetName = 'Survey_Responses', title = null) {
    const formattedData = formatRowsForExport(rows);
    const wb = XLSX.utils.book_new();
    
    let ws;
    if (title) {
        // Add a title banner row
        const dataWithTitle = [
            { [COLUMN_HEADERS[0].title]: title },
            ...formattedData
        ];
        ws = XLSX.utils.json_to_sheet(dataWithTitle);
    } else {
        ws = XLSX.utils.json_to_sheet(formattedData);
    }

    const colWidths = COLUMN_HEADERS.map(c => ({ wch: Math.max(c.title.length + 2, 14) }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Build CSV string on the fly for HTTP streaming downloads
function buildCsvString(rows) {
    const formattedData = formatRowsForExport(rows);
    if (formattedData.length === 0) {
        return COLUMN_HEADERS.map(c => `"${c.title}"`).join(',') + '\n';
    }
    const ws = XLSX.utils.json_to_sheet(formattedData);
    return XLSX.utils.sheet_to_csv(ws);
}

// Generate demo_data.xlsx with explicit synthetic disclaimer
function writeDemoDataFile(demoRows) {
    ensureDirs();
    const demoPath = path.join(DATA_DIR, 'demo_data.xlsx');
    const formattedData = formatRowsForExport(demoRows);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formattedData);

    const colWidths = COLUMN_HEADERS.map(c => ({ wch: Math.max(c.title.length + 2, 14) }));
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'SYNTHETIC_DEMO_BENCHMARK');
    XLSX.writeFile(wb, demoPath);
    console.log(`[EXPORT] Created demo_data.xlsx with ${demoRows.length} benchmark records at: ${demoPath}`);
}

module.exports = {
    syncRawResponsesFiles,
    buildExcelBuffer,
    buildCsvString,
    writeDemoDataFile,
    COLUMN_HEADERS
};
