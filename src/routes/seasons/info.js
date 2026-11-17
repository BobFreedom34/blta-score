const db = require('../../db');
const leagues = require('../../leagues');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const auth = require('../../auth');
const tournamentDraw = require('../../tournamentDraw');
const communityPoints = require('../../communityPoints');
const clubTournaments = require('../../clubTournaments');
const capacity = require('../../registrationCapacity');
const seasonActivity = require('../../seasonActivity');
const courtStreams = require('../../courtStreams');
const unregister = require('../../unregister');
const paymentQr = require('../../paymentQr');
const tournamentSchedule = require('../../tournamentSchedule');
const router = require('./router');
const { serializeSeason } = require('./shared');

// a tournament of a community pays the places of its final standings into the ranking of the community (src/communityPoints.js): after any change that reaches a tournament
// (a draw, a group, a result) the places are paid again. The first number of the path is the season.
router.use(communityPoints.afterChanges((req) => { const m = /^\/(\d+)(?:\/|$)/.exec(req.path); return m ? Number(m[1]) : null; }));

// ---------------- the hero photo of a season or a tournament page ----------------
// Two pictures, both optional: one for wide screens and one for phones (a phone shows the wide one when there is no other). The admin
// page cuts them to 2400 x 800 (3:1) and 1200 x 900 (4:3) before they are sent; they live on the persistent disk like the other uploads.
const HERO_DIR = path.join(db.dataDir, 'season-heroes');
if (!fs.existsSync(HERO_DIR)) fs.mkdirSync(HERO_DIR, { recursive: true });
const HERO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const heroUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Object.prototype.hasOwnProperty.call(HERO_EXT, file.mimetype)),
});
const heroColumn = (kind) => (kind === 'mobile' ? 'hero_mobile_url' : kind === 'desktop' ? 'hero_url' : null);
// only files written here (their address starts with /season-heroes/) are ever removed
function deleteHeroFile(url) {
  if (typeof url !== 'string' || !url.startsWith('/season-heroes/')) return;
  fs.unlink(path.join(HERO_DIR, path.basename(url)), () => { /* fine if it is already gone */ });
}

