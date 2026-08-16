const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const engine = require('../matchEngine');
const { sendMatchFinishedEmail } = require('../mailer');
const { isAdmin } = require('../auth');

const router = express.Router();

const MAX_HISTORY = 30;
const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE', 'FRIENDLY'];

function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function serialize(row) {
  const p1 = getPlayer(row.player1_id);
  const p2 = getPlayer(row.player2_id);
  const state = JSON.parse(row.state);
  const history = JSON.parse(row.history);
  return {
    token: row.share_token,
    category: row.category,
    location: row.location,
    notes: row.notes || '',
    scheduledAt: row.scheduled_at,
    format: row.format,
    formatLabel: engine.FORMATS[row.format] ? engine.FORMATS[row.format].label : row.format,
    status: row.status,
    state,
    scoreSummary: engine.describeMatch(state),
    canUndo: history.length > 0,
    createdByAdmin: !!row.created_by_admin,
    winnerId: row.winner_id,
    startTime: row.start_time,
    endTime: row.end_time,
    pausedAt: row.paused_at,
    pausedSeconds: row.paused_seconds || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    player1: p1,
    player2: p2,
  };
}

function getRowOr404(req, res) {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return row;
}

function nowIso() {
  return new Date().toISOString();
}

function deriveWinnerId(state, row) {
  return state.winner === 1 ? row.player1_id : state.winner === 2 ? row.player2_id : null;
}

function broadcast(req, row) {
  const io = req.app.get('io');
  const payload = serialize(row);
  io.to(`match:${row.share_token}`).emit('match:update', payload);
  io.emit('matches:changed', { token: row.share_token, status: row.status });
  return payload;
}

router.get('/', (req, res) => {
  const { status, category, q, from, to, noDate } = req.query;
  const clauses = [];
  const params = {};
  if (status) {
    clauses.push('m.status = @status');
    params.status = status;
  }
  if (category) {
    clauses.push('m.category = @category');
    params.category = category;
  }
  if (q) {
    clauses.push('(p1.name LIKE @q OR p2.name LIKE @q)');
    params.q = `%${q}%`;
  }
  if (noDate === '1') {
    clauses.push('m.scheduled_at IS NULL');
  } else if (from && to) {
    clauses.push('m.scheduled_at BETWEEN @from AND @to');
    params.from = from;
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  // Planned matches: soonest-scheduled first, undated ones grouped at the end
  // (the frontend divides the two groups with a visual line).
  const orderBy = status === 'PLANNED'
    ? 'ORDER BY (m.scheduled_at IS NULL) ASC, m.scheduled_at ASC, m.created_at DESC'
    : `ORDER BY
        CASE m.status WHEN 'LIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
        COALESCE(m.scheduled_at, m.created_at) DESC`;
  const rows = db.prepare(`
    SELECT m.* FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    ${where}
    ${orderBy}
  `).all(params);
  res.json(rows.map(serialize));
});

router.get('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json(serialize(row));
});

router.post('/', (req, res) => {
  const { category, location, scheduledAt, format, notes } = req.body;
  let { player1Id, player2Id, player1Name, player2Name } = req.body;

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!engine.FORMATS[format]) {
    return res.status(400).json({ error: 'Invalid match format' });
  }
  if (typeof notes === 'string' && notes.length > 1000) {
    return res.status(400).json({ error: 'Additional info is too long (max 1000 characters)' });
  }

  const resolvePlayer = (id, name) => {
    if (id) return getPlayer(id);
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(trimmed);
    if (existing) return existing;
    const info = db.prepare('INSERT INTO players (name) VALUES (?)').run(trimmed);
    return getPlayer(info.lastInsertRowid);
  };

  const p1 = resolvePlayer(player1Id, player1Name);
  const p2 = resolvePlayer(player2Id, player2Name);
  if (!p1 || !p2) return res.status(400).json({ error: 'Both players are required' });
  if (p1.id === p2.id) return res.status(400).json({ error: 'Players must be different' });

  const state = engine.initState(format);
  const info = db.prepare(`
    INSERT INTO matches (share_token, category, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (@share_token, @category, @player1_id, @player2_id, @location, @scheduled_at, @format, 'PLANNED', @state, '[]', @created_by_admin, @notes)
  `).run({
    share_token: crypto.randomUUID(),
    category,
    player1_id: p1.id,
    player2_id: p2.id,
    location: (location || '').trim(),
    scheduled_at: scheduledAt || null,
    format,
    state: JSON.stringify(state),
    created_by_admin: isAdmin(req) ? 1 : 0,
    notes: (notes || '').trim(),
  });

  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(info.lastInsertRowid);
  const payload = broadcast(req, row);
  res.status(201).json(payload);
});

