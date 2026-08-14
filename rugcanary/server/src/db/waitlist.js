const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertStmt = db.prepare('INSERT INTO waitlist (email) VALUES (?)');

function addEmail(email) {
  try {
    insertStmt.run(email);
    return { created: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { created: false, reason: 'already-subscribed' };
    }
    throw err;
  }
}

module.exports = { addEmail };
