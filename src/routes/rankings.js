const express = require('express');
const db = require('../db');
const { getRankings, SOURCE_URL } = require('../rankingsScraper');

const router = express.Router();

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

  const tables = data.tables.map((t) => ({
    key: t.key,
    label: t.label,
    pointsLabel: t.pointsLabel,
    rows: t.rows.map((r) => ({
      ...r,
      slug: bySlug[normalize(r.name)] || null,
    })),
  }));

  res.json({ fetchedAt: data.fetchedAt, sourceUrl: SOURCE_URL, tables });
});

module.exports = router;
