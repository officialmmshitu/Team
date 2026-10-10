'use strict';
/**
 * CRM API for Deals and Tasks. Unlike the private CRM data (clients, diagnoses, invoices), deals are SHARED:
 * the owner adds other platform members by email, and every member of a deal sees it, logs daily progress,
 * works its tasks and opens its files. Access is checked in the database on every request.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('./db');
const { parse, Http } = require('./admin-api');

const FILE_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILE_DIR, { recursive: true });
const MAX_FILE = 10 * 1024 * 1024, MAX_FILES_PER_DEAL = 50, MAX_MEMBERS = 25;
const iso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s) => DATE_RE.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
const dayOf = (offset) => new Date(Date.now() + (offset || 0) * 864e5).toISOString().slice(0, 10);
const ph = (n) => Array(n).fill('?').join(',');

const STAGES = ['qualification', 'discovery', 'proposal', 'negotiation', 'contract', 'closed_won', 'closed_lost'];
const STAGE_LABEL = { qualification: 'Qualification', discovery: 'Discovery', proposal: 'Proposal', negotiation: 'Negotiation', contract: 'Contract', closed_won: 'Closed Won', closed_lost: 'Closed Lost' };
const PROB = { qualification: 10, discovery: 20, proposal: 40, negotiation: 60, contract: 80, closed_won: 100, closed_lost: 0 };
const TASK_TYPES = ['todo', 'call', 'email', 'meeting', 'follow_up'], TASK_STATUS = ['todo', 'in_progress', 'blocked', 'done'], PRIORITY = ['low', 'medium', 'high'];
const dateField = { t: 'str', re: DATE_RE, msg: 'Use the format YYYY-MM-DD', nullable: true };

const dealSpec = {
  title: { t: 'str', min: 2, max: 160, req: true }, company: { t: 'str', min: 1, max: 120, req: true }, description: { t: 'str', max: 2000 },
  value: { t: 'num', min: 0, def: 0 }, currency: { t: 'str', len: 3, upper: true, def: 'USD' },
  stage: { t: 'enum', vals: STAGES, def: 'qualification' }, priority: { t: 'enum', vals: PRIORITY, def: 'medium' },
  expected_close: dateField, source: { t: 'str', max: 60 }, tags: { t: 'arr', max: 10, of: { t: 'str', max: 30 }, def: [] },
  hold: { t: 'bool' }, lost_reason: { t: 'str', max: 300 },
};
const taskSpec = {
  title: { t: 'str', min: 2, max: 200, req: true }, description: { t: 'str', max: 2000 },
  type: { t: 'enum', vals: TASK_TYPES, def: 'todo' }, status: { t: 'enum', vals: TASK_STATUS, def: 'todo' }, priority: { t: 'enum', vals: PRIORITY, def: 'medium' },
  due_date: dateField, assignee_id: { t: 'uuid' }, deal_id: { t: 'uuid', nullable: true },
};

/* ---------- small helpers ---------- */
const dealOut = (d) => d && Object.assign({}, d, { hold: !!d.hold, tags: J(d.tags, []), stage_label: STAGE_LABEL[d.stage], probability: PROB[d.stage], weighted: Math.round(d.value * PROB[d.stage]) / 100 });
function act(dealId, userId, action, summary) { db.prepare('INSERT INTO deal_activity (deal_id, user_id, action, summary, created_at) VALUES (?,?,?,?,?)').run(dealId, userId, action, summary, iso()); db.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').run(iso(), dealId); }
function notify(userId, type, title, body, data) { db.prepare('INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?,?,?,?,?,?,?)').run(uuid(), userId, type, title, body || null, data ? JSON.stringify(data) : null, iso()); }
const sym = (c) => ({ USD: '$', NGN: '\u20A6', EUR: '\u20AC', GBP: '\u00A3' }[c] || c + ' ');
const money = (v, c) => sym(c) + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
function progressOf(dealId) {
  const c = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const r of db.prepare('SELECT status, count(*) n FROM crm_tasks WHERE deal_id = ? AND deleted_at IS NULL GROUP BY status').all(dealId)) c[r.status] = r.n;
  const total = c.todo + c.in_progress + c.blocked + c.done;
  return { total, completed: c.done, in_progress: c.in_progress, blocked: c.blocked, not_started: c.todo, pct: total ? Math.round((c.done / total) * 100) : 0 };
}
function membersOf(dealId, today) {
  const reported = new Set(db.prepare("SELECT user_id FROM deal_reports WHERE deal_id = ? AND kind = 'daily' AND report_date = ?").all(dealId, today).map((r) => r.user_id));
  return db.prepare('SELECT u.id, u.name, u.email, u.avatar_url, m.label, m.created_at AS joined_at, (d.owner_id = u.id) AS is_owner FROM deal_members m JOIN users u ON u.id = m.user_id JOIN deals d ON d.id = m.deal_id WHERE m.deal_id = ? ORDER BY is_owner DESC, m.created_at').all(dealId)
    .map((m) => Object.assign({}, m, { is_owner: !!m.is_owner, role: m.is_owner ? 'owner' : 'member', reported_today: reported.has(m.id) }));
}
function sanitizeName(n) { return String(n || 'file').replace(/[\\/\u0000-\u001f"<>|?*:]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file'; }

/* what a file really is, judged from its own bytes (not just its name) */
function fileKind(buf, name) {
  const ext = (name.split('.').pop() || '').toLowerCase(), head = buf.subarray(0, 8);
  const is = (...b) => b.every((x, i) => head[i] === x);
  const pdf = is(0x25, 0x50, 0x44, 0x46), png = is(0x89, 0x50, 0x4e, 0x47), jpg = is(0xff, 0xd8, 0xff), zip = is(0x50, 0x4b, 0x03, 0x04), ole = is(0xd0, 0xcf, 0x11, 0xe0);
  const text = !buf.subarray(0, 4096).includes(0);
  const ok = { pdf: pdf, png: png, jpg: jpg, jpeg: jpg, docx: zip, xlsx: zip, pptx: zip, doc: ole, xls: ole, ppt: ole, csv: text, txt: text }[ext];
  return ok === true;
}

function create(deps) {
  const { getSession } = deps;
  const routes = [];
  const route = (method, pattern, ...fns) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, fns });
  };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const body = (spec, partial) => (c) => { c.data = parse(spec, c.body, partial); };

  const authenticate = (c) => {
    const u = getSession(c.req);
    if (!u) throw new Http(401, 'Not signed in.');
    if (!u.verified_at) throw new Http(403, 'Please confirm your email address first.');
    if (!J(u.access, {}).crm) throw new Http(403, 'CRM access is not enabled for this account.');
    c.me = { id: u.id, name: u.name, email: u.email };
    c.today = isDay(String(c.query.today || '')) ? c.query.today : dayOf(0);
  };
  /* loads the deal if (and only if) the caller is one of its members; strangers get a plain 404 */
  const loadDeal = (opts) => (c) => {
    const d = db.prepare('SELECT d.* FROM deals d JOIN deal_members m ON m.deal_id = d.id AND m.user_id = ? WHERE d.id = ? AND d.deleted_at IS NULL').get(c.me.id, c.params.id);
    if (!d) throw new Http(404, 'Deal not found');
    c.deal = d; c.isOwner = d.owner_id === c.me.id;
    if (opts && opts.owner && !c.isOwner) throw new Http(403, 'Only the deal owner can do this');
  };

  /* ---------- deals ---------- */
  route('GET', '/deals', authenticate, (c) => {
    const q = String(c.query.q || '').trim(), p = [c.me.id], where = ['d.deleted_at IS NULL'];
    if (q) { p.push(`%${q}%`, `%${q}%`); where.push('(d.title LIKE ? OR d.company LIKE ?)'); }
    if (c.query.stage && STAGES.includes(c.query.stage)) { p.push(c.query.stage); where.push('d.stage = ?'); }
    if (c.query.mine === '1') { where.push('d.owner_id = ?'); p.push(c.me.id); }
    const base = `FROM deals d JOIN deal_members m ON m.deal_id = d.id AND m.user_id = ? JOIN users o ON o.id = d.owner_id WHERE ${where.join(' AND ')}`;
    const tabSql = { active: "AND d.hold = 0 AND d.stage NOT IN ('closed_won','closed_lost')", closed: "AND d.stage IN ('closed_won','closed_lost')", hold: 'AND d.hold = 1' }[c.query.tab] || '';
    const rows = db.prepare(`SELECT d.*, o.name AS owner_name ${base} ${tabSql} ORDER BY d.updated_at DESC LIMIT 300`).all(...p);
    const counts = { all: 0, active: 0, closed: 0, hold: 0 };
    for (const r of db.prepare(`SELECT d.stage, d.hold ${base}`).all(...p)) { counts.all++; if (r.hold) counts.hold++; if (r.stage === 'closed_won' || r.stage === 'closed_lost') counts.closed++; else if (!r.hold) counts.active++; }
    const ids = rows.map((r) => r.id), mem = {}, prog = {};
    if (ids.length) {
      for (const m of db.prepare(`SELECT m.deal_id, u.id, u.name, u.avatar_url FROM deal_members m JOIN users u ON u.id = m.user_id WHERE m.deal_id IN (${ph(ids.length)}) ORDER BY m.created_at`).all(...ids)) (mem[m.deal_id] = mem[m.deal_id] || []).push({ id: m.id, name: m.name, avatar_url: m.avatar_url });
      for (const t of db.prepare(`SELECT deal_id, status, count(*) n FROM crm_tasks WHERE deal_id IN (${ph(ids.length)}) AND deleted_at IS NULL GROUP BY deal_id, status`).all(...ids)) { const x = prog[t.deal_id] = prog[t.deal_id] || { total: 0, done: 0 }; x.total += t.n; if (t.status === 'done') x.done += t.n; }
    }
    c.json(200, { data: rows.map((r) => Object.assign(dealOut(r), { members: mem[r.id] || [], member_count: (mem[r.id] || []).length, progress_pct: prog[r.id] && prog[r.id].total ? Math.round((prog[r.id].done / prog[r.id].total) * 100) : 0, is_owner: r.owner_id === c.me.id })), counts });
  });
  route('POST', '/deals', authenticate, body(dealSpec), (c) => {
    const d = c.data, id = uuid(), ts = iso();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO deals (id, owner_id, title, company, description, value, currency, stage, priority, expected_close, source, tags, closed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, c.me.id, d.title, d.company, d.description || null, d.value, d.currency, d.stage, d.priority, d.expected_close || null, d.source || null, JSON.stringify(d.tags), d.stage.startsWith('closed') ? ts : null, ts, ts);
      db.prepare('INSERT INTO deal_members (deal_id, user_id, label, created_at) VALUES (?,?,?,?)').run(id, c.me.id, 'Deal Owner', ts);
      act(id, c.me.id, 'deal.created', `created the deal "${d.title}"`);
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* ignore */ } throw e; }
    c.json(201, dealOut(db.prepare('SELECT * FROM deals WHERE id = ?').get(id)));
  });
  route('GET', '/deals/:id', authenticate, loadDeal(), (c) => {
    const d = dealOut(c.deal), owner = db.prepare('SELECT id, name FROM users WHERE id = ?').get(d.owner_id);
    c.json(200, Object.assign(d, { owner, is_owner: c.isOwner, members: membersOf(d.id, c.today), progress: progressOf(d.id),
      contacts: db.prepare('SELECT id, name, role, email, phone, tag FROM deal_contacts WHERE deal_id = ? ORDER BY created_at').all(d.id) }));
  });
  route('PATCH', '/deals/:id', authenticate, loadDeal({ owner: true }), body(dealSpec, true), (c) => {
    const d = c.data, cur = c.deal, sets = [], vals = [];
    if (!Object.keys(d).length) throw new Http(400, 'Nothing to update');
    for (const k of Object.keys(d)) { sets.push(`"${k}" = ?`); vals.push(k === 'tags' ? JSON.stringify(d[k]) : k === 'hold' ? (d[k] ? 1 : 0) : d[k]); }
    if (d.stage) { sets.push('closed_at = ?'); vals.push(d.stage.startsWith('closed') ? iso() : null); if (!d.stage.startsWith('closed') && cur.lost_reason) { sets.push('lost_reason = NULL'); } }
    db.prepare(`UPDATE deals SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, iso(), cur.id);
    const others = db.prepare('SELECT user_id FROM deal_members WHERE deal_id = ? AND user_id <> ?').all(cur.id, c.me.id);
    if (d.stage && d.stage !== cur.stage) { act(cur.id, c.me.id, 'deal.stage', `moved the deal to ${STAGE_LABEL[d.stage]}`); others.forEach((o) => notify(o.user_id, 'deal.stage', `${cur.title}: now ${STAGE_LABEL[d.stage]}`, null, { deal_id: cur.id })); }
    if (d.value !== undefined && d.value !== cur.value) act(cur.id, c.me.id, 'deal.value', `updated the deal value from ${money(cur.value, cur.currency)} to ${money(d.value, d.currency || cur.currency)}`);
    if (d.hold !== undefined && !!d.hold !== !!cur.hold) act(cur.id, c.me.id, 'deal.hold', d.hold ? 'put the deal on hold' : 'resumed the deal');
    if (d.priority && d.priority !== cur.priority) act(cur.id, c.me.id, 'deal.priority', `changed priority to ${d.priority}`);
    c.json(200, dealOut(db.prepare('SELECT * FROM deals WHERE id = ?').get(cur.id)));
  });
  route('DELETE', '/deals/:id', authenticate, loadDeal({ owner: true }), (c) => {
    db.prepare('UPDATE deals SET deleted_at = ?, updated_at = ? WHERE id = ?').run(iso(), iso(), c.deal.id);
    c.json(204);
  });

  /* ---------- team ---------- */
  route('POST', '/deals/:id/members', authenticate, loadDeal({ owner: true }), body({ email: { t: 'email', req: true }, label: { t: 'str', max: 60 } }), (c) => {
    const u = db.prepare('SELECT id, name, email, access, status, verified_at, deleted_at FROM users WHERE email = ?').get(c.data.email);
    if (!u || u.deleted_at || u.status !== 'active' || !u.verified_at || !J(u.access, {}).crm) throw new Http(404, 'No active CRM member has that email. They need a confirmed account with CRM access.');
    if (db.prepare('SELECT 1 FROM deal_members WHERE deal_id = ? AND user_id = ?').get(c.deal.id, u.id)) throw new Http(409, `${u.name} is already on this deal`);
    if (db.prepare('SELECT count(*) n FROM deal_members WHERE deal_id = ?').get(c.deal.id).n >= MAX_MEMBERS) throw new Http(422, `A deal can have up to ${MAX_MEMBERS} members`);
    db.prepare('INSERT INTO deal_members (deal_id, user_id, label, created_at) VALUES (?,?,?,?)').run(c.deal.id, u.id, c.data.label || 'Team member', iso());
    act(c.deal.id, c.me.id, 'member.added', `added ${u.name} to the team`);
    notify(u.id, 'deal.added', `You were added to "${c.deal.title}"`, `${c.me.name} added you to the deal with ${c.deal.company}.`, { deal_id: c.deal.id });
    c.json(201, { members: membersOf(c.deal.id, c.today) });
  });
  route('PATCH', '/deals/:id/members/:userId', authenticate, loadDeal({ owner: true }), body({ label: { t: 'str', min: 1, max: 60, req: true } }), (c) => {
    const r = db.prepare('UPDATE deal_members SET label = ? WHERE deal_id = ? AND user_id = ?').run(c.data.label, c.deal.id, c.params.userId);
    if (!r.changes) throw new Http(404, 'Member not found');
    c.json(200, { members: membersOf(c.deal.id, c.today) });
  });
  route('DELETE', '/deals/:id/members/:userId', authenticate, loadDeal(), (c) => {
    const self = c.params.userId === c.me.id;
    if (!c.isOwner && !self) throw new Http(403, 'Only the deal owner can remove other members');
    if (c.params.userId === c.deal.owner_id) throw new Http(400, 'The deal owner cannot be removed');
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(c.params.userId);
    const r = db.prepare('DELETE FROM deal_members WHERE deal_id = ? AND user_id = ?').run(c.deal.id, c.params.userId);
    if (!r.changes) throw new Http(404, 'Member not found');
    db.prepare("UPDATE crm_tasks SET assignee_id = ?, updated_at = ? WHERE deal_id = ? AND assignee_id = ? AND status <> 'done' AND deleted_at IS NULL").run(c.deal.owner_id, iso(), c.deal.id, c.params.userId);   // their open tasks go back to the owner
    act(c.deal.id, c.me.id, 'member.removed', self ? `${u.name} left the deal` : `removed ${u.name} from the team`);
    c.json(204);
  });

  /* ---------- key contacts ---------- */
  const contactSpec = { name: { t: 'str', min: 2, max: 120, req: true }, role: { t: 'str', max: 120 }, email: { t: 'email' }, phone: { t: 'str', max: 30 }, tag: { t: 'str', max: 30 } };
  route('POST', '/deals/:id/contacts', authenticate, loadDeal(), body(contactSpec), (c) => {
    const d = c.data, id = uuid();
    db.prepare('INSERT INTO deal_contacts (id, deal_id, name, role, email, phone, tag, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, c.deal.id, d.name, d.role || null, d.email || null, d.phone || null, d.tag || null, iso());
    act(c.deal.id, c.me.id, 'contact.added', `added key contact ${d.name}`);
    c.json(201, { id });
  });
  route('PATCH', '/deals/:id/contacts/:cid', authenticate, loadDeal(), body(contactSpec, true), (c) => {
    const keys = Object.keys(c.data); if (!keys.length) throw new Http(400, 'Nothing to update');
    const r = db.prepare(`UPDATE deal_contacts SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ? AND deal_id = ?`).run(...keys.map((k) => c.data[k]), c.params.cid, c.deal.id);
    if (!r.changes) throw new Http(404, 'Contact not found'); c.json(200, { ok: true });
  });
  route('DELETE', '/deals/:id/contacts/:cid', authenticate, loadDeal(), (c) => {
    if (!db.prepare('DELETE FROM deal_contacts WHERE id = ? AND deal_id = ?').run(c.params.cid, c.deal.id).changes) throw new Http(404, 'Contact not found');
    c.json(204);
  });

  /* ---------- daily progress reports and general notes ---------- */
  const REPORT = 'SELECT r.id, r.kind, r.report_date, r.body, r.status, r.next_step, r.created_at, r.updated_at, u.id AS user_id, u.name, u.avatar_url, m.label FROM deal_reports r JOIN users u ON u.id = r.user_id LEFT JOIN deal_members m ON m.deal_id = r.deal_id AND m.user_id = r.user_id';
  route('GET', '/deals/:id/reports', authenticate, loadDeal(), (c) => {
    const p = [c.deal.id]; let w = '';
    if (c.query.kind === 'daily' || c.query.kind === 'note') { w = 'AND r.kind = ?'; p.push(c.query.kind); }
    const limit = Math.min(200, Math.max(1, parseInt(c.query.limit) || 50));
    c.json(200, { data: db.prepare(`${REPORT} WHERE r.deal_id = ? ${w} ORDER BY r.report_date DESC, r.updated_at DESC LIMIT ${limit}`).all(...p), today: c.today });
  });
  route('POST', '/deals/:id/reports', authenticate, loadDeal(), body({
    kind: { t: 'enum', vals: ['daily', 'note'], def: 'daily' }, body: { t: 'str', min: 3, max: 4000, req: true },
    status: { t: 'enum', vals: ['completed', 'in_progress', 'blocked'] }, next_step: { t: 'str', max: 500 }, report_date: { t: 'str', re: DATE_RE, msg: 'Use the format YYYY-MM-DD' },
  }), (c) => {
    const d = c.data, date = d.report_date || c.today, ts = iso();
    if (!isDay(date) || date > dayOf(1) || date < dayOf(-7)) throw new Http(422, 'Validation failed', { details: { report_date: ['Choose a date within the last 7 days'] } });
    if (d.kind === 'daily') {
      const ex = db.prepare("SELECT id FROM deal_reports WHERE deal_id = ? AND user_id = ? AND kind = 'daily' AND report_date = ?").get(c.deal.id, c.me.id, date);
      if (ex) {   // one daily report per member per day: sending again edits it
        db.prepare('UPDATE deal_reports SET body = ?, status = ?, next_step = ?, updated_at = ? WHERE id = ?').run(d.body, d.status || 'in_progress', d.next_step || null, ts, ex.id);
        act(c.deal.id, c.me.id, 'report.updated', `updated their daily report for ${date}`);
        return c.json(200, { id: ex.id, updated: true });
      }
    }
    const id = uuid();
    db.prepare('INSERT INTO deal_reports (id, deal_id, user_id, kind, report_date, body, status, next_step, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, c.deal.id, c.me.id, d.kind, date, d.body, d.kind === 'daily' ? (d.status || 'in_progress') : null, d.next_step || null, ts, ts);
    act(c.deal.id, c.me.id, d.kind === 'daily' ? 'report.added' : 'note.added', d.kind === 'daily' ? 'added a daily report' : 'added a note');
    c.json(201, { id, updated: false });
  });
  route('PATCH', '/deals/:id/reports/:rid', authenticate, loadDeal(), body({ body: { t: 'str', min: 3, max: 4000 }, status: { t: 'enum', vals: ['completed', 'in_progress', 'blocked'] }, next_step: { t: 'str', max: 500 } }, true), (c) => {
    const r = db.prepare('SELECT * FROM deal_reports WHERE id = ? AND deal_id = ?').get(c.params.rid, c.deal.id);
    if (!r) throw new Http(404, 'Report not found');
    if (r.user_id !== c.me.id) throw new Http(403, 'You can only edit your own reports');
    if (r.kind === 'daily' && r.report_date < dayOf(-1)) throw new Http(403, 'Daily reports can only be edited on the day they are written');
    const d = c.data; db.prepare('UPDATE deal_reports SET body = COALESCE(?, body), status = COALESCE(?, status), next_step = COALESCE(?, next_step), updated_at = ? WHERE id = ?').run(d.body || null, d.status || null, d.next_step || null, iso(), r.id);
    c.json(200, { ok: true });
  });
  route('DELETE', '/deals/:id/reports/:rid', authenticate, loadDeal(), (c) => {
    const r = db.prepare('SELECT user_id FROM deal_reports WHERE id = ? AND deal_id = ?').get(c.params.rid, c.deal.id);
    if (!r) throw new Http(404, 'Report not found');
    if (r.user_id !== c.me.id && !c.isOwner) throw new Http(403, 'Only the author or the deal owner can delete this');
    db.prepare('DELETE FROM deal_reports WHERE id = ?').run(c.params.rid); c.json(204);
  });
  route('GET', '/deals/:id/activity', authenticate, loadDeal(), (c) => {
    const limit = Math.min(200, Math.max(1, parseInt(c.query.limit) || 40));
    c.json(200, { data: db.prepare(`SELECT a.id, a.action, a.summary, a.created_at, u.id AS user_id, u.name, u.avatar_url FROM deal_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.deal_id = ? ORDER BY a.id DESC LIMIT ${limit}`).all(c.deal.id) });
  });

  /* ---------- files ---------- */
  route('GET', '/deals/:id/files', authenticate, loadDeal(), (c) => c.json(200, { data: db.prepare('SELECT f.id, f.name, f.size, f.created_at, u.name AS uploader, f.uploader_id FROM deal_files f JOIN users u ON u.id = f.uploader_id WHERE f.deal_id = ? ORDER BY f.created_at DESC').all(c.deal.id) }));
  route('POST', '/deals/:id/files', authenticate, loadDeal(), async (c) => {
    const ct = c.req.headers['content-type'] || '', m = ct.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) throw new Http(400, 'No file uploaded');
    const buf = await readRaw(c.req, MAX_FILE + 8192);
    const boundary = Buffer.from('--' + (m[1] || m[2])); let file = null, filename = 'file', pos = buf.indexOf(boundary);
    while (pos > -1 && !file) {
      const next = buf.indexOf(boundary, pos + boundary.length); if (next < 0) break;
      const part = buf.subarray(pos + boundary.length + 2, next - 2), split = part.indexOf('\r\n\r\n');
      if (split > -1) { const h = part.subarray(0, split).toString('utf8'); if (/name="file"/i.test(h)) { file = part.subarray(split + 4); const fn = h.match(/filename="([^"]*)"/i); if (fn) filename = fn[1]; } }
      pos = next;
    }
    if (!file || !file.length) throw new Http(400, 'No file uploaded');
    if (file.length > MAX_FILE) throw new Http(413, 'File too large (max 10 MB)');
    filename = sanitizeName(filename);
    if (!fileKind(file, filename)) throw new Http(400, 'Unsupported file. Use PDF, Word, Excel, PowerPoint, PNG, JPG, CSV or TXT.');
    if (db.prepare('SELECT count(*) n FROM deal_files WHERE deal_id = ?').get(c.deal.id).n >= MAX_FILES_PER_DEAL) throw new Http(422, `A deal can hold up to ${MAX_FILES_PER_DEAL} files`);
    const id = uuid(); fs.writeFileSync(path.join(FILE_DIR, id), file);
    db.prepare('INSERT INTO deal_files (id, deal_id, uploader_id, name, stored, size, created_at) VALUES (?,?,?,?,?,?,?)').run(id, c.deal.id, c.me.id, filename, id, file.length, iso());
    act(c.deal.id, c.me.id, 'file.added', `uploaded ${filename}`);
    c.json(201, { id, name: filename, size: file.length });
  });
  route('GET', '/files/:id', authenticate, (c) => {
    const f = db.prepare('SELECT f.* FROM deal_files f JOIN deals d ON d.id = f.deal_id AND d.deleted_at IS NULL JOIN deal_members m ON m.deal_id = f.deal_id AND m.user_id = ? WHERE f.id = ?').get(c.me.id, c.params.id);
    if (!f || !fs.existsSync(path.join(FILE_DIR, f.stored))) throw new Http(404, 'File not found');
    c.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Content-Disposition': `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    fs.createReadStream(path.join(FILE_DIR, f.stored)).pipe(c.res); c.sent = true;
  });
  route('DELETE', '/files/:id', authenticate, (c) => {
    const f = db.prepare('SELECT f.*, d.owner_id FROM deal_files f JOIN deals d ON d.id = f.deal_id AND d.deleted_at IS NULL JOIN deal_members m ON m.deal_id = f.deal_id AND m.user_id = ? WHERE f.id = ?').get(c.me.id, c.params.id);
    if (!f) throw new Http(404, 'File not found');
    if (f.uploader_id !== c.me.id && f.owner_id !== c.me.id) throw new Http(403, 'Only the uploader or the deal owner can delete this file');
    db.prepare('DELETE FROM deal_files WHERE id = ?').run(f.id); try { fs.unlinkSync(path.join(FILE_DIR, f.stored)); } catch (e) { /* already gone */ }
    act(f.deal_id, c.me.id, 'file.removed', `removed ${f.name}`); c.json(204);
  });

  /* ---------- tasks ---------- */
  const VISIBLE = '(t.creator_id = :me OR t.assignee_id = :me OR (t.deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM deal_members m WHERE m.deal_id = t.deal_id AND m.user_id = :me)))';
  const TASK = 'SELECT t.id, t.title, t.description, t.type, t.status, t.priority, t.due_date, t.completed_at, t.created_at, t.deal_id, t.creator_id, t.assignee_id, a.name AS assignee_name, cr.name AS creator_name, d.title AS deal_title, d.company AS deal_company, d.owner_id AS deal_owner_id FROM crm_tasks t JOIN users a ON a.id = t.assignee_id JOIN users cr ON cr.id = t.creator_id LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL';
  const taskOut = (r, me) => ({ id: r.id, title: r.title, description: r.description, type: r.type, status: r.status, priority: r.priority, due_date: r.due_date, completed_at: r.completed_at, created_at: r.created_at,
    assignee: { id: r.assignee_id, name: r.assignee_name }, creator: { id: r.creator_id, name: r.creator_name }, deal: r.deal_id ? { id: r.deal_id, title: r.deal_title, company: r.deal_company } : null,
    can_edit: r.creator_id === me || r.assignee_id === me || r.deal_owner_id === me, can_delete: r.creator_id === me || r.deal_owner_id === me });
  function taskFilter(c, withView) {
    const w = ['t.deleted_at IS NULL', '(t.deal_id IS NULL OR d.id IS NOT NULL)', VISIBLE], p = { me: c.me.id }, q = c.query;
    if (withView) {
      if (q.view === 'today') { w.push("t.status <> 'done' AND t.due_date = :today"); p.today = c.today; }
      else if (q.view === 'overdue') { w.push("t.status <> 'done' AND t.due_date < :today"); p.today = c.today; }
      else if (q.view === 'upcoming') { w.push("t.status <> 'done' AND t.due_date > :today"); p.today = c.today; }
    }
    if (q.status && TASK_STATUS.includes(q.status)) { w.push('t.status = :status'); p.status = q.status; }
    if (q.type && TASK_TYPES.includes(q.type)) { w.push('t.type = :type'); p.type = q.type; }
    if (q.priority && PRIORITY.includes(q.priority)) { w.push('t.priority = :priority'); p.priority = q.priority; }
    if (q.assignee === 'me') w.push('t.assignee_id = :me'); else if (q.assignee && /^[0-9a-f-]{36}$/i.test(q.assignee)) { w.push('t.assignee_id = :assignee'); p.assignee = q.assignee; }
    if (q.deal_id && /^[0-9a-f-]{36}$/i.test(q.deal_id)) { w.push('t.deal_id = :deal'); p.deal = q.deal_id; }
    if (q.q) { w.push('(t.title LIKE :q OR d.title LIKE :q OR d.company LIKE :q)'); p.q = `%${String(q.q).trim()}%`; }
    return { where: w.join(' AND '), p };
  }
  route('GET', '/tasks', authenticate, (c) => {
    const page = Math.max(1, parseInt(c.query.page) || 1), limit = Math.min(1000, Math.max(1, parseInt(c.query.limit) || 25));
    const f = taskFilter(c, true), order = { due: "t.due_date IS NULL, t.due_date ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END", priority: "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.due_date IS NULL, t.due_date", created: 't.created_at DESC', title: 't.title COLLATE NOCASE' }[c.query.sort] || "t.status = 'done', t.due_date IS NULL, t.due_date ASC";
    const rows = db.prepare(`${TASK} WHERE ${f.where} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(f.p);
    const total = db.prepare(`SELECT count(*) n FROM crm_tasks t LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL WHERE ${f.where}`).get(f.p).n;
    const counts = {};
    for (const v of ['all', 'today', 'overdue', 'upcoming']) { const g = taskFilter(Object.assign({}, c, { query: Object.assign({}, c.query, { view: v }) }), true); counts[v] = db.prepare(`SELECT count(*) n FROM crm_tasks t LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL WHERE ${g.where}`).get(g.p).n; }
    c.json(200, { data: rows.map((r) => taskOut(r, c.me.id)), page, limit, total, counts });
  });
  const checkTaskTargets = (c, dealId, assigneeId) => {
    if (dealId) {
      if (!db.prepare('SELECT 1 FROM deals d JOIN deal_members m ON m.deal_id = d.id AND m.user_id = ? WHERE d.id = ? AND d.deleted_at IS NULL').get(c.me.id, dealId)) throw new Http(404, 'Deal not found');
      if (!db.prepare('SELECT 1 FROM deal_members WHERE deal_id = ? AND user_id = ?').get(dealId, assigneeId)) throw new Http(422, 'Validation failed', { details: { assignee_id: ['Assign the task to someone on this deal'] } });
    } else if (assigneeId !== c.me.id) throw new Http(422, 'Validation failed', { details: { assignee_id: ['A task without a deal can only be assigned to yourself'] } });
  };
  route('POST', '/tasks', authenticate, body(taskSpec), (c) => {
    const d = c.data, id = uuid(), ts = iso(), assignee = d.assignee_id || c.me.id;
    checkTaskTargets(c, d.deal_id || null, assignee);
    db.prepare('INSERT INTO crm_tasks (id, creator_id, assignee_id, deal_id, title, description, type, status, priority, due_date, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, c.me.id, assignee, d.deal_id || null, d.title, d.description || null, d.type, d.status, d.priority, d.due_date || null, d.status === 'done' ? ts : null, ts, ts);
    const deal = d.deal_id ? db.prepare('SELECT title FROM deals WHERE id = ?').get(d.deal_id) : null;
    if (deal) act(d.deal_id, c.me.id, 'task.added', `added the task "${d.title}"`);
    if (assignee !== c.me.id) notify(assignee, 'task.assigned', `New task: ${d.title}`, `${c.me.name} assigned you a task${deal ? ` on "${deal.title}"` : ''}.`, { task_id: id, deal_id: d.deal_id || null });
    c.json(201, taskOut(db.prepare(`${TASK} WHERE t.id = ?`).get(id), c.me.id));
  });
  const findTask = (c, id) => db.prepare(`${TASK} WHERE t.id = :id AND t.deleted_at IS NULL AND (t.deal_id IS NULL OR d.id IS NOT NULL) AND ${VISIBLE}`).get({ id, me: c.me.id });
  route('PATCH', '/tasks/:id', authenticate, body(taskSpec, true), (c) => {
    const t = findTask(c, c.params.id); if (!t) throw new Http(404, 'Task not found');
    const me = c.me.id; if (!(t.creator_id === me || t.assignee_id === me || t.deal_owner_id === me)) throw new Http(403, 'You cannot edit this task');
    const d = c.data; if (!Object.keys(d).length) throw new Http(400, 'Nothing to update');
    if (d.deal_id !== undefined && d.deal_id !== t.deal_id) { if (t.creator_id !== me) throw new Http(403, 'Only the creator can move a task to another deal'); }
    const dealId = d.deal_id !== undefined ? d.deal_id : t.deal_id, assignee = d.assignee_id || t.assignee_id;
    if (d.deal_id !== undefined || d.assignee_id) checkTaskTargets(c, dealId, assignee);
    const sets = [], vals = [];
    for (const k of Object.keys(d)) { sets.push(`"${k}" = ?`); vals.push(d[k]); }
    if (d.status) { sets.push('completed_at = ?'); vals.push(d.status === 'done' ? iso() : null); }
    db.prepare(`UPDATE crm_tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, iso(), t.id);
    if (t.deal_id) {
      if (d.status === 'done' && t.status !== 'done') act(t.deal_id, me, 'task.done', `completed the task "${t.title}"`);
      else if (d.status && d.status !== t.status) act(t.deal_id, me, 'task.status', `marked "${t.title}" as ${d.status.replace('_', ' ')}`);
    }
    if (d.assignee_id && d.assignee_id !== t.assignee_id && d.assignee_id !== me) notify(d.assignee_id, 'task.assigned', `New task: ${t.title}`, `${c.me.name} assigned you a task.`, { task_id: t.id, deal_id: dealId });
    c.json(200, taskOut(findTask(c, t.id), me));
  });
  route('DELETE', '/tasks/:id', authenticate, (c) => {
    const t = findTask(c, c.params.id); if (!t) throw new Http(404, 'Task not found');
    if (!(t.creator_id === c.me.id || t.deal_owner_id === c.me.id)) throw new Http(403, 'Only the creator or the deal owner can delete this task');
    db.prepare('UPDATE crm_tasks SET deleted_at = ? WHERE id = ?').run(iso(), t.id); c.json(204);
  });
  route('POST', '/tasks/bulk', authenticate, body({ ids: { t: 'arr', min: 1, max: 100, of: { t: 'uuid' }, req: true }, action: { t: 'enum', vals: ['complete', 'reopen', 'delete'], req: true } }), (c) => {
    let n = 0;
    for (const id of c.data.ids) {
      const t = findTask(c, id); if (!t) continue; const me = c.me.id;
      if (c.data.action === 'delete') { if (t.creator_id === me || t.deal_owner_id === me) { db.prepare('UPDATE crm_tasks SET deleted_at = ? WHERE id = ?').run(iso(), id); n++; } continue; }
      if (!(t.creator_id === me || t.assignee_id === me || t.deal_owner_id === me)) continue;
      const done = c.data.action === 'complete';
      db.prepare('UPDATE crm_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(done ? 'done' : 'todo', done ? iso() : null, iso(), id); n++;
      if (t.deal_id && done && t.status !== 'done') act(t.deal_id, me, 'task.done', `completed the task "${t.title}"`);
    }
    c.json(200, { affected: n });
  });

  /* ---------- notifications (bell) ---------- */
  route('GET', '/notifications', authenticate, (c) => {
    const items = db.prepare('SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 15').all(c.me.id).map((n) => Object.assign(n, { data: J(n.data, null) }));
    const cnt = (extra) => db.prepare(`SELECT count(*) n FROM crm_tasks t LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL WHERE t.deleted_at IS NULL AND (t.deal_id IS NULL OR d.id IS NOT NULL) AND t.assignee_id = ? AND t.status <> 'done' ${extra}`).get(c.me.id, c.today).n;
    c.json(200, { items, unread: db.prepare('SELECT count(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(c.me.id).n, overdue: cnt('AND t.due_date < ?'), due_today: cnt('AND t.due_date = ?') });
  });
  route('POST', '/notifications/read', authenticate, (c) => { db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(iso(), c.me.id); c.json(200, { ok: true }); });

  /* ---------- dispatcher ---------- */
  return async function handle(req, res, sub, query, ctx) {
    let matched = null;
    for (const r of routes) { const m = r.re.exec(sub); if (m && r.method === req.method) { matched = { r, m }; break; } }
    if (!matched) return false;
    const c = { req, res, query, ip: ctx.ip, params: {}, body: null, sent: false, json(status, obj) { ctx.send(status, status === 204 ? undefined : obj); } };
    matched.r.keys.forEach((k, i) => { c.params[k] = decodeURIComponent(matched.m[i + 1]); });
    for (const k of ['id', 'userId', 'cid', 'rid']) if (c.params[k] && !UUID_RE.test(c.params[k])) throw new Http(404, 'Not found');
    const [first, ...rest] = matched.r.fns;
    await first(c);
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !/\/deals\/[^/]+\/files$/.test(sub)) {
      const empty = !req.headers['content-type'] && !Number(req.headers['content-length']) && !req.headers['transfer-encoding'];
      c.body = empty ? {} : await ctx.readJson(req);
    }
    for (const fn of rest) await fn(c);
    return true;
  };
}

function readRaw(req, limit) { // oversized bodies are drained so the client gets a clear 413
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size <= limit) chunks.push(d); else if (size > limit * 4) req.destroy(); });
    req.on('end', () => (size > limit ? reject(new Http(413, 'File too large (max 10 MB)')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

module.exports = { create, STAGES };
