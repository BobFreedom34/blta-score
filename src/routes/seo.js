const express = require('express');
const seo = require('../seo');
const auth = require('../auth');
const leagues = require('../leagues');
const { requireSuperAdmin, requireAdmin } = auth;

const router = express.Router();

// Backend > SEO: every page with its addresses (slugs) and meta texts in both languages, and the first values to reset to.
// Backend > SEO: the texts of the city the admin works on; the addresses are shared by every city and only the super admin changes them (on the first city)
router.get('/', requireAdmin, (req, res) => res.json(seo.listAll(leagues.actingIdOf(req), { slugsEditable: auth.isSuperAdmin(req) })));

// the courts that can keep the address they had on the old website (one whole address per language)
router.get('/court-paths', requireSuperAdmin, (req, res) => res.json(seo.listCourtPaths()));

router.put('/court-paths/:slug', requireSuperAdmin, (req, res) => {
  const out = seo.saveCourtPath(req.params.slug, req.body);
  if (out.error) return res.status(out.status || 400).json({ error: out.error });
  res.json(out.court);
});

router.put('/:key', requireAdmin, (req, res) => {
  const page = seo.BY_KEY.get(req.params.key);
  const leagueId = leagues.actingIdOf(req);
  if (!page || (page.key === 'slta' && leagueId !== 1)) return res.status(404).json({ error: 'Unknown page' });
  // the national page (slta) and the addresses are the super admin's
  if (page.key === 'slta' && !auth.isSuperAdmin(req)) return res.status(403).json({ error: 'Only the super admin can change this' });
  const slugsEditable = leagueId === 1 && auth.isSuperAdmin(req);
  const parsed = seo.parseBody(page, req.body, { slugs: slugsEditable });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  seo.save(page, parsed, leagueId);
  res.json(seo.listAll(leagueId, { slugsEditable: auth.isSuperAdmin(req) }).find((p) => p.key === page.key));
});

module.exports = router;
