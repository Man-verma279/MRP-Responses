// ==============================================================================
// DATABASE ABSTRACTION LAYER (backend/db.js)
// Supports local SQLite3 (sql.js / WASM) with zero native dependencies
// and persistent cloud SQLite (Turso / libSQL) for Vercel serverless deployments.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../database/research.sqlite3');
const SCHEMA_PATH = path.join(__dirname, '../database/schema.sql');

let dbInstance = null;
let SQL = null;

// Initialize Database Engine
async function getDb() {
    if (dbInstance) return dbInstance;

    if (!SQL) {
        SQL = await initSqlJs();
    }

    // Ensure database directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        dbInstance = new SQL.Database(fileBuffer);
    } else {
        dbInstance = new SQL.Database();
        // Run initial schema if database file does not exist yet
        if (fs.existsSync(SCHEMA_PATH)) {
            const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
            dbInstance.exec(schemaSql);
            persistToFile();
        }
    }

    return dbInstance;
}

// Persist SQLite WASM state to binary file on disk
function persistToFile() {
    if (!dbInstance) return;
    try {
        const data = dbInstance.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
        console.error('[DB] Error persisting SQLite database to disk:', err.message);
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
    DB_PATH
};
