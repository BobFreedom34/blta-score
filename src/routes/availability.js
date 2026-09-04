const express = require('express');
const db = require('../db');
const { isAdmin, getPlayerId, stripPrivateFields, requireLoggedIn } = require('../auth');
const { sendPlayRequestEmail } = require('../mailer');

const router = express.Router();

const MAX_LOCATION_LEN = 120;
const MAX_NOTE_LEN = 300;
const MAX_MESSAGE_LEN = 300;
// Double POST /matches' own cap on proposalSlots — this board's own
// calendar (looking-to-play.js) marks half-hour steps rather than whole
// ones, so a similarly-sized block of free time naturally produces about
// twice as many slots.
const MAX_SLOTS = 120;
// The three regular BLTA divisions (matches BLTA_CATEGORIES in common.js)
// — FRIENDLY/VIP_CUP/ATA_TENNIS aren't offered here since this board is
// specifically about finding a friendly match, not slotting into one of
// those other, more specific formats.
const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// Posting or joining always needs a specific player identity — the whole
// feature is "notify a real player", so unlike requireLoggedIn elsewhere
// a pure admin session (no player cookie) doesn't qualify on its own.
function requirePlayerIdentity(req, res, next) {
  if (!getPlayerId(req)) {
    return res.status(401).json({ error: 'Log in as a player to do this' });
  }
  next();
}

function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function canManagePost(req, post) {
  return isAdmin(req) || getPlayerId(req) === post.player_id;
}

// Validates the same shape a match's own proposalSlots does (see POST /
// in routes/matches.js) — an array of ISO datetime strings marked on the
// When2Meet-style grid (createAvailabilityPicker in common.js) — since
// it's the identical picker producing them. Returns { slots } sorted
// chronologically, or { error }.
function parseSlots(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Mark at least one time you're free" };
  if (raw.length > MAX_SLOTS) return { error: `Too many times selected (max ${MAX_SLOTS})` };
  const parsed = raw.map((s) => (typeof s === 'string' ? new Date(s) : new Date(NaN)));
  if (parsed.some((d) => Number.isNaN(d.getTime()))) return { error: 'One of the selected times is invalid' };
  const slots = [...new Set(parsed.map((d) => d.toISOString()))].sort();
  return { slots };
}

// Which BLTA divisions this post is for — zero or more of CATEGORIES, or
// { error } for anything else. Optional (an empty selection just means no
// preference stated), unlike parseSlots above which requires at least one.
function parseCategories(raw) {
  if (raw === undefined || raw === null) return { categories: [] };
  if (!Array.isArray(raw)) return { error: 'Invalid category' };
  const categories = [...new Set(raw)];
  if (categories.some((c) => !CATEGORIES.includes(c))) return { error: 'Invalid category' };
  return { categories: CATEGORIES.filter((c) => categories.includes(c)) };
}

// Who's interested (the joins list) is only ever shown to the post's own
// owner or an admin — same trust boundary as phone/email elsewhere (see
// stripPrivateFields in auth.js), just applied to "who wants to play with
// you" instead of contact details. Everyone else only sees joinCount.
function serializePost(row, req) {
  const player = getPlayer(row.player_id);
  const viewerPlayerId = getPlayerId(req);
  const isMine = viewerPlayerId === row.player_id;
  const joinCount = db.prepare('SELECT COUNT(*) AS c FROM availability_joins WHERE post_id = ?').get(row.id).c;
  const joinedByMe = viewerPlayerId
    ? !!db.prepare('SELECT 1 FROM availability_joins WHERE post_id = ? AND player_id = ?').get(row.id, viewerPlayerId)
    : false;

  const payload = {
    id: row.id,
    player: player ? {
      id: player.id, name: player.name, slug: player.slug, photoUrl: player.photo_url,
    } : null,
    slots: JSON.parse(row.days),
    categories: JSON.parse(row.categories || '[]'),
    location: row.location,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    joinCount,
    joinedByMe,
    mine: isMine,
  };

  if (isMine || isAdmin(req)) {
    const joins = db.prepare(`
      SELECT slot, message, created_at, player_id FROM availability_joins
      WHERE post_id = ? ORDER BY created_at ASC
    `).all(row.id);
    payload.joins = joins.map((j) => ({
      player: stripPrivateFields(getPlayer(j.player_id), req),
      slot: j.slot,
      message: j.message,
      createdAt: j.created_at,
    }));
  }

  return payload;
}

