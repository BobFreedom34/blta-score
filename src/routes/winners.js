// The winners page (/vitazi) and Backend > Winners: editions (a series or tournament) → category blocks → up to four places
// (slot 1 winner, 2 finalist, 3 and 4 semifinalists). A place is a player or a typed name, with an optional own photo.
// Foreign keys are not enforced in this database (see db.js), so every cascade is done here, and a player or season that
// was deleted afterwards simply reads as "not linked".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const MAX_TEXT = 120;

// On the persistent disk, not under public/ (replaced from git on every deploy) — same as the carousel and player photos.
const DIR = path.join(db.dataDir, 'winner-photos');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

// Only files this router wrote (their address starts with /winner-photos/) are ever removed.
function deletePhotoFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/winner-photos/')) return;
  fs.unlink(path.join(DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

// ---------------------------------------------------------------- reading

const EDITION_SQL = 'SELECT e.*, s.slug AS season_slug FROM winner_editions e LEFT JOIN seasons s ON s.id = e.season_id';

function placeRows(blockId) {
  return db.prepare(`
    SELECT wp.*, p.id AS live_player_id, p.name AS player_name, p.slug AS player_slug, p.photo_url AS player_photo
    FROM winner_places wp LEFT JOIN players p ON p.id = wp.player_id
    WHERE wp.block_id = ? ORDER BY wp.slot`).all(blockId);
}

// name: the player's own name while that player exists, else the name stored with the place;
// photo: the place's own photo, else the player's profile photo.
function serializePlace(r, admin) {
  const out = {
    slot: r.slot,
    name: r.live_player_id ? r.player_name : r.name,
    playerId: r.live_player_id || null,
    playerSlug: r.live_player_id ? (r.player_slug || null) : null,
    photoUrl: r.photo_url || (r.live_player_id ? r.player_photo : null) || null,
  };
  if (admin) {
    out.placeId = r.id;
    out.own = { playerId: r.live_player_id || null, name: r.name, photoUrl: r.photo_url || null };
  }
  return out;
}

// Public shape leaves out blocks that have no place; the admin sees every block.
function serializeEdition(row, admin) {
  const blocks = db.prepare('SELECT * FROM winner_blocks WHERE edition_id = ? ORDER BY sort_order, id').all(row.id)
    .map((b) => ({
      id: b.id,
      category: b.category || null,
      title: b.title || '',
      ...(admin ? { sortOrder: b.sort_order } : {}),
      places: placeRows(b.id).map((p) => serializePlace(p, admin)),
    }))
    .filter((b) => admin || b.places.length);
  const out = { id: row.id, title: row.title, seasonSlug: row.season_slug || null, blocks };
  if (admin) { out.seasonId = row.season_id || null; out.sortOrder = row.sort_order; out.visible = !!row.visible; }
  return out;
}

function loadEdition(id) {
  const row = db.prepare(`${EDITION_SQL} WHERE e.id = ?`).get(id);
  return row ? serializeEdition(row, true) : null;
}

// Public: the visible editions that have something to show, newest first (the order set in the backend).
router.get('/', (req, res) => {
  const rows = db.prepare(`${EDITION_SQL} WHERE e.visible = 1 ORDER BY e.sort_order, e.id`).all();
  res.json(rows.map((r) => serializeEdition(r, false)).filter((e) => e.blocks.length));
});

router.get('/all', requireAdmin, (req, res) => {
  res.json(db.prepare(`${EDITION_SQL} ORDER BY e.sort_order, e.id`).all().map((r) => serializeEdition(r, true)));
});

// ---------------------------------------------------------------- helpers

function cleanTitle(raw, { required }) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (required && !v) return { error: 'Title is required' };
  if (v.length > MAX_TEXT) return { error: `Title is too long (max ${MAX_TEXT} characters)` };
  return { v };
}

function cleanCategory(raw) {
  if (raw === null || raw === undefined || raw === '') return { v: null };
  if (!CATEGORIES.includes(raw)) return { error: 'Unknown category' };
  return { v: raw };
}

function checkSeason(raw) {
  if (raw === null || raw === '' || raw === undefined) return { v: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM seasons WHERE id = ?').get(id)) return { error: 'Season not found' };
  return { v: id };
}

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Removes the places of the given blocks (rows first, photo files after the commit).
function deleteBlocks(blockIds) {
  const urls = [];
  inTransaction(() => {
    blockIds.forEach((blockId) => {
      db.prepare('SELECT photo_url FROM winner_places WHERE block_id = ?').all(blockId).forEach((p) => urls.push(p.photo_url));
      db.prepare('DELETE FROM winner_places WHERE block_id = ?').run(blockId);
      db.prepare('DELETE FROM winner_blocks WHERE id = ?').run(blockId);
    });
  });
  urls.forEach(deletePhotoFile);
}

// ---------------------------------------------------------------- editions

router.post('/editions', requireAdmin, (req, res) => {
  const body = req.body || {};
  const title = cleanTitle(body.title, { required: true });
  if (title.error) return res.status(400).json({ error: title.error });
  const season = checkSeason(body.seasonId);
  if (season.error) return res.status(400).json({ error: season.error });
  const first = (db.prepare('SELECT MIN(sort_order) AS m FROM winner_editions').get().m ?? 1) - 1;
  const info = db.prepare('INSERT INTO winner_editions (title, season_id, sort_order) VALUES (?, ?, ?)').run(title.v, season.v, first);
  res.status(201).json(loadEdition(info.lastInsertRowid));
});

router.patch('/editions/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM winner_editions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Edition not found' });
  const body = req.body || {};
  const next = { title: row.title, season_id: row.season_id, sort_order: row.sort_order, visible: row.visible };
  if (body.title !== undefined) {
    const t = cleanTitle(body.title, { required: true });
    if (t.error) return res.status(400).json({ error: t.error });
    next.title = t.v;
  }
  if (body.seasonId !== undefined) {
    const s = checkSeason(body.seasonId);
    if (s.error) return res.status(400).json({ error: s.error });
    next.season_id = s.v;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(Number(body.sortOrder))) return res.status(400).json({ error: 'Invalid order' });
    next.sort_order = Number(body.sortOrder);
  }
  if (body.visible !== undefined) next.visible = body.visible ? 1 : 0;
  db.prepare('UPDATE winner_editions SET title = ?, season_id = ?, sort_order = ?, visible = ? WHERE id = ?')
    .run(next.title, next.season_id, next.sort_order, next.visible, row.id);
  res.json(loadEdition(row.id));
});

