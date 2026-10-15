'use strict';
/**
 * IMI Platform server. No npm dependencies; needs Node >= 22.13 (built-in SQLite).
 *   GET  /                    homepage (public)          GET /healthz   health check
 *   GET  /app                 member workspace: the shell plus CRM (login + confirmed email required)
 *   GET  /workspace.js        workspace code (shell + CRM), served to confirmed members only
 *   GET  /admin.js            Control Centre code, served to platform managers only
 *   /api/admin/*              Control Centre API (accounts, managers, gigs/opportunities/jobs, bids, logs, uploads)
 *   POST /api/auth/signup | login | logout | forgot | reset | verify | resend      GET /api/auth/me
 *   GET|PUT|POST /api/crm/state   the signed-in user's own CRM data
 * Data: SQLite (data/imi.db). Sessions are random tokens in an HttpOnly cookie; only their hash is stored.
 */
require('./env');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, ACCESS_DEFAULT, DATA_DIR, dbInfo } = require('./db');
const { DATA_IN_APP_DIR } = require('./paths');
const { hashPassword, verifyPassword } = require('./password');
const { redact, maskEmail, logError } = require('./safe');
const adminApi = require('./admin-api');
const crmApi = require('./crm-api');
const discoverApi = require('./discover-api');

// ---- config (.env is optional)
const PORT = Number(process.env.PORT) || 4000;
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE = 'imi_session';
const ui = require('./ui-files');
const prototype = require('./prototype');   // inert unless `npm run prototype` started the server   // finds index.html, workspace.js and admin.js in the standard (public/, private/) or the flat layout
const MIN_PW = 8;
const REQUIRE_VERIFY = process.env.REQUIRE_EMAIL_VERIFICATION !== '0'; // set to 0 to skip email confirmation
if (IS_PROD && !(process.env.RESEND_API_KEY && process.env.MAIL_FROM)) console.warn('[mail] RESEND_API_KEY / MAIL_FROM not set: emails (confirmations, resets, invites) cannot be delivered.');
if (IS_PROD && !APP_URL.startsWith('https://')) console.warn('[config] APP_URL should be an https:// URL in production.');

const now = () => Math.floor(Date.now() / 1000);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const J = (v, d) => { try { return JSON.parse(v); } catch (e) { return d; } };
function cleanup() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM verify_tokens WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM api_request_logs WHERE created_at < ?').run(new Date(Date.now() - 35 * 864e5).toISOString());
}
cleanup(); setInterval(cleanup, 3600 * 1000).unref();

// ---- passwords (scrypt; see password.js: the hash records its own cost, old hashes are upgraded at sign-in)
const hashPw = hashPassword;
const checkPw = async (pw, stored) => (await verifyPassword(pw, stored)).ok;
let DUMMY_HASH; hashPw('dummy-password').then((h) => { DUMMY_HASH = h; });

