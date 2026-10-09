/* IMI Platform Control Centre. Loaded only for platform managers (served by /admin.js after an admin check). */
(function () {
'use strict';
const WS = window.IMIWorkspace, X = WS.ext, esc = X.esc, ico = X.ico, toast = X.toast, P = X.P;
const ME = X.member().admin;
const has = (p) => ME.role === 'super_admin' || ME.permissions.indexOf(p) > -1;
let selfId = null;

Object.assign(P, {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9-9M16 7l3 3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
});

/* ---------- styles ---------- */
const css = document.createElement('style'); css.setAttribute('data-ws', '');
css.textContent = `
.adm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-bottom:22px}
.adm-stat{display:flex;gap:14px;align-items:center;border:1px solid var(--line);border-radius:16px;background:var(--glass);padding:18px}
.adm-stat .ic{width:48px;height:48px;border-radius:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.adm-stat small{display:block;color:var(--sub);font-size:12.5px}.adm-stat b{display:block;font-size:26px;line-height:1.2}
.adm-stat span{font-size:12px;font-weight:600}.adm-stat span i{font-style:normal;color:var(--sub);font-weight:400}.up{color:#34d399}.down{color:#f87171}
.adm-cols{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:22px;margin-bottom:22px}
.adm-cols3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-bottom:22px}
.adm-card h3{font-size:16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.adm-seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}.adm-seg button{background:transparent;border:none;color:var(--sub);padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit}
.adm-seg button.on{background:rgba(99,102,241,.25);color:#fff}
.adm-leg{display:flex;gap:16px;font-size:12px;color:var(--sub);margin-bottom:8px;flex-wrap:wrap}.adm-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.adm-li{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}.adm-li:last-child{border-bottom:none}
.adm-li .dot{width:8px;height:8px;border-radius:50%;background:#6366f1;flex-shrink:0}.adm-li small{color:var(--sub);display:block;font-size:11.5px}.adm-li .grow{flex:1;min-width:0}.adm-li .grow>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.adm-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,rgba(59,130,246,.5),rgba(139,92,246,.5));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;object-fit:cover;flex-shrink:0}
.adm-b{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;font-size:11.5px;border:1px solid var(--line);white-space:nowrap;text-transform:capitalize}
.adm-b:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.adm-b.g{color:#34d399;border-color:rgba(52,211,153,.35)}.adm-b.a{color:#fbbf24;border-color:rgba(251,191,36,.35)}.adm-b.r{color:#f87171;border-color:rgba(248,113,113,.35)}.adm-b.b{color:#60a5fa;border-color:rgba(96,165,250,.35)}.adm-b.v{color:#a78bfa;border-color:rgba(167,139,250,.35)}.adm-b.n{color:#8b93a7}
.adm-chip{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.06);font-size:11px;color:var(--sub);margin:0 4px 4px 0}.adm-chip.on{background:rgba(99,102,241,.22);color:#c7d2fe}
.adm-in{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.03);color:var(--text);font-size:14px;font-family:inherit;outline:none}
.adm-in:focus{border-color:#6366f1}.adm-in.sm{width:auto;padding:9px 10px;font-size:13px;height:42px}.adm-in option{background:#111827;color:#eef1f7}textarea.adm-in{min-height:84px;resize:vertical}
.adm-ov{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1500;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow-y:auto}
.adm-modal{width:100%;max-width:560px;background:#0c0f18;border:1px solid var(--line);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6)}.adm-modal.wide{max-width:780px}
.adm-mh{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--line);font-size:17px}.adm-mb{padding:20px 22px 22px}
.adm-x{background:none;border:none;color:var(--sub);cursor:pointer;padding:4px}
.adm-form{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px}.adm-f.span,.adm-foot,.adm-ferr{grid-column:1/-1}
.adm-f label,.adm-lbl{display:block;font-size:12px;color:var(--sub);margin-bottom:6px}.adm-f .req{color:#f87171}.adm-f .hint{font-size:11.5px;color:var(--sub);margin-top:4px}
.adm-ferr{color:#f87171;font-size:13px;min-height:0}.adm-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.adm-checks{display:flex;gap:16px;flex-wrap:wrap}.adm-checks label{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text);margin:0;cursor:pointer}.adm-checks input{accent-color:#6366f1;width:16px;height:16px}
.ws-btn.sec{background:transparent;border:1px solid var(--line);color:var(--text)}.ws-btn.danger{background:linear-gradient(100deg,#ef4444,#dc2626)}
.adm-pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px;font-size:12.5px;color:var(--sub)}
.adm-pager button{background:transparent;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:6px 12px;cursor:pointer;font-family:inherit}.adm-pager button:disabled{opacity:.35;cursor:default}
.adm-bulk{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px;border:1px solid rgba(99,102,241,.45);border-radius:12px;background:rgba(99,102,241,.1);font-size:13px}
.adm-menu{position:absolute;z-index:1600;background:#0c0f18;border:1px solid var(--line);border-radius:10px;padding:5px;min-width:150px;box-shadow:0 14px 36px rgba(0,0,0,.55)}
.adm-menu div{padding:8px 11px;border-radius:7px;font-size:13px;cursor:pointer;text-transform:capitalize}.adm-menu div:hover{background:rgba(255,255,255,.06)}
.adm-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.adm-tabs button{background:transparent;border:1px solid var(--line);border-radius:20px;color:var(--sub);padding:6px 14px;font-size:12.5px;cursor:pointer;font-family:inherit;text-transform:capitalize}.adm-tabs button.on{background:rgba(99,102,241,.25);color:#fff;border-color:rgba(99,102,241,.6)}
.adm-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;min-width:70px}.adm-bar i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6)}
.adm-reco{display:flex;gap:16px;align-items:center;flex-wrap:wrap;border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.07);border-radius:14px;padding:14px 18px;margin-bottom:16px}
.adm-link{background:none;border:none;color:#8ea2ff;cursor:pointer;padding:0;font-family:inherit;font-size:inherit;text-align:left}.adm-link:hover{text-decoration:underline}
.adm-up{display:flex;align-items:center;gap:12px}.adm-up img{width:46px;height:46px;border-radius:10px;object-fit:cover}.adm-up input[type=file]{font-size:12px;color:var(--sub)}
.ws-acts button.warn:hover{color:#fbbf24;border-color:rgba(251,191,36,.4)}
.adm-qgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px 14px;align-items:start}.adm-qgrid .span{grid-column:1/-1}
.adm-qb{background:transparent;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}.adm-qb:hover{border-color:#6366f1}
.adm-steps{display:flex;gap:8px;margin-bottom:18px}.adm-steps span{flex:1;text-align:center;padding:9px 6px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--sub);font-size:12.5px}
.adm-steps .on{background:linear-gradient(100deg,#3b82f6,#6d5cf6);color:#fff;border-color:transparent}
.adm-bgrid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;align-items:start}
.adm-bgrid .ws-table{min-width:0}.adm-bgrid .ws-table th,.adm-bgrid .ws-table td{padding:12px 9px}
@media (max-width:1100px){.adm-bgrid{grid-template-columns:1fr}}
@media (max-width:1100px){.adm-stats{grid-template-columns:repeat(2,1fr)}.adm-cols,.adm-cols3{grid-template-columns:1fr}}
@media (max-width:640px){.adm-form{grid-template-columns:1fr}.adm-stats{grid-template-columns:1fr}}
`;
document.head.appendChild(css);

/* ---------- helpers ---------- */
async function api(method, path, body) {
  const r = await fetch('/api/admin' + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  let j = null; try { j = await r.json(); } catch (e) { /* no body */ }
  if (!r.ok) { const err = new Error((j && j.error) || 'Request failed (' + r.status + ')'); err.details = j && j.details; err.status = r.status; throw err; }
  return j;
}
const qs = (o) => Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).map((k) => k + '=' + encodeURIComponent(o[k])).join('&');
const errMsg = (e) => e.message + (e.details ? ': ' + Object.keys(e.details).map((k) => k + ' ' + e.details[k].join(', ')).join('; ') : '');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const debounce = (fn, ms) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; };
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const avatar = (n, url) => (url ? `<img class="adm-av" src="${esc(url)}" alt="">` : `<span class="adm-av">${esc(initials(n))}</span>`);
const when = (iso) => { if (!iso) return '\u2014'; const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return X.fmtDate(iso); };
const BC = { active: 'g', published: 'g', connected: 'g', hired: 'g', selected: 'g', pending: 'a', draft: 'a', shortlisted: 'a', suspended: 'r', rejected: 'r', error: 'r', closed: 'r', archived: 'n', disconnected: 'n', in_progress: 'b', completed: 'v', premium: 'v', free: 'n' };
const badge = (s) => `<span class="adm-b ${BC[s] || 'n'}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const money = (n, cur) => (n == null ? null : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) + (cur ? ' ' + cur : ''));
const sym = (cur) => ({ USD: '$', NGN: '\u20A6', EUR: '\u20AC', GBP: '\u00A3' }[cur] || (cur ? cur + ' ' : ''));
const fmt0 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const payText = (g) => (g.budget_min != null && g.budget_max != null ? `${sym(g.currency)}${fmt0(g.budget_min)} \u2013 ${sym(g.currency)}${fmt0(g.budget_max)}` : g.budget_min != null ? `${sym(g.currency)}${fmt0(g.budget_min)}+` : g.budget_max != null ? `up to ${sym(g.currency)}${fmt0(g.budget_max)}` : '\u2014');
const pager = (page, limit, total) => (total ? `<div class="adm-pager"><span>${(page - 1) * limit + 1}\u2013${Math.min(page * limit, total)} of ${total}</span><button data-pg="${page - 1}"${page <= 1 ? ' disabled' : ''}>Previous</button><button data-pg="${page + 1}"${page * limit >= total ? ' disabled' : ''}>Next</button></div>` : '');
const empty = (t, s) => `<div class="ws-empty"><b>${t}</b>${s || ''}</div>`;

function modal(title, html, opts) {
  opts = opts || {};
  const ov = el(`<div class="adm-ov" data-ws><div class="adm-modal${opts.wide ? ' wide' : ''}"><div class="adm-mh"><b>${esc(title)}</b><button class="adm-x" data-close>${ico('x', 18)}</button></div><div class="adm-mb">${html}</div></div></div>`);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.body.appendChild(ov);
  return { el: ov, q: (s) => ov.querySelector(s), close };
}
function showErrors(root, err) {
  root.querySelectorAll('[data-e]').forEach((n) => { n.textContent = ''; });
  const top = root.querySelector('[data-e="_form"]');
  if (err.details) { Object.keys(err.details).forEach((k) => { const n = root.querySelector('[data-e="' + k + '"]'); if (n) n.textContent = err.details[k].join(', '); }); if (top) top.textContent = 'Please fix the highlighted fields.'; }
  else if (top) top.textContent = err.message;
}
const field = (name, label, control, o) => { o = o || {}; return `<div class="adm-f${o.span ? ' span' : ''}"><label>${label}${o.req ? ' <span class="req">*</span>' : ''}</label>${control}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}<div class="ws-err" data-e="${name}"></div></div>`; };
const input = (name, val, o) => { o = o || {}; return `<input class="adm-in" name="${name}" type="${o.type || 'text'}" value="${esc(val == null ? '' : val)}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.dis ? ' disabled' : ''}${o.step ? ` step="${o.step}"` : ''} autocomplete="off">`; };
const select = (name, opts, val) => `<select class="adm-in" name="${name}">${opts.map((o) => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
const upload = (name, url) => `<div class="adm-up"><span data-prev>${url ? `<img src="${esc(url)}" alt="">` : ''}</span><input type="file" accept="image/png,image/jpeg" data-up="${name}"><input type="hidden" name="${name}" value="${esc(url || '')}"></div>`;
function wireUploads(root) {
  root.querySelectorAll('[data-up]').forEach((f) => f.addEventListener('change', async () => {
    const file = f.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await fetch('/api/admin/uploads/image', { method: 'POST', credentials: 'same-origin', body: fd }), j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      root.querySelector('[name="' + f.dataset.up + '"]').value = j.url; f.parentNode.querySelector('[data-prev]').innerHTML = `<img src="${esc(j.url)}" alt="">`;
    } catch (e) { toast(e.message); }
  }));
}
function openMenu(anchor, items, pick) {
  document.querySelectorAll('.adm-menu').forEach((m) => m.remove());
  const m = el(`<div class="adm-menu" data-ws>${items.map((i) => `<div data-v="${esc(i)}">${esc(String(i).replace(/_/g, ' '))}</div>`).join('')}</div>`);
  const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + window.scrollY + 6) + 'px'; m.style.left = Math.max(8, r.right + window.scrollX - 160) + 'px';
  m.addEventListener('click', (e) => { const d = e.target.closest('[data-v]'); if (d) { m.remove(); pick(d.dataset.v); } });
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', function off() { m.remove(); document.removeEventListener('click', off); }, { once: true }), 0);
}
const confirmDo = async (msg, fn, ok) => { if (!confirm(msg)) return; try { await fn(); if (ok) toast(ok); } catch (e) { toast(errMsg(e)); } };
const actBtn = (act, id, icon, title, cls) => `<button${cls ? ` class="${cls}"` : ''} title="${title}" data-act="${act}" data-id="${id}">${ico(icon, 15)}</button>`;

/* page registry helper: shell + refresh() so typing in filters never rebuilds the inputs */
const current = {};
function listPage(name, shell, refresh, bind) {
  X.registerPage(name, () => {
    const w = el('<div>' + shell + '</div>');
    const ctx = { w, refresh: () => refresh(w, ctx) };
    current[name] = ctx; bind(w, ctx); ctx.refresh(); return w;
  });
}

/* ---------- dashboard ---------- */
let dashRange = '7d';
function chart(series) {
  const W = 760, H = 250, l = 44, r = 14, t = 14, b = 28, pw = W - l - r, ph = H - t - b;
  const keys = [['users', '#3b82f6'], ['gigs', '#10b981'], ['opportunities', '#f59e0b']];
  const max = Math.max(5, ...series.map((s) => Math.max(s.users, s.gigs, s.opportunities))), top = Math.ceil(max / 4) * 4;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" font-family="inherit">`;
  for (let i = 0; i <= 4; i++) { const y = t + ph * (1 - i / 4); s += `<line x1="${l}" x2="${W - r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.08)"/><text x="${l - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#8b93a7">${Math.round(top * i / 4)}</text>`; }
  const xy = (i, v) => [l + (series.length < 2 ? pw / 2 : pw * i / (series.length - 1)), t + ph * (1 - v / top)];
  keys.forEach(([k, c]) => { s += `<polyline fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" points="${series.map((p, i) => xy(i, p[k]).map((n) => n.toFixed(1)).join(',')).join(' ')}"/>`; const e = xy(series.length - 1, series[series.length - 1][k]); s += `<circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="4" fill="${c}"/>`; });
  [0, Math.floor((series.length - 1) / 2), series.length - 1].forEach((i, n) => { const x = xy(i, 0)[0]; s += `<text x="${x}" y="${H - 6}" font-size="11" fill="#8b93a7" text-anchor="${n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}">${series[i].date.slice(5)}</text>`; });
  return s + '</svg>';
}
X.registerPage('adm-dashboard', async () => {
  const d = await api('GET', '/dashboard?range=' + dashRange), S = d.stats;
  const card = (label, o, icon, c) => `<div class="adm-stat"><div class="ic" style="background:rgba(${c},.16);color:rgb(${c})">${ico(icon, 22)}</div><div><small>${label}</small><b>${o.value.toLocaleString()}</b><span class="${o.change_pct >= 0 ? 'up' : 'down'}">${o.change_pct >= 0 ? '\u25B2' : '\u25BC'} ${Math.abs(o.change_pct)}% <i>vs last week</i></span></div></div>`;
  const cm = d.content_management, last = d.overview.series[d.overview.series.length - 1];
  const w = el(`<div>${X.head('Control Centre', 'Manage your platform, content, users and integrations in one place.', 'grid')}
  <div class="adm-stats">${card('Total Users', S.total_users, 'users', '59,130,246')}${card('Active Gigs', S.active_gigs, 'gift', '16,185,129')}${card('Active Opportunities', S.active_opportunities, 'target', '245,158,11')}${card('API Requests Today', S.api_requests_today, 'activity', '139,92,246')}</div>
  <div class="adm-cols"><section class="ws-card adm-card"><h3>Platform Overview<span class="adm-seg">${['7d', '30d', '90d'].map((r) => `<button data-range="${r}" class="${r === dashRange ? 'on' : ''}">${r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}</button>`).join('')}</span></h3>
    <div class="adm-leg"><span><i style="background:#3b82f6"></i>Users (${last.users})</span><span><i style="background:#10b981"></i>Gigs (${last.gigs})</span><span><i style="background:#f59e0b"></i>Opportunities (${last.opportunities})</span></div>${chart(d.overview.series)}</section>
  <section class="ws-card adm-card"><h3>Recent Activity</h3>${d.recent_activity.length ? d.recent_activity.map((a) => `<div class="adm-li"><span class="dot"></span><div class="grow"><span>${esc(a.summary || a.action)}</span><small>${esc(a.detail || '')}${a.detail ? ' \u00B7 ' : ''}${esc(a.actor || 'System')} \u00B7 ${when(a.created_at)}</small></div></div>`).join('') : empty('No activity yet')}</section></div>
  <div class="adm-cols3"><section class="ws-card adm-card"><h3>Content Management</h3>${[['Bounties', cm.bounty], ['Marketing Gigs', cm.marketing], ['We\u2019re Hiring', cm.job], ['Opportunities', cm.opportunity], ['Market News', cm.market_news], ['Announcements', cm.announcements]].map(([n, o]) => `<div class="adm-li"><div class="grow"><span>${n}</span><small>${o.today} published today</small></div><b>${o.published}</b></div>`).join('')}</section>
  <section class="ws-card adm-card"><h3>Recent Gigs</h3>${d.recent_gigs.map((g) => `<div class="adm-li"><div class="grow"><span>${esc(g.title)}</span><small>${esc(g.company_name || g.category || g.location_type)}</small></div>${badge(g.status)}</div>`).join('') || empty('No gigs yet')}</section>
  <section class="ws-card adm-card"><h3>API Integrations</h3>${d.integrations.length ? d.integrations.map((i) => `<div class="adm-li"><span class="dot" style="background:${i.status === 'connected' ? '#34d399' : i.status === 'error' ? '#f87171' : '#8b93a7'}"></span><div class="grow"><span>${esc(i.name)}</span><small>${i.last_sync_at ? 'Synced ' + when(i.last_sync_at) : 'Never synced'}</small></div>${badge(i.status)}</div>`).join('') : empty('No integrations connected yet', 'Connected services will appear here.')}</section></div>
  <section class="ws-card adm-card"><h3>Latest Users</h3><div class="ws-tablewrap"><table class="ws-table" style="min-width:0"><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Status</th></tr></thead><tbody>${d.latest_users.map((u) => `<tr class="row"><td><div class="ws-name" style="cursor:default">${avatar(u.full_name, u.avatar_url)}<span>${esc(u.full_name)}</span></div></td><td>${esc(u.email)}</td><td>${badge(u.tier)}</td><td>${badge(u.status)}</td></tr>`).join('') || `<tr><td colspan="4">${empty('No users yet')}</td></tr>`}</tbody></table></div></section></div>`);

  w.addEventListener('click', (e) => { const b = e.target.closest('[data-range]'); if (b) { dashRange = b.dataset.range; X.rerender(); } });
  return w;
});
X.onSearch('adm-dashboard', async (q, enter) => {
  if (q.trim().length < 2 || !enter) return;
  try {
    const r = await api('GET', '/search?q=' + encodeURIComponent(q.trim()));
    const grp = (t, list, f) => (list.length ? `<div class="adm-lbl" style="margin-top:12px">${t}</div>` + list.map(f).join('') : '');
    const m = modal('Results for \u201C' + q.trim() + '\u201D', (grp('Users', r.users, (u) => `<div class="adm-li">${avatar(u.full_name)}<div class="grow"><span>${esc(u.full_name)}</span><small>${esc(u.email)}</small></div></div>`) +
      grp('Gigs', r.gigs, (g) => `<div class="adm-li"><div class="grow"><span>${esc(g.title)}</span></div>${badge(g.status)}</div>`) + grp('Opportunities', r.opportunities, (g) => `<div class="adm-li"><div class="grow"><span>${esc(g.title)}</span></div>${badge(g.status)}</div>`) +
      grp('We\u2019re Hiring', r.jobs, (g) => `<div class="adm-li"><div class="grow"><span>${esc(g.title)}</span></div>${badge(g.status)}</div>`)) || empty('Nothing found'));
  } catch (e) { toast(errMsg(e)); }
});

