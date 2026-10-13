'use strict';
// Usage:  npm run prototype:reset            show what would be deleted (deletes nothing)
//         npm run prototype:reset -- --yes   delete the prototype sandbox
// Deletes ONLY <project>/data-prototype. It can never touch ./data or any DATA_DIR you configured.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dir = path.join(__dirname, '..', 'data-prototype');
const size = (p) => { let n = 0; for (const f of fs.readdirSync(p, { withFileTypes: true })) n += f.isDirectory() ? size(path.join(p, f.name)) : fs.statSync(path.join(p, f.name)).size; return n; };
if (!fs.existsSync(dir)) { console.log('Nothing to reset: there is no prototype sandbox yet.'); process.exit(0); }
if (fs.lstatSync(dir).isSymbolicLink()) { console.error('Refusing: data-prototype is a symbolic link.'); process.exit(1); }
console.log(`Prototype sandbox: ${dir}  (${(size(dir) / 1024).toFixed(0)} KB)`);
if (!process.argv.includes('--yes')) { console.log('Nothing was deleted. To wipe the sandbox, stop the prototype server and run:  npm run prototype:reset -- --yes'); process.exit(0); }
const dbFile = path.join(dir, 'imi.db'), pidFile = path.join(dir, '.prototype.pid');
const refuse = (why) => { console.error(`${why}\nStop the prototype server (Ctrl+C in its terminal) and run this again.`); process.exit(1); };
// check 1: the launcher records its process id while the sandbox is in use
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8')); let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
  if (alive) refuse(`The prototype server appears to be running (process ${pid}).`);
}
(async () => {
  // check 2: is something on the configured port serving THIS very database? (covers a server started some other way)
  try {
    require('../env'); const port = Number(process.env.PORT) || 4000;
    const d = new DatabaseSync(dbFile, { readOnly: true }); const row = d.prepare("SELECT value FROM meta WHERE key = 'instance_id'").get(); d.close();
    const j = await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) })).json();
    if (row && j && j.db && j.db.instance === String(row.value).slice(0, 8)) refuse(`A server on port ${port} is using the prototype sandbox right now.`);
  } catch (e) { /* nothing is answering (or no database yet): fine */ }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Prototype sandbox deleted. Your real data was not touched. The next "npm run prototype" builds a fresh sample world.');
})();
