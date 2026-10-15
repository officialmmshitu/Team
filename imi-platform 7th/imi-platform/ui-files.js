'use strict';
/**
 * Finds the three front-end files. Two layouts are supported, so the app starts whichever way the files were copied:
 *   standard:  public/index.html, private/workspace.js, private/admin.js
 *   flat:      index.html, workspace.js, admin.js   (next to server.js)
 * It looks at request time, so moving a file while developing needs no code change.
 */
const fs = require('node:fs');
const path = require('node:path');
const pick = (...c) => c.find((f) => fs.existsSync(f)) || c[0];
const homeFile = () => pick(path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html'));
const workspaceFile = () => pick(path.join(__dirname, 'private', 'workspace.js'), path.join(__dirname, 'workspace.js'));
const adminFile = () => pick(path.join(__dirname, 'private', 'admin.js'), path.join(__dirname, 'admin.js'));
const status = () => [['home page (index.html)', homeFile()], ['member code (workspace.js)', workspaceFile()], ['manager code (admin.js)', adminFile()]]
  .map(([what, file]) => ({ what, file, found: fs.existsSync(file), layout: path.dirname(file) === __dirname ? 'flat' : path.basename(path.dirname(file)) }));
const missing = () => status().filter((s) => !s.found);
const MISSING_PAGE = `<!doctype html><meta charset="utf-8"><title>IMI Platform: files missing</title><body style="font-family:system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;line-height:1.6;color:#1f2937"><h1 style="font-size:22px">The server is running, but its page files were not found</h1><p>The server looked for <code>public/index.html</code>, and for <code>index.html</code> next to <code>server.js</code>, and found neither.</p><p>Put <code>index.html</code> in a <code>public</code> folder (and <code>workspace.js</code> and <code>admin.js</code> in a <code>private</code> folder), or keep all three next to <code>server.js</code>. Then reload. Run <code>npm run check-config</code> to see which files are missing.</p></body>`;
module.exports = { homeFile, workspaceFile, adminFile, status, missing, MISSING_PAGE };
