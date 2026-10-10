// server/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabase');
const { loginLimiter } = require('../middleware/security');
const { isEmail } = require('../utils/http');

const router = express.Router();

// Compared against when the email doesn't exist, so response time doesn't
// reveal which emails are real admin accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (!isEmail(email.trim()) || password.length > 200) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, password_hash, full_name')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) {
    console.error('[login]', error.message);
    return res.status(500).json({ error: 'Could not reach the database.' });
  }

  const valid = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !valid) return res.status(401).json({ error: 'Incorrect email or password.' });

  // New session id on login (prevents session fixation).
  req.session.regenerate((regenErr) => {
    if (regenErr) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.adminName = admin.full_name;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Could not start a session.' });
      res.json({ id: admin.id, email: admin.email, full_name: admin.full_name });
    });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sterling.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ id: req.session.adminId, email: req.session.adminEmail, full_name: req.session.adminName });
});

// POST /api/auth/change-password
router.post('/change-password', loginLimiter, async (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Not logged in.' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (newPassword.length < 12 || newPassword.length > 200) {
    return res.status(400).json({ error: 'New password must be 12–200 characters.' });
  }
  if (!/[a-z]/i.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ error: 'New password must include letters and numbers.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from the current one.' });
  }

  const { data: admin } = await supabase
    .from('admins')
    .select('password_hash')
    .eq('id', req.session.adminId)
    .single();
  if (!admin) return res.status(401).json({ error: 'Not logged in.' });

  const valid = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const newHash = await bcrypt.hash(newPassword, 12);
  const { error } = await supabase.from('admins').update({ password_hash: newHash }).eq('id', req.session.adminId);
  if (error) {
    console.error('[change-password]', error.message);
    return res.status(500).json({ error: 'Could not update password.' });
  }

  res.json({ ok: true });
});

module.exports = router;
