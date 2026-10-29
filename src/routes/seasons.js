const express = require('express');
const db = require('../db');
const leagues = require('../leagues');
const { requireAdmin } = require('../auth');
const { computeGroupStandings } = require('../standings');
const { FROZEN } = require('../frozenStandings');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const engine = require('../matchEngine');
const nameMatch = require('../nameMatch');
const roundRobin = require('../roundRobin');
const { sendSeasonRegistrationEmail } = require('../mailer');
const mailer = require('../mailer');
const auth = require('../auth');
const playerRoutes = require('./player');
const { creditInviter } = require('./invites');
const tournamentDraw = require('../tournamentDraw');
const matchPhotos = require('./matchPhotos');
const rankingPoints = require('../rankingPoints');
const clubTournaments = require('../clubTournaments');
const changeLog = require('../changeLog');

const router = express.Router();

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'season';
}

function uniqueSlug(base, exceptId) {
  let slug = base;
  let n = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(slug);
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

// The season description can be formatted in the backend editor. Only a small set of tags survives (paragraphs, line breaks,
// bold / italic / underline, lists, a heading, a quote and links to http(s)/mailto); every other tag is dropped, attributes are
// rebuilt by us, and text is escaped — so what is stored is safe to show on the public page as it is.
const HTML_TAGS = { p: 'p', div: 'p', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', ul: 'ul', ol: 'ol', li: 'li', h3: 'h3', h4: 'h3', blockquote: 'blockquote', a: 'a' };
function escapeText(text) {
  return text.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sanitizeHtml(input) {
  const html = String(input || '');
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;
  const open = [];
  let out = '';
  let last = 0;
  let m;
  while ((m = tag.exec(html))) {
    out += escapeText(html.slice(last, m.index));
    last = tag.lastIndex;
    const name = HTML_TAGS[m[2].toLowerCase()];
    if (!name) continue;
    if (name === 'br') { out += '<br>'; continue; }
    if (m[1] === '/') {
      if (open.includes(name)) {
        let top;
        do { top = open.pop(); out += `</${top}>`; } while (top !== name);
      }
      continue;
    }
    let attrs = '';
    if (name === 'a') {
      const href = m[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const url = href ? (href[1] !== undefined ? href[1] : href[2]).trim() : '';
      if (/^(https?:\/\/|mailto:)/i.test(url)) attrs = ` href="${url.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" target="_blank" rel="noopener"`;
    }
    out += `<${name}${attrs}>`;
    open.push(name);
  }
  out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Dates must look like 2026-09-07' };
  return { value };
}

// The players of a group, in the order they were added.
function groupMembers(groupId, group) {
  const pairs = group && group.category === 'DOUBLES';
  return db.prepare(`
    SELECT m.player_id AS id, p.name, p.slug, m.withdrawn_at, m.paid
    FROM season_group_members m JOIN players p ON p.id = m.player_id
    WHERE m.group_id = ? ORDER BY m.sort_order, m.id
  `).all(groupId).map((r) => {
    const who = pairs ? require('../tournamentGroups').pairPlayer(group.season_id, r.id) : r;
    return { id: r.id, name: who.name, slug: pairs ? null : r.slug, withdrawn: !!r.withdrawn_at, paid: !!r.paid };
  });
}

function serializeGroup(g) {
  const members = groupMembers(g.id, g);
  return {
    id: g.id,
    seasonId: g.season_id,
    name: g.name,
    category: g.category,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE group_id = ?').get(g.id).n,
    members,
    activeMemberCount: members.filter((m) => !m.withdrawn).length,
  };
}

const CATEGORY_KEYS = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const KINDS = ['LEAGUE', 'TOURNAMENT'];
// the categories of a season as an array (all three when none is saved; ['OPEN'] for a tournament without categories)
function parseCategories(raw) {
  if (raw === 'OPEN') return ['OPEN'];
  const list = String(raw || '').split(',').filter((c) => CATEGORY_KEYS.includes(c));
  return list.length ? list : CATEGORY_KEYS;
}
// a request's category list as the stored comma text; null = all of them; 'OPEN' = no categories at all (it wins over the others)
function categoriesToStore(list) {
  if (Array.isArray(list) && list.includes('OPEN')) return 'OPEN';
  const picked = (Array.isArray(list) ? list : []).filter((c) => CATEGORY_KEYS.includes(c));
  return picked.length && picked.length < CATEGORY_KEYS.length ? CATEGORY_KEYS.filter((c) => picked.includes(c)).join(',') : null;
}

function serializeSeason(s) {
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(s.id);
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE',
    // what a tournament is played as (chosen when it was made): singles in the categories, or doubles (Štvorhra) only
    playType: s.kind === 'TOURNAMENT' && s.play_type === 'DOUBLES' ? 'DOUBLES' : 'SINGLES',
    venue: s.venue || '',
    categories: s.kind === 'TOURNAMENT' && s.play_type === 'DOUBLES' ? ['DOUBLES'] : parseCategories(s.categories),
    startDate: s.start_date,
    endDate: s.end_date,
    entryFee: s.entry_fee || '',
    prizeMoney: s.prize_money || '',
    drawDate: s.draw_date || null,
    info: s.info || '',
    galleryUrl: s.gallery_url || '',
    paymentUrl: s.payment_url || '',
    logoUrl: s.logo_url || '',
    heroUrl: s.hero_url || '',
    heroMobileUrl: s.hero_mobile_url || '',
    registrationOpen: !!s.registration_open,
    // the community or club that runs this tournament (null for the league and for the tournaments of the Backend)
    organisationId: s.organisation_id || null,
    courtCount: s.court_count || 0,
    maxMatchesPerDay: s.max_matches_per_day || 0,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ?').get(s.id).n,
    groups: groups.map(serializeGroup),
  };
}

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
router.get('/', (req, res) => {
  // (the tournaments of the clubs are not part of the league: they show on the page of their club and in the Harmonogram)
  const rows = db.prepare('SELECT * FROM seasons WHERE league_id = ? AND organisation_id IS NULL ORDER BY COALESCE(start_date, \'\') DESC, id DESC').all(leagues.actingIdOf(req));
  res.json(rows.map(serializeSeason));
});

// Public: the brackets (play-off draws) tied to a season — the league tables page shows them under "Play-off".
// The season page: one season by its slug, with its rounds (the group-stage rounds the season maker numbered, with how many
// of their matches are finished).
router.get('/by-slug/:slug', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE slug = ?').get(req.params.slug);
  // a season belongs to one city: under the address of another city it does not exist
  if (!season || season.league_id !== leagues.actingIdOf(req)) return res.status(404).json({ error: 'Season not found' });
  // the tournament of a club that is hidden, or whose approval was withdrawn, does not exist for the public
  const face = clubTournaments.publicFace(season);
  if (face.hidden) return res.status(404).json({ error: 'Season not found' });
  const rounds = db.prepare(`
    SELECT round, COUNT(*) AS total, SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) AS finished
    FROM matches WHERE season_id = ? AND round IS NOT NULL AND COALESCE(stage, 'GROUP') = 'GROUP'
    GROUP BY round ORDER BY round
  `).all(season.id).map((r) => ({ round: r.round, total: r.total, finished: r.finished }));
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const registrations = db.prepare(`
    SELECT r.name, r.category, r.paid, r.partner_name, p.slug AS player_slug
    FROM season_registrations r LEFT JOIN players p ON p.id = r.player_id
    WHERE r.season_id = ? ORDER BY r.created_at, r.id
  `).all(season.id).map((r) => (doublesTournament
    ? { name: r.partner_name ? `${r.name} / ${r.partner_name}` : r.name, category: r.category, paid: !!r.paid, slug: null } // a pair: no profile link
    : { name: r.name, category: r.category, paid: !!r.paid, slug: r.player_slug || null }));
  res.json({ ...serializeSeason(season), organisation: face.organisation, canManage: clubTournaments.canManageSeason(req, season), rounds, registrations });
});

// the manager of a season (an admin, or the admin of the club that runs it) reads it by id: the manage page of a club tournament starts from this
router.get('/:id(\\d+)', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  res.json({ ...serializeSeason(season), organisation: clubTournaments.publicFace(season).organisation });
});

// ---------- registration to a season ----------

// Registering is public, so it is limited: a few per hour from one address, plus a hidden field a person never fills in.
const registerAttempts = new Map();
function tooManyRegistrations(ip) {
  const now = Date.now();
  const recent = (registerAttempts.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  recent.push(now);
  registerAttempts.set(ip, recent);
  return recent.length > 6;
}

function registrationOpen(season) {
  const today = new Date().toISOString().slice(0, 10);
  return !!season.registration_open && !(season.end_date && season.end_date < today);
}

router.post('/:id/registrations', async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season || clubTournaments.publicFace(season).hidden) return res.status(404).json({ error: 'Season not found' });
  const body = req.body || {};
  if (body.website) return res.status(201).json({ ok: true }); // the hidden field was filled in: a bot, pretend it worked
  if (!registrationOpen(season)) return res.status(403).json({ code: 'REGISTRATION_CLOSED', error: 'Registration for this season is closed' });
  if (tooManyRegistrations((String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.ip)) return res.status(429).json({ error: 'Too many registrations from this address — try again later' });

  const typed = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.replace(/[^\d+]/g, '') : '';
  if (typed.length < 3 || typed.length > 80) return res.status(400).json({ code: 'BAD_NAME', error: 'Enter your name and surname' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return res.status(400).json({ code: 'BAD_EMAIL', error: 'Enter a valid e-mail address' });
  if (phone.replace(/\D/g, '').length < 9 || phone.length > 20) return res.status(400).json({ code: 'BAD_PHONE', error: 'Enter a valid phone number' });
  // a tournament entry has no category: the admin sorts the players into categories afterwards
  const entryCategory = season.kind === 'TOURNAMENT' ? '' : body.category;
  if (season.kind !== 'TOURNAMENT' && !BLTA_CATEGORIES.includes(body.category)) return res.status(400).json({ code: 'BAD_CATEGORY', error: 'Choose a category' });
  const note = typeof body.note === 'string' ? body.note.replace(/\r\n/g, '\n').trim() : '';
  if (note.length > 500) return res.status(400).json({ code: 'BAD_NOTE', error: 'The note is too long (max 500 characters)' });
  // a doubles tournament is entered as a pair: the partner is required (the pair is made from it); a singles tournament has no partner
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const partner = doublesTournament && typeof body.partner === 'string' ? body.partner.replace(/\s+/g, ' ').trim() : '';
  if (doublesTournament && (partner.length < 3 || partner.length > 80)) return res.status(400).json({ code: 'BAD_PARTNER', error: 'Enter the name of your partner' });
  if (doublesTournament && nameMatch.key(partner) === nameMatch.key(typed)) return res.status(400).json({ code: 'BAD_PARTNER', error: 'Your partner has to be somebody else' });

  // who is this: a chosen existing player, a typed name that is one, or a new name
  const players = db.prepare('SELECT id, name FROM players').all();
  let player = null;
  if (body.playerId !== undefined && body.playerId !== null && body.playerId !== '') {
    player = players.find((p) => p.id === Number(body.playerId)) || null;
    if (!player) return res.status(400).json({ code: 'BAD_NAME', error: 'That player does not exist' });
  } else {
    const { exact, similar } = nameMatch.findSimilar(typed, players);
    player = exact || null;
    if (!player && similar.length && !body.confirmNew) {
      return res.status(409).json({ code: 'SIMILAR_PLAYERS', typed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) });
    }
  }
  const name = player ? player.name : typed;
  const already = db.prepare('SELECT id, player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)
    .some((r) => (player && r.player_id === player.id) || nameMatch.key(r.name) === nameMatch.key(name));
  if (already) return res.status(409).json({ code: 'ALREADY_REGISTERED', error: 'This player is already registered for the season' });

  // A visitor who is not in the app yet becomes a player now: the account is made (and logged in; the page then asks for the 5-digit code),
  // like after the app's own registration. An existing roster name that has no phone yet is claimed the same way. An existing player who
  // already has a phone is never touched or logged in (anybody can type a name). A phone that already belongs to another player stops the
  // account (the entry is still saved, and the e-mail to the admin says so).
  const account = openAccount(req, res, player, { name, phone, email, leagueId: season.league_id });
  if (account.player) player = account.player;

  // (the partner of a doubles tournament was checked above, before anything is made)
  db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, note, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player ? player.id : null, name, phone, email, entryCategory, note, partner);
  // the pair is made at once when both players are known; otherwise the organiser makes it (draw tab: "Páry z registrácií")
  if (doublesTournament && player) { try { tournamentDraw.addPair(season, { player: player.id, partner }); } catch { /* the organiser makes it */ } }
  const total = db.prepare('SELECT COUNT(*) AS n FROM season_registrations WHERE season_id = ?').get(season.id).n;
  // the e-mail to the admin must never make the registration fail
  sendSeasonRegistrationEmail(season, { name, phone, email, category: entryCategory, note, isNew: !player, account: account.status, phoneHolder: account.holder }, total)
    .catch((err) => console.error('[season registration] admin e-mail failed:', err.message));
  res.status(201).json({ ok: true, name, category: entryCategory, paymentUrl: season.payment_url || '', account: account.status, pinSetupRequired: account.status === 'created' || account.status === 'claimed' });
});

// -> { status, player?, holder? }
//   created   a new player was made from the typed name, phone and e-mail, and is logged in
//   claimed   an existing roster player without a phone got this phone and e-mail, and is logged in
//   exists    the player already has an account: nothing changes, nobody is logged in
//   phoneTaken a new name, but the phone belongs to another player: no account (holder = that player's name)
//   none      the phone is not one an account can be made with
function openAccount(req, res, player, { name, phone, email, leagueId = leagues.DEFAULT_LEAGUE_ID }) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (/^[1-9]\d{8}$/.test(digits)) digits = `0${digits}`; // 903111222 -> 0903111222
  const validPhone = /^0\d{9}$/.test(digits) || /^\+\d{8,15}$/.test(digits);
  if (player) {
    const row = db.prepare('SELECT id, name, slug, phone FROM players WHERE id = ?').get(player.id);
    if (!row || row.phone) return { status: 'exists' };
    if (!validPhone) return { status: 'none' };
    const holder = playerRoutes.findPlayerByPhone(digits);
    if (holder) return { status: 'phoneTaken', holder: holder.name };
    db.prepare('UPDATE players SET phone = ?, email = ? WHERE id = ?').run(digits, email.slice(0, 100), row.id);
    auth.logInPlayer(res, row.id);
    return { status: 'claimed', player: { id: row.id, name: row.name } };
  }
  if (!validPhone) return { status: 'none' };
  const holder = playerRoutes.findPlayerByPhone(digits);
  if (holder) return { status: 'phoneTaken', holder: holder.name };
  const slug = playerRoutes.uniqueSlugFor(name);
  const info = db.prepare('INSERT INTO players (name, slug, phone, email, league_id) VALUES (?, ?, ?, ?, ?)').run(name, slug, digits, email.slice(0, 100), leagueId);
  const created = { id: Number(info.lastInsertRowid), name };
  creditInviter(req, res, created.id); // a new player who came through somebody's invite link
  auth.logInPlayer(res, created.id);
  return { status: 'created', player: created };
}

// when the last payment reminder was sent to a registration (Backend > Registrácie > "Remind unpaid")
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'reminded_at')) {
  db.exec('ALTER TABLE season_registrations ADD COLUMN reminded_at TEXT');
}

