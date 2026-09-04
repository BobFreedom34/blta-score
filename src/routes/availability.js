const express = require('express');
const db = require('../db');
const { isAdmin, getPlayerId, stripPrivateFields } = require('../auth');
const { sendPlayRequestEmail } = require('../mailer');

const router = express.Router();

const MAX_LOCATION_LEN = 120;
const MAX_NOTE_LEN = 300;
const MAX_MESSAGE_LEN = 300;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    days: JSON.parse(row.days),
    timeFrom: row.time_from,
    timeTo: row.time_to,
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
      SELECT message, created_at, player_id FROM availability_joins
      WHERE post_id = ? ORDER BY created_at ASC
    `).all(row.id);
    payload.joins = joins.map((j) => ({
      player: stripPrivateFields(getPlayer(j.player_id), req),
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

  const days = Array.isArray(req.body.days)
    ? [...new Set(req.body.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
    : [];
  if (days.length === 0) return res.status(400).json({ error: 'Select at least one day' });

  let timeFrom = null;
  let timeTo = null;
  if (req.body.timeFrom) {
    if (!TIME_RE.test(req.body.timeFrom)) return res.status(400).json({ error: 'Invalid start time' });
    timeFrom = req.body.timeFrom;
  }
  if (req.body.timeTo) {
    if (!TIME_RE.test(req.body.timeTo)) return res.status(400).json({ error: 'Invalid end time' });
    timeTo = req.body.timeTo;
  }
  if (timeFrom && timeTo && timeFrom >= timeTo) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  const location = typeof req.body.location === 'string' ? req.body.location.trim().slice(0, MAX_LOCATION_LEN) : '';
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, MAX_NOTE_LEN) : '';
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM availability_posts WHERE player_id = ?').get(playerId);
  if (existing) {
    db.prepare(`
      UPDATE availability_posts SET days = ?, time_from = ?, time_to = ?, location = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(days), timeFrom, timeTo, location, note, now, existing.id);
    return res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(existing.id), req));
  }

  const info = db.prepare(`
    INSERT INTO availability_posts (player_id, days, time_from, time_to, location, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(playerId, JSON.stringify(days), timeFrom, timeTo, location, note);
  res.status(201).json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(info.lastInsertRowid), req));
});

// "Closing" a post is just deleting it — no history worth keeping here,
// unlike a match. Cascades to its joins explicitly since node:sqlite
// doesn't enforce real FK cascades (see the PRAGMA foreign_keys note in
// db.js).
router.delete('/:id', requirePlayerIdentity, (req, res) => {
  const row = db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  if (!canManagePost(req, row)) return res.status(403).json({ error: 'You can only close your own post' });

  db.prepare('DELETE FROM availability_joins WHERE post_id = ?').run(row.id);
  db.prepare('DELETE FROM availability_posts WHERE id = ?').run(row.id);
  res.status(204).end();
});

// The actual "someone wants to play" handshake: records the join (silently
// idempotent — see the UNIQUE(post_id, player_id) catch below, so a
// double-click never double-emails the owner) and, if they have an email
// on file, sends it. Missing/failed email never fails the request itself —
// the join is recorded and visible in-app (see serializePost's `joins`)
// regardless of whether the email actually went out.
router.post('/:id/join', requirePlayerIdentity, async (req, res) => {
  const row = db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });

  const playerId = getPlayerId(req);
  if (row.player_id === playerId) return res.status(400).json({ error: "That's your own post" });

  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, MAX_MESSAGE_LEN) : '';

  let isNewJoin = true;
  try {
    db.prepare('INSERT INTO availability_joins (post_id, player_id, message) VALUES (?, ?, ?)').run(row.id, playerId, message);
  } catch (err) {
    if (!/UNIQUE/.test(err.message)) throw err;
    isNewJoin = false;
  }

  if (isNewJoin) {
    const owner = getPlayer(row.player_id);
    const joiner = getPlayer(playerId);
    if (owner && owner.email && joiner) {
      try {
        await sendPlayRequestEmail(owner, joiner, message);
      } catch (err) {
        console.error('[availability] play-request email failed:', err.message);
      }
    }
  }

  res.json(serializePost(db.prepare('SELECT * FROM availability_posts WHERE id = ?').get(row.id), req));
});

module.exports = router;
