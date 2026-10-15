'use strict';
/**
 * Discover, News and Watchlist API.
 *  - Public (no sign-in needed): published bounties, marketing gigs and jobs, and published news stories.
 *  - Members (signed in and email-confirmed): apply or bid, update or withdraw an application, see their own
 *    applications, and keep a Watchlist of saved stories and opportunities.
 * Everything a visitor can read comes from rows a manager has published in the Control Centre.
 */
const crypto = require('node:crypto');
const { db } = require('./db');
const { parse, Http } = require('./admin-api');

const iso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYM = { USD: '$', NGN: '\u20A6', EUR: '\u20AC', GBP: '\u00A3' };
const COMMIT = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', one_off: 'One-off' };
const MAX_BOOKMARKS = 500;
const money = (v, c) => (SYM[c] || c + ' ') + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const excerpt = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t; };
const today = () => iso().slice(0, 10);

/* a listing is one of three kinds on Discover */
const kindOf = (l) => (l.type === 'job' ? 'job' : l.section === 'marketing' ? 'gig' : 'bounty');
const expired = (l) => !!l.deadline && String(l.deadline).slice(0, 10) < today();
function compText(l) {
  const lo = l.budget_min, hi = l.budget_max, c = l.currency;
  let pay = '';
  if (lo != null && hi != null) pay = lo === hi ? money(hi, c) : `${money(lo, c)} \u2013 ${money(hi, c)}`;
  else if (hi != null) pay = `Up to ${money(hi, c)}`; else if (lo != null) pay = `From ${money(lo, c)}`;
  if (l.type === 'job') return [COMMIT[l.commitment] || 'Full-time', pay].filter(Boolean).join(' \u00B7 ');
  if (kindOf(l) === 'bounty' && pay && lo === hi) return `${pay} Reward`;
  return pay || 'Open to offers';
}
function timeText(l) {
  if (l.type === 'job') {
    const d = Math.floor((Date.now() - new Date(l.published_at || l.created_at)) / 864e5);
    return d <= 0 ? 'Posted today' : d === 1 ? 'Posted 1d ago' : `Posted ${d}d ago`;
  }
  if (!l.deadline) return 'No deadline';
  const days = Math.ceil((new Date(String(l.deadline).slice(0, 10) + 'T23:59:59Z') - Date.now()) / 864e5);
  return days < 0 ? 'Closed' : days === 0 ? 'Last day' : days === 1 ? '1 day left' : `${days} days left`;
}
const listingCard = (l) => ({
  id: l.id, kind: kindOf(l), title: l.title, company: l.company_name || 'IMI Platform', excerpt: excerpt(l.description, 190),
  comp: compText(l), time: timeText(l), deadline: l.deadline, published_at: l.published_at, tags: J(l.tags, []), level: l.level || '', category: l.category || '',
  remote: l.location_type === 'remote', location_type: l.location_type, location_text: l.location_text || '', cover_image_url: l.cover_image_url || null,
  applicants: l.applicants == null ? 0 : l.applicants, open: !expired(l),
});
const PUBLIC_STATUS = "l.status IN ('published','in_progress','closed','completed')";   // what a visitor may see: never drafts or archived
const LIST_SQL = "SELECT l.*, (SELECT count(*) FROM bids b WHERE b.listing_id = l.id) AS applicants FROM listings l WHERE l.deleted_at IS NULL AND l.status = 'published' AND (l.type = 'job' OR (l.type = 'gig' AND l.section IN ('bounty','marketing')))";

/* how well a member's profile matches a listing: a simple, explainable score from 0 to 100 */
function fitScore(user, listing, years, projects) {
  const want = J(listing.tags, []).map((s) => String(s).toLowerCase()), have = J(user.skills, []).map((s) => String(s).toLowerCase());
  const skills = want.length ? Math.round((60 * want.filter((t) => have.includes(t)).length) / want.length) : 30;   // up to 60 for matching skills (30 when none were asked for)
  return Math.max(0, Math.min(100, skills + Math.min(years || 0, 5) * 5 + Math.min(projects || 0, 5) * 3));          // up to 25 for experience, up to 15 for relevant projects
}

