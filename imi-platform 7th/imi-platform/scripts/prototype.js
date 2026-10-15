'use strict';
// Usage:
//   npm run prototype            start the prototype sandbox (first start fills it with a sample world)
//   npm run prototype:empty      start an EMPTY sandbox, to practise the first-run "Set up the admin account" flow
//   npm run prototype:reset      wipe the sandbox (see scripts/prototype-reset.js)
//
// The sandbox is completely separate from your real data: it uses ./data-prototype and nothing else.
const path = require('node:path');
if (process.env.NODE_ENV === 'production') { console.error('Prototype mode refuses to run when NODE_ENV=production. It is for testing only.'); process.exit(1); }
const root = path.join(__dirname, '..'), empty = process.argv.includes('--empty');
// These are set BEFORE .env is read, so nothing in .env or the shell can point the sandbox at real data or real email.
Object.assign(process.env, { NODE_ENV: 'development', DATA_DIR: path.join(root, 'data-prototype'), DB_FILE: '', AUTO_MIGRATE: '1', SUPER_ADMIN_EMAIL: '', SUPER_ADMIN_PASSWORD: '', SUPER_ADMIN_NAME: '', SETUP_CODE: '', RESEND_API_KEY: '', MAIL_FROM: '', APP_URL: '', TRUST_PROXY: '0' });
globalThis.IMI_PROTOTYPE = true;
globalThis.IMI_PROTOTYPE_EMPTY = empty;
require('../env');
const PORT = Number(process.env.PORT) || 4000, base = `http://127.0.0.1:${PORT}`;
console.log('\n=== PROTOTYPE MODE: sandbox data folder is data-prototype/ (your real data is not touched) ===\n');
require('../server.js');
{ const fs = require('node:fs'), pidFile = path.join(process.env.DATA_DIR, '.prototype.pid');   // lets `prototype:reset` know the sandbox is in use
  try { fs.writeFileSync(pidFile, String(process.pid)); process.on('exit', () => { try { fs.rmSync(pidFile, { force: true }); } catch (e) { /* ignore */ } }); } catch (e) { /* not critical */ } }
(async () => {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 150)); }
  const { db } = require('../db'), { PASSWORD, DEMO } = require('../prototype');
  const fresh = db.prepare('SELECT count(*) n FROM users').get().n === 0;
  if (fresh && !empty) {
    const t0 = Date.now(); globalThis.IMI_SEEDING = true;
    try { await require('./prototype-seed').seed(base, (m) => console.log('[prototype] ' + m)); console.log(`[prototype] sample world created in ${((Date.now() - t0) / 1000).toFixed(1)}s`); }
    catch (e) { console.error('[prototype] seeding failed: ' + e.message + '\n[prototype] Fix the problem, then run: npm run prototype:reset -- --yes'); }
  }
  globalThis.IMI_SEEDING = false;
  const seeded = !!db.prepare("SELECT 1 FROM users WHERE email = 'superadmin@prototype.test'").get();
  console.log(`\n[prototype] ready: open http://localhost:${PORT}`);
  if (seeded) { console.log(`[prototype] every demo account uses the password ${PASSWORD}`); DEMO.forEach((d) => console.log(`            ${d.email.padEnd(32)} ${d.role}`)); console.log('[prototype] the sign-in page has one-click buttons for these logins.'); }
  else console.log('[prototype] the sandbox is empty: the sign-in card offers "Set up the admin account" so you can test the first-run flow.');
  console.log('[prototype] wipe the sandbox any time with: npm run prototype:reset -- --yes   (stop the server first)\n');
})();
