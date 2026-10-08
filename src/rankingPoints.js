// The ranking tables of the app and the points that go into them (the league's own points rules, see the Propozície).
//
// Tables: BLTA overall, Elite / Next Gen / Novice race, Tournaments. A finished BLTA match (category ELITE, NEXT_GEN or
// NOVICE — friendlies, VIP cups and the like earn nothing) adds points to both players, in the overall BLTA table and in the
// race table of the match's category:
//
//   base points per match   win 2:0 → 3, win 2:1 → 2, loss 1:2 → 1, loss 0:2 → 0
//   multiplied by the level Elite × 10, Next Gen × 7, Novice × 4   (so 2:0 in Elite is 30 points, a 2:1 loss in Novice is 4)
//
// A walkover or a retirement counts as a clean 2:0 for the winner (3 base points) and 0 for the loser. Only matches decided in
// two sets earn points (a best-of-1 or best-of-5 match earns nothing).
//
// Every award is written to ranking_awards, so a corrected score, a restarted match or a deleted match takes back exactly what
// that match added before anything new is awarded: reconcile() is safe to call any number of times for the same match.
const db = require('./db');
const engine = require('./matchEngine');
const nameMatch = require('./nameMatch');

// order = the order of the tabs on the rankings page
const TABLES = [
  { key: 'blta', label: 'BLTA', pointsLabel: 'BLTA Points', sequentialRanks: true },
  { key: 'elite_race', label: 'Elite Race', pointsLabel: 'Elite Race' },
  { key: 'next_gen_race', label: 'Next Gen Race', pointsLabel: 'Next Gen Race' },
  { key: 'novice_race', label: 'Novice Race', pointsLabel: 'Novice Race' },
  { key: 'tournaments', label: 'Tournaments', pointsLabel: 'Tournament Points' },
];
const TABLE_KEYS = TABLES.map((t) => t.key);

const CATEGORY_RULES = {
  ELITE: { coefficient: 10, raceTable: 'elite_race' },
  NEXT_GEN: { coefficient: 7, raceTable: 'next_gen_race' },
  NOVICE: { coefficient: 4, raceTable: 'novice_race' },
};

const BASE_POINTS = { winStraight: 3, winThree: 2, lossThree: 1, lossStraight: 0 };

// Same normalisation the rest of the app uses to match a name regardless of accents, case and apostrophes.
function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sets won by each player; a forfeit counts as a clean sweep for the winner. null when nothing is decided.
function setsOf(match) {
  let state;
  try { state = JSON.parse(match.state); } catch { return null; }
  const won = state.setsWon || {};
  let s1 = Number(won[1] || 0);
  let s2 = Number(won[2] || 0);
  const isForfeit = (match.end_reason === 'WALKOVER' || match.end_reason === 'RETIREMENT') && match.winner_id;
  const format = engine.FORMATS[match.format];
  if (isForfeit && format && Number.isFinite(format.setsToWin)) {
    const firstWon = match.winner_id === match.player1_id;
    s1 = firstWon ? format.setsToWin : 0;
    s2 = firstWon ? 0 : format.setsToWin;
  }
  return { s1, s2 };
}

// What a match is worth: null when it earns nothing, else { category, tableKeys, awards: [{ playerId, points }] }.
function computeAwards(match) {
  const rule = CATEGORY_RULES[String(match.category || '').toUpperCase()];
  if (!rule) return null;
  const sets = setsOf(match);
  if (!sets) return null;
  const max = Math.max(sets.s1, sets.s2);
  const min = Math.min(sets.s1, sets.s2);
  if (max !== 2 || min > 1) return null;
  const straight = min === 0;
  const winnerPoints = (straight ? BASE_POINTS.winStraight : BASE_POINTS.winThree) * rule.coefficient;
  const loserPoints = (straight ? BASE_POINTS.lossStraight : BASE_POINTS.lossThree) * rule.coefficient;
  const firstWon = sets.s1 > sets.s2;
  return {
    category: String(match.category).toUpperCase(),
    tableKeys: ['blta', rule.raceTable],
    awards: [
      { playerId: firstWon ? match.player1_id : match.player2_id, points: winnerPoints },
      { playerId: firstWon ? match.player2_id : match.player1_id, points: loserPoints },
    ],
  };
}

// ---------------------------------------------------------------- entries

