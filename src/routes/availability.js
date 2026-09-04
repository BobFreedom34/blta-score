const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const engine = require('../matchEngine');
const {
  isAdmin, getPlayerId, stripPrivateFields, requireLoggedIn,
} = require('../auth');
const { sendPlayRequestEmail, sendPlayRequestAcceptedEmail, sendPlayRequestDeniedEmail } = require('../mailer');

const router = express.Router();

const MAX_LOCATION_LEN = 120;
const MAX_NOTE_LEN = 300;
const MAX_MESSAGE_LEN = 300;
const MAX_DENY_REASON_LEN = 300;
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
// A tennis match runs a couple of hours — accepting a request blocks not
// just the picked half-hour slot but this whole window after it too (see
// blockedRangeIsos below), so the owner's calendar (and everyone else's
// view of it) doesn't keep offering a time they're now actually busy.
const MATCH_BLOCK_HOURS = 2;
// Auto-created matches (see the /accept route) don't go through the "New
// match" form, which is where a format would normally be picked — best
// of 3 sets is that form's own first/default option, so it's what a
// friendly match here gets too.
const DEFAULT_MATCH_FORMAT = 'BO3';

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

// Every half-hour mark from `slotIso` through MATCH_BLOCK_HOURS after it —
// the window an accepted request actually occupies, not just its own
// single half-hour cell.
function blockedRangeIsos(slotIso) {
  const start = new Date(slotIso).getTime();
  const isos = [];
  for (let mins = 0; mins < MATCH_BLOCK_HOURS * 60; mins += 30) {
    isos.push(new Date(start + mins * 60000).toISOString());
  }
  return isos;
}

// One entry per half-hour cell an ACCEPTED join occupies, each naming who
// the resulting match is with — the match itself is already public (it's
// a normal FRIENDLY match on the main matches list), so there's no reason
// to hide who it's with here either, unlike the pending joins list below.
function getBlockedSlots(postId) {
  const accepted = db.prepare(`
    SELECT slot, player_id, match_token FROM availability_joins
    WHERE post_id = ? AND status = 'ACCEPTED'
  `).all(postId);
  const byIso = new Map();
  accepted.forEach((j) => {
    const opponent = getPlayer(j.player_id);
    blockedRangeIsos(j.slot).forEach((iso) => {
      byIso.set(iso, {
        iso,
        opponentName: opponent ? opponent.name : null,
        opponentSlug: opponent ? opponent.slug : null,
        matchToken: j.match_token,
      });
    });
  });
  return [...byIso.values()];
}

