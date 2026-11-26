const db = require('../../db');
const engine = require('../../matchEngine');
const { sendMatchFinishedEmail } = require('../../mailer');
const { requireLoggedIn, requireLoggedInOrReferee, isAdmin, isReferee } = require('../../auth');
const bracketEngine = require('../../bracketEngine');
const tournamentSchedule = require('../../tournamentSchedule');
const router = require('./router');
const { getRowOr404, checkLiveScoreAccess, nowIso, broadcast, notifySubscribers, notifyPushSubscribers, checkMatchAccess, sideOf, reconcileRankingPoints, mayCorrectFinished, MAX_HISTORY, deriveWinnerId, syncBadgesIfFinished, syncCourtIQIfFinished, playsInClubMatch } = require('./shared');

router.post('/:token/start', requireLoggedInOrReferee, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
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
router.patch('/:token/format', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkMatchAccess(req, res, row)) return;
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
router.patch('/:token/set-style', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkMatchAccess(req, res, row)) return;
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

router.post('/:token/pause', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
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

router.post('/:token/resume', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
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

// A live match that has to stop without a winner — e.g. the court booking
// ran out — freezes here instead of forcing a Finish. Nothing about the
// score/state is touched, so resuming later (see /resume-later below)
// picks up exactly where it left off. Not FINISHED, so it's automatically
// excluded from stats/badges same as any other non-finished match — that
// stays true for as long as it sits here, whether or not it's ever resumed.
router.post('/:token/unfinished', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Only a live match can be marked unfinished' });
  }
  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'UNFINISHED', end_time = ?, paused_at = NULL, updated_at = ? WHERE id = ?")
    .run(ts, ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Puts an unfinished match back to Planned, ready to pick a new date and
// location and start again — the score/state carries over untouched (only
// the live-scoring "Start" flow actually resets nothing itself; it just
// stops using a fresh initState the way match creation does).
router.post('/:token/resume-later', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
  if (row.status !== 'UNFINISHED') {
    return res.status(400).json({ error: 'Only an unfinished match can be resumed this way' });
  }
  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'PLANNED', start_time = NULL, end_time = NULL, updated_at = ? WHERE id = ?")
    .run(ts, row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Locks in an unfinished match's score exactly as it stands, instead of
// resuming it later — no picking a winner, no walkover/retirement reason,
// just whatever the score already says. Marked with its own end_reason
// (same trick as WALKOVER) so it's permanently excluded from stats/badges/
// H2H, same as everywhere else that filters those out — this never
// reached a real conclusion, so it shouldn't count as one.
router.post('/:token/finish-as-is', requireLoggedInOrReferee, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row, { noKiosk: true })) return;
  if (row.status !== 'UNFINISHED') {
    return res.status(400).json({ error: 'Only an unfinished match can be finished this way' });
  }

  // An unfinished match never gets a winner, even if one side was clearly
  // ahead on sets — that's the whole point of Unfinished vs. a decided
  // result. Leave winner_id NULL unconditionally.
  //
  // Keep row.end_time as-is (don't fabricate one with `|| ts`): a
  // live-originated unfinished match already has a real end_time (set by
  // /unfinished when it stopped), but a manually-entered one never went
  // live and has no real end_time — pairing a fabricated "now" with a
  // possibly much older start_time would make the match page compute and
  // show a bogus duration.
  const ts = nowIso();
  db.prepare("UPDATE matches SET status = 'FINISHED', end_time = ?, winner_id = NULL, end_reason = 'UNFINISHED', updated_at = ? WHERE id = ?")
    .run(row.end_time, ts, row.id);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);

  try {
    const p1 = sideOf(updated, 1);
    const p2 = sideOf(updated, 2);
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

router.post('/:token/restart', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row, { noKiosk: true })) return;
  if (row.status === 'FINISHED') {
    if (!mayCorrectFinished(req, row)) {
      return res.status(403).json({ error: 'Only an admin can restart a finished match' });
    }
  } else if (row.status !== 'LIVE' && row.status !== 'UNFINISHED') {
    return res.status(400).json({ error: 'Only a live, unfinished, or finished match can be restarted' });
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
  // a tournament: a match that moved onto this time while this one was finished goes back behind it
  tournamentSchedule.afterRestart(row.season_id, row.id);
  const payload = broadcast(req, updated);
  res.json(payload);

  // Restarting always leaves the match PLANNED (never FINISHED), so this
  // only ever reverses whatever points a prior finish had earned — never
  // awards anything new. A no-op when there's nothing to reverse (the
  // match was never finished, wasn't a ranked category, or predates this
  // feature).
  reconcileRankingPoints(row, updated).catch((err) => {
    console.error('[matches] failed to reconcile ranking points:', err.message);
  });
});

router.post('/:token/score', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
  if (row.status === 'PLANNED') {
    return res.status(400).json({ error: 'Match must be live to update the score' });
  }
  if (row.status === 'FINISHED' && !mayCorrectFinished(req, row)) {
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
  syncBadgesIfFinished(updated);
  syncCourtIQIfFinished(updated);
  bracketEngine.syncBracketIfFinished(updated);
  const payload = broadcast(req, updated);
  res.json(payload);

  // A set correction can change an already-finished match's result, or
  // flip it out of FINISHED entirely (isNowComplete === false above) —
  // either way, whatever ranking points that result previously earned may
  // no longer be right. Only set corrections can do this (isSetCorrection
  // — plain live +1/-1 scoring never touches an already-decided result),
  // and reconcileRankingPoints is a no-op in both directions when there
  // is nothing to take back and nothing new to add.
  if (isSetCorrection) {
    reconcileRankingPoints(row, updated).catch((err) => {
      console.error('[matches] failed to reconcile ranking points:', err.message);
    });
  }
});

// One point (15-30-40-Ad) of the live score. Only an admin, a city admin or a referee scores by points; everybody else keeps the game buttons. Goes
// through the same history as /score, so /undo takes a point back too.
router.post('/:token/point', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!isAdmin(req) && !isReferee(req)) {
    return res.status(403).json({ error: 'Only an admin or a referee can score point by point' });
  }
  if (row.status !== 'LIVE') {
    return res.status(400).json({ error: 'Match must be live to score a point' });
  }
  const player = Number(req.body.player);
  if (![1, 2].includes(player)) {
    return res.status(400).json({ error: 'player must be 1 or 2' });
  }
  const prevState = row.state;
  let nextState;
  try {
    nextState = engine.applyPoint(JSON.parse(row.state), row.format, player);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const history = JSON.parse(row.history);
  history.push(prevState);
  while (history.length > MAX_HISTORY) history.shift();
  db.prepare('UPDATE matches SET state = ?, history = ?, winner_id = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(nextState), JSON.stringify(history), deriveWinnerId(nextState, row), nowIso(), row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  res.json(broadcast(req, updated));
});

router.post('/:token/undo', requireLoggedInOrReferee, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
  if (row.status === 'FINISHED' && !mayCorrectFinished(req, row)) {
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

router.post('/:token/finish', requireLoggedInOrReferee, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkLiveScoreAccess(req, res, row)) return;
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
  syncBadgesIfFinished(updated);
  syncCourtIQIfFinished(updated);
  bracketEngine.syncBracketIfFinished(updated);
  const payload = broadcast(req, updated);
  res.json(payload);

  const finishedP1 = sideOf(updated, 1);
  const finishedP2 = sideOf(updated, 2);
  try {
    await sendMatchFinishedEmail(updated, finishedP1, finishedP2);
    db.prepare('UPDATE matches SET notified = 1 WHERE id = ?').run(row.id);
  } catch (err) {
    console.error('[matches] failed to send finished-match email:', err.message);
  }
  // Independent of the email above (and of each other) — one failing
  // shouldn't stop the others, same as notifySubscribers/notifyPushSubscribers
  // just below already don't wait on the email either.
  reconcileRankingPoints(row, updated).catch((err) => {
    console.error('[matches] failed to reconcile ranking points:', err.message);
  });
  notifySubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish notifications:', err.message);
  });
  notifyPushSubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish push notifications:', err.message);
  });
});