function serializeRegistration(r) {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, category: r.category, paid: !!r.paid, note: r.note || '', partnerName: r.partner_name || '', seed: r.seed || null, createdAt: r.created_at, playerId: r.player_id, remindedAt: r.reminded_at || null };
}

// The registrations as a spreadsheet (CSV with a byte-order mark so Excel reads the letters right).
router.get('/:id/registrations.csv', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  const cell = (v) => {
    const text = String(v == null ? '' : v);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [['Meno', 'Kategória', 'Telefón', 'Email', 'Zaplatené', 'Poznámka', 'Registrovaný'].join(',')];
  rows.forEach((r) => lines.push([r.name, r.category || '', r.phone || '', r.email || '', r.paid ? 'áno' : 'nie', r.note || '', String(r.created_at || '').slice(0, 10)].map(cell).join(',')));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="registracie-${(season.slug || 'sezona').replace(/[^a-z0-9-]/gi, '')}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

// A reminder e-mail to the players who have not paid: { ids: [..] } (all the unpaid ones with an e-mail when left out). A registration
// that was reminded in the last 24 hours is skipped (so a double click does not write twice). -> { sent, noEmail, recent, failed }
router.post('/:id/registrations/remind', clubTournaments.requireSeasonManager(clubTournaments.byParamId), async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const wanted = Array.isArray(req.body && req.body.ids) ? new Set(req.body.ids.map(Number)) : null;
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? AND paid = 0 ORDER BY created_at, id').all(season.id)
    .filter((r) => !wanted || wanted.has(r.id));
  const out = { sent: 0, noEmail: 0, recent: 0, failed: 0 };
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const contact = require('./contact').read();
  const organiser = [contact.email, contact.phone].filter(Boolean).join(' · ');
  const stamp = db.prepare('UPDATE season_registrations SET reminded_at = ? WHERE id = ?');
  for (const r of rows) {
    if (!r.email) { out.noEmail += 1; continue; }
    if (r.reminded_at && new Date(r.reminded_at).getTime() > dayAgo) { out.recent += 1; continue; }
    try {
      const ok = await mailer.sendPaymentReminderEmail({ to: r.email, name: r.name, seasonName: season.name, fee: season.entry_fee || '', paymentUrl: season.payment_url || '', organiser });
      if (ok) { stamp.run(new Date().toISOString(), r.id); out.sent += 1; } else out.failed += 1;
    } catch (err) {
      console.error('[payment reminder] failed:', err.message);
      out.failed += 1;
    }
  }
  res.json(out);
});

// The category written in a player's profile ("Next Gen", "ELITE"…) as one of ours, or null.
function profileCategory(raw) {
  const key = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return key === 'ELITE' ? 'ELITE' : key === 'NEXTGEN' ? 'NEXT_GEN' : key === 'NOVICE' ? 'NOVICE' : null;
}

// The admin's list: with the contact details (never sent to the public page).
router.get('/:id/registrations', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(Number(req.params.id));
  res.json(rows.map(serializeRegistration));
});

