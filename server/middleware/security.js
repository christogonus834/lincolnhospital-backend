// server/middleware/security.js
// Security headers, CSRF-style origin checking, and rate limiters.
// Written without extra dependencies beyond express-rate-limit (already installed).

const rateLimit = require('express-rate-limit');

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

// The API only returns JSON, so the strictest possible CSP is safe here.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // frontend (other origin) must read responses
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
}

// Because the admin session cookie is SameSite=None (frontend and API are on
// different sites), the browser will attach it to cross-site requests. So every
// state-changing request must come from one of our own frontend origins.
function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!allowedOrigins.length) return next(); // local dev only; index.js refuses to boot like this in production

  const origin = (req.get('origin') || '').replace(/\/$/, '');
  if (origin && allowedOrigins.includes(origin)) return next();
  return res.status(403).json({ error: 'Request blocked.' });
}

const msg = (text) => ({ error: text });

// Generous blanket limit for the whole API.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg('Too many requests. Please slow down.'),
});

// Public booking: stops someone scripting hundreds of fake appointments
// (and, because each booking sends an email, using us as a spam cannon).
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg('Too many booking requests from this connection. Please try again later or call the hospital.'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg('Too many login attempts. Please try again in a few minutes.'),
});

module.exports = { securityHeaders, originGuard, apiLimiter, bookingLimiter, loginLimiter, allowedOrigins };
