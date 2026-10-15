# Data persistence and database guide

How the IMI Platform stores data, what survives a restart or a redeploy, which hosting works, why PostgreSQL is **not** switched on yet, and how to run backups and migrations safely.

## 1. What is stored where

| Data | Stored in | Survives a restart | Survives a redeploy |
|---|---|:-:|:-:|
| Accounts, sessions, password and confirmation links | SQLite file `DATA_DIR/imi.db` | Yes | Only if `DATA_DIR` is on persistent storage |
| Private CRM data (clients, diagnoses, invoices) | `crm_state` table in the same file | Yes | Same condition |
| Deals, members, contacts, daily reports, notes, tasks, activity | Tables in the same file | Yes | Same condition |
| Gigs, opportunities, jobs, bids, notifications, activity log | Tables in the same file | Yes | Same condition |
| Deal files (PDF, Office, images...) | Bytes in `DATA_DIR/files/`, details in the database | Yes | Same condition |
| Uploaded images (photos, covers) | `DATA_DIR/uploads/` | Yes | Same condition |
| Backups | `DATA_DIR/backups/` | Yes | Same condition (and copy them elsewhere) |
| Login and request rate-limit counters | Memory only | No (they simply restart at zero) | No |
| Settings and secrets | Environment variables / `.env` | n/a | Kept by your host |

The database is **SQLite on disk** (WAL mode, `synchronous=FULL`, foreign keys on). It is not in memory, and it is not PostgreSQL.

## 2. What happens on a restart and on a redeploy

**Restarting the server process** (crash, `npm start` again, host restart) keeps all data, because the file is on disk. This was tested, including a hard `kill -9` immediately after a write: the acknowledged write was still there. Sessions are stored in the database too, so people stay signed in.

**Redeploying** (a new release) depends entirely on where `DATA_DIR` lives:

| Where `DATA_DIR` is | Result of a redeploy |
|---|---|
| On a persistent disk or volume that the host re-attaches | Data kept. |
| A normal VPS disk | Data kept. |
| Inside the application folder on a host that rebuilds the container each deploy | **All data is erased.** |
| Any filesystem that is reset when the instance restarts or scales | **All data is erased.** |

The server protects you from silent loss: in production it prints a loud warning when a brand-new empty database is created, or when `DATA_DIR` sits inside the application folder, and `GET /healthz` exposes a database `instance` id that never changes for a given database (see section 6).

## 3. Which hosting works with the current database