// The admin sorts many players into categories at once (the "Zaradenie do kategórií" screen): { assignments: [{ id, category }] }, category
// ELITE / NEXT_GEN / NOVICE or '' for "not sorted yet" (tournaments only). All or nothing: one bad entry changes nothing.
router.post('/:id/registrations/categories', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (tournamentDraw.isDoublesTournament(season)) return res.status(400).json({ error: 'A doubles tournament has no categories' });
  if (tournamentDraw.isOpenTournament(season)) return res.status(400).json({ error: 'A tournament without categories needs no sorting' });
  const list = req.body && req.body.assignments;
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Nothing to save' });
  const own = new Set(db.prepare('SELECT id FROM season_registrations WHERE season_id = ?').all(season.id).map((r) => r.id));
  for (const item of list) {
    if (!item || !own.has(Number(item.id))) return res.status(400).json({ error: 'A registration does not belong to this season' });
    const allowed = season.kind === 'TOURNAMENT' ? tournamentDraw.categoriesFor(season) : BLTA_CATEGORIES; // (a tournament played in Elite and Next Gen has no Novice to sort into)
    const ok = allowed.includes(item.category) || (item.category === '' && season.kind === 'TOURNAMENT');
    if (!ok) return res.status(400).json({ error: 'Choose a category' });
  }
  const update = db.prepare('UPDATE season_registrations SET category = ?, seed = CASE WHEN category = ? THEN seed ELSE NULL END WHERE id = ?');
  db.exec('BEGIN');
  try {
    list.forEach((item) => update.run(item.category, item.category, Number(item.id)));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  res.json(rows.map(serializeRegistration));
});

// ---------------- tournament draw: seeds, main bracket + consolation bracket (admin) ----------------

function tournamentOr404(req, res) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) { res.status(404).json({ error: 'Season not found' }); return null; }
  if (season.kind !== 'TOURNAMENT') { res.status(400).json({ error: 'Only a tournament has a draw' }); return null; }
  return season;
}

// Per category: players, seeds, draw size and byes, and the brackets already made.
router.get('/:id/draw', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json({ slug: season.slug, courtCount: season.court_count || 0, playType: tournamentDraw.isDoublesTournament(season) ? 'DOUBLES' : 'SINGLES', categories: tournamentDraw.overview(season.id) });
});

// { category, seeds: [{ id: registrationId, seed }] } — replaces the seeds of that category; players left out are not seeded.
router.post('/:id/seeds', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.setSeeds(season.id, req.body && req.body.category, req.body && req.body.seeds);
  if (done.error) return res.status(400).json({ error: done.error });
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  res.json(rows.map(serializeRegistration));
});

