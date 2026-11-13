// The placement bonus of the Propozície (Bodovanie > Bonusové body - liga / turnaje), added to the tables by itself:
//   a league play-off bracket that is decided (winner, finalist, two semi-finalists) gives, per category:
//        Novice 40 / 20 / 10 / 10    Next Gen 70 / 40 / 20 / 20    Elite 100 / 70 / 40 / 40
//   the main bracket of a tournament (Novice, Next Gen, Elite) gives:
//        Novice 15 / 10 / 5 / 5      Next Gen 30 / 20 / 10 / 10    Elite 50 / 30 / 15 / 15
// A league bonus goes to the overall BLTA table and to the Race table of the category, a tournament bonus to the overall BLTA table and to the Tournaments table.
// In the overall table it is a dated item (the date of the final) that leaves 52 weeks later (src/rankingExpiry.js). Every bonus is written to the
// Points log (Backend > Log, kind BONUS). The final standings (src/finalStandings.js) say who finished where, and the bracket must be COMPLETE.
// sync() is idempotent and works out the difference: a bonus is added when the bracket is decided, taken back when a result is corrected so that the
// place changes or the result is taken back / the bracket is deleted. It is called with the rankings (throttled), so every way of entering a result is covered.
const db = require('./db');
const rankingPoints = require('./rankingPoints');
const expiry = require('./rankingExpiry');

db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_bonus_paid (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    place TEXT NOT NULL,
    points INTEGER NOT NULL,
    tables TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ranking_bonus_bracket ON ranking_bonus_paid(bracket_id);
`);

const LEAGUE = { NOVICE: [40, 20, 10, 10], NEXT_GEN: [70, 40, 20, 20], ELITE: [100, 70, 40, 40] };
const TOURNAMENT = { NOVICE: [15, 10, 5, 5], NEXT_GEN: [30, 20, 10, 10], ELITE: [50, 30, 15, 15] };
const RACE = { ELITE: 'elite_race', NEXT_GEN: 'next_gen_race', NOVICE: 'novice_race' };
const PLACE_LABEL = { WINNER: 'Víťaz', FINALIST: 'Finalista', SEMI: 'Semifinalista' };
const TABLE_LABEL = Object.fromEntries(rankingPoints.TABLES.map((t) => [t.key, t.label]));

// -> [{ playerId, place: WINNER|FINALIST|SEMI, points }] for a final-standings section (empty when the bracket is not decided)
function expectedFor(section, isTournament) {
  const table = (isTournament ? TOURNAMENT : LEAGUE)[section.category];
  if (!table || !section.complete) return [];
  const out = [];
  section.rows.forEach((r) => {
    const idx = r.stage === 'WINNER' ? 0 : r.stage === 'FINALIST' ? 1 : r.stage === 'SEMI' ? 2 : -1;
    if (idx < 0 || !r.player || !r.player.id) return;
    out.push({ playerId: r.player.id, place: r.stage, points: table[idx] });
  });
  return out;
}

function tablesFor(category, isTournament) {
  return isTournament ? ['blta', 'tournaments'] : ['blta', RACE[category]].filter(Boolean);
}

// the day of the final: the date of its match, otherwise today
function finalDate(bracketId) {
  const node = db.prepare('SELECT match_id FROM bracket_matches WHERE bracket_id = ? ORDER BY round DESC, position LIMIT 1').get(bracketId);
  const m = node && node.match_id ? db.prepare('SELECT scheduled_at, end_time FROM matches WHERE id = ?').get(node.match_id) : null;
  const raw = m ? (m.scheduled_at || m.end_time || '') : '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function addPoints(tableKey, playerId, points) {
  const entry = rankingPoints.entryFor(tableKey, playerId, true);
  const before = entry.points === null ? 0 : entry.points;
  db.prepare("UPDATE ranking_entries SET points = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(before + points, entry.id);
  return { entry, before, after: before + points };
}

// Works out one bracket. `ledger` collects what to write to the log. alreadyCounted: only records who got what (the points are in the tables already).
function syncBracket(bracket, expected, isTournament, ledger, alreadyCounted = false) {
  const paid = db.prepare('SELECT * FROM ranking_bonus_paid WHERE bracket_id = ?').all(bracket.id);
  const same = (p, e) => p.player_id === e.playerId && p.place === e.place && p.points === e.points;
  // taken back: paid, but not (or no longer the same) in what is expected
  paid.filter((p) => !expected.some((e) => same(p, e))).forEach((p) => {
    const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(p.player_id);
    JSON.parse(p.tables).forEach((tableKey) => {
      const entry = rankingPoints.entryFor(tableKey, p.player_id, false);
      if (!entry) return;
      let take = p.points;
      if (tableKey === expiry.TABLE_KEY) {
        const item = db.prepare("SELECT id, applied_at FROM ranking_expiry WHERE entry_id = ? AND match_id IS NULL AND kind = 'BONUS' AND label = ? ORDER BY id DESC LIMIT 1").get(entry.id, `bonus:${bracket.id}:${p.place}`);
        if (item) { if (item.applied_at) take = 0; db.prepare('DELETE FROM ranking_expiry WHERE id = ?').run(item.id); }
      }
      const before = entry.points === null ? 0 : entry.points;
      const after = Math.max(0, before - take);
      db.prepare("UPDATE ranking_entries SET points = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(after, entry.id);
      ledger.push({ tableKey, name: player ? player.name : `#${p.player_id}`, before, after, reason: `Bonus za umiestnenie zrušený: ${bracket.name}` });
    });
    db.prepare('DELETE FROM ranking_bonus_paid WHERE id = ?').run(p.id);
  });
  // added: expected, not paid yet
  const now = db.prepare('SELECT * FROM ranking_bonus_paid WHERE bracket_id = ?').all(bracket.id);
  expected.filter((e) => !now.some((p) => same(p, e))).forEach((e) => {
    const tables = tablesFor(bracket.category, isTournament);
    const player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(e.playerId);
    if (!player) return;
    if (!alreadyCounted) {
      tables.forEach((tableKey) => {
        const made = addPoints(tableKey, e.playerId, e.points);
        if (tableKey === expiry.TABLE_KEY) expiry.addItem({ entryId: made.entry.id, kind: isTournament ? 'TOURNAMENT' : 'BONUS', points: e.points, date: finalDate(bracket.id), label: `bonus:${bracket.id}:${e.place}` });
        ledger.push({ tableKey, name: player.name, before: made.before, after: made.after, reason: `Bonus za umiestnenie (${PLACE_LABEL[e.place]}): ${bracket.name}` });
      });
    }
    db.prepare('INSERT INTO ranking_bonus_paid (bracket_id, player_id, place, points, tables) VALUES (?, ?, ?, ?, ?)').run(bracket.id, e.playerId, e.place, e.points, JSON.stringify(tables));
  });
}