router.delete('/editions/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM winner_editions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Edition not found' });
  deleteBlocks(db.prepare('SELECT id FROM winner_blocks WHERE edition_id = ?').all(row.id).map((b) => b.id));
  db.prepare('DELETE FROM winner_editions WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- blocks

// A block is either one of the three categories or has its own title ("Konečné poradie").
function checkBlockValues(category, title) {
  if (!category && !title) return 'Give the block a title or pick a category';
  return null;
}

router.post('/editions/:id/blocks', requireAdmin, (req, res) => {
  const edition = db.prepare('SELECT id FROM winner_editions WHERE id = ?').get(req.params.id);
  if (!edition) return res.status(404).json({ error: 'Edition not found' });
  const body = req.body || {};
  const category = cleanCategory(body.category);
  if (category.error) return res.status(400).json({ error: category.error });
  const title = cleanTitle(body.title, { required: false });
  if (title.error) return res.status(400).json({ error: title.error });
  const problem = checkBlockValues(category.v, title.v);
  if (problem) return res.status(400).json({ error: problem });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM winner_blocks WHERE edition_id = ?').get(edition.id).m ?? -1) + 1;
  db.prepare('INSERT INTO winner_blocks (edition_id, category, title, sort_order) VALUES (?, ?, ?, ?)').run(edition.id, category.v, title.v, next);
  res.status(201).json(loadEdition(edition.id));
});

router.patch('/blocks/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM winner_blocks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Block not found' });
  const body = req.body || {};
  const next = { category: row.category, title: row.title, sort_order: row.sort_order };
  if (body.category !== undefined) {
    const c = cleanCategory(body.category);
    if (c.error) return res.status(400).json({ error: c.error });
    next.category = c.v;
  }
  if (body.title !== undefined) {
    const t = cleanTitle(body.title, { required: false });
    if (t.error) return res.status(400).json({ error: t.error });
    next.title = t.v;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(Number(body.sortOrder))) return res.status(400).json({ error: 'Invalid order' });
    next.sort_order = Number(body.sortOrder);
  }
  const problem = checkBlockValues(next.category, next.title);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE winner_blocks SET category = ?, title = ?, sort_order = ? WHERE id = ?').run(next.category, next.title, next.sort_order, row.id);
  res.json(loadEdition(row.edition_id));
});