// Makes the draw of one category: { category, format: 'PRINCE' | 'MONRAD' | 'ELIMINATION' | 'GROUPS' | 'GROUPS_BRACKET', mode: 'AUTO' | 'MANUAL',
// mainFormat, consolationFormat, groupFormat (match formats), groupSize, groupCount, qualifiers, bracketType, autoBracket,
// groups: [{ name, registrationIds }] (the groups as the organiser put them together; left out = suggested) } — see tournamentDraw.createDraw.
router.post('/:id/draw', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const made = tournamentDraw.createDraw(season, body.category, {
    format: body.format, mode: body.mode, mainFormat: body.mainFormat, consolationFormat: body.consolationFormat, groupFormat: body.groupFormat,
    groupSize: body.groupSize, groupCount: body.groupCount, qualifiers: body.qualifiers, bracketType: body.bracketType, autoBracket: body.autoBracket,
    groups: body.groups,
  });
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// The suggested split of a category into groups (what an automatic draw would do), for the organiser to look at and change before making
// the groups: ?category=ELITE&groupSize=4&groupCount=0
router.get('/:id/draw/groups-suggestion', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const category = req.query.category;
  if (!tournamentDraw.categoriesFor(season).includes(category)) return res.status(400).json({ error: 'Choose a category' });
  const regs = tournamentDraw.registrationsOf(season.id, category);
  const suggested = require('../tournamentGroups').suggestGroups(regs.map((r) => ({ playerId: r.id, seed: r.seed })), {
    groupSize: Number(req.query.groupSize) || 4, groupCount: Number(req.query.groupCount) || 0,
  });
  // playerId above is the registration id (what the draw request takes back)
  res.json({ groups: suggested.map((g) => ({ name: g.name, registrationIds: g.playerIds })) });
});

// The bracket after the groups of a GROUPS_BRACKET category: { category, mode: 'AUTO' | 'MANUAL', force } — the best of every group go in
// (needs every group match played unless force).
router.post('/:id/draw/bracket', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const made = tournamentDraw.createBracketFromGroups(season, body.category, { mode: body.mode, force: !!body.force });
  if (made.error) return res.status(made.status || 400).json({ code: made.code, error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// ---- the pairs of the doubles (štvorhra) of the tournament; seeds and the draw of the category DOUBLES use the ordinary draw routes ----
router.get('/:id/doubles', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json(tournamentDraw.doublesOverview(season));
});

// { player, partner } (ids or names) makes a pair; { fromRegistrations: true } makes the pairs the registration forms named
router.post('/:id/doubles/pairs', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const done = body.fromRegistrations
    ? tournamentDraw.addPairsFromRegistrations(season)
    : tournamentDraw.addPair(season, { player: body.player, partner: body.partner });
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.status(201).json({ ...(body.fromRegistrations ? { created: done.created, skipped: done.skipped } : {}), overview: tournamentDraw.doublesOverview(season) });
});

router.delete('/:id/doubles/pairs/:pairId', clubTournaments.requireSeasonManager(clubTournaments.byIdAndPairId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.removePair(season, Number(req.params.pairId));
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.json(tournamentDraw.doublesOverview(season));
});

router.delete('/:id/draw/:category', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.deleteDraw(season, req.params.category);
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.json({ ok: true, categories: tournamentDraw.overview(season.id) });
});

// ---------------- tournament court schedule (see tournamentSchedule.js) ----------------

const tournamentSchedule = require('../tournamentSchedule');

function scheduleChanged(req, season) {
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'SCHEDULE' });
}

// Public: the schedule tab of the tournament page — settings, every match with two players, who is on which court when.
router.get('/:id/schedule', (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json(tournamentSchedule.getSchedule(season));
});

// { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule }
router.patch('/:id/schedule/settings', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const saved = tournamentSchedule.saveSettings(season, req.body || {});
  if (saved.error) return res.status(400).json({ error: saved.error });
  res.json(tournamentSchedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// { mode: 'fill' | 'rebuild' | 'compact' | 'clear' | 'unlock' } (compact: unlocked planned matches move forward where time was freed;
// unlock: every planned match is unlocked, none is moved) — the planner puts the matches without a time on the courts (see tournamentSchedule.autoPlan)
router.post('/:id/schedule/auto', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const mode = ['fill', 'rebuild', 'compact', 'clear', 'unlock'].includes(req.body && req.body.mode) ? req.body.mode : 'fill';
  const done = tournamentSchedule.autoPlan(season.id, { mode });
  if (done.error) return res.status(400).json({ error: done.error });
  scheduleChanged(req, season);
  res.json({ ...done, schedule: tournamentSchedule.getSchedule(season) });
});

// { courtNo, scheduledAt } puts a match that has not started on a court at a time (the planner never moves it afterwards);
// { courtNo: null } takes it off the schedule.
router.put('/:id/schedule/matches/:token', clubTournaments.requireSeasonManager(clubTournaments.byIdAndMatchToken), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  // { durationMinutes: 45 | null } alone: the length of this one match (null = the tournament's length)
  if (body.durationMinutes !== undefined && body.courtNo === undefined) {
    const minutes = body.durationMinutes === null ? null : Number(body.durationMinutes);
    const set = tournamentSchedule.setDuration(season, req.params.token, minutes);
    if (set.error) return res.status(set.status || 400).json({ error: set.error });
    scheduleChanged(req, season);
    return res.json({ warnings: [], schedule: tournamentSchedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)) });
  }
  // { locked: true | false } alone: lock or unlock a match where it is
  if (typeof body.locked === 'boolean' && body.courtNo === undefined) {
    const set = tournamentSchedule.setLocked(season, req.params.token, body.locked);
    if (set.error) return res.status(set.status || 400).json({ error: set.error });
    scheduleChanged(req, season);
    return res.json({ warnings: [], schedule: tournamentSchedule.getSchedule(season) });
  }
  const courtNo = body.courtNo === null || body.courtNo === undefined ? null : Number(body.courtNo);
  const done = tournamentSchedule.placeMatch(season, req.params.token, courtNo, body.scheduledAt);
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  scheduleChanged(req, season);
  res.json({ warnings: done.warnings, schedule: tournamentSchedule.getSchedule(season) });
});

// The admin registers a player who is already in the app, without the registration form: the phone number and the e-mail
// come from the player's profile unless the admin types others, the category from the profile unless the admin picks one.
// It works whether or not the season's registration is open, and sends no e-mail.
router.post('/:id/registrations/admin', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const body = req.body || {};
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(body.playerId));
  if (!player) return res.status(400).json({ error: 'Choose a player from the list' });
  // a tournament entry may have no category (category = ''): sent as an empty category, or when the profile has none either
  const tournament = season.kind === 'TOURNAMENT';
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const partnerName = doublesTournament && typeof body.partner === 'string' ? body.partner.replace(/\s+/g, ' ').trim() : '';
  if (doublesTournament && (partnerName.length < 3 || partnerName.length > 80)) return res.status(400).json({ error: 'Enter the name of the partner' });
  let category = null;
  if (doublesTournament) category = ''; // a pair has no Elite / Next Gen / Novice category
  else if (BLTA_CATEGORIES.includes(body.category)) category = body.category;
  else if (tournament && body.category === '') category = '';
  else category = profileCategory(player.category) || (tournament ? '' : null);
  if (category === null) return res.status(400).json({ error: 'Choose a category' });

  // (the organiser of a club gets no phone number or e-mail of a player from his profile, and writes none: players who register themselves give their own)
  const siteAdmin = auth.isAdmin(req);
  const typedPhone = siteAdmin && typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone = siteAdmin ? String(typedPhone || player.phone || '').replace(/[^\d+]/g, '') : '';
  if (typedPhone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
  const typedEmail = siteAdmin && typeof body.email === 'string' ? body.email.trim() : '';
  const email = siteAdmin ? (typedEmail || String(player.email || '').trim()) : '';
  if (typedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail) || typedEmail.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });

  const already = db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)
    .some((r) => r.player_id === player.id || nameMatch.key(r.name) === nameMatch.key(player.name));
  if (already) return res.status(409).json({ code: 'ALREADY_REGISTERED', error: `${player.name} is already registered for this season` });

  const info = db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, paid, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player.id, player.name, phone, email, category, body.paid ? 1 : 0, partnerName);
  if (doublesTournament) { try { tournamentDraw.addPair(season, { player: player.id, partner: partnerName }); } catch { /* the organiser makes the pair */ } }
  res.status(201).json(serializeRegistration(db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(info.lastInsertRowid)));
});