| Hosting | Works with SQLite? |
|---|---|
| VPS or dedicated server (a normal disk) | Yes. Put `DATA_DIR` outside the application folder, for example `/var/lib/imi`. |
| Container host **with a persistent disk or volume** you can attach (check your host's documentation) | Yes. Mount the volume and set `DATA_DIR` to its mount path. |
| Platforms whose filesystem is wiped on every deploy or restart and that offer no persistent disk (typical for free tiers, serverless and many "git push" platforms) | **No.** Use a host with a disk, or the PostgreSQL route in section 4. |

Only one server instance may run at a time (SQLite is a single file; the login rate limits are in memory).

## 4. PostgreSQL: assessment and plan

**Recommendation.** For a single server with a persistent disk, SQLite is a sound production choice for a team-sized product and is what is implemented and verified here. PostgreSQL is the right move if you must host on an ephemeral platform, need more than one server, or expect large growth.

**Why it is not enabled now.** Switching is a development project, not a setting:

| Finding | Detail |
|---|---|
| Synchronous driver everywhere | The code uses the built-in synchronous SQLite API. PostgreSQL drivers are asynchronous. There are **229** database call sites (**185** in `server.js`, `admin-api.js`, `crm-api.js`, with **182** executions) that would each become `await`ed calls inside async functions. |
| SQLite-only SQL | At least **26** constructs need rewriting (`INSERT OR IGNORE`, `json_set`, `pragma_table_info`, `COLLATE NOCASE`, `BEGIN IMMEDIATE`, `VACUUM INTO`...), plus `?` placeholders, 0/1 booleans, and dates stored as text. |
| New dependency | The project has zero npm dependencies. PostgreSQL needs a driver package such as `pg`. |
| Files are not in the database | Deal files and images live on disk. PostgreSQL alone does **not** make them persistent on an ephemeral host; they would also need object storage or a volume. |
| It could not be verified here | The working environment has no PostgreSQL server, no driver and no network access, so a PostgreSQL port could not be run against the project's automated tests. Shipping it untested would risk breaking working features and would break the rule that persistence is only claimed once verified. |

**Plan, when you choose to do it** (an estimate: about one to two weeks for an engineer, most of it testing):

1. Add a small asynchronous data-access layer with the current SQLite behind it; convert the call sites without changing behaviour; keep all tests green.
2. Write the PostgreSQL schema as numbered migrations (`timestamptz`, `boolean`, `jsonb`, `ILIKE`, `ON CONFLICT`, `RETURNING`).
3. Write a one-off copy tool from SQLite to PostgreSQL (ids are UUID text, so they carry over unchanged); verify row counts and content fingerprints table by table, as the SQLite adoption test already does.
4. Run the full API and browser test suites against PostgreSQL. Add `DATABASE_URL`; the log scrubber in `safe.js` already hides credentials inside connection strings.
5. Move deal files and uploads to object storage if the host has no volume.
6. Cut over in a short maintenance window with a fresh SQLite backup in hand.

You will need to provide: a PostgreSQL database for testing (any hosted provider or a local server), and your approval to add the driver dependency.

**If you must stay on an ephemeral platform in the meantime**, one option is continuous replication of the SQLite file to object storage with a tool such as Litestream. It has not been tested with this project, so treat it as something to evaluate, not as a verified setup.

## 5. Migrations

Schema changes are numbered files in `migrations/`, recorded in the `schema_migrations` table and applied in order, each inside a transaction.

| Rule | Behaviour |
|---|---|
| Existing data | A migration never resets, deletes or re-seeds data. `001_baseline` only creates what is missing, so any database made by an earlier release is adopted as it is. |
| Backup first | If the database already holds accounts, a copy is written to `DATA_DIR/backups/pre-migrate-<id>-<time>.db` before the first pending migration runs. |
| Failure | A failing migration is rolled back completely and the server does not start. |
| Newer database | If the database contains a migration this release does not know, the server refuses to start (protects data after a rollback). |
| Control | `AUTO_MIGRATE=0` stops migrating on start; `npm run migrate` applies them; `npm run migrate:status` shows the state. |

Writing a new one: create `migrations/003_short_name.js` exporting `{ id: '003_short_name', up(db) { db.exec('...'); } }`, add it to the list in `migrate.js`, test it on a copy of real data, and never edit it after release.

**Rolling back a release.** The older release will refuse to start on a database a newer release has migrated. Restore the matching `pre-migrate-*` backup (or a full backup), then start the older release.

## 6. Verify persistence after a deploy

1. Before deploying, open `/healthz` and note `db.instance`.
2. Deploy or restart.
3. Open `/healthz` again. **Same `instance` = same database.** A different value means a new empty database: restore the latest backup and fix `DATA_DIR`.
4. Sign in as the administrator, open a deal and its daily reports, download a deal file.
5. In the server log, the start-up line must say `existing database opened (N accounts ...)`, never `NEW database created`, and must not say `First super admin created`.

The development test suite automates this for restart, hard crash, redeploy onto a new copy of the code, and restore from a backup (66 checks).

## 7. Backups

`npm run backup` writes a consistent snapshot (database, `files/`, `uploads/`) to `DATA_DIR/backups/imi-backup-<time>/`, safe while the server runs. Schedule it (cron or your host's scheduler) and **copy the folder off the server**. Test a restore at least once: stop the server, put `imi.db`, `files/` and `uploads/` into a fresh `DATA_DIR`, start the server, sign in.

## 8. Protecting the stored data

- Keep `.env` private (`chmod 600 .env`); on a host, use its secret settings instead of a file. The server warns if `.env` is readable by other users.
- Make `DATA_DIR` readable only by the account that runs the server.
- Encrypt backups before sending them to third-party storage; they contain every account's data.
- Logs never contain passwords, session or reset tokens, emailed links (in production) or full connection strings. Still restrict who can read them.
- Passwords are stored as scrypt hashes (memory-hard, per-password salt). The hash records its cost, so it can be raised later; older hashes are upgraded when their owner signs in.
