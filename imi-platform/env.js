'use strict';
/**
 * Loads the optional .env file into process.env (no dotenv package needed).
 * - Real environment variables (for example set in your hosting dashboard) always win over .env.
 * - Values are never printed or logged.
 * - Supports: KEY=value, KEY="quoted value", KEY='quoted value', `export KEY=value`, blank lines,
 *   full-line # comments, and trailing ` # comments` after unquoted values.
 */
const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v[0] === '"' || v[0] === "'") { const end = v.indexOf(v[0], 1); v = end > 0 ? v.slice(1, end) : v.slice(1); }
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

const file = path.join(__dirname, '.env');
try {
  const st = fs.statSync(file);
  if (process.platform !== 'win32' && (st.mode & 0o077)) console.warn('[env] .env can be read by other users on this machine. Run: chmod 600 .env');
  const vars = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(vars)) if (!(k in process.env)) process.env[k] = vars[k];
} catch (e) { /* no .env file: fine, the environment may come from the host */ }

module.exports = { parseEnv };