// The admin changes a registration: what is sent is changed, the rest stays — paid, category ('' = no category, tournaments only),
// phone, e-mail and note.
router.patch('/registrations/:rid', clubTournaments.requireSeasonManager(clubTournaments.byRegistrationId), (req, res) => {
  const row = db.prepare('SELECT r.*, s.kind AS season_kind, s.play_type AS season_play_type FROM season_registrations r LEFT JOIN seasons s ON s.id = r.season_id WHERE r.id = ?').get(Number(req.params.rid));
  if (!row) return res.status(404).json({ error: 'Registration not found' });
  const body = req.body || {};
  const doublesEntry = row.season_kind === 'TOURNAMENT' && row.season_play_type === 'DOUBLES';
  if (doublesEntry && body.category !== undefined && body.category !== '') return res.status(400).json({ error: 'A doubles tournament has no categories' });
  const next = { paid: row.paid, category: row.category, phone: row.phone, email: row.email, note: row.note || '' };
  if (body.paid !== undefined) next.paid = body.paid ? 1 : 0;
  if (body.category !== undefined) {
    if (BLTA_CATEGORIES.includes(body.category)) next.category = body.category;
    else if (body.category === '' && row.season_kind === 'TOURNAMENT') next.category = '';
    else return res.status(400).json({ error: 'Choose a category' });
  }
  const siteAdmin = auth.isAdmin(req); // the organiser of a club cannot write the phone or e-mail of a registration
  if (body.phone !== undefined && siteAdmin) {
    const phone = String(body.phone || '').trim().replace(/[^\d+]/g, '');
    if (phone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
    next.phone = phone;
  }
  if (body.email !== undefined && siteAdmin) {
    const email = String(body.email || '').trim();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
    next.email = email;
  }
  if (body.note !== undefined) {
    const note = String(body.note || '').trim();
    if (note.length > 500) return res.status(400).json({ error: 'The note is too long (max 500 characters)' });
    next.note = note;
  }
  if (doublesEntry && body.partner !== undefined) {
    const partner = String(body.partner || '').replace(/\s+/g, ' ').trim();
    if (partner.length < 3 || partner.length > 80) return res.status(400).json({ error: 'Enter the name of the partner' });
    next.partner = partner;
  }
  db.prepare('UPDATE season_registrations SET paid = ?, category = ?, phone = ?, email = ?, note = ?, partner_name = ? WHERE id = ?')
    .run(next.paid, next.category, next.phone, next.email, next.note, next.partner !== undefined ? next.partner : (row.partner_name || ''), row.id);
  res.json({ ok: true, ...serializeRegistration(db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(row.id)) });
});

router.delete('/registrations/:rid', clubTournaments.requireSeasonManager(clubTournaments.byRegistrationId), (req, res) => {
  const info = db.prepare('DELETE FROM season_registrations WHERE id = ?').run(Number(req.params.rid));
  if (!info.changes) return res.status(404).json({ error: 'Registration not found' });
  res.json({ ok: true });
});

router.get('/:id/brackets', (req, res) => {
  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  res.json(db.prepare("SELECT id, name, category, COALESCE(kind, 'MAIN') AS kind, parent_bracket_id AS parentBracketId, is_doubles AS isDoubles FROM brackets WHERE season_id = ? ORDER BY id").all(season.id).map((b) => ({ ...b, isDoubles: !!b.isDoubles })));
});

// Public: the group tables of one season, calculated from the matches tagged with each group (see standings.js).
// Recalculated on every request, so it is always in step with the matches.
router.get('/:id/standings', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id);
  // Finished seasons show the official final tables copied from blta.sk (src/frozenStandings.js); the current
  // season and the later ones are calculated from the matches below.
  const frozen = FROZEN[season.slug];
  if (frozen) {
    const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/s+/g, ' ').trim().toLowerCase();
    const byName = new Map(db.prepare('SELECT id, name, slug FROM players').all().map((p) => [fold(p.name), p]));
    return res.json({
      id: season.id, name: season.name, slug: season.slug, startDate: season.start_date, endDate: season.end_date, frozen: true,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        matchesCounted: null,
        matchesTotal: null,
        rows: (frozen[g.name.toLowerCase()] || []).map((r) => {
          const p = byName.get(fold(r.name));
          return { position: r.position, player: { id: p ? p.id : null, name: r.name, slug: p ? p.slug : null }, points: r.points, played: r.played, wins: r.wins, losses: r.losses, setDiff: r.setDiff };
        }),
      })),
    });
  }
  const players = new Map();
  const playerStmt = db.prepare('SELECT id, name, slug FROM players WHERE id = ?');
  const result = groups.map((g) => {
    const rows = db.prepare('SELECT player1_id, player2_id, winner_id, status, end_reason, state, COALESCE(scheduled_at, end_time, created_at) AS d FROM matches WHERE group_id = ? AND COALESCE(stage, \'GROUP\') = \'GROUP\'').all(g.id);
    // the groups of the doubles are tables of PAIRS (named "A / B", no profile); kept apart from the players of the other groups
    const pairGroup = g.category === 'DOUBLES';
    const known = pairGroup ? new Map() : players;
    const records = rows.map((r) => {
      [r.player1_id, r.player2_id].forEach((pid) => { if (!known.has(pid)) known.set(pid, pairGroup ? require('../tournamentGroups').pairPlayer(season.id, pid) : playerStmt.get(pid)); });
      return { player1Id: r.player1_id, player2Id: r.player2_id, winnerId: r.winner_id, status: r.status, endReason: r.end_reason, date: r.d, state: JSON.parse(r.state) };
    });
    const table = computeGroupStandings(records, known);
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      matchesCounted: table.reduce((sum, x) => sum + x.played, 0) / 2,
      matchesTotal: records.length,
      rows: table.map((x) => ({
        position: x.position,
        player: { id: x.player.id, name: x.player.name, slug: x.player.slug },
        points: x.points,
        played: x.played,
        wins: x.wins,
        losses: x.losses,
        setDiff: x.setDiff,
      })),
    };
  });
  res.json({ id: season.id, name: season.name, slug: season.slug, startDate: season.start_date, endDate: season.end_date, frozen: false, groups: result });
});