// Records a result for a match that was already played outside the app,
// skipping the start/live-scoring flow entirely.
router.post('/:token/manual-result', requireLoggedIn, async (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!playsInClubMatch(req, row) && !checkMatchAccess(req, res, row)) return;
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

  const isUnfinished = req.body.unfinished === true;

  // Recording a result that was ALSO never finished lands the match in
  // UNFINISHED, same as marking a live match unfinished — no winner, no
  // end_reason yet, and it can be resumed later (/resume-later) or locked
  // in as-is (/finish-as-is) from there, using the exact same buttons a
  // live-originated unfinished match gets. This is deliberately not a
  // direct path to FINISHED.
  if (isUnfinished) {
    let state;
    try {
      state = engine.buildStateFromSets(row.format, req.body.sets);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    // Mirror the FINISHED branch below: start_time = scheduledAt, end_time
    // left NULL — there's no real live start/end to record here, and a
    // non-null end_time paired with start_time would make the match page
    // compute and show a bogus duration.
    const ts = nowIso();
    db.prepare(`
      UPDATE matches
      SET status = 'UNFINISHED', state = ?, history = '[]', winner_id = NULL, start_time = ?, end_time = NULL,
          location = ?, scheduled_at = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(state), scheduledAt, location, scheduledAt, ts, row.id);
    const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
    const payload = broadcast(req, updated);
    return res.json(payload);
  }

  // "The match ends with this result": the match was played to a time limit (or stopped) and counts as finished. Who leads in finished sets wins; when the sets are
  // level (1:1, or one set that was not finished) the games of the last set decide (see matchEngine.leaderOfSets). No reason and no end_reason: it is an ordinary
  // result. A level last set decides nothing.
  let leader;
  if (req.body.byGames === true) {
    let found;
    try { found = engine.leaderOfSets(row.format, req.body.sets); } catch (err) { return res.status(400).json({ error: err.message }); }
    if (!found.winner) return res.status(400).json({ error: `The sets are level and so are the games of the last set (${found.last.p1}:${found.last.p2}), so a winner cannot be told` });
    leader = found.winner;
  }

  const hasExplicitWinner = leader === undefined && req.body.winner !== undefined && req.body.winner !== null;
  let endReason = null;
  if (hasExplicitWinner) {
    if (!['WALKOVER', 'RETIREMENT'].includes(req.body.reason)) {
      return res.status(400).json({ error: 'Pick a reason: Walkover or Retirement' });
    }
    endReason = req.body.reason;
  }

  let state;
  try {
    state = engine.buildResultFromSets(row.format, req.body.sets, leader !== undefined ? leader : hasExplicitWinner ? Number(req.body.winner) : undefined);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const winnerId = deriveWinnerId(state, row);
  const ts = nowIso();
  db.prepare(`
    UPDATE matches
    SET status = 'FINISHED', state = ?, history = '[]', winner_id = ?, start_time = ?, end_time = NULL, end_reason = ?,
        location = ?, scheduled_at = ?, result_at = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(state), winnerId, scheduledAt, endReason, location, scheduledAt, ts, ts, row.id);

  let updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  syncBadgesIfFinished(updated);
  syncCourtIQIfFinished(updated);
  bracketEngine.syncBracketIfFinished(updated);
  const payload = broadcast(req, updated);
  res.json(payload);

  const manualP1 = sideOf(updated, 1);
  const manualP2 = sideOf(updated, 2);
  try {
    await sendMatchFinishedEmail(updated, manualP1, manualP2);
    db.prepare('UPDATE matches SET notified = 1 WHERE id = ?').run(row.id);
  } catch (err) {
    console.error('[matches] failed to send finished-match email:', err.message);
  }
  reconcileRankingPoints(row, updated).catch((err) => {
    console.error('[matches] failed to reconcile ranking points:', err.message);
  });
  notifySubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish notifications:', err.message);
  });
  notifyPushSubscribers(row.id, 'FINISH', updated).catch((err) => {
    console.error('[matches] failed to send finish push notifications:', err.message);
  });
});
