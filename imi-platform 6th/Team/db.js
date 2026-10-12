'use strict';
/**
 * The platform database (SQLite). Platform tables plus the Control Centre tables
 * (staff, listings, bids, audit logs...). Safe to run on every start: it creates what is missing
 * and upgrades older databases in place.
 */
require('./env');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'imi.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reset_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS verify_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS crm_state (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`);

// ---- upgrades of the users table ----
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'verified_at'").get()) {
  db.exec('ALTER TABLE users ADD COLUMN verified_at TEXT');
  db.exec('UPDATE users SET verified_at = created_at');
  console.log('[db] upgraded: existing accounts marked as verified');
}
const have = new Set(db.prepare("SELECT name FROM pragma_table_info('users')").all().map((r) => r.name));
const add = (name, def) => { if (!have.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`); };
const ACCESS_DEFAULT = '{"main_platform":true,"crm":true,"admin_dashboard":false,"api":false}';
add('account_type', "TEXT NOT NULL DEFAULT 'individual'");
add('phone', 'TEXT');
add('tier', "TEXT NOT NULL DEFAULT 'free'");
add('status', "TEXT NOT NULL DEFAULT 'active'");
add('bio', 'TEXT');
add('avatar_url', 'TEXT');
add('access', `TEXT NOT NULL DEFAULT '${ACCESS_DEFAULT}'`);   // existing members keep CRM access, as before
add('handle', 'TEXT');
add('skills', "TEXT NOT NULL DEFAULT '[]'");
add('rating_avg', 'REAL');
add('rating_count', 'INTEGER NOT NULL DEFAULT 0');
add('last_login_at', 'TEXT');
add('created_by', 'TEXT');
add('updated_at', 'TEXT');
add('deleted_at', 'TEXT');
if (!have.has('access') && db.prepare('SELECT count(*) n FROM users').get().n > 0) console.log('[db] upgraded: Control Centre columns added to users (existing members keep CRM access)');

// ---- Control Centre tables ----
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uq ON users (lower(handle)) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id), CHECK (team_id <> user_id)
);
CREATE TABLE IF NOT EXISTS staff (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin','content_manager','community_manager','marketing_lead','developer','team_member')),
  department TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('gig','opportunity','job')),
  title TEXT NOT NULL, description TEXT NOT NULL, category TEXT, cover_image_url TEXT, company_name TEXT,
  location_type TEXT NOT NULL DEFAULT 'remote' CHECK (location_type IN ('remote','onsite','hybrid')),
  location_text TEXT,
  commitment TEXT CHECK (commitment IN ('full_time','part_time','contract','one_off')),
  budget_min REAL, budget_max REAL, currency TEXT NOT NULL DEFAULT 'USD',
  deadline TEXT, tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','in_progress','completed','closed','archived')),
  posted_by TEXT REFERENCES users(id), created_by TEXT REFERENCES users(id), hired_user_id TEXT REFERENCES users(id),
  published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);
CREATE INDEX IF NOT EXISTS listings_type_status_idx ON listings (type, status);
CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  bidder_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL CHECK (amount >= 0), proposal TEXT, experience_years INTEGER, relevant_projects INTEGER,
  fit_score INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shortlisted','rejected','selected','hired')),
  created_at TEXT NOT NULL, UNIQUE (listing_id, bidder_id)
);
CREATE INDEX IF NOT EXISTS bids_listing_idx ON bids (listing_id, status);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS market_news (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, source TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS api_integrations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','error')), last_sync_at TEXT
);
CREATE TABLE IF NOT EXISTS api_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id TEXT REFERENCES api_integrations(id),
  endpoint TEXT, status_code INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_request_logs_created_idx ON api_request_logs (created_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, data TEXT, read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, summary TEXT, detail TEXT, changes TEXT, ip TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
`);

// gigs are either a Bounty or a Marketing gig ("We're Hiring" posts are the separate Jobs type)
if (!db.prepare("SELECT 1 FROM pragma_table_info('listings') WHERE name = 'section'").get()) {
  db.exec("ALTER TABLE listings ADD COLUMN section TEXT CHECK (section IS NULL OR section IN ('bounty','marketing'))");
}
db.exec("UPDATE listings SET section = 'bounty' WHERE type = 'gig' AND section IS NULL");
db.exec('CREATE INDEX IF NOT EXISTS listings_section_idx ON listings (type, section, status)');

// ---- CRM: deals, daily reports, tasks, files (shared between the members of a deal) ----
db.exec(`
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, company TEXT NOT NULL, description TEXT,
  value REAL NOT NULL DEFAULT 0 CHECK (value >= 0), currency TEXT NOT NULL DEFAULT 'USD',
  stage TEXT NOT NULL DEFAULT 'qualification' CHECK (stage IN ('qualification','discovery','proposal','negotiation','contract','closed_won','closed_lost')),
  hold INTEGER NOT NULL DEFAULT 0, priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  expected_close TEXT, source TEXT, tags TEXT NOT NULL DEFAULT '[]', lost_reason TEXT, closed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS deals_owner_idx ON deals (owner_id, deleted_at);
CREATE TABLE IF NOT EXISTS deal_members (
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT, created_at TEXT NOT NULL, PRIMARY KEY (deal_id, user_id)
);
CREATE INDEX IF NOT EXISTS deal_members_user_idx ON deal_members (user_id);
CREATE TABLE IF NOT EXISTS deal_contacts (
  id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, email TEXT, phone TEXT, tag TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deal_reports (
  id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('daily','note')), report_date TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT CHECK (status IS NULL OR status IN ('completed','in_progress','blocked')), next_step TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS deal_reports_daily_uq ON deal_reports (deal_id, user_id, report_date) WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS deal_reports_deal_idx ON deal_reports (deal_id, report_date DESC);
CREATE TABLE IF NOT EXISTS deal_files (
  id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE, uploader_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deal_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deal_activity_idx ON deal_activity (deal_id, id DESC);
CREATE TABLE IF NOT EXISTS crm_tasks (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT NOT NULL REFERENCES users(id),
  deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL DEFAULT 'todo' CHECK (type IN ('todo','call','email','meeting','follow_up')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  due_date TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS crm_tasks_assignee_idx ON crm_tasks (assignee_id, status, due_date);
CREATE INDEX IF NOT EXISTS crm_tasks_deal_idx ON crm_tasks (deal_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read_at, created_at);
`);

// one-time import of users from the very first JSON-file version
const OLD_USERS = path.join(DATA_DIR, 'users.json');
if (fs.existsSync(OLD_USERS) && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO users (id,name,email,password_hash,created_at,verified_at) VALUES (?,?,?,?,?,?)');
    for (const u of JSON.parse(fs.readFileSync(OLD_USERS, 'utf8'))) ins.run(u.id, u.name, u.email, u.passwordHash, u.createdAt, u.createdAt);
    fs.renameSync(OLD_USERS, OLD_USERS + '.migrated');
    console.log('[db] imported users from data/users.json');
  } catch (e) { console.error('[db] user import failed:', e.message); }
}

const ROLE_PRESETS = {
  super_admin: ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'],
  admin: ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'],
  content_manager: ['manage_content', 'view_reports', 'manage_listings'],
  community_manager: ['manage_content', 'manage_users'],
  marketing_lead: ['manage_content', 'view_reports'],
  developer: ['view_reports'],
  team_member: ['manage_content', 'view_reports', 'manage_users'],
};
const PERMISSIONS = ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'];

module.exports = { db, DATA_DIR, DB_FILE, ACCESS_DEFAULT, ROLE_PRESETS, PERMISSIONS };
