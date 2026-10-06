const express = require('express');
const seo = require('../seo');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Backend > SEO: every page with its saved values, the first values and the matching blta.sk page.
router.get('/', requireAdmin, (req, res) => res.json(seo.listAll()));

router.put('/:key', requireAdmin, (req, res) => {
  if (!seo.BY_KEY.has(req.params.key)) return res.status(404).json({ error: 'Unknown page' });
  const parsed = seo.parseValues(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  seo.save(req.params.key, parsed.values);
  res.json(seo.listAll().find((p) => p.key === req.params.key));
});

module.exports = router;