router.post('/:id/hero', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  heroUpload.single('photo')(req, res, (err) => {
    const column = heroColumn(req.query.kind);
    if (!column) return res.status(400).json({ error: 'kind must be desktop or mobile' });
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 8 MB' : 'Could not process the uploaded file' });
    if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP picture' });
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
    if (!season) return res.status(404).json({ error: 'Season not found' });
    const filename = `${season.slug || 'season'}-${req.query.kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${HERO_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(HERO_DIR, filename), req.file.buffer);
    db.prepare(`UPDATE seasons SET ${column} = ? WHERE id = ?`).run(`/season-heroes/${filename}`, season.id);
    deleteHeroFile(season[column]);
    res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
  });
});

router.delete('/:id/hero', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const column = heroColumn(req.query.kind);
  if (!column) return res.status(400).json({ error: 'kind must be desktop or mobile' });
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  db.prepare(`UPDATE seasons SET ${column} = NULL WHERE id = ?`).run(season.id);
  deleteHeroFile(season[column]);
  res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// The logo of a season or a tournament (the picture on its schedule row and its page): a picture from the computer or from the library
// (Backend > Media); the file is a copy of its own, like a hero photo. It is sent as it is (a logo keeps its transparent background).
router.post('/:id/logo', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  heroUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be under 8 MB' : 'Could not process the uploaded file' });
    if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP picture' });
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
    if (!season) return res.status(404).json({ error: 'Season not found' });
    const filename = `${season.slug || 'season'}-logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${HERO_EXT[req.file.mimetype]}`;
    fs.writeFileSync(path.join(HERO_DIR, filename), req.file.buffer);
    db.prepare('UPDATE seasons SET logo_url = ? WHERE id = ?').run(`/season-heroes/${filename}`, season.id);
    deleteHeroFile(season.logo_url);
    res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
  });
});

router.delete('/:id/logo', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  db.prepare('UPDATE seasons SET logo_url = NULL WHERE id = ?').run(season.id);
  deleteHeroFile(season.logo_url);
  res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// Public: the match page and its admin editor read this (newest season first).
// Public: the QR code (PAY by square) of the entry fee of an event, as an SVG picture; ?for=<name of the player> goes into the note
router.get('/:id(\\d+)/payment-qr', async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(req.params.id);
  if (!season || season.league_id !== leagues.actingIdOf(req) || clubTournaments.publicFace(season, req).hidden) return res.status(404).json({ error: 'Not found' });
  try {
    // an admin looking at the form before saving: the values of the form go along and win over the saved ones
    let shown = season;
    if (auth.isAdmin(req) && req.query.preview === '1') {
      const q = (k, n) => String(req.query[k] || '').slice(0, n);
      shown = { ...season, iban: q('iban', 60), pay_recipient: q('recipient', 120), pay_note: q('note', 140), entry_fee: q('fee', 40), name: q('name', 200) || season.name };
    }
    const svg = await paymentQr.svgFor(shown, String(req.query.for || '').replace(/\s+/g, ' ').trim().slice(0, 40));
    if (!svg) return res.status(404).json({ error: 'No IBAN set' });
    res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (err) { res.status(500).json({ error: 'The QR code could not be made' }); }
});

router.get('/', (req, res) => {
  // (the tournaments of the clubs are not part of the league: they show on the page of their club and in the Harmonogram)
  const rows = db.prepare('SELECT * FROM seasons WHERE league_id = ? AND organisation_id IS NULL ORDER BY COALESCE(start_date, \'\') DESC, id DESC').all(leagues.actingIdOf(req));
  res.json((auth.isAdmin(req) ? rows : rows.filter((r) => !r.hidden)).map(serializeSeason)); // (a hidden event is in the list for an admin only)
});

// Public: the brackets (play-off draws) tied to a season — the league tables page shows them under "Play-off".
// Public: the scoreboard overlay of a court (the page /overlay/<slug>/<court>, shown over the YouTube stream of the court): the match live on it. Only a court
// that has a YouTube link has an overlay; any other court, a hidden club tournament and another city's tournament are 404, like the season page itself.
router.get('/by-slug/:slug/court/:court/live', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE slug = ?').get(req.params.slug);
  if (!season || season.league_id !== leagues.actingIdOf(req) || clubTournaments.publicFace(season, req).hidden) return res.status(404).json({ error: 'Not found' });
  const court = /^\d{1,3}$/.test(req.params.court) ? Number(req.params.court) : 0;
  const stream = court >= 1 && court <= (season.court_count || 0) ? courtStreams.streamsOf(season)[court - 1] : null;
  if (!stream) return res.status(404).json({ error: 'Not found' });
  res.json(tournamentSchedule.getCourtLive(season, court));
});

// The season page: one season by its slug, with its rounds (the group-stage rounds the season maker numbered, with how many
// of their matches are finished).
router.get('/by-slug/:slug', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE slug = ?').get(req.params.slug);
  // a season belongs to one city: under the address of another city it does not exist
  if (!season || season.league_id !== leagues.actingIdOf(req)) return res.status(404).json({ error: 'Season not found' });
  // the tournament of a club that is hidden, or whose approval was withdrawn, does not exist for the public
  const face = clubTournaments.publicFace(season, req);
  if (face.hidden) return res.status(404).json({ error: 'Season not found' });
  const rounds = db.prepare(`
    SELECT round, COUNT(*) AS total, SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) AS finished
    FROM matches WHERE season_id = ? AND round IS NOT NULL AND COALESCE(stage, 'GROUP') = 'GROUP'
    GROUP BY round ORDER BY round
  `).all(season.id).map((r) => ({ round: r.round, total: r.total, finished: r.finished }));
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const standingOf = capacity.standing(season);
  const viewerId = auth.getPlayerId(req);
  const mine = viewerId ? db.prepare('SELECT id FROM season_registrations WHERE season_id = ? AND player_id = ? ORDER BY id LIMIT 1').get(season.id, viewerId) : null;
  const myRegistration = mine ? { id: mine.id, substitute: !!(standingOf.get(mine.id) || {}).substitute, ...unregister.stateFor(season, viewerId) } : null;
  const registrations = db.prepare(`
    SELECT r.id, r.name, r.category, r.paid, r.partner_name, p.slug AS player_slug
    FROM season_registrations r LEFT JOIN players p ON p.id = r.player_id
    WHERE r.season_id = ? ORDER BY r.created_at, r.id
  `).all(season.id).map((r) => {
    const waiting = standingOf.get(r.id) || { substitute: false, position: null };
    return (doublesTournament
      ? { name: r.partner_name ? `${r.name} / ${r.partner_name}` : r.name, category: r.category, paid: !!r.paid, slug: null, substitute: waiting.substitute, substitutePosition: waiting.position } // a pair: no profile link
      : { name: r.name, category: r.category, paid: !!r.paid, slug: r.player_slug || null, substitute: waiting.substitute, substitutePosition: waiting.position });
  });
  res.json({ ...serializeSeason(season), organisation: face.organisation, canManage: clubTournaments.canManageSeason(req, season), rounds, registrations, capacity: capacity.counts(season), myRegistration, withdrawn: seasonActivity.withdrawn(season.id, db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)) });
});

// the manager of a season (an admin, or the admin of the club that runs it) reads it by id: the manage page of a club tournament starts from this
router.get('/:id(\\d+)', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  // withdrawn: the players who dropped out (or were taken out) and are not registered again, for the list of registrations in the Backend
  const withdrawn = seasonActivity.withdrawn(season.id, db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ?').all(season.id));
  res.json({ ...serializeSeason(season), organisation: clubTournaments.publicFace(season, req).organisation, withdrawn });
});
