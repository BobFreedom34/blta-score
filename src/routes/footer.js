// /api/footer — Backend > Footer: the footer of the city the admin works on (a city admin: his own city; the super admin: the one in the picker, or — with
// ?scope=national — the footer of the national site slta.sk). GET gives the saved values, the built-in ones to show where nothing is saved, and the pages a link
// can point at; PUT saves everything the editor has; DELETE goes back to the built-in footer.
const express = require('express');
const settings = require('../footerSettings');
const footer = require('../footer');
const leagues = require('../leagues');
const auth = require('../auth');

const router = express.Router();

// the scope of the request: 0 (the national site, super admin only) or the id of the city that is worked on
function scopeOf(req, res) {
  if (req.query.scope === 'national') {
    if (!auth.isSuperAdmin(req)) { res.status(403).json({ error: 'Only the super admin can change the footer of the national site' }); return null; }
    return settings.NATIONAL;
  }
  return leagues.actingIdOf(req);
}
const view = (scope) => ({ scope: scope === settings.NATIONAL ? 'national' : scope, settings: settings.get(scope), builtIn: footer.builtIn(scope), pages: settings.pageCodes() });

router.get('/', auth.requireAdmin, (req, res) => {
  const scope = scopeOf(req, res);
  if (scope === null) return;
  res.json(view(scope));
});

router.put('/', auth.requireAdmin, (req, res) => {
  const scope = scopeOf(req, res);
  if (scope === null) return;
  const saved = settings.set(scope, req.body);
  if (saved.error) return res.status(400).json({ error: saved.error });
  res.json(view(scope));
});

router.delete('/', auth.requireAdmin, (req, res) => {
  const scope = scopeOf(req, res);
  if (scope === null) return;
  settings.reset(scope);
  res.json(view(scope));
});

module.exports = router;
