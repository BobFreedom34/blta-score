// One-off: the play-off brackets of the Winter Opening Series 2026 (Elite 16, Next Gen 8, Novice 8 players) with all their results. They were
// played on Rankedin and shown on the old blta.sk (src/winter2026PlayoffData.json holds the three draws as they were). Runs once (flag in
// app_flags); after that the brackets are managed in Backend > Brackets and are never re-created, even if an admin deletes them.
//
// The brackets are historical: no `matches` rows are created, so rankings, CourtIQ and player statistics do not change — each result is a
// hand-entered result on the bracket. All or nothing: when the season or any player cannot be found (or two players have the same name), nothing
// is written and the next start tries again.
const nameMatch = require('./nameMatch');
const bracketEngine = require('./bracketEngine');
const DATA = require('./winter2026PlayoffData.json');

const FLAG = 'winter_2026_playoffs_seeded';
const TITLES = { ELITE: 'Elite Play-off', NEXT_GEN: 'Next Gen Play-off', NOVICE: 'Novice Play-off' };

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

function seedWinter2026Playoffs(db, log = console.log) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(FLAG)) return { skipped: true };

  const seasons = db.prepare('SELECT id, name FROM seasons').all().filter((s) => String(s.name).toLowerCase() === DATA.season.toLowerCase());
  if (seasons.length !== 1) { log(`Winter 2026 play-offs: ${seasons.length ? 'the season name is not unique' : 'the season is not there yet'} — will retry on next start`); return { skipped: true }; }
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
  Object.values(DATA.brackets).forEach((matches) => matches.forEach((m) => [m.p1, m.p2, m.winner].forEach(resolve)));
  if (problems.length) {
    log(`Winter 2026 play-offs: not written, no single player found for ${[...new Set(problems)].join(', ')} — will retry on next start`);
    return { skipped: true };
  }

  const have = new Set(db.prepare('SELECT category FROM brackets WHERE season_id = ?').all(seasonId).map((b) => b.category));
  const created = [];
  db.exec('BEGIN');
  try {
    for (const [category, matches] of Object.entries(DATA.brackets)) {
      if (have.has(category)) continue;
      const seeds = new Map();
      matches.filter((m) => m.round === 1).forEach((m) => { seeds.set(m.p1, m.seed1); seeds.set(m.p2, m.seed2); });
      const entries = [...seeds.entries()].map(([typed, seed]) => ({ playerId: resolve(typed), seed }));
      const bracketId = bracketEngine.createBracket({
        name: TITLES[category], format: 'BO3', entries, autoCreateMatches: false, category, seasonId,
      });
      for (const m of [...matches].sort((a, b) => a.round - b.round || a.order - b.order)) {
        const pair = [resolve(m.p1), resolve(m.p2)].sort().join();
        const node = bracketEngine.getBracketTree(bracketId).nodes
          .find((n) => n.round === m.round && n.player1_id && n.player2_id && [n.player1_id, n.player2_id].sort().join() === pair);
        if (!node) throw new Error(`${category}: no slot for ${m.p1} vs ${m.p2} in round ${m.round} — the seeding differs from the original draw`);
        bracketEngine.recordManualResult(node.id, resolve(m.winner), m.score);
      }
      created.push(TITLES[category]);
    }
    db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(FLAG);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { created };
}

module.exports = { seedWinter2026Playoffs };
