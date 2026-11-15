// /api/popups — Backend > Popups: the admin of a city (the super admin: the city that is picked) makes, changes, switches off, copies and removes the pop-ups
// about an event and sees what each did. /api/player/popup — what the logged-in player's browser asks: the pop-up to show now, and the three things the
// player can do with it (seen, closed with the cross, "I don't want to register"). Registering itself is the ordinary POST /api/seasons/:id/registrations.
const express = require('express');
const auth = require('../auth');
const leagues = require('../leagues');
const popups = require('../eventPopups');

const admin = express.Router();
const player = express.Router();

// the pop-up of this request's city (a city admin never reaches another city's)
function mine(req, res) {
  const p = popups.get(Number(req.params.id));
  if (!p || p.league_id !== leagues.actingIdOf(req)) { res.status(404).json({ error: 'Popup not found' }); return null; }
  return p;
}
const view = (req) => ({ popups: popups.list(leagues.actingIdOf(req)), events: popups.eventOptions(leagues.actingIdOf(req)), today: popups.today() });

admin.get('/', auth.requireAdmin, (req, res) => res.json(view(req)));
admin.post('/', auth.requireAdmin, (req, res) => {
  const made = popups.create(leagues.actingIdOf(req), req.body);
  if (made.error) return res.status(400).json({ error: made.error });
  res.status(201).json({ ...view(req), id: made.id });
});
admin.put('/:id(\\d+)', auth.requireAdmin, (req, res) => {
  const p = mine(req, res);
  if (!p) return;
  const done = popups.update(p, req.body);
  if (done.error) return res.status(400).json({ error: done.error });
  res.json(view(req));
});
admin.delete('/:id(\\d+)', auth.requireAdmin, (req, res) => {
  const p = mine(req, res);
  if (!p) return;
  popups.remove(p);
  res.json(view(req));
});
// ask everybody again (those who closed it or said no)
admin.post('/:id(\\d+)/reset', auth.requireAdmin, (req, res) => {
  const p = mine(req, res);
  if (!p) return;
  popups.resetResponses(p);
  res.json(view(req));
});
// what a player would see (the preview of the editor)
admin.get('/:id(\\d+)/preview', auth.requireAdmin, (req, res) => {
  const p = mine(req, res);
  if (!p) return;
  res.json({ popup: popups.payloadOf(p) });
});

// ---- the player ----
const playerOnly = (req, res, next) => {
  const id = auth.getPlayerId(req);
  if (!id) return res.status(401).json({ error: 'Player login required' });
  req.playerId = id;
  next();
};
// the one the player has to see on this page load (null: nothing). The site of the request decides the city.
player.get('/next', (req, res) => {
  const id = auth.getPlayerId(req);
  const p = id ? popups.nextFor(id, (req.league && req.league.id) || leagues.DEFAULT_LEAGUE_ID) : null;
  res.set('Cache-Control', 'no-store');
  res.json({ popup: p ? popups.payloadOf(p) : null });
});
// the popup must be one the player could be shown (its city = this site's city), so ids of other cities say nothing
const shownHere = (req, res) => {
  const p = popups.get(Number(req.params.id));
  if (!p || p.league_id !== ((req.league && req.league.id) || leagues.DEFAULT_LEAGUE_ID)) { res.status(404).json({ error: 'Popup not found' }); return null; }
  return p;
};
player.post('/:id(\\d+)/seen', playerOnly, (req, res) => { const p = shownHere(req, res); if (!p) return; popups.markShown(p.id, req.playerId); res.json({ ok: true }); });
player.post('/:id(\\d+)/dismiss', playerOnly, (req, res) => { const p = shownHere(req, res); if (!p) return; popups.markDismissed(p.id, req.playerId); res.json({ ok: true }); });
player.post('/:id(\\d+)/decline', playerOnly, (req, res) => {
  const p = shownHere(req, res);
  if (!p) return;
  popups.markDeclined(p.id, req.playerId, (req.body || {}).reason);
  res.json({ ok: true });
});
// the optional "why" after saying no
player.post('/:id(\\d+)/reason', playerOnly, (req, res) => { const p = shownHere(req, res); if (!p) return; popups.setReason(p.id, req.playerId, (req.body || {}).reason); res.json({ ok: true }); });

module.exports = { admin, player };