// the checks of a new season or tournament, shared by the Backend (POST /api/seasons) and the clubs (POST /api/communities/:id/tournaments):
// { error } or { values }
function readNewSeason(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Season name is required' };
  if (name.length > 120) return { error: 'Season name is too long (max 120 characters)' };
  const start = parseDate(body.startDate);
  const end = parseDate(body.endDate);
  if (start.error || end.error) return { error: start.error || end.error };
  if (start.value && end.value && start.value > end.value) return { error: 'The end date is before the start date' };
  const kind = body.kind === undefined ? 'LEAGUE' : body.kind;
  if (!KINDS.includes(kind)) return { error: 'The type must be LEAGUE or TOURNAMENT' };
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  if (venue.length > 200) return { error: 'Venue is too long (max 200 characters)' };
  // a tournament is singles or doubles, chosen when it is made (never mixed); a league season is always singles
  const playTypeAsked = body.playType === undefined ? 'SINGLES' : body.playType;
  if (!['SINGLES', 'DOUBLES'].includes(playTypeAsked)) return { error: 'The tournament is played as singles or doubles' };
  const playType = kind === 'TOURNAMENT' ? playTypeAsked : 'SINGLES';
  return { values: { name, start: start.value, end: end.value, kind, venue, playType, categories: playType === 'DOUBLES' ? null : categoriesToStore(body.categories) } };
}

// inserts a checked new season and returns its row; a club tournament carries the id of its organisation
function insertSeason(values, leagueId, organisationId = null) {
  const slug = uniqueSlug(slugify(values.name));
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM seasons WHERE league_id = ?').get(leagueId).m;
  const info = db.prepare('INSERT INTO seasons (name, slug, start_date, end_date, sort_order, kind, venue, categories, league_id, play_type, organisation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(values.name, slug, values.start, values.end, maxOrder + 1, values.kind, values.venue || null, values.categories, leagueId, values.playType, organisationId);
  return db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(info.lastInsertRowid));
}

router.post('/', requireAdmin, (req, res) => {
  const read = readNewSeason(req.body);
  if (read.error) return res.status(400).json({ error: read.error });
  res.status(201).json(serializeSeason(insertSeason(read.values, leagues.actingIdOf(req))));
});

