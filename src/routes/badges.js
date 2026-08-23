const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Lives on the persistent disk (same place as the DB file), not under
// public/ — public/ is replaced fresh from git on every deploy, which
// would silently delete every uploaded icon on the next push.
const ICONS_DIR = path.join(db.dataDir, 'badge-icons');
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

const ICON_MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, Object.prototype.hasOwnProperty.call(ICON_MIME_EXT, file.mimetype));
  },
});

const LOGIC_TYPES = ['GAMES_PLAYED', 'WINS', 'WIN_STREAK', 'CATEGORY_SWEEP', 'BAGEL', 'COMEBACK', 'STRAIGHT_SETS'];
// These logic types are count-based (need a threshold); the rest are
// pass/fail conditions computed straight from a player's match history.
const THRESHOLD_TYPES = ['GAMES_PLAYED', 'WINS', 'WIN_STREAK', 'STRAIGHT_SETS'];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    logicType: row.logic_type,
    threshold: row.threshold,
    sortOrder: row.sort_order,
  };
}

// Text-form icon (an emoji) is optional here — a badge can instead get its
// icon from POST /:id/icon (an uploaded image), which writes straight to
// the icon column and bypasses this validation entirely.
function validateBody(body, currentIcon) {
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const iconInput = (body.icon || '').trim();
  const logicType = body.logicType;
  if (!name) return { error: 'Name is required' };
  if (name.length > 60) return { error: 'Name is too long' };
  if (!description) return { error: 'Description is required' };
  if (description.length > 140) return { error: 'Description is too long' };
  if (iconInput && iconInput.length > 8) return { error: 'Icon should just be a single emoji' };
  const icon = iconInput || currentIcon || '🏅';
  if (!LOGIC_TYPES.includes(logicType)) return { error: 'Invalid logic type' };
  const needsThreshold = THRESHOLD_TYPES.includes(logicType);
  let threshold = null;
  if (needsThreshold) {
    threshold = Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 1) {
      return { error: 'Threshold must be a positive whole number for this logic type' };
    }
  }
  const sortOrder = Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  return { name, description, icon, logicType, threshold, sortOrder };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM badge_definitions ORDER BY sort_order, id').all();
  res.json(rows.map(serialize));
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const info = db.prepare(
    'INSERT INTO badge_definitions (name, description, icon, logic_type, threshold, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(parsed.name, parsed.description, parsed.icon, parsed.logicType, parsed.threshold, parsed.sortOrder);
  res.status(201).json(serialize(db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const badge = db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(req.params.id);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  const parsed = validateBody(req.body, badge.icon);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `UPDATE badge_definitions
     SET name = ?, description = ?, icon = ?, logic_type = ?, threshold = ?, sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(parsed.name, parsed.description, parsed.icon, parsed.logicType, parsed.threshold, parsed.sortOrder, badge.id);
  res.json(serialize(db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(badge.id)));
});

function isUploadedIcon(icon) {
  return typeof icon === 'string' && icon.startsWith('/badge-icons/');
}

function deleteIconFile(icon) {
  if (!isUploadedIcon(icon)) return;
  fs.unlink(path.join(ICONS_DIR, path.basename(icon)), () => { /* fine if it's already gone */ });
}

// Separate from the JSON create/edit endpoints since it's the one place
// this router deals with a file instead of a JSON body — invoking multer's
// middleware manually (rather than listing it declaratively) lets a bad
// upload (oversized, wrong type) come back as a normal JSON error instead
// of falling through to Express's default HTML error page.
router.post('/:id/icon', requireAdmin, (req, res) => {
  upload.single('icon')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 2MB' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    const badge = db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(req.params.id);
    if (!badge) return res.status(404).json({ error: 'Badge not found' });
    if (!req.file) return res.status(400).json({ error: 'Upload a PNG or JPG image' });
    const ext = ICON_MIME_EXT[req.file.mimetype];
    const filename = `badge-${badge.id}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(ICONS_DIR, filename), req.file.buffer);
    const iconPath = `/badge-icons/${filename}`;
    deleteIconFile(badge.icon);
    db.prepare(`UPDATE badge_definitions SET icon = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(iconPath, badge.id);
    res.json(serialize(db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(badge.id)));
  });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const badge = db.prepare('SELECT * FROM badge_definitions WHERE id = ?').get(req.params.id);
  if (!badge) return res.status(404).json({ error: 'Badge not found' });
  deleteIconFile(badge.icon);
  db.prepare('DELETE FROM badge_definitions WHERE id = ?').run(badge.id);
  res.status(204).end();
});

module.exports = router;
