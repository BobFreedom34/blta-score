const db = require('../../db');
const { getPlayerId, requireLoggedIn } = require('../../auth');
const playerPush = require('../../playerPush');
const router = require('./router');
const { getRowOr404, EMAIL_RE, getPlayer, nowIso, playerIdsOf } = require('./shared');

// Subscribe an email address to a one-time notification for when this
// specific match starts or finishes.
router.post('/:token/notify-me', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const email = String(req.body.email || '').trim().toLowerCase();
  const type = req.body.type;
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!['START', 'FINISH'].includes(type)) {
    return res.status(400).json({ error: 'Invalid notification type' });
  }
  if (row.status === 'FINISHED') {
    return res.status(400).json({ error: 'This match has already finished' });
  }
  if (type === 'START' && row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'This match has already started' });
  }
  try {
    db.prepare('INSERT INTO match_notifications (match_id, email, type) VALUES (?, ?, ?)').run(row.id, email, type);
  } catch (err) {
    if (!/UNIQUE/.test(err.message)) throw err;
    // Already subscribed with this email — treat as success, not an error.
  }
  res.status(201).json({ subscribed: true });
});

// Same as /notify-me above, but for a browser push subscription instead of
// an email address.
router.post('/:token/push-subscribe', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const subscription = req.body.subscription;
  const type = req.body.type;
  if (!subscription || typeof subscription.endpoint !== 'string') {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  if (!['START', 'FINISH'].includes(type)) {
    return res.status(400).json({ error: 'Invalid notification type' });
  }
  if (row.status === 'FINISHED') {
    return res.status(400).json({ error: 'This match has already finished' });
  }
  if (type === 'START' && row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'This match has already started' });
  }
  try {
    db.prepare('INSERT INTO push_subscriptions (match_id, subscription, type) VALUES (?, ?, ?)').run(row.id, JSON.stringify(subscription), type);
  } catch (err) {
    if (!/UNIQUE/.test(err.message)) throw err;
    // Already subscribed with this device — treat as success, not an error.
  }
  res.status(201).json({ subscribed: true });
});

// a message carries the face of its author (photo and profile address) like a comment in the communities; the name is how it was written, so the player is found by it ("Admin" has none)
function serializeMessage(row) {
  const who = db.prepare('SELECT slug, photo_url FROM players WHERE name = ? COLLATE NOCASE').get(row.author);
  return { id: row.id, author: row.author, authorSlug: who ? who.slug : null, authorPhotoUrl: who && who.photo_url ? who.photo_url : null, body: row.body, createdAt: row.created_at };
}

router.get('/:token/messages', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const messages = db.prepare('SELECT * FROM messages WHERE match_id = ? ORDER BY id ASC').all(row.id);
  res.json(messages.map(serializeMessage));
});

// Anyone can read a match's chat, but only a logged-in player or an admin can write in it. The author's name is never taken from the
// request: it is the logged-in player's own name ("Admin" for an admin who is not also logged in as a player).
router.post('/:token/messages', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const posterId = getPlayerId(req);
  const poster = posterId ? getPlayer(posterId) : null;
  const author = poster ? poster.name : 'Admin';
  const body = String(req.body.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

  const ts = nowIso();
  const result = db.prepare('INSERT INTO messages (match_id, author, body, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id, author, body, ts);
  const message = serializeMessage({ id: result.lastInsertRowid, author, body, created_at: ts });

  // The writer is skipped when they are one of the two players (they just wrote it); an admin who is not one of them notifies both.
  const notifyChat = db.prepare(
    'INSERT INTO chat_notifications (player_id, match_id, message_id, seen) VALUES (?, ?, ?, 0)'
  );
  playerIdsOf(row)
    .filter((playerId) => playerId !== posterId)
    .forEach((playerId) => {
      notifyChat.run(playerId, row.id, result.lastInsertRowid);
      playerPush.notifyPlayer(playerId, 'CHAT', { fromName: author, body, matchToken: row.share_token });
    });

  req.app.get('io').to(`match:${row.share_token}`).emit('message:new', { token: row.share_token, message });
  res.status(201).json(message);
});
