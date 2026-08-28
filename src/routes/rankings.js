const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { getRankings, SOURCE_URL } = require('../rankingsScraper');

const router = express.Router();

const TABLE_KEYS = ['blta', 'elite_race', 'next_gen_race', 'novice_race', 'tournaments'];

// Same normalization the blta.sk page itself uses (see the player-linking
// script embedded there) so a name matches regardless of accents/case/
// apostrophe style — kept here rather than shared, since that script lives
// in WordPress, not this repo.
function normalize(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['''‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

router.get('/', async (req, res) => {
  let data;
  try {
    data = await getRankings();
  } catch (err) {
    return res.status(502).json({ error: `Could not load rankings from ${SOURCE_URL}: ${err.message}` });
  }

  const players = db.prepare('SELECT id, name, slug FROM players').all();
  const bySlug = {};
  players.forEach((p) => { bySlug[normalize(p.name)] = p.slug; });

  const overrides = db.prepare('SELECT table_key, player_name, points FROM ranking_overrides').all();
  const byOverrideKey = {};
  overrides.forEach((o) => { byOverrideKey[`${o.table_key} ${o.player_name}`] = o.points; });

  const tables = data.tables.map((t) => ({
    key: t.key,
    label: t.label,
    pointsLabel: t.pointsLabel,
    rows: t.rows.map((r) => {
      const overrideKey = `${t.key} ${normalize(r.name)}`;
      const hasOverride = Object.prototype.hasOwnProperty.call(byOverrideKey, overrideKey);
      return {
        ...r,
        slug: bySlug[normalize(r.name)] || null,
        points: hasOverride ? byOverrideKey[overrideKey] : r.points,
        overridden: hasOverride,
      };
    }),
  }));

  res.json({ fetchedAt: data.fetchedAt, sourceUrl: SOURCE_URL, tables });
});

// Admin-only manual override for one player's points in one table — takes
// permanent precedence over whatever blta.sk shows for that name, until
// cleared (see DELETE below). Keyed by normalized name rather than a local
// player id, since a scraped row doesn't always resolve to one.
router.put('/override/:tableKey/:name', requireAdmin, (req, res) => {
  const { tableKey } = req.params;
  const name = decodeURIComponent(req.params.name);
  if (!TABLE_KEYS.includes(tableKey)) {
    return res.status(400).json({ error: 'Unknown ranking table' });
  }
  if (!name.trim()) {
    return res.status(400).json({ error: 'Player name is required' });
  }

  let points = null;
  if (req.body.points !== null && req.body.points !== undefined && req.body.points !== '') {
    points = Number(req.body.points);
    if (!Number.isInteger(points)) {
      return res.status(400).json({ error: 'Points must be a whole number' });
    }
  }

  const key = normalize(name);
  const ts = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM ranking_overrides WHERE table_key = ? AND player_name = ?').get(tableKey, key);
  if (existing) {
    db.prepare('UPDATE ranking_overrides SET points = ?, updated_at = ? WHERE id = ?').run(points, ts, existing.id);
  } else {
    db.prepare('INSERT INTO ranking_overrides (table_key, player_name, points, updated_at) VALUES (?, ?, ?, ?)')
      .run(tableKey, key, points, ts);
  }
  res.json({ ok: true, points });
});

// Clears a manual override, reverting that row back to whatever blta.sk
// itself shows on the next refresh.
router.delete('/override/:tableKey/:name', requireAdmin, (req, res) => {
  const { tableKey } = req.params;
  const name = decodeURIComponent(req.params.name);
  db.prepare('DELETE FROM ranking_overrides WHERE table_key = ? AND player_name = ?').run(tableKey, normalize(name));
  res.json({ ok: true });
});

module.exports = router;
