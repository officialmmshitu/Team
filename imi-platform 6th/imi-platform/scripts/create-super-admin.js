'use strict';
// Usage: npm run create-super-admin -- "Your Name" you@company.com 'a-long-password'
// Creates the account (or upgrades an existing one) and makes it a super admin with Control Centre access.
require('../env');
const crypto = require('node:crypto');
const { db, ROLE_PRESETS, DB_FILE } = require('../db');
const { hashPassword } = require('../password');

// Windows Command Prompt passes quotes through literally, so strip one matching pair around each value
const unq = (v) => (v == null ? v : v.replace(/^(['"])(.*)\1$/, '$2'));
const [name, email, password] = process.argv.slice(2).map(unq);
if (!name || !email || !password || password.length < 10) {
  console.error('Usage: create-super-admin "<name>" <email> <password (10+ chars)>');
  process.exit(1);
}
(async () => {
  const hash = await hashPassword(password);
  const ts = new Date().toISOString(), e = email.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(e);
  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE users SET password_hash = ?, status = 'active', deleted_at = NULL, verified_at = COALESCE(verified_at, ?),
      access = json_set(access, '$.main_platform', json('true'), '$.crm', json('true'), '$.admin_dashboard', json('true'), '$.api', json('true')), updated_at = ? WHERE id = ?`).run(hash, ts, ts, id);
  } else {
    id = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, name, email, password_hash, status, access, created_at, updated_at, verified_at)
      VALUES (?,?,?,?, 'active', '{"main_platform":true,"crm":true,"admin_dashboard":true,"api":true}', ?,?,?)`).run(id, name, e, hash, ts, ts, ts);
  }
  db.prepare(`INSERT INTO staff (user_id, role, permissions, created_at) VALUES (?, 'super_admin', ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', permissions = excluded.permissions, status = 'active'`).run(id, JSON.stringify(ROLE_PRESETS.super_admin), ts);
  console.log(`Super admin ready: ${e}`);
  console.log(existing ? `NOTE: this email already had an account. Its password is now the one you just typed (the old password no longer works).` : 'A new account was created.');
  console.log(`Database used: ${DB_FILE}`);
  console.log(`Next: restart the server if it is running, open the site, log in as ${e}, and look for "Control Centre" in the left sidebar.`);
  console.log(`Not showing? Run:  npm run check-admin -- ${e}`);
})();
