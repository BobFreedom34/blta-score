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
    highlight: !!row.highlight,
  };
}

// The menu has three levels at most: a main item, its sub-items, and their own sub-items (a fly-out beside the dropdown on a
// computer, an indented list on a phone). depth 1 = main item, 2 = sub-item, 3 = sub-sub-item.
const MAX_DEPTH = 3;

function depthOf(id) {
  let depth = 1;
  let row = db.prepare('SELECT parent_id FROM header_items WHERE id = ?').get(id);
  while (row && row.parent_id && depth <= MAX_DEPTH + 1) {
    depth += 1;
    row = db.prepare('SELECT parent_id FROM header_items WHERE id = ?').get(row.parent_id);
  }
  return depth;
}

// how many levels the item and everything under it take (1 = no sub-items)
function heightOf(id) {
  const kids = db.prepare('SELECT id FROM header_items WHERE parent_id = ?').all(id);
  return 1 + kids.reduce((max, k) => Math.max(max, heightOf(k.id)), 0);
}

function descendantIds(id) {
  const out = [];
  db.prepare('SELECT id FROM header_items WHERE parent_id = ?').all(id).forEach((k) => { out.push(k.id, ...descendantIds(k.id)); });
  return out;
}

// parentId is accepted when the row exists, is not the My profile row (it never renders as a dropdown) and sits high enough
// for the new item (with everything under it) to stay within three levels. `self` is the item being moved, if any.
function validateBody(body, self) {
  const labelSk = (body.labelSk || '').trim();
  const labelEn = (body.labelEn || '').trim();
  // A link is optional: an item without a real one (empty, '#' or anything that is not an address) is only a heading that opens
  // its sub-items. An empty link is stored as '#'.
  const link = (body.link || '').trim() || '#';
  if (!labelSk) return { error: 'Slovak label is required' };
  if (labelSk.length > 60) return { error: 'Label is too long' };
  if (labelEn.length > 60) return { error: 'Label is too long' };
  if (link.length > 500) return { error: 'Link is too long' };
  // no position sent = the item goes to the end of its list (the order is changed with /reorder, by dragging in the backend)
  const hasOrder = body.sortOrder !== undefined && body.sortOrder !== null && body.sortOrder !== '';
  const sortOrder = hasOrder ? (Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0) : null;
  let parentId = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    parentId = Number(body.parentId);
    if (!Number.isInteger(parentId)) return { error: 'Invalid parent item' };
    const parent = db.prepare('SELECT * FROM header_items WHERE id = ?').get(parentId);
    if (!parent) return { error: 'Parent item not found' };
    if (parent.is_my_profile) return { error: "The My profile item can't have sub-items" };
    if (self && (parent.id === self.id || descendantIds(self.id).includes(parent.id))) return { error: "An item can't be placed under itself or one of its own sub-items" };
    const below = self ? heightOf(self.id) : 1; // the levels the moved item brings with it
    if (depthOf(parent.id) + below > MAX_DEPTH) return { error: 'The menu has three levels at most (item, sub-item, sub-sub-item)' };
  }
  return { labelSk, labelEn: labelEn || null, link, sortOrder, parentId, highlight: body.highlight ? 1 : 0 };
}

// the position after the last item of a list (the main items, or the sub-items of a parent)
function nextOrder(parentId) {
  const row = parentId === null
    ? db.prepare('SELECT MAX(sort_order) AS m FROM header_items WHERE parent_id IS NULL').get()
    : db.prepare('SELECT MAX(sort_order) AS m FROM header_items WHERE parent_id = ?').get(parentId);
  return (row.m === null || row.m === undefined ? -1 : row.m) + 1;
}

// Public — the header has to render for every visitor, logged in or not,
// same as GET /badges.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM header_items ORDER BY sort_order, id').all();
  // every item carries its own `children` (nested, up to three levels deep)
  const tree = (parentId) => rows.filter((r) => (parentId === null ? !r.parent_id : r.parent_id === parentId)).map((r) => ({ ...serialize(r), children: tree(r.id) }));
  res.json(tree(null));
});

router.post('/', requireAdmin, (req, res) => {
  const parsed = validateBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const info = db.prepare(
    'INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order, highlight) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(parsed.parentId, parsed.labelSk, parsed.labelEn, parsed.link, parsed.sortOrder === null ? nextOrder(parsed.parentId) : parsed.sortOrder, parsed.highlight);
  res.status(201).json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(info.lastInsertRowid)));
});

// Puts the items of one list (the main items: parentId null; or the sub-items of a parent) in the order given: { parentId, ids }.
// ids must be exactly the items of that list, each once. The positions are written 0, 1, 2… so no gaps or ties are left.
router.post('/reorder', requireAdmin, (req, res) => {
  const body = req.body || {};
  const parentId = body.parentId === undefined || body.parentId === null || body.parentId === '' ? null : Number(body.parentId);
  if (parentId !== null && !Number.isInteger(parentId)) return res.status(400).json({ error: 'Invalid parent item' });
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const current = (parentId === null
    ? db.prepare('SELECT id FROM header_items WHERE parent_id IS NULL').all()
    : db.prepare('SELECT id FROM header_items WHERE parent_id = ?').all(parentId)).map((r) => r.id);
  if (!ids.every(Number.isInteger) || new Set(ids).size !== ids.length || ids.length !== current.length || !ids.every((id) => current.includes(id))) {
    return res.status(400).json({ error: 'The list does not match the items of that menu level' });
  }
  const set = db.prepare('UPDATE header_items SET sort_order = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => set.run(index, id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM header_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Header item not found' });

  // My profile's label/link/parent aren't real settings (see the seed
  // comment in db.js) — only where it sits among the other items is.
  if (item.is_my_profile) {
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) && req.body.sortOrder !== null && req.body.sortOrder !== '' ? Number(req.body.sortOrder) : item.sort_order;
    db.prepare('UPDATE header_items SET sort_order = ? WHERE id = ?').run(sortOrder, item.id);
    return res.json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(item.id)));
  }

  const parsed = validateBody(req.body, item);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  // no position sent: the item keeps its place, or goes last when it moves to another list
  const moved = (parsed.parentId || null) !== (item.parent_id || null);
  const sortOrder = parsed.sortOrder !== null ? parsed.sortOrder : (moved ? nextOrder(parsed.parentId) : item.sort_order);
  db.prepare(
    'UPDATE header_items SET parent_id = ?, label_sk = ?, label_en = ?, link = ?, sort_order = ?, highlight = ? WHERE id = ?'
  ).run(parsed.parentId, parsed.labelSk, parsed.labelEn, parsed.link, sortOrder, parsed.highlight, item.id);
  res.json(serialize(db.prepare('SELECT * FROM header_items WHERE id = ?').get(item.id)));
});

// Deletes the item's own sub-items (at every level) along with it — a dangling parent_id pointing at a row that no longer
// exists has no useful meaning here.
router.delete('/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM header_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Header item not found' });
  if (item.is_my_profile) return res.status(400).json({ error: "The My profile item can't be deleted" });
  [item.id, ...descendantIds(item.id)].forEach((id) => db.prepare('DELETE FROM header_items WHERE id = ?').run(id));
  res.status(204).end();
});

module.exports = router;
