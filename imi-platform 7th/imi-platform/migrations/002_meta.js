'use strict';
/**
 * 002_meta: a small key/value table. It records a random instance id the first time a database is seen by the
 * versioned migration system. The id never changes afterwards, so comparing it before and after a redeploy
 * (see GET /healthz) shows whether the SAME database survived.
 */
const crypto = require('node:crypto');
module.exports = {
  id: '002_meta',
  up(db) {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const ins = db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');
    ins.run('instance_id', crypto.randomUUID());
    ins.run('first_seen_at', new Date().toISOString());
  },
};