// ---- mail (Resend HTTP API if configured, otherwise printed to the console for development)
async function sendMail(to, subject, text) {
  if (prototype.active && globalThis.IMI_SEEDING) return;   // building the prototype sandbox: no emails, no console noise
  if (!process.env.RESEND_API_KEY) {
    if (IS_PROD) { console.warn(`[mail] NOT SENT, no email provider is configured: "${subject}" to ${maskEmail(to)}`); return; }   // emailed links are secrets: never put them in production logs
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] ${subject}\n[mail:dev] ${text}\n`); return;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) console.error('[mail] send failed', r.status, redact((await r.text()).slice(0, 300)));
}

// ---- http helpers
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, verified: !!u.verified_at, access: J(u.access, J(ACCESS_DEFAULT, {})) });
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
const fail = (status, message) => Object.assign(new Error(message), { status });
function readJson(req, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(fail(415, 'Content-Type must be application/json.'));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c); else if (size > limit * 20) req.destroy(); });
    req.on('end', () => { if (size > limit) return reject(fail(413, 'Request too large.')); try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(fail(400, 'Invalid JSON.')); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
// Normal sites: SameSite=Lax (plus Secure in production). Only when a developer has switched on ALLOW_FRAMING=1 (never in production) the cookie is SameSite=None; Secure, because a browser will not store a Lax cookie inside another site's preview pane, so sign-in would silently fail there. The Origin check on every write still applies.
const setCookie = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; Path=/` + (ALLOW_FRAMING ? '; SameSite=None; Secure' : '; SameSite=Lax' + (IS_PROD ? '; Secure' : '')) + (maxAge !== undefined ? `; Max-Age=${maxAge}` : '');
function clientIp(req) { return (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress; }
function sessionUser(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  return db.prepare('SELECT u.id, u.name, u.email, u.verified_at, u.status, u.access, u.avatar_url, u.deleted_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL AND u.status = \'active\'').get(sha(t), now()) || null;
}
function startSession(res, status, user, remember) {
  const token = newToken(), ttl = remember ? 30 * 86400 : 12 * 3600;
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sha(token), user.id, now() + ttl, now());
  sendJson(res, status, { user: publicUser(user) }, { 'Set-Cookie': setCookie(token, remember ? ttl : undefined) });
}
function requireUser(req) { const u = sessionUser(req); if (!u) throw fail(401, 'Not signed in.'); return u; }
const APP_HOST = (() => { try { return process.env.APP_URL ? new URL(APP_URL).host : ''; } catch (e) { return ''; } })();
const ALLOW_FRAMING = process.env.ALLOW_FRAMING === '1' && !IS_PROD;   // development previews only; never in production
function originHost(o) { try { return new URL(o).host.slice(0, 80); } catch (e) { return 'an unknown address'; } }
function sameOrigin(req) { // CSRF defence in depth (cookies are also SameSite=Lax)
  const o = req.headers.origin;
  if (!o) return true;
  let host; try { host = new URL(o).host; } catch (e) { return false; }
  if (host === req.headers.host) return true;                      // the normal case
  if (APP_HOST && host === APP_HOST) return true;                  // the public address you set in APP_URL
  const fwd = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return !!fwd && fwd === host && (TRUST_PROXY || !IS_PROD);       // a proxy in front of the app that rewrites Host (trusted only when TRUST_PROXY=1 in production)
}
// in development the message says how to fix it; in production it stays short
const crossOrigin = (req) => fail(403, IS_PROD ? 'Cross-origin request blocked.' : `Cross-origin request blocked: the page was opened from ${originHost(req.headers.origin)} but the server sees ${String(req.headers.host).slice(0, 80)}. If you are using a preview or proxy, set APP_URL in .env to the address you open in the browser, then restart.`);

// ---- throttling (in-memory; fine for a single instance)
const buckets = new Map();
function hit(key, max, windowMs) {
  const t = Date.now(), arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t); buckets.set(key, arr); return arr.length > max;
}
const tooMany = (key, max, windowMs) => (buckets.get(key) || []).filter((x) => Date.now() - x < windowMs).length >= max;
setInterval(() => { const t = Date.now(); for (const [k, v] of buckets) if (!v.some((x) => t - x < 15 * 60000)) buckets.delete(k); }, 60000).unref();

