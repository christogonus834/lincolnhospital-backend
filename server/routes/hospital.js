// server/routes/hospital.js — public hospital API
const express = require('express');
const supabase = require('../db/supabase');
const { bookingLimiter } = require('../middleware/security');
const { sendDoctorAppointmentAlert } = require('../utils/mailer');
const { isUuid, isEmail, isDate, isTime, clean, dbFail, validateId } = require('../utils/http');

const router = express.Router();
router.param('id', validateId);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Public doctor columns. NEVER select('*') on doctors here: the row also holds
// the doctor's private email address, which must not be exposed to visitors.
const DOCTOR_PUBLIC_COLS =
  'id, full_name, title, department_id, bio, photo_url, is_active, days_available, start_hour, end_hour, slot_minutes, created_at';

// Current date in Nigeria (WAT, UTC+1) as YYYY-MM-DD, so "today" and "past" are judged locally.
function todayInLagos() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}
function nowMinutesInLagos() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// Is HH:MM a real bookable slot in this doctor's schedule?
function isValidSlot(doctor, time) {
  const step = doctor.slot_minutes || 30;
  const [h, m] = time.split(':').map(Number);
  const mins = h * 60 + m;
  return mins >= doctor.start_hour * 60 && mins < doctor.end_hour * 60 && (mins - doctor.start_hour * 60) % step === 0;
}

