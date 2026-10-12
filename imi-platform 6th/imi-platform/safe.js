'use strict';
// Safe logging: error messages are scrubbed so secrets can never reach the logs.
const SECRET_ENV = ['RESEND_API_KEY', 'SUPER_ADMIN_PASSWORD', 'SETUP_CODE', 'DATABASE_URL', 'DATABASE_PASSWORD'];
function redact(input) {
  let s = String(input == null ? '' : input);
  for (const k of SECRET_ENV) { const v = process.env[k]; if (v && v.length >= 6) s = s.split(v).join('[redacted]'); }
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@');   // user:password@ inside any URL / connection string
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/g, 'Bearer [redacted]');
  s = s.replace(/\bre_[A-Za-z0-9_]{16,}\b/g, '[redacted]');                          // Resend API keys
  s = s.replace(/[A-Za-z0-9_-]{40,}/g, '[token]');                                    // long random tokens
  return s;
}
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return d ? (u.slice(0, 1) + '***@' + d) : '***'; };
function logError(tag, e) {
  const text = e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : (e && e.message) || e;
  console.error(`[${tag}] ${redact(text)}`);
}
module.exports = { redact, maskEmail, logError };