/* ---------- accounts ---------- */
const acc = { q: '', type: '', status: '', tier: '', page: 1 };
function accountModal(u, done) {
  const isNew = !u; u = u || { account_type: 'individual', tier: 'free', status: 'active', access: { main_platform: true, crm: false, admin_dashboard: false, api: false } };
  const a = u.access || {};
  const m = modal(isNew ? 'New account' : 'Edit account', `<form class="adm-form" novalidate><div class="adm-ferr" data-e="_form"></div>
    ${isNew ? field('account_type', 'Account type', select('account_type', [['individual', 'Individual'], ['team', 'Team']], u.account_type)) : ''}
    ${field('full_name', 'Full name', input('full_name', u.full_name), { req: true })}${field('email', 'Email', input('email', u.email, { type: 'email' }), { req: true })}
    ${field('phone', 'Phone', input('phone', u.phone, { ph: '+2348012345678' }))}${field('tier', 'Tier', select('tier', ['free', 'premium'], u.tier))}${field('status', 'Status', select('status', ['active', 'pending', 'suspended'], u.status))}
    ${isNew ? field('password', 'Password', input('password', '', { type: 'password' }), { req: true, hint: 'At least 10 characters. They can change it with a reset link.' }) : ''}
    ${field('bio', 'Bio', `<textarea class="adm-in" name="bio">${esc(u.bio || '')}</textarea>`, { span: true })}${field('avatar_url', 'Avatar', upload('avatar_url', u.avatar_url), { span: true })}
    <div class="adm-f span"><label>Platform access</label><div class="adm-checks">${[['main_platform', 'Main platform'], ['crm', 'CRM'], ['admin_dashboard', 'Admin dashboard'], ['api', 'API']].map(([k, t]) => `<label><input type="checkbox" name="acc_${k}"${a[k] ? ' checked' : ''}${k === 'admin_dashboard' && ME.role !== 'super_admin' ? ' disabled' : ''}>${t}</label>`).join('')}</div>${ME.role !== 'super_admin' ? '<div class="hint">Only a super admin can grant Admin dashboard access.</div>' : ''}<div class="ws-err" data-e="access"></div></div>
    <div class="adm-foot"><button type="button" class="ws-btn sm sec" data-close>Cancel</button><button class="ws-btn sm" type="submit">${isNew ? 'Create account' : 'Save changes'}</button></div></form>`, { wide: true });
  wireUploads(m.el);
  m.q('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, v = (n) => f.elements[n] && f.elements[n].value.trim();
    const body = { full_name: v('full_name'), email: v('email'), tier: v('tier'), status: v('status'), access: { main_platform: f.elements.acc_main_platform.checked, crm: f.elements.acc_crm.checked, admin_dashboard: f.elements.acc_admin_dashboard.checked, api: f.elements.acc_api.checked } };
    ['phone', 'bio', 'avatar_url'].forEach((k) => { if (v(k)) body[k] = v(k); });
    if (isNew) { body.account_type = v('account_type'); body.password = f.elements.password.value; }
    if (ME.role !== 'super_admin') { if (u.access && u.access.admin_dashboard) delete body.access; else body.access.admin_dashboard = false; }   // never touch a manager's dashboard flag from here
    try { if (isNew) await api('POST', '/accounts', body); else await api('PATCH', '/accounts/' + u.id, body); m.close(); toast(isNew ? 'Account created.' : 'Account updated.'); done(); } catch (err) { showErrors(m.el, err); }
  });
}
async function membersModal(team) {
  let t = await api('GET', '/accounts/' + team.id);
  const m = modal('Members of ' + t.full_name, '<div data-list></div><div class="adm-lbl" style="margin-top:18px">Add a member</div><div class="ws-input"><input data-find placeholder="Search by name or email..."></div><div data-found style="margin-top:8px"></div>');
  const draw = () => { m.q('[data-list]').innerHTML = (t.members || []).length ? t.members.map((x) => `<div class="adm-li">${avatar(x.full_name, x.avatar_url)}<div class="grow"><span>${esc(x.full_name)}</span><small>${esc(x.email)}</small></div>${badge(x.member_role === 'owner' ? 'premium' : 'free').replace(/premium|free/, x.member_role)}<button class="adm-link" data-rm="${x.user_id}">Remove</button></div>`).join('') : empty('No members yet'); };
  draw();
  m.el.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]');
    try {
      if (rm) { await api('DELETE', `/accounts/${t.id}/members/${rm.dataset.rm}`); }
      else if (add) { await api('POST', `/accounts/${t.id}/members`, { user_id: add.dataset.add, member_role: add.dataset.role || 'member' }); m.q('[data-found]').innerHTML = ''; m.q('[data-find]').value = ''; }
      else return;
      t = await api('GET', '/accounts/' + t.id); draw();
    } catch (err) { toast(errMsg(err)); }
  });
  m.q('[data-find]').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) { m.q('[data-found]').innerHTML = ''; return; }
    const r = await api('GET', '/accounts?' + qs({ q, limit: 6 }));
    m.q('[data-found]').innerHTML = r.data.filter((u) => u.id !== t.id).map((u) => `<div class="adm-li">${avatar(u.full_name, u.avatar_url)}<div class="grow"><span>${esc(u.full_name)}</span><small>${esc(u.email)}</small></div><button class="adm-link" data-add="${u.id}">Add as member</button><button class="adm-link" data-add="${u.id}" data-role="owner">Add as owner</button></div>`).join('') || empty('No matches');
  }, 250));
}
listPage('adm-accounts',
  `${X.head('Accounts', 'Create and manage platform accounts, tiers and access.', 'users')}<section class="ws-card"><div class="ws-tophead"><div><h2>All accounts (<span data-cnt>0</span>)</h2></div><div class="ws-tools" style="flex-wrap:wrap">
   <div class="ws-input">${ico('search', 16)}<input data-f="q" placeholder="Search name or email..."></div>
   <select class="adm-in sm" data-f="type"><option value="">All types</option><option value="individual">Individual</option><option value="team">Team</option></select>
   <select class="adm-in sm" data-f="status"><option value="">All statuses</option><option>active</option><option>pending</option><option>suspended</option></select>
   <select class="adm-in sm" data-f="tier"><option value="">All tiers</option><option>free</option><option>premium</option></select>
   <button class="ws-btn sm" data-act="new">${ico('plus', 15)}New account</button></div></div>
   <div class="ws-tablewrap"><table class="ws-table"><thead><tr><th>Account</th><th>Type</th><th>Tier</th><th>Status</th><th>Access</th><th>Last login</th><th>Actions</th></tr></thead><tbody data-body></tbody></table></div><div data-pg></div></section>`,
  async (w) => {
    try {
      const d = await api('GET', '/accounts?' + qs({ q: acc.q, type: acc.type, status: acc.status, tier: acc.tier, page: acc.page, limit: 15 }));
      w.querySelector('[data-cnt]').textContent = d.total; w.__rows = d.data;
      w.querySelector('[data-body]').innerHTML = d.data.length ? d.data.map((u) => `<tr class="row"><td><div class="ws-name" style="cursor:default">${avatar(u.full_name, u.avatar_url)}<span>${esc(u.full_name)}<br><small style="color:var(--sub);font-weight:400">${esc(u.email)}</small></span></div></td>
        <td style="text-transform:capitalize">${u.account_type}</td><td>${badge(u.tier)}</td><td>${badge(u.status)}</td>
        <td>${[['main_platform', 'Platform'], ['crm', 'CRM'], ['admin_dashboard', 'Admin'], ['api', 'API']].map(([k, t]) => `<span class="adm-chip${u.access[k] ? ' on' : ''}">${t}</span>`).join('')}</td><td>${when(u.last_login_at)}</td>
        <td><div class="ws-acts">${actBtn('edit', u.id, 'edit', 'Edit')}${u.account_type === 'team' ? actBtn('members', u.id, 'users', 'Members') : ''}${u.id === selfId ? '' : (u.status === 'suspended' ? actBtn('react', u.id, 'check', 'Reactivate') : actBtn('susp', u.id, 'ban', 'Suspend', 'warn'))}${actBtn('reset', u.id, 'key', 'Send password reset link')}${u.id === selfId ? '' : actBtn('del', u.id, 'trash', 'Delete', 'del')}</div></td></tr>`).join('') : `<tr><td colspan="7">${empty('No accounts found', 'Try different filters or create a new account.')}</td></tr>`;
      w.querySelector('[data-pg]').innerHTML = pager(d.page, d.limit, d.total);
    } catch (e) { toast(errMsg(e)); }
  },
  (w, ctx) => {
    ['q', 'type', 'status', 'tier'].forEach((k) => { w.querySelector(`[data-f="${k}"]`).value = acc[k]; });
    w.addEventListener('input', debounce((e) => { if (e.target.dataset.f === 'q') { acc.q = e.target.value; acc.page = 1; ctx.refresh(); } }, 300));
    w.addEventListener('change', (e) => { const k = e.target.dataset.f; if (k && k !== 'q') { acc[k] = e.target.value; acc.page = 1; ctx.refresh(); } });
    w.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-pg] button'); if (pg) { acc.page = +pg.dataset.pg; ctx.refresh(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const u = (w.__rows || []).find((r) => r.id === b.dataset.id), a = b.dataset.act;
      if (a === 'new') WS.go('adm-create');
      else if (a === 'edit') accountModal(u, ctx.refresh);
      else if (a === 'members') membersModal(u);
      else if (a === 'susp') confirmDo(`Suspend ${u.full_name}? They will be signed out immediately.`, async () => { await api('POST', `/accounts/${u.id}/suspend`); ctx.refresh(); }, 'Account suspended.');
      else if (a === 'react') confirmDo(`Reactivate ${u.full_name}?`, async () => { await api('POST', `/accounts/${u.id}/reactivate`); ctx.refresh(); }, 'Account reactivated.');
      else if (a === 'reset') confirmDo(`Email ${u.full_name} a link to choose a new password?`, () => api('POST', `/accounts/${u.id}/reset-password`), 'Reset link sent.');
      else if (a === 'del') confirmDo(`Delete ${u.full_name}? The account is hidden and signed out. This cannot be undone from the screen.`, async () => { await api('DELETE', '/accounts/' + u.id); ctx.refresh(); }, 'Account deleted.');
    });
  });
