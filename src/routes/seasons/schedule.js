// ---------------- tournament court schedule (see tournamentSchedule.js) ----------------
const db = require('../../db');
const clubTournaments = require('../../clubTournaments');
const tournamentMatches = require('../../tournamentMatches');
const tournamentSchedule = require('../../tournamentSchedule');
const router = require('./router');
const { tournamentOr404 } = require('./shared');

function scheduleChanged(req, season) {
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'SCHEDULE' });
}

// Public: the schedule tab of the tournament page — settings, every match with two players, who is on which court when.
router.get('/:id/schedule', (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json(tournamentSchedule.getSchedule(season));
});

// The form "Pridať zápas" of the Harmonogram (organiser): the groups of the tournament with their players and rounds, and the courts.
router.get('/:id/match-options', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json(tournamentMatches.matchOptions(season));
});

// Adds a match to a group of the tournament by hand: { groupId, round, player1Id, player2Id, courtNo?, scheduledAt?, force? } (src/tournamentMatches.js)
router.post('/:id/matches', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentMatches.addMatch(season, req.body || {});
  if (done.error) return res.status(done.status || 400).json({ error: done.error, code: done.code });
  scheduleChanged(req, season);
  res.status(201).json({ token: done.token, warnings: done.warnings, placed: done.placed });
});

// { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule }
router.patch('/:id/schedule/settings', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const saved = tournamentSchedule.saveSettings(season, req.body || {});
  if (saved.error) return res.status(400).json({ error: saved.error });
  res.json(tournamentSchedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// { mode: 'fill' | 'backfill' | 'rebuild' | 'compact' | 'clear' | 'unlock' } (backfill: the matches without a time are laid out from the start of the first day, not from now; compact: unlocked planned matches move forward where time was freed;
// unlock: every planned match is unlocked, none is moved) — the planner puts the matches without a time on the courts (see tournamentSchedule.autoPlan)
router.post('/:id/schedule/auto', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const mode = ['fill', 'backfill', 'rebuild', 'compact', 'clear', 'unlock'].includes(req.body && req.body.mode) ? req.body.mode : 'fill';
  const done = tournamentSchedule.autoPlan(season.id, { mode });
  if (done.error) return res.status(400).json({ error: done.error });
  scheduleChanged(req, season);
  res.json({ ...done, schedule: tournamentSchedule.getSchedule(season) });
});

// { courtNo, scheduledAt } puts a match that has not started on a court at a time (the planner never moves it afterwards);
// { courtNo: null } takes it off the schedule.
router.put('/:id/schedule/matches/:token', clubTournaments.requireSeasonManager(clubTournaments.byIdAndMatchToken), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  // { durationMinutes: 45 | null } alone: the length of this one match (null = the tournament's length)
  if (body.durationMinutes !== undefined && body.courtNo === undefined) {
    const minutes = body.durationMinutes === null ? null : Number(body.durationMinutes);
    const set = tournamentSchedule.setDuration(season, req.params.token, minutes);
    if (set.error) return res.status(set.status || 400).json({ error: set.error });
    scheduleChanged(req, season);
    return res.json({ warnings: [], schedule: tournamentSchedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)) });
  }
  // { locked: true | false } alone: lock or unlock a match where it is
  if (typeof body.locked === 'boolean' && body.courtNo === undefined) {
    const set = tournamentSchedule.setLocked(season, req.params.token, body.locked);
    if (set.error) return res.status(set.status || 400).json({ error: set.error });
    scheduleChanged(req, season);
    return res.json({ warnings: [], schedule: tournamentSchedule.getSchedule(season) });
  }
  const courtNo = body.courtNo === null || body.courtNo === undefined ? null : Number(body.courtNo);
  const done = tournamentSchedule.placeMatch(season, req.params.token, courtNo, body.scheduledAt);
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  scheduleChanged(req, season);
  res.json({ warnings: done.warnings, schedule: tournamentSchedule.getSchedule(season) });
});
