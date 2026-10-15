'use strict';
// Usage:
//   npm run migrate           apply any pending database migrations
//   npm run migrate:status    show what is applied and what is pending (changes nothing)
// Existing data is never reset or re-seeded. If the database already holds accounts, a backup is written first.
require('../env');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_FILE } = require('../paths');
const migrate = require('../migrate');
const { redact } = require('../safe');

const statusOnly = process.argv.includes('--status');
if (statusOnly && !fs.existsSync(DB_FILE)) { console.log(`No database yet at the configured location (${path.basename(DB_FILE)} in ${DATA_DIR}). Run: npm run migrate`); process.exit(0); }
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const existed = fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0;
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
try {
  if (statusOnly) {
    const st = migrate.status(db);
    console.log(`Database: ${DB_FILE}`);
    st.applied.forEach((a) => console.log(`  applied   ${a.id}   ${a.applied_at}`));
    st.pending.forEach((id) => console.log(`  PENDING   ${id}`));
    st.unknown.forEach((id) => console.log(`  UNKNOWN   ${id}   (applied by a newer release)`));
    console.log(st.pending.length ? `\n${st.pending.length} pending. Run: npm run migrate` : st.unknown.length ? '\nThe database is ahead of this release.' : '\nUp to date.');
  } else {
    const info = migrate.apply(db, { dataDir: DATA_DIR, dbFile: DB_FILE, existed, auto: true, log: (m) => console.log(m) });
    console.log(`Done. ${info.applied} migrations applied in total. ${info.users} account(s) in the database.`);
  }
} catch (e) { console.error(redact(e.message)); process.exit(1); } finally { db.close(); }