X.onSearch('adm-accounts', (q) => { acc.q = q; acc.page = 1; const c = current['adm-accounts']; if (c) { c.w.querySelector('[data-f="q"]').value = q; c.refresh(); } });

/* ---------- create account + team members (platform managers) ---------- */
const LABEL = (s) => String(s).replace(/_/g, ' ');
const PERM_LABEL = { manage_content: 'Manage content', view_reports: 'View reports', manage_users: 'Manage users', access_crm: 'Access CRM', manage_listings: 'Manage gigs & opportunities' };
const plabel = (p) => PERM_LABEL[p] || LABEL(p);

/* Create Account: Individual or Team, same fields and wording as the preview */
let createType = 'individual';
X.registerPage('adm-create', () => {
  const w = el('<div></div>');
  const draw = () => {
    const team = createType === 'team';
    w.innerHTML = X.head('Create Account', 'Add a new user or team to the platform.', 'users') +
      `<form class="ws-card" id="acctForm" novalidate style="max-width:720px"><div class="adm-ferr" data-e="_form"></div>
      <div class="adm-seg" style="display:flex;width:100%;margin-bottom:18px"><button type="button" data-type="individual" class="${team ? '' : 'on'}" style="flex:1;padding:10px">Individual Account</button><button type="button" data-type="team" class="${team ? 'on' : ''}" style="flex:1;padding:10px">Team Account</button></div>
      <div class="adm-form">
        ${field('full_name', team ? 'Team name' : 'Full name', input('full_name', ''), { req: true })}${field('email', 'Email address', input('email', '', { type: 'email' }), { req: true })}
        ${field('phone', 'Phone (+234...)', input('phone', '', { ph: '+2348012345678' }))}${field('tier', 'Role', select('tier', [['free', 'Regular User (Free)'], ['premium', 'Premium']], 'free'))}
        ${field('password', 'Password', input('password', '', { type: 'password' }), { req: true, hint: 'At least 10 characters.' })}
        ${field('bio', 'Bio (max 500)', '<textarea class="adm-in" name="bio" maxlength="500" rows="3"></textarea>', { span: true })}
        <div class="adm-f span"><label>Platform access</label><div class="adm-checks"><label><input type="checkbox" name="acc_main_platform" checked>Main Platform</label><label><input type="checkbox" name="acc_crm">CRM / Accounts</label><label><input type="checkbox" name="acc_api">API Access</label></div><div class="ws-err" data-e="access"></div></div>
        <div class="adm-f span"><div class="adm-checks"><label><input type="checkbox" name="active" checked>Account active</label></div></div>
        <div class="adm-foot"><button class="ws-btn sm" type="submit">${ico('plus', 15)}Create Account</button></div></div></form>`;
  };
  draw();
  w.addEventListener('click', (e) => { const t = e.target.closest('[data-type]'); if (t) { createType = t.dataset.type; draw(); } });
  w.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, v = (n) => f.elements[n].value.trim();
    const body = { account_type: createType, full_name: v('full_name'), email: v('email'), tier: v('tier'), password: f.elements.password.value, status: f.elements.active.checked ? 'active' : 'pending',
      access: { main_platform: f.elements.acc_main_platform.checked, crm: f.elements.acc_crm.checked, admin_dashboard: false, api: f.elements.acc_api.checked } };
    ['phone', 'bio'].forEach((k) => { if (v(k)) body[k] = v(k); });
    try { await api('POST', '/accounts', body); toast('Account created. See it on the Dashboard or under Accounts.'); draw(); } catch (err) { showErrors(w, err); }
  });
  return w;
});

