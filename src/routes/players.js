const express = require('express');
const db = require('../db');
const { requireAdmin, isAdmin, isPlayer, isAnon, isProfileEditor, getPlayerId } = require('../auth');

const router = express.Router();

// Email is never shown to an anonymous visitor — only to a logged-in
// player, the bio-editing PROFILE_CODE, or an admin. Everything else on
// the bio stays public. Deliberately excludes the limited anon tier
// (ANON_CODE) — that login only ever sees/edits players it created itself
// (see checkPlayerAccess below), and email is off-limits even for those.
//
// Phone is stricter still: it's now a player's login credential (see
// auth.js), so it's admin-only regardless of the tiers above — a logged-in
// player (or PROFILE_CODE session) could otherwise read, and log in as,
// any other player.
function canSeePrivateFields(req) {
  return isAdmin(req) || isPlayer(req) || isProfileEditor(req);
}
function stripPrivateFields(player, req) {
  const { phone, email, ...rest } = player;
  if (isAdmin(req)) return player;
  if (canSeePrivateFields(req)) return { ...rest, email };
  return rest;
}

// A real profile editor/admin can edit any player's bio. A specific
// logged-in player can edit only their own bio (see checkPlayerAccess
// below). The limited anon tier can only edit a player it (or another anon
// session) created — mirrors checkMatchAccess in routes/matches.js.
function requireProfileEditorOrAnon(req, res, next) {
  if (!isAdmin(req) && !isProfileEditor(req) && !isAnon(req) && !getPlayerId(req)) {
    return res.status(401).json({ error: 'Please log in to edit profile info' });
  }
  next();
}
function checkPlayerAccess(req, res, player) {
  if (isAdmin(req) || isProfileEditor(req)) return true;
  if (isAnon(req) && player.created_by_anonymous) return true;
  const playerId = getPlayerId(req);
  if (playerId && playerId === player.id) return true;
  res.status(403).json({ error: 'You can only edit your own profile (or players you created)' });
  return false;
}

