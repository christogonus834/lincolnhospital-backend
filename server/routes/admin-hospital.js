// server/routes/admin-hospital.js
const express = require('express');
const supabase = require('../db/supabase');
const { upload, uploadToSupabase, removeFromSupabase } = require('../utils/upload');
const { sendPatientConfirmation, sendTestEmail } = require('../utils/mailer');
const { pick, clean, isEmail, isUuid, isDate, isTime, dbFail, validateId } = require('../utils/http');

const router = express.Router();
router.param('id', validateId);
router.param('cid', (req, res, next, v) => (/^[a-z0-9_-]{1,80}$/i.test(v) ? next() : res.status(400).json({ error: 'Invalid id.' })));

const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const uploadFail = (res, e) => {
  if (e && e.status === 400) return res.status(400).json({ error: e.message });
  return dbFail(res, e);
};

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

// ---------- DEPARTMENTS ----------
router.get('/departments', async (req, res) => {
  const { data, error } = await supabase.from('departments').select('*').order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.post('/departments', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required.' });
  const payload = {
    name: b.name,
    slug: b.slug ? slugify(b.slug) : slugify(b.name),
    description: b.description || null,
    icon_key: b.icon_key || 'pulse',
    sort_order: b.sort_order || 0,
    is_active: b.is_active !== false,
  };
  const { data, error } = await supabase.from('departments').insert(payload).select().single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/departments/:id', async (req, res) => {
  const b = pick(req.body, ['name', 'slug', 'description', 'icon_key', 'sort_order', 'is_active']);
  if (b.slug) b.slug = slugify(String(b.slug));
  const { data, error } = await supabase.from('departments').update(b).eq('id', req.params.id).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.delete('/departments/:id', async (req, res) => {
  const { error } = await supabase.from('departments').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

// ---------- DOCTORS ----------
router.get('/doctors', async (req, res) => {
  const { data, error } = await supabase
    .from('doctors')
    .select('*, departments(name)')
    .order('created_at', { ascending: false });
  if (error) return dbFail(res, error);
  res.json(data);
});

function doctorFields(b, { requireNames }) {
  const out = {};
  if (b.full_name !== undefined || requireNames) {
    out.full_name = clean(b.full_name, 120);
    if (!out.full_name) return { error: 'Name is required.' };
  }
  if (b.title !== undefined || requireNames) {
    out.title = clean(b.title, 120);
    if (!out.title) return { error: 'Title is required.' };
  }
  if (b.email !== undefined) {
    const email = clean(b.email, 254)?.toLowerCase() || null;
    if (email && !isEmail(email)) return { error: 'Please enter a valid doctor email address.' };
    out.email = email;
  }
  if (b.department_id !== undefined) {
    if (b.department_id && !isUuid(b.department_id)) return { error: 'Invalid department.' };
    out.department_id = b.department_id || null;
  }
  if (b.bio !== undefined) out.bio = clean(b.bio, 3000);
  if (b.photo_url !== undefined) out.photo_url = clean(b.photo_url, 1000);
  if (b.is_active !== undefined) out.is_active = !!b.is_active;
  if (b.days_available !== undefined) {
    if (!Array.isArray(b.days_available) || !b.days_available.every((d) => DAYS.includes(d))) return { error: 'Invalid days.' };
    out.days_available = b.days_available;
  }
  for (const k of ['start_hour', 'end_hour', 'slot_minutes']) {
    if (b[k] !== undefined) {
      const n = Number(b[k]);
      if (!Number.isInteger(n)) return { error: `Invalid ${k.replace('_', ' ')}.` };
      out[k] = n;
    }
  }
  if (out.start_hour !== undefined && (out.start_hour < 0 || out.start_hour > 23)) return { error: 'Start hour must be 0-23.' };
  if (out.end_hour !== undefined && (out.end_hour < 1 || out.end_hour > 24)) return { error: 'End hour must be 1-24.' };
  if (out.slot_minutes !== undefined && (out.slot_minutes < 10 || out.slot_minutes > 240)) return { error: 'Slot length must be 10-240 minutes.' };
  if (out.start_hour !== undefined && out.end_hour !== undefined && out.end_hour <= out.start_hour) return { error: 'End hour must be after start hour.' };
  return { out };
}

router.post('/doctors', async (req, res) => {
  const { out, error: vErr } = doctorFields(req.body || {}, { requireNames: true });
  if (vErr) return res.status(400).json({ error: vErr });
  const payload = {
    days_available: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_hour: 9, end_hour: 16, slot_minutes: 30, is_active: true,
    ...out,
  };
  const { data, error } = await supabase.from('doctors').insert(payload).select('*, departments(name)').single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/doctors/:id', async (req, res) => {
  const { out, error: vErr } = doctorFields(req.body || {}, { requireNames: false });
  if (vErr) return res.status(400).json({ error: vErr });
  const { data, error } = await supabase.from('doctors').update(out).eq('id', req.params.id).select('*, departments(name)').single();
  if (error) return dbFail(res, error);
  res.json(data);
});

// Sends a test message to the doctor's saved email, to check the Brevo setup.
router.post('/doctors/:id/test-email', async (req, res) => {
  const { data: doctor, error } = await supabase.from('doctors').select('full_name, email').eq('id', req.params.id).maybeSingle();
  if (error) return dbFail(res, error);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });
  if (!doctor.email) return res.status(400).json({ error: 'This doctor has no email address. Add one first.' });
  try {
    await sendTestEmail(doctor.email);
    res.json({ ok: true, to: doctor.email });
  } catch (e) {
    console.error('[mail] test email failed:', e.message);
    res.status(502).json({ error: String(e.message).slice(0, 300) });
  }
});

router.delete('/doctors/:id', async (req, res) => {
  const { error } = await supabase.from('doctors').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

router.post('/doctors/:id/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const url = await uploadToSupabase(req.file, 'doctors');
    res.json({ url });
  } catch (e) {
    uploadFail(res, e);
  }
});

// ---------- APPOINTMENTS ----------
router.get('/appointments', async (req, res) => {
  let query = supabase
    .from('appointments')
    .select('*, doctors(full_name, title, email), departments(name)')
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true });
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return res.status(400).json({ error: 'Invalid status.' });
    query = query.eq('status', req.query.status);
  }
  const { data, error } = await query;
  if (error) return dbFail(res, error);
  res.json(data);
});