// ---- auth handlers
async function signup(req, res) {
  const b = await readJson(req);
  const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  const errors = {};
  if (!name || name.length > 80) errors.name = 'Enter your name (max 80 characters).';
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (password.length < MIN_PW || password.length > 200) errors.password = `Password must be at least ${MIN_PW} characters.`;
  if (Object.keys(errors).length) return sendJson(res, 400, { error: Object.values(errors)[0], fields: errors });
  const taken = { error: 'An account with this email already exists.', fields: { email: 'An account with this email already exists.' } };
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return sendJson(res, 409, taken);
  const user = { id: crypto.randomUUID(), name, email };
  const ts = new Date().toISOString();
  user.verified_at = REQUIRE_VERIFY ? null : ts;
  try { db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at,verified_at) VALUES (?,?,?,?,?,?,?)').run(user.id, name, email, await hashPw(password), ts, ts, user.verified_at); }
  catch (e) { return sendJson(res, 409, taken); }
  user.access = ACCESS_DEFAULT;
  db.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, detail, created_at) VALUES (NULL, 'user.register', 'user', ?, 'New user registered', ?, ?)").run(user.id, email, ts);
  if (REQUIRE_VERIFY) issueVerification(user);
  startSession(res, 201, user, !!b.remember);
}
async function login(req, res) {
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  const failKey = 'fail:' + email;
  if (tooMany(failKey, 5, 15 * 60000)) return sendJson(res, 429, { error: 'Too many failed attempts. Please try again in 15 minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
  const check = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH || (await hashPw('x')));
  const ok = check.ok;
  if (!user || !ok) { hit(failKey, 5, 15 * 60000); return sendJson(res, 401, { error: 'Invalid email or password.' }); }
  buckets.delete(failKey);
  if (user.status === 'suspended') return sendJson(res, 403, { error: 'This account has been suspended. Please contact support.' });
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  if (check.rehash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPw(password), user.id);   // old hash format or lower cost: upgrade it now
  startSession(res, 200, user, !!b.remember);
}
function logout(req, res) {
  const t = cookies(req)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
}
async function forgot(req, res) {
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user && !tooMany('reset:' + email, 3, 3600 * 1000)) {
    hit('reset:' + email, 3, 3600 * 1000);
    const token = newToken();
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO reset_tokens VALUES (?,?,?)').run(sha(token), user.id, now() + 3600);
    sendMail(email, 'Reset your IMI Platform password', `Hi ${user.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${APP_URL}/?reset=${token}\n\nIf you didn't ask for this, you can ignore this email.`).catch((e) => console.error('[mail]', e.message));
  }
  sendJson(res, 200, { ok: true }); // same answer whether or not the account exists
}
async function reset(req, res) {
  const b = await readJson(req);
  const token = String(b.token || ''), password = String(b.password || '');
  if (password.length < MIN_PW || password.length > 200) return sendJson(res, 400, { error: `Password must be at least ${MIN_PW} characters.` });
  const row = db.prepare('SELECT user_id FROM reset_tokens WHERE token_hash = ? AND expires_at > ?').get(sha(token), now());
  if (!row) return sendJson(res, 400, { error: 'This reset link is invalid or has expired.' });
  db.prepare(`UPDATE users SET password_hash = ?, verified_at = COALESCE(verified_at, ?), status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?`).run(await hashPw(password), new Date().toISOString(), new Date().toISOString(), row.user_id); // a reset proves the person controls the inbox
  db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // sign out everywhere
  sendJson(res, 200, { ok: true });
}

// ---- email verification
function issueVerification(user) {
  const token = newToken();
  db.prepare('DELETE FROM verify_tokens WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO verify_tokens VALUES (?,?,?)').run(sha(token), user.id, now() + 24 * 3600);
  sendMail(user.email, 'Confirm your email for IMI Platform', `Hi ${user.name},\n\nConfirm your email address to finish setting up your account (link valid for 24 hours):\n${APP_URL}/?verify=${token}\n\nIf you didn't create this account, you can ignore this email.`).catch((e) => console.error('[mail]', e.message));
}
async function verifyEmail(req, res) {
  const b = await readJson(req);
  const row = db.prepare('SELECT user_id FROM verify_tokens WHERE token_hash = ? AND expires_at > ?').get(sha(String(b.token || '')), now());
  if (!row) return sendJson(res, 400, { error: 'This confirmation link is invalid or has expired.' });
  db.prepare('UPDATE users SET verified_at = COALESCE(verified_at, ?) WHERE id = ?').run(new Date().toISOString(), row.user_id);
  db.prepare('DELETE FROM verify_tokens WHERE user_id = ?').run(row.user_id);
  const me = sessionUser(req);
  sendJson(res, 200, { ok: true, signedIn: !!me && me.id === row.user_id });
}
async function resendVerification(req, res) {
  const user = requireUser(req);
  if (user.verified_at) return sendJson(res, 200, { ok: true, verified: true });
  if (hit('resend:' + user.id, 3, 3600 * 1000)) throw fail(429, 'Please wait a while before requesting another email.');
  issueVerification(user);
  sendJson(res, 200, { ok: true });
}

