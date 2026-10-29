// Správy / Messages: private one-to-one chats between logged-in players. See docs/superpowers/specs/2026-10-28-messages-design.md.
// Every route needs a player (an admin without a player cookie is not one); a conversation answers 404 to anybody who is not a member of it.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const messages = require('../messages');
const playerPush = require('../playerPush');

const router = express.Router();
const { directKey, areConnected, isBlocked, memberOf, otherPlayer, card, rateLimitOk, serializeMessage, cleanBody } = messages;
const PAGE = 30;
const membersOf = (conversationId) => db.prepare('SELECT player_id FROM conversation_members WHERE conversation_id = ?').all(conversationId).map((r) => r.player_id);

const MAX_REQUESTS_PER_DAY = 20;
const REQUEST_ALLOWANCE = 3;

// the logged-in player or a 401
function needPlayer(req, res) {
  const playerId = auth.getPlayerId(req);
  // a valid cookie of a player who has been deleted since is nobody
  if (!playerId || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) {
    res.status(401).json({ error: 'Please log in as a player to do this' });
    return null;
  }
  return playerId;
}

const playerRow = (id) => db.prepare('SELECT id, name, slug, photo_url, league_id, phone FROM players WHERE id = ?').get(id);

// the conversation of the address, only for a member of it - otherwise 404 (the same answer for "not yours" and "not there")
function conversationOr404(req, res, playerId) {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : 0;
  const member = memberOf(id, playerId);
  const conversation = member && db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return null;
  }
  return { conversation, member };
}

// how many messages the sender may still send while the other side has not accepted (null = not waiting for an acceptance)
function requestAllowanceLeft(conversationId, playerId) {
  const other = db.prepare('SELECT player_id, state FROM conversation_members WHERE conversation_id = ? AND player_id != ?').get(conversationId, playerId);
  if (!other || other.state !== 'REQUEST') return null;
  const sent = db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE conversation_id = ? AND sender_player_id = ?').get(conversationId, playerId).n;
  return Math.max(0, REQUEST_ALLOWANCE - sent);
}

function conversationJson(conversation, member, playerId) {
  const allowance = requestAllowanceLeft(conversation.id, playerId);
  return {
    id: conversation.id,
    other: otherPlayer(conversation.id, playerId),
    state: member.state,
    canWrite: allowance === null || allowance > 0,
    requestAllowanceLeft: allowance,
  };
}

// start (or find) the direct conversation with a player; the other side gets a REQUEST unless he is connected to the sender
router.post('/conversations', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const otherId = Number.isInteger(req.body.playerId) ? req.body.playerId : NaN;
  if (!Number.isInteger(otherId) || otherId <= 0) return res.status(400).json({ error: 'playerId must be a number' });
  if (otherId === me) return res.status(400).json({ error: 'You cannot message yourself' });
  const mine = playerRow(me);
  const other = playerRow(otherId);
  // only a player who can log in (a phone on file) can be written to, like the search offers; the same city only
  if (!mine || !other || !other.phone || mine.league_id !== other.league_id) return res.status(404).json({ error: 'Player not found' });
  if (isBlocked(me, otherId)) return res.status(403).json({ error: "You can't message this player" });
  const key = directKey(me, otherId);
  const existing = db.prepare('SELECT id FROM conversations WHERE direct_key = ?').get(key);
  if (existing) return res.json({ id: existing.id });
  const asRequest = !areConnected(me, otherId);
  if (asRequest) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    // counted from a log of its own: a request that was declined (and so deleted) must still count
    const n = db.prepare('SELECT COUNT(*) AS n FROM message_request_log WHERE player_id = ? AND created_at >= ?').get(me, since).n;
    if (n >= MAX_REQUESTS_PER_DAY) return res.status(429).json({ error: `You can start at most ${MAX_REQUESTS_PER_DAY} new conversations with strangers per day` });
  }
  let id;
  db.exec('BEGIN');
  try {
    const info = db.prepare("INSERT INTO conversations (type, direct_key, created_by_player_id, started_as_request) VALUES ('DIRECT', ?, ?, ?)").run(key, me, asRequest ? 1 : 0);
    id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO conversation_members (conversation_id, player_id, state) VALUES (?, ?, 'MAIN')").run(id, me);
    db.prepare('INSERT INTO conversation_members (conversation_id, player_id, state) VALUES (?, ?, ?)').run(id, otherId, asRequest ? 'REQUEST' : 'MAIN');
    if (asRequest) db.prepare('INSERT INTO message_request_log (player_id) VALUES (?)').run(me);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    // the other side started it at the same moment: join that conversation instead of making a second one
    const raced = db.prepare('SELECT id FROM conversations WHERE direct_key = ?').get(key);
    if (raced) return res.json({ id: raced.id });
    throw err;
  }
  res.status(201).json({ id });
});