// The row of a player in a table. When there is none it is made — unless `create` is false (then null).
function entryFor(tableKey, playerId, create = true) {
  const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(playerId);
  if (!player) return null;
  const key = normalizeName(player.name);
  let entry = db.prepare('SELECT * FROM ranking_entries WHERE table_key = ? AND player_id = ?').get(tableKey, player.id)
    || db.prepare('SELECT * FROM ranking_entries WHERE table_key = ? AND name_key = ?').get(tableKey, key);
  if (!entry) {
    if (!create) return null;
    const next = (db.prepare('SELECT MAX(position) AS m FROM ranking_entries WHERE table_key = ?').get(tableKey).m ?? -1) + 1;
    const info = db.prepare('INSERT INTO ranking_entries (table_key, player_id, name, name_key, points, matches, position) VALUES (?, ?, ?, ?, NULL, 0, ?)')
      .run(tableKey, player.id, player.name, key, next);
    entry = db.prepare('SELECT * FROM ranking_entries WHERE id = ?').get(info.lastInsertRowid);
  } else if (entry.player_id !== player.id) {
    db.prepare('UPDATE ranking_entries SET player_id = ?, name = ? WHERE id = ?').run(player.id, player.name, entry.id);
    entry = { ...entry, player_id: player.id, name: player.name };
  }
  return entry;
}

// Writes the ledger rows of a match; changes the points of the tables too unless `ledgerOnly` (the points are already in the
// numbers — used when the ledger of matches awarded before the switch is rebuilt, see rankingsSeed.js; a player who has no row
// in a table then gets no ledger row either, there is nothing of his to take back). Callers wrap this in a transaction.
function recordAwards(matchId, computed, ledgerOnly, collect) {
  const touchPoints = db.prepare("UPDATE ranking_entries SET points = COALESCE(points, 0) + ?, matches = matches + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  const ledger = db.prepare('INSERT INTO ranking_awards (match_id, entry_id, points, matches_delta) VALUES (?, ?, ?, 1)');
  computed.tableKeys.forEach((tableKey) => {
    computed.awards.forEach((award) => {
      const entry = entryFor(tableKey, award.playerId, !ledgerOnly);
      if (!entry) return;
      if (!ledgerOnly) touchPoints.run(award.points, entry.id);
      ledger.run(matchId, entry.id, award.points);
      if (collect) collect.push({ entry_id: entry.id, points: award.points, added: true });
    });
  });
}

// Takes back everything a match added (nothing happens when it added nothing). Callers wrap this in a transaction.
function reverseRows(matchId, collect) {
  const rows = db.prepare('SELECT * FROM ranking_awards WHERE match_id = ?').all(matchId);
  if (collect) rows.forEach((r) => collect.push({ entry_id: r.entry_id, points: -r.points }));
  const undo = db.prepare("UPDATE ranking_entries SET points = COALESCE(points, 0) - ?, matches = MAX(0, matches - ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  rows.forEach((r) => undo.run(r.points, r.matches_delta, r.entry_id));
  if (rows.length) db.prepare('DELETE FROM ranking_awards WHERE match_id = ?').run(matchId);
  return rows.length;
}

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Brings the tables in line with a match as it is now: what it added before is taken back, then, when it is FINISHED, what it is
// worth now is added. (previousRow is only there so the callers can keep passing "before" and "after".)
// Returns what changed in the tables: [{ tableKey, tableLabel, name, before, after, delta }] — the net change per player and table
// (a corrected result that is worth the same again changes nothing and returns nothing). The change log (src/changeLog.js) shows it.
function reconcile(previousRow, updatedRow) {
  return inTransaction(() => {
    const moves = [];
    reverseRows(updatedRow.id, moves);
    if (updatedRow.status === 'FINISHED') {
      const computed = computeAwards(updatedRow);
      if (computed) recordAwards(updatedRow.id, computed, false, moves);
    }
    return netChanges(moves);
  });
}

// For a match that is being deleted.
function reverseForMatch(matchId) {
  return inTransaction(() => reverseRows(matchId));
}

// Same, and says what the tables lost (see reconcile).
function reverseForMatchWithChanges(matchId) {
  return inTransaction(() => {
    const moves = [];
    reverseRows(matchId, moves);
    return netChanges(moves);
  });
}

// moves: [{ entry_id, points }] (points negative for what was taken back) -> the net change per ranking row, with the numbers before
// and after (read now, after the change).
function netChanges(moves) {
  const net = new Map();
  moves.forEach((m) => net.set(m.entry_id, (net.get(m.entry_id) || 0) + m.points));
  const out = [];
  net.forEach((delta, entryId) => {
    if (!delta) return;
    const e = db.prepare('SELECT e.table_key, e.points, COALESCE(p.name, e.name) AS name FROM ranking_entries e LEFT JOIN players p ON p.id = e.player_id WHERE e.id = ?').get(entryId);
    if (!e) return;
    const table = TABLES.find((t) => t.key === e.table_key);
    const after = e.points === null ? 0 : e.points;
    out.push({ tableKey: e.table_key, tableLabel: table ? table.label : e.table_key, name: e.name, before: after - delta, after, delta });
  });
  return out;
}

// ---------------------------------------------------------------- reading and editing

// Players with points first (most points first), those without last; equal points keep the order the rows came in.
function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const av = a.points === null ? -Infinity : a.points;
    const bv = b.points === null ? -Infinity : b.points;
    if (av !== bv) return bv - av;
    return a.position - b.position;
  });
}

