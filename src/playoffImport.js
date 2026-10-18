// Shared by the one-off seeds of old play-off brackets (winter2026PlayoffSeed.js, nulty2025PlayoffSeed.js): the draws were played on Rankedin and
// are kept as plain data (the three/one draw as it was: round, position, players, winner, score).
//
// The brackets are historical: no `matches` rows are created, so rankings, CourtIQ and player statistics do not change — each result is a
// hand-entered result on the bracket. All or nothing: when the season or any player cannot be found (or two players have the same name), nothing
// is written and the next start tries again. Runs once (flag in app_flags); after that the brackets are managed in Backend > Brackets and are
// never re-created, even if an admin deletes them.
const nameMatch = require('./nameMatch');
const bracketEngine = require('./bracketEngine');

// Rankedin shows the nicknames the players use; the app has the full first names
const ALIASES = {
  'Paľo Piroha': 'Pavol Piroha',
  'Paľo Blahút': 'Pavol Blahut',
  'Robo Sloboda': 'Róbert Sloboda',
  'Peťo Hladký': 'Peter Hladký',
  'Braňo Bložon': 'Branislav Bložon',
  'Kubo Paločný': 'Jakub Paločný',
  'Jano Szalay': 'Jan Szalay',
};

// { flag, label, data: { season, brackets: { CATEGORY: [matches] } }, titles: { CATEGORY: 'name of the bracket' } }
// A draw with seeds (seed1/seed2 in round 1) is built from them; one without (drawn by lot) is seated slot by slot, in the order of the draw.
function importPlayoffs(db, { flag, label, data, titles }, log = console.log) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(flag)) return { skipped: true };

  const seasons = db.prepare('SELECT id, name FROM seasons').all().filter((s) => String(s.name).toLowerCase() === data.season.toLowerCase());
  if (seasons.length !== 1) { log(`${label}: ${seasons.length ? 'the season name is not unique' : 'the season is not there yet'} — will retry on next start`); return { skipped: true }; }
  const seasonId = seasons[0].id;

  // every name of the draws → exactly one player
  const byKey = new Map();
  db.prepare('SELECT id, name FROM players').all().forEach((p) => {
    const k = nameMatch.key(p.name);
    byKey.set(k, byKey.has(k) ? null : p.id);
  });
  const problems = [];
  const resolve = (typed) => {
    const id = byKey.get(nameMatch.key(ALIASES[typed] || typed));
    if (!id) problems.push(typed);
    return id;
  };
  Object.values(data.brackets).forEach((matches) => matches.forEach((m) => [m.p1, m.p2, m.winner].forEach(resolve)));
  if (problems.length) {
    log(`${label}: not written, no single player found for ${[...new Set(problems)].join(', ')} — will retry on next start`);
    return { skipped: true };
  }

  const have = new Set(db.prepare('SELECT category FROM brackets WHERE season_id = ?').all(seasonId).map((b) => b.category));
  const created = [];
  db.exec('BEGIN');
  try {
    for (const [category, matches] of Object.entries(data.brackets)) {
      if (have.has(category)) continue;
      const first = matches.filter((m) => m.round === 1);
      const seeded = first.every((m) => Number.isInteger(m.seed1) && Number.isInteger(m.seed2));
      let bracketId;
      if (seeded) {
        const seeds = new Map();
        first.forEach((m) => { seeds.set(m.p1, m.seed1); seeds.set(m.p2, m.seed2); });
        const entries = [...seeds.entries()].map(([typed, seed]) => ({ playerId: resolve(typed), seed }));
        bracketId = bracketEngine.createBracket({
          name: titles[category], format: 'BO3', entries, autoCreateMatches: false, category, seasonId,
        });
      } else {
        bracketId = bracketEngine.createBracket({
          name: titles[category], format: 'BO3', entries: null, size: first.length * 2, autoCreateMatches: false, category, seasonId,
        });
        for (const m of first) {
          const slot = bracketEngine.getBracketTree(bracketId).nodes.find((n) => n.round === 1 && n.position === m.order - 1);
          if (!slot) throw new Error(`${category}: no slot ${m.order} in round 1`);
          bracketEngine.setSlotPlayers(slot.id, resolve(m.p1), resolve(m.p2));
        }
      }
      for (const m of [...matches].sort((a, b) => a.round - b.round || a.order - b.order)) {
        const pair = [resolve(m.p1), resolve(m.p2)].sort().join();
        const node = bracketEngine.getBracketTree(bracketId).nodes
          .find((n) => n.round === m.round && n.player1_id && n.player2_id && [n.player1_id, n.player2_id].sort().join() === pair);
        if (!node) throw new Error(`${category}: no slot for ${m.p1} vs ${m.p2} in round ${m.round} — the draw differs from the original one`);
        bracketEngine.recordManualResult(node.id, resolve(m.winner), m.score);
      }
      created.push(titles[category]);
    }
    db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(flag);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { created };
}

module.exports = { importPlayoffs };