router.get('/conversations/:id', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found) return;
  res.json(conversationJson(found.conversation, found.member, me));
});

// find a player to write to: names only, the same city, never himself, never a blocked player, only players who can log in (a phone on file)
router.get('/players', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ items: [] });
  const mine = playerRow(me);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  // blocked players (either way) are left out in the query itself, so a long list of blocked names cannot leave the result short
  const rows = db.prepare(`
    SELECT p.id, p.name, p.slug, p.photo_url FROM players p
    WHERE p.league_id = ? AND p.id != ? AND p.phone IS NOT NULL AND p.phone != '' AND p.name LIKE ? ESCAPE '\\'
      AND NOT EXISTS (SELECT 1 FROM message_blocks b WHERE (b.blocker_player_id = ? AND b.blocked_player_id = p.id) OR (b.blocker_player_id = p.id AND b.blocked_player_id = ?))
    ORDER BY p.name COLLATE NOCASE LIMIT 20
  `).all(mine.league_id, me, like, me, me);
  res.json({ items: rows.map(card) });
});

// ---------------- the inbox and the unread counts ----------------

const lastMessageOf = (conversationId) => db.prepare('SELECT * FROM direct_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId);
const unreadIn = (conversationId, playerId, lastRead) => db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE conversation_id = ? AND id > ? AND sender_player_id != ?').get(conversationId, lastRead, playerId).n;

// the conversations of the caller in a box (main, requests), newest first; a conversation with no message yet is not listed
router.get('/conversations', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const state = req.query.box === 'requests' ? 'REQUEST' : 'MAIN';
  const rows = db.prepare(`
    SELECT c.id, m.state, m.last_read_message_id FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.player_id = ? AND m.state = ? AND EXISTS (SELECT 1 FROM direct_messages d WHERE d.conversation_id = c.id)
  `).all(me, state);
  const items = rows.map((r) => {
    const last = lastMessageOf(r.id);
    return {
      id: r.id,
      other: otherPlayer(r.id, me),
      state: r.state,
      lastMessage: { body: last.body, createdAt: last.created_at, mine: last.sender_player_id === me },
      unread: unreadIn(r.id, me, r.last_read_message_id),
      _last: last.id,
    };
  }).sort((a, b) => b._last - a._last).map(({ _last, ...item }) => item);
  res.json({ items });
});

// the number of conversations with something unread in Main, and the number of requests that wait for the caller
router.get('/unread', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  res.json(unreadCounts(me));
});

function unreadCounts(playerId) {
  const rows = db.prepare(`
    SELECT c.id, m.state, m.last_read_message_id FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.player_id = ? AND m.state IN ('MAIN', 'REQUEST') AND EXISTS (SELECT 1 FROM direct_messages d WHERE d.conversation_id = c.id)
  `).all(playerId);
  return {
    main: rows.filter((r) => r.state === 'MAIN' && unreadIn(r.id, playerId, r.last_read_message_id) > 0).length,
    requests: rows.filter((r) => r.state === 'REQUEST').length,
  };
}

// ---------------- messages ----------------

router.get('/conversations/:id/messages', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found) return;
  const before = /^\d+$/.test(String(req.query.before || '')) ? Number(req.query.before) : null;
  const rows = db.prepare(`SELECT * FROM direct_messages WHERE conversation_id = ?${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ${PAGE + 1}`).all(...(before ? [found.conversation.id, before] : [found.conversation.id]));
  res.json({ items: rows.slice(0, PAGE).reverse().map((r) => serializeMessage(r, me)), more: rows.length > PAGE });
});