function create(deps) {
  const { getSession } = deps;
  const routes = [];
  const route = (method, pattern, ...fns) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, fns });
  };
  const body = (spec, partial) => (c) => { c.data = parse(spec, c.body, partial); };
  const optionalUser = (c) => { c.user = getSession(c.req) || null; if (c.user && !c.user.verified_at) c.user = null; };
  const member = (c) => {
    const u = getSession(c.req);
    if (!u) throw new Http(401, 'Please log in to do this.');
    if (!u.verified_at) throw new Http(403, 'Please confirm your email address first.');
    c.user = u;
  };

  /* ---------- opportunities (public) ---------- */
  route('GET', '/listings', optionalUser, (c) => {
    const p = [], where = [];
    if (c.query.kind === 'bounty') where.push("l.type = 'gig' AND l.section = 'bounty'"); else if (c.query.kind === 'gig') where.push("l.type = 'gig' AND l.section = 'marketing'"); else if (c.query.kind === 'job') where.push("l.type = 'job'");
    if (c.query.q) { p.push(`%${c.query.q}%`, `%${c.query.q}%`, `%${c.query.q}%`); where.push('(l.title LIKE ? OR l.company_name LIKE ? OR l.tags LIKE ?)'); }
    const rows = db.prepare(`${LIST_SQL} ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY l.published_at DESC LIMIT 300`).all(...p);
    c.json(200, { data: rows.filter((l) => !expired(l)).map(listingCard) });
  });
  route('GET', '/listings/:id', optionalUser, (c) => {
    const l = db.prepare(`SELECT l.*, (SELECT count(*) FROM bids b WHERE b.listing_id = l.id) AS applicants FROM listings l WHERE l.id = ? AND l.deleted_at IS NULL AND ${PUBLIC_STATUS} AND (l.type = 'job' OR (l.type = 'gig' AND l.section IN ('bounty','marketing')))`).get(c.params.id);
    if (!l) throw new Http(404, 'This opportunity is no longer available.');
    const card = listingCard(l), isOpen = l.status === 'published' && !expired(l);
    const mine = c.user ? db.prepare('SELECT id, amount, proposal, experience_years, relevant_projects, fit_score, status, created_at FROM bids WHERE listing_id = ? AND bidder_id = ?').get(l.id, c.user.id) : null;
    const own = !!c.user && (l.posted_by === c.user.id || l.created_by === c.user.id);
    c.json(200, Object.assign(card, { description: l.description, currency: l.currency, budget_min: l.budget_min, budget_max: l.budget_max, commitment: l.commitment ? COMMIT[l.commitment] : '',
      status: l.status, open: isOpen, can_apply: isOpen && !own, own_listing: own, my_application: mine, section: l.section || null }));
  });

  /* ---------- applying and bidding (members) ---------- */
  /* a bid needs an amount; a job application does not. Everything missing is reported at once. */
  const applySpec = (l) => ({ amount: { t: 'num', min: 0, req: l.type !== 'job' }, proposal: { t: 'str', min: 20, max: 4000, req: true }, experience_years: { t: 'num', min: 0 }, relevant_projects: { t: 'num', min: 0 } });
  const applyBody = (c) => { c.data = parse(applySpec(c.listing), c.body); };
  const loadOpen = (c) => {
    const l = db.prepare("SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL AND (type = 'job' OR (type = 'gig' AND section IN ('bounty','marketing')))").get(c.params.id);
    if (!l) throw new Http(404, 'This opportunity is no longer available.');
    c.listing = l;
  };
  const check = (c) => {
    const l = c.listing, d = c.data, fields = {};
    if (l.status !== 'published' || expired(l)) throw new Http(409, l.type === 'job' ? 'This position is no longer accepting applications.' : 'This opportunity is closed.');
    if (l.posted_by === c.user.id || l.created_by === c.user.id) throw new Http(403, 'You cannot apply to a listing you posted.');
    if (l.type !== 'job' && d.amount == null) fields.amount = ['Enter the amount you are bidding'];
    if (d.experience_years != null && d.experience_years > 60) fields.experience_years = ['Must be at most 60'];
    if (d.relevant_projects != null && d.relevant_projects > 500) fields.relevant_projects = ['Must be at most 500'];
    if (Object.keys(fields).length) throw new Http(422, 'Validation failed', { details: fields });
    c.vals = { amount: Math.round((d.amount || 0) * 100) / 100, years: d.experience_years == null ? null : Math.round(d.experience_years), projects: d.relevant_projects == null ? null : Math.round(d.relevant_projects) };
  };
  const tooMany = (c) => { if (c.ctx.hit('apply:' + c.user.id, 40, 3600000)) throw new Http(429, 'Too many applications in a short time. Please try again later.'); };
  route('POST', '/listings/:id/apply', member, loadOpen, applyBody, (c) => {
    tooMany(c); check(c);
    const l = c.listing, v = c.vals, ts = iso(), id = uuid();
    if (db.prepare('SELECT 1 FROM bids WHERE listing_id = ? AND bidder_id = ?').get(l.id, c.user.id)) throw new Http(409, 'You have already applied. Update or withdraw your application instead.');
    db.prepare('INSERT INTO bids (id, listing_id, bidder_id, amount, proposal, experience_years, relevant_projects, fit_score, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, l.id, c.user.id, v.amount, c.data.proposal, v.years, v.projects, fitScore(c.user, l, v.years, v.projects), 'pending', ts);
    const note = db.prepare('INSERT INTO notifications (id, user_id, type, title, body, data, created_at) VALUES (?,?,?,?,?,?,?)');
    for (const to of new Set([l.created_by, l.posted_by].filter((x) => x && x !== c.user.id)))
      note.run(uuid(), to, 'bid.received', `${l.type === 'job' ? 'New application' : 'New bid'}: ${l.title}`, `${c.user.name} ${l.type === 'job' ? 'applied' : 'placed a bid'}.`, JSON.stringify({ listing_id: l.id }), ts);
    c.json(201, { id, status: 'pending' });
  });
  route('PUT', '/listings/:id/apply', member, loadOpen, applyBody, (c) => {
    const cur = db.prepare('SELECT id, status FROM bids WHERE listing_id = ? AND bidder_id = ?').get(c.listing.id, c.user.id);
    if (!cur) throw new Http(404, 'You have not applied yet.');
    if (cur.status !== 'pending') throw new Http(409, 'This application is already being reviewed and can no longer be edited.');
    check(c); const v = c.vals;
    db.prepare('UPDATE bids SET amount = ?, proposal = ?, experience_years = ?, relevant_projects = ?, fit_score = ? WHERE id = ?').run(v.amount, c.data.proposal, v.years, v.projects, fitScore(c.user, c.listing, v.years, v.projects), cur.id);
    c.json(200, { id: cur.id, status: 'pending' });
  });
  route('DELETE', '/listings/:id/apply', member, (c) => {
    if (!UUID_RE.test(c.params.id)) throw new Http(404, 'Not found');
    const cur = db.prepare('SELECT id, status FROM bids WHERE listing_id = ? AND bidder_id = ?').get(c.params.id, c.user.id);
    if (!cur) throw new Http(404, 'You have not applied.');
    if (cur.status === 'selected' || cur.status === 'hired') throw new Http(409, 'You have been selected for this one, so it cannot be withdrawn here.');
    db.prepare('DELETE FROM bids WHERE id = ?').run(cur.id);
    c.json(204);
  });
  route('GET', '/applications', member, (c) => {
    const rows = db.prepare("SELECT b.id, b.amount, b.status, b.fit_score, b.created_at, l.id AS listing_id, l.type, l.section, l.title, l.company_name, l.currency, l.status AS listing_status, l.deleted_at FROM bids b JOIN listings l ON l.id = b.listing_id WHERE b.bidder_id = ? ORDER BY b.created_at DESC").all(c.user.id);
    c.json(200, { data: rows.map((r) => ({ id: r.id, status: r.status, amount: r.amount, currency: r.currency, created_at: r.created_at, kind: kindOf(r), title: r.deleted_at ? '(removed)' : r.title, company: r.company_name || 'IMI Platform', listing_id: r.listing_id, listing_status: r.deleted_at ? 'removed' : r.listing_status })) });
  });

  /* ---------- everything the page needs to know about the signed-in member ---------- */
  route('GET', '/me', optionalUser, (c) => {
    if (!c.user) return c.json(200, { member: false });
    const saved = { news: [], listing: [] };
    for (const r of db.prepare('SELECT kind, ref_id FROM bookmarks WHERE user_id = ?').all(c.user.id)) saved[r.kind].push(r.ref_id);
    const applications = {};
    for (const r of db.prepare('SELECT listing_id, status FROM bids WHERE bidder_id = ?').all(c.user.id)) applications[r.listing_id] = r.status;
    c.json(200, { member: true, name: c.user.name, saved, applications });
  });

  /* ---------- news (public) ---------- */
  const storyCard = (n) => ({ id: n.id, title: n.title, category: n.category || 'General', source: n.source || 'IMI Newsroom', summary: n.summary || excerpt(n.body, 170), published_at: n.published_at, read_minutes: Math.max(1, Math.round(String(n.body || '').split(/\s+/).length / 200)) });
  route('GET', '/news', optionalUser, (c) => {
    const p = [], where = ["status = 'published'", 'deleted_at IS NULL'];
    if (c.query.category) { p.push(String(c.query.category).toLowerCase()); where.push('lower(category) = ?'); }
    if (c.query.q) { p.push(`%${c.query.q}%`, `%${c.query.q}%`); where.push('(title LIKE ? OR summary LIKE ?)'); }
    c.json(200, { data: db.prepare(`SELECT id, title, category, source, summary, body, published_at FROM market_news WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT 100`).all(...p).map(storyCard) });
  });
  route('GET', '/news/:id', optionalUser, (c) => {
    const n = db.prepare("SELECT * FROM market_news WHERE id = ? AND status = 'published' AND deleted_at IS NULL").get(c.params.id);
    if (!n) throw new Http(404, 'This story is no longer available.');
    c.json(200, Object.assign(storyCard(n), { body: n.body }));
  });

  /* ---------- Watchlist: saved stories and opportunities, summarised ---------- */
  route('GET', '/watchlist', member, (c) => {
    const rows = db.prepare('SELECT kind, ref_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(c.user.id);
    const apps = {}; for (const r of db.prepare('SELECT listing_id, status FROM bids WHERE bidder_id = ?').all(c.user.id)) apps[r.listing_id] = r.status;
    const items = [], counts = { news: 0, bounty: 0, gig: 0, job: 0, closing_soon: 0, applied: 0 };
    for (const r of rows) {
      if (r.kind === 'news') {
        const n = db.prepare("SELECT id, title, category, source, summary, body, published_at FROM market_news WHERE id = ? AND status = 'published' AND deleted_at IS NULL").get(r.ref_id);
        counts.news++;
        items.push(n ? Object.assign(storyCard(n), { kind: 'news', saved_at: r.created_at, available: true }) : { kind: 'news', id: r.ref_id, title: 'This story is no longer available', saved_at: r.created_at, available: false });
      } else {
        const l = db.prepare(`SELECT l.*, (SELECT count(*) FROM bids b WHERE b.listing_id = l.id) AS applicants FROM listings l WHERE l.id = ? AND l.deleted_at IS NULL AND ${PUBLIC_STATUS} AND (l.type = 'job' OR (l.type = 'gig' AND l.section IN ('bounty','marketing')))`).get(r.ref_id);
        if (!l) { items.push({ kind: 'listing', id: r.ref_id, title: 'This opportunity is no longer available', saved_at: r.created_at, available: false }); continue; }
        const card = listingCard(l), open = l.status === 'published' && !expired(l);
        counts[card.kind]++; if (apps[l.id]) counts.applied++;
        const soon = open && l.deadline && (new Date(String(l.deadline).slice(0, 10) + 'T23:59:59Z') - Date.now()) / 864e5 <= 3; if (soon) counts.closing_soon++;
        items.push(Object.assign(card, { saved_at: r.created_at, available: true, open, closing_soon: !!soon, application: apps[l.id] || null }));
      }
    }
    c.json(200, { counts, items });
  });
  route('POST', '/watchlist', member, body({ kind: { t: 'enum', vals: ['news', 'listing'], req: true }, id: { t: 'uuid', req: true } }), (c) => {
    const { kind, id } = c.data;
    const exists = kind === 'news'
      ? db.prepare("SELECT 1 FROM market_news WHERE id = ? AND status = 'published' AND deleted_at IS NULL").get(id)
      : db.prepare(`SELECT 1 FROM listings l WHERE l.id = ? AND l.deleted_at IS NULL AND ${PUBLIC_STATUS} AND (l.type = 'job' OR (l.type = 'gig' AND l.section IN ('bounty','marketing')))`).get(id);
    if (!exists) throw new Http(404, 'That item is no longer available.');
    if (db.prepare('SELECT count(*) n FROM bookmarks WHERE user_id = ?').get(c.user.id).n >= MAX_BOOKMARKS) throw new Http(422, `Your watchlist can hold up to ${MAX_BOOKMARKS} items.`);
    db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, kind, ref_id, created_at) VALUES (?,?,?,?)').run(c.user.id, kind, id, iso());
    c.json(201, { saved: true });
  });
  route('DELETE', '/watchlist/:kind/:id', member, (c) => {
    if (!['news', 'listing'].includes(c.params.kind) || !UUID_RE.test(c.params.id)) throw new Http(404, 'Not found');
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND kind = ? AND ref_id = ?').run(c.user.id, c.params.kind, c.params.id);
    c.json(204);
  });

  /* ---------- dispatcher ---------- */
  return async function handle(req, res, sub, query, ctx) {
    let matched = null;
    for (const r of routes) { const m = r.re.exec(sub); if (m && r.method === req.method) { matched = { r, m }; break; } }
    if (!matched) return false;
    const c = { req, res, query, ctx, params: {}, body: null, json(status, obj) { ctx.send(status, status === 204 ? undefined : obj); } };
    matched.r.keys.forEach((k, i) => { c.params[k] = decodeURIComponent(matched.m[i + 1]); });
    if (c.params.id && matched.r.keys[0] === 'id' && !UUID_RE.test(c.params.id)) throw new Http(404, 'Not found');
    const [first, ...rest] = matched.r.fns;
    await first(c);
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const empty = !req.headers['content-type'] && !Number(req.headers['content-length']) && !req.headers['transfer-encoding'];
      c.body = empty ? {} : await ctx.readJson(req);
    }
    for (const fn of rest) await fn(c);
    return true;
  };
}
module.exports = { create };
