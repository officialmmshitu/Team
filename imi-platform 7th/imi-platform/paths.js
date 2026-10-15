'use strict';
// Where persistent data lives. Everything that must survive a restart or redeploy is under DATA_DIR:
//   imi.db (+ -wal, -shm)   the database
//   files/                  deal files
//   uploads/                uploaded images
//   backups/                database backups
require('./env');
const path = require('node:path');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.resolve(process.env.DB_FILE || path.join(DATA_DIR, 'imi.db'));
// true when the data folder sits inside the application folder, which many hosts wipe on every deploy
const DATA_IN_APP_DIR = DATA_DIR === __dirname || DATA_DIR.startsWith(__dirname + path.sep);
module.exports = { DATA_DIR, DB_FILE, DATA_IN_APP_DIR };
