'use strict';
// Loads .env (optional) so the server and the scripts see the same settings. No dotenv package needed.
const fs = require('node:fs');
const path = require('node:path');
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { /* no .env */ }