router.put('/appointments/:id', async (req, res) => {
  const b = pick(req.body, ['status', 'appointment_date', 'appointment_time', 'reason']);
  if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
  if (b.appointment_date !== undefined && !isDate(b.appointment_date)) return res.status(400).json({ error: 'Invalid date.' });
  if (b.appointment_time !== undefined && !isTime(String(b.appointment_time).slice(0, 5))) return res.status(400).json({ error: 'Invalid time.' });
  if (b.reason !== undefined) b.reason = clean(b.reason, 1000);
  b.updated_at = new Date().toISOString();

  // Remember what it was, so we only email the patient on a real change to "confirmed".
  const { data: before } = await supabase.from('appointments').select('status').eq('id', req.params.id).maybeSingle();

  const { data, error } = await supabase
    .from('appointments')
    .update(b)
    .eq('id', req.params.id)
    .select('*, doctors(full_name, title)')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That doctor already has an appointment at that time.' });
    return dbFail(res, error);
  }

  const result = { ...data };
  if (b.status === 'confirmed' && before && before.status !== 'confirmed') {
    try {
      await sendPatientConfirmation({ appointment: data, doctor: data.doctors });
      result.patientEmailed = true;
      // Best effort: older databases may not have this column yet.
      const { error: markErr } = await supabase.from('appointments').update({ patient_notified_at: new Date().toISOString() }).eq('id', data.id);
      if (markErr) console.error('[mail] could not record patient_notified_at:', markErr.message);
    } catch (e) {
      console.error(`[mail] Patient confirmation failed for appointment ${data.id}:`, e.message);
      result.patientEmailed = false;
      result.patientEmailError = String(e.message).slice(0, 220);
    }
  }
  res.json(result);
});

