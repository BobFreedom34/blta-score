const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const engine = require('../matchEngine');
const { sendMatchFinishedEmail, sendMatchStartedEmailTo, sendMatchFinishedEmailTo } = require('../mailer');
const { sendPush } = require('../push');
const { isAdmin, requirePlayer } = require('../auth');

const router = express.Router();

const MAX_HISTORY = 30;
const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE', 'FRIENDLY', 'VIP_CUP'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

// Emails everyone subscribed to this match/type who hasn't been notified yet.
async function notifySubscribers(matchId, type, updated) {
  const subs = db.prepare('SELECT * FROM match_notifications WHERE match_id = ? AND type = ? AND sent = 0').all(matchId, type);
  if (!subs.length) return;
  const p1 = getPlayer(updated.player1_id);
  const p2 = getPlayer(updated.player2_id);
  for (const sub of subs) {
    try {
      if (type === 'START') await sendMatchStartedEmailTo(updated, p1, p2, sub.email);
      else await sendMatchFinishedEmailTo(updated, p1, p2, sub.email);
      db.prepare('UPDATE match_notifications SET sent = 1 WHERE id = ?').run(sub.id);
    } catch (err) {
      console.error(`[matches] failed to send ${type} notification to ${sub.email}:`, err.message);
    }
  }
}

// Sends a push notification to everyone subscribed to this match/type who
// hasn't been notified yet. Mirrors notifySubscribers() above but for push
// instead of email — a subscription the browser has dropped (410/404)
// is deleted rather than retried forever.
async function notifyPushSubscribers(matchId, type, updated) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE match_id = ? AND type = ? AND sent = 0').all(matchId, type);
  if (!subs.length) return;
  const p1 = getPlayer(updated.player1_id);
  const p2 = getPlayer(updated.player2_id);
  const url = `${process.env.PUBLIC_URL || ''}/match/${updated.share_token}`;
  const payload = type === 'START'
    ? { title: `Match started: ${p1.name} vs ${p2.name}`, body: 'Watch it live now.', url }
    : { title: `Match finished: ${p1.name} vs ${p2.name}`, body: engine.describeMatch(JSON.parse(updated.state)) || 'See the result.', url };
  for (const sub of subs) {
    try {
      await sendPush(JSON.parse(sub.subscription), payload);
      db.prepare('UPDATE push_subscriptions SET sent = 1 WHERE id = ?').run(sub.id);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error(`[matches] failed to send ${type} push notification:`, err.message);
      }
    }
  }
}

// How many people have ever activated each notification type for this
// match — every row in match_notifications/push_subscriptions counts,
// regardless of whether its notification has already gone out.
function getNotifyCounts(matchId) {
  const counts = { START: 0, FINISH: 0 };
  const emailRows = db.prepare('SELECT type, COUNT(*) AS cnt FROM match_notifications WHERE match_id = ? GROUP BY type').all(matchId);
  for (const row of emailRows) counts[row.type] += row.cnt;
  const pushRows = db.prepare('SELECT type, COUNT(*) AS cnt FROM push_subscriptions WHERE match_id = ? GROUP BY type').all(matchId);
  for (const row of pushRows) counts[row.type] += row.cnt;
  return counts;
}

function serialize(row) {
  const p1 = getPlayer(row.player1_id);
  const p2 = getPlayer(row.player2_id);
  const state = JSON.parse(row.state);
  const history = JSON.parse(row.history);
  const notifyCounts = getNotifyCounts(row.id);
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
    firstServer: row.first_server || null,
    endReason: row.end_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifyStartCount: notifyCounts.START,
    notifyFinishCount: notifyCounts.FINISH,
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
  const { status, category, q, from, to, noDate, hasDate, playerId } = req.query;
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
  if (playerId) {
    clauses.push('(m.player1_id = @playerId OR m.player2_id = @playerId)');
    params.playerId = playerId;
  }
  if (noDate === '1') {
    clauses.push('m.scheduled_at IS NULL');
  } else if (hasDate === '1') {
    clauses.push('m.scheduled_at IS NOT NULL');
  } else if (from && to) {
    clauses.push('m.scheduled_at BETWEEN @from AND @to');
    params.from = from;
    params.to = to;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  // Planned matches: soonest-scheduled first, undated ones grouped at the end
  // (the frontend divides the two groups with a visual line). Finished
  // matches: most recently finished first.
  const orderBy = status === 'PLANNED'
    ? 'ORDER BY (m.scheduled_at IS NULL) ASC, m.scheduled_at ASC, m.created_at DESC'
    : status === 'FINISHED'
      // Sort by when the match was actually played, not by database
      // bookkeeping — a manually-entered or bulk-imported result has no
      // real end_time (and its updated_at is just whenever it was typed
      // in), so both would otherwise bury genuinely old matches under
      // whatever was most recently recorded, regardless of when it was
      // actually played.
      ? 'ORDER BY COALESCE(m.scheduled_at, m.end_time, m.updated_at) DESC'
      : `ORDER BY
          CASE m.status WHEN 'LIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
          COALESCE(m.scheduled_at, m.created_at) DESC`;
  let rows = db.prepare(`
    SELECT m.*, p1.name AS p1_name, p2.name AS p2_name FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    ${where}
    ${orderBy}
  `).all(params);
  // Filtered in JS rather than SQL LIKE — SQLite's LIKE only case-folds
  // ASCII, so a query like "šar" would never match a stored "Šarudy".
  // String.prototype.toLowerCase() handles this correctly for all of
  // Slovak's diacritics.
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => r.p1_name.toLowerCase().includes(needle) || r.p2_name.toLowerCase().includes(needle));
  }
  res.json(rows.map(serialize));
});

