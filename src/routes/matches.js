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
    scheduledAt: row.scheduled_at,
    format: row.format,
    formatLabel: engine.FORMATS[row.format] ? engine.FORMATS[row.format].label : row.format,
    status: row.status,
    state,
    scoreSummary: engine.describeMatch(state),
    canUndo: history.length > 0,
    winnerId: row.winner_id,
    startTime: row.start_time,
    endTime: row.end_time,
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
  const { status, category, q } = req.query;
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
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT m.* FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    ${where}
    ORDER BY
      CASE m.status WHEN 'LIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
      COALESCE(m.scheduled_at, m.created_at) DESC
  `).all(params);
  res.json(rows.map(serialize));
});

router.get('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json(serialize(row));
});

router.post('/', (req, res) => {
  const { category, location, scheduledAt, format } = req.body;
  let { player1Id, player2Id, player1Name, player2Name } = req.body;

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!engine.FORMATS[format]) {
    return res.status(400).json({ error: 'Invalid match format' });
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
    INSERT INTO matches (share_token, category, player1_id, player2_id, location, scheduled_at, format, status, state, history)
    VALUES (@share_token, @category, @player1_id, @player2_id, @location, @scheduled_at, @format, 'PLANNED', @state, '[]')
  `).run({
    share_token: crypto.randomUUID(),
    category,
    player1_id: p1.id,
    player2_id: p2.id,
    location: (location || '').trim(),
    scheduled_at: scheduledAt || null,
    format,
    state: JSON.stringify(state),
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
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'Only planned matches can be deleted' });
  }
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

module.exports = router;
