const express = require('express');
const seo = require('../seo');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Backend > SEO: every page with its addresses (slugs) and meta texts in both languages, and the first values to reset to.
router.get('/', requireAdmin, (req, res) => res.json(seo.listAll()));

// the courts that can keep the address they had on the old website (one whole address per language)
router.get('/court-paths', requireAdmin, (req, res) => res.json(seo.listCourtPaths()));

router.put('/court-paths/:slug', requireAdmin, (req, res) => {
  const out = seo.saveCourtPath(req.params.slug, req.body);
  if (out.error) return res.status(out.status || 400).json({ error: out.error });
  res.json(out.court);
});

router.put('/:key', requireAdmin, (req, res) => {
  const page = seo.BY_KEY.get(req.params.key);
  if (!page) return res.status(404).json({ error: 'Unknown page' });
  const parsed = seo.parseBody(page, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  seo.save(page, parsed);
  res.json(seo.listAll().find((p) => p.key === page.key));
});

module.exports = router;
