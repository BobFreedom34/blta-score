// /api/media — the media library (Backend > Media): pictures an admin uploads once and uses anywhere (a hero image, a carousel slide, a venue
// photo, a blog picture …) through "Choose from the library" in every upload window of the backend. Every city has its own library. The files
// live on the persistent disk (<data dir>/media), shown at /media/<file>. Also listed (read only): the pictures that are already on the server
// in the places the app keeps them (carousel, season heroes, venue photos, winners, blog), so one picture can be used again without uploading it twice.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const leagues = require('../leagues');
const { requireAdmin } = require('../auth');

const router = express.Router();

const DIR = path.join(db.dataDir, 'media');
fs.mkdirSync(DIR, { recursive: true });
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)),
});

db.exec(`
  CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL DEFAULT 1,
    filename TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_media_league ON media_files(league_id);
`);
// the fingerprint of the file's content (sha-256): the same picture uploaded again (from another page, another day) is the one already in the library
try { db.exec("ALTER TABLE media_files ADD COLUMN hash TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// the picture of this city's library that has exactly these bytes, or undefined. Rows from before the fingerprint existed are read once and get theirs.
function sameInLibrary(leagueId, buffer, hash) {
  const known = db.prepare('SELECT * FROM media_files WHERE league_id = ? AND hash = ? ORDER BY id LIMIT 1').get(leagueId, hash);
  if (known) return known;
  const old = db.prepare("SELECT * FROM media_files WHERE league_id = ? AND hash = '' AND size = ?").all(leagueId, buffer.length);
  for (const row of old) {
    let h = '';
    try { h = sha256(fs.readFileSync(path.join(DIR, row.filename))); } catch { continue; /* the file is gone */ }
    db.prepare('UPDATE media_files SET hash = ? WHERE id = ?').run(h, row.id);
    if (h === hash) return { ...row, hash: h };
  }
  return undefined;
}

const serialize = (r) => ({ id: r.id, url: `/media/${r.filename}`, name: r.original_name, mime: r.mime, size: r.size, createdAt: r.created_at });

// where the app already keeps pictures: [folder on the disk, address, label, (the folder the path starts from: the data directory unless given)]
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const PLACES = [
  ['img/seasons', '/img/seasons', 'Season logos', PUBLIC_DIR],
  ['carousel', '/carousel-images', 'Carousel'],
  ['season-heroes', '/season-heroes', 'Season pictures'],
  ['venue-photos', '/venue-photos', 'Venue photos'],
  ['winner-photos', '/winner-photos', 'Winners'],
  ['blog-images', '/blog-images', 'Blog'],
];
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MIME_OF = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function onTheServer() {
  const out = [];
  PLACES.forEach(([folder, base, label, root]) => {
    const dir = path.join(root || db.dataDir, folder);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    names.filter((n) => IMAGE.test(n)).forEach((n) => {
      try {
        const st = fs.statSync(path.join(dir, n));
        out.push({ url: `${base}/${n}`, name: n, place: label, mime: MIME_OF[path.extname(n).toLowerCase()] || 'image/jpeg', size: st.size, createdAt: st.mtime.toISOString() });
      } catch { /* gone meanwhile */ }
    });
  });
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 400);
}

// the library of the city the admin works on, newest first; ?server=1 adds the pictures that are on the server already
router.get('/', requireAdmin, (req, res) => {
  const library = db.prepare('SELECT * FROM media_files WHERE league_id = ? ORDER BY id DESC').all(leagues.actingIdOf(req)).map(serialize);
  res.json({ library, server: req.query.server === '1' ? onTheServer() : undefined });
});

// one or several pictures (field "image")
router.post('/', requireAdmin, (req, res) => {
  upload.array('image', 20)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A picture must be under 8 MB' : 'Could not process the upload' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Choose PNG, JPG, WebP or GIF pictures' });
    const leagueId = leagues.actingIdOf(req);
    // a picture that is in the library already (the same bytes) is not stored again: it comes back under "reused", in the order of the files too
    const added = [];
    const reused = [];
    const all = [];
    files.forEach((f) => {
      const hash = sha256(f.buffer);
      const same = sameInLibrary(leagueId, f.buffer, hash);
      if (same) { const item = serialize(same); reused.push(item); all.push(item); return; }
      const base = path.basename(f.originalname || 'picture', path.extname(f.originalname || '')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'picture';
      const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${MIME_EXT[f.mimetype]}`;
      fs.writeFileSync(path.join(DIR, filename), f.buffer);
      const info = db.prepare('INSERT INTO media_files (league_id, filename, original_name, mime, size, hash) VALUES (?, ?, ?, ?, ?, ?)').run(leagueId, filename, String(f.originalname || '').slice(0, 120), f.mimetype, f.size, hash);
      const item = serialize(db.prepare('SELECT * FROM media_files WHERE id = ?').get(Number(info.lastInsertRowid)));
      added.push(item);
      all.push(item);
    });
    res.status(201).json({ added, reused, files: all });
  });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM media_files WHERE id = ?').get(Number(req.params.id));
  if (!row || row.league_id !== leagues.actingIdOf(req)) return res.status(404).json({ error: 'Picture not found' });
  const name = typeof req.body.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!name) return res.status(400).json({ error: 'The name is required' });
  db.prepare('UPDATE media_files SET original_name = ? WHERE id = ?').run(name, row.id);
  res.json(serialize(db.prepare('SELECT * FROM media_files WHERE id = ?').get(row.id)));
});

// The picture leaves the library. A copy that was put on a page (a hero image, a slide) is a file of its own and stays there.
router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM media_files WHERE id = ?').get(Number(req.params.id));
  if (!row || row.league_id !== leagues.actingIdOf(req)) return res.status(404).json({ error: 'Picture not found' });
  db.prepare('DELETE FROM media_files WHERE id = ?').run(row.id);
  fs.unlink(path.join(DIR, row.filename), () => { /* fine if it is gone */ });
  res.json({ ok: true });
});

module.exports = router;
module.exports.DIR = DIR;