// Who's interested (the joins list) is only ever shown to the post's own
// owner or an admin — same trust boundary as phone/email elsewhere (see
// stripPrivateFields in auth.js), just applied to "who wants to play with
// you" instead of contact details. Everyone else only sees joinCount
// (PENDING requests only — accepted/denied ones are already resolved) and
// blockedSlots (see getBlockedSlots above, public since the match it
// represents already is).
function serializePost(row, req) {
  const player = getPlayer(row.player_id);
  const viewerPlayerId = getPlayerId(req);
  const isMine = viewerPlayerId === row.player_id;
  const joinCount = db.prepare("SELECT COUNT(*) AS c FROM availability_joins WHERE post_id = ? AND status = 'PENDING'").get(row.id).c;
  const joinedByMe = viewerPlayerId
    ? !!db.prepare("SELECT 1 FROM availability_joins WHERE post_id = ? AND player_id = ? AND status IN ('PENDING','ACCEPTED')").get(row.id, viewerPlayerId)
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
    blockedSlots: getBlockedSlots(row.id),
  };

  if (isMine || isAdmin(req)) {
    const joins = db.prepare(`
      SELECT slot, message, status, deny_reason, match_token, created_at, player_id FROM availability_joins
      WHERE post_id = ? ORDER BY created_at ASC
    `).all(row.id);
    payload.joins = joins.map((j) => ({
      player: stripPrivateFields(getPlayer(j.player_id), req),
      slot: j.slot,
      message: j.message,
      status: j.status,
      denyReason: j.deny_reason,
      matchToken: j.match_token,
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
  const blockedIsos = new Set(getBlockedSlots(row.id).map((b) => b.iso));
  if (typeof slot !== 'string' || !JSON.parse(row.days).includes(slot)) {
    return res.status(400).json({ error: 'Pick one of the times this player marked as free' });
  }
  if (blockedIsos.has(slot)) {
    return res.status(409).json({ error: 'That time is no longer available' });
  }
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';

  const existingJoin = db.prepare('SELECT * FROM availability_joins WHERE post_id = ? AND player_id = ?').get(row.id, playerId);
  if (existingJoin && existingJoin.status === 'ACCEPTED') {
    return res.status(409).json({ error: 'You already have a confirmed match with this player' });
  }
  const changed = !existingJoin || existingJoin.slot !== slot || existingJoin.status === 'DENIED';
  if (existingJoin) {
    // Re-picking after a denial reopens the request (fresh PENDING, old
    // reason cleared) rather than leaving it stuck showing "Denied" —
    // the owner sees it as a new ask, same as if this were their first.
    db.prepare("UPDATE availability_joins SET slot = ?, message = ?, status = 'PENDING', deny_reason = '' WHERE id = ?").run(slot, message, existingJoin.id);
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

// Only the post's own owner (or admin, for moderation/assistance) ever
// gets to accept or deny — requireLoggedIn (not requirePlayerIdentity)
// for the same reason DELETE /:id uses it above: a pure admin session has
// no player cookie for canManagePost to match against a specific player,
// so the stricter gate would wrongly turn them away before that check
// ever ran.
function loadPendingJoin(req, res) {
  const row = db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Post not found' }); return null; }
  if (!canManagePost(req, row)) { res.status(403).json({ error: 'Only the post owner can respond to this' }); return null; }
  const join = db.prepare('SELECT * FROM availability_joins WHERE post_id = ? AND player_id = ?').get(row.id, req.params.playerId);
  if (!join) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (join.status !== 'PENDING') { res.status(409).json({ error: 'This request was already responded to' }); return null; }
  return { row, join };
}

// Accepting is the whole point of this board: it turns a picked time into
// a real match. Same FRIENDLY/PLANNED shape POST /matches itself would
// create (share_token, empty history, initial engine state), just built
// here instead of going through that route, since the two players and
// the time are already settled — there's no form left to fill in.
router.post('/:id/joins/:playerId/accept', requireLoggedIn, async (req, res) => {
  const loaded = loadPendingJoin(req, res);
  if (!loaded) return;
  const { row, join } = loaded;

  if (new Set(getBlockedSlots(row.id).map((b) => b.iso)).has(join.slot)) {
    return res.status(409).json({ error: 'This time already has a confirmed match' });
  }

  const owner = getPlayer(row.player_id);
  const joiner = getPlayer(join.player_id);
  if (!owner || !joiner) return res.status(400).json({ error: 'One of the players no longer exists' });

  const shareToken = crypto.randomUUID();
  const state = engine.initState(DEFAULT_MATCH_FORMAT);
  db.prepare(`
    INSERT INTO matches (share_token, category, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, created_by_player_id)
    VALUES (?, 'FRIENDLY', ?, ?, ?, ?, ?, 'PLANNED', ?, '[]', ?, ?)
  `).run(
    shareToken, row.player_id, join.player_id, row.location || '', join.slot, DEFAULT_MATCH_FORMAT,
    JSON.stringify(state), isAdmin(req) ? 1 : 0, isAdmin(req) ? null : row.player_id,
  );
  db.prepare("UPDATE availability_joins SET status = 'ACCEPTED', match_token = ? WHERE id = ?").run(shareToken, join.id);

  if (joiner.email) {
    try {
      await sendPlayRequestAcceptedEmail(owner, joiner, join.slot, shareToken);
    } catch (err) {
      console.error('[availability] accept email failed:', err.message);
    }
  }

  res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(row.id), req));
});

// Denying always requires a reason — unlike accepting, there's no
// automatic action to fall back on, so the requester's only way to find
// out anything beyond "no" is whatever the owner writes here.
router.post('/:id/joins/:playerId/deny', requireLoggedIn, async (req, res) => {
  const loaded = loadPendingJoin(req, res);
  if (!loaded) return;
  const { row, join } = loaded;

  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, MAX_DENY_REASON_LEN) : '';
  if (!reason) return res.status(400).json({ error: 'Explain why you’re declining' });

  db.prepare("UPDATE availability_joins SET status = 'DENIED', deny_reason = ? WHERE id = ?").run(reason, join.id);

  const owner = getPlayer(row.player_id);
  const joiner = getPlayer(join.player_id);
  if (owner && joiner && joiner.email) {
    try {
      await sendPlayRequestDeniedEmail(owner, joiner, reason);
    } catch (err) {
      console.error('[availability] deny email failed:', err.message);
    }
  }

  res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(row.id), req));
});

module.exports = router;
