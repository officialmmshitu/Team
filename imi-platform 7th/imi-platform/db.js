'use strict';
/**
 * Opens the platform database (SQLite), applies any pending migrations (see migrate.js and migrations/),
 * and exposes the connection. Starting the server never resets, re-creates or re-seeds data:
 * it only creates what is missing, once, and records that in the schema_migrations table.
 */
require('./env');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_FILE } = require('./paths');
const constants = require('./constants');
const migrate = require('./migrate');
const { redact } = require('./safe');

for (const d of [DATA_DIR, path.dirname(DB_FILE), path.join(DATA_DIR, 'files'), path.join(DATA_DIR, 'uploads')]) fs.mkdirSync(d, { recursive: true });
try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch (e) { throw new Error('DATA_DIR is not writable by this process. Check the folder permissions or the DATA_DIR setting.'); }

const existed = fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0;
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');   // FULL: a committed change survives a crash or power loss

let dbInfo;
try {
  dbInfo = migrate.apply(db, { dataDir: DATA_DIR, dbFile: DB_FILE, existed, auto: process.env.AUTO_MIGRATE !== '0', log: (m) => console.log(m), error: (m) => console.error(redact(m)) });
} catch (e) { console.error('[db] ' + redact(e.message)); process.exit(1); }

module.exports = Object.assign({ db, DATA_DIR, DB_FILE, dbInfo }, constants);
