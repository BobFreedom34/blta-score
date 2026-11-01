const express = require('express');
const seo = require('../seo');
const auth = require('../auth');
const leagues = require('../leagues');
const db = require('../db');
const national = require('../national');
const { requireSuperAdmin, requireAdmin } = auth;

const router = express.Router();

// Backend > SEO: every page with its addresses (slugs) and meta texts in both languages, and the first values to reset to.
// Backend > SEO: the texts of the city the admin works on; the addresses are shared by every city and only the super admin changes them (on the first city)
router.get('/', requireAdmin, (req, res) => res.json(seo.listAll(leagues.actingIdOf(req), { slugsEditable: auth.isSuperAdmin(req) })));

// Backend > SEO > Sitemaps: the XML sitemap addresses to give to Google Search Console. The super admin sees the national site and every city; a city admin
// the city he runs. `indexable`: the city is Active (until then its pages are hidden from search engines, see cityDefaultNoindex in src/seo.js).
router.get('/sitemaps', requireAdmin, (req, res) => {
  const here = `${req.protocol}://${req.get('host')}`;
  const nat = national.siteOrigin(req) || here;
  const superAdmin = auth.isSuperAdmin(req);
  const out = [];
  if (superAdmin) {
    const closed = national.isLocked() || seo.noindexOf('slta');
    out.push({ key: 'national', name: 'SLTA — the national site', status: closed ? 'HIDDEN' : 'ACTIVE', url: `${nat}/sitemap.xml`, indexable: !closed });
  }
  const cities = superAdmin ? db.prepare('SELECT * FROM leagues ORDER BY sort_order, name').all() : [leagues.byId(leagues.actingIdOf(req))].filter(Boolean);
  cities.forEach((c) => {
    const base = c.domain ? `https://${c.domain}` : `${nat}/${c.slug}`;
    out.push({ key: c.slug, name: c.brand_name || c.name, status: c.status, url: `${base}/sitemap.xml`, indexable: leagues.isRunning(c.status) });
  });
  res.json(out);
});

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
  if (!page || (seo.NATIONAL_KEYS.has(page.key) && leagueId !== 1)) return res.status(404).json({ error: 'Unknown page' });
  // the national page (slta) and the addresses are the super admin's
  if (seo.NATIONAL_KEYS.has(page.key) && !auth.isSuperAdmin(req)) return res.status(403).json({ error: 'Only the super admin can change this' });
  const slugsEditable = leagueId === 1 && auth.isSuperAdmin(req);
  const parsed = seo.parseBody(page, req.body, { slugs: slugsEditable });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  seo.save(page, parsed, leagueId);
  res.json(seo.listAll(leagueId, { slugsEditable: auth.isSuperAdmin(req) }).find((p) => p.key === page.key));
});

module.exports = router;
