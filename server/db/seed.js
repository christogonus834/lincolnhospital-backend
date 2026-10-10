// server/db/seed.js
// Populates Supabase with Sterling Specialist Hospital content (departments,
// doctors, a first article, partners) plus the first admin login.
// Run once with: npm run seed
//
// Requires SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env (min 12 chars).
// There is deliberately NO default password.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const img = {
  hospitalExterior: 'https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?q=80&w=1600',
  icu: 'https://images.unsplash.com/photo-1605548230624-c5d0a4f3d3d8?q=80&w=1600',
  doctorGeneric: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?q=80&w=800',
};

async function upsert(table, rows, conflictCol = 'id') {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflictCol });
  if (error) console.error(`Seed error in ${table}:`, error.message);
  else console.log(`Seeded ${rows.length} row(s) into ${table}`);
}

async function main() {
  // ---------- ADMIN ----------
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
  if (!adminEmail || adminPassword.length < 12) {
    console.error('Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters in .env, then run again.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(adminPassword, 12);
  await upsert('admins', [{ email: adminEmail, password_hash: hash, full_name: 'Hospital Admin' }], 'email');
  console.log(`\nAdmin created -> ${adminEmail}\nRemove SEED_ADMIN_PASSWORD from .env now that the account exists.\n`);

  // ---------- SITE CONTENT ----------
  await upsert('site_content', [
    {
      id: 'hospital_hero',
      division: 'hospital',
      placement: 'fixed',
      title: 'Healthcare excellence, delivered with heart.',
      body: 'A multispecialty hospital in Borikiri, Port Harcourt, with 19 consultants across obstetrics, surgery, paediatrics, nephrology and more, plus a 24-hour intensive care unit.',
      image_url: null,
      sort_order: 0,
    },
    {
      id: 'hospital_intro',
      division: 'hospital',
      placement: 'fixed',
      title: 'Personalised Total Healthcare',
      body: 'Sterling Specialist Hospital is a multispecialty health facility geared towards providing quality health care services, operated by seasoned health care professionals at 5 King Jaja Street, Borikiri, Port Harcourt.',
      image_url: img.hospitalExterior,
      sort_order: 1,
    },
  ]);

  // ---------- HOSPITAL: DEPARTMENTS ----------
  const departments = [
    { name: 'Obstetrics & Gynaecology', slug: 'obs-gyn', description: 'Gynaecological care, laparoscopic surgery, and oncology.', icon_key: 'heart', sort_order: 1 },
    { name: 'Paediatrics', slug: 'paediatrics', description: 'Child health, neonatal services, and special baby care.', icon_key: 'baby', sort_order: 2 },
    { name: 'Internal Medicine', slug: 'internal-medicine', description: 'General medicine and internal medicine consultations.', icon_key: 'pulse', sort_order: 3 },
    { name: 'Surgery', slug: 'surgery', description: 'General, plastic, cosmetic, orthopedic, and neuro-surgery.', icon_key: 'scalpel', sort_order: 4 },
    { name: 'Nephrology & Dialysis', slug: 'nephrology', description: 'Renal replacement therapy and haemodialysis.', icon_key: 'droplet', sort_order: 5 },
    { name: 'ENT', slug: 'ent', description: 'Ear, nose and throat care.', icon_key: 'ear', sort_order: 6 },
    { name: 'Dermatology', slug: 'dermatology', description: 'Skin health and cosmetic dermatology.', icon_key: 'skin', sort_order: 7 },
    { name: 'Radiology & Laboratory', slug: 'radiology-lab', description: 'Diagnostic imaging, ECG/ECHO, and full laboratory services.', icon_key: 'scan', sort_order: 8 },
    { name: 'Physiotherapy', slug: 'physiotherapy', description: 'Manual therapy and rehabilitation for all ages.', icon_key: 'activity', sort_order: 9 },
    { name: 'Intensive Care', slug: 'icu', description: '24-hour intensive care and emergency evacuation services.', icon_key: 'monitor', sort_order: 10 },
  ];
  await upsert('departments', departments, 'slug');

  const { data: deptRows } = await supabase.from('departments').select('id, slug');
  const deptId = (slug) => deptRows?.find((d) => d.slug === slug)?.id || null;

  // ---------- HOSPITAL: DOCTORS (from the specialist list) ----------
  const doctors = [
    { full_name: 'Dr Awoye Godspower', title: 'Consultant Gynaecologist', department_id: deptId('obs-gyn') },
    { full_name: 'Prof. Nyengidiki Tamunomie Kennedy', title: 'Gynaecological Oncologist', department_id: deptId('obs-gyn') },
    { full_name: 'Dr Amanda David West', title: 'Consultant Nephrologist', department_id: deptId('nephrology') },
    { full_name: 'Dr Itekena Wakama', title: 'General Surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Akunwkwe Mishack', title: 'Plastic Surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Nemi Aria', title: 'Plastic / Cosmetic Surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Ogan John', title: 'Gastroenterologist', department_id: deptId('internal-medicine') },
    { full_name: 'Dr Brownson Niabari', title: 'Orthopedic Surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Job Gogo Otokwala', title: 'Anaesthesiologist', department_id: deptId('surgery') },
    { full_name: 'Dr Altrade Dasetima', title: 'Consultant Dermatologist', department_id: deptId('dermatology') },
    { full_name: 'Dr Ajoku', title: 'Neuro-surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Ireogbu Linda', title: 'Neuro-surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Ernest Vincent', title: 'Consultant Neurologist', department_id: deptId('internal-medicine') },
    { full_name: 'Dr Amadi', title: 'Cardiovascular Surgeon', department_id: deptId('surgery') },
    { full_name: 'Dr Ideriah Joseph', title: 'Consultant Psychiatrist', department_id: deptId('internal-medicine') },
    { full_name: 'Dr Danagogo', title: 'Consultant Urologist', department_id: deptId('surgery') },
    { full_name: 'Dr Godson Jack', title: 'Consultant Radiologist', department_id: deptId('radiology-lab') },
    { full_name: 'Dr Ebong Mbak Etukudo', title: 'Consultant Otorhinolaryngology', department_id: deptId('ent') },
    { full_name: 'Queen Temple Sandra', title: 'Physiotherapist', department_id: deptId('physiotherapy') },
  ].map((d) => ({
    full_name: d.full_name,
    title: d.title,
    department_id: d.department_id,
    photo_url: img.doctorGeneric,
    bio: `${d.title} at Sterling Specialist Hospital.`,
    days_available: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_hour: 9,
    end_hour: 16,
    slot_minutes: 30,
    is_active: true,
  }));

  const { error: docErr } = await supabase.from('doctors').insert(doctors);
  if (docErr) console.error('Seed error in doctors:', docErr.message);
  else console.log(`Seeded ${doctors.length} row(s) into doctors`);

  // ---------- HOSPITAL: a first post ----------
  await upsert('hospital_posts', [{
    title: 'World-Class Intensive Care, Close to Home',
    slug: 'world-class-icu',
    excerpt: 'High levels of staffing and specialist monitoring equipment, right here in Port Harcourt.',
    body: 'Our Intensive Care Unit is built to world-class standard, with high levels of staffing and specialist monitoring and treatment equipment available around the clock, cared for by highly trained staff.',
    cover_image_url: img.icu,
    is_published: true,
  }], 'slug');

  // ---------- HOSPITAL: PARTNERS (real names from the corporate profile) ----------
  // logo_url is a neutral placeholder text-tile until the admin uploads the real mark.
  const placeholderLogo = (label) =>
    `https://placehold.co/240x120/e9f1ef/163f52?text=${encodeURIComponent(label)}&font=roboto`;

  const hospitalPartnerNames = [
    'SPDC', 'Belema Oil', 'PHED', 'Notore', 'Multinational Technologies',
    'Sahara Group', 'Dredging International Services', 'SFCG', 'Green Energy',
    'Wisdo Maritime', 'Mertesacker Nig Ltd', 'Eroton', 'Aiteo Group',
    'DNV GL Nigeria WACTL', 'Sanlam Life Insurance', 'HIOSL A', 'Axa Mansard',
    'Assene Laborex', 'ABInBev Nigeria', 'Ocean Deep', 'Weatherford Nigeria',
    'AMNI International', 'Seplat', 'Ocean Marine', 'GTBank', 'Brightwaters Energy',
    'Hyprep', 'Access Bank', 'Olamartek Global Resources', 'Saipem', 'Jimaco',
    'LDS Church', 'Michael Stevens', 'BBC Nigeria', 'Rainoil', 'NDDC',
  ];

  const hospitalPartners = hospitalPartnerNames.map((name, i) => ({
    division: 'hospital',
    name,
    logo_url: placeholderLogo(name),
    sort_order: i,
    is_active: true,
  }));

  // Clear any previously seeded hospital partners before re-inserting, so
  // re-running the seed script doesn't create duplicates (no unique slug here).
  const { data: existingHospitalPartners } = await supabase
    .from('partners')
    .select('id')
    .eq('division', 'hospital');
  if (existingHospitalPartners?.length) {
    await supabase.from('partners').delete().eq('division', 'hospital');
  }
  const { error: partnersErr } = await supabase.from('partners').insert(hospitalPartners);
  if (partnersErr) console.error('Seed error in partners (hospital):', partnersErr.message);
  else console.log(`Seeded ${hospitalPartners.length} row(s) into partners (hospital)`);

  // ---------- SITE SETTINGS: logo (null = default SVG mark) ----------
  await upsert('site_settings', [{ key: 'hospital_logo', value: null }], 'key');

  console.log('\nSeed complete. Add each doctor\'s email in Admin > Doctors so booking alerts reach them.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