function slugifyPart(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function surnameOf(name) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// Base slug is the surname — falls back to a full-name slug then "player"
// for the rare edge case where the surname alone normalizes to nothing
// (e.g. a name that's only diacritics/symbols).
function uniqueSlugFor(name, excludeId) {
  const base = slugifyPart(surnameOf(name)) || slugifyPart(name) || 'player';
  let slug = base;
  let n = 2;
  const taken = (candidate) => {
    const row = db.prepare('SELECT id FROM players WHERE slug = ?').get(candidate);
    return row && row.id !== excludeId;
  };
  while (taken(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

// Old links (numeric id) still work — anything else is looked up as a slug.
function findPlayerByIdOrSlug(idOrSlug) {
  if (/^\d+$/.test(idOrSlug)) {
    return db.prepare('SELECT * FROM players WHERE id = ?').get(idOrSlug);
  }
  return db.prepare('SELECT * FROM players WHERE slug = ?').get(idOrSlug);
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare('SELECT * FROM players WHERE name LIKE ? ORDER BY name COLLATE NOCASE')
      .all(`%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE').all();
  }
  res.json(rows.map((p) => stripPrivateFields(p, req)));
});

router.get('/:id', (req, res) => {
  const player = findPlayerByIdOrSlug(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(stripPrivateFields(player, req));
});

// Note: players can still be auto-created when someone plans a new match with
// a new name (see resolvePlayer in routes/matches.js) — that stays open to
// everyone. Only the dedicated Players page (add/rename/delete) is admin-only.
router.post('/', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(200).json(existing);

  const slug = uniqueSlugFor(name, null);
  const info = db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, slug);
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(player);
});

router.patch('/:id', requireAdmin, (req, res) => {
  const player = findPlayerByIdOrSlug(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'Name is too long' });

  const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, player.id);
  if (existing) return res.status(400).json({ error: 'Another player already has that name' });

  const photoUrl = req.body.photoUrl !== undefined ? (req.body.photoUrl || null) : player.photo_url;
  db.prepare('UPDATE players SET name = ?, photo_url = ? WHERE id = ?').run(name, photoUrl, player.id);
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id));
});

const BIO_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function optionalTextField(body, key, current, maxLen) {
  if (body[key] === undefined) return current;
  const v = (body[key] || '').trim();
  return v ? v.slice(0, maxLen) : null;
}

// Bio fields are editable by anyone with the profile-editing code (its own
// PROFILE_CODE, separate from a player's own phone-number login) or an
// admin — unlike name/photo above, which stay admin-only since renaming or
// re-photographing another player is a more sensitive action than filling
// in your own racket string tension. The limited anon tier gets a narrower
// version of this same right: it can edit a player's bio only if it (or
// another anon session) created that player in the first place.
router.patch('/:id/bio', requireProfileEditorOrAnon, (req, res) => {
  const player = findPlayerByIdOrSlug(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!checkPlayerAccess(req, res, player)) return;

  let category = player.category;
  if (req.body.category !== undefined) {
    category = req.body.category || null;
    if (category && !BIO_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
  }

  const nationality = optionalTextField(req.body, 'nationality', player.nationality, 60);
  const racket = optionalTextField(req.body, 'racket', player.racket, 60);
  const stringBrand = optionalTextField(req.body, 'stringBrand', player.string_brand, 60);
  const stringTension = optionalTextField(req.body, 'stringTension', player.string_tension, 30);
  const forehand = optionalTextField(req.body, 'forehand', player.forehand, 40);
  const backhand = optionalTextField(req.body, 'backhand', player.backhand, 40);
  const seasons = optionalTextField(req.body, 'seasons', player.seasons, 60);
  const favoritePlayer = optionalTextField(req.body, 'favoritePlayer', player.favorite_player, 60);

  let email = player.email;
  if (req.body.email !== undefined) {
    const v = (req.body.email || '').trim();
    if (!v) {
      email = null;
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      email = v.slice(0, 100);
    } else {
      return res.status(400).json({ error: 'Invalid email' });
    }
  }

  let birthday = player.birthday;
  if (req.body.birthday !== undefined) {
    if (!req.body.birthday) {
      birthday = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(req.body.birthday) && !Number.isNaN(new Date(req.body.birthday).getTime())) {
      birthday = req.body.birthday;
    } else {
      return res.status(400).json({ error: 'Invalid birthday' });
    }
  }

  db.prepare(`
    UPDATE players SET category = ?, nationality = ?, birthday = ?, racket = ?,
      string_brand = ?, string_tension = ?, forehand = ?, backhand = ?,
      seasons = ?, favorite_player = ?, email = ?
    WHERE id = ?
  `).run(category, nationality, birthday, racket, stringBrand, stringTension, forehand, backhand, seasons, favoritePlayer, email, player.id);

  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id));
});

// Phone doubles as a player's login credential (see auth.js) — editable by
// admin only, deliberately separate from the bio route above (which the
// profile-editing code and anon-who-created-this-player can also reach).
router.patch('/:id/phone', requireAdmin, (req, res) => {
  const player = findPlayerByIdOrSlug(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const raw = String(req.body.phone || '').trim();
  let phone = null;
  if (raw) {
    // Slovak local (0903111222) is the expected format, but a handful of
    // players already have a full international number on file from
    // before this login system existed (non-Slovak players) — allow
    // fixing/re-entering those too rather than rejecting them outright.
    const digits = raw.replace(/[^\d+]/g, '');
    const isSlovakLocal = /^0\d{9}$/.test(digits);
    const isInternational = /^\+\d{8,15}$/.test(digits);
    if (!isSlovakLocal && !isInternational) {
      return res.status(400).json({ error: 'Enter a 10-digit phone number starting with 0 (e.g. 0903111222), or a full international number starting with +' });
    }
    phone = digits;
  }

  try {
    db.prepare('UPDATE players SET phone = ? WHERE id = ?').run(phone, player.id);
  } catch (err) {
    if (!/UNIQUE/.test(err.message)) throw err;
    return res.status(409).json({ error: 'Another player already has this phone number' });
  }
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const player = findPlayerByIdOrSlug(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM matches WHERE player1_id = ? OR player2_id = ?'
  ).get(player.id, player.id);
  if (count > 0) {
    return res.status(400).json({
      error: `Can't delete ${player.name} — they're in ${count} match${count === 1 ? '' : 'es'}. Remove those matches first.`,
    });
  }

  db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
  res.status(204).end();
});

module.exports = router;
