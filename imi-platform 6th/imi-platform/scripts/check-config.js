'use strict';
// Usage: npm run check-config
// Audits the CURRENT settings (from .env and the environment) for a production deployment.
// It never prints secret values: only whether they are set. Exit code 1 if anything is marked FAIL.
require('../env');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_FILE, DATA_IN_APP_DIR } = require('../paths');
const migrate = require('../migrate');
const e = process.env, prod = e.NODE_ENV === 'production';
const rows = []; const add = (level, msg) => rows.push([level, msg]);
const set = (k) => !!(e[k] && String(e[k]).trim());

add(prod ? 'PASS' : 'WARN', prod ? 'NODE_ENV=production' : `NODE_ENV is "${e.NODE_ENV || 'not set'}" (use production on the live server)`);
if (!set('APP_URL')) add(prod ? 'FAIL' : 'WARN', 'APP_URL is not set (emailed links would point at localhost)');
else add(/^https:\/\//.test(e.APP_URL) ? 'PASS' : (prod ? 'FAIL' : 'WARN'), /^https:\/\//.test(e.APP_URL) ? 'APP_URL uses https' : 'APP_URL is not https');
add(e.TRUST_PROXY === '1' ? 'PASS' : 'WARN', e.TRUST_PROXY === '1' ? 'TRUST_PROXY=1 (client IPs read from the proxy)' : 'TRUST_PROXY is not 1. Set it to 1 if a proxy or load balancer sits in front, otherwise rate limits see the proxy, not people');
add(set('RESEND_API_KEY') && set('MAIL_FROM') ? 'PASS' : (prod ? 'FAIL' : 'WARN'), set('RESEND_API_KEY') && set('MAIL_FROM') ? 'Email provider is configured (RESEND_API_KEY, MAIL_FROM set)' : 'Email is not configured: confirmation, reset and invitation emails cannot be delivered');
add(e.REQUIRE_EMAIL_VERIFICATION === '0' ? 'WARN' : 'PASS', e.REQUIRE_EMAIL_VERIFICATION === '0' ? 'Email confirmation is switched OFF' : 'Email confirmation is on');
add(e.AUTO_MIGRATE === '0' ? 'PASS' : 'WARN', e.AUTO_MIGRATE === '0' ? 'AUTO_MIGRATE=0 (migrations run only when you run npm run migrate)' : 'AUTO_MIGRATE is on (the server migrates on start). Fine for one server; set 0 to control it yourself');
// data folder
add(DATA_IN_APP_DIR ? (prod ? 'FAIL' : 'WARN') : 'PASS', DATA_IN_APP_DIR ? 'DATA_DIR is inside the application folder (many hosts erase that on every deploy). Mount a persistent volume and set DATA_DIR' : 'DATA_DIR is outside the application folder');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); add('PASS', 'DATA_DIR is writable'); } catch (x) { add('FAIL', 'DATA_DIR is not writable'); }
// database
let adminState = 'unknown';
if (fs.existsSync(DB_FILE)) {
  try {
    const db = new DatabaseSync(DB_FILE, { readOnly: true }); const st = migrate.status ? (() => { try { return { applied: db.prepare('SELECT id FROM schema_migrations').all(), pending: migrate.MIGRATIONS.map((m) => m.id) }; } catch (x) { return null; } })() : null;
    const users = (() => { try { return db.prepare('SELECT count(*) n FROM users').get().n; } catch (x) { return 0; } })();
    const applied = st ? st.applied.map((a) => a.id) : [], pend = st ? st.pending.filter((id) => !applied.includes(id)) : [];
    add(pend.length ? 'WARN' : 'PASS', pend.length ? `${pend.length} migration(s) pending: run npm run migrate` : 'Database migrations are up to date');
    add('PASS', `Database found with ${users} account(s)`);
    try { adminState = db.prepare("SELECT count(*) n FROM staff WHERE role = 'super_admin'").get().n ? 'exists' : 'none'; } catch (x) { adminState = 'none'; }
    db.close();
  } catch (x) { add('FAIL', 'The database file exists but cannot be read'); }
} else add('WARN', 'No database yet. It is created on first start (run npm run migrate to create it now)');
if (adminState === 'none' || adminState === 'unknown') add(set('SUPER_ADMIN_EMAIL') && set('SUPER_ADMIN_PASSWORD') ? 'PASS' : (prod && String(e.SETUP_CODE || '').length >= 12 ? 'PASS' : 'WARN'), 'No super admin exists yet: ' + (set('SUPER_ADMIN_EMAIL') && set('SUPER_ADMIN_PASSWORD') ? 'SUPER_ADMIN_* will create it on first start' : (String(e.SETUP_CODE || '').length >= 12 ? 'SETUP_CODE is set for browser setup' : 'set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD, or SETUP_CODE (12+ chars)')));
else add(set('SUPER_ADMIN_PASSWORD') ? 'WARN' : 'PASS', set('SUPER_ADMIN_PASSWORD') ? 'An admin already exists but SUPER_ADMIN_PASSWORD is still set. Remove it from your settings' : 'A super admin exists and SUPER_ADMIN_PASSWORD is not left in the settings');
if (set('SETUP_CODE') && String(e.SETUP_CODE).length < 12 && prod) add('WARN', 'SETUP_CODE is shorter than 12 characters (ignored in production)');
// .env file
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && process.platform !== 'win32') add((fs.statSync(envFile).mode & 0o077) ? 'WARN' : 'PASS', (fs.statSync(envFile).mode & 0o077) ? '.env is readable by other users: run chmod 600 .env' : '.env is private to its owner');

const mark = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' };
for (const [l, m] of rows) console.log(`  ${mark[l]}  ${m}`);
const fails = rows.filter((r) => r[0] === 'FAIL').length, warns = rows.filter((r) => r[0] === 'WARN').length;
console.log(`\n${fails ? fails + ' problem(s) must be fixed before going live.' : 'No blocking problems.'}${warns ? ` ${warns} warning(s) worth reading.` : ''}`);
process.exit(fails ? 1 : 0);
