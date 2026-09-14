const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    labelSk: row.label_sk,
    labelEn: row.label_en,
    link: row.link,
    sortOrder: row.sort_order,
    isMyProfile: !!row.is_my_profile,
  };
}

// parentId is only accepted here as "does this row exist and is it itself
// a top-level item" — a sub-item can't have its own sub-items (one level of
// nesting, matching the .nav-submenu dropdown this actually renders into,
// which has nowhere to put a third tier) — and it can't be the My profile
// row either, which never renders as a dropdown.
function validateBody(body) {
  const labelSk = (body.labelSk || '').trim();
  const labelEn = (body.labelEn || '').trim();
  const link = (body.link || '').trim();
  if (!labelSk) return { error: 'Slovak label is required' };
  if (labelSk.length > 60) return { error: 'Label is too long' };
  if (labelEn.length > 60) return { error: 'Label is too long' };
  if (!link) return { error: 'Link is required' };
  if (link.length > 500) return { error: 'Link is too long' };
  const sortOrder = Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  let parentId = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    parentId = Number(body.parentId);
    if (!Number.isInteger(parentId)) return { error: 'Invalid parent item' };
    const parent = db.prepare('SELECT * FROM header_items WHERE id = ?').get(parentId);
    if (!parent) return { error: 'Parent item not found' };
    if (parent.parent_id) return { error: "Sub-items can't have their own sub-items" };
    if (parent.is_my_profile) return { error: "The My profile item can't have sub-items" };
  }
  return { labelSk, labelEn: labelEn || null, link, sortOrder, parentId };
}

// Public — the header has to render for every visitor, logged in or not,
// same as GET /badges.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM header_items ORDER BY sort_order, id').all();
  const items = rows.filter((r) => !r.parent_id).map(serialize);
  items.forEach((item) => {
    item.children = rows.filter((r) => r.parent_id === item.id).map(serialize);
  });
  res.json(items);
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const info = db.prepare(
    'INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(parsed.parentId, parsed.labelSk, parsed.labelEn, parsed.link, parsed.sortOrder);
  res.status(201).json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM header_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Header item not found' });

  // My profile's label/link/parent aren't real settings (see the seed
  // comment in db.js) — only where it sits among the other items is.
  if (item.is_my_profile) {
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : item.sort_order;
    db.prepare('UPDATE header_items SET sort_order = ? WHERE id = ?').run(sortOrder, item.id);
    return res.json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(item.id)));
  }

  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (parsed.parentId === item.id) return res.status(400).json({ error: 'An item cannot be its own parent' });
  // A top-level item that already has sub-items of its own can't become a
  // sub-item itself — that would either orphan its children or require
  // moving them too, neither of which this simple admin tool does.
  if (parsed.parentId && !item.parent_id) {
    const hasChildren = db.prepare('SELECT COUNT(*) AS c FROM header_items WHERE parent_id = ?').get(item.id).c;
    if (hasChildren) return res.status(400).json({ error: 'This item has its own sub-items — remove those first' });
  }
  db.prepare(
    'UPDATE header_items SET parent_id = ?, label_sk = ?, label_en = ?, link = ?, sort_order = ? WHERE id = ?'
  ).run(parsed.parentId, parsed.labelSk, parsed.labelEn, parsed.link, parsed.sortOrder, item.id);
  res.json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(item.id)));
});

// Deletes the item's own sub-items along with it — a dangling parent_id
// pointing at a row that no longer exists has no useful meaning here.
router.delete('/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM header_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Header item not found' });
  if (item.is_my_profile) return res.status(400).json({ error: "The My profile item can't be deleted" });
  db.prepare('DELETE FROM header_items WHERE id = ? OR parent_id = ?').run(item.id, item.id);
  res.status(204).end();
});

module.exports = router;
