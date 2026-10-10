// server/db/supabase.js
// Single shared Supabase client using the SERVICE ROLE key.
// This file should only ever be imported on the server. The service role
// key bypasses Row Level Security, so all authorization checks for writes
// happen in our route handlers (requireAdmin middleware), not in the DB.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — the server will start but every database call will fail until these are set.'
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { persistSession: false } }
);

module.exports = supabase;
