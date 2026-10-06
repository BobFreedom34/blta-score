const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

// On the persistent disk, not under public/ (which is replaced from git on every deploy) — same reasoning as the player
// photos and badge icons.
const DIR = path.join(db.dataDir, 'carousel');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

function serialize(r) {
  return { id: r.id, imageUrl: r.image_url, captionSk: r.caption_sk, captionEn: r.caption_en, subtextSk: r.subtext_sk, subtextEn: r.subtext_en, link: r.link, sortOrder: r.sort_order, active: !!r.active };
}

function deleteFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/carousel-images/')) return;
  fs.unlink(path.join(DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

// A link is a page of the site (/players) or a full address; anything else (javascript:…) is refused.
function cleanLink(raw) {
  const link = typeof raw === 'string' ? raw.trim() : '';
  if (link.length > 500) return { error: 'The link is too long' };
  if (link && !/^(\/(?!\/)|https?:\/\/)/.test(link)) return { error: 'The link must start with / or https://' };
  return { link };
}

function cleanText(raw, max, name) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v.length > max) return { error: `${name} is too long (max ${max} characters)` };
  return { v };
}

// Public — the home page shows the visible slides, in order.
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM carousel_slides WHERE active = 1 ORDER BY sort_order, id').all().map(serialize));
});

// Backend: every slide, hidden ones too.
router.get('/all', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM carousel_slides ORDER BY sort_order, id').all().map(serialize));
});

// One picture per request (the backend sends several one after the other); it goes to the end of the carousel.
router.post('/', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 6 MB' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG or WebP picture' });
    const filename = `slide-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(DIR, filename), req.file.buffer);
    const next = (db.prepare('SELECT MAX(sort_order) AS m FROM carousel_slides').get().m ?? -1) + 1;
    const info = db.prepare('INSERT INTO carousel_slides (image_url, sort_order) VALUES (?, ?)').run(`/carousel-images/${filename}`, next);
    res.status(201).json(serialize(db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(info.lastInsertRowid)));
  });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Slide not found' });
  const b = req.body || {};
  const values = { caption_sk: row.caption_sk, caption_en: row.caption_en, subtext_sk: row.subtext_sk, subtext_en: row.subtext_en, link: row.link, sort_order: row.sort_order, active: row.active };
  if (b.captionSk !== undefined) { const r = cleanText(b.captionSk, 120, 'The heading'); if (r.error) return res.status(400).json({ error: r.error }); values.caption_sk = r.v; }
  if (b.captionEn !== undefined) { const r = cleanText(b.captionEn, 120, 'The heading'); if (r.error) return res.status(400).json({ error: r.error }); values.caption_en = r.v; }
  if (b.subtextSk !== undefined) { const r = cleanText(b.subtextSk, 240, 'The subtext'); if (r.error) return res.status(400).json({ error: r.error }); values.subtext_sk = r.v; }
  if (b.subtextEn !== undefined) { const r = cleanText(b.subtextEn, 240, 'The subtext'); if (r.error) return res.status(400).json({ error: r.error }); values.subtext_en = r.v; }
  if (b.link !== undefined) { const r = cleanLink(b.link); if (r.error) return res.status(400).json({ error: r.error }); values.link = r.link; }
  if (b.sortOrder !== undefined) { if (!Number.isInteger(Number(b.sortOrder))) return res.status(400).json({ error: 'Invalid order' }); values.sort_order = Number(b.sortOrder); }
  if (b.active !== undefined) values.active = b.active ? 1 : 0;
  db.prepare('UPDATE carousel_slides SET caption_sk = ?, caption_en = ?, subtext_sk = ?, subtext_en = ?, link = ?, sort_order = ?, active = ? WHERE id = ?')
    .run(values.caption_sk, values.caption_en, values.subtext_sk, values.subtext_en, values.link, values.sort_order, values.active, row.id);
  res.json(serialize(db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(row.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM carousel_slides WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Slide not found' });
  deleteFile(row.image_url);
  db.prepare('DELETE FROM carousel_slides WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = router;
