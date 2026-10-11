'use strict';
// Usage: npm run backup
// Writes a consistent copy of the database plus the deal files and uploaded images to
//   <DATA_DIR>/backups/imi-backup-YYYYMMDD-HHMMSS/
// Safe to run while the server is running. Copy that folder somewhere OFF the server (another disk or cloud storage).
// To restore: stop the server, put imi.db, files/ and uploads/ back into the data folder, start the server.
require('../env');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_FILE } = require('../paths');
const { redact } = require('../safe');

if (!fs.existsSync(DB_FILE)) { console.error(`No database found at ${DB_FILE}. Nothing to back up.`); process.exit(1); }
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const dest = path.join(DATA_DIR, 'backups', `imi-backup-${stamp}`);
try {
  fs.mkdirSync(dest, { recursive: true });
  const db = new DatabaseSync(DB_FILE); db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`VACUUM INTO '${path.join(dest, 'imi.db').replace(/'/g, "''")}'`); db.close();
  for (const d of ['files', 'uploads']) if (fs.existsSync(path.join(DATA_DIR, d))) fs.cpSync(path.join(DATA_DIR, d), path.join(dest, d), { recursive: true });
  const size = (p) => { let n = 0; for (const f of fs.readdirSync(p, { withFileTypes: true })) n += f.isDirectory() ? size(path.join(p, f.name)) : fs.statSync(path.join(p, f.name)).size; return n; };
  console.log(`Backup written: ${dest}`);
  console.log(`  imi.db, files/, uploads/   (${(size(dest) / 1024).toFixed(0)} KB)`);
  console.log('Now copy this folder to storage OUTSIDE the server. A backup kept on the same disk does not protect you from losing the disk.');
} catch (e) { console.error('Backup failed: ' + redact(e.message)); process.exit(1); }