/* edit an existing manager's role, department, permissions and status */
async function managerModal(row, done) {
  const rp = await api('GET', '/team-members/roles');
  const checks = (perms) => rp.permissions.map((p) => `<label><input type="checkbox" name="perm_${p}"${perms.indexOf(p) > -1 ? ' checked' : ''}>${plabel(p)}</label>`).join('');
  const m = modal('Edit manager', `<form class="adm-form" novalidate><div class="adm-ferr" data-e="_form"></div>
    <div class="adm-f span"><b>${esc(row.full_name)}</b><div class="hint">${esc(row.email)}</div></div>
    ${field('role', 'Role', select('role', Object.keys(rp.roles).filter((r) => ME.role === 'super_admin' || r !== 'super_admin').map((r) => [r, LABEL(r)]), row.role))}${field('department', 'Department', input('department', row.department))}
    ${field('status', 'Status', select('status', ['active', 'suspended'], row.status))}
    <div class="adm-f span"><label>Permissions</label><div class="adm-checks" data-perms>${checks(row.permissions)}</div><div class="hint">Choosing a role fills in its usual permissions. You can only grant permissions you hold yourself.</div><div class="ws-err" data-e="permissions"></div></div>
    <div class="adm-foot"><button type="button" class="ws-btn sm sec" data-close>Cancel</button><button class="ws-btn sm" type="submit">Save changes</button></div></form>`, { wide: true });
  m.q('[name=role]').addEventListener('change', (e) => { m.q('[data-perms]').innerHTML = checks(rp.roles[e.target.value]); });
  m.q('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const body = { role: f.elements.role.value, status: f.elements.status.value, permissions: rp.permissions.filter((p) => f.elements['perm_' + p].checked), department: f.elements.department.value.trim() || null };
    try { await api('PATCH', '/team-members/' + row.id, body); m.close(); toast('Manager updated.'); done(); } catch (err) { showErrors(m.el, err); }
  });
}