router.delete('/appointments/:id', async (req, res) => {
  const { error } = await supabase.from('appointments').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

// ---------- POSTS ----------
router.get('/posts', async (req, res) => {
  const { data, error } = await supabase.from('hospital_posts').select('*').order('created_at', { ascending: false });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.post('/posts', async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title is required.' });
  const payload = {
    title: b.title,
    slug: b.slug ? slugify(b.slug) : slugify(b.title) + '-' + Date.now().toString(36),
    excerpt: b.excerpt || null,
    body: b.body || null,
    cover_image_url: b.cover_image_url || null,
    is_published: b.is_published !== false,
  };
  const { data, error } = await supabase.from('hospital_posts').insert(payload).select().single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/posts/:id', async (req, res) => {
  const b = pick(req.body, ['title', 'slug', 'excerpt', 'body', 'cover_image_url', 'is_published']);
  if (b.slug) b.slug = slugify(String(b.slug));
  const { data, error } = await supabase.from('hospital_posts').update(b).eq('id', req.params.id).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.delete('/posts/:id', async (req, res) => {
  const { error } = await supabase.from('hospital_posts').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

router.post('/posts/:id/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const url = await uploadToSupabase(req.file, 'hospital-posts');
    res.json({ url });
  } catch (e) {
    uploadFail(res, e);
  }
});

// ---------- SITE CONTENT (hero/intro blocks + admin-added extra blocks) ----------
router.get('/content', async (req, res) => {
  const { data, error } = await supabase
    .from('site_content')
    .select('*')
    .eq('division', 'hospital')
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

function slugifyContentId(title) {
  return slugify(title) + '-' + Date.now().toString(36);
}

router.post('/content', async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title is required.' });
  const payload = {
    id: slugifyContentId(b.title),
    division: 'hospital',
    placement: 'extra',
    title: b.title,
    body: b.body || null,
    image_url: b.image_url || null,
    sort_order: b.sort_order ?? 100,
  };
  const { data, error } = await supabase.from('site_content').insert(payload).select().single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/content/:cid', async (req, res) => {
  const b = { ...pick(req.body, ['title', 'body', 'image_url', 'sort_order']), updated_at: new Date().toISOString() };
  if (b.title !== undefined) b.title = clean(b.title, 200);
  if (b.body !== undefined) b.body = clean(b.body, 5000);
  if (b.image_url && !/^https:\/\/[^\s]+$/i.test(String(b.image_url))) return res.status(400).json({ error: 'Image must be an https:// URL.' });
  const { data, error } = await supabase.from('site_content').update(b).eq('id', req.params.cid).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.delete('/content/:cid', async (req, res) => {
  const { data: row } = await supabase.from('site_content').select('placement').eq('id', req.params.cid).maybeSingle();
  if (row?.placement === 'fixed') {
    return res.status(400).json({ error: 'This is a built-in page section and cannot be deleted, only edited.' });
  }
  const { error } = await supabase.from('site_content').delete().eq('id', req.params.cid);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

router.post('/content/:cid/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const url = await uploadToSupabase(req.file, 'content');
    res.json({ url });
  } catch (e) {
    uploadFail(res, e);
  }
});

// Reorder content blocks in one call: body = { order: [id1, id2, id3, ...] }
router.put('/content-reorder', async (req, res) => {
  const order = req.body?.order || [];
  if (!Array.isArray(order) || !order.length || order.length > 500 || !order.every((x) => typeof x === 'string' && x.length < 200)) return res.status(400).json({ error: 'A valid order array is required.' });
  try {
    await Promise.all(order.map((id, i) => supabase.from('site_content').update({ sort_order: i }).eq('id', id)));
    res.json({ ok: true });
  } catch (e) {
    uploadFail(res, e);
  }
});

// ---------- PARTNERS (logo slider) ----------
router.get('/partners', async (req, res) => {
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .eq('division', 'hospital')
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.post('/partners', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.logo_url) return res.status(400).json({ error: 'Name and logo image are required.' });
  const payload = {
    division: 'hospital',
    name: b.name,
    logo_url: b.logo_url,
    website_url: b.website_url || null,
    sort_order: b.sort_order ?? 0,
    is_active: b.is_active !== false,
  };
  const { data, error } = await supabase.from('partners').insert(payload).select().single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/partners/:id', async (req, res) => {
  const b = pick(req.body, ['name', 'logo_url', 'website_url', 'sort_order', 'is_active']);
  const { data, error } = await supabase.from('partners').update(b).eq('id', req.params.id).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.delete('/partners/:id', async (req, res) => {
  const { error } = await supabase.from('partners').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

router.post('/partners/upload-logo', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const url = await uploadToSupabase(req.file, 'partners');
    res.json({ url });
  } catch (e) {
    uploadFail(res, e);
  }
});

router.put('/partners-reorder', async (req, res) => {
  const order = req.body?.order || [];
  if (!Array.isArray(order) || !order.length || order.length > 500 || !order.every((x) => typeof x === 'string' && x.length < 200)) return res.status(400).json({ error: 'A valid order array is required.' });
  try {
    await Promise.all(order.map((id, i) => supabase.from('partners').update({ sort_order: i }).eq('id', id)));
    res.json({ ok: true });
  } catch (e) {
    uploadFail(res, e);
  }
});

// ---------- BOARD OF DIRECTORS ----------
router.get('/board-members', async (req, res) => {
  const { data, error } = await supabase.from('board_members').select('*').order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.post('/board-members', async (req, res) => {
  const b = req.body || {};
  if (!b.full_name) return res.status(400).json({ error: 'Name is required.' });
  const payload = {
    full_name: b.full_name,
    role: b.role || null,
    bio: b.bio || null,
    photo_url: b.photo_url || null,
    sort_order: b.sort_order ?? 100,
    is_active: b.is_active !== false,
  };
  const { data, error } = await supabase.from('board_members').insert(payload).select().single();
  if (error) return dbFail(res, error);
  res.status(201).json(data);
});

router.put('/board-members/:id', async (req, res) => {
  const b = pick(req.body, ['full_name', 'role', 'bio', 'photo_url', 'sort_order', 'is_active']);
  const { data, error } = await supabase.from('board_members').update(b).eq('id', req.params.id).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.delete('/board-members/:id', async (req, res) => {
  const { error } = await supabase.from('board_members').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  res.json({ ok: true });
});

// Generic photo upload (not id-scoped) — mirrors partners/upload-logo so it
// works both when adding a brand-new member and when editing an existing one.
router.post('/board-members/upload-photo', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const url = await uploadToSupabase(req.file, 'board');
    res.json({ url });
  } catch (e) {
    uploadFail(res, e);
  }
});

router.put('/board-members-reorder', async (req, res) => {
  const order = req.body?.order || [];
  if (!Array.isArray(order) || !order.length || order.length > 500 || !order.every((x) => typeof x === 'string' && x.length < 200)) return res.status(400).json({ error: 'A valid order array is required.' });
  try {
    await Promise.all(order.map((id, i) => supabase.from('board_members').update({ sort_order: i }).eq('id', id)));
    res.json({ ok: true });
  } catch (e) {
    uploadFail(res, e);
  }
});

// ---------------------------------------------------------
// HERO SLIDES — photos rotating behind the home page headline
// ---------------------------------------------------------
const MAX_SLIDES = 8;

router.get('/hero-slides', async (req, res) => {
  const { data, error } = await supabase.from('hero_slides').select('*').order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

// Upload a photo and add it as the last slide.
router.post('/hero-slides', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });
  try {
    const { data: existing, error: listErr } = await supabase.from('hero_slides').select('sort_order');
    if (listErr) return dbFail(res, listErr);
    if (existing.length >= MAX_SLIDES) return res.status(400).json({ error: `You can have up to ${MAX_SLIDES} slides. Remove one first.` });

    const url = await uploadToSupabase(req.file, 'hero');
    const next = existing.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
    const { data, error } = await supabase
      .from('hero_slides')
      .insert({ image_url: url, sort_order: next })
      .select()
      .single();
    if (error) return dbFail(res, error);
    res.status(201).json(data);
  } catch (e) {
    uploadFail(res, e);
  }
});

// Change which part of the photo stays in view.
router.put('/hero-slides/:id', async (req, res) => {
  const y = Number(req.body?.focus_y);
  if (!Number.isInteger(y) || y < 0 || y > 100) return res.status(400).json({ error: 'Focus must be a whole number from 0 to 100.' });
  const { data, error } = await supabase.from('hero_slides').update({ focus_y: y }).eq('id', req.params.id).select().single();
  if (error) return dbFail(res, error);
  res.json(data);
});

router.put('/hero-slides-reorder', async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length || order.length > MAX_SLIDES || !order.every(isUuid)) {
    return res.status(400).json({ error: 'A valid order array is required.' });
  }
  const results = await Promise.all(order.map((id, i) => supabase.from('hero_slides').update({ sort_order: i }).eq('id', id)));
  const failed = results.find((r) => r.error);
  if (failed) return dbFail(res, failed.error);
  res.json({ ok: true });
});

router.delete('/hero-slides/:id', async (req, res) => {
  const { data: all, error: listErr } = await supabase.from('hero_slides').select('id, image_url');
  if (listErr) return dbFail(res, listErr);
  const row = all.find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Slide not found.' });
  if (all.length <= 1) return res.status(400).json({ error: 'Keep at least one slide. Add another photo first, then remove this one.' });

  const { error } = await supabase.from('hero_slides').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error);
  removeFromSupabase(row.image_url); // best effort, after the row is gone
  res.json({ ok: true });
});

module.exports = router;