// ---- per-account CRM data
async function crmState(req, res) {
  const user = requireUser(req);
  if (!user.verified_at) throw fail(403, 'Please confirm your email address first.');
  if (!J(user.access, {}).crm) throw fail(403, 'CRM access is not enabled for this account.');
  if (req.method === 'GET') {
    const row = db.prepare('SELECT json FROM crm_state WHERE user_id = ?').get(user.id);
    return sendJson(res, 200, { state: row ? JSON.parse(row.json) : null });
  }
  const b = await readJson(req, 2 * 1024 * 1024);
  if (!b.state || typeof b.state !== 'object' || Array.isArray(b.state)) throw fail(400, 'state must be an object.');
  db.prepare('INSERT INTO crm_state VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').run(user.id, JSON.stringify(b.state), now());
  sendJson(res, 200, { ok: true });
}

// ---- My account: every signed-in member can change their own details, email and password
const isStaffId = (id) => !!db.prepare('SELECT 1 FROM staff WHERE user_id = ?').get(id);
const selfAudit = (u, action, summary, detail) => db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, detail, created_at) VALUES (?,?,?,?,?,?,?)').run(u.id, action, 'user', u.id, summary, detail || null, new Date().toISOString());
const dropOtherSessions = (req, userId) => db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, sha(cookies(req)[COOKIE] || ''));
const fieldErr = (fields) => Object.assign(fail(400, Object.values(fields)[0]), { extra: { fields } });
async function accountApi(req, res, p) {
  const user = requireUser(req);
  if (!user.verified_at) throw fail(403, 'Please confirm your email address first.');
  if (req.method !== 'GET' && !sameOrigin(req)) throw crossOrigin(req);
  const load = () => { const r = db.prepare('SELECT id, name, email, phone, bio, avatar_url, account_type, tier, access, created_at FROM users WHERE id = ?').get(user.id); return Object.assign(r, { access: J(r.access, {}), manager: adminInfo(r) }); };
  if (req.method === 'GET' && p === '/api/account') return sendJson(res, 200, { account: load() });
  if (req.method === 'PATCH' && p === '/api/account') {
    const b = await readJson(req), f = {};
    const name = b.name === undefined ? user.name : String(b.name).trim(), phone = b.phone === undefined ? undefined : String(b.phone).trim(), bio = b.bio === undefined ? undefined : String(b.bio).trim(), av = b.avatar_url === undefined ? undefined : String(b.avatar_url).trim();
    if (name.length < 2 || name.length > 120) f.name = 'Enter your name (2 to 120 characters).';
    if (phone && !/^\+\d{7,15}$/.test(phone)) f.phone = 'Use international format, e.g. +2348012345678';
    if (bio && bio.length > 500) f.bio = 'Keep your bio under 500 characters.';
    if (av && !/^\/uploads\/[0-9a-f-]{36}\.(png|jpg)$/.test(av)) f.avatar_url = 'Use the upload button to choose an image.';
    if (Object.keys(f).length) throw fieldErr(f);
    db.prepare('UPDATE users SET name = ?, phone = COALESCE(?, phone), bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
      .run(name, phone === undefined ? null : phone, bio === undefined ? null : bio, av === undefined ? null : av, new Date().toISOString(), user.id);
    selfAudit(user, 'account.profile', 'Profile updated');
    return sendJson(res, 200, { account: load() });
  }
  if (req.method === 'POST' && (p === '/api/account/password' || p === '/api/account/email')) {
    if (hit('acct:' + user.id, 8, 15 * 60000)) throw fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
    const b = await readJson(req), cur = String(b.current_password || '');
    const row = db.prepare('SELECT password_hash, email FROM users WHERE id = ?').get(user.id);
    if (!(await checkPw(cur, row.password_hash))) throw fieldErr({ current_password: 'Your current password is not correct.' });
    if (p === '/api/account/password') {
      const next = String(b.new_password || ''), min = isStaffId(user.id) ? 10 : MIN_PW;
      if (next.length < min || next.length > 200) throw fieldErr({ new_password: `Choose a password of at least ${min} characters.` });
      if (next === cur) throw fieldErr({ new_password: 'Choose a different password from your current one.' });
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPw(next), new Date().toISOString(), user.id);
      dropOtherSessions(req, user.id);   // anyone else signed in with the old password is signed out
      selfAudit(user, 'account.password', 'Password changed');
      return sendJson(res, 200, { ok: true });
    }
    const email = String(b.new_email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw fieldErr({ new_email: 'Enter a valid email address.' });
    if (email === row.email) throw fieldErr({ new_email: 'That is already your email address.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw Object.assign(fail(409, 'That email is already in use.'), { extra: { fields: { new_email: 'That email is already in use.' } } });
    db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(email, new Date().toISOString(), user.id);
    dropOtherSessions(req, user.id);
    selfAudit(user, 'account.email', 'Email changed', `${row.email} \u2192 ${email}`);
    return sendJson(res, 200, { ok: true, email });
  }
  return false;
}

// ---- first super admin: from settings (SUPER_ADMIN_*) or from the browser setup page. Only while no super admin exists.
const needsSetup = () => !db.prepare("SELECT 1 FROM staff WHERE role = 'super_admin'").get();   // any super admin record, even a suspended one: setup must never silently re-open or overwrite an existing admin
async function makeSuperAdmin(name, email, pw) {
  const hash = await hashPw(pw), ts = new Date().toISOString();
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email); let id;
  if (ex) {
    id = ex.id;
    db.prepare("UPDATE users SET password_hash = ?, status = 'active', deleted_at = NULL, verified_at = COALESCE(verified_at, ?), access = json_set(access, '$.main_platform', json('true'), '$.crm', json('true'), '$.admin_dashboard', json('true'), '$.api', json('true')), updated_at = ? WHERE id = ?").run(hash, ts, ts, id);
  } else {
    id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, name, email, password_hash, status, access, created_at, updated_at, verified_at) VALUES (?,?,?,?, 'active', '{\"main_platform\":true,\"crm\":true,\"admin_dashboard\":true,\"api\":true}', ?,?,?)").run(id, name, email, hash, ts, ts, ts);
  }
  db.prepare("INSERT INTO staff (user_id, role, permissions, created_at) VALUES (?, 'super_admin', ?, ?) ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', permissions = excluded.permissions, status = 'active'").run(id, JSON.stringify(['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings']), ts);
  db.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, detail, created_at) VALUES (?, 'staff.setup', 'staff', ?, 'First super admin created', ?, ?)").run(id, id, email, ts);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
async function bootstrapSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase(), pw = process.env.SUPER_ADMIN_PASSWORD || '';
  if (email && pw && needsSetup()) { // runs only while NO super admin exists, so a restart never re-creates or resets an admin
    if (!EMAIL_RE.test(email) || pw.length < 10) console.warn('[admin] SUPER_ADMIN_EMAIL must be valid and SUPER_ADMIN_PASSWORD at least 10 characters. No admin created.');
    else { await makeSuperAdmin((process.env.SUPER_ADMIN_NAME || 'Super Admin').trim(), email, pw); console.log(`[admin] First super admin created: ${maskEmail(email)}. Log in, change the password under My account, then remove SUPER_ADMIN_PASSWORD from your settings.`); }
  }
  if (needsSetup() && !(prototype.active && !globalThis.IMI_PROTOTYPE_EMPTY)) {   // (the prototype sandbox creates its own admin a moment later)
    if (IS_PROD && !setupCodeUsable) console.log(`[admin] No administrator exists yet. Create one with SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD, or set SETUP_CODE (12+ characters) and use "Set up the admin account" at ${APP_URL}.`);
    else console.log(`[admin] No administrator exists yet. Open ${APP_URL} and choose "Set up the admin account" on the login card.` + (!IS_PROD && !SETUP_CODE_ENV ? `\n[admin] Setup code (needed only if you open the site through a preview or proxy, not directly on this computer): ${SETUP_CODE}` : ''));
  }
}
// setup from the browser: free on the machine running the server, otherwise needs the setup code printed in the server console
const SETUP_CODE_ENV = process.env.SETUP_CODE || '';
const SETUP_CODE = SETUP_CODE_ENV || (IS_PROD ? '' : crypto.randomBytes(4).toString('hex'));   // in production there is no random code: it would have to be written to the logs
const setupCodeUsable = SETUP_CODE.length >= (IS_PROD ? 12 : 4);
const sameSecret = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isLocal = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '') && !req.headers['x-forwarded-for'];
async function setupApi(req, res, p) {
  if (req.method === 'GET' && p === '/api/setup/status') return sendJson(res, 200, { needsSetup: needsSetup(), requiresCode: !isLocal(req) });
  if (req.method === 'POST' && p === '/api/setup') {
    if (!sameOrigin(req)) throw crossOrigin(req);
    if (hit('setup:' + clientIp(req), 10, 15 * 60000)) throw fail(429, 'Too many attempts. Please wait a few minutes.');
    if (!needsSetup()) throw fail(403, 'An administrator already exists. Please log in.');
    const b = await readJson(req), f = {};
    const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!isLocal(req)) {
      if (!setupCodeUsable) throw Object.assign(fail(403, 'Browser setup from another computer is turned off.'), { extra: { fields: { code: 'Browser setup from another computer is turned off on this server. Set SETUP_CODE (12+ characters) in the server settings, or use SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD.' } } });
      if (!sameSecret(String(b.code || '').trim(), SETUP_CODE)) throw Object.assign(fail(403, 'The setup code is not correct.'), { extra: { fields: { code: 'The setup code is not correct.' + (IS_PROD ? '' : ' It is printed in the server console.') } } });
    }
    if (name.length < 2 || name.length > 120) f.name = 'Enter your name.';
    if (!EMAIL_RE.test(email) || email.length > 254) f.email = 'Enter a valid email address.';
    if (pw.length < 10 || pw.length > 200) f.password = 'Use at least 10 characters.';
    if (Object.keys(f).length) throw fieldErr(f);
    const user = await makeSuperAdmin(name, email, pw);
    return startSession(res, 201, user, false);
  }
  return false;
}