router.patch('/:id', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : season.name;
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
  // singles or doubles is chosen when the tournament is made and stays (a tournament is never mixed)
  if (req.body.playType !== undefined && req.body.playType !== (season.play_type || 'SINGLES')) return res.status(409).json({ error: 'A tournament stays singles or doubles — make a new tournament for the other type' });
  const start = req.body.startDate !== undefined ? parseDate(req.body.startDate) : { value: season.start_date };
  const end = req.body.endDate !== undefined ? parseDate(req.body.endDate) : { value: season.end_date };
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  if (start.value && end.value && start.value > end.value) return res.status(400).json({ error: 'The end date is before the start date' });
  // the season page's optional texts: left as they are when not sent, cleared with an empty string
  const text = (key, current, max) => {
    if (req.body[key] === undefined) return { value: current };
    const v = String(req.body[key] || '').trim();
    if (v.length > max) return { error: `${key} is too long (max ${max} characters)` };
    return { value: v || null };
  };
  const fee = text('entryFee', season.entry_fee, 40);
  const prize = text('prizeMoney', season.prize_money, 120);
  // the description: cleaned HTML; nothing left but empty tags/spaces means "no description"
  let info = { value: season.info };
  if (req.body.info !== undefined) {
    const clean = sanitizeHtml(req.body.info).trim();
    const empty = !clean.replace(/<[^>]*>|&nbsp;|\s/g, '');
    info = clean.length > 8000 ? { error: 'The description is too long' } : { value: empty ? null : clean };
  }
  const gallery = text('galleryUrl', season.gallery_url, 500);
  const payment = text('paymentUrl', season.payment_url, 500);
  const logo = text('logoUrl', season.logo_url, 300);
  const draw = req.body.drawDate !== undefined ? parseDate(req.body.drawDate) : { value: season.draw_date };
  const venue = text('venue', season.venue, 200);
  // the organiser of a club cannot change what a club tournament is (only an admin of the site may)
  const kind = req.body.kind === undefined || !auth.isAdmin(req) ? (season.kind || 'LEAGUE') : req.body.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'The type must be LEAGUE or TOURNAMENT' });
  const categories = req.body.categories === undefined || tournamentDraw.isDoublesTournament(season) ? season.categories : categoriesToStore(req.body.categories);
  const bad = fee.error || prize.error || info.error || gallery.error || payment.error || logo.error || draw.error || venue.error;
  if (bad) return res.status(400).json({ error: bad });
  if (gallery.value && !/^https?:\/\//i.test(gallery.value)) return res.status(400).json({ error: 'The gallery link must start with http:// or https://' });
  if (payment.value && !/^https?:\/\//i.test(payment.value)) return res.status(400).json({ error: 'The payment link must start with http:// or https://' });
  if (logo.value && !/^(https?:\/\/|\/)/i.test(logo.value)) return res.status(400).json({ error: 'The logo must be a link starting with http://, https:// or /' });
  if (logo.value && logo.value !== season.logo_url && !auth.isAdmin(req) && !/^https:\/\//i.test(logo.value)) return res.status(400).json({ error: 'The logo must be a link starting with https:// (or uploaded)' });
  const open = req.body.registrationOpen === undefined ? season.registration_open : (req.body.registrationOpen ? 1 : 0);
  let courts = season.court_count || 0;
  if (req.body.courtCount !== undefined) {
    courts = Number(req.body.courtCount);
    if (!Number.isInteger(courts) || courts < 0 || courts > 50) return res.status(400).json({ error: 'The number of courts must be a whole number from 0 to 50' });
  }
  let maxPerDay = season.max_matches_per_day || 0;
  if (req.body.maxMatchesPerDay !== undefined) {
    maxPerDay = Number(req.body.maxMatchesPerDay);
    if (!Number.isInteger(maxPerDay) || maxPerDay < 0 || maxPerDay > 10) return res.status(400).json({ error: 'The most matches a player may play in a day must be 0 (no limit) to 10' });
  }
  db.prepare('UPDATE seasons SET name = ?, start_date = ?, end_date = ?, entry_fee = ?, prize_money = ?, draw_date = ?, info = ?, gallery_url = ?, payment_url = ?, logo_url = ?, registration_open = ?, kind = ?, venue = ?, categories = ?, court_count = ?, max_matches_per_day = ? WHERE id = ?')
    .run(name, start.value, end.value, fee.value, prize.value, draw.value, info.value, gallery.value, payment.value, logo.value, open, kind, venue.value, categories, courts, maxPerDay, season.id);
  res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// Deleting a season deletes its groups and clears the season/group on the matches that had them
// (the matches themselves are untouched).
// ?withMatches=1 (tournaments only): the tournament goes together with ALL its matches, its brackets, registrations and groups. A deleted
// match takes the ranking points it added back with it, like deleting one match does (the CourtIQ rating of the players is not recalculated).
function deleteTournamentWithMatches(req, res, season) {
  if (season.kind !== 'TOURNAMENT') return res.status(400).json({ error: 'Only a tournament can be deleted together with its matches' });
  const matches = db.prepare('SELECT * FROM matches WHERE season_id = ?').all(season.id);
  const brackets = db.prepare('SELECT id FROM brackets WHERE season_id = ?').all(season.id).map((b) => b.id);
  db.exec('BEGIN');
  try {
    matches.forEach((m) => {
      db.prepare('DELETE FROM messages WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM match_notifications WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM push_subscriptions WHERE match_id = ?').run(m.id);
      matchPhotos.removeAllForMatch(m.id);
      db.prepare('UPDATE bracket_matches SET match_id = NULL WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
    });
    brackets.forEach((id) => {
      db.prepare('DELETE FROM bracket_partners WHERE bracket_id = ?').run(id);
      db.prepare('DELETE FROM bracket_matches WHERE bracket_id = ?').run(id);
      db.prepare('DELETE FROM brackets WHERE id = ?').run(id);
    });
    db.prepare('DELETE FROM season_group_members WHERE group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(season.id);
    db.prepare('DELETE FROM season_groups WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM season_registrations WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM tournament_pairs WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  matches.forEach((m) => {
    try {
      const ranking = rankingPoints.reverseForMatchWithChanges(m.id);
      try { changeLog.logMatchDeleted(m, ranking); } catch (err) { console.error('[change log]', err.message); }
    } catch (err) {
      console.error('[seasons] failed to reverse ranking points on delete:', err.message);
    }
  });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'DELETED' });
  return res.json({ ok: true, deletedMatches: matches.length });
}

router.delete('/:id', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  // the organiser of a club deletes his tournament together with its matches, and only while none of them is finished (an admin of the site may always)
  if (!auth.isAdmin(req)) {
    if (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND status = 'FINISHED'").get(season.id).n > 0) {
      return res.status(409).json({ error: 'A tournament with finished matches can only be deleted by an admin of the site' });
    }
    return deleteTournamentWithMatches(req, res, season);
  }
  if (req.query.withMatches === '1') return deleteTournamentWithMatches(req, res, season);
  db.prepare('UPDATE matches SET group_id = NULL WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM season_group_members WHERE group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(season.id);
  db.prepare('DELETE FROM season_registrations WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM tournament_pairs WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
  res.json({ ok: true });
});

function parseGroup(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Group name is required' };
  if (name.length > 80) return { error: 'Group name is too long (max 80 characters)' };
  if (!BLTA_CATEGORIES.includes(body.category)) return { error: 'Every group needs a category: ELITE, NEXT_GEN or NOVICE' };
  return { name, category: body.category };
}

router.post('/:id/groups', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const parsed = parseGroup(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT 1 FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(season.id, parsed.name)) {
    return res.status(409).json({ error: 'This season already has a group with that name' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM season_groups WHERE season_id = ?').get(season.id).m;
  const info = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)')
    .run(season.id, parsed.name, parsed.category, maxOrder + 1);
  res.status(201).json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/groups/:groupId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const parsed = parseGroup({ name: req.body.name !== undefined ? req.body.name : group.name, category: req.body.category !== undefined ? req.body.category : group.category });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const clash = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(group.season_id, parsed.name);
  if (clash && clash.id !== group.id) return res.status(409).json({ error: 'This season already has a group with that name' });
  db.prepare('UPDATE season_groups SET name = ?, category = ? WHERE id = ?').run(parsed.name, parsed.category, group.id);
  // A match must stay in a group of its own category: changing the group's category un-tags the other ones.
  db.prepare('UPDATE matches SET group_id = NULL WHERE group_id = ? AND category != ?').run(group.id, parsed.category);
  res.json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(group.id)));
});

router.delete('/groups/:groupId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  db.prepare('DELETE FROM season_group_members WHERE group_id = ?').run(group.id);
  db.prepare('DELETE FROM season_groups WHERE id = ?').run(group.id);
  res.json({ ok: true });
});

// ---------------- season maker: players of a group, schedule, withdrawals (admin) ----------------

const MATCH_FORMAT_DEFAULT = 'BO3_STB';

// The player a request means, for adding to a group: by id, or by typed name with the same protection as when a match
// is created (the same name written differently is the same player; a similar name asks which one is meant; a name
// nobody has needs confirmNew: true to create a new player). Returns { player } or { conflict } (HTTP 409 body).
function resolveMemberPlayer(body, leagueId = leagues.DEFAULT_LEAGUE_ID) {
  if (body.playerId !== undefined && body.playerId !== null) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(body.playerId));
    return player ? { player } : { error: 'That player does not exist' };
  }
  const typed = typeof body.name === 'string' ? body.name.trim() : '';
  if (!typed) return { error: 'Choose a player or type a name' };
  const same = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE AND league_id = ?').get(typed, leagueId);
  if (same) return { player: same };
  const { exact, similar } = nameMatch.findSimilar(typed, db.prepare('SELECT id, name FROM players WHERE league_id = ?').all(leagueId));
  if (exact) return { player: db.prepare('SELECT * FROM players WHERE id = ?').get(exact.id) };
  if (!body.confirmNew) {
    return { conflict: { code: similar.length ? 'SIMILAR_PLAYERS' : 'UNKNOWN_PLAYER', typed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) } };
  }
  const info = db.prepare('INSERT INTO players (name, created_by_anonymous, league_id) VALUES (?, 0, ?)').run(typed, leagueId);
  return { player: db.prepare('SELECT * FROM players WHERE id = ?').get(Number(info.lastInsertRowid)) };
}

function groupOr404(req, res) {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) res.status(404).json({ error: 'Group not found' });
  return group;
}

// Which group of this season the player is already in (other than `exceptGroupId`), or null.
function otherGroupOf(seasonId, playerId, exceptGroupId) {
  return db.prepare(`
    SELECT g.id, g.name FROM season_group_members m JOIN season_groups g ON g.id = m.group_id
    WHERE g.season_id = ? AND m.player_id = ? AND g.id != ?
  `).get(seasonId, playerId, exceptGroupId) || null;
}

router.post('/groups/:groupId/members', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const groupSeason = db.prepare('SELECT league_id FROM seasons WHERE id = ?').get(group.season_id);
  const found = resolveMemberPlayer(req.body || {}, groupSeason ? groupSeason.league_id : undefined);
  if (found.error) return res.status(400).json({ error: found.error });
  if (found.conflict) {
    return res.status(409).json({ error: found.conflict.code === 'SIMILAR_PLAYERS' ? 'Similar players exist — choose who you mean' : 'No such player yet — confirm to create a new one', ...found.conflict });
  }
  const { player } = found;
  if (db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, player.id)) {
    return res.status(409).json({ code: 'ALREADY_IN_GROUP', error: `${player.name} is already in this group` });
  }
  const other = otherGroupOf(group.season_id, player.id, group.id);
  if (other) return res.status(409).json({ code: 'IN_OTHER_GROUP', error: `${player.name} is already in group ${other.name} of this season` });
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_group_members WHERE group_id = ?').get(group.id).n;
  db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(group.id, player.id, next);
  res.status(201).json(serializeGroup(group));
});

// Marks whether a player of the group has paid the entry fee (shown on the season page).
router.patch('/groups/:groupId/members/:playerId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  if (!db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId)) {
    return res.status(404).json({ error: 'That player is not in this group' });
  }
  db.prepare('UPDATE season_group_members SET paid = ? WHERE group_id = ? AND player_id = ?').run(req.body && req.body.paid ? 1 : 0, group.id, playerId);
  res.json(serializeGroup(group));
});

