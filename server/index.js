// server/index.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const compression = require('compression');

const { requireAdmin } = require('./middleware/auth');
const SupabaseSessionStore = require('./middleware/sessionStore');
const { securityHeaders, originGuard, apiLimiter, allowedOrigins } = require('./middleware/security');

const authRoutes = require('./routes/auth');
const hospitalRoutes = require('./routes/hospital');
const adminHospitalRoutes = require('./routes/admin-hospital');
const adminNotificationsRoutes = require('./routes/admin-notifications');
const adminDashboardRoutes = require('./routes/admin-dashboard');
const adminBrandingRoutes = require('./routes/admin-branding');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ---------- FAIL FAST ON UNSAFE PRODUCTION CONFIG ----------
if (isProd) {
  const problems = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET === 'dev-secret-change-me') {
    problems.push('SESSION_SECRET must be set to a random string of at least 32 characters.');
  }
  if (!allowedOrigins.length) problems.push('CLIENT_ORIGIN must be set to your frontend URL.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('Supabase credentials are missing.');
  if (problems.length) {
    console.error('Refusing to start:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}
if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM_EMAIL) {
  console.warn('[mail] BREVO_API_KEY / MAIL_FROM_EMAIL not set — doctor email alerts are disabled until you add them.');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(compression());

// CLIENT_ORIGIN = exact frontend URL(s), comma-separated. Reflects any origin
// ONLY in local development.
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : !isProd,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(
  session({
    name: 'sterling.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    store: new SupabaseSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true, // sliding expiry: active admins stay signed in, idle ones don't
    cookie: {
      httpOnly: true,
      secure: isProd,
      // Frontend (Vercel) and API (Render) are different sites, so production
      // needs SameSite=None (which requires Secure). originGuard covers CSRF.
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use('/api', apiLimiter, originGuard);

// ---------- PUBLIC API ----------
app.use('/api/auth', authRoutes);
app.use('/api/hospital', hospitalRoutes);

// ---------- ADMIN API (session-protected) ----------
app.use('/api/admin/hospital', requireAdmin, adminHospitalRoutes);
app.use('/api/admin/notifications', requireAdmin, adminNotificationsRoutes);
app.use('/api/admin/dashboard', requireAdmin, adminDashboardRoutes);
app.use('/api/admin/branding', requireAdmin, adminBrandingRoutes);

// ---------- HEALTH CHECK ----------
app.get('/', (req, res) => res.json({ ok: true, service: 'sterling-hospital-api' }));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler. Never leak internals (stack, SQL, vendor messages) on 5xx.
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  const safe = status < 500 || err.code === 'LIMIT_FILE_SIZE';
  res.status(status).json({
    error: safe ? (err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message) : 'Something went wrong.',
  });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

app.listen(PORT, () => {
  console.log(`Sterling Hospital API running on port ${PORT}`);
});
