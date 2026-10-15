'use strict';
/**
 * 003_discover: everything the member-facing Discover, News and Watchlist screens need.
 *  - listings.level: optional experience level shown on Discover (for example "Beginner" or "3+ years").
 *  - market_news: a category, a short summary and updated_at, so published stories can be listed and read.
 *  - bookmarks: a member's saved stories and opportunities (the Watchlist), one row per saved item.
 *  - CRM access is now on for every account (it was off for accounts created in the Control Centre).
 * Nothing is deleted or reset. Existing rows keep their values.
 */
module.exports = {
  id: '003_discover',
  up(db, ctx) {
    const has = (t, c) => db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name = ?`).get(c);
    if (!has('listings', 'level')) db.exec('ALTER TABLE listings ADD COLUMN level TEXT');
    if (!has('market_news', 'category')) db.exec('ALTER TABLE market_news ADD COLUMN category TEXT');
    if (!has('market_news', 'summary')) db.exec('ALTER TABLE market_news ADD COLUMN summary TEXT');
    if (!has('market_news', 'updated_at')) db.exec('ALTER TABLE market_news ADD COLUMN updated_at TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS market_news_pub_idx ON market_news (status, published_at DESC);
      CREATE INDEX IF NOT EXISTS bids_bidder_idx ON bids (bidder_id);
      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('news','listing')),
        ref_id TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, ref_id)
      );
      CREATE INDEX IF NOT EXISTS bookmarks_user_idx ON bookmarks (user_id, created_at DESC);
    `);
    const r = db.prepare("UPDATE users SET access = json_set(access, '$.crm', json('true')) WHERE COALESCE(json_extract(access, '$.crm'), 0) <> 1").run();
    if (r.changes && ctx && ctx.log) ctx.log(`[db] CRM access switched on for ${r.changes} existing account(s)`);
  },
};
