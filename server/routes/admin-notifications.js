// server/routes/admin-notifications.js
const express = require('express');
const supabase = require('../db/supabase');
const { dbFail, validateId } = require('../utils/http');

const router = express.Router();
router.param('id', validateId);

// GET /api/admin/notifications?unreadOnly=true
router.get('/', async (req, res) => {
  let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (req.query.unreadOnly === 'true') query = query.eq('is_read', false);
  const { data, error } = await query;
  if (error) return dbFail(res, error);
  res.json(data);
});

// GET /api/admin/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);
  if (error) return dbFail(res, error);
  res.json({ count: count || 0 });
});

// PUT /api/admin/notifications/:id/read
router.put('/:id/read', async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

// PUT /api/admin/notifications/read-all
router.put('/read-all', async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

module.exports = router;
