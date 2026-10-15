'use strict';
// Builds the prototype sandbox's sample world by calling the platform's OWN API (so every rule, notification and
// activity-log entry behaves exactly as in real use). It only ever runs against an EMPTY sandbox database.
const { PASSWORD } = require('../prototype');
const pad = (x) => String(x).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
class Jar { constructor() { this.c = ''; } set(r) { for (const x of r.headers.getSetCookie?.() || []) { const kv = x.split(';')[0]; this.c = kv.endsWith('=') ? '' : kv; } } }
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function seed(base, log) {
  const TODAY = day(0);
  const call = async (jar, method, path, body, form) => {
    const h = {}; if (jar && jar.c) h.cookie = jar.c; if (body !== undefined) h['content-type'] = 'application/json';
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(base + path + (path.startsWith('/api/crm') ? `${sep}today=${TODAY}` : ''), { method, headers: h, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
    if (jar) jar.set(r); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${typeof j === 'string' ? j.slice(0, 160) : JSON.stringify(j).slice(0, 220)}`);
    return j;
  };
  const login = async (email) => { const jar = new Jar(); await call(jar, 'POST', '/api/auth/login', { email, password: PASSWORD }); return jar; };

  log('creating the super admin through the first-run setup');
  const su = new Jar();
  await call(su, 'POST', '/api/setup', { name: 'Sade Okonkwo', email: 'superadmin@prototype.test', password: PASSWORD });

  log('creating managers, members and a team account');
  const ids = {}, acct = async (name, email, o = {}) => { const r = await call(su, 'POST', '/api/admin/accounts', { full_name: name, email, password: PASSWORD, tier: o.tier || 'free', account_type: o.type || 'individual', phone: o.phone, bio: o.bio, access: { crm: !!o.crm } }); ids[email] = r.id; return r; };
  const MANAGERS = [['Ade Bankole', 'admin@prototype.test', 'admin', 'Operations', true], ['Chika Eze', 'community@prototype.test', 'community_manager', 'Community', false], ['Kemi Adeyemi', 'content@prototype.test', 'content_manager', 'Content', false], ['Dayo Ojo', 'developer@prototype.test', 'developer', 'Engineering', false]];
  for (const [name, email, role, dept, crm] of MANAGERS) { await acct(name, email, { crm: true }); await call(su, 'POST', '/api/admin/team-members', { full_name: name, email, role, department: dept }); }
  const MEMBERS = [['Daniel Adebayo', 'daniel@prototype.test', 'premium', '+2348012345601'], ['Fatima Bello', 'fatima@prototype.test', 'free', '+2348012345602'], ['Chinedu Okafor', 'chinedu@prototype.test', 'premium', '+2348012345603'], ['Aisha Mohammed', 'aisha@prototype.test', 'free', '+2348012345604']];
  for (const [name, email, tier, phone] of MEMBERS) await acct(name, email, { tier, crm: true, phone, bio: 'Prototype demo account.' });
  await acct('Gabriel Guest', 'guest.member@prototype.test', { crm: true, bio: 'A plain member with no deals of their own: browse Discover, place a bid, save items to the Watchlist and be added to a deal.' });
  const team = await acct('Zenith Agency (team)', 'agency@prototype.test', { type: 'team', tier: 'premium', crm: true });
  for (const e of ['daniel@prototype.test', 'fatima@prototype.test']) await call(su, 'POST', `/api/admin/accounts/${team.id}/members`, { user_id: ids[e], member_role: e.startsWith('daniel') ? 'owner' : 'member' });

  log('giving each person their private CRM data (clients, invoices, a diagnosis)');
  const J = { daniel: await login('daniel@prototype.test'), fatima: await login('fatima@prototype.test'), chinedu: await login('chinedu@prototype.test'), aisha: await login('aisha@prototype.test') };
  const client = (id, name, company, email, status, added) => ({ id, name, company, email, status, added: day(added), lastContact: day(Math.min(0, added + 3)) });
  const inv = (id, clientId, items, ago) => ({ id, clientId, date: day(ago), taxRate: 7.5, notes: 'Thank you for your business.', items: items.map(([desc, price], i) => ({ id: `${id}-${i}`, catalogId: null, desc, qty: 1, price })) });
  const dxAnswers = { traffic: [true, true, false, true, false], conversion: [true, false, false, true, false], activation: [true, true, true, false, false], retention: [false, false, true, false, false], ecosystem: [true, false, true, false, false] };
  const states = {
    daniel: { clients: [client('c-acme', 'Brian Halligan', 'Acme Logistics', 'ops@acme-logistics.test', 'Active', -40), client('c-delta', 'Ifeoma Obi', 'Delta Foods', 'ifeoma@deltafoods.test', 'Lead', -9), client('c-gpay', 'Samuel Reid', 'GlobalPay', 'samuel@globalpay.test', 'Past', -120)], diagnoses: [], selectedClientId: 'c-acme',
      invoices: [inv('i-acme-1', 'c-acme', [['Business Health Diagnostic', 150000], ['Strategic Planning Session', 250000]], -12), inv('i-gpay-1', 'c-gpay', [['Market Research & Analysis', 180000]], -90)],
      diagnosisProjects: { 'c-acme': { projectName: 'Acme Logistics Platform', answers: dxAnswers, valueCaptureMode: 'direct', valueCaptureAnswers: { direct: [true, true, false, true, false], indirect: Array(5).fill(null) } } } },
    chinedu: { clients: [client('c-zenith', 'Layla Haddad', 'Zenith Finance', 'layla@zenithfinance.test', 'Active', -25), client('c-chain', 'Marcus Webb', 'ChainCore', 'marcus@chaincore.test', 'Active', -60), client('c-vertex', 'Priya Nair', 'Vertex Labs', 'priya@vertexlabs.test', 'Past', -150)], diagnoses: [], selectedClientId: 'c-zenith', invoices: [inv('i-zen-1', 'c-zenith', [['Process Optimization Consulting', 220000]], -5)] },
    fatima: { clients: [client('c-nova', 'Kofi Mensah', 'Nova Blockchain', 'kofi@novablockchain.test', 'Lead', -14), client('c-bright', 'Tolu Adeleke', 'BrightPath', 'tolu@brightpath.test', 'Active', -50)], diagnoses: [], selectedClientId: 'c-nova', invoices: [] },
    aisha: { clients: [client('c-nova2', 'Kofi Mensah', 'Nova Blockchain', 'kofi@novablockchain.test', 'Lead', -14)], diagnoses: [], selectedClientId: 'c-nova2', invoices: [] },
  };
  for (const k of Object.keys(states)) await call(J[k], 'PUT', '/api/crm/state', { state: states[k] });

  log('creating shared deals with teams, contacts, daily reports, tasks and files');
  const upload = async (jar, dealId, name, buf, type) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); return call(jar, 'POST', `/api/crm/deals/${dealId}/files`, undefined, fd); };
  const mkDeal = async (owner, d, team = []) => {
    const r = await call(J[owner], 'POST', '/api/crm/deals', d);
    for (const [who, label] of team) await call(J[owner], 'POST', `/api/crm/deals/${r.id}/members`, { email: `${who}@prototype.test`, label });
    return r.id;
  };
  const report = (who, deal, ago, status, body, next) => call(J[who], 'POST', `/api/crm/deals/${deal}/reports`, { body, status, next_step: next, report_date: day(ago) });
  const task = (who, deal, assignee, t) => call(J[who], 'POST', '/api/crm/tasks', Object.assign({ deal_id: deal, assignee_id: ids[`${assignee}@prototype.test`] }, t));
  // 1. Acme: the rich one
  const acme = await mkDeal('daniel', { title: 'Enterprise Platform Partnership', company: 'Acme Logistics', value: 250000, currency: 'USD', stage: 'negotiation', priority: 'high', expected_close: day(45), source: 'Referral', tags: ['Strategic', 'Enterprise', 'Logistics'], description: 'Multi-year platform partnership covering tracking, reporting and community tooling.' },
    [['fatima', 'Marketing Lead'], ['chinedu', 'Sales Lead'], ['aisha', 'Community Manager']]);
  for (const [n, role, email, tag] of [['Brian Halligan', 'CEO, Acme Logistics', 'brian@acme-logistics.test', 'Primary'], ['Maria Johnson', 'CTO, Acme Logistics', 'maria@acme-logistics.test', 'Technical'], ['James Carter', 'Procurement Manager', 'james@acme-logistics.test', 'Procurement']]) await call(J.daniel, 'POST', `/api/crm/deals/${acme}/contacts`, { name: n, role, email, tag });
  await report('daniel', acme, -3, 'completed', 'Kicked off the partnership workstream and shared the draft scope with Acme.', 'Prepare the proposal deck');
  await report('daniel', acme, -2, 'completed', 'Finished the proposal deck and walked the team through it.', 'Send it to Brian');
  await report('daniel', acme, -1, 'completed', 'Sent the proposal to Brian Halligan. He asked for a revised timeline.', 'Update the timeline');
  await report('daniel', acme, 0, 'in_progress', 'Finalised the revised timeline and had a follow-up call with Brian. Waiting on legal review.', 'Send contract draft');
  await report('fatima', acme, -1, 'completed', 'Updated campaign materials and shared them with the team for review.', 'Plan the launch announcement');
  await report('fatima', acme, 0, 'completed', 'Drafted the co-marketing plan and prepared the announcement copy.', 'Get approval from Acme comms');
  await report('chinedu', acme, -2, 'blocked', 'Pricing review is blocked until legal confirms the liability clause.', 'Escalate to legal');
  await report('chinedu', acme, -1, 'in_progress', 'Escalated the clause to legal and prepared two pricing options.', 'Present the options');
  await report('aisha', acme, -2, 'completed', 'Engaged with Acme\u2019s community on LinkedIn. Positive sentiment and good interest.', 'Prepare the community plan');
  await call(J.fatima, 'POST', `/api/crm/deals/${acme}/reports`, { kind: 'note', body: 'Call notes: Brian prefers a Friday demo and wants a named account manager.' });
  await task('daniel', acme, 'daniel', { title: 'Review proposal deck with team', priority: 'medium', due_date: day(0) });
  await task('daniel', acme, 'fatima', { title: 'Prepare contract draft', priority: 'high', due_date: day(-2) });
  await task('daniel', acme, 'chinedu', { title: 'Schedule final presentation', priority: 'medium', due_date: day(5), type: 'meeting' });
  await task('daniel', acme, 'aisha', { title: 'Confirm integration requirements', priority: 'low', due_date: day(3), status: 'in_progress' });
  await task('daniel', acme, 'daniel', { title: 'Send NDA to Acme', priority: 'high', due_date: day(-6), status: 'done' });
  await task('daniel', acme, 'chinedu', { title: 'Call the procurement lead', priority: 'medium', due_date: day(1), type: 'call' });
  await upload(J.daniel, acme, 'Acme_Proposal_v3.pdf', PDF, 'application/pdf'); await upload(J.chinedu, acme, 'Pricing_Sheet.csv', Buffer.from('Item,Price\nPlatform,250000\nSupport,40000\n'), 'text/csv');
  // 2-7. the other businesses, across every stage
  const zen = await mkDeal('chinedu', { title: 'Fintech Integration Deal', company: 'Zenith Finance', value: 120000, stage: 'proposal', priority: 'medium', expected_close: day(30), source: 'Conference', tags: ['Fintech'] }, [['daniel', 'Technical Lead'], ['fatima', 'Marketing']]);
  await report('chinedu', zen, 0, 'in_progress', 'Presented the proposal to Layla. Questions on the security review.', 'Send the security whitepaper'); await report('daniel', zen, -1, 'completed', 'Reviewed their API requirements and confirmed feasibility.', 'Write the integration plan');
  await task('chinedu', zen, 'daniel', { title: 'Write the integration plan', priority: 'high', due_date: day(2) }); await task('chinedu', zen, 'chinedu', { title: 'Send the security whitepaper', priority: 'medium', due_date: day(-1) });
  const nova = await mkDeal('fatima', { title: 'Community Growth Partnership', company: 'Nova Blockchain', value: 80000, stage: 'discovery', priority: 'medium', expected_close: day(60), source: 'Social media', tags: ['Web3', 'Community'] }, [['aisha', 'Community Manager']]);
  await report('fatima', nova, 0, 'in_progress', 'Discovery call with Kofi. They want a 90-day community launch plan.', 'Draft the plan'); await task('fatima', nova, 'aisha', { title: 'Audit Nova\u2019s existing community channels', priority: 'medium', due_date: day(4) });
  await mkDeal('daniel', { title: 'Payment System Integration', company: 'GlobalPay', value: 180000, stage: 'closed_won', priority: 'high', expected_close: day(-20), source: 'Partner', tags: ['Payments'] });
  const chain = await mkDeal('chinedu', { title: 'Developer Relations Program', company: 'ChainCore', value: 95000, stage: 'contract', priority: 'high', expected_close: day(14), source: 'Referral', tags: ['DevRel'] }, [['daniel', 'Solutions Lead']]);
  await task('chinedu', chain, 'daniel', { title: 'Review the master services agreement', priority: 'high', due_date: day(1) });
  const bright = await mkDeal('fatima', { title: 'Marketing & Community Support', company: 'BrightPath', value: 60000, stage: 'qualification', priority: 'low', expected_close: day(90), source: 'Inbound' }); await call(J.fatima, 'PATCH', `/api/crm/deals/${bright}`, { hold: true });
  const vertex = await mkDeal('chinedu', { title: 'Strategic Partnership', company: 'Vertex Labs', value: 150000, stage: 'proposal', priority: 'medium', expected_close: day(-5), source: 'Conference' }); await call(J.chinedu, 'PATCH', `/api/crm/deals/${vertex}`, { stage: 'closed_lost', lost_reason: 'Budget was not approved this quarter.' });
  await task('aisha', null, 'aisha', { title: 'Personal: plan next week\u2019s community calendar', priority: 'low', due_date: day(2) });

  log('creating listings (bounties, marketing gigs, We\u2019re Hiring, opportunities) and bids');
  const listing = (type, o) => call(su, 'POST', `/api/admin/${type}`, Object.assign({ location_type: 'remote', currency: 'USD', status: 'published' }, o));
  const bounty = await listing('gigs', { title: 'Design a launch bounty', level: 'Intermediate', deadline: day(14), description: 'Design the visual identity and launch assets for our new community bounty programme.', section: 'bounty', category: 'Design', company_name: 'IMI Platform', commitment: 'one_off', budget_min: 500, budget_max: 1500, tags: ['design', 'branding'] });
  await listing('gigs', { title: 'Smart contract bug bounty', level: 'Advanced', deadline: day(30), description: 'Find and responsibly report vulnerabilities in our audited contracts.', section: 'bounty', category: 'Security', company_name: 'Nova Blockchain', commitment: 'one_off', budget_min: 2000, budget_max: 5000, tags: ['security'] });
  await listing('gigs', { title: 'Translate the docs into French', description: 'Translate our product documentation into French.', section: 'bounty', category: 'Content', commitment: 'one_off', budget_min: 300, budget_max: 700, status: 'draft' });
  await listing('gigs', { title: 'Run our Instagram campaign', level: 'Beginner', deadline: day(10), tags: ['Social', 'Marketing'], description: 'Plan and run a four-week Instagram campaign to grow our community.', section: 'marketing', category: 'Marketing', company_name: 'BrightPath', commitment: 'contract', budget_min: 300, budget_max: 800 });
  await listing('gigs', { title: 'Host our community AMA series', level: 'Intermediate', deadline: day(21), tags: ['Community'], description: 'Host a monthly AMA with guests from the ecosystem.', section: 'marketing', category: 'Community', commitment: 'part_time', budget_min: 200, budget_max: 500 });
  await listing('jobs', { title: 'Senior Frontend Developer', level: '5+ years experience', tags: ['React', 'Frontend'], description: 'Build and improve our member workspace. Remote-friendly, product-minded.', category: 'Engineering', company_name: 'IMI Platform', commitment: 'full_time', budget_min: 3000, budget_max: 5000 });
  await listing('jobs', { title: 'Community Manager (Lagos)', level: '2+ years experience', tags: ['Community'], description: 'Lead our community programmes and events in Lagos.', category: 'Community', commitment: 'full_time', location_type: 'onsite', location_text: 'Lagos, Nigeria', budget_min: 1200, budget_max: 2000, currency: 'USD' });
  await listing('jobs', { title: 'Product Designer', description: 'Own the design of our CRM and deals experience.', category: 'Design', commitment: 'contract', status: 'draft' });
  await listing('opportunities', { title: 'Web3 Builder Grant', description: 'Grants of up to 10,000 USD for teams building community tooling.', category: 'Grant', commitment: 'one_off', budget_min: 2000, budget_max: 10000 });
  await listing('opportunities', { title: 'Accelerator Programme 2027', description: 'A 12-week accelerator for early-stage Web3 teams.', category: 'Programme', commitment: 'part_time' });
  // the first bounty also gets a few ready-made bidders with ratings and fit scores, so Bids & Selection has something to compare
  const { db } = require('../db'), { hashPassword } = require('../password'), crypto = require('node:crypto'), hash = await hashPassword(PASSWORD), now = new Date().toISOString();
  const BIDDERS = [['Ola Martins', '@ola_designs', 4.9, 96, 1100, ['Branding', 'Figma', 'Motion'], 'I have designed launch identities for six Web3 communities and can deliver within two weeks.'], ['Zainab Yusuf', '@zee_creates', 4.7, 88, 950, ['Illustration', 'Social'], 'Strong illustration background with fast turnaround.'], ['Emeka Nwosu', '@emeka_ux', 4.6, 82, 1200, ['UX', 'Design systems'], 'I would build a complete reusable design system for the launch.'], ['Ngozi Eze', '@ngozi_art', 4.3, 74, 800, ['Graphics'], 'Budget-friendly option with a solid portfolio.'], ['Tunde Bakare', '@tunde_b', 4.1, 66, 700, ['Video', 'Graphics'], 'Can add a short launch video at no extra cost.']];
  BIDDERS.forEach(([name, handle, rating, fit, amount, skills, proposal], i) => {
    const uid = crypto.randomUUID(), email = `bidder${i + 1}@prototype.test`;
    db.prepare("INSERT INTO users (id, name, email, password_hash, status, access, created_at, updated_at, verified_at, handle, skills, rating_avg, rating_count) VALUES (?,?,?,?, 'active', '{\"main_platform\":true,\"crm\":true,\"admin_dashboard\":false,\"api\":false}', ?,?,?,?,?,?,?)").run(uid, name, email, hash, now, now, now, handle, JSON.stringify(skills), rating, 12 + i * 3);
    db.prepare('INSERT INTO bids (id, listing_id, bidder_id, amount, proposal, experience_years, relevant_projects, fit_score, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), bounty.id, uid, amount, proposal, 6 - i, 8 - i, fit, i === 0 ? 'shortlisted' : 'pending', now);
  });
  log('publishing sample news stories, then applications and saved items');
  const story = (title, category, summary, paras) => call(su, 'POST', '/api/admin/market-news', { title, category, source: 'IMI Newsroom (sample)', summary, body: paras.join('\n\n'), status: 'published' });
  const s1 = await story('What a quiet week in the market can teach new traders', 'Crypto', 'Calm weeks are easy to ignore, but they are where good habits are built.', [
    'When prices barely move, it is tempting to look away. Experienced traders do the opposite: a quiet week is the best time to review what they actually did during the noisy ones.',
    'Start with a simple record. For every position, write down why you entered, what would make you leave, and how big it was compared with the rest of your money. Most early mistakes come from size, not from picking the wrong asset.',
    'Then look at your reactions. Did you add to a position because the plan said so, or because the chart turned green? A short written plan that you can read back to yourself is worth more than any indicator.',
    'Finally, use the calm to learn the boring parts: fees, how orders are filled, and what happens to your funds when a platform has problems. None of that is exciting, and all of it matters.']);
  const s2 = await story('Interest rates, explained: why one decision moves many markets', 'Macro', 'A plain-language guide to why central bank decisions ripple through crypto, stocks and currencies.', [
    'A central bank sets the price of borrowing money. When that price changes, almost everything that depends on borrowing or on future earnings is repriced.',
    'Higher rates make saving more attractive and borrowing more expensive. Money tends to move toward safer returns, and assets whose value depends on growth far in the future can lose some of their appeal.',
    'Lower rates do the reverse. Cheaper money tends to flow toward riskier assets, which is one reason markets watch every word of a rate announcement and not just the number.',
    'The practical lesson is to know which dates matter, and to avoid making large decisions in the hours around them.']);
  const s3 = await story('Five habits of teams that ship Web3 products on time', 'Tech', 'Shipping is a team skill. These habits show up again and again.', [
    'First, they keep the scope small and the release dates fixed. A smaller product that ships beats a perfect one that does not.',
    'Second, they write things down. Decisions, owners and next steps live in one place that everyone can read, not in someone\u2019s memory.',
    'Third, they ask for a short progress note from everyone, every day. It takes two minutes, and it removes most of the surprises that sink deadlines.',
    'Fourth, they review security early, when changes are cheap. Fifth, they celebrate small releases, because momentum is a feature.']);
  await story('How to write a bid that gets noticed', 'Business', 'Clients read dozens of proposals. Here is how to make yours the one they remember.', [
    'Lead with the client\u2019s problem, not with your biography. One sentence that shows you understood the task is worth a whole paragraph about yourself.',
    'Be specific about what you will deliver and when. \u201CI will deliver a ten-tweet thread with sources by Friday\u201D beats \u201CI am passionate about this space\u201D every time.',
    'Show one or two relevant examples and link to them. Keep your price honest: a fair bid you can deliver on builds the kind of reputation that wins repeat work.']);
  const find = async (q) => (await call(null, 'GET', `/api/discover/listings?q=${encodeURIComponent(q)}`)).data[0];
  const L = { bug: await find('Smart contract bug bounty'), insta: await find('Run our Instagram campaign'), fe: await find('Senior Frontend Developer'), cm: await find('Community Manager (Lagos)'), ama: await find('Host our community AMA series') };
  const gab = await login('guest.member@prototype.test');
  const apply = (jar, l, b) => call(jar, 'POST', `/api/discover/listings/${l.id}/apply`, b);
  await apply(gab, L.bug, { amount: 3200, proposal: 'I have reviewed audited contracts for three DeFi teams and use a repeatable checklist, with a clear write-up for each finding.', experience_years: 4, relevant_projects: 6 });
  await apply(J.fatima, L.insta, { amount: 450, proposal: 'I will plan and run four weeks of posts, stories and reels, with a weekly report on reach and growth.', experience_years: 3, relevant_projects: 5 });
  await apply(J.daniel, L.fe, { proposal: 'Six years of React and TypeScript, the last three leading a small frontend team on a data-heavy product.', experience_years: 6 });
  await apply(J.chinedu, L.cm, { proposal: 'I have run community programmes and events in Lagos for two years and know the local builder scene well.', experience_years: 2, amount: 1500 });
  const save = (jar, kind, id) => call(jar, 'POST', '/api/discover/watchlist', { kind, id });
  await save(J.daniel, 'news', s1.id); await save(J.daniel, 'news', s3.id); await save(J.daniel, 'listing', bounty.id);
  await save(J.fatima, 'listing', L.fe.id); await save(J.fatima, 'news', s2.id);
  await save(gab, 'news', s3.id); await save(gab, 'listing', L.insta.id); await save(gab, 'listing', L.ama.id);
  log('done');
}
module.exports = { seed };