router.delete('/blocks/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM winner_blocks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Block not found' });
  deleteBlocks([row.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- places

// Saves the places of one block at once: the slots in the body are kept or updated, the others are removed. A listed slot
// with neither a player nor a name is removed too. Photos stay as they are (a removed slot loses its photo file).
router.put('/blocks/:id/places', requireAdmin, (req, res) => {
  const block = db.prepare('SELECT * FROM winner_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Block not found' });
  const list = req.body && req.body.places;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'places must be a list' });

  const wanted = new Map();
  for (const item of list) {
    const slot = Number(item && item.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) return res.status(400).json({ error: 'Slot must be 1 to 4' });
    if (wanted.has(slot)) return res.status(400).json({ error: 'Each slot can be used only once' });
    const typed = typeof item.name === 'string' ? item.name.trim() : '';
    if (typed.length > MAX_TEXT) return res.status(400).json({ error: `Name is too long (max ${MAX_TEXT} characters)` });
    let playerId = null;
    let name = typed;
    if (item.playerId !== undefined && item.playerId !== null && item.playerId !== '') {
      const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(Number(item.playerId));
      if (!player) return res.status(400).json({ error: 'Player not found' });
      playerId = player.id;
      name = player.name; // a snapshot, used if the player is deleted later
    }
    wanted.set(slot, { playerId, name });
  }

  const removedUrls = [];
  inTransaction(() => {
    const existing = db.prepare('SELECT * FROM winner_places WHERE block_id = ?').all(block.id);
    existing.forEach((p) => {
      const w = wanted.get(p.slot);
      if (w && (w.playerId || w.name)) return;
      removedUrls.push(p.photo_url);
      db.prepare('DELETE FROM winner_places WHERE id = ?').run(p.id);
    });
    wanted.forEach((w, slot) => {
      if (!w.playerId && !w.name) return;
      const had = existing.find((p) => p.slot === slot);
      if (had) db.prepare('UPDATE winner_places SET player_id = ?, name = ? WHERE id = ?').run(w.playerId, w.name, had.id);
      else db.prepare('INSERT INTO winner_places (block_id, slot, player_id, name) VALUES (?, ?, ?, ?)').run(block.id, slot, w.playerId, w.name);
    });
  });
  removedUrls.forEach(deletePhotoFile);
  res.json(loadEdition(block.edition_id));
});

// ---------------------------------------------------------------- photos

function editionOfPlace(placeId) {
  const r = db.prepare('SELECT b.edition_id AS edition_id FROM winner_places p JOIN winner_blocks b ON b.id = p.block_id WHERE p.id = ?').get(placeId);
  return r ? r.edition_id : null;
}

router.post('/places/:id/photo', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 6 MB' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG or WebP picture' });
    const place = db.prepare('SELECT * FROM winner_places WHERE id = ?').get(req.params.id);
    if (!place) return res.status(404).json({ error: 'Place not found' });
    const filename = `win-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(DIR, filename), req.file.buffer);
    db.prepare('UPDATE winner_places SET photo_url = ? WHERE id = ?').run(`/winner-photos/${filename}`, place.id);
    deletePhotoFile(place.photo_url);
    res.json(loadEdition(editionOfPlace(place.id)));
  });
});

router.delete('/places/:id/photo', requireAdmin, (req, res) => {
  const place = db.prepare('SELECT * FROM winner_places WHERE id = ?').get(req.params.id);
  if (!place) return res.status(404).json({ error: 'Place not found' });
  db.prepare('UPDATE winner_places SET photo_url = NULL WHERE id = ?').run(place.id);
  deletePhotoFile(place.photo_url);
  res.json(loadEdition(editionOfPlace(place.id)));
});

module.exports = router;
