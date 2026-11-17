const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR lets a hosting platform point this at a mounted persistent disk
// (e.g. Render). Defaults to the local ./data folder for local dev and VPS use.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'blta-score.db'));
db.exec('PRAGMA journal_mode = WAL');
// node:sqlite enforces foreign keys by default (unlike the traditional
// sqlite3 CLI, where it's off unless requested) — cascading deletes here
// are always handled explicitly in application code instead, so enforcement
// isn't load-bearing, and leaving it on actively breaks the RENAME-based
// migrations below: SQLite refuses to DROP a table that another table's
// FK clause still points at (which every such migration produces, since
// SQLite auto-rewrites other tables' FK clauses to follow a rename), and
// with real rows in those child tables (e.g. real chat messages), that
// refusal is a hard constraint failure, not just a lint warning.
db.exec('PRAGMA foreign_keys = OFF');
// Exposed so anything else that needs to write to the persistent disk
// (e.g. uploaded badge icons) uses the same directory as the DB itself,
// rather than public/ which gets replaced fresh on every deploy.
db.dataDir = dataDir;

module.exports = {
  db,
};
