const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { computeGroupStandings } = require('../standings');

const router = express.Router();

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'season';
}

function uniqueSlug(base, exceptId) {
  let slug = base;
  let n = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(slug);
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Dates must look like 2026-09-07' };
  return { value };
}

function serializeGroup(g) {
  return {
    id: g.id,
    seasonId: g.season_id,
    name: g.name,
    category: g.category,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE group_id = ?').get(g.id).n,
  };
}

function serializeSeason(s) {
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(s.id);
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    startDate: s.start_date,
    endDate: s.end_date,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ?').get(s.id).n,
    groups: groups.map(serializeGroup),
  };
}

// Public: the match page and its admin editor read this (newest season first).
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM seasons ORDER BY COALESCE(start_date, \'\') DESC, id DESC').all();
  res.json(rows.map(serializeSeason));
});

// Public: the group tables of one season, calculated from the matches tagged with each group (see standings.js).
// Recalculated on every request, so it is always in step with the matches.
router.get('/:id/standings', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id);
  const players = new Map();
  const playerStmt = db.prepare('SELECT id, name, slug FROM players WHERE id = ?');
  const result = groups.map((g) => {
    const rows = db.prepare('SELECT player1_id, player2_id, winner_id, status, end_reason, state FROM matches WHERE group_id = ?').all(g.id);
    const records = rows.map((r) => {
      [r.player1_id, r.player2_id].forEach((pid) => { if (!players.has(pid)) players.set(pid, playerStmt.get(pid)); });
      return { player1Id: r.player1_id, player2Id: r.player2_id, winnerId: r.winner_id, status: r.status, endReason: r.end_reason, state: JSON.parse(r.state) };
    });
    const table = computeGroupStandings(records, players);
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      matchesCounted: records.filter((r) => r.status === 'FINISHED').length,
      matchesTotal: records.length,
      rows: table.map((x) => ({
        position: x.position,
        player: { id: x.player.id, name: x.player.name, slug: x.player.slug },
        points: x.points,
        played: x.played,
        wins: x.wins,
        losses: x.losses,
        setDiff: x.setDiff,
      })),
    };
  });
  res.json({ id: season.id, name: season.name, slug: season.slug, startDate: season.start_date, endDate: season.end_date, groups: result });
});

router.post('/', requireAdmin, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
  const start = parseDate(req.body.startDate);
  const end = parseDate(req.body.endDate);
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  if (start.value && end.value && start.value > end.value) return res.status(400).json({ error: 'The end date is before the start date' });
  const slug = uniqueSlug(slugify(name));
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM seasons').get().m;
  const info = db.prepare('INSERT INTO seasons (name, slug, start_date, end_date, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(name, slug, start.value, end.value, maxOrder + 1);
  res.status(201).json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : season.name;
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
  const start = req.body.startDate !== undefined ? parseDate(req.body.startDate) : { value: season.start_date };
  const end = req.body.endDate !== undefined ? parseDate(req.body.endDate) : { value: season.end_date };
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  if (start.value && end.value && start.value > end.value) return res.status(400).json({ error: 'The end date is before the start date' });
  db.prepare('UPDATE seasons SET name = ?, start_date = ?, end_date = ? WHERE id = ?').run(name, start.value, end.value, season.id);
  res.json(serializeSeason(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id)));
});

// Deleting a season deletes its groups and clears the season/group on the matches that had them
// (the matches themselves are untouched).
router.delete('/:id', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  db.prepare('UPDATE matches SET group_id = NULL WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
  res.json({ ok: true });
});

function parseGroup(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Group name is required' };
  if (name.length > 80) return { error: 'Group name is too long (max 80 characters)' };
  if (!BLTA_CATEGORIES.includes(body.category)) return { error: 'Every group needs a category: ELITE, NEXT_GEN or NOVICE' };
  return { name, category: body.category };
}

router.post('/:id/groups', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const parsed = parseGroup(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT 1 FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(season.id, parsed.name)) {
    return res.status(409).json({ error: 'This season already has a group with that name' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM season_groups WHERE season_id = ?').get(season.id).m;
  const info = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)')
    .run(season.id, parsed.name, parsed.category, maxOrder + 1);
  res.status(201).json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/groups/:groupId', requireAdmin, (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const parsed = parseGroup({ name: req.body.name !== undefined ? req.body.name : group.name, category: req.body.category !== undefined ? req.body.category : group.category });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const clash = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(group.season_id, parsed.name);
  if (clash && clash.id !== group.id) return res.status(409).json({ error: 'This season already has a group with that name' });
  db.prepare('UPDATE season_groups SET name = ?, category = ? WHERE id = ?').run(parsed.name, parsed.category, group.id);
  // A match must stay in a group of its own category: changing the group's category un-tags the other ones.
  db.prepare('UPDATE matches SET group_id = NULL WHERE group_id = ? AND category != ?').run(group.id, parsed.category);
  res.json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(group.id)));
});

router.delete('/groups/:groupId', requireAdmin, (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  db.prepare('DELETE FROM season_groups WHERE id = ?').run(group.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.BLTA_CATEGORIES = BLTA_CATEGORIES;
