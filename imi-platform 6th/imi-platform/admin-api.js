'use strict';
/**
 * Control Centre API, ported from the admin-backend project (Express + PostgreSQL) to the platform's
 * own server + SQLite. Same endpoints under /api/admin, same permission rules, same audit trail.
 * Authentication is the platform's session cookie; admin access is re-checked in the database on every request.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR, ROLE_PRESETS, PERMISSIONS } = require('./db');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

class Http extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const iso = () => new Date().toISOString();
const unix = () => Math.floor(Date.now() / 1000);
const J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const uuid = () => crypto.randomUUID();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------- validation (replaces zod) ---------- */
function parse(spec, input, partial) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Http(422, 'Validation failed', { details: { _: ['Expected an object'] } });
  const out = {}, errs = {};
  const bad = (k, m) => { (errs[k] = errs[k] || []).push(m); };
  for (const [k, r] of Object.entries(spec)) {
    let v = input[k];
    if (v === undefined) {
      if (partial) continue;
      if (r.def === undefined) { if (r.req) bad(k, 'Required'); continue; }
      v = clone(r.def); if (r.t !== 'obj') { out[k] = v; continue; }
    }
    if (v === null) { if (r.nullable) out[k] = null; else bad(k, 'Cannot be empty'); continue; }
    switch (r.t) {
      case 'str': case 'email': {
        if (typeof v !== 'string') { bad(k, 'Expected text'); break; }
        if (r.trim !== false) v = v.trim();
        if (r.t === 'email' || r.lower) v = v.toLowerCase();
        if (r.upper) v = v.toUpperCase();
        if (r.t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { bad(k, 'Invalid email'); break; }
        if (r.min != null && v.length < r.min) { bad(k, `Must be at least ${r.min} characters`); break; }
        if (r.max != null && v.length > r.max) { bad(k, `Must be at most ${r.max} characters`); break; }
        if (r.len != null && v.length !== r.len) { bad(k, `Must be exactly ${r.len} characters`); break; }
        if (r.re && !r.re.test(v)) { bad(k, r.msg || 'Invalid format'); break; }
        out[k] = v; break;
      }
      case 'enum': if (!r.vals.includes(v)) bad(k, `Must be one of: ${r.vals.join(', ')}`); else out[k] = v; break;
      case 'num': if (typeof v !== 'number' || !Number.isFinite(v)) bad(k, 'Expected a number'); else if (r.min != null && v < r.min) bad(k, `Must be at least ${r.min}`); else out[k] = v; break;
      case 'uuid': if (typeof v !== 'string' || !UUID_RE.test(v)) bad(k, 'Invalid id'); else out[k] = v; break;
      case 'bool': if (typeof v !== 'boolean') bad(k, 'Expected true or false'); else out[k] = v; break;
      case 'date': { const d = new Date(v); if (typeof v === 'object' || isNaN(d)) bad(k, 'Invalid date'); else out[k] = d.toISOString(); break; }
      case 'arr': {
        if (!Array.isArray(v)) { bad(k, 'Expected a list'); break; }
        if (r.max != null && v.length > r.max) { bad(k, `At most ${r.max} items`); break; }
        if (r.min != null && v.length < r.min) { bad(k, `At least ${r.min} item(s)`); break; }
        const items = []; let ok = true;
        for (const it of v) {
          if (r.of.t === 'uuid') { if (typeof it !== 'string' || !UUID_RE.test(it)) { ok = false; break; } items.push(it); }
          else if (r.of.t === 'enum') { if (!r.of.vals.includes(it)) { ok = false; break; } items.push(it); }
          else if (r.of.t === 'obj') { try { items.push(parse(r.of.spec, it, false)); } catch (e) { ok = false; break; } }
          else { if (typeof it !== 'string' || (r.of.max != null && it.length > r.of.max)) { ok = false; break; } items.push(it); }
        }
        if (!ok) bad(k, 'Invalid item in list'); else out[k] = items; break;
      }
      case 'obj': { const sub = parse(r.spec, v, false); out[k] = sub; break; }
      default: bad(k, 'Unsupported');
    }
  }
  if (Object.keys(errs).length) throw new Http(422, 'Validation failed', { details: errs });
  return out;
}

