const express = require('express');
const seo = require('../seo');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Backend > SEO: every page with its addresses (slugs) and meta texts in both languages, and the first values to reset to.
router.get('/', requireAdmin, (req, res) => res.json(seo.listAll()));

router.put('/:key', requireAdmin, (req, res) => {
  const page = seo.BY_KEY.get(req.params.key);
  if (!page) return res.status(404).json({ error: 'Unknown page' });
  const parsed = seo.parseBody(page, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  seo.save(page, parsed);
  res.json(seo.listAll().find((p) => p.key === page.key));
});

module.exports = router;
