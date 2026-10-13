'use strict';
// Usage: npm run check-admin -- you@company.com
// Explains, step by step, whether an account can open the Control Centre and what to fix if not.
require('../env');
const { db, DB_FILE } = require('../db');
const email = (process.argv[2] || '').replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
if (!email) { console.error('Usage: check-admin <email>'); process.exit(1); }
const J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const line = (ok, msg) => console.log((ok ? '  OK    ' : '  FIX   ') + msg);
console.log(`Database: ${DB_FILE}`);
console.log(`Users in this database: ${db.prepare('SELECT count(*) n FROM users').get().n}`);
const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
if (!u) {
  line(false, `No account with ${email} in THIS database. Either the email is different, or the server is using another data folder (a new unzip has an empty one). Run: npm run create-super-admin -- "Your Name" ${email} "a-long-password"`);
  process.exit(0);
}
const a = J(u.access, {}), s = db.prepare('SELECT * FROM staff WHERE user_id = ?').get(u.id);
let good = true; const chk = (ok, yes, no) => { line(ok, ok ? yes : no); if (!ok) good = false; };
chk(!u.deleted_at, 'account exists', 'account was deleted. Run create-super-admin to restore it');
chk(u.status === 'active', 'account is active', `account status is "${u.status}". Run create-super-admin, or reactivate it in Accounts`);
chk(!!u.verified_at, 'email is confirmed', 'email not confirmed yet. Open the confirmation link, or run create-super-admin');
chk(!!s, `manager record found (role: ${s && s.role})`, 'this account is NOT a platform manager. Run: npm run create-super-admin -- "Name" ' + email + ' "a-long-password"');
if (s) chk(s.status === 'active', 'manager status is active', `manager status is "${s.status}". Set it back to active in Managers`);
chk(!!a.admin_dashboard, 'Admin dashboard access flag is ON', 'Admin dashboard access flag is OFF for this account');
console.log(good ? '\nThis account can open the Control Centre. Log out and back in, then look for "Control Centre" in the sidebar.\nStill nothing? You may be on the single-file preview (it has no Control Centre) or an older copy of the server: stop it, start this version, and hard-refresh the page.' : '\nFix the lines marked FIX, then log out and back in.');