// Public board — anyone can browse who's looking for a match, same as
// every other read in this app (matches, players, rankings); only posting
// and joining require being logged in as a specific player.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM availability_posts ORDER BY created_at DESC').all();
  res.json(rows.map((row) => serializePost(row, req)));
});

// Upsert: a player only ever has one active post (idx_availability_posts_player
// enforces this at the DB level too), so posting again while one already
// exists just updates it in place — the natural way to edit your own
// availability, without a separate PATCH route.
router.post('/', requirePlayerIdentity, (req, res) => {
  const playerId = getPlayerId(req);

  const { slots, error } = parseSlots(req.body.slots);
  if (error) return res.status(400).json({ error });
  const { categories, error: categoryError } = parseCategories(req.body.categories);
  if (categoryError) return res.status(400).json({ error: categoryError });

  const location = typeof req.body.location === 'string' ? req.body.location.trim().slice(0, MAX_LOCATION_LEN) : '';
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, MAX_NOTE_LEN) : '';
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM availability_posts WHERE player_id = ?').get(playerId);
  if (existing) {
    db.prepare(`
      UPDATE availability_posts SET days = ?, categories = ?, location = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(slots), JSON.stringify(categories), location, note, now, existing.id);
    return res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(existing.id), req));
  }

  const info = db.prepare(`
    INSERT INTO availability_posts (player_id, days, categories, location, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(playerId, JSON.stringify(slots), JSON.stringify(categories), location, note);
  res.status(201).json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(info.lastInsertRowid), req));
});

// "Closing" a post is just deleting it — no history worth keeping here,
// unlike a match. Cascades to its joins explicitly since node:sqlite
// doesn't enforce real FK cascades (see the PRAGMA foreign_keys note in
// db.js). Gated by requireLoggedIn (admin OR a specific player), not the
// stricter requirePlayerIdentity above — an admin needs to be able to
// close someone else's post for moderation, which canManagePost below
// already allows, but requirePlayerIdentity would reject that pure-admin
// session before canManagePost ever got a chance to run.
router.delete('/:id', requireLoggedIn, (req, res) => {
  const row = db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (!canManagePost(req, row)) return res.status(403).json({ error: 'You can only close your own post' });

  db.prepare('DELETE FROM availability_joins WHERE post_id = ?').run(row.id);
  db.prepare('DELETE FROM availability_posts WHERE id = ?').run(row.id);
  res.status(204).end();
});

// The actual "someone wants to play" handshake: the visitor picks one of
// the post owner's own marked times (mirrors POST /:token/respond-proposal
// in routes/matches.js — same "slot must be one of the offered options"
// validation) and that becomes their join. Re-picking (a second call with
// a different slot) updates this same row rather than inserting a second
// one — the UNIQUE(post_id, player_id) constraint is what makes that an
// UPDATE instead of a failure — and only a genuinely new join or an
// actually-changed slot re-emails the owner, so re-confirming the same
// pick twice (a double-click) never double-notifies them.
router.post('/:id/join', requirePlayerIdentity, async (req, res) => {
  const row = db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });

  const playerId = getPlayerId(req);
  if (row.player_id === playerId) return res.status(400).json({ error: "That's your own post" });

  const { slot } = req.body;
  if (typeof slot !== 'string' || !JSON.parse(row.days).includes(slot)) {
    return res.status(400).json({ error: 'Pick one of the times this player marked as free' });
  }
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';

  const existingJoin = db.prepare('SELECT * FROM availability_joins WHERE post_id = ? AND player_id = ?').get(row.id, playerId);
  const changed = !existingJoin || existingJoin.slot !== slot;
  if (existingJoin) {
    db.prepare('UPDATE availability_joins SET slot = ?, message = ? WHERE id = ?').run(slot, message, existingJoin.id);
  } else {
    db.prepare('INSERT INTO availability_joins (post_id, player_id, slot, message) VALUES (?, ?, ?, ?)').run(row.id, playerId, slot, message);
  }

  if (changed) {
    const owner = getPlayer(row.player_id);
    const joiner = getPlayer(playerId);
    if (owner && owner.email && joiner) {
      try {
        await sendPlayRequestEmail(owner, joiner, slot, message);
      } catch (err) {
        console.error('[availability] play-request email failed:', err.message);
      }
    }
  }

  res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(row.id), req));
});

module.exports = router;