// Removing is only for a mistake: once the player has matches in the group they have to be withdrawn instead.
router.delete('/groups/:groupId/members/:playerId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  if (!db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId)) {
    return res.status(404).json({ error: 'That player is not in this group' });
  }
  const played = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE group_id = ? AND (player1_id = ? OR player2_id = ?)').get(group.id, playerId, playerId).n;
  if (played) return res.status(400).json({ error: 'This player already has matches in the group — withdraw them instead (their unplayed matches become walkovers)' });
  db.prepare('DELETE FROM season_group_members WHERE group_id = ? AND player_id = ?').run(group.id, playerId);
  res.json(serializeGroup(group));
});

// The player leaves mid-season: no new matches for them, and every unplayed match of theirs becomes a walkover win for
// the opponent (3 points, as in the tables). Live matches and matches against another withdrawn player are left alone.
router.post('/groups/:groupId/members/:playerId/withdraw', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  const member = db.prepare('SELECT * FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId);
  if (!member) return res.status(404).json({ error: 'That player is not in this group' });
  if (member.withdrawn_at) return res.status(400).json({ error: 'This player has already withdrawn' });
  const now = new Date().toISOString();
  let walkovers = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE season_group_members SET withdrawn_at = ? WHERE id = ?').run(now, member.id);
    const open = db.prepare(`
      SELECT * FROM matches
      WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' AND status = 'PLANNED' AND (player1_id = ? OR player2_id = ?)
    `).all(group.id, playerId, playerId);
    open.forEach((m) => {
      const opponent = m.player1_id === playerId ? m.player2_id : m.player1_id;
      const opponentOut = db.prepare('SELECT withdrawn_at FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, opponent);
      if (opponentOut && opponentOut.withdrawn_at) { skipped += 1; return; }
      db.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ?, end_reason = 'WALKOVER', end_time = ?, updated_at = ? WHERE id = ?")
        .run(opponent, now, now, m.id);
      walkovers += 1;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { status: 'WALKOVER' });
  res.json({ group: serializeGroup(group), walkovers, skipped });
});

// For a group that already has matches (a season made before the maker existed): take its players from the matches.
router.post('/groups/:groupId/members/import', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const ids = db.prepare(`
    SELECT player_id FROM (
      SELECT player1_id AS player_id, MIN(id) AS first FROM matches WHERE group_id = ? GROUP BY player1_id
      UNION SELECT player2_id AS player_id, MIN(id) AS first FROM matches WHERE group_id = ? GROUP BY player2_id
    ) GROUP BY player_id ORDER BY MIN(first)
  `).all(group.id, group.id).map((r) => r.player_id);
  let added = 0;
  let inOtherGroup = 0;
  ids.forEach((id) => {
    if (db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, id)) return;
    if (otherGroupOf(group.season_id, id, group.id)) { inOtherGroup += 1; return; }
    const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_group_members WHERE group_id = ?').get(group.id).n;
    db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(group.id, id, next);
    added += 1;
  });
  res.json({ group: serializeGroup(group), added, inOtherGroup });
});

// What the schedule of a group looks like and what is still missing: the matches that exist plus the ones that would be
// created. Used by the preview and by the creation itself, so they can never disagree.
function groupSchedule(group) {
  const members = groupMembers(group.id);
  const active = members.filter((m) => !m.withdrawn);
  const name = new Map(members.map((m) => [m.id, m.name]));
  const player = (id) => ({ id, name: name.get(id) || (db.prepare('SELECT name FROM players WHERE id = ?').get(id) || {}).name || '#' + id });
  const existing = db.prepare("SELECT id, round, player1_id, player2_id, status FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' ORDER BY COALESCE(round, 9999), id").all(group.id);
  const plan = roundRobin.planMissingMatches(
    active.map((m) => m.id),
    existing.map((m) => ({ round: m.round, p1: m.player1_id, p2: m.player2_id })),
  );
  const byRound = new Map();
  const push = (round, entry) => { if (!byRound.has(round)) byRound.set(round, []); byRound.get(round).push(entry); };
  const unassigned = [];
  existing.forEach((m) => {
    const entry = { p1: player(m.player1_id), p2: player(m.player2_id), exists: true, status: m.status };
    if (m.round) push(m.round, entry); else unassigned.push(entry);
  });
  plan.forEach((m) => push(m.round, { p1: player(m.p1), p2: player(m.p2), exists: false, status: 'PLANNED' }));
  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => {
    const playing = new Set();
    byRound.get(round).forEach((m) => { playing.add(m.p1.id); playing.add(m.p2.id); });
    return { round, matches: byRound.get(round), rest: active.filter((m) => !playing.has(m.id)).map((m) => m.name) };
  });
  return { plan, rounds, unassigned, members, activeCount: active.length, existing: existing.length };
}

router.get('/:id/schedule-preview', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id);
  res.json({
    seasonId: season.id,
    groups: groups.map((g) => {
      const sch = groupSchedule(g);
      return {
        groupId: g.id, name: g.name, category: g.category,
        members: sch.members, activeCount: sch.activeCount, existing: sch.existing, toCreate: sch.plan.length,
        rounds: sch.rounds, unassigned: sch.unassigned,
      };
    }),
  });
});

// Creates the missing matches of every group of the season (or of the listed groups): planned, no date, tagged with the
// season, the group, the category and the round. Safe to run again: only pairs without a match get one.
router.post('/:id/schedule', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const format = req.body.format || MATCH_FORMAT_DEFAULT;
  if (!engine.FORMATS[format]) return res.status(400).json({ error: 'Invalid match format' });
  const only = Array.isArray(req.body.groupIds) ? new Set(req.body.groupIds.map(Number)) : null;
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id)
    .filter((g) => !only || only.has(g.id));
  const insert = db.prepare(`
    INSERT INTO matches (share_token, category, season_id, group_id, stage, round, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (?, ?, ?, ?, 'GROUP', ?, ?, ?, '', NULL, ?, 'PLANNED', ?, '[]', 1, '')
  `);
  const result = [];
  let created = 0;
  db.exec('BEGIN');
  try {
    groups.forEach((g) => {
      const sch = groupSchedule(g);
      if (sch.activeCount < 2) { result.push({ groupId: g.id, name: g.name, created: 0, skipped: 'needs at least 2 players' }); return; }
      sch.plan.forEach((m) => {
        insert.run(crypto.randomUUID(), g.category, season.id, g.id, m.round, m.p1, m.p2, format, JSON.stringify(engine.initState(format)));
      });
      created += sch.plan.length;
      result.push({ groupId: g.id, name: g.name, created: sch.plan.length });
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const io = req.app.get('io');
  if (io && created) io.emit('matches:changed', { status: 'CREATED' });
  res.status(201).json({ created, groups: result });
});

module.exports = router;
module.exports.BLTA_CATEGORIES = BLTA_CATEGORIES;
module.exports.serializeSeason = serializeSeason;
module.exports.readNewSeason = readNewSeason;
module.exports.insertSeason = insertSeason;
module.exports.sanitizeHtml = sanitizeHtml;
