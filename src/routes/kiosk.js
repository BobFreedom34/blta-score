// The kiosk of a tournament (see src/courtKiosk.js). GET /api/kiosk/:token is what the link shows first: the courts to pick from. GET /api/kiosk/:token/court/:n is the court the phone
// lies on: the list of its matches, and the browser gets the cookie that lets it run their live score. Everything else a kiosk does goes through the normal match routes
// (src/routes/matches/scoring.js), which look at that cookie.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const courtKiosk = require('../courtKiosk');
const tournamentSchedule = require('../tournamentSchedule');
const courtNames = require('../courtNames');

const router = express.Router();
const notValid = (res) => res.status(404).json({ error: 'This kiosk link is not valid any more' });

// the tournament of a link, or null
const seasonOf = (token) => {
  const kiosk = courtKiosk.byToken(token);
  return kiosk ? db.prepare("SELECT * FROM seasons WHERE id = ? AND kind = 'TOURNAMENT'").get(kiosk.seasonId) || null : null;
};

// the courts of the tournament, each with the number of matches that are being played on it now
router.get('/:token', (req, res) => {
  const season = seasonOf(req.params.token);
  if (!season) return notValid(res);
  const schedule = tournamentSchedule.getSchedule(season);
  res.set('Cache-Control', 'no-store');
  res.json({
    seasonName: season.name,
    courts: Array.from({ length: season.court_count || 0 }, (_, i) => ({
      courtNo: i + 1,
      name: courtNames.label(schedule.settings.courtNames, i + 1),
      live: schedule.matches.filter((m) => m.courtNo === i + 1 && m.status === 'LIVE').length,
    })),
  });
});

// The short address /turnaj<number>: { code } -> { token } (the page then goes on to /kiosk/<token>). A tournament with no kiosk and a wrong number look the same.
router.post('/turnaj/:number/open', (req, res) => {
  const number = /^[0-9]{1,9}$/.test(req.params.number) ? Number(req.params.number) : 0;
  const done = number ? courtKiosk.openByCode(number, req.body && req.body.code) : { missing: true };
  if (done.token) return res.json({ token: done.token });
  if (done.locked) return res.status(429).json({ error: 'Too many wrong codes, try again in a few minutes', errorCode: 'locked' });
  if (done.wrong) return res.status(401).json({ error: 'Wrong code', errorCode: 'wrong' });
  return notValid(res);
});

router.get('/:token/court/:court', (req, res) => {
  const kiosk = courtKiosk.pick(req.params.token, req.params.court);
  const season = kiosk && seasonOf(kiosk.token);
  if (!season) return notValid(res);
  auth.logInKiosk(res, kiosk.token, kiosk.courtNo);
  const schedule = tournamentSchedule.getSchedule(season);
  res.set('Cache-Control', 'no-store');
  res.json({
    seasonId: season.id,
    seasonName: season.name,
    courtNo: kiosk.courtNo,
    courtName: courtNames.label(schedule.settings.courtNames, kiosk.courtNo),
    // the matches that stand on this court, in the order of the schedule
    matches: schedule.matches
      .filter((m) => m.courtNo === kiosk.courtNo && m.scheduledAt)
      .sort((a, b) => Date.parse(a.blockStart || a.scheduledAt) - Date.parse(b.blockStart || b.scheduledAt)),
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
