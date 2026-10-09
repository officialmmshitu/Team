# IMI Platform

    node -v          # needs Node 22.13 or newer (built-in SQLite, no npm install needed)
    npm run dev      # http://localhost:4000

## What it does
- `/` homepage: log in, sign up, confirm email, forgot/reset password, continue as guest
- `/app` member workspace: the guest functions (Market, News, Discover) plus the CRM (Clients, Diagnosis, Invoicing), only for signed-in users who have confirmed their email. The CRM code is served from the protected `/workspace.js`, so guests never receive it. The Diagnosis tab is the updated six-lens version (charts, snapshots, report preview, PDF/Word export) and works per client. Each account has its own CRM data, stored on the server (works from any browser/device)
- SQLite database at `data/imi.db` (users, sessions, reset tokens, CRM data). **Back this file up.**
- Passwords: scrypt hashes. Sessions: random token in an HttpOnly cookie (only its hash is stored), revocable. Password reset signs the user out everywhere.
- Limits: 20 auth requests/min per IP, 5 failed logins per email per 15 min, passwords of 8+ characters.

## Going live
1. Copy `.env.example` to `.env` and set `NODE_ENV=production`, `APP_URL=https://your-domain`, and `TRUST_PROXY=1` if behind a proxy.
2. Email (required): new users must confirm their address, and password resets use email too. Create a Resend account, verify your sending domain, set `RESEND_API_KEY` and `MAIL_FROM`. Without them, links only print to the server console. To open early for a private group, set `REQUIRE_EMAIL_VERIFICATION=0`.
3. Serve over HTTPS (cookies are `Secure` in production) and run with `npm start`. Use a host with a persistent disk for `data/`.
4. Health check: `GET /healthz`.

## Not included yet
Account deletion, change-password inside the app, and multi-server scaling (the login throttle is in memory and SQLite is a single file).

`preview/imi-platform-preview.html` is a single-file demo (homepage + CRM) that runs without the server; sign-in is simulated there.

## Control Centre (platform managers)
- Everyone can change their own name, phone, bio, email and password under **My account** (user menu, or Settings in the sidebar). Changing a password signs out other devices; managers need 10+ characters. Admin-set details are not baked into the download: the first admin comes from your own settings.
- Staff open it from the **Control Centre** group in the sidebar: Dashboard, Accounts, Create Account, Team Members, Gigs, Bids & Selection, Opportunities, We\u2019re Hiring, Activity Logs (ported from the Control Centre preview). What each person sees depends on their role and permissions.
- **Easiest: browser setup.** On a fresh install the login card shows **Set up the admin account**. Fill in your name, email and a password (10+ characters) and you are signed in as super admin. On the computer running the server it needs nothing else. From anywhere else it asks for a setup code printed in the server console (or `SETUP_CODE` in `.env`). The option disappears once an administrator exists.
- Or create the first super admin in either of these ways: (a) put `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` and `SUPER_ADMIN_NAME` in `.env` (or your host's settings) and start the server, which creates it once if no super admin exists; or (b) run on the server: `npm run create-super-admin -- "Your Name" you@company.com "a-long-password"` (10+ characters, double quotes work on Windows, Mac and Linux). Run it from the same folder the server runs in. If the email already has an account, that account is upgraded **and its password is replaced** by the one you type.
- **Gigs** are either a **Bounty** or a **Marketing gig** (pick the Section when creating or editing, filter with the tabs). **We\u2019re Hiring** is the separate screen for hiring posts. The Discover page itself still shows sample content until it is connected to these listings.
- On **Gigs**, the *Post a Gig* card lets you post under Bounty, Marketing gig or We\u2019re hiring. **Bids & Selection** walks through review, select and hire; hiring notifies the winner and every other bidder.
- Invite other managers from **Team Members**; they get an email link to set a password (printed to the console until email is set up).
- API: `/api/admin/*` (see `admin-api.js`). Access is checked in the database on every request. Images upload to `data/uploads/` (back this folder up with the database).
- Accounts carry access flags (Main platform, CRM, Admin dashboard, API). Members who signed up themselves keep CRM access; accounts created in the Control Centre start with CRM off unless you tick it.

### Can't see the Control Centre?
Run `npm run check-admin -- you@company.com`. It checks the account, the manager record and the access flag, and tells you what to fix. The usual causes:
1. The command was never run, or was run in a different folder, so it changed a different `data/` folder than the one your server uses (a fresh unzip starts with an empty `data/`; copy your old `data/` folder across).
2. You are logged in as a different account than the one you upgraded, or still on an old session. Log out and back in.
3. You are looking at the single-file preview, which has no Control Centre, or an older copy of the server is still running. Stop it, start this version, and hard-refresh the page.