/* Team Members: add form on the left, current managers on the right (as in the preview) */
X.registerPage('adm-team', () => {
  const w = el(`<div>${X.head('Team Members', 'Add platform managers and control what they can do.', 'shield')}
    <div class="ws-cols2"><form class="ws-card" id="staffForm" novalidate><h2>Add Official Team Member</h2><p class="sub">They receive an email with a link to set their password (valid for 72 hours).</p>
      <div class="adm-ferr" data-e="_form"></div><div class="adm-form" style="grid-template-columns:1fr">
      ${field('full_name', 'Name', input('full_name', ''), { req: true })}${field('email', 'Email', input('email', '', { type: 'email' }), { req: true })}
      ${field('role', 'Role', '<select class="adm-in" name="role" data-role></select>')}${field('department', 'Department', input('department', ''))}
      <div class="adm-f"><label>Permissions</label><div class="adm-checks" data-perms style="flex-direction:column;align-items:flex-start;gap:9px"></div><div class="ws-err" data-e="permissions"></div></div>
      <div class="adm-foot"><button class="ws-btn sm" type="submit">${ico('plus', 15)}Add Team Member</button></div></div></form>
    <section class="ws-card"><h2>Platform Managers (<span data-cnt>0</span>)</h2><div data-list style="margin-top:10px"></div></section></div></div>`);
  let rp = null, rows = [];
  const preset = (role) => { w.querySelectorAll('[name=p]').forEach((c) => { c.checked = (rp.roles[role] || []).indexOf(c.value) > -1; }); };
  const refresh = async () => {
    try {
      const d = await api('GET', '/team-members'); rows = d.data; w.querySelector('[data-cnt]').textContent = rows.length;
      w.querySelector('[data-list]').innerHTML = rows.length ? rows.map((u) => `<div class="adm-li">${avatar(u.full_name, u.avatar_url)}<div class="grow"><span><b>${esc(u.full_name)}</b> <span class="adm-b v">${LABEL(u.role)}</span>${u.account_status === 'pending' ? ' ' + badge('pending') : u.status === 'suspended' ? ' ' + badge('suspended') : ''}</span><small>${esc(u.email)} \u00B7 ${u.permissions.length} permission${u.permissions.length === 1 ? '' : 's'}${u.department ? ' \u00B7 ' + esc(u.department) : ''}</small></div>
        ${u.id === selfId ? '<small style="color:var(--sub)">You</small>' : `<button class="ws-btn sm sec" data-edit="${u.id}">Edit</button><button class="ws-btn sm sec" data-revoke="${u.id}">Revoke</button>`}</div>`).join('') : empty('No managers yet');
    } catch (e) { toast(errMsg(e)); }
  };
  api('GET', '/team-members/roles').then((r) => {
    rp = r;
    w.querySelector('[data-role]').innerHTML = Object.keys(r.roles).filter((k) => ME.role === 'super_admin' || k !== 'super_admin').map((k) => `<option value="${k}"${k === 'team_member' ? ' selected' : ''}>${LABEL(k)}</option>`).join('');
    w.querySelector('[data-perms]').innerHTML = r.permissions.map((p) => `<label><input type="checkbox" name="p" value="${p}">${plabel(p)}</label>`).join('');
    preset('team_member');
  });
  w.addEventListener('change', (e) => { if (e.target.matches('[data-role]') && rp) preset(e.target.value); });
  w.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), rv = e.target.closest('[data-revoke]');
    if (ed) managerModal(rows.find((r) => r.id === ed.dataset.edit), refresh);
    else if (rv) { const u = rows.find((r) => r.id === rv.dataset.revoke); confirmDo(`Revoke Control Centre access for ${u.full_name}? Their normal account stays.`, async () => { await api('DELETE', '/team-members/' + u.id); refresh(); }, 'Access revoked.'); }
  });
  w.querySelector('#staffForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, v = (n) => f.elements[n].value.trim();
    const body = { full_name: v('full_name'), email: v('email'), role: f.elements.role.value, permissions: [...f.querySelectorAll('[name=p]')].filter((c) => c.checked).map((c) => c.value) };
    if (v('department')) body.department = v('department');
    try { await api('POST', '/team-members', body); toast('Invite link sent to ' + body.email + '.'); f.reset(); preset('team_member'); refresh(); } catch (err) { showErrors(f, err); }
  });
  refresh(); return w;
});