// GET /api/hospital/departments
router.get('/departments', async (req, res) => {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

// GET /api/hospital/doctors?departmentId=
router.get('/doctors', async (req, res) => {
  let query = supabase.from('doctors').select(`${DOCTOR_PUBLIC_COLS}, departments(name, slug)`).eq('is_active', true);
  if (req.query.departmentId) {
    if (!isUuid(req.query.departmentId)) return res.status(400).json({ error: 'Invalid department.' });
    query = query.eq('department_id', req.query.departmentId);
  }
  const { data, error } = await query.order('full_name', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.get('/doctors/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('doctors')
    .select(`${DOCTOR_PUBLIC_COLS}, departments(name, slug)`)
    .eq('id', req.params.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) return dbFail(res, error);
  if (!data) return res.status(404).json({ error: 'Doctor not found.' });
  res.json(data);
});

// GET /api/hospital/slots?doctorId=&date=YYYY-MM-DD
router.get('/slots', async (req, res) => {
  const { doctorId, date } = req.query;
  if (!isUuid(doctorId) || !isDate(date)) return res.status(400).json({ error: 'A valid doctorId and date are required.' });

  const { data: doctor, error: docErr } = await supabase
    .from('doctors')
    .select('days_available, start_hour, end_hour, slot_minutes')
    .eq('id', doctorId)
    .eq('is_active', true)
    .maybeSingle();
  if (docErr) return dbFail(res, docErr);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });

  if (date < todayInLagos()) return res.json({ slots: [], note: 'That date has already passed.' });

  const dow = DAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()];
  if (!doctor.days_available?.includes(dow)) {
    return res.json({ slots: [], note: 'Doctor is not available on this day.' });
  }

  const { data: taken, error: bookedErr } = await supabase
    .from('appointments')
    .select('appointment_time')
    .eq('doctor_id', doctorId)
    .eq('appointment_date', date)
    .in('status', ['pending', 'confirmed']);
  if (bookedErr) return dbFail(res, bookedErr);

  const takenSet = new Set((taken || []).map((t) => t.appointment_time.slice(0, 5)));
  const isToday = date === todayInLagos();
  const nowMins = nowMinutesInLagos();

  const slots = [];
  const stepMin = doctor.slot_minutes || 30;
  for (let mins = doctor.start_hour * 60; mins < doctor.end_hour * 60; mins += stepMin) {
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const passed = isToday && mins <= nowMins;
    slots.push({ time: label, available: !takenSet.has(label) && !passed });
  }
  res.json({ slots });
});

// POST /api/hospital/appointments
// Books a slot, then emails the doctor through Brevo.
router.post('/appointments', bookingLimiter, async (req, res) => {
  const b = req.body || {};

  const patientName = clean(b.patientName, 120);
  const patientEmail = clean(b.patientEmail, 254)?.toLowerCase();
  const patientPhone = clean(b.patientPhone, 30);
  const reason = clean(b.reason, 1000);
  const { doctorId, appointmentDate, appointmentTime } = b;

  if (!patientName || patientName.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!patientEmail || !isEmail(patientEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (patientPhone && !/^[+\d][\d\s()-]{5,28}$/.test(patientPhone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (!isUuid(doctorId)) return res.status(400).json({ error: 'Please choose a doctor.' });
  if (!isDate(appointmentDate) || !isTime(appointmentTime)) return res.status(400).json({ error: 'Please choose a valid date and time.' });

  // Server-side truth about the doctor: never trust department/doctor info from the browser.
  const { data: doctor, error: docErr } = await supabase
    .from('doctors')
    .select('id, full_name, email, department_id, days_available, start_hour, end_hour, slot_minutes')
    .eq('id', doctorId)
    .eq('is_active', true)
    .maybeSingle();
  if (docErr) return dbFail(res, docErr);
  if (!doctor) return res.status(404).json({ error: 'That doctor is not available.' });

  const today = todayInLagos();
  if (appointmentDate < today) return res.status(400).json({ error: 'That date has already passed.' });
  if (appointmentDate === today) {
    const [h, m] = appointmentTime.split(':').map(Number);
    if (h * 60 + m <= nowMinutesInLagos()) return res.status(400).json({ error: 'That time has already passed.' });
  }
  const maxDate = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (appointmentDate > maxDate) return res.status(400).json({ error: 'Please choose a date within the next 4 months.' });

  const dow = DAY_NAMES[new Date(appointmentDate + 'T00:00:00Z').getUTCDay()];
  if (!doctor.days_available?.includes(dow)) return res.status(400).json({ error: 'The doctor is not available on that day.' });
  if (!isValidSlot(doctor, appointmentTime)) return res.status(400).json({ error: 'That is not a valid time slot for this doctor.' });

  // A unique index (doctor, date, time) among active bookings makes this
  // race-proof: if two patients submit at once, the second insert fails with 23505.
  const { data: appointment, error: insErr } = await supabase
    .from('appointments')
    .insert({
      doctor_id: doctor.id,
      department_id: doctor.department_id,
      patient_name: patientName,
      patient_email: patientEmail,
      patient_phone: patientPhone,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      reason,
    })
    .select('id, patient_name, patient_email, patient_phone, appointment_date, appointment_time, reason')
    .single();

  if (insErr) {
    if (insErr.code === '23505') return res.status(409).json({ error: 'Sorry, that slot was just taken. Please pick another time.' });
    return dbFail(res, insErr);
  }

  // Notify the doctor. A mail failure must never undo or fail the booking:
  // the front desk still sees it in the admin panel.
  let doctorNotified = false;
  try {
    await sendDoctorAppointmentAlert({ doctor, appointment });
    doctorNotified = true;
    await supabase.from('appointments').update({ doctor_notified_at: new Date().toISOString() }).eq('id', appointment.id);
  } catch (e) {
    console.error(`[mail] Doctor alert failed for appointment ${appointment.id}:`, e.message);
    await supabase.from('notifications').insert({
      division: 'hospital',
      type: 'doctor_email_failed',
      reference_id: appointment.id,
      title: `Doctor not emailed: ${doctor.full_name}`,
      body: doctor.email
        ? `The email alert for ${patientName}'s booking could not be sent (${String(e.message).slice(0, 220)}). Please tell the doctor directly.`
        : `${doctor.full_name} has no email address on file. Add one under Doctors so alerts can be sent.`,
    });
  }

  // Deliberately minimal response: no echo of other patients' data, no internals.
  res.status(201).json({ ok: true, id: appointment.id, doctorNotified });
});

// GET /api/hospital/posts
router.get('/posts', async (req, res) => {
  const { data, error } = await supabase
    .from('hospital_posts')
    .select('*')
    .eq('is_published', true)
    .order('published_at', { ascending: false });
  if (error) return dbFail(res, error);
  res.json(data);
});

router.get('/posts/:slug', async (req, res) => {
  const slug = String(req.params.slug).slice(0, 200);
  const { data, error } = await supabase
    .from('hospital_posts')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) return dbFail(res, error);
  if (!data) return res.status(404).json({ error: 'Post not found.' });
  res.json(data);
});

// GET /api/hospital/content
router.get('/content', async (req, res) => {
  const { data, error } = await supabase
    .from('site_content')
    .select('*')
    .eq('division', 'hospital')
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

// GET /api/hospital/partners
router.get('/partners', async (req, res) => {
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .eq('division', 'hospital')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

// GET /api/hospital/hero-slides
router.get('/hero-slides', async (req, res) => {
  const { data, error } = await supabase
    .from('hero_slides')
    .select('id, image_url, focus_y')
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

// GET /api/hospital/branding
router.get('/branding', async (req, res) => {
  const { data, error } = await supabase.from('site_settings').select('key, value').eq('key', 'hospital_logo').maybeSingle();
  if (error) return dbFail(res, error);
  res.json({ logo: data?.value || null });
});

// GET /api/hospital/board-members
router.get('/board-members', async (req, res) => {
  const { data, error } = await supabase
    .from('board_members')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) return dbFail(res, error);
  res.json(data);
});

module.exports = router;
