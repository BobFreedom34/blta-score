const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { computeGroupStandings } = require('../standings');
const { FROZEN } = require('../frozenStandings');
const crypto = require('crypto');
const engine = require('../matchEngine');
const nameMatch = require('../nameMatch');
const roundRobin = require('../roundRobin');
const { sendSeasonRegistrationEmail } = require('../mailer');

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
function groupMembers(groupId) {
  return db.prepare(`
    SELECT m.player_id AS id, p.name, p.slug, m.withdrawn_at, m.paid
    FROM season_group_members m JOIN players p ON p.id = m.player_id
    WHERE m.group_id = ? ORDER BY m.sort_order, m.id
  `).all(groupId).map((r) => ({ id: r.id, name: r.name, slug: r.slug, withdrawn: !!r.withdrawn_at, paid: !!r.paid }));
}

function serializeGroup(g) {
  const members = groupMembers(g.id);
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
// the categories of a season as an array (all three when none is saved)
function parseCategories(raw) {
  const list = String(raw || '').split(',').filter((c) => CATEGORY_KEYS.includes(c));
  return list.length ? list : CATEGORY_KEYS;
}
// a request's category list as the stored comma text; null = all of them
function categoriesToStore(list) {
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
    venue: s.venue || '',
    categories: parseCategories(s.categories),
    startDate: s.start_date,
    endDate: s.end_date,
    entryFee: s.entry_fee || '',
    prizeMoney: s.prize_money || '',
    drawDate: s.draw_date || null,
    info: s.info || '',
    galleryUrl: s.gallery_url || '',
    paymentUrl: s.payment_url || '',
    logoUrl: s.logo_url || '',
    registrationOpen: !!s.registration_open,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ?').get(s.id).n,
    groups: groups.map(serializeGroup),
  };
}

// Public: the match page and its admin editor read this (newest season first).
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM seasons ORDER BY COALESCE(start_date, \'\') DESC, id DESC').all();
  res.json(rows.map(serializeSeason));
});

