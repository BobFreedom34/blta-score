// One-off: the app takes over the ranking tables. Runs once (flag in app_flags), at the first start after the switch:
//   1. the numbers of blta.sk as they were on the day (src/rankingsBaseline.json, a saved copy: nothing is read from blta.sk any
//      more) become the app's own tables. The admin corrections the old rankings page had (ranking_overrides) are applied on
//      top, as that page showed them; every row is tied to the player of the same name when there is one;
//   2. the matches whose points were already sent to blta.sk (they have a ranking_points_snapshot) get their rows in the ledger
//      (ranking_awards) so that a later correction or delete takes back exactly their points — their points are already in the
//      saved numbers, so nothing is added. A match that finished after the copy was taken (end_time later than capturedAt) is not
//      in the numbers yet: its points are added now.
// After that the tables only change through finished matches (src/rankingPoints.js) and the admin's edits.
const nameMatch = require('./nameMatch');
const points = require('./rankingPoints');
const baseline = require('./rankingsBaseline.json');

function seedRankings(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'rankings_local'").get()) return { skipped: true };

  const players = db.prepare('SELECT id, name FROM players').all();
  const byKey = new Map(players.map((p) => [points.normalizeName(p.name), p]));
  const overrides = new Map(db.prepare('SELECT table_key, player_name, points FROM ranking_overrides').all()
    .map((o) => [`${o.table_key} ${points.normalizeName(o.player_name)}`, o.points]));
  const insert = db.prepare('INSERT INTO ranking_entries (table_key, player_id, name, name_key, points, matches, position) VALUES (?, ?, ?, ?, ?, ?, ?)');

  let rows = 0;
  let unmatched = 0;
  let backfilled = 0;
  let added = 0;
  db.exec('BEGIN');
  try {
    baseline.tables.forEach((table) => {
      table.rows.forEach((row, index) => {
        const key = points.normalizeName(row.name);
        const player = byKey.get(key) || nameMatch.findSimilar(row.name, players).exact || null;
        if (!player) unmatched += 1;
        const overrideKey = `${table.key} ${key}`;
        const value = overrides.has(overrideKey) ? overrides.get(overrideKey) : row.points;
        insert.run(table.key, player ? player.id : null, player ? player.name : row.name, key, value, row.matches || 0, index);
        rows += 1;
      });
    });

    const awarded = db.prepare("SELECT * FROM matches WHERE status = 'FINISHED' AND ranking_points_snapshot IS NOT NULL ORDER BY id").all();
    awarded.forEach((match) => {
      const computed = points.computeAwards(match);
      if (!computed) return;
      const afterCopy = match.end_time && match.end_time > baseline.capturedAt;
      points.recordAwards(match.id, computed, !afterCopy);
      if (afterCopy) added += 1; else backfilled += 1;
    });

    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('rankings_local')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[rankings] own tables ready: ${rows} rows from the saved copy of ${baseline.capturedAt} (${unmatched} names without a player), ${backfilled} earlier matches in the ledger, ${added} newer matches added`);
  return { rows, unmatched, backfilled, added };
}

module.exports = { seedRankings };
