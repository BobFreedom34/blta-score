const express = require('express');
const db = require('../db');
const rules = require('../rules');
const { requireAdmin } = require('../auth');

const router = express.Router();

function parseBody(body) {
  const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
  const navLabel = typeof body.navLabel === 'string' ? body.navLabel.replace(/\s+/g, ' ').trim() : '';
  if (!title) return { error: 'The title is required' };
  if (title.length > 120) return { error: 'The title is too long (max 120 characters)' };
  if (navLabel.length > 40) return { error: 'The menu label is too long (max 40 characters)' };
  const raw = typeof body.html === 'string' ? body.html : '';
  if (raw.length > 80000) return { error: 'The text is too long' };
  return { title, navLabel, html: rules.sanitize(raw).trim() };
}

router.get('/', requireAdmin, (req, res) => res.json(rules.list()));

router.post('/', requireAdmin, (req, res) => {
  const parsed = parseBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM rules_sections').get().m ?? -1) + 1;
  const slug = rules.uniqueSlug(rules.slugify(parsed.navLabel || parsed.title));
  const info = db.prepare('INSERT INTO rules_sections (slug, nav_label, title, body_html, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(slug, parsed.navLabel, parsed.title, parsed.html, next);
  res.status(201).json(rules.serialize(db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  const parsed = parseBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare('UPDATE rules_sections SET title = ?, nav_label = ?, body_html = ? WHERE id = ?').run(parsed.title, parsed.navLabel, parsed.html, row.id);
  res.json(rules.serialize(db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(row.id)));
});

// Swaps the section with its neighbour.
router.post('/:id/move', requireAdmin, (req, res) => {
  const all = db.prepare('SELECT id FROM rules_sections ORDER BY sort_order, id').all().map((r) => r.id);
  const i = all.indexOf(Number(req.params.id));
  if (i < 0) return res.status(404).json({ error: 'Section not found' });
  const j = req.body && req.body.dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return res.json(rules.list());
  [all[i], all[j]] = [all[j], all[i]];
  const set = db.prepare('UPDATE rules_sections SET sort_order = ? WHERE id = ?');
  all.forEach((id, n) => set.run(n, id));
  res.json(rules.list());
});

// Puts a section that came with the page back to its first text.
router.post('/:id/reset', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  const first = rules.seed.find((s) => s.slug === row.slug);
  if (!first) return res.status(400).json({ error: 'This section has no first text' });
  db.prepare('UPDATE rules_sections SET title = ?, nav_label = ?, body_html = ? WHERE id = ?').run(first.title, first.navLabel, first.body, row.id);
  res.json(rules.serialize(db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(row.id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM rules_sections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  db.prepare('DELETE FROM rules_sections WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = router;