/* ---------- helpers ---------- */
function paging(q) {
  const page = Math.max(1, parseInt(q.page) || 1), limit = Math.min(100, Math.max(1, parseInt(q.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function update(table, id, data, extraWhere, extraParams) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return null;
  const vals = keys.map((k) => { const v = data[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v; });
  return db.prepare(`UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL ${extraWhere || ''} RETURNING *`)
    .get(...vals, iso(), id, ...(extraParams || []));
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* ignore */ } throw e; }
}
function audit(c, { action, entityType, entityId, summary, detail, changes }) {
  db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, detail, changes, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(c.admin ? c.admin.id : null, action, entityType, entityId == null ? null : String(entityId), summary || null, detail || null, changes ? JSON.stringify(changes) : null, c.ip || null, iso());
}
const ph = (n) => Array(n).fill('?').join(',');
const userOut = (r) => (r ? Object.assign({}, r, { access: J(r.access, {}), skills: J(r.skills, []) }) : r);
const listingOut = (r) => (r ? Object.assign({}, r, { tags: J(r.tags, []) }) : r);
const staffOut = (r) => (r ? Object.assign({}, r, { permissions: J(r.permissions, []) }) : r);

/* ---------- Control Centre ---------- */
function create(deps) {
  const { getSession, hashPw, sendMail, appUrl } = deps;
  const routes = [];
  const route = (method, pattern, ...fns) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, fns });
  };

  // ---- authentication: re-checked in the database on EVERY request, so suspending or revoking is instant
  const authenticate = (c) => {
    const u = getSession(c.req);
    if (!u) throw new Http(401, 'Authentication required');
    const s = db.prepare('SELECT role, permissions, status FROM staff WHERE user_id = ?').get(u.id);
    const access = J(u.access, {});
    if (!s || u.status !== 'active' || u.deleted_at || !u.verified_at || s.status !== 'active' || !access.admin_dashboard) throw new Http(403, 'Admin access revoked');
    c.admin = { id: u.id, full_name: u.name, email: u.email, avatar_url: u.avatar_url, status: u.status, access, role: s.role, permissions: J(s.permissions, []), staff_status: s.status };
  };
  const can = (...perms) => (c) => {
    const a = c.admin;
    if (a.role === 'super_admin' || perms.every((p) => a.permissions.includes(p))) return;
    throw new Http(403, 'You do not have permission to do this', { required: perms });
  };
  const requireRole = (...roles) => (c) => { if (!roles.includes(c.admin.role)) throw new Http(403, 'Insufficient role'); };
  const body = (spec, partial, refine) => (c) => { c.data = parse(spec, c.body, partial); if (refine) refine(c.data); };

  /* ----- dashboard ----- */
  const pct = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);
  const RANGES = { '7d': 7, '30d': 30, '90d': 90 };
  route('GET', '/auth/me', authenticate, (c) => c.json(200, c.admin));
  route('GET', '/dashboard', authenticate, (c) => {
    const days = RANGES[c.query.range] || 7, DAY = 864e5, nowMs = Date.now();
    const ago = (d) => new Date(nowMs - d * DAY).toISOString();
    const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
    const t0 = new Date(todayStart).toISOString(), y0 = new Date(todayStart - DAY).toISOString();
    const n = (sql, ...p) => db.prepare(sql).get(...p).n;
    const L = (type, extra, ...p) => n(`SELECT count(*) n FROM listings WHERE type=? AND deleted_at IS NULL ${extra}`, type, ...p);
    const stats = {
      total_users: { value: n('SELECT count(*) n FROM users WHERE deleted_at IS NULL'),
        change_pct: pct(n('SELECT count(*) n FROM users WHERE deleted_at IS NULL AND created_at >= ?', ago(7)), n('SELECT count(*) n FROM users WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?', ago(14), ago(7))) },
      active_gigs: { value: L('gig', "AND status='published'"), change_pct: pct(L('gig', 'AND published_at >= ?', ago(7)), L('gig', 'AND published_at >= ? AND published_at < ?', ago(14), ago(7))) },
      active_opportunities: { value: L('opportunity', "AND status='published'"), change_pct: pct(L('opportunity', 'AND published_at >= ?', ago(7)), L('opportunity', 'AND published_at >= ? AND published_at < ?', ago(14), ago(7))) },
      api_requests_today: { value: n('SELECT count(*) n FROM api_request_logs WHERE created_at >= ?', t0), change_pct: pct(n('SELECT count(*) n FROM api_request_logs WHERE created_at >= ?', t0), n('SELECT count(*) n FROM api_request_logs WHERE created_at >= ? AND created_at < ?', y0, t0)) },
    };
    // cumulative totals per day for the Platform Overview chart
    const dates = []; for (let i = days - 1; i >= 0; i--) dates.push(new Date(todayStart - i * DAY).toISOString().slice(0, 10));
    const first = dates[0] + 'T00:00:00.000Z';
    const series = (sqlBase, ...p) => {
      let run = db.prepare(`SELECT count(*) n ${sqlBase} AND created_at < ?`).get(...p, first).n;
      const per = {}; for (const r of db.prepare(`SELECT substr(created_at,1,10) d, count(*) n ${sqlBase} AND created_at >= ? GROUP BY d`).all(...p, first)) per[r.d] = r.n;
      return dates.map((d) => (run += per[d] || 0));
    };
    const us = series('FROM users WHERE deleted_at IS NULL'), gs = series("FROM listings WHERE type='gig' AND deleted_at IS NULL"), os = series("FROM listings WHERE type='opportunity' AND deleted_at IS NULL");
    const cm = {};
    for (const t of ['gig', 'opportunity']) cm[t] = { published: L(t, "AND status='published'"), today: L(t, "AND status='published' AND published_at >= ?", t0) };
    for (const t of ['market_news', 'announcements']) cm[t] = { published: n(`SELECT count(*) n FROM ${t} WHERE deleted_at IS NULL AND status='published'`), today: n(`SELECT count(*) n FROM ${t} WHERE deleted_at IS NULL AND status='published' AND published_at >= ?`, t0) };
    for (const sec of ['bounty', 'marketing']) cm[sec] = { published: n("SELECT count(*) n FROM listings WHERE type='gig' AND section=? AND status='published' AND deleted_at IS NULL", sec), today: n("SELECT count(*) n FROM listings WHERE type='gig' AND section=? AND status='published' AND deleted_at IS NULL AND published_at >= ?", sec, t0) };
    cm.job = { published: L('job', "AND status='published'"), today: L('job', "AND status='published' AND published_at >= ?", t0) };
    c.json(200, {
      stats,
      overview: { range: days + 'd', series: dates.map((d, i) => ({ date: d, users: us[i], gigs: gs[i], opportunities: os[i] })) },
      recent_activity: db.prepare('SELECT a.id, a.action, a.entity_type, a.summary, a.detail, a.created_at, u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC, a.id DESC LIMIT 6').all(),
      content_management: cm,
      latest_users: db.prepare('SELECT id, name AS full_name, email, avatar_url, tier, status, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5').all(),
      recent_gigs: db.prepare("SELECT id, title, company_name, location_text, location_type, status, category FROM listings WHERE type='gig' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5").all(),
      integrations: db.prepare('SELECT id, name, slug, status, last_sync_at FROM api_integrations ORDER BY name LIMIT 6').all(),
      generated_at: iso(),
    });
  });
  route('GET', '/search', authenticate, (c) => {
    const q = String(c.query.q || '').trim();
    if (q.length < 2) return c.json(200, { users: [], gigs: [], opportunities: [], jobs: [] });
    const like = `%${q}%`;
    const users = db.prepare('SELECT id, name AS full_name, email FROM users WHERE deleted_at IS NULL AND (name LIKE ? OR email LIKE ?) LIMIT 5').all(like, like);
    const ls = db.prepare('SELECT id, type, title, status FROM listings WHERE deleted_at IS NULL AND title LIKE ? ORDER BY created_at DESC LIMIT 15').all(like);
    const by = (t) => ls.filter((l) => l.type === t).slice(0, 5);
    c.json(200, { users, gigs: by('gig'), opportunities: by('opportunity'), jobs: by('job') });
  });
  route('GET', '/activity-logs', authenticate, can('view_reports'), (c) => {
    const { page, limit, offset } = paging(c.query); const p = []; const where = ['1=1'];
    if (c.query.actor_id) { p.push(c.query.actor_id); where.push('a.actor_id = ?'); }
    if (c.query.entity_type) { p.push(c.query.entity_type); where.push('a.entity_type = ?'); }
    if (c.query.action) { p.push(c.query.action + '%'); where.push('a.action LIKE ?'); }
    const w = where.join(' AND ');
    const data = db.prepare(`SELECT a.*, u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`).all(...p).map((r) => Object.assign(r, { changes: J(r.changes, null) }));
    c.json(200, { data, page, limit, total: db.prepare(`SELECT count(*) n FROM audit_logs a WHERE ${w}`).get(...p).n });
  });

  /* ----- accounts ----- */
  const COLS = 'id, account_type, name AS full_name, email, phone, tier, status, bio, avatar_url, access, handle, skills, last_login_at, created_at, updated_at';
  const accessSpec = { main_platform: { t: 'bool', def: true }, crm: { t: 'bool', def: false }, admin_dashboard: { t: 'bool', def: false }, api: { t: 'bool', def: false } };
  const acct = {
    account_type: { t: 'enum', vals: ['individual', 'team'], def: 'individual' },
    full_name: { t: 'str', min: 2, max: 120, req: true },
    email: { t: 'email', req: true },
    phone: { t: 'str', re: /^\+\d{7,15}$/, msg: 'Use international format, e.g. +2348012345678' },
    tier: { t: 'enum', vals: ['free', 'premium'], def: 'free' },
    bio: { t: 'str', max: 500 }, avatar_url: { t: 'str', max: 500 },
    status: { t: 'enum', vals: ['active', 'pending', 'suspended'], def: 'active' },
    access: { t: 'obj', spec: accessSpec, def: {} },
  };
  const createSpec = Object.assign({}, acct, { password: { t: 'str', min: 10, max: 128, req: true, trim: false },
    members: { t: 'arr', max: 100, of: { t: 'obj', spec: { user_id: { t: 'uuid', req: true }, member_role: { t: 'enum', vals: ['owner', 'member'], def: 'member' } } } } });
  const guardAdminFlag = (c) => {
    if (c.data.access && c.data.access.admin_dashboard && c.admin.role !== 'super_admin') throw new Http(403, 'Only a super admin can grant Admin Dashboard access');
  };
  const killSessions = (id) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const A = [authenticate, can('manage_users')];
  // A platform manager's own account (email, status, access, password reset) is a path to that manager's powers.
  // Only a super admin may change it here; roles and permissions are handled in Team Members.
  const staffTarget = (c) => {
    if (db.prepare('SELECT 1 FROM staff WHERE user_id = ?').get(c.params.id) && c.admin.role !== 'super_admin') throw new Http(403, 'Platform managers\u2019 accounts can only be changed by a super admin. Use Team Members for roles and permissions, and My account for your own details.');
  };
  const AS = [authenticate, can('manage_users'), staffTarget];

  route('GET', '/accounts', ...A, (c) => {
    const { page, limit, offset } = paging(c.query); const where = ['deleted_at IS NULL']; const p = [];
    for (const [col, key] of [['account_type', 'type'], ['status', 'status'], ['tier', 'tier']]) if (c.query[key]) { p.push(c.query[key]); where.push(`${col} = ?`); }
    if (c.query.q) { p.push(`%${c.query.q}%`, `%${c.query.q}%`); where.push('(name LIKE ? OR email LIKE ?)'); }
    const w = where.join(' AND ');
    c.json(200, { data: db.prepare(`SELECT ${COLS} FROM users WHERE ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`).all(...p).map(userOut), page, limit, total: db.prepare(`SELECT count(*) n FROM users WHERE ${w}`).get(...p).n });
  });
  route('GET', '/accounts/:id', ...A, (c) => {
    const u = userOut(db.prepare(`SELECT ${COLS} FROM users WHERE id = ? AND deleted_at IS NULL`).get(c.params.id));
    if (!u) throw new Http(404, 'Account not found');
    if (u.account_type === 'team') u.members = db.prepare('SELECT m.user_id, m.member_role, u.name AS full_name, u.email, u.avatar_url FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.deleted_at IS NULL').all(u.id);
    c.json(200, u);
  });
  route('POST', '/accounts', ...A, body(createSpec), guardAdminFlag, async (c) => {
    const { password, members, full_name, ...d } = c.data;
    const hash = await hashPw(password), id = uuid(), ts = iso();
    const user = tx(() => {
      db.prepare('INSERT INTO users (id, account_type, name, email, phone, password_hash, tier, status, bio, avatar_url, access, created_by, created_at, updated_at, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, d.account_type, full_name, d.email, d.phone || null, hash, d.tier, d.status, d.bio || null, d.avatar_url || null, JSON.stringify(d.access), c.admin.id, ts, ts, ts); // created by an admin, so the email counts as vouched for
      if (members && members.length && d.account_type === 'team') for (const m of members) db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, member_role, created_at) VALUES (?,?,?,?)').run(id, m.user_id, m.member_role, ts);
      audit(c, { action: 'account.create', entityType: 'user', entityId: id, summary: `New ${d.account_type} account created`, detail: d.email });
      return userOut(db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id));
    });
    c.json(201, user);
  });
  route('PATCH', '/accounts/:id', ...AS, body(acct, true), guardAdminFlag, (c) => {
    if (!Object.keys(c.data).length) throw new Http(400, 'Nothing to update');
    const d = Object.assign({}, c.data); if (d.full_name !== undefined) { d.name = d.full_name; delete d.full_name; }
    const u = update('users', c.params.id, d);
    if (!u) throw new Http(404, 'Account not found');
    if (c.data.status === 'suspended') killSessions(u.id);
    audit(c, { action: 'account.update', entityType: 'user', entityId: u.id, summary: 'Account updated', detail: u.email, changes: c.data });
    const { password_hash, ...safe } = u;
    c.json(200, userOut(Object.assign(safe, { full_name: safe.name })));
  });
  const setStatus = (status, label) => (c) => {
    const u = db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND id <> ? RETURNING id, email, status').get(status, iso(), c.params.id, c.admin.id);
    if (!u) throw new Http(404, 'Account not found (or you cannot change your own status)');
    if (status === 'suspended') killSessions(u.id);
    audit(c, { action: `account.${label}`, entityType: 'user', entityId: u.id, summary: `Account ${label}d`, detail: u.email });
    c.json(200, u);
  };
  route('POST', '/accounts/:id/suspend', ...AS, setStatus('suspended', 'suspend'));
  route('POST', '/accounts/:id/reactivate', ...AS, setStatus('active', 'reactivate'));
  const issueResetLink = (userId, hours) => { // sends a link, never handles the password itself
    const raw = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO reset_tokens VALUES (?,?,?)').run(sha(raw), userId, unix() + hours * 3600);
    return `${appUrl}/?reset=${raw}`;
  };
  route('POST', '/accounts/:id/reset-password', ...AS, (c) => {
    const u = db.prepare('SELECT id, email, name FROM users WHERE id = ? AND deleted_at IS NULL').get(c.params.id);
    if (!u) throw new Http(404, 'Account not found');
    const link = issueResetLink(u.id, 24);
    sendMail(u.email, 'Reset your password', `Hi ${u.name},\n\nAn administrator has sent you a link to choose a new password (valid for 24 hours):\n${link}`).catch(() => {});
    audit(c, { action: 'account.reset_password', entityType: 'user', entityId: u.id, summary: 'Password reset sent', detail: u.email });
    c.json(200, { ok: true });
  });
  route('DELETE', '/accounts/:id', ...AS, (c) => {
    const u = db.prepare("UPDATE users SET deleted_at = ?, status = 'suspended' WHERE id = ? AND id <> ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = users.id) RETURNING email").get(iso(), c.params.id, c.admin.id);
    if (!u) throw new Http(400, 'Not found, is yourself, or is a platform manager (revoke manager access first)');
    killSessions(c.params.id);
    audit(c, { action: 'account.delete', entityType: 'user', entityId: c.params.id, summary: 'Account deleted', detail: u.email });
    c.json(204);
  });
  route('POST', '/accounts/:id/members', ...AS, body({ user_id: { t: 'uuid', req: true }, member_role: { t: 'enum', vals: ['owner', 'member'], def: 'member' } }), (c) => {
    const team = db.prepare("SELECT id FROM users WHERE id = ? AND account_type = 'team' AND deleted_at IS NULL").get(c.params.id);
    if (!team) throw new Http(404, 'Team account not found');
    db.prepare('INSERT INTO team_members (team_id, user_id, member_role, created_at) VALUES (?,?,?,?) ON CONFLICT (team_id, user_id) DO UPDATE SET member_role = excluded.member_role').run(team.id, c.data.user_id, c.data.member_role, iso());
    audit(c, { action: 'team.add_member', entityType: 'user', entityId: team.id, summary: 'Team member added', changes: c.data });
    c.json(201, { ok: true });
  });
  route('DELETE', '/accounts/:id/members/:userId', ...AS, (c) => {
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(c.params.id, c.params.userId);
    audit(c, { action: 'team.remove_member', entityType: 'user', entityId: c.params.id, summary: 'Team member removed', detail: c.params.userId });
    c.json(204);
  });

  /* ----- platform managers ("Official Team Members") ----- */
  const roles = Object.keys(ROLE_PRESETS);
  const M = [authenticate, requireRole('super_admin', 'admin'), can('manage_users')];
  const checkGrant = (admin, role, permissions) => {
    if (admin.role === 'super_admin') return null;
    if (role === 'super_admin') return 'Only a super admin can create another super admin';
    const missing = (permissions || []).filter((p) => !admin.permissions.includes(p));
    return missing.length ? `You cannot grant permissions you do not hold: ${missing.join(', ')}` : null;
  };
  const STAFF = 'SELECT u.id, u.name AS full_name, u.email, u.avatar_url, u.status AS account_status, s.role, s.department, s.permissions, s.status, s.created_at FROM staff s JOIN users u ON u.id = s.user_id';
  route('GET', '/team-members/roles', ...M, (c) => c.json(200, { roles: ROLE_PRESETS, permissions: PERMISSIONS }));
  route('GET', '/team-members', ...M, (c) => c.json(200, { data: db.prepare(`${STAFF} WHERE u.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT ?`).all(Math.min(100, parseInt(c.query.limit) || 50)).map(staffOut) }));
  route('POST', '/team-members', ...M, body({
    full_name: { t: 'str', min: 2, max: 120, req: true }, email: { t: 'email', req: true },
    role: { t: 'enum', vals: roles, def: 'team_member' }, department: { t: 'str', max: 80 },
    permissions: { t: 'arr', max: PERMISSIONS.length, of: { t: 'enum', vals: PERMISSIONS } },
  }), async (c) => {
    const d = c.data, permissions = d.permissions || ROLE_PRESETS[d.role];
    const denied = checkGrant(c.admin, d.role, permissions); if (denied) throw new Http(403, denied);
    const unusable = await hashPw(crypto.randomBytes(32).toString('hex'));
    const raw = crypto.randomBytes(32).toString('base64url');
    const id = tx(() => {
      let u = db.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').get(d.email), uid;
      const ts = iso();
      if (u) {
        if (db.prepare('SELECT 1 FROM staff WHERE user_id = ?').get(u.id)) return null;
        db.prepare("UPDATE users SET access = json_set(access, '$.admin_dashboard', json('true')), updated_at = ? WHERE id = ?").run(ts, u.id); uid = u.id;
      } else {
        uid = uuid();
        db.prepare("INSERT INTO users (id, name, email, password_hash, status, access, created_by, created_at, updated_at) VALUES (?,?,?,?, 'pending', '{\"main_platform\":true,\"crm\":false,\"admin_dashboard\":true,\"api\":false}', ?,?,?)")
          .run(uid, d.full_name, d.email, unusable, c.admin.id, ts, ts);
      }
      db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(uid);
      db.prepare('INSERT INTO reset_tokens VALUES (?,?,?)').run(sha(raw), uid, unix() + 72 * 3600);
      db.prepare('INSERT INTO staff (user_id, role, department, permissions, invited_by, created_at) VALUES (?,?,?,?,?,?)').run(uid, d.role, d.department || null, JSON.stringify(permissions), c.admin.id, ts);
      audit(c, { action: 'staff.add', entityType: 'staff', entityId: uid, summary: 'Platform manager added', detail: `${d.email} (${d.role})`, changes: { role: d.role, permissions } });
      return uid;
    });
    if (!id) throw new Http(409, 'That person is already a platform manager');
    sendMail(d.email, 'You have been invited to manage the platform', `Hi ${d.full_name},\n\nYou have been invited to manage the platform. Set your password here (valid for 72 hours):\n${appUrl}/?reset=${raw}`).catch(() => {});
    c.json(201, staffOut(db.prepare(`${STAFF} WHERE u.id = ?`).get(id)));
  });
  route('PATCH', '/team-members/:userId', ...M, body({
    role: { t: 'enum', vals: roles }, department: { t: 'str', max: 80, nullable: true },
    permissions: { t: 'arr', max: PERMISSIONS.length, of: { t: 'enum', vals: PERMISSIONS } }, status: { t: 'enum', vals: ['active', 'suspended'] },
  }, true), (c) => {
    const { userId } = c.params, d = c.data;
    if (userId === c.admin.id) throw new Http(400, 'You cannot change your own role or permissions');
    const target = db.prepare('SELECT role FROM staff WHERE user_id = ?').get(userId);
    if (!target) throw new Http(404, 'Manager not found');
    if (target.role === 'super_admin' && c.admin.role !== 'super_admin') throw new Http(403, 'Only a super admin can modify a super admin');
    const denied = checkGrant(c.admin, d.role || target.role, d.permissions); if (denied) throw new Http(403, denied);
    db.prepare('UPDATE staff SET role = COALESCE(?, role), department = CASE WHEN ? THEN ? ELSE department END, permissions = COALESCE(?, permissions), status = COALESCE(?, status) WHERE user_id = ?')
      .run(d.role || null, 'department' in d ? 1 : 0, d.department == null ? null : d.department, d.permissions ? JSON.stringify(d.permissions) : null, d.status || null, userId);
    audit(c, { action: 'staff.update', entityType: 'staff', entityId: userId, summary: 'Manager updated', changes: d });
    c.json(200, staffOut(db.prepare(`${STAFF} WHERE u.id = ?`).get(userId)));
  });
  route('DELETE', '/team-members/:userId', ...M, (c) => { // revoke manager access (the user's normal account stays)
    const { userId } = c.params;
    if (userId === c.admin.id) throw new Http(400, 'You cannot revoke your own access');
    const target = db.prepare('SELECT role FROM staff WHERE user_id = ?').get(userId);
    if (!target) throw new Http(404, 'Manager not found');
    if (target.role === 'super_admin' && c.admin.role !== 'super_admin') throw new Http(403, 'Only a super admin can revoke a super admin');
    if (target.role === 'super_admin' && db.prepare("SELECT count(*) n FROM staff WHERE role = 'super_admin' AND status = 'active'").get().n <= 1) throw new Http(400, 'Cannot remove the last super admin');
    tx(() => {
      db.prepare('DELETE FROM staff WHERE user_id = ?').run(userId);
      db.prepare("UPDATE users SET access = json_set(access, '$.admin_dashboard', json('false')), updated_at = ? WHERE id = ?").run(iso(), userId);
      audit(c, { action: 'staff.revoke', entityType: 'staff', entityId: userId, summary: 'Manager access revoked' });
    });
    c.json(204);
  });

  /* ----- gigs / opportunities / jobs ----- */
  const listingSpec = {
    title: { t: 'str', min: 3, max: 160, req: true }, description: { t: 'str', min: 10, req: true },
    category: { t: 'str', max: 60 }, cover_image_url: { t: 'str', max: 500 }, company_name: { t: 'str', max: 120 },
    location_type: { t: 'enum', vals: ['remote', 'onsite', 'hybrid'], def: 'remote' }, location_text: { t: 'str', max: 120 },
    commitment: { t: 'enum', vals: ['full_time', 'part_time', 'contract', 'one_off'] },
    budget_min: { t: 'num', min: 0 }, budget_max: { t: 'num', min: 0 },
    currency: { t: 'str', len: 3, upper: true, def: 'USD' }, deadline: { t: 'date' },
    tags: { t: 'arr', max: 15, of: { t: 'str', max: 40 }, def: [] }, posted_by: { t: 'uuid' },
  };
  const budgetOk = (d) => { if (d.budget_min != null && d.budget_max != null && d.budget_min > d.budget_max) throw new Http(422, 'Validation failed', { details: { budget_min: ['budget_min must be <= budget_max'] } }); };
  const bulkActions = { publish: "status = 'published', published_at = COALESCE(published_at, ?)", unpublish: "status = 'draft'", close: "status = 'closed'", archive: "status = 'archived'", delete: 'deleted_at = ?' };
  const SECTIONS = ['bounty', 'marketing'];   // gigs: Bounty or Marketing gig. "We're Hiring" is the Jobs type.
  for (const [prefix, type] of [['gigs', 'gig'], ['opportunities', 'opportunity'], ['jobs', 'job']]) {
    const LG = [authenticate, can('manage_listings')], base = '/' + prefix;
    const spec = type === 'gig' ? Object.assign({}, listingSpec, { section: { t: 'enum', vals: SECTIONS, def: 'bounty' } }) : listingSpec;
    route('GET', base, ...LG, (c) => {
      const { page, limit, offset } = paging(c.query); const p = [type]; const where = ['l.type = ?', 'l.deleted_at IS NULL'];
      for (const key of ['status', 'category', 'location_type', 'commitment', 'section']) if (c.query[key]) { p.push(c.query[key]); where.push(`l.${key} = ?`); }
      if (c.query.q) { p.push(`%${c.query.q}%`, `%${c.query.q}%`); where.push('(l.title LIKE ? OR l.company_name LIKE ?)'); }
      const w = where.join(' AND ');
      c.json(200, { data: db.prepare(`SELECT l.*, u.name AS poster_name, (SELECT count(*) FROM bids b WHERE b.listing_id = l.id) AS bids_count FROM listings l LEFT JOIN users u ON u.id = l.posted_by WHERE ${w} ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`).all(...p).map(listingOut), page, limit, total: db.prepare(`SELECT count(*) n FROM listings l WHERE ${w}`).get(...p).n });
    });
    route('POST', base + '/bulk', ...LG, body({ ids: { t: 'arr', min: 1, max: 100, of: { t: 'uuid' }, req: true }, action: { t: 'enum', vals: Object.keys(bulkActions), req: true } }), (c) => {
      const { ids, action } = c.data, sets = bulkActions[action], ts = iso();
      const r = db.prepare(`UPDATE listings SET ${sets}, updated_at = ? WHERE id IN (${ph(ids.length)}) AND type = ? AND deleted_at IS NULL`)
        .run(...(sets.includes('?') ? [ts] : []), ts, ...ids, type);
      audit(c, { action: `${type}.bulk_${action}`, entityType: type, summary: `Bulk ${action}: ${r.changes} ${type}(s)`, changes: { ids } });
      c.json(200, { affected: Number(r.changes) });
    });
    route('GET', base + '/:id', ...LG, (c) => {
      const l = db.prepare('SELECT l.*, u.name AS poster_name FROM listings l LEFT JOIN users u ON u.id = l.posted_by WHERE l.id = ? AND l.type = ? AND l.deleted_at IS NULL').get(c.params.id, type);
      if (!l) throw new Http(404, `${type} not found`);
      c.json(200, listingOut(l));
    });
    route('POST', base, ...LG, body(Object.assign({}, spec, { status: { t: 'enum', vals: ['draft', 'published'], def: 'draft' } }), false, budgetOk), (c) => {
      const d = c.data, id = uuid(), ts = iso();
      db.prepare('INSERT INTO listings (id, type, title, description, category, cover_image_url, company_name, location_type, location_text, commitment, budget_min, budget_max, currency, deadline, tags, status, posted_by, created_by, published_at, created_at, updated_at, section) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, type, d.title, d.description, d.category || null, d.cover_image_url || null, d.company_name || null, d.location_type, d.location_text || null, d.commitment || null, d.budget_min ?? null, d.budget_max ?? null, d.currency, d.deadline || null, JSON.stringify(d.tags), d.status, d.posted_by || null, c.admin.id, d.status === 'published' ? ts : null, ts, ts, type === 'gig' ? d.section : null);
      audit(c, { action: `${type}.create`, entityType: type, entityId: id, summary: `New ${type} ${d.status === 'published' ? 'published' : 'drafted'}`, detail: d.title });
      c.json(201, listingOut(db.prepare('SELECT * FROM listings WHERE id = ?').get(id)));
    });
    route('PATCH', base + '/:id', ...LG, body(spec, true, budgetOk), (c) => {
      if (!Object.keys(c.data).length) throw new Http(400, 'Nothing to update');
      const l = update('listings', c.params.id, c.data, 'AND type = ?', [type]);
      if (!l) throw new Http(404, `${type} not found`);
      audit(c, { action: `${type}.update`, entityType: type, entityId: l.id, summary: `${type} updated`, detail: l.title, changes: c.data });
      c.json(200, listingOut(l));
    });
    route('POST', base + '/:id/status', ...LG, body({ status: { t: 'enum', vals: ['draft', 'published', 'closed', 'completed', 'archived'], req: true } }), (c) => {
      const ts = iso();
      const l = db.prepare("UPDATE listings SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ? AND type = ? AND deleted_at IS NULL RETURNING id, title, status")
        .get(c.data.status, ts, c.data.status, ts, c.params.id, type);
      if (!l) throw new Http(404, `${type} not found`);
      audit(c, { action: `${type}.status`, entityType: type, entityId: l.id, summary: `${type} ${l.status}`, detail: l.title });
      c.json(200, l);
    });
    route('DELETE', base + '/:id', ...LG, (c) => {
      const l = db.prepare('UPDATE listings SET deleted_at = ? WHERE id = ? AND type = ? AND deleted_at IS NULL RETURNING title').get(iso(), c.params.id, type);
      if (!l) throw new Http(404, `${type} not found`);
      audit(c, { action: `${type}.delete`, entityType: type, entityId: c.params.id, summary: `${type} deleted`, detail: l.title });
      c.json(204);
    });
  }

  /* ----- bids & selection (gigs): review -> select -> notify & hire ----- */
  const SORTS = { fit: 'b.fit_score DESC NULLS LAST', amount_asc: 'b.amount ASC', amount_desc: 'b.amount DESC', rating: 'u.rating_avg DESC NULLS LAST', newest: 'b.created_at DESC' };
  const BID = 'b.id, b.amount, b.fit_score, b.status, b.experience_years, b.relevant_projects, b.proposal, b.created_at, u.id AS bidder_id, u.name AS full_name, u.handle, u.avatar_url, u.rating_avg, u.rating_count, u.skills';
  const bidOut = (r) => (r ? Object.assign({}, r, { skills: J(r.skills, []) }) : r);
  const loadGig = (c) => {
    const g = db.prepare("SELECT id, title, status, section, budget_min, budget_max, currency FROM listings WHERE id = ? AND type = 'gig' AND deleted_at IS NULL").get(c.params.id);
    if (!g) throw new Http(404, 'Gig not found');
    c.gig = g;
  };
  const B = [authenticate, can('manage_listings'), loadGig];
  route('GET', '/gigs/:id/bids', ...B, (c) => {
    const p = [c.gig.id]; let extra = '';
    if (c.query.status) { p.push(c.query.status); extra = 'AND b.status = ?'; }
    const data = db.prepare(`SELECT ${BID} FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.listing_id = ? ${extra} ORDER BY ${SORTS[c.query.sort] || SORTS.fit}`).all(...p).map(bidOut);
    const tabs = { all: 0, shortlisted: 0, pending: 0, rejected: 0, selected: 0, hired: 0 };
    for (const r of db.prepare('SELECT status, count(*) n FROM bids WHERE listing_id = ? GROUP BY status').all(c.gig.id)) { tabs[r.status] = r.n; tabs.all += r.n; }
    c.json(200, { gig: c.gig, counts: tabs, data });
  });
  route('GET', '/gigs/:id/bids/recommendation', ...B, (c) => c.json(200, bidOut(db.prepare(`SELECT ${BID} FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.listing_id = ? AND b.status <> 'rejected' ORDER BY b.fit_score DESC NULLS LAST, u.rating_avg DESC NULLS LAST LIMIT 1`).get(c.gig.id)) || null));
  route('GET', '/gigs/:id/bids/compare', ...B, (c) => {
    const ids = String(c.query.ids || '').split(',').filter(Boolean).slice(0, 6);
    if (!ids.length) throw new Http(400, 'Pass ?ids=bidId1,bidId2');
    c.json(200, { data: db.prepare(`SELECT ${BID} FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.listing_id = ? AND b.id IN (${ph(ids.length)}) ORDER BY b.fit_score DESC NULLS LAST`).all(c.gig.id, ...ids).map(bidOut) });
  });
  route('POST', '/gigs/:id/bids/status', ...B, body({ bid_ids: { t: 'arr', min: 1, max: 100, of: { t: 'uuid' }, req: true }, status: { t: 'enum', vals: ['pending', 'shortlisted', 'rejected'], req: true } }), (c) => {
    const r = db.prepare(`UPDATE bids SET status = ? WHERE listing_id = ? AND id IN (${ph(c.data.bid_ids.length)}) AND status NOT IN ('selected','hired')`).run(c.data.status, c.gig.id, ...c.data.bid_ids);
    audit(c, { action: 'bid.status', entityType: 'gig', entityId: c.gig.id, summary: `${r.changes} bid(s) marked ${c.data.status}`, detail: c.gig.title });
    c.json(200, { affected: Number(r.changes) });
  });
  route('POST', '/gigs/:id/bids/select', ...B, body({ bid_id: { t: 'uuid', req: true } }), (c) => {
    if (c.gig.status !== 'published') throw new Http(409, 'Gig must be published to select a candidate');
    const ok = tx(() => {
      const b = db.prepare("SELECT id FROM bids WHERE id = ? AND listing_id = ? AND status <> 'rejected'").get(c.data.bid_id, c.gig.id);
      if (!b) return false;
      db.prepare("UPDATE bids SET status = 'shortlisted' WHERE listing_id = ? AND status = 'selected'").run(c.gig.id);
      db.prepare("UPDATE bids SET status = 'selected' WHERE id = ?").run(b.id);
      return true;
    });
    if (!ok) throw new Http(404, 'Bid not found or already rejected');
    audit(c, { action: 'bid.select', entityType: 'gig', entityId: c.gig.id, summary: 'Candidate selected', detail: c.gig.title });
    c.json(200, { ok: true });
  });
  route('POST', '/gigs/:id/bids/hire', ...B, (c) => {
    const result = tx(() => {
      const g = db.prepare('SELECT id, status FROM listings WHERE id = ?').get(c.gig.id), ts = iso();
      if (g.status !== 'published') return { error: 'Gig is not open for hiring' };
      const b = db.prepare("SELECT id, bidder_id FROM bids WHERE listing_id = ? AND status = 'selected'").get(g.id);
      if (!b) return { error: 'Select a candidate first' };
      db.prepare("UPDATE bids SET status = 'hired' WHERE id = ?").run(b.id);
      db.prepare("UPDATE listings SET status = 'in_progress', hired_user_id = ?, updated_at = ? WHERE id = ?").run(b.bidder_id, ts, g.id);
      db.prepare("UPDATE bids SET status = 'rejected' WHERE listing_id = ? AND id <> ? AND status <> 'rejected'").run(g.id, b.id);
      const lost = db.prepare('SELECT bidder_id FROM bids WHERE listing_id = ? AND id <> ?').all(g.id, b.id);   // every other bidder hears the outcome, even if rejected earlier
      const note = db.prepare('INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?,?,?,?,?,?,?)');
      note.run(uuid(), b.bidder_id, 'gig.hired', `You have been selected for "${c.gig.title}"`, 'Congratulations! You can start the project on the platform.', JSON.stringify({ listing_id: g.id }), ts);
      for (const l of lost) note.run(uuid(), l.bidder_id, 'gig.not_selected', `Update on "${c.gig.title}"`, 'Thanks for bidding. Another candidate was selected this time.', JSON.stringify({ listing_id: g.id }), ts);
      audit(c, { action: 'gig.hire', entityType: 'gig', entityId: g.id, summary: 'Participant hired', detail: c.gig.title, changes: { hired_user_id: b.bidder_id } });
      return { hired_user_id: b.bidder_id, notified: lost.length + 1 };
    });
    if (result.error) throw new Http(409, result.error);
    c.json(200, result);
  });

  /* ----- image uploads: PNG/JPG, 2 MB (type is checked from the file's own bytes, not just its label) ----- */
  route('POST', '/uploads/image', authenticate, async (c) => {
    const ct = c.req.headers['content-type'] || '', m = ct.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) throw new Http(400, 'No file uploaded');
    const buf = await readRaw(c.req, 2 * 1024 * 1024 + 4096);
    const boundary = Buffer.from('--' + (m[1] || m[2])); let file = null;
    let pos = buf.indexOf(boundary);
    while (pos > -1 && !file) {
      const next = buf.indexOf(boundary, pos + boundary.length); if (next < 0) break;
      const part = buf.subarray(pos + boundary.length + 2, next - 2), split = part.indexOf('\r\n\r\n');
      if (split > -1 && /name="file"/i.test(part.subarray(0, split).toString('latin1'))) file = part.subarray(split + 4);
      pos = next;
    }
    if (!file || !file.length) throw new Http(400, 'No file uploaded');
    if (file.length > 2 * 1024 * 1024) throw new Http(400, 'File too large (max 2 MB)');
    const ext = file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? '.png' : (file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) ? '.jpg' : null;
    if (!ext) throw new Http(400, 'Only PNG or JPG allowed');
    const name = uuid() + ext; fs.writeFileSync(path.join(UPLOAD_DIR, name), file);
    c.json(201, { url: '/uploads/' + name });
  });

  /* ----- dispatcher ----- */
  return async function handle(req, res, sub, query, ctx) {
    const method = req.method;
    let matched = null;
    for (const r of routes) { const m = r.re.exec(sub); if (m && r.method === method) { matched = { r, m }; break; } }
    if (!matched) return false;
    const c = { req, res, query, ip: ctx.ip, params: {}, body: null,
      json(status, obj) { ctx.send(status, status === 204 ? undefined : obj); } };
    matched.r.keys.forEach((k, i) => { c.params[k] = decodeURIComponent(matched.m[i + 1]); });
    if (c.params.id && !UUID_RE.test(c.params.id) && !/\/auth\//.test(sub)) throw new Http(404, 'Not found');
    const [first, ...rest] = matched.r.fns;
    await first(c);                                   // every route starts with authenticate: no body is read for strangers
    if (['POST', 'PATCH', 'PUT'].includes(method) && !/uploads\/image/.test(sub)) {
      const empty = !req.headers['content-type'] && !Number(req.headers['content-length']) && !req.headers['transfer-encoding'];
      c.body = empty ? {} : await ctx.readJson(req);   // action endpoints (suspend, hire...) may be called without a body
    }
    for (const fn of rest) await fn(c);
    return true;
  };
}

function readRaw(req, limit) { // oversized bodies are drained (not cut off) so the client gets a clear 413
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size <= limit) chunks.push(d); else if (size > limit * 20) req.destroy(); });
    req.on('end', () => (size > limit ? reject(new Http(413, 'File too large (max 2 MB)')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
function serveUpload(res, name) {
  if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(name)) return false;
  const f = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(f)) return false;
  res.writeHead(200, { 'Content-Type': name.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(f).pipe(res);
  return true;
}
function dbError(e) { // map database rule violations to friendly API errors
  const m = String(e && e.message);
  if (/UNIQUE constraint/.test(m)) return new Http(409, 'Already exists (duplicate value)');
  if (/FOREIGN KEY constraint/.test(m)) return new Http(422, 'Referenced record does not exist');
  if (/CHECK constraint/.test(m)) return new Http(422, 'Value violates a database rule');
  return null;
}

module.exports = { create, serveUpload, Http, dbError, parse };
