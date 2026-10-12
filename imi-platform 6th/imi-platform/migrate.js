'use strict';
/**
 * Versioned database migrations for the SQLite database.
 *  - Applied migrations are recorded in the schema_migrations table, each one inside a transaction.
 *  - Before the first pending migration touches a database that already holds accounts, a consistent backup copy
 *    is written to <DATA_DIR>/backups/ (VACUUM INTO). Existing data is never reset, deleted or re-seeded.
 *  - If the database was upgraded by a NEWER release (it knows migrations this code does not), the server refuses
 *    to start rather than risk damaging data after a rollback.
 *  - Set AUTO_MIGRATE=0 to stop the server from migrating on start; run `npm run migrate` yourself instead.
 */
const fs = require('node:fs');
const path = require('node:path');
const MIGRATIONS = [require('./migrations/001_baseline'), require('./migrations/002_meta')];

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
function ensureTable(db) { db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'); }

function status(db) {
  ensureTable(db);
  const applied = db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id').all();
  const known = new Set(MIGRATIONS.map((m) => m.id)), done = new Set(applied.map((a) => a.id));
  return { applied, pending: MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id), unknown: applied.filter((a) => !known.has(a.id)).map((a) => a.id) };
}
const hasAccounts = (db) => { try { return db.prepare('SELECT count(*) n FROM users').get().n > 0; } catch (e) { return false; } };

/** A consistent snapshot of the database file (safe while the server is running). */
function backupDatabase(db, dataDir, label) {
  const dir = path.join(dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-${stamp()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function apply(db, ctx) {
  const log = ctx.log || (() => {}), st = status(db);
  if (st.unknown.length) throw new Error(`The database contains migrations this release does not know (${st.unknown.join(', ')}). It was probably upgraded by a newer release. Refusing to start so your data is not damaged. Deploy the newer release, or restore a backup.`);
  let backup = null;
  if (st.pending.length) {
    if (ctx.auto === false) throw new Error(`${st.pending.length} database migration(s) are pending (${st.pending.join(', ')}). Run: npm run migrate`);
    if (ctx.existed && hasAccounts(db)) { backup = backupDatabase(db, ctx.dataDir, 'pre-migrate'); log(`[db] backup written before migrating: backups/${path.basename(backup)}`); }
    for (const m of MIGRATIONS) {
      if (!st.pending.includes(m.id)) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(m.id)) { db.exec('ROLLBACK'); continue; }   // another process got there first
        m.up(db, ctx);
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
        db.exec('COMMIT');
        log(`[db] applied migration ${m.id}`);
      } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* already rolled back */ } throw new Error(`Migration ${m.id} failed and was rolled back: ${e.message}`); }
    }
  }
  const meta = (k) => { try { return (db.prepare('SELECT value FROM meta WHERE key = ?').get(k) || {}).value || null; } catch (e) { return null; } };
  return { applied: db.prepare('SELECT count(*) n FROM schema_migrations').get().n, instanceId: meta('instance_id'), firstSeenAt: meta('first_seen_at'), wasNew: !ctx.existed, users: hasAccounts(db) ? db.prepare('SELECT count(*) n FROM users').get().n : 0, backup };
}
module.exports = { apply, status, backupDatabase, MIGRATIONS };
