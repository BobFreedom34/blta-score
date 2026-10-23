// Sponsors and partners (Backend > Sponsors): a name, a logo and a link, shown as a "Partners" strip on the home page of a city, on the page of a
// season or tournament, or on the national page (slta.sk). A sponsor belongs to a city (league_id; 0 = the national site, super admin only) and
// may be tied to one season (season_id; empty = the whole city). It can be switched off and given a time window. The clicks on its logo are
// counted (a visitor is counted once a minute per sponsor).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const leagues = require('../leagues');
const { requireAdmin, isSuperAdmin } = require('../auth');

const router = express.Router();

db.exec(`
  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL DEFAULT 1,
    season_id INTEGER,
    name TEXT NOT NULL,
    logo_url TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sponsors_league ON sponsors(league_id);
`);

// On the persistent disk like the other uploads (served at /sponsor-logos, see server.js)
const DIR = path.join(db.dataDir, 'sponsor-logos');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

const NATIONAL = 0;
const sponsorLeague = (req) => (req.query.scope === 'national' && isSuperAdmin(req) ? NATIONAL : leagues.actingIdOf(req));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const serialize = (r) => ({
  id: r.id, name: r.name, logoUrl: r.logo_url, link: r.link, seasonId: r.season_id || null, startDate: r.start_date || '', endDate: r.end_date || '',
  active: !!r.active, sortOrder: r.sort_order, clicks: r.clicks, leagueId: r.league_id,
});
// what a visitor gets: no dates, no counters
const publicShape = (r) => ({ id: r.id, name: r.name, logoUrl: r.logo_url, link: r.link });

function deleteFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/sponsor-logos/')) return;
  fs.unlink(path.join(DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

// Reads and checks the fields of a sponsor from a request body; returns { error } or { values } (only the fields that were sent).
function parse(body, leagueId) {
  const values = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'The name is required' };
    if (name.length > 100) return { error: 'The name is too long (max 100 characters)' };
    values.name = name;
  }
  if (body.link !== undefined) {
    const link = typeof body.link === 'string' ? body.link.trim() : '';
    if (link.length > 500) return { error: 'The link is too long' };
    if (link && !/^https?:\/\/\S+$/i.test(link)) return { error: 'The link must start with https://' };
    values.link = link;
  }
  for (const [key, column, label] of [['startDate', 'start_date', 'The start date'], ['endDate', 'end_date', 'The end date']]) {
    if (body[key] === undefined) continue;
    const v = body[key] === null ? '' : String(body[key]).trim();
    if (v && !ISO_DATE.test(v)) return { error: `${label} must look like 2027-01-31` };
    values[column] = v || null;
  }
  if (values.start_date && values.end_date && values.end_date < values.start_date) return { error: 'The end date is before the start date' };
  if (body.seasonId !== undefined) {
    if (body.seasonId === null || body.seasonId === '') values.season_id = null;
    else {
      const season = db.prepare('SELECT id, league_id FROM seasons WHERE id = ?').get(Number(body.seasonId));
      if (!season || season.league_id !== leagueId) return { error: 'That season does not belong to this city' };
      values.season_id = season.id;
    }
  }
  if (body.active !== undefined) values.active = body.active ? 1 : 0;
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(Number(body.sortOrder))) return { error: 'The order must be a whole number' };
    values.sort_order = Number(body.sortOrder);
  }
  return { values };
}

// Public: the sponsors to show now (switched on, inside their time window). ?scope=national: the national site; ?seasonId=: the sponsors of
// that season; without either: the sponsors of the whole city (the home page).
router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let where = 'league_id = ? AND season_id IS NULL';
  const args = [];
  if (req.query.scope === 'national') args.push(NATIONAL);
  else {
    args.push(leagues.actingIdOf(req));
    const seasonId = Number(req.query.seasonId);
    if (Number.isInteger(seasonId) && seasonId > 0) { where = 'league_id = ? AND season_id = ?'; args.push(seasonId); }
  }
  const rows = db.prepare(`SELECT * FROM sponsors WHERE ${where} AND active = 1 AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?) ORDER BY sort_order, id`).all(...args, today, today);
  res.json(rows.map(publicShape));
});

// Backend: every sponsor of the city (switched off ones too), with the clicks.
router.get('/all', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM sponsors WHERE league_id = ? ORDER BY sort_order, id').all(sponsorLeague(req)).map(serialize));
});

router.post('/', requireAdmin, (req, res) => {
  const leagueId = sponsorLeague(req);
  const parsed = parse(req.body || {}, leagueId);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.values.name) return res.status(400).json({ error: 'The name is required' });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM sponsors WHERE league_id = ?').get(leagueId).m ?? -1) + 1;
  const v = { link: '', start_date: null, end_date: null, season_id: null, active: 1, sort_order: next, ...parsed.values };
  const info = db.prepare('INSERT INTO sponsors (league_id, season_id, name, link, start_date, end_date, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(leagueId, v.season_id, v.name, v.link, v.start_date, v.end_date, v.active, v.sort_order);
  res.status(201).json(serialize(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sponsors WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Sponsor not found' });
  const parsed = parse(req.body || {}, row.league_id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const next = { ...row, ...parsed.values };
  if (next.start_date && next.end_date && next.end_date < next.start_date) return res.status(400).json({ error: 'The end date is before the start date' });
  db.prepare('UPDATE sponsors SET name = ?, link = ?, start_date = ?, end_date = ?, season_id = ?, active = ?, sort_order = ? WHERE id = ?')
    .run(next.name, next.link, next.start_date, next.end_date, next.season_id, next.active, next.sort_order, row.id);
  res.json(serialize(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(row.id)));
});

// The logo: a picture from the computer or the library (the file is a copy of its own, replaced by the next one)
router.post('/:id/logo', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The logo must be under 4 MB' : 'Could not process the uploaded file' });
    if (!req.file) return res.status(400).json({ error: 'Upload a PNG, JPG or WebP picture' });
    const row = db.prepare('SELECT * FROM sponsors WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Sponsor not found' });
    const filename = `sponsor-${row.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${MIME_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(DIR, filename), req.file.buffer);
    db.prepare('UPDATE sponsors SET logo_url = ? WHERE id = ?').run(`/sponsor-logos/${filename}`, row.id);
    deleteFile(row.logo_url);
    res.json(serialize(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(row.id)));
  });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sponsors WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Sponsor not found' });
  deleteFile(row.logo_url);
  db.prepare('DELETE FROM sponsors WHERE id = ?').run(row.id);
  res.status(204).end();
});

// Public: a click on a logo (the page sends it as a beacon). Counted once a minute per visitor and sponsor, only for a sponsor that is shown.
const recent = new Map();
router.post('/:id/click', (req, res) => {
  const id = Number(req.params.id);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const key = `${ip}:${id}`;
  const now = Date.now();
  if (recent.size > 5000) recent.clear();
  if (recent.has(key) && now - recent.get(key) < 60 * 1000) return res.status(204).end();
  recent.set(key, now);
  db.prepare('UPDATE sponsors SET clicks = clicks + 1 WHERE id = ? AND active = 1').run(id);
  res.status(204).end();
});

module.exports = router;
module.exports.NATIONAL = NATIONAL;
