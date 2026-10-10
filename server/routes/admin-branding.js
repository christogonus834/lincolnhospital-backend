// server/routes/admin-branding.js
// Manages the hospital's header/footer logo. Single-row-per-key store in site_settings.

const express = require('express');
const supabase = require('../db/supabase');
const { upload, uploadToSupabase } = require('../utils/upload');
const { dbFail } = require('../utils/http');

const router = express.Router();

const VALID_KEYS = ['hospital_logo'];

// GET /api/admin/branding — all logo settings at once
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('site_settings').select('*').in('key', VALID_KEYS);
  if (error) return dbFail(res, error);
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  res.json({ hospital_logo: map.hospital_logo || null });
});

// PUT /api/admin/branding/:key — set a logo URL directly (e.g. paste a URL)
router.put('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown logo key.' });
  const { value } = req.body || {};
  if (value && !/^https:\/\/[^\s]+$/i.test(String(value))) return res.status(400).json({ error: 'Logo must be an https:// URL.' });
  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key, value: value || null, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select()
    .single();
  if (error) return dbFail(res, error);
  res.json(data);
});

// POST /api/admin/branding/:key/image — upload a logo file directly
router.post('/:key/image', upload.single('image'), async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown logo key.' });
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });

  try {
    const url = await uploadToSupabase(req.file, 'branding');
    const { data, error } = await supabase
      .from('site_settings')
      .upsert({ key, value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
      .single();
    if (error) return dbFail(res, error);
    res.json(data);
  } catch (e) {
    if (e && e.status === 400) return res.status(400).json({ error: e.message });
    dbFail(res, e);
  }
});

// DELETE /api/admin/branding/:key — clear a logo back to the default SVG mark
router.delete('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown logo key.' });
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key, value: null, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

module.exports = router;