const adminHandle = adminApi.create({ getSession: sessionUser, hashPw, sendMail, appUrl: APP_URL });
const crmHandle = crmApi.create({ getSession: sessionUser });
const discoverHandle = discoverApi.create({ getSession: sessionUser });
function adminInfo(user) { // staff role + permissions when this person may use the Control Centre, otherwise null
  const st = db.prepare('SELECT role, permissions, status FROM staff WHERE user_id = ?').get(user.id);
  if (!st || st.status !== 'active' || !J(user.access, {}).admin_dashboard) return null;
  return { role: st.role, permissions: J(st.permissions, []) };
}
async function serveApp(res, user) { // the same page everyone gets, with the member's details injected so the workspace can start
  try {
    const member = { id: user.id, name: user.name, email: user.email, access: J(user.access, J(ACCESS_DEFAULT, {})), admin: adminInfo(user) };
    const html = (await fs.promises.readFile(ui.homeFile(), 'utf8')).replace('<head>', '<head><script>window.__MEMBER__=' + JSON.stringify(member).replace(/</g, '\\u003c') + '</script><style>#home-header,#home-view{display:none!important}</style>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(prototype.inject(html));
  } catch (e) { sendMissingHome(res); }
}
async function sendFile(res, file, extra = {}) {
  try { const buf = await fs.promises.readFile(file); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(buf); }
  catch (e) { if (path.basename(file) === 'index.html') return sendMissingHome(res); sendJson(res, 500, { error: 'File missing on server: ' + path.basename(file) }); }
}
// a readable page instead of a blank screen or raw JSON when the page files are not where the server looks
function sendMissingHome(res) { res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(ui.MISSING_PAGE); }

// ---- server
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!ALLOW_FRAMING) res.setHeader('X-Frame-Options', 'SAMEORIGIN');   // stops other sites embedding the app (clickjacking). ALLOW_FRAMING=1 relaxes it in development only
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-IMI-API', '1'); // lets the single-file preview tell a real backend from a static host
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/api/') && !p.startsWith('/api/admin/')) res.on('finish', () => { try { db.prepare('INSERT INTO api_request_logs (endpoint, status_code, created_at) VALUES (?,?,?)').run(p, res.statusCode, new Date().toISOString()); } catch (e) { /* logging must never break a request */ } });
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const me = sessionUser(req); // confirmed members go straight to their workspace (links with a query, like ?verify=, still reach the homepage)
      if (me && me.verified_at && !new URL(req.url, 'http://localhost').search) { res.writeHead(302, { Location: '/app' }); return res.end(); }
      if (prototype.active) { try { const html = prototype.inject(await fs.promises.readFile(ui.homeFile(), 'utf8')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(html); } catch (e) { return sendMissingHome(res); } }
      return sendFile(res, ui.homeFile(), { 'Cache-Control': 'no-cache' });
    }
    if (req.method === 'GET' && p === '/healthz') return sendJson(res, 200, { ok: true, db: { instance: String(dbInfo.instanceId).slice(0, 8), migrations: dbInfo.applied } });   // the instance id lets you confirm the SAME database survived a redeploy
    if (req.method === 'GET' && (p === '/app' || p === '/crm' || p === '/workspace.js' || p === '/admin.js')) {
      const me = sessionUser(req);
      if (!me) { if (p.endsWith('.js')) return sendJson(res, 401, { error: 'Not signed in.' }); res.writeHead(302, { Location: '/' }); return res.end(); }
      if (!me.verified_at) { if (p.endsWith('.js')) return sendJson(res, 403, { error: 'Please confirm your email address first.' }); res.writeHead(302, { Location: '/?verify=pending' }); return res.end(); }
      if (p === '/crm') { res.writeHead(302, { Location: '/app' }); return res.end(); }
      if (p === '/app') return serveApp(res, me);
      if (p === '/admin.js' && !adminInfo(me)) return sendJson(res, 403, { error: 'Admin access required.' });   // the Control Centre code is only sent to staff
      try { const code = await fs.promises.readFile(p === '/admin.js' ? ui.adminFile() : ui.workspaceFile()); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(code); }
      catch (e) { return sendJson(res, 500, { error: p.slice(1) + ' missing on server' }); }
    }
    if (req.method === 'GET' && p.startsWith('/uploads/') && adminApi.serveUpload(res, p.slice(9))) return;
    if (p.startsWith('/api/admin/')) {
      const mut = req.method !== 'GET';
      if (mut && !sameOrigin(req)) throw crossOrigin(req);
      if (hit('adm:' + clientIp(req), 600, 60000)) throw fail(429, 'Too many requests. Please slow down.');
      const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const handled = await adminHandle(req, res, p.slice('/api/admin'.length), query, { ip: clientIp(req), readJson: (r) => readJson(r, p.startsWith('/api/admin/market-news') ? 96 * 1024 : 10 * 1024),   // articles can be long
        send: (st, obj) => (st === 204 ? (res.writeHead(204, { 'Cache-Control': 'no-store' }), res.end()) : sendJson(res, st, obj)) });
      if (handled) return;
    }
    if (p === '/api/setup/status' || p === '/api/setup') { if (await setupApi(req, res, p) !== false) return; }
    if (p === '/api/account' || p.startsWith('/api/account/')) { if (await accountApi(req, res, p) !== false) return; }
    if (p.startsWith('/api/discover/')) {   // Discover, News and Watchlist: reading is public, applying and saving need a signed-in member
      if (req.method !== 'GET' && !sameOrigin(req)) throw crossOrigin(req);
      if (hit('discover:' + clientIp(req), 900, 60000)) throw fail(429, 'Too many requests. Please slow down.');
      const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const handled = await discoverHandle(req, res, p.slice('/api/discover'.length), query, { readJson, hit,
        send: (st, obj) => (st === 204 ? (res.writeHead(204, { 'Cache-Control': 'no-store' }), res.end()) : sendJson(res, st, obj)) });
      if (handled) return;
    }
    if (p.startsWith('/api/crm/') && p !== '/api/crm/state') {   // shared deals, tasks, daily reports, files, notifications
      if (req.method !== 'GET' && !sameOrigin(req)) throw crossOrigin(req);
      if (hit('crm:' + clientIp(req), 900, 60000)) throw fail(429, 'Too many requests. Please slow down.');
      const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const handled = await crmHandle(req, res, p.slice('/api/crm'.length), query, { ip: clientIp(req), readJson,
        send: (st, obj) => (st === 204 ? (res.writeHead(204, { 'Cache-Control': 'no-store' }), res.end()) : sendJson(res, st, obj)) });
      if (handled) return;
    }
    if (p === '/api/crm/state' && ['GET', 'PUT', 'POST'].includes(req.method)) {
      if (req.method !== 'GET' && !sameOrigin(req)) throw crossOrigin(req);
      return await crmState(req, res);
    }
    if (p.startsWith('/api/auth/')) {
      const route = p.slice('/api/auth/'.length);
      if (req.method === 'GET' && route === 'me') { const u = sessionUser(req); return u ? sendJson(res, 200, { user: publicUser(u) }) : sendJson(res, 401, { error: 'Not signed in.' }); }
      const posts = { signup, login, logout, forgot, reset, verify: verifyEmail, resend: resendVerification };
      if (req.method === 'POST' && posts[route]) {
        if (!sameOrigin(req)) throw crossOrigin(req);
        if (route !== 'logout' && hit('ip:' + clientIp(req), 20, 60000)) throw fail(429, 'Too many attempts. Please wait a minute and try again.');
        return await posts[route](req, res);
      }
    }
    sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    e = adminApi.dbError(e) || e;
    if (res.headersSent) { logError('server', e); return res.end(); }   // a response already started: never try to send a second one
    if (e.status) return sendJson(res, e.status, Object.assign({ error: e.message }, e.extra));
    logError('server', e); sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});
