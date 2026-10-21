// /api/faq — the questions and answers of the national page (slta.sk). Public: the list, in the order of the page. Super admin (Backend > Q&A):
// add, change, remove and re-order. They belong to the whole site, not to a city, so a city admin cannot touch them.
const express = require('express');
const faq = require('../faq');
const { requireSuperAdmin } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => res.json({ items: faq.list() }));

router.post('/', requireSuperAdmin, (req, res) => {
  const r = faq.add(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.status(201).json({ items: faq.list(), id: r.id });
});

router.put('/order', requireSuperAdmin, (req, res) => res.json({ items: faq.reorder(req.body && req.body.ids) }));

router.put('/:id', requireSuperAdmin, (req, res) => {
  const r = faq.update(Number(req.params.id), req.body);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json({ items: faq.list() });
});

router.delete('/:id', requireSuperAdmin, (req, res) => {
  if (!faq.remove(Number(req.params.id))) return res.status(404).json({ error: 'Not found' });
  res.json({ items: faq.list() });
});

module.exports = router;