router.patch('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status === 'FINISHED' && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only an admin can edit a finished match' });
  }

  const fields = {};
  if (typeof req.body.location === 'string') fields.location = req.body.location.trim();
  if (typeof req.body.scheduledAt === 'string' || req.body.scheduledAt === null) {
    fields.scheduled_at = req.body.scheduledAt;
  }
  if (req.body.category && CATEGORIES.includes(req.body.category)) {
    fields.category = req.body.category;
  }
  if (typeof req.body.notes === 'string') {
    if (req.body.notes.length > 1000) {
      return res.status(400).json({ error: 'Additional info is too long (max 1000 characters)' });
    }
    fields.notes = req.body.notes.trim();
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }
  const setClause = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE matches SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...fields, updated_at: nowIso(), id: row.id });

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.delete('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!isAdmin(req)) {
    if (row.status === 'FINISHED') {
      return res.status(403).json({ error: 'Only an admin can delete a finished match' });
    }
    if (row.created_by_admin) {
      return res.status(403).json({ error: 'This match was created by an admin — only an admin can delete it' });
    }
  }
  db.prepare('DELETE FROM messages WHERE match_id = ?').run(row.id);
  db.prepare('DELETE FROM matches WHERE id = ?').run(row.id);
  req.app.get('io').emit('matches:changed', { token: row.share_token, status: 'DELETED' });
  res.status(204).end();
});

router.post('/:token/start', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'Only planned matches can be started' });
  }
  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'LIVE', start_time = ?, updated_at = ? WHERE id = ?")
    .run(ts, ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/pause', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only a live match can be paused' });
  }
  if (row.paused_at) {
    return res.status(400).json({ error: 'Match is already paused' });
  }
  const ts = nowIso();
  db.prepare('UPDATE matches SET paused_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/resume', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only a live match can be resumed' });
  }
  if (!row.paused_at) {
    return res.status(400).json({ error: 'Match is not paused' });
  }
  const pausedMs = Date.now() - new Date(row.paused_at).getTime();
  const pausedSeconds = (row.paused_seconds || 0) + Math.max(0, Math.round(pausedMs / 1000));
  db.prepare('UPDATE matches SET paused_at = NULL, paused_seconds = ?, updated_at = ? WHERE id = ?')
    .run(pausedSeconds, nowIso(), row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/restart', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only a live match can be restarted' });
  }
  const state = engine.initState(row.format);
  const ts = nowIso();
  db.prepare(`
    UPDATE matches
    SET status = 'PLANNED', state = ?, history = '[]', winner_id = NULL, start_time = NULL,
        paused_at = NULL, paused_seconds = 0, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(state), ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/score', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status === 'PLANNED') {
    return res.status(400).json({ error: 'Match must be live to update the score' });
  }
  if (row.status === 'FINISHED' && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only an admin can edit the score of a finished match' });
  }
  const player = Number(req.body.player);
  const delta = Number(req.body.delta);
  if (![1, 2].includes(player) || ![1, -1].includes(delta)) {
    return res.status(400).json({ error: 'player must be 1 or 2, delta must be 1 or -1' });
  }

  const prevState = row.state;
  const state = JSON.parse(row.state);
  const nextState = engine.applyDelta(state, row.format, player, delta);

  const history = JSON.parse(row.history);
  history.push(prevState);
  while (history.length > MAX_HISTORY) history.shift();

  db.prepare('UPDATE matches SET state = ?, history = ?, winner_id = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(nextState), JSON.stringify(history), deriveWinnerId(nextState, row), nowIso(), row.id);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/undo', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status === 'FINISHED' && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only an admin can edit a finished match' });
  }
  const history = JSON.parse(row.history);
  if (history.length === 0) {
    return res.status(400).json({ error: 'Nothing to undo' });
  }
  const prevState = history.pop();
  const restoredState = JSON.parse(prevState);
  db.prepare('UPDATE matches SET state = ?, history = ?, winner_id = ?, updated_at = ? WHERE id = ?')
    .run(prevState, JSON.stringify(history), deriveWinnerId(restoredState, row), nowIso(), row.id);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/finish', async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only live matches can be finished' });
  }

  const state = JSON.parse(row.state);
  const winnerId = deriveWinnerId(state, row);

  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'FINISHED', end_time = ?, winner_id = ?, updated_at = ? WHERE id = ?")
    .run(ts, winnerId, ts, row.id);

  let updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);

  try {
    const p1 = getPlayer(updated.player1_id);
    const p2 = getPlayer(updated.player2_id);
    await sendMatchFinishedEmail(updated, p1, p2);
    db.prepare('UPDATE matches SET notified = 1 WHERE id = ?').run(row.id);
  } catch (err) {
    console.error('[matches] failed to send finished-match email:', err.message);
  }
});

function serializeMessage(row) {
  return { id: row.id, author: row.author, body: row.body, createdAt: row.created_at };
}

router.get('/:token/messages', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const messages = db.prepare('SELECT * FROM messages WHERE match_id = ? ORDER BY id ASC').all(row.id);
  res.json(messages.map(serializeMessage));
});

router.post('/:token/messages', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const author = String(req.body.author || '').trim().slice(0, 60);
  const body = String(req.body.body || '').trim().slice(0, 500);
  if (!author) return res.status(400).json({ error: 'Please enter your name' });
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

  const ts = nowIso();
  const result = db.prepare('INSERT INTO messages (match_id, author, body, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id, author, body, ts);
  const message = serializeMessage({ id: result.lastInsertRowid, author, body, created_at: ts });

  req.app.get('io').to(`match:${row.share_token}`).emit('message:new', { token: row.share_token, message });
  res.status(201).json(message);
});

module.exports = router;