// BLTA overall: 1, 2, 3 … in that order (a tie is settled by the order the rows came in, as blta.sk did);
// the other tables: players with equal points share a rank, the next rank skips (1, 2, 2, 4).
function rankRows(sorted, sequential) {
  let rank = 0;
  let last;
  return sorted.map((r, i) => {
    if (sequential) rank = i + 1;
    else if (r.points !== last || i === 0) { rank = i + 1; last = r.points; }
    return { ...r, rank };
  });
}

// All tables, ready for the rankings page: [{ key, label, pointsLabel, rows: [{ rank, name, matches, points, playerId }] }].
function getTables() {
  const entries = db.prepare(`
    SELECT e.id, e.table_key, e.player_id, e.points, e.matches, e.position, e.updated_at, COALESCE(p.name, e.name) AS name
    FROM ranking_entries e LEFT JOIN players p ON p.id = e.player_id
  `).all();
  const updatedAt = entries.reduce((max, e) => (e.updated_at > max ? e.updated_at : max), '');
  const tables = TABLES.map((t) => {
    const rows = entries.filter((e) => e.table_key === t.key)
      .map((e) => ({ name: e.name, matches: e.matches, points: e.points, position: e.position, playerId: e.player_id }));
    return {
      key: t.key,
      label: t.label,
      pointsLabel: t.pointsLabel,
      rows: rankRows(sortRows(rows), !!t.sequentialRanks).map(({ position, ...row }) => row),
    };
  });
  return { updatedAt, tables };
}

// An admin sets one player's points in one table (creating the row when the player is not in that table yet). points may be
// null (back to "no points yet"). Returns { ok: true } or { error }.
function setPoints(tableKey, name, points) {
  if (!TABLE_KEYS.includes(tableKey)) return { error: 'Unknown ranking table' };
  const key = normalizeName(name);
  if (!key) return { error: 'Player name is required' };
  const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const existing = db.prepare('SELECT id FROM ranking_entries WHERE table_key = ? AND name_key = ?').get(tableKey, key)
    || db.prepare(`SELECT e.id FROM ranking_entries e JOIN players p ON p.id = e.player_id WHERE e.table_key = ? AND lower(p.name) = lower(?)`).get(tableKey, String(name).trim());
  if (existing) {
    const was = db.prepare('SELECT e.points, COALESCE(p.name, e.name) AS name FROM ranking_entries e LEFT JOIN players p ON p.id = e.player_id WHERE e.id = ?').get(existing.id);
    db.prepare(`UPDATE ranking_entries SET points = ?, updated_at = ${stamp} WHERE id = ?`).run(points, existing.id);
    return { ok: true, change: { tableKey, tableLabel: (TABLES.find((t) => t.key === tableKey) || {}).label || tableKey, name: was.name, before: was.points === null ? 0 : was.points, after: points === null ? 0 : points } };
  }
  const players = db.prepare('SELECT id, name FROM players').all();
  const player = players.find((p) => normalizeName(p.name) === key) || nameMatch.findSimilar(String(name), players).exact || null;
  if (!player) return { error: 'No player with that name — add the player first' };
  const next = (db.prepare('SELECT MAX(position) AS m FROM ranking_entries WHERE table_key = ?').get(tableKey).m ?? -1) + 1;
  db.prepare('INSERT INTO ranking_entries (table_key, player_id, name, name_key, points, matches, position) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(tableKey, player.id, player.name, normalizeName(player.name), points, next);
  return { ok: true, change: { tableKey, tableLabel: (TABLES.find((t) => t.key === tableKey) || {}).label || tableKey, name: player.name, before: 0, after: points === null ? 0 : points } };
}

module.exports = {
  TABLES, TABLE_KEYS, CATEGORY_RULES, BASE_POINTS,
  normalizeName, computeAwards, recordAwards, reverseRows, inTransaction, reconcile, reverseForMatch, reverseForMatchWithChanges, getTables, setPoints,
};
