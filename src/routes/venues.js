const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const leagues = require('../leagues');
const { requireAdmin } = require('../auth');
const engine = require('../matchEngine');
const venues = require('../venues');

const router = express.Router();

// Photos uploaded in /venues-admin live on the persistent disk (not under public/, which is replaced on every deploy), next to the other
// uploads. The admin page shrinks every photo to 768 x 432 (16:9) before it is sent; the card on /courts shows it in a 16:9 frame either way.
const PHOTO_DIR = path.join(db.dataDir, 'venue-photos');
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

// Only files this router wrote (their address starts with /venue-photos/) are ever removed; the photos shipped with the app under /img/courts/ stay.
function deletePhotoFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/venue-photos/')) return;
  fs.unlink(path.join(PHOTO_DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

function parseName(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Name is required' };
  if (name.length > 120) return { error: 'Name is too long (max 120 characters)' };
  return { name };
}

// A match's location is free text ("NTC Bratislava, kurt 3", "Dudova",
// "Eci"…), so which venue it belongs to is worked out by alias matching in
// venues.buildLocationMatcher — in JS rather than SQL, since it has to fold
// Slovak diacritics.
function matchesAtVenue(venueId) {
  const matchesLocation = venues.buildLocationMatcher(db.prepare('SELECT id, name FROM venues').all());
  const rows = db.prepare(`
    SELECT m.*, p1.name AS p1_name, p1.slug AS p1_slug, p2.name AS p2_name, p2.slug AS p2_slug
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    WHERE m.location != ''
  `).all().filter((r) => matchesLocation(r.location) === venueId);

  const when = (r) => r.scheduled_at || r.end_time || r.updated_at || '';
  const shape = (r) => ({
    token: r.share_token,
    status: r.status,
    category: r.category,
    scheduledAt: r.scheduled_at,
    location: r.location,
    player1: { id: r.player1_id, name: r.p1_name, slug: r.p1_slug },
    player2: { id: r.player2_id, name: r.p2_name, slug: r.p2_slug },
    winnerId: r.winner_id,
    scoreSummary: r.status === 'PLANNED' ? '' : engine.describeMatch(JSON.parse(r.state)),
  });
  const upcoming = rows
    .filter((r) => r.status === 'PLANNED' || r.status === 'LIVE')
    .sort((a, b) => (when(a) < when(b) ? -1 : 1))
    .slice(0, 10)
    .map(shape);
  const recent = rows
    .filter((r) => r.status === 'FINISHED')
    .sort((a, b) => (when(a) < when(b) ? 1 : -1))
    .slice(0, 10)
    .map(shape);
  return { upcoming, recent };
}

// Public — the location autocomplete on every match form and the /courts
// pages all read this, logged in or not.
router.get('/', (req, res) => {
  // the order set in the backend (dragging), then the venues that have none, alphabetically
  const rows = db.prepare('SELECT * FROM venues WHERE league_id = ? ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE').all(leagues.actingIdOf(req));
  res.json(rows.map(venues.serialize));
});

// Saves the order of the list: { ids: [venue ids in the new order] }. A venue left out of the list goes after the listed ones, in the order it had.
router.post('/reorder', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
  const current = db.prepare('SELECT id FROM venues ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE').all().map((r) => r.id);
  if (!ids.length || ids.some((id) => !current.includes(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'List venues that exist, each once' });
  const order = [...ids, ...current.filter((id) => !ids.includes(id))];
  const set = db.prepare('UPDATE venues SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    order.forEach((id, i) => set.run(i, id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(db.prepare('SELECT * FROM venues ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE').all().map(venues.serialize));
});

router.get('/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM venues WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Venue not found' });
  res.json({ ...venues.serialize(row), matches: matchesAtVenue(row.id) });
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = parseName(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const details = venues.parseDetails(req.body);
  if (details.error) return res.status(400).json({ error: details.error });
  if (db.prepare('SELECT 1 FROM venues WHERE name = ?').get(parsed.name)) {
    return res.status(400).json({ error: 'That venue already exists' });
  }
  // a new venue goes to the end once the list has an order of its own
  const leagueId = leagues.actingIdOf(req);
  const last = db.prepare('SELECT MAX(sort_order) AS m FROM venues WHERE league_id = ?').get(leagueId).m;
  const columns = { league_id: leagueId, name: parsed.name, slug: venues.uniqueSlug(parsed.name), ...(last === null || last === undefined ? {} : { sort_order: last + 1 }), ...details.columns };
  const names = Object.keys(columns);
  const info = db.prepare(`INSERT INTO venues (${names.join(', ')}) VALUES (${names.map((n) => `@${n}`).join(', ')})`).run(columns);
  res.status(201).json(venues.serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(info.lastInsertRowid)));
});

// Partial: only the fields present in the body change. The slug is
// deliberately NOT regenerated on rename, so shared /courts/<slug> links
// keep working.
router.patch('/:id', requireAdmin, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  const columns = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
    const parsed = parseName(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const clash = db.prepare('SELECT id FROM venues WHERE name = ? AND id != ?').get(parsed.name, venue.id);
    if (clash) return res.status(400).json({ error: 'That venue already exists' });
    columns.name = parsed.name;
  }
  const details = venues.parseDetails(req.body);
  if (details.error) return res.status(400).json({ error: details.error });
  Object.assign(columns, details.columns);
  const names = Object.keys(columns);
  if (names.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  db.prepare(`UPDATE venues SET ${names.map((n) => `${n} = @${n}`).join(', ')} WHERE id = @id`).run({ ...columns, id: venue.id });
  res.json(venues.serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id)));
});

router.post('/:id/photo', requireAdmin, (req, res) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 6 MB' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP picture' });
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const filename = `${venue.slug || 'venue'}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(PHOTO_DIR, filename), req.file.buffer);
    db.prepare('UPDATE venues SET image_url = ? WHERE id = ?').run(`/venue-photos/${filename}`, venue.id);
    deletePhotoFile(venue.image_url);
    res.json(venues.serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id)));
  });
});

router.delete('/:id/photo', requireAdmin, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  db.prepare('UPDATE venues SET image_url = NULL WHERE id = ?').run(venue.id);
  deletePhotoFile(venue.image_url);
  res.json(venues.serialize(db.prepare('SELECT * FROM venues WHERE id = ?').get(venue.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  db.prepare('DELETE FROM venues WHERE id = ?').run(venue.id);
  deletePhotoFile(venue.image_url);
  res.json({ ok: true });
});

module.exports = router;