/* ---------- gigs / opportunities / jobs ---------- */
const LST = { gigs: { one: 'Gig', many: 'Gigs', plural: 'gigs', icon: 'gift', page: 'adm-gigs', sub: 'Bounties and marketing gigs that members can bid on. Hiring posts live under We\u2019re Hiring.' }, opportunities: { one: 'Opportunity', many: 'Opportunities', plural: 'opportunities', icon: 'target', page: 'adm-opps', sub: 'Grants, programs and other openings.' }, jobs: { one: 'Job', many: 'We\u2019re Hiring', plural: 'hiring posts', icon: 'briefcase', page: 'adm-jobs', sub: 'Open roles, shown under We\u2019re Hiring on the Discover page.' } };
const SEC = { bounty: ['Bounty', 'v'], marketing: ['Marketing gig', 'b'] };
const secBadge = (s) => (SEC[s] ? `<span class="adm-b ${SEC[s][1]}">${SEC[s][0]}</span>` : '<span class="adm-b n">\u2014</span>');
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function listingModal(kind, row, done) {
  const L = LST[kind], isNew = !row; row = row || { location_type: 'remote', currency: 'USD', status: 'draft', tags: [] };
  const m = modal((isNew ? 'New ' : 'Edit ') + L.one.toLowerCase(), `<form class="adm-form" novalidate><div class="adm-ferr" data-e="_form"></div>
    ${field('title', 'Title', input('title', row.title), { req: true, span: true })}${field('description', 'Description', `<textarea class="adm-in" name="description" style="min-height:120px">${esc(row.description || '')}</textarea>`, { req: true, span: true })}
    ${kind === 'gigs' ? field('section', 'Section', select('section', [['bounty', 'Bounty'], ['marketing', 'Marketing gig']], row.section || 'bounty'), { req: true, hint: 'Hiring posts are added under We\u2019re Hiring.' }) : ''}
    ${field('category', 'Category', input('category', row.category))}${field('company_name', 'Company', input('company_name', row.company_name))}
    ${field('location_type', 'Location type', select('location_type', ['remote', 'onsite', 'hybrid'], row.location_type))}${field('location_text', 'Location', input('location_text', row.location_text, { ph: 'e.g. Lagos, Nigeria' }))}
    ${field('commitment', 'Commitment', select('commitment', [['', 'Not specified'], ['full_time', 'Full time'], ['part_time', 'Part time'], ['contract', 'Contract'], ['one_off', 'One-off']], row.commitment || ''))}${field('currency', 'Currency', input('currency', row.currency, { ph: 'USD' }), { hint: '3-letter code' })}
    ${field('budget_min', 'Budget from', input('budget_min', row.budget_min, { type: 'number', step: 'any' }))}${field('budget_max', 'Budget to', input('budget_max', row.budget_max, { type: 'number', step: 'any' }))}
    ${field('deadline', 'Deadline', input('deadline', toLocalInput(row.deadline), { type: 'datetime-local' }))}${field('tags', 'Tags', input('tags', (row.tags || []).join(', '), { ph: 'react, design' }), { hint: 'Comma separated, up to 15' })}
    ${field('cover_image_url', 'Cover image', upload('cover_image_url', row.cover_image_url), { span: true })}
    ${isNew ? field('status', 'Publish now?', select('status', [['draft', 'Save as draft'], ['published', 'Publish immediately']], 'draft')) : ''}
    <div class="adm-foot"><button type="button" class="ws-btn sm sec" data-close>Cancel</button><button class="ws-btn sm" type="submit">${isNew ? 'Create ' + L.one.toLowerCase() : 'Save changes'}</button></div></form>`, { wide: true });
  wireUploads(m.el);
  m.q('form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, v = (n) => f.elements[n].value.trim(), body = { title: v('title'), description: v('description'), location_type: v('location_type'), currency: v('currency') || 'USD' };
    ['category', 'company_name', 'location_text', 'cover_image_url', 'commitment'].forEach((k) => { if (v(k)) body[k] = v(k); });
    ['budget_min', 'budget_max'].forEach((k) => { if (v(k) !== '') body[k] = Number(v(k)); });
    if (v('deadline')) body.deadline = new Date(v('deadline')).toISOString();
    body.tags = v('tags').split(',').map((t) => t.trim()).filter(Boolean);
    if (kind === 'gigs') body.section = f.elements.section.value;
    if (isNew) body.status = f.elements.status.value;
    try { if (isNew) await api('POST', '/' + kind, body); else await api('PATCH', `/${kind}/${row.id}`, body); m.close(); toast(isNew ? L.one + ' created.' : L.one + ' updated.'); done(); } catch (err) { showErrors(m.el, err); }
  });
}
const lst = { gigs: { q: '', status: '', section: '', page: 1, sel: new Set() }, opportunities: { q: '', status: '', section: '', page: 1, sel: new Set() }, jobs: { q: '', status: '', section: '', page: 1, sel: new Set() } };
let bidGig = null;
/* "Post a Gig" quick card (as in the preview). Gigs can be posted as a Bounty, a Marketing gig or under We're Hiring. */
function quickCard(kind) {
  const L = LST[kind], gigs = kind === 'gigs';
  return `<form class="ws-card" data-quick novalidate style="margin-bottom:18px"><h2 style="font-size:17px;margin-bottom:12px">${gigs ? 'Post a Gig' : 'Post ' + (kind === 'jobs' ? 'a hiring post' : 'an opportunity')}</h2><div class="adm-ferr" data-e="_form"></div>
    <div class="adm-qgrid">${gigs ? `<div class="adm-f span"><label>Post under</label><div class="adm-seg" data-wherebox><button type="button" data-where="bounty" class="on">Bounty</button><button type="button" data-where="marketing">Marketing gig</button><button type="button" data-where="hiring">We\u2019re hiring</button></div></div>` : ''}
    ${field('title', 'Title', input('title', '', { ph: 'e.g. Community Manager' }), { req: true })}${field('company_name', 'Company / Category', input('company', '', { ph: 'e.g. Web3Hub' }))}
    ${field('budget_min', 'Budget min', input('min', '', { type: 'number', step: 'any' }), { req: true })}${field('budget_max', 'Budget max', input('max', '', { type: 'number', step: 'any' }), { req: true })}
    ${field('currency', 'Currency', select('currency', [['USD', 'USD ($)'], ['NGN', 'NGN (\u20A6)'], ['EUR', 'EUR (\u20AC)'], ['GBP', 'GBP (\u00A3)']], 'USD'))}${field('status', 'Status', select('status', [['draft', 'Draft'], ['published', 'Publish now']], 'draft'))}
    ${field('description', 'Description', '<textarea class="adm-in" name="description" rows="2" placeholder="What is this about? (at least 10 characters)"></textarea>', { req: true, span: true })}
    <div class="adm-f span"><button class="ws-btn sm" type="submit">${ico('plus', 15)}Create ${gigs ? 'Gig' : L.one}</button></div></div></form>`;
}
function bindQuick(w, kind, ctx) {
  const form = w.querySelector('[data-quick]'); let where = 'bounty';
  form.addEventListener('click', (e) => { const b = e.target.closest('[data-where]'); if (!b) return; where = b.dataset.where; form.querySelectorAll('[data-where]').forEach((x) => x.classList.toggle('on', x === b)); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = (n) => form.elements[n].value.trim();
    if (v('min') === '' || v('max') === '') { toast('Enter a budget range.'); return; }
    if (Number(v('min')) > Number(v('max'))) { toast('Budget min must be \u2264 max'); return; }
    const body = { title: v('title'), description: v('description'), budget_min: Number(v('min')), budget_max: Number(v('max')), currency: v('currency'), status: v('status') };
    if (v('company')) body.company_name = v('company');
    let path = '/' + kind;
    if (kind === 'gigs') { if (where === 'hiring') path = '/jobs'; else body.section = where; }
    try {
      await api('POST', path, body); form.reset();
      toast(kind === 'gigs' && where === 'hiring' ? 'Posted under We\u2019re Hiring. Find it on the We\u2019re Hiring screen.' : (kind === 'gigs' ? (where === 'marketing' ? 'Marketing gig' : 'Bounty') : LST[kind].one) + ' created.');
      ctx.refresh();
    } catch (err) { showErrors(form, err); }
  });
}
Object.keys(LST).forEach((kind) => {
  const L = LST[kind], S = lst[kind];
  listPage(L.page,
    `${X.head(L.many, L.sub, L.icon)}${quickCard(kind)}<section class="ws-card"><div class="ws-tophead"><div><h2>All ${L.plural} (<span data-cnt>0</span>)</h2></div><div class="ws-tools" style="flex-wrap:wrap"><div class="ws-input">${ico('search', 16)}<input data-f="q" placeholder="Search title or company..."></div>
     <select class="adm-in sm" data-f="status"><option value="">All statuses</option>${['draft', 'published', 'in_progress', 'completed', 'closed', 'archived'].map((s) => `<option value="${s}">${LABEL(s)}</option>`).join('')}</select>
     <button class="ws-btn sm" data-act="new">${ico('plus', 15)}New ${L.one.toLowerCase()}</button></div></div><div data-bulk></div>${kind === 'gigs' ? '<div class="adm-tabs" data-tabs></div>' : ''}
     <div class="ws-tablewrap"><table class="ws-table"><thead><tr><th style="width:40px"><input type="checkbox" class="ws-cb" data-all></th><th>${L.one}</th>${kind === 'gigs' ? '<th>Section</th>' : ''}<th>Status</th><th>Where</th><th>Pay</th><th>Deadline</th>${kind === 'gigs' ? '<th>Bids</th>' : ''}<th>Updated</th><th>Actions</th></tr></thead><tbody data-body></tbody></table></div><div data-pg></div></section>`,
    async (w) => {
      try {
        const d = await api('GET', `/${kind}?` + qs({ q: S.q, status: S.status, section: S.section, page: S.page, limit: 15 }));
        if (kind === 'gigs') {   // tabs: All / Bounties / Marketing gigs, each with its count under the current search + status
          const cnt = await Promise.all(['', 'bounty', 'marketing'].map((sec) => api('GET', '/gigs?' + qs({ q: S.q, status: S.status, section: sec, limit: 1 })).then((r) => r.total)));
          w.querySelector('[data-tabs]').innerHTML = [['', 'All'], ['bounty', 'Bounties'], ['marketing', 'Marketing gigs']].map(([v, t], i) => `<button data-sec="${v}" class="${S.section === v ? 'on' : ''}">${t} (${cnt[i]})</button>`).join('');
        }
        w.querySelector('[data-cnt]').textContent = d.total; w.__rows = d.data;
        w.querySelector('[data-body]').innerHTML = d.data.length ? d.data.map((g) => {
          const bud = payText(g);
          return `<tr class="row"><td><input type="checkbox" class="ws-cb" data-sel="${g.id}"${S.sel.has(g.id) ? ' checked' : ''}></td><td><b>${esc(g.title)}</b><br><small style="color:var(--sub)">${esc(g.company_name || g.category || '')}</small></td>${kind === 'gigs' ? `<td>${secBadge(g.section)}</td>` : ''}<td>${badge(g.status)}</td>
          <td style="text-transform:capitalize">${g.location_type}<br><small style="color:var(--sub)">${esc(g.location_text || '')}</small></td><td>${bud}</td><td>${g.deadline ? X.fmtDate(g.deadline) : '\u2014'}</td>
          ${kind === 'gigs' ? `<td>${g.bids_count ? `<button class="adm-link" data-act="bids" data-id="${g.id}">${g.bids_count} bid${g.bids_count === 1 ? '' : 's'}</button>` : '0'}</td>` : ''}<td>${when(g.updated_at)}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${g.status === 'published' ? `<button class="adm-qb" data-act="q" data-id="${g.id}" data-v="draft">Unpublish</button><button class="adm-qb" data-act="q" data-id="${g.id}" data-v="closed">Close</button>` : (g.status === 'draft' || g.status === 'closed') ? `<button class="adm-qb" data-act="q" data-id="${g.id}" data-v="published">Publish</button>` : ''}</div><div class="ws-acts">${actBtn('edit', g.id, 'edit', 'Edit')}${actBtn('status', g.id, 'more', 'More status options')}${kind === 'gigs' ? actBtn('bids', g.id, 'users', 'Bids & selection') : ''}${actBtn('del', g.id, 'trash', 'Delete', 'del')}</div></td></tr>`;
        }).join('') : `<tr><td colspan="9">${empty('No ' + L.plural + ' found', 'Create one to get started.')}</td></tr>`;
        w.querySelector('[data-pg]').innerHTML = pager(d.page, d.limit, d.total);
        const bulk = w.querySelector('[data-bulk]');
        bulk.innerHTML = S.sel.size ? `<div class="adm-bulk"><b>${S.sel.size} selected</b>${['publish', 'unpublish', 'close', 'archive', 'delete'].map((a) => `<button class="ws-btn sm ${a === 'delete' ? 'danger' : 'sec'}" data-bulk="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>` : '';
      } catch (e) { toast(errMsg(e)); }
    },
    (w, ctx) => {
      bindQuick(w, kind, ctx);
      w.querySelector('[data-f="q"]').value = S.q; w.querySelector('[data-f="status"]').value = S.status;
      w.addEventListener('input', debounce((e) => { if (e.target.dataset.f === 'q') { S.q = e.target.value; S.page = 1; ctx.refresh(); } }, 300));
      w.addEventListener('change', (e) => {
        if (e.target.dataset.f === 'status') { S.status = e.target.value; S.page = 1; ctx.refresh(); }
        else if (e.target.dataset.sel) { if (e.target.checked) S.sel.add(e.target.dataset.sel); else S.sel.delete(e.target.dataset.sel); ctx.refresh(); }
        else if (e.target.dataset.all !== undefined) { (w.__rows || []).forEach((r) => { if (e.target.checked) S.sel.add(r.id); else S.sel.delete(r.id); }); ctx.refresh(); }
      });
      w.addEventListener('click', (e) => {
        const pg = e.target.closest('[data-pg] button'); if (pg) { S.page = +pg.dataset.pg; ctx.refresh(); return; }
        const sc = e.target.closest('[data-sec]'); if (sc) { S.section = sc.dataset.sec; S.page = 1; S.sel.clear(); ctx.refresh(); return; }
        const bk = e.target.closest('[data-bulk]');
        if (bk) { const a = bk.dataset.bulk; confirmDo(`${a[0].toUpperCase() + a.slice(1)} ${S.sel.size} ${L.plural}?`, async () => { await api('POST', `/${kind}/bulk`, { ids: [...S.sel], action: a }); S.sel.clear(); ctx.refresh(); }, 'Done.'); return; }
        const b = e.target.closest('[data-act]'); if (!b) return; const g = (w.__rows || []).find((r) => r.id === b.dataset.id), a = b.dataset.act;
        if (a === 'new') listingModal(kind, null, ctx.refresh);
        else if (a === 'edit') listingModal(kind, g, ctx.refresh);
        else if (a === 'bids') { bidGig = g.id; WS.go('adm-bids'); }
        else if (a === 'q') { api('POST', `/${kind}/${g.id}/status`, { status: b.dataset.v }).then(() => { toast(L.one + ' ' + LABEL(b.dataset.v === 'draft' ? 'unpublished' : b.dataset.v) + '.'); ctx.refresh(); }).catch((err) => toast(errMsg(err))); }
        else if (a === 'status') openMenu(b, ['draft', 'published', 'completed', 'closed', 'archived'].filter((s) => s !== g.status), async (s) => { try { await api('POST', `/${kind}/${g.id}/status`, { status: s }); toast(L.one + ' ' + LABEL(s) + '.'); ctx.refresh(); } catch (err) { toast(errMsg(err)); } });
        else if (a === 'del') confirmDo(`Delete \u201C${g.title}\u201D?`, async () => { await api('DELETE', `/${kind}/${g.id}`); S.sel.delete(g.id); ctx.refresh(); }, L.one + ' deleted.');
      });
    });
  X.onSearch(L.page, (q) => { S.q = q; S.page = 1; const c = current[L.page]; if (c) { c.w.querySelector('[data-f="q"]').value = q; c.refresh(); } });
});

