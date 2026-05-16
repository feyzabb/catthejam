/**
 * db.js — SQLite database singleton.
 * Uses better-sqlite3 for synchronous, fast access.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure the database directory exists
const dbDir = path.dirname(path.resolve(config.DB_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create or open the database
const db = new Database(path.resolve(config.DB_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Run schema migration on startup
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

console.log('[DB] SQLite database initialized at', config.DB_PATH);

module.exports = db;
