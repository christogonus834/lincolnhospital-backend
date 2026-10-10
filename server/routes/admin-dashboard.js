// server/routes/admin-dashboard.js
const express = require('express');
const supabase = require('../db/supabase');
const { dbFail } = require('../utils/http');

const router = express.Router();

// GET /api/admin/dashboard/stats
router.get('/stats', async (req, res) => {
  const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10); // Nigeria date
  const head = (table) => supabase.from(table).select('*', { count: 'exact', head: true });

  const [pending, confirmed, todays, doctors, unread] = await Promise.all([
    head('appointments').eq('status', 'pending'),
    head('appointments').eq('status', 'confirmed'),
    head('appointments').eq('appointment_date', today),
    head('doctors').eq('is_active', true),
    head('notifications').eq('is_read', false),
  ]);

  const failed = [pending, confirmed, todays, doctors, unread].find((r) => r.error);
  if (failed) return dbFail(res, failed.error);

  res.json({
    hospital: {
      pendingAppointments: pending.count || 0,
      confirmedAppointments: confirmed.count || 0,
      todaysAppointments: todays.count || 0,
      activeDoctors: doctors.count || 0,
    },
    unreadNotifications: unread.count || 0,
  });
});

module.exports = router;
