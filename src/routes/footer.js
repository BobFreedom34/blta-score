// /api/footer — Backend > Footer: the footer of the city the admin works on (a city admin: his own city; the super admin: the one in the picker, or — with
// ?scope=national — the footer of the national site slta.sk). GET gives the saved values, the built-in ones to show where nothing is saved, and the pages a link
// can point at; PUT saves everything the editor has; DELETE goes back to the built-in footer.
const express = require('express');
const settings = require('../footerSettings');
const nationalMenu = require('../nationalMenu');
const footer = require('../footer');
const leagues = require('../leagues');
const db = require('../db');
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
// the cities that can be in the row of the footer of this scope: every city that is shown on the picker but the one the footer belongs to, and the national
// site (slug 'slta') on a city's footer
function citiesFor(scope) {
  const rows = db.prepare("SELECT id, slug, name, brand_name FROM leagues WHERE status != 'HIDDEN' ORDER BY sort_order, name").all().filter((r) => scope === settings.NATIONAL || r.id !== scope);
  const list = rows.map((r) => ({ slug: r.slug, name: r.brand_name || r.name }));
  return scope === settings.NATIONAL ? list : [{ slug: 'slta', name: 'SLTA (the national site)' }, ...list];
}
const view = (scope) => ({ scope: scope === settings.NATIONAL ? 'national' : scope, settings: settings.get(scope), builtIn: footer.builtIn(scope), pages: settings.pageCodes(), cities: citiesFor(scope) });

// the menu in the header of the national site (super admin only)
const menuView = () => ({ items: nationalMenu.get(), builtIn: nationalMenu.BUILT_IN, pages: settings.pageCodes(), max: nationalMenu.MAX_ITEMS });
const superOnly = (req, res, next) => (auth.isSuperAdmin(req) ? next() : res.status(403).json({ error: 'Only the super admin can change the menu of the national site' }));
router.get('/menu', auth.requireAdmin, superOnly, (req, res) => res.json(menuView()));
router.put('/menu', auth.requireAdmin, superOnly, (req, res) => {
  const saved = nationalMenu.set(req.body && req.body.items);
  if (saved.error) return res.status(400).json({ error: saved.error });
  res.json(menuView());
});
router.delete('/menu', auth.requireAdmin, superOnly, (req, res) => { nationalMenu.reset(); res.json(menuView()); });

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
