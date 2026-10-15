'use strict';
/**
 * Prototype / test-run mode support.
 *
 * It is switched on ONLY by `npm run prototype` (scripts/prototype.js sets a flag on `globalThis` before the server loads).
 * It is never read from an environment variable or from .env, so a setting on a production server cannot enable it,
 * and it refuses to be active when NODE_ENV is production.
 *
 * What it adds: a "PROTOTYPE MODE" ribbon on every page, and a panel of one-click demo logins on the sign-in card
 * (shown only when the sandbox holds the demo accounts).
 */
const active = globalThis.IMI_PROTOTYPE === true && process.env.NODE_ENV !== 'production';
const PASSWORD = 'Demo-Password-123';
const DEMO = [
  ['Super admin', 'superadmin@prototype.test'], ['Admin', 'admin@prototype.test'], ['Community manager (Manage users only)', 'community@prototype.test'],
  ['Content manager (listings)', 'content@prototype.test'], ['Developer (reports only)', 'developer@prototype.test'],
  ['Member: Daniel (owns the Acme deal)', 'daniel@prototype.test'], ['Member: Fatima (marketing lead)', 'fatima@prototype.test'],
  ['Member: Chinedu (sales)', 'chinedu@prototype.test'], ['Member: Aisha (community)', 'aisha@prototype.test'], ['Member: Gabriel (plain member)', 'guest.member@prototype.test'],
].map(([role, email]) => ({ role, email }));

function seeded() {
  try { return !!require('./db').db.prepare('SELECT 1 FROM users WHERE email = ?').get('superadmin@prototype.test'); } catch (e) { return false; }
}
function inject(html) {
  if (!active) return html;
  const demo = seeded() ? JSON.stringify(DEMO).replace(/</g, '\\u003c') : '[]';
  const snippet = `<style>#imi-proto{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:#7c3aed;color:#fff;font:600 12px system-ui,sans-serif;padding:7px 13px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.45);opacity:.94;pointer-events:none}
#imi-demo{margin-top:16px;padding:12px;border:1px dashed rgba(167,139,250,.65);border-radius:12px;background:rgba(124,58,237,.09);font-size:12px;text-align:left}#imi-demo b{display:block;margin-bottom:8px;color:#c4b5fd;font-weight:600}#imi-demo button{display:block;width:100%;text-align:left;margin:4px 0;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font:inherit}#imi-demo button:hover{border-color:#a78bfa}</style>
<script>(function(){var D=${demo},PW=${JSON.stringify(PASSWORD)};function go(){var r=document.createElement('div');r.id='imi-proto';r.textContent='PROTOTYPE MODE \\u00b7 test data only';document.body.appendChild(r);var f=document.getElementById('loginForm');if(!f||!D.length||document.getElementById('imi-demo'))return;var p=document.createElement('div');p.id='imi-demo';p.innerHTML='<b>Prototype demo logins (password: '+PW+')</b>';D.forEach(function(u){var b=document.createElement('button');b.type='button';b.textContent=u.role+'  \\u00b7  '+u.email;b.onclick=function(){document.getElementById('email').value=u.email;document.getElementById('password').value=PW;f.requestSubmit();};p.appendChild(b);});f.appendChild(p);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();</script>`;
  return html.includes('</body>') ? html.replace('</body>', snippet + '</body>') : html + snippet;
}
module.exports = { active, inject, PASSWORD, DEMO };