router.get('/:token', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  res.json(serialize(row));
});

router.post('/', requirePlayer, (req, res) => {
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

router.patch('/:token', requirePlayer, (req, res) => {
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
  db.prepare('DELETE FROM match_notifications WHERE match_id = ?').run(row.id);
  db.prepare('DELETE FROM matches WHERE id = ?').run(row.id);
  req.app.get('io').emit('matches:changed', { token: row.share_token, status: 'DELETED' });
  res.status(204).end();
});

router.post('/:token/start', requirePlayer, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'Only planned matches can be started' });
  }
  if (!row.location || !row.scheduled_at) {
    return res.status(400).json({ error: 'Set a location and date before starting the match' });
  }
  let firstServer = null;
  if (req.body.firstServer !== undefined && req.body.firstServer !== null) {
    firstServer = Number(req.body.firstServer);
    if (![1, 2].includes(firstServer)) {
      return res.status(400).json({ error: 'firstServer must be 1 or 2' });
    }
  }
  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'LIVE', start_time = ?, first_server = ?, updated_at = ? WHERE id = ?")
    .run(ts, firstServer, ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);

  notifySubscribers(row.id, 'START', updated).catch((err) => {
    console.error('[matches] failed to send start notifications:', err.message);
  });
  notifyPushSubscribers(row.id, 'START', updated).catch((err) => {
    console.error('[matches] failed to send start push notifications:', err.message);
  });
});