// The brackets that give a bonus: the MAIN bracket of a league season (play-off) or of a tournament, no doubles, no club events, a category with a bonus table.
function eligible() {
  const finalStandings = require('./finalStandings');
  const out = [];
  db.prepare("SELECT * FROM seasons WHERE organisation_id IS NULL").all().forEach((season) => {
    const isTournament = season.kind === 'TOURNAMENT';
    const brackets = db.prepare("SELECT * FROM brackets WHERE season_id = ? AND COALESCE(kind, 'MAIN') = 'MAIN' AND COALESCE(is_doubles, 0) = 0").all(season.id);
    if (!brackets.length) return;
    const standings = finalStandings.compute(season);
    brackets.forEach((b) => {
      if (!(isTournament ? TOURNAMENT : LEAGUE)[b.category]) return;
      const section = isTournament
        ? standings.sections.find((s) => s.key === `category-${b.category}`)
        : standings.sections.find((s) => s.key === `bracket-${b.id}`);
      // (a tournament: the first main bracket of the category is the one the standings are read from)
      if (isTournament && brackets.filter((x) => x.category === b.category)[0].id !== b.id) return;
      out.push({ bracket: b, isTournament, section: section ? { ...section, category: b.category } : null });
    });
  });
  return out;
}

// Does all of it. The first time it only records the brackets that are decided already (their bonus is in the tables: it was entered by hand before).
function sync() {
  const first = !db.prepare("SELECT 1 FROM app_flags WHERE key = 'ranking_bonus_init'").get();
  const ledger = [];
  const list = eligible();
  rankingPoints.inTransaction(() => {
    list.forEach(({ bracket, isTournament, section }) => {
      const expected = section ? expectedFor(section, isTournament) : [];
      syncBracket(bracket, expected, isTournament, ledger, first);
    });
    // a bracket that is gone: its bonus is taken back
    db.prepare('SELECT DISTINCT bracket_id FROM ranking_bonus_paid').all().forEach(({ bracket_id: id }) => {
      if (list.some((x) => x.bracket.id === id)) return;
      const season = db.prepare('SELECT s.kind FROM brackets b JOIN seasons s ON s.id = b.season_id WHERE b.id = ?').get(id);
      syncBracket({ id, name: `bracket ${id}`, category: null }, [], !!season && season.kind === 'TOURNAMENT', ledger);
    });
    if (first) db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('ranking_bonus_init')").run();
  });
  try {
    const changeLog = require('./changeLog');
    ledger.forEach((l) => changeLog.logBonus({ tableKey: l.tableKey, tableLabel: TABLE_LABEL[l.tableKey] || l.tableKey, name: l.name, before: l.before, after: l.after, reason: l.reason }));
  } catch (err) { console.error('[bonus] points log:', err.message); }
  return { changes: ledger.length, first };
}

let lastRun = 0;
// For the rankings: at most once a minute
function syncThrottled(ms = 60000) {
  const now = Date.now();
  if (now - lastRun < ms) return null;
  lastRun = now;
  return sync();
}

module.exports = { LEAGUE, TOURNAMENT, expectedFor, sync, syncThrottled };