router.post('/conversations/:id/messages', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found) return;
  const other = db.prepare('SELECT player_id FROM conversation_members WHERE conversation_id = ? AND player_id != ?').get(found.conversation.id, me);
  if (!other || isBlocked(me, other.player_id)) return res.status(403).json({ error: "You can't message this player" });
  const body = cleanBody(req.body.body);
  if (body === null) return res.status(400).json({ error: 'A message is 1 to 2000 characters' });
  const allowance = requestAllowanceLeft(found.conversation.id, me);
  if (allowance !== null && allowance <= 0) return res.status(409).json({ error: 'Wait until they answer or accept your request before you write more' });
  if (!rateLimitOk(me)) return res.status(429).json({ error: 'You are writing too fast, wait a moment' });
  const info = db.prepare('INSERT INTO direct_messages (conversation_id, sender_player_id, body) VALUES (?, ?, ?)').run(found.conversation.id, me, body);
  const row = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(Number(info.lastInsertRowid));
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(row.created_at, found.conversation.id);
  // the sender has seen his own message; an answer by the recipient of a request accepts it
  db.prepare('UPDATE conversation_members SET last_read_message_id = ?, state = CASE WHEN state = \'REQUEST\' THEN \'MAIN\' ELSE state END WHERE conversation_id = ? AND player_id = ?').run(row.id, found.conversation.id, me);
  const io = req.app.get('io');
  const memberIds = membersOf(found.conversation.id);
  memberIds.forEach((id) => {
    messages.emitToPlayers(io, [id], 'dm:message', {
      conversationId: found.conversation.id,
      message: { id: row.id, body: row.body, createdAt: row.created_at, senderPlayerId: me },
      other: otherPlayer(found.conversation.id, id),
    });
    messages.emitToPlayers(io, [id], 'dm:unread', unreadCounts(id));
  });
  // the other member's devices get it as a push (a push never blocks or fails the send)
  playerPush.notifyPlayer(other.player_id, 'DM', { fromName: (playerRow(me) || {}).name, body: row.body, conversationId: found.conversation.id });
  res.status(201).json(serializeMessage(row, me));
});

router.post('/conversations/:id/read', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found) return;
  const last = lastMessageOf(found.conversation.id);
  if (last) db.prepare('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND player_id = ?').run(last.id, found.conversation.id, me);
  messages.emitToPlayers(req.app.get('io'), [me], 'dm:unread', unreadCounts(me));
  res.json({ ok: true });
});

// ---------------- requests: accept or decline ----------------

router.post('/conversations/:id/accept', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found || found.member.state !== 'REQUEST') return found ? res.status(404).json({ error: 'Conversation not found' }) : undefined;
  db.prepare("UPDATE conversation_members SET state = 'MAIN' WHERE conversation_id = ? AND player_id = ?").run(found.conversation.id, me);
  messages.emitToPlayers(req.app.get('io'), [me], 'dm:unread', unreadCounts(me));
  res.json({ ok: true });
});

// declining deletes the conversation (for both) and blocks the sender
router.post('/conversations/:id/decline', (req, res) => {
  const me = needPlayer(req, res);
  if (!me) return;
  const found = conversationOr404(req, res, me);
  if (!found || found.member.state !== 'REQUEST') return found ? res.status(404).json({ error: 'Conversation not found' }) : undefined;
  const sender = db.prepare('SELECT player_id FROM conversation_members WHERE conversation_id = ? AND player_id != ?').get(found.conversation.id, me);
  db.exec('BEGIN');
  try {
    deleteConversation(found.conversation.id);
    if (sender) db.prepare('INSERT OR IGNORE INTO message_blocks (blocker_player_id, blocked_player_id) VALUES (?, ?)').run(me, sender.player_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const io = req.app.get('io');
  messages.emitToPlayers(io, [me, sender && sender.player_id].filter(Boolean), 'dm:removed', { conversationId: found.conversation.id });
  messages.emitToPlayers(io, [me], 'dm:unread', unreadCounts(me));
  res.json({ ok: true });
});

function deleteConversation(id) {
  db.prepare('DELETE FROM direct_messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

module.exports = router;
module.exports.needPlayer = needPlayer;
module.exports.unreadCounts = unreadCounts;
module.exports.deleteConversation = deleteConversation;
module.exports.conversationOr404 = conversationOr404;
module.exports.conversationJson = conversationJson;
module.exports.requestAllowanceLeft = requestAllowanceLeft;
module.exports.REQUEST_ALLOWANCE = REQUEST_ALLOWANCE;
