'use strict';
/**
 * Password hashing with scrypt. The hash string records its own cost settings, so the cost can be
 * raised later without locking anyone out:   scrypt$N$r$p$<salt hex>$<hash hex>
 * Hashes made by earlier versions ("<salt hex>:<hash hex>", Node's default cost) still verify and are
 * upgraded automatically the next time that person signs in.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const CURRENT = { N: 32768, r: 8, p: 3, keylen: 64 };      // OWASP-recommended scrypt profile (32 MiB memory per hash)
const LEGACY = { N: 16384, r: 8, p: 1, keylen: 64 };
const derive = (pw, salt, o) => scrypt(pw, salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r });

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}$${salt.toString('hex')}$${(await derive(pw, salt, CURRENT)).toString('hex')}`;
}
function parse(stored) {
  const s = String(stored || '');
  if (s.startsWith('scrypt$')) { const [, N, r, p, salt, hash] = s.split('$'); return { o: { N: +N, r: +r, p: +p, keylen: hash.length / 2 }, salt, hash, legacy: false }; }
  const [salt, hash] = s.split(':'); return { o: LEGACY, salt, hash, legacy: true };
}
/** @returns {{ok:boolean, rehash:boolean}} rehash is true when the stored hash should be upgraded. */
async function verifyPassword(pw, stored) {
  try {
    const { o, salt, hash, legacy } = parse(stored);
    if (!salt || !hash || !(o.N >= 1024 && o.N <= 1048576)) return { ok: false, rehash: false };
    const a = await derive(String(pw), Buffer.from(salt, 'hex'), o), b = Buffer.from(hash, 'hex');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, rehash: ok && (legacy || o.N !== CURRENT.N || o.r !== CURRENT.r || o.p !== CURRENT.p) };
  } catch (e) { return { ok: false, rehash: false }; }
}
module.exports = { hashPassword, verifyPassword, CURRENT };
