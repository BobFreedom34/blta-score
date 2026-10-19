// /api/about — the texts of the "Info" window of the home page. Public: what the city of the page has written (and whether the texts that came
// with the site are to be used for the tabs it has not written: the first city only). Admin (Backend > Info): save / remove a tab.
const express = require('express');
const about = require('../about');
const leagues = require('../leagues');
const { requireAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
  const leagueId = leagues.actingIdOf(req);
  res.json({ useDefaults: leagueId === leagues.DEFAULT_LEAGUE_ID, tabs: about.forCity(leagueId) });
});

router.put('/:tab', requireAdmin, (req, res) => {
  const r = about.save(leagues.actingIdOf(req), req.params.tab, req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ useDefaults: leagues.actingIdOf(req) === leagues.DEFAULT_LEAGUE_ID, tabs: about.forCity(leagues.actingIdOf(req)) });
});

// back to the first text (the first city) / no text (another city)
router.delete('/:tab', requireAdmin, (req, res) => {
  if (!about.TABS.includes(req.params.tab)) return res.status(404).json({ error: 'Unknown tab' });
  about.remove(leagues.actingIdOf(req), req.params.tab);
  res.json({ useDefaults: leagues.actingIdOf(req) === leagues.DEFAULT_LEAGUE_ID, tabs: about.forCity(leagues.actingIdOf(req)) });
});

module.exports = router;
