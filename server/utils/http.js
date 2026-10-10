// server/utils/http.js
// Small helpers shared by routes: safe error replies, input cleaning, and
// field whitelisting (so clients can never write columns they shouldn't).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const isDate = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isTime = (v) => typeof v === 'string' && TIME_RE.test(v);

// Trim + length-cap a user string. Returns null for empty / non-string.
function clean(value, max = 500) {
  if (typeof value !== 'string') return null;
  const v = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return v ? v.slice(0, max) : null;
}

// Copy only the allowed keys from an object.
function pick(obj, allowed) {
  const out = {};
  for (const k of allowed) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// Log the real database error server-side, send the client a generic message.
function dbFail(res, error, status = 500) {
  console.error('[db]', error && (error.message || error));
  return res.status(status).json({ error: 'Something went wrong. Please try again.' });
}

// Router param guard: rejects non-UUID :id before it reaches the database.
function validateId(req, res, next, value) {
  if (!isUuid(value)) return res.status(400).json({ error: 'Invalid id.' });
  next();
}

module.exports = { isUuid, isEmail, isDate, isTime, clean, pick, dbFail, validateId };