// the first-administrator step finishes BEFORE the server accepts any request, so there is no half-initialised moment
bootstrapSuperAdmin().catch((e) => logError('admin', e)).finally(() => server.listen(PORT, prototype.active ? '127.0.0.1' : undefined, () => {   // prototype mode has public demo logins, so it listens on this computer only
  if (process.env.ALLOW_FRAMING === '1') console.log(IS_PROD ? '[security] ALLOW_FRAMING is ignored in production: pages cannot be embedded by other sites.' : '[security] ALLOW_FRAMING=1: other pages may embed this app. Use it only for a development preview pane. Sessions use SameSite=None; Secure so sign-in works inside the pane (needs https or localhost). If sign-in still bounces back, open the app in its own browser tab.');
  console.log(`IMI Platform running at http://localhost:${PORT}`);
  const gone = ui.missing();
  if (gone.length) console.error(`[ui] MISSING page files: ${gone.map((g) => g.what).join(', ')}. The site will not load until they are added next to server.js or in public/ and private/.`);
  else console.log(`[ui] page files found (${[...new Set(ui.status().map((x) => x.layout === 'flat' ? 'flat layout' : x.layout + '/'))].join(' + ')})`);
  console.log(`[db] ${dbInfo.wasNew ? 'NEW database created' : `existing database opened (${dbInfo.users} account${dbInfo.users === 1 ? '' : 's'}, ${dbInfo.applied} migrations)`} | instance ${String(dbInfo.instanceId).slice(0, 8)} | data folder: ${DATA_DIR}`);
  if (IS_PROD && dbInfo.wasNew) console.warn('[db] WARNING: a brand-new empty database was created in production. If you expected existing data, the data folder was not kept between deploys. See "Persistent storage" in the README.');
  if (IS_PROD && DATA_IN_APP_DIR) console.warn('[db] WARNING: DATA_DIR is inside the application folder. Hosts that rebuild the container on every deploy will erase it. Mount a persistent volume and set DATA_DIR to it.');
}));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));
process.on('uncaughtException', (e) => { logError('uncaughtException', e); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
