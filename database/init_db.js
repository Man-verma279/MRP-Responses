// ==============================================================================
// DATABASE INITIALIZATION SCRIPT (database/init_db.js)
// ==============================================================================

const fs = require('fs');
const path = require('path');
const { getDb, exec, query, run } = require('../backend/db');

async function initDatabase() {
    console.log('[INIT] Initializing SQLite database for Research Survey App...');
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        throw new Error('Schema file not found at: ' + schemaPath);
    }

    // Migration: Ensure full_name and name columns exist if table was created previously
    try {
        await exec("ALTER TABLE responses ADD COLUMN full_name TEXT NOT NULL DEFAULT 'Anonymous Respondent';");
    } catch (e) {
        // column already exists or table not yet created
    }
    try {
        await exec("ALTER TABLE responses ADD COLUMN name TEXT NOT NULL DEFAULT 'Anonymous Respondent';");
    } catch (e) {
        // column already exists or table not yet created
    }
    try {
        await exec("UPDATE responses SET name = full_name WHERE (name IS NULL OR name = '' OR name = 'Anonymous Respondent') AND full_name IS NOT NULL AND full_name != 'Anonymous Respondent';");
        await exec("UPDATE responses SET full_name = name WHERE (full_name IS NULL OR full_name = '' OR full_name = 'Anonymous Respondent') AND name IS NOT NULL AND name != 'Anonymous Respondent';");
    } catch (e) {
        // table not yet created or column sync failed
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await exec(schemaSql);
    console.log('[INIT] Database schema executed successfully.');

    // Check if default admin exists
    const existingAdmin = await query("SELECT id, username FROM admin_users WHERE username = 'admin';");
    if (existingAdmin.length === 0) {
        // Plain text / standard token hash for demo simplicity or crypto hash
        const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
        await run(
            "INSERT INTO admin_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?);",
            ['admin', defaultPassword, 'MBA Research Controller (Man Machya)', 'superadmin']
        );
        console.log('[INIT] Default admin created (username: admin, password: ' + defaultPassword + ')');
    } else {
        console.log('[INIT] Admin user already present.');
    }

    // Report table stats
    const respCount = await query("SELECT COUNT(*) AS count FROM responses;");
    console.log('[INIT] Responses table ready. Current record count: ' + respCount[0].count);
    console.log('[INIT] Database initialization complete!');
}

if (require.main === module) {
    initDatabase().catch(err => {
        console.error('[INIT] Failed to initialize database:', err);
        process.exit(1);
    });
}

module.exports = { initDatabase };
