# IMI Platform

Market intelligence, CRM and business management in one app. Plain Node.js, no npm dependencies, one SQLite database file.

- **Requirements:** Node.js 22.13 or newer (it uses the built-in `node:sqlite`). Nothing to install with npm.
- **Documentation:** [Product Requirements Document](docs/PRD.md) · [Data persistence and database guide](docs/PERSISTENCE.md)

## 1. Run it locally

```bash
node -v                      # must be 22.13 or newer
cp .env.example .env         # Windows: copy .env.example .env   (then edit .env if you like)
chmod 600 .env               # Linux/macOS: keep it private (the server warns if other users can read it)
npm run dev                  # opens on http://localhost:4000
```

The first start creates the database in `./data` and applies the migrations by itself. Open <http://localhost:4000>; on a fresh install the login card offers **Set up the admin account**. Emails (confirmation, password reset, invitations) are printed in the terminal while you develop, because no email provider is set.

## 2. Configuration (`.env`)

Settings come from environment variables. For local work put them in a `.env` file (copy of `.env.example`). **In production do not use a file: enter them in your hosting service's "Environment variables" screen.** A real environment variable always wins over `.env`.

> `.env` holds secrets. It is listed in `.gitignore` and must never be committed. `.env.example` contains no real values and is the only env file that belongs in Git. Write comments on their own line, never after a value. Nothing from `.env` is ever sent to the browser.

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | development | Use `production` on the live server (Secure cookies, HSTS, stricter logging and setup rules). |
| `PORT` | `4000` | Port to listen on. Many hosts set this for you. |
| `APP_URL` | `http://localhost:PORT` | Public address, no trailing slash. Used in emailed links. Use `https://` in production. |
| `TRUST_PROXY` | `0` | Set `1` behind a reverse proxy or load balancer so rate limits see real visitor IPs. |
| `DATA_DIR` | `./data` | Folder holding **everything that must persist**: the database, deal files, uploaded images and backups. **In production point it at a persistent disk.** |
| `DB_FILE` | `DATA_DIR/imi.db` | Optional full path of the database file. |
| `AUTO_MIGRATE` | `1` | `1`: apply pending migrations on start. `0`: never on start; run `npm run migrate` yourself (the server refuses to start while any are pending). |
| `RESEND_API_KEY`, `MAIL_FROM` | none | Email delivery through [Resend](https://resend.com). **Required in production.** |
| `REQUIRE_EMAIL_VERIFICATION` | `1` | `0` skips email confirmation (private launches only). |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME` | none | Create the first administrator once, only while none exists. Password 10+ characters. Remove the password afterwards. |
| `SETUP_CODE` | random (dev only) | Code for browser setup from another computer. In production it must be set explicitly and be 12+ characters; it is never written to the logs. |

Check a deployment's settings at any time (secret values are never printed):

```bash
npm run check-config
```

## 3. Database and migrations

The database is **SQLite**, stored in the file `DATA_DIR/imi.db` (never in memory). It holds accounts, sessions, CRM data, deals, members, daily reports, tasks, listings, bids, notifications and the activity log. Deal files and uploaded images are files in `DATA_DIR/files` and `DATA_DIR/uploads`.

Schema changes are **versioned migrations** (`migrations/`, recorded in the `schema_migrations` table). Starting the server never resets, re-creates or re-seeds anything: it applies only what is missing, once.

```bash
npm run migrate:status   # what is applied and what is pending (changes nothing)
npm run migrate          # apply pending migrations
```

Safety built in:
- If the database already holds accounts, a backup copy is written to `DATA_DIR/backups/` **before** any migration runs.
- If the database was upgraded by a *newer* release (for example after a rollback), the server refuses to start instead of risking damage.
- A failed migration is rolled back completely.
- The first administrator is created only while no super admin exists. A restart never re-creates or resets one.

Adding your own change: create `migrations/003_name.js` exporting `{ id: '003_name', up(db) { ... } }`, add it to the list in `migrate.js`, and never edit a migration after it has shipped.

## 4. Backups and restore

```bash
npm run backup
```

This writes `DATA_DIR/backups/imi-backup-<date>/` containing a consistent copy of the database (safe while the server runs) plus `files/` and `uploads/`. **Copy that folder to storage outside the server** (another disk or cloud storage): a backup on the same disk does not protect you from losing the disk. Run it on a schedule.

To restore: stop the server, put `imi.db`, `files/` and `uploads/` from the backup into the data folder, start the server.

## 5. Production setup

1. **Choose hosting with persistent storage** (see [docs/PERSISTENCE.md](docs/PERSISTENCE.md)). A VPS, or a host where you can attach a persistent disk or volume, works. Hosts whose filesystem is wiped on every deploy do **not** work with SQLite: data would be lost.
2. Attach the disk and set `DATA_DIR` to its mount path (for example `/var/data`).
3. In the host's environment-variable screen set: `NODE_ENV=production`, `APP_URL=https://your-domain`, `TRUST_PROXY=1` (behind a proxy), `DATA_DIR`, `RESEND_API_KEY`, `MAIL_FROM`, and for the first admin either `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` + `SUPER_ADMIN_NAME` or `SETUP_CODE` (12+ characters). Optionally `AUTO_MIGRATE=0` to control migrations yourself.
4. Start command: `npm start`. Health check: `GET /healthz`.
5. Run `npm run check-config` in the host's shell and fix every FAIL.
6. Sign in, **change the admin password** under My account, and remove `SUPER_ADMIN_PASSWORD` from the settings.
7. Schedule `npm run backup` and copy the result off the server.

**Prove persistence after the first deploy.** `GET /healthz` returns `{"ok":true,"db":{"instance":"1a2b3c4d","migrations":2}}`. Note the `instance` value, redeploy (or restart), and open `/healthz` again. The same value means the same database survived. A different value means a new empty database was created and your data was **not** kept. The server also warns about this in its log.

## 6. What it does

- **Home** (`/`): log in, sign up, confirm email, forgot/reset password, continue as guest.
- **Workspace** (`/app`): guest functions (Market, News, Discover) plus the CRM (Clients, Deals, Tasks, Diagnosis, Invoicing) for confirmed members with CRM access. Code is delivered only to people allowed to use it.
- **Deals and Tasks** (CRM): shared deals with a team added by email, one daily progress report per member per day, tasks, files and a timeline; board view with a Preview panel.
- **My account**: change name, phone, bio, email and password. Changing a password or email signs out other devices.
- **Control Centre** (managers): Dashboard, Accounts, Create Account, Team Members, Gigs (Bounty or Marketing gig), Bids & Selection, Opportunities, We're Hiring, Activity Logs. Access is re-checked in the database on every request.
- **Security:** passwords use scrypt with a self-describing hash (older hashes are upgraded when someone signs in); sessions are random tokens in an HttpOnly cookie with only a hash stored; rate limits on sign-in, reset and account changes; a platform manager's own account can only be changed by a super admin; logs never contain passwords, tokens or emailed links in production.

`preview/imi-platform-preview.html` is a single-file demo that runs without the server. Sign-in is simulated there and shared features are unavailable.

## 7. Troubleshooting

| Message or symptom | Meaning and fix |
|---|---|
| `N database migration(s) are pending ... Run: npm run migrate` | You set `AUTO_MIGRATE=0`. Run `npm run migrate`, then start. |
| `The database contains migrations this release does not know ... Refusing to start` | The data was upgraded by a newer release. Deploy the newer release, or restore a backup. |
| `WARNING: a brand-new empty database was created in production` | The data folder was not kept. Mount persistent storage and set `DATA_DIR`. Restore from a backup if you have one. |
| `WARNING: DATA_DIR is inside the application folder` | Move `DATA_DIR` to a persistent disk. |
| `[mail] NOT SENT, no email provider is configured` | Set `RESEND_API_KEY` and `MAIL_FROM`. In production links are deliberately never logged. |
| Can't see the Control Centre | Run `npm run check-admin -- you@example.com`. It explains exactly what is missing. |
| Forgot the only admin's password | Run `npm run create-super-admin -- "Name" you@example.com "a-new-password"` on the server. |
