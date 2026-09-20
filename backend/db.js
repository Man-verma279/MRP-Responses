// ==============================================================================
// DATABASE ABSTRACTION LAYER (backend/db.js)
// Supports local SQLite3 (sql.js / WASM) with zero native dependencies
// and persistent /tmp execution for Vercel serverless deployments.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const { syncCloudSubmissionsIntoSqlite } = require('./cloudPersistence');

// Candidate locations for database file
const BUNDLED_DB_LOCATIONS = [
    path.join(__dirname, 'research.sqlite3'),
    path.join(__dirname, '../database/research.sqlite3'),
    path.join(process.cwd(), 'database/research.sqlite3'),
    path.join(process.cwd(), 'research.sqlite3')
];

const SCHEMA_LOCATIONS = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '../database/schema.sql'),
    path.join(process.cwd(), 'database/schema.sql')
];

const WASM_LOCATIONS = [
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'sql-wasm.wasm')
];

// In serverless, only /tmp is writable
const ACTIVE_DB_PATH = isServerless 
    ? path.join('/tmp', 'research.sqlite3')
    : (process.env.DATABASE_PATH || path.join(__dirname, '../database/research.sqlite3'));

let dbInstance = null;
let SQL = null;

// Initialize Database Engine
async function getDb() {
    if (dbInstance) return dbInstance;

    // 1. Initialize sql.js WASM engine
    if (!SQL) {
        let wasmBinary = null;
        for (const loc of WASM_LOCATIONS) {
            if (fs.existsSync(loc)) {
                try {
                    wasmBinary = fs.readFileSync(loc);
                    break;
                } catch (e) {}
            }
        }
        if (wasmBinary) {
            SQL = await initSqlJs({ wasmBinary });
        } else {
            SQL = await initSqlJs();
        }
    }

    // 2. Ensure destination directory exists safely
    try {
        const dbDir = path.dirname(ACTIVE_DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
    } catch (e) {
        // Ignore read-only errors on serverless
    }

    // 3. If in serverless and active DB does not exist in /tmp, copy from bundled location
    if (isServerless && !fs.existsSync(ACTIVE_DB_PATH)) {
        for (const bundledLoc of BUNDLED_DB_LOCATIONS) {
            if (fs.existsSync(bundledLoc)) {
                try {
                    fs.copyFileSync(bundledLoc, ACTIVE_DB_PATH);
                    break;
                } catch (e) {}
            }
        }
    }

    // 4. Load database from disk or create in-memory
    if (fs.existsSync(ACTIVE_DB_PATH)) {
        try {
            const fileBuffer = fs.readFileSync(ACTIVE_DB_PATH);
            dbInstance = new SQL.Database(fileBuffer);
        } catch (e) {
            console.error('[DB] Failed to read existing database file:', e.message);
            dbInstance = new SQL.Database();
        }
    } else {
        let loaded = false;
        for (const bundledLoc of BUNDLED_DB_LOCATIONS) {
            if (fs.existsSync(bundledLoc)) {
                try {
                    const fileBuffer = fs.readFileSync(bundledLoc);
                    dbInstance = new SQL.Database(fileBuffer);
                    loaded = true;
                    persistToFile();
                    break;
                } catch (e) {}
            }
        }
        if (!loaded) {
            dbInstance = new SQL.Database();
            for (const schemaLoc of SCHEMA_LOCATIONS) {
                if (fs.existsSync(schemaLoc)) {
                    try {
                        const schemaSql = fs.readFileSync(schemaLoc, 'utf8');
                        dbInstance.exec(schemaSql);
                        persistToFile();
                        break;
                    } catch (e) {}
                }
            }
        }
    }

    // 5. Ensure admin user exists in the database
    try {
        const adminCheck = dbInstance.exec("SELECT id FROM admin_users WHERE username = 'admin';");
        if (!adminCheck || adminCheck.length === 0 || !adminCheck[0].values || adminCheck[0].values.length === 0) {
            const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
            dbInstance.run(
                "INSERT INTO admin_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?);",
                ['admin', defaultPass, 'MBA Research Controller (Man Machya)', 'superadmin']
            );
            persistToFile();
        }
    } catch (e) {
        // Safe check
    }

    // 6. Sync any live submissions from cloud store into SQLite
    try {
        const syncRes = await syncCloudSubmissionsIntoSqlite(dbInstance);
        if (syncRes && (syncRes.inserted > 0 || syncRes.updated > 0 || syncRes.deleted > 0)) {
            persistToFile();
        }
    } catch (syncErr) {
        console.warn('[DB] Sync warning:', syncErr.message);
    }

    return dbInstance;
}

// Persist SQLite WASM state to binary file on disk
function persistToFile() {
    if (!dbInstance) return;
    try {
        const data = dbInstance.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(ACTIVE_DB_PATH, buffer);
    } catch (err) {
        console.warn('[DB] Warning: Could not persist SQLite database to disk:', err.message);
    }
}

// Helper: Query multiple rows
async function query(sqlText, params = []) {
    const db = await getDb();
    const stmt = db.prepare(sqlText);
    
    // Bind parameters if provided
    if (params && params.length > 0) {
        stmt.bind(params);
    }

    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Helper: Query a single row
async function queryOne(sqlText, params = []) {
    const rows = await query(sqlText, params);
    return rows.length > 0 ? rows[0] : null;
}

// Helper: Run an INSERT, UPDATE, or DELETE
async function run(sqlText, params = []) {
    const db = await getDb();
    db.run(sqlText, params);
    persistToFile();

    // Get last insert rowid and changes
    const idRes = db.exec("SELECT last_insert_rowid() AS id;");
    const changesRes = db.exec("SELECT changes() AS changes;");
    
    const lastId = idRes[0] && idRes[0].values[0] ? idRes[0].values[0][0] : null;
    const changes = changesRes[0] && changesRes[0].values[0] ? changesRes[0].values[0][0] : 0;

    return { lastInsertRowid: lastId, changes: changes };
}

// Helper: Execute raw SQL script
async function exec(sqlScript) {
    const db = await getDb();
    db.exec(sqlScript);
    persistToFile();
    return true;
}

module.exports = {
    getDb,
    query,
    queryOne,
    run,
    exec,
    persistToFile,
    DB_PATH: ACTIVE_DB_PATH
};