/* ---------- bids & selection (preview layout): 1 Review bids, 2 Select participant, 3 Notify & hire ---------- */
const bs = { tab: 'all', sort: 'fit', sel: new Set() };
function compareModal(rows) {
  const r = (label, f) => `<tr><th style="width:150px">${label}</th>${rows.map((b) => `<td>${f(b)}</td>`).join('')}</tr>`;
  modal('Compare candidates', `<div class="ws-tablewrap"><table class="ws-table" style="min-width:0">${r('Candidate', (b) => `<b>${esc(b.full_name)}</b><br><small style="color:var(--sub)">${esc(b.handle || '')}</small>`)}${r('Fit score', (b) => (b.fit_score == null ? '\u2014' : b.fit_score + '%'))}${r('Bid amount', (b) => money(b.amount))}${r('Rating', (b) => (b.rating_avg == null ? '\u2014' : '\u2605 ' + Number(b.rating_avg).toFixed(1) + ' (' + b.rating_count + ')'))}${r('Experience', (b) => (b.experience_years == null ? '\u2014' : b.experience_years + ' yrs'))}${r('Relevant projects', (b) => (b.relevant_projects == null ? '\u2014' : b.relevant_projects))}${r('Skills', (b) => b.skills.map((s) => `<span class="adm-chip">${esc(s)}</span>`).join('') || '\u2014')}${r('Proposal', (b) => esc(b.proposal || '\u2014'))}${r('Status', (b) => badge(b.status))}</table></div>`, { wide: true });
}
X.registerPage('adm-bids', () => {
  const w = el('<div></div>');
  const who = (b) => `<div style="display:flex;align-items:center;gap:10px">${avatar(b.full_name, b.avatar_url)}<span>${esc(b.full_name)}<br><small style="color:var(--sub);font-weight:400">${esc(b.handle || '')}${b.rating_avg != null ? ' \u00B7 \u2605 ' + Number(b.rating_avg).toFixed(1) : ''}</small></span></div>`;
  const fitCls = (n) => (n == null ? '' : n < 70 ? 'color:#fbbf24' : 'color:#34d399');
  const chooser = async () => {
    w.innerHTML = X.head('Bids & Selection', 'Choose a gig to review its bids, pick a participant and hire.', 'users') + '<section class="ws-card"><div class="ws-empty"><b>Loading\u2026</b></div></section>';
    try {
      const d = await api('GET', '/gigs?limit=100'), list = d.data.filter((g) => g.bids_count > 0);
      if (list.length === 1) { bidGig = list[0].id; return load(); }
      w.innerHTML = X.head('Bids & Selection', 'Choose a gig to review its bids, pick a participant and hire.', 'users') +
        `<section class="ws-card"><h2>Gigs with bids (${list.length})</h2><p class="sub">Open one to review its bids.</p>` +
        (list.length ? list.map((g) => `<div class="adm-li"><div class="grow"><span><b>${esc(g.title)}</b></span><small>${esc(g.company_name || '')}</small></div>${secBadge(g.section)}${badge(g.status)}<span style="color:var(--sub);font-size:13px">${g.bids_count} bid${g.bids_count === 1 ? '' : 's'}</span><button class="ws-btn sm" data-open="${g.id}">Open</button></div>`).join('') : empty('No bids yet', 'When members bid on a gig, it appears here.')) + '</section>';
    } catch (e) { w.innerHTML = X.head('Bids & Selection', '', 'users') + empty('Could not load gigs', esc(errMsg(e))); }
  };
  const load = async () => {
    try {
      const [d, rec] = await Promise.all([api('GET', `/gigs/${bidGig}/bids?sort=${bs.sort}`), api('GET', `/gigs/${bidGig}/bids/recommendation`)]);
      const g = d.gig, all = d.data; w.__all = all;
      const rows = bs.tab === 'all' ? all : all.filter((b) => b.status === bs.tab);
      const sel = all.find((b) => b.status === 'selected' || b.status === 'hired'), hired = d.counts.hired > 0 || g.status === 'in_progress';
      const step = hired ? 3 : d.counts.selected ? 2 : 1, pay = payText(g);
      w.innerHTML = X.head(esc(g.title), 'Bids &amp; Selection \u00B7 ' + badge(hired ? 'in_progress' : g.status) + (pay !== '\u2014' ? ' \u00B7 ' + pay : ''), 'users') +
        `<button class="adm-link" data-back style="margin-bottom:14px;display:inline-flex;align-items:center;gap:6px">${ico('back', 16)}All gigs with bids</button>
        <div class="adm-steps">${['1 Review Bids', '2 Select Participant', '3 Notify & Hire'].map((t, i) => `<span class="${step === i + 1 ? 'on' : ''}">${t}</span>`).join('')}</div>
        <div class="adm-bgrid"><section class="ws-card"><div class="ws-tophead"><div><h2 style="font-size:18px">Bids Received (${d.counts.all})</h2></div>
          <div class="ws-tools"><select class="adm-in sm" data-sort>${[['fit', 'Best fit'], ['amount_asc', 'Lowest bid'], ['amount_desc', 'Highest bid'], ['rating', 'Top rated'], ['newest', 'Newest']].map(([v, t]) => `<option value="${v}"${bs.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>
          <div class="adm-tabs">${['all', 'shortlisted', 'pending', 'rejected', 'selected', 'hired'].map((t) => `<button data-tab="${t}" class="${bs.tab === t ? 'on' : ''}">${t} (${d.counts[t] || 0})</button>`).join('')}</div>
          ${bs.sel.size ? `<div class="adm-bulk"><b>${bs.sel.size} selected</b>${hired ? '' : '<button class="ws-btn sm sec" data-bulkst="shortlisted">Shortlist</button><button class="ws-btn sm sec" data-bulkst="rejected">Reject</button><button class="ws-btn sm sec" data-bulkst="pending">Reset</button>'}<button class="ws-btn sm sec" data-compare${bs.sel.size < 2 || bs.sel.size > 6 ? ' disabled' : ''}>Compare</button></div>` : ''}
          <div class="ws-tablewrap"><table class="ws-table"><thead><tr><th style="width:40px"></th><th>Candidate</th><th>Bid</th><th>Fit</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.length ? rows.map((b) => `<tr class="row"><td><input type="checkbox" class="ws-cb" data-sel="${b.id}"${bs.sel.has(b.id) ? ' checked' : ''}></td><td>${who(b)}</td><td>${sym(g.currency)}${Number(b.amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
            <td style="font-weight:700;${fitCls(b.fit_score)}">${b.fit_score == null ? '\u2014' : b.fit_score + '%'}</td><td>${badge(b.status)}</td>
            <td><div style="display:flex;gap:6px;flex-wrap:wrap">${hired || ['selected', 'hired'].includes(b.status) ? '' : `<button class="adm-qb" data-act="short" data-id="${b.id}">${b.status === 'shortlisted' ? 'Undo shortlist' : 'Shortlist'}</button><button class="adm-qb" data-act="reject" data-id="${b.id}">${b.status === 'rejected' ? 'Undo reject' : 'Reject'}</button><button class="ws-btn sm" data-act="select" data-id="${b.id}"${b.status === 'rejected' ? ' disabled style="opacity:.45"' : ''}>Select</button>`}</div></td></tr>`).join('') : `<tr><td colspan="6">${empty('No bids here', 'Bids from members will show up in this list.')}</td></tr>`}</tbody></table></div></section>
        <div style="display:grid;gap:22px;align-content:start">
          <section class="ws-card"><h2 style="font-size:17px">\uD83C\uDFC6 Recommendation <small style="color:var(--sub);font-weight:400;font-size:12px">(highest fit score)</small></h2>${rec && !hired ? `<div style="display:flex;align-items:center;gap:12px;margin:14px 0">${who(rec)}<span style="margin-left:auto;font-weight:700;${fitCls(rec.fit_score)}">${rec.fit_score == null ? '' : rec.fit_score + '% Fit'}</span></div><button class="ws-btn sm" data-act="select" data-id="${rec.id}"${rec.status === 'selected' ? ' disabled style="opacity:.45"' : ''}>${rec.status === 'selected' ? 'Selected \u2713' : 'Select This Candidate'}</button>` : `<p class="sub" style="margin:10px 0 0">${hired ? 'The participant has been hired.' : 'No candidates left.'}</p>`}</section>
          <section class="ws-card"><h2 style="font-size:17px">After Selection</h2><p class="sub" style="margin:8px 0 14px">${hired ? 'Hired. Notifications were sent to the winner and every other bidder.' : 'The chosen participant is notified and the other bidders are told they were not selected.'}</p>
            <button class="ws-btn" style="width:100%;justify-content:center${sel && !hired ? '' : ';opacity:.5'}" data-hire${sel && !hired ? '' : ' disabled'}>${hired ? 'Hired \u2713' : sel ? 'Confirm & Hire ' + esc(sel.full_name) : 'Select a candidate first'}</button></section></div></div>`;
    } catch (e) { w.innerHTML = X.head('Bids & Selection', '', 'users') + empty('Could not load bids', esc(errMsg(e))); }
  };
  const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); bs.sel.clear(); load(); } catch (e) { toast(errMsg(e)); } };
  w.addEventListener('click', (e) => {
    const op = e.target.closest('[data-open]'); if (op) { bidGig = op.dataset.open; bs.tab = 'all'; bs.sel.clear(); load(); return; }
    if (e.target.closest('[data-back]')) { bidGig = null; chooser(); return; }
    const t = e.target.closest('[data-tab]'); if (t) { bs.tab = t.dataset.tab; bs.sel.clear(); load(); return; }
    const bk = e.target.closest('[data-bulkst]'); if (bk) { act(() => api('POST', `/gigs/${bidGig}/bids/status`, { bid_ids: [...bs.sel], status: bk.dataset.bulkst }), 'Updated.'); return; }
    if (e.target.closest('[data-compare]')) { api('GET', `/gigs/${bidGig}/bids/compare?ids=${[...bs.sel].join(',')}`).then((r) => compareModal(r.data)).catch((er) => toast(errMsg(er))); return; }
    if (e.target.closest('[data-hire]')) { confirmDo('Hire the selected candidate? Every other bidder will be notified and their bids rejected.', () => api('POST', `/gigs/${bidGig}/bids/hire`).then((r) => { bs.sel.clear(); load(); toast(`Hired. ${r.notified} notifications sent.`); })); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const cur = ((w.__all || []).find((x) => x.id === b.dataset.id) || {}).status;
    if (b.dataset.act === 'short') act(() => api('POST', `/gigs/${bidGig}/bids/status`, { bid_ids: [b.dataset.id], status: cur === 'shortlisted' ? 'pending' : 'shortlisted' }));   // pressing it again undoes it
    else if (b.dataset.act === 'reject') act(() => api('POST', `/gigs/${bidGig}/bids/status`, { bid_ids: [b.dataset.id], status: cur === 'rejected' ? 'pending' : 'rejected' }));
    else if (b.dataset.act === 'select') act(() => api('POST', `/gigs/${bidGig}/bids/select`, { bid_id: b.dataset.id }), 'Candidate selected.');
  });
  w.addEventListener('change', (e) => {
    if (e.target.dataset.sort !== undefined) { bs.sort = e.target.value; load(); }
    else if (e.target.dataset.sel) { if (e.target.checked) bs.sel.add(e.target.dataset.sel); else bs.sel.delete(e.target.dataset.sel); load(); }
  });
  if (bidGig) load(); else chooser();
  return w;
});

/* ---------- activity logs ---------- */
const lg = { entity_type: '', action: '', page: 1 };
listPage('adm-logs',
  `${X.head('Activity Logs', 'A record of what happened on the platform and who did it.', 'list')}<section class="ws-card"><div class="ws-tophead"><div><h2>Activity (<span data-cnt>0</span>)</h2></div><div class="ws-tools" style="flex-wrap:wrap">
   <select class="adm-in sm" data-f="entity_type"><option value="">All areas</option>${['user', 'staff', 'gig', 'opportunity', 'job'].map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
   <div class="ws-input">${ico('search', 16)}<input data-f="action" placeholder="Action, e.g. gig.hire"></div></div></div>
   <div class="ws-tablewrap"><table class="ws-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th>Area</th></tr></thead><tbody data-body></tbody></table></div><div data-pg></div></section>`,
  async (w) => {
    try {
      const d = await api('GET', '/activity-logs?' + qs({ entity_type: lg.entity_type, action: lg.action, page: lg.page, limit: 20 }));
      w.querySelector('[data-cnt]').textContent = d.total;
      w.querySelector('[data-body]').innerHTML = d.data.length ? d.data.map((a) => `<tr class="row"><td title="${esc(a.created_at)}">${when(a.created_at)}</td><td>${esc(a.actor || 'System')}</td><td>${esc(a.summary || a.action)}<br><small style="color:var(--sub)">${esc(a.action)}</small></td><td>${esc(a.detail || '\u2014')}</td><td><span class="adm-chip">${esc(a.entity_type)}</span></td></tr>`).join('') : `<tr><td colspan="5">${empty('No activity found')}</td></tr>`;
      w.querySelector('[data-pg]').innerHTML = pager(d.page, d.limit, d.total);
    } catch (e) { toast(errMsg(e)); }
  },
  (w, ctx) => {
    w.querySelector('[data-f="entity_type"]').value = lg.entity_type; w.querySelector('[data-f="action"]').value = lg.action;
    w.addEventListener('input', debounce((e) => { if (e.target.dataset.f === 'action') { lg.action = e.target.value.trim(); lg.page = 1; ctx.refresh(); } }, 300));
    w.addEventListener('change', (e) => { if (e.target.dataset.f === 'entity_type') { lg.entity_type = e.target.value; lg.page = 1; ctx.refresh(); } });
    w.addEventListener('click', (e) => { const pg = e.target.closest('[data-pg] button'); if (pg) { lg.page = +pg.dataset.pg; ctx.refresh(); } });
  });

/* ---------- navigation ---------- */
const items = [['adm-dashboard', 'Dashboard']];
const isMgr = (ME.role === 'super_admin' || ME.role === 'admin') && has('manage_users');
if (has('manage_users')) items.push(['adm-accounts', 'Accounts'], ['adm-create', 'Create Account']);
if (isMgr) items.push(['adm-team', 'Team Members']);
if (has('manage_listings')) items.push(['adm-gigs', 'Gigs'], ['adm-bids', 'Bids & Selection'], ['adm-opps', 'Opportunities'], ['adm-jobs', 'We\u2019re Hiring']);
if (has('view_reports')) items.push(['adm-logs', 'Activity Logs']);
X.addNavGroup({ id: 'admin', label: 'Control Centre', icon: 'shield', items });
X.defaultPage = 'adm-dashboard';
api('GET', '/auth/me').then((m) => { selfId = m.id; }).catch(() => {});
})();
