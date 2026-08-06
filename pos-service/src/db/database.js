const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const env = require('../config/env');

let db;

function getDatabase() {
  if (db) return db;
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  db = new Database(env.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  return db;
}

module.exports = { getDatabase };