// Changes the match format — before it starts, or mid-game once it's LIVE —
// open to anyone, same as scoring itself. Rejected if it would retroactively
// decide the match from the sets already played (see engine.applyFormatChange);
// that never actually triggers for a still-Planned match, only a LIVE one.
router.patch('/:token/format', requirePlayer, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE' && row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'The match format can only be changed before or during the match' });
  }
  const format = req.body.format;
  if (!engine.FORMATS[format]) {
    return res.status(400).json({ error: 'Invalid match format' });
  }
  if (format === row.format) {
    return res.status(400).json({ error: 'That is already the current format' });
  }

  let state;
  try {
    state = engine.applyFormatChange(JSON.parse(row.state), format);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare('UPDATE matches SET format = ?, state = ?, updated_at = ? WHERE id = ?')
    .run(format, JSON.stringify(state), nowIso(), row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Free Play only: choose how the next set is played (games to 6 / 7-point
// tiebreak / 10-point tiebreak) — requires a player/admin login, same as scoring.
router.patch('/:token/set-style', requirePlayer, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'The set style can only be changed while live' });
  }
  try {
    const state = engine.setNextSetStyle(JSON.parse(row.state), row.format, req.body.style);
    db.prepare('UPDATE matches SET state = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(state), nowIso(), row.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/pause', requirePlayer, (req, res) => {
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

router.post('/:token/resume', requirePlayer, (req, res) => {
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

router.post('/:token/restart', requirePlayer, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status === 'FINISHED') {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only an admin can restart a finished match' });
    }
  } else if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only a live or finished match can be restarted' });
  }
  const state = engine.initState(row.format);
  const ts = nowIso();
  db.prepare(`
    UPDATE matches
    SET status = 'PLANNED', state = ?, history = '[]', winner_id = NULL, start_time = NULL, end_time = NULL,
        notified = 0, paused_at = NULL, paused_seconds = 0, first_server = NULL, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(state), ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/score', requirePlayer, (req, res) => {
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
  let nextState;
  const isSetCorrection = req.body.setIndex !== undefined && req.body.setIndex !== null;

  if (isSetCorrection) {
    // Picking an earlier (already-decided) set to correct is open to anyone
    // while the match is LIVE, same as normal live scoring. It's only
    // admin-gated when the match is FINISHED, via the check above.
    const setIndex = Number(req.body.setIndex);
    if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= state.sets.length) {
      return res.status(400).json({ error: 'Invalid set index' });
    }
    try {
      nextState = engine.editSetScore(state, row.format, setIndex, player, delta);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  } else {
    nextState = engine.applyDelta(state, row.format, player, delta);
  }

  const history = JSON.parse(row.history);
  history.push(prevState);
  while (history.length > MAX_HISTORY) history.shift();

  const winnerId = deriveWinnerId(nextState, row);

  if (isSetCorrection && row.status === 'FINISHED') {
    // Correcting an already-finished match (admin-only, per the guard above)
    // can flip whether it's still actually decided — reconcile status with
    // that. A set correction on a still-LIVE match never auto-finishes it;
    // that stays the job of the explicit "Finish match" action.
    const isNowComplete = nextState.status === 'COMPLETE';
    const newStatus = isNowComplete ? 'FINISHED' : 'LIVE';
    const ts = nowIso();
    db.prepare(`
      UPDATE matches
      SET state = ?, history = ?, winner_id = ?, status = ?, end_time = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(nextState), JSON.stringify(history), winnerId, newStatus,
      isNowComplete ? (row.end_time || ts) : null, ts, row.id,
    );
  } else {
    db.prepare('UPDATE matches SET state = ?, history = ?, winner_id = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(nextState), JSON.stringify(history), winnerId, nowIso(), row.id);
  }

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.post('/:token/undo', requirePlayer, (req, res) => {
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

router.post('/:token/finish', requirePlayer, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only live matches can be finished' });
  }

  const state = JSON.parse(row.state);
  let winnerId = deriveWinnerId(state, row);
  let endReason = null;

  // Free Play never reaches state.status === 'COMPLETE' on its own — it's
  // always ended by this explicit action instead. Whoever's won more sets
  // is the natural winner, no reason needed; only a genuine tie (or 0-0)
  // falls through to picking a winner by hand, same as any other format.
  const freePlayWinner = row.format === 'FREE_PLAY' && state.status !== 'COMPLETE'
    ? engine.decideByCompletedSets(state)
    : null;

  if (freePlayWinner) {
    winnerId = freePlayWinner === 1 ? row.player1_id : row.player2_id;
  } else if (state.status !== 'COMPLETE') {
    const winner = Number(req.body.winner);
    if (![1, 2].includes(winner)) {
      return res.status(400).json({ error: "The match isn't decided by score — pick who won" });
    }
    winnerId = winner === 1 ? row.player1_id : row.player2_id;
    if (row.format === 'FREE_PLAY') {
      // Not a real walkover/retirement here, just an early/tied stop —
      // a reason is optional rather than required.
      if (req.body.reason) {
        if (!['WALKOVER', 'RETIREMENT'].includes(req.body.reason)) {
          return res.status(400).json({ error: 'Pick a reason: Walkover or Retirement' });
        }
        endReason = req.body.reason;
      }
    } else {
      // No winner by score — this is a walkover or retirement, so the
      // reason has to be chosen explicitly instead of left blank.
      if (!['WALKOVER', 'RETIREMENT'].includes(req.body.reason)) {
        return res.status(400).json({ error: 'Pick a reason: Walkover or Retirement' });
      }
      endReason = req.body.reason;
    }
  }

  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'FINISHED', end_time = ?, winner_id = ?, end_reason = ?, updated_at = ? WHERE id = ?")
    .run(ts, winnerId, endReason, ts, row.id);

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
  notifySubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish notifications:', err.message);
  });
  notifyPushSubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish push notifications:', err.message);
  });
});

// Records a result for a match that was already played outside the app,
// skipping the start/live-scoring flow entirely.
router.post('/:token/manual-result', requirePlayer, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'Only a planned match can have its result entered manually' });
  }

  // A manually-entered result records a match that was already played
  // somewhere — location and date document where/when that was, so (unlike
  // a normal Planned match) they're required here rather than optional.
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : (row.location || '').trim();
  const scheduledAt = (typeof req.body.scheduledAt === 'string' && req.body.scheduledAt) ? req.body.scheduledAt : row.scheduled_at;
  if (!location) {
    return res.status(400).json({ error: 'Location is required' });
  }
  if (!scheduledAt) {
    return res.status(400).json({ error: 'Date is required' });
  }

  const hasExplicitWinner = req.body.winner !== undefined && req.body.winner !== null;
  let endReason = null;
  if (hasExplicitWinner) {
    if (!['WALKOVER', 'RETIREMENT'].includes(req.body.reason)) {
      return res.status(400).json({ error: 'Pick a reason: Walkover or Retirement' });
    }
    endReason = req.body.reason;
  }

  let state;
  try {
    state = engine.buildResultFromSets(row.format, req.body.sets, hasExplicitWinner ? Number(req.body.winner) : undefined);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const winnerId = deriveWinnerId(state, row);
  const ts = nowIso();
  db.prepare(`
    UPDATE matches
    SET status = 'FINISHED', state = ?, history = '[]', winner_id = ?, start_time = ?, end_time = NULL, end_reason = ?,
        location = ?, scheduled_at = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(state), winnerId, scheduledAt, endReason, location, scheduledAt, ts, row.id);

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
  notifySubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish notifications:', err.message);
  });
  notifyPushSubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish push notifications:', err.message);
  });
});

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
