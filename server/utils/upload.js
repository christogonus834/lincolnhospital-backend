// server/utils/upload.js
// Handles admin image uploads. Files arrive in memory via multer, are checked
// by their real file signature (not just the client-sent mimetype), then pushed
// to a Supabase Storage bucket. The public URL is returned for storage on the row.

const multer = require('multer');
const supabase = require('../db/supabase');

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = Object.prototype.hasOwnProperty.call(ALLOWED, file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, WEBP, or AVIF images are allowed.'), ok);
  },
});

// Confirm the bytes really are the image type the client claimed.
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(buf.slice(8, 16).toString('ascii'))) return 'image/avif';
  return null;
}

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'sterling-media';

async function uploadToSupabase(file, folder = 'general') {
  const realType = sniffImageType(file.buffer);
  if (!realType || realType !== file.mimetype) {
    const err = new Error('That file is not a valid image.');
    err.status = 400;
    throw err;
  }
  // Extension comes from the verified type, never from the user's filename.
  const ext = ALLOWED[realType];
  const safeFolder = String(folder).replace(/[^a-z0-9-]/gi, '');
  const path = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
    contentType: realType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Best-effort delete of a file we uploaded earlier, given its public URL.
async function removeFromSupabase(publicUrl) {
  try {
    const marker = `/object/public/${BUCKET}/`;
    const i = String(publicUrl || '').indexOf(marker);
    if (i === -1) return;
    const path = decodeURIComponent(publicUrl.slice(i + marker.length).split('?')[0]);
    await supabase.storage.from(BUCKET).remove([path]);
  } catch (e) {
    console.error('[storage] could not remove file:', e.message);
  }
}

module.exports = { upload, uploadToSupabase, removeFromSupabase, BUCKET };