// Public: the brackets (play-off draws) tied to a season — the league tables page shows them under "Play-off".
// The season page: one season by its slug, with its rounds (the group-stage rounds the season maker numbered, with how many
// of their matches are finished).
router.get('/by-slug/:slug', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE slug = ?').get(req.params.slug);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const rounds = db.prepare(`
    SELECT round, COUNT(*) AS total, SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) AS finished
    FROM matches WHERE season_id = ? AND round IS NOT NULL AND COALESCE(stage, 'GROUP') = 'GROUP'
    GROUP BY round ORDER BY round
  `).all(season.id).map((r) => ({ round: r.round, total: r.total, finished: r.finished }));
  const registrations = db.prepare(`
    SELECT r.name, r.category, r.paid, p.slug AS player_slug
    FROM season_registrations r LEFT JOIN players p ON p.id = r.player_id
    WHERE r.season_id = ? ORDER BY r.created_at, r.id
  `).all(season.id).map((r) => ({ name: r.name, category: r.category, paid: !!r.paid, slug: r.player_slug || null }));
  res.json({ ...serializeSeason(season), rounds, registrations });
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
  if (!season) return res.status(404).json({ error: 'Season not found' });
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

  db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player ? player.id : null, name, phone, email, entryCategory, note);
  const total = db.prepare('SELECT COUNT(*) AS n FROM season_registrations WHERE season_id = ?').get(season.id).n;
  // the e-mail to the admin must never make the registration fail
  sendSeasonRegistrationEmail(season, { name, phone, email, category: entryCategory, note, isNew: !player }, total)
    .catch((err) => console.error('[season registration] admin e-mail failed:', err.message));
  res.status(201).json({ ok: true, name, category: entryCategory, paymentUrl: season.payment_url || '' });
});

function serializeRegistration(r) {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, category: r.category, paid: !!r.paid, note: r.note || '', createdAt: r.created_at, playerId: r.player_id };
}

// The category written in a player's profile ("Next Gen", "ELITE"…) as one of ours, or null.
function profileCategory(raw) {
  const key = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return key === 'ELITE' ? 'ELITE' : key === 'NEXTGEN' ? 'NEXT_GEN' : key === 'NOVICE' ? 'NOVICE' : null;
}

// The admin's list: with the contact details (never sent to the public page).
router.get('/:id/registrations', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(Number(req.params.id));
  res.json(rows.map(serializeRegistration));
});

// The admin registers a player who is already in the app, without the registration form: the phone number and the e-mail
// come from the player's profile unless the admin types others, the category from the profile unless the admin picks one.
// It works whether or not the season's registration is open, and sends no e-mail.
router.post('/:id/registrations/admin', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const body = req.body || {};
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(body.playerId));
  if (!player) return res.status(400).json({ error: 'Choose a player from the list' });
  // a tournament entry may have no category (category = ''): sent as an empty category, or when the profile has none either
  const tournament = season.kind === 'TOURNAMENT';
  let category = null;
  if (BLTA_CATEGORIES.includes(body.category)) category = body.category;
  else if (tournament && body.category === '') category = '';
  else category = profileCategory(player.category) || (tournament ? '' : null);
  if (category === null) return res.status(400).json({ error: 'Choose a category' });

  const typedPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone = String(typedPhone || player.phone || '').replace(/[^\d+]/g, '');
  if (typedPhone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
  const typedEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const email = typedEmail || String(player.email || '').trim();
  if (typedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail) || typedEmail.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });

  const already = db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)
    .some((r) => r.player_id === player.id || nameMatch.key(r.name) === nameMatch.key(player.name));
  if (already) return res.status(409).json({ code: 'ALREADY_REGISTERED', error: `${player.name} is already registered for this season` });

  const info = db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, paid) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player.id, player.name, phone, email, category, body.paid ? 1 : 0);
  res.status(201).json(serializeRegistration(db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(info.lastInsertRowid)));
});

// The admin changes a registration: what is sent is changed, the rest stays — paid, category ('' = no category, tournaments only),
// phone, e-mail and note.
router.patch('/registrations/:rid', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT r.*, s.kind AS season_kind FROM season_registrations r LEFT JOIN seasons s ON s.id = r.season_id WHERE r.id = ?').get(Number(req.params.rid));
  if (!row) return res.status(404).json({ error: 'Registration not found' });
  const body = req.body || {};
  const next = { paid: row.paid, category: row.category, phone: row.phone, email: row.email, note: row.note || '' };
  if (body.paid !== undefined) next.paid = body.paid ? 1 : 0;
  if (body.category !== undefined) {
    if (BLTA_CATEGORIES.includes(body.category)) next.category = body.category;
    else if (body.category === '' && row.season_kind === 'TOURNAMENT') next.category = '';
    else return res.status(400).json({ error: 'Choose a category' });
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone || '').trim().replace(/[^\d+]/g, '');
    if (phone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
    next.phone = phone;
  }
  if (body.email !== undefined) {
    const email = String(body.email || '').trim();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
    next.email = email;
  }
  if (body.note !== undefined) {
    const note = String(body.note || '').trim();
    if (note.length > 500) return res.status(400).json({ error: 'The note is too long (max 500 characters)' });
    next.note = note;
  }
  db.prepare('UPDATE season_registrations SET paid = ?, category = ?, phone = ?, email = ?, note = ? WHERE id = ?')
    .run(next.paid, next.category, next.phone, next.email, next.note, row.id);
  res.json({ ok: true, ...serializeRegistration(db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(row.id)) });
});

router.delete('/registrations/:rid', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM season_registrations WHERE id = ?').run(Number(req.params.rid));
  if (!info.changes) return res.status(404).json({ error: 'Registration not found' });
  res.json({ ok: true });
});

router.get('/:id/brackets', (req, res) => {
  const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  res.json(db.prepare('SELECT id, name, category FROM brackets WHERE season_id = ? ORDER BY id').all(season.id));
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
    const records = rows.map((r) => {
      [r.player1_id, r.player2_id].forEach((pid) => { if (!players.has(pid)) players.set(pid, playerStmt.get(pid)); });
      return { player1Id: r.player1_id, player2Id: r.player2_id, winnerId: r.winner_id, status: r.status, endReason: r.end_reason, date: r.d, state: JSON.parse(r.state) };
    });
    const table = computeGroupStandings(records, players);
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

router.post('/', requireAdmin, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
  const start = parseDate(req.body.startDate);
  const end = parseDate(req.body.endDate);
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  if (start.value && end.value && start.value > end.value) return res.status(400).json({ error: 'The end date is before the start date' });
  const kind = req.body.kind === undefined ? 'LEAGUE' : req.body.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'The type must be LEAGUE or TOURNAMENT' });
  const venue = typeof req.body.venue === 'string' ? req.body.venue.trim() : '';
  if (venue.length > 200) return res.status(400).json({ error: 'Venue is too long (max 200 characters)' });
  const slug = uniqueSlug(slugify(name));
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM seasons').get().m;
  const info = db.prepare('INSERT INTO seasons (name, slug, start_date, end_date, sort_order, kind, venue, categories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, slug, start.value, end.value, maxOrder + 1, kind, venue || null, categoriesToStore(req.body.categories));
  res.status(201).json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : season.name;
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
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
  const kind = req.body.kind === undefined ? (season.kind || 'LEAGUE') : req.body.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'The type must be LEAGUE or TOURNAMENT' });
  const categories = req.body.categories === undefined ? season.categories : categoriesToStore(req.body.categories);
  const bad = fee.error || prize.error || info.error || gallery.error || payment.error || logo.error || draw.error || venue.error;
  if (bad) return res.status(400).json({ error: bad });
  if (gallery.value && !/^https?:\/\//i.test(gallery.value)) return res.status(400).json({ error: 'The gallery link must start with http:// or https://' });
  if (payment.value && !/^https?:\/\//i.test(payment.value)) return res.status(400).json({ error: 'The payment link must start with http:// or https://' });
  if (logo.value && !/^(https?:\/\/|\/)/i.test(logo.value)) return res.status(400).json({ error: 'The logo must be a link starting with http://, https:// or /' });
  const open = req.body.registrationOpen === undefined ? season.registration_open : (req.body.registrationOpen ? 1 : 0);
  db.prepare('UPDATE seasons SET name = ?, start_date = ?, end_date = ?, entry_fee = ?, prize_money = ?, draw_date = ?, info = ?, gallery_url = ?, payment_url = ?, logo_url = ?, registration_open = ?, kind = ?, venue = ?, categories = ? WHERE id = ?')
    .run(name, start.value, end.value, fee.value, prize.value, draw.value, info.value, gallery.value, payment.value, logo.value, open, kind, venue.value, categories, season.id);
  res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// Deleting a season deletes its groups and clears the season/group on the matches that had them
// (the matches themselves are untouched).
router.delete('/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  db.prepare('UPDATE matches SET group_id = NULL WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM season_group_members WHERE group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(season.id);
  db.prepare('DELETE FROM season_registrations WHERE season_id = ?').run(season.id);
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

router.post('/:id/groups', requireAdmin, (req, res) => {
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

router.patch('/groups/:groupId', requireAdmin, (req, res) => {
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

router.delete('/groups/:groupId', requireAdmin, (req, res) => {
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
function resolveMemberPlayer(body) {
  if (body.playerId !== undefined && body.playerId !== null) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(body.playerId));
    return player ? { player } : { error: 'That player does not exist' };
  }
  const typed = typeof body.name === 'string' ? body.name.trim() : '';
  if (!typed) return { error: 'Choose a player or type a name' };
  const same = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(typed);
  if (same) return { player: same };
  const { exact, similar } = nameMatch.findSimilar(typed, db.prepare('SELECT id, name FROM players').all());
  if (exact) return { player: db.prepare('SELECT * FROM players WHERE id = ?').get(exact.id) };
  if (!body.confirmNew) {
    return { conflict: { code: similar.length ? 'SIMILAR_PLAYERS' : 'UNKNOWN_PLAYER', typed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) } };
  }
  const info = db.prepare('INSERT INTO players (name, created_by_anonymous) VALUES (?, 0)').run(typed);
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

router.post('/groups/:groupId/members', requireAdmin, (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const found = resolveMemberPlayer(req.body || {});
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
router.patch('/groups/:groupId/members/:playerId', requireAdmin, (req, res) => {
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
router.delete('/groups/:groupId/members/:playerId', requireAdmin, (req, res) => {
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
router.post('/groups/:groupId/members/:playerId/withdraw', requireAdmin, (req, res) => {
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
router.post('/groups/:groupId/members/import', requireAdmin, (req, res) => {
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

router.get('/:id/schedule-preview', requireAdmin, (req, res) => {
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
router.post('/:id/schedule', requireAdmin, (req, res) => {
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
