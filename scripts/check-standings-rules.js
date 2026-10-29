// Checks of the scoring and tie-break rules of a tournament's group tables (src/standings.js): the points per result (BLTA, 2 points a win,
// 1 point a win) and the order of the tie-break conditions (head-to-head, set difference, wins, game difference).
// Pure functions - no server. Run: node scripts/check-standings-rules.js
const assert = require('assert');
const standings = require('../src/standings');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// a finished match of player a against player b; sets = [[games of a, games of b], ...]
let day = 0;
function match(a, b, sets, extra = {}) {
  day += 1;
  const won = { 1: 0, 2: 0 };
  sets.forEach(([x, y]) => { if (x > y) won[1] += 1; else won[2] += 1; });
  return {
    player1Id: a, player2Id: b, winnerId: won[1] > won[2] ? a : b, status: 'FINISHED', endReason: null, date: `2026-01-${String(day).padStart(2, '0')}`,
    state: { setsWon: won, sets: sets.map(([p1, p2]) => ({ p1, p2 })) }, ...extra,
  };
}
const players = (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: `P${id}`, slug: null }]));
const table = (matches, rules, ids = [1, 2, 3, 4]) => standings.computeGroupStandings(matches, players(ids), rules);
const order = (rows) => rows.map((r) => r.playerId);
const pts = (rows) => Object.fromEntries(rows.map((r) => [r.playerId, r.points]));

const ALL = ['H2H', 'SETS', 'WINS', 'GAMES'];
const BLTA = { scoring: 'BLTA', tiebreakers: ALL };

test('rules: the defaults, a bad value falls back, duplicates and missing conditions are repaired', () => {
  assert.deepStrictEqual(standings.DEFAULT_TIEBREAKERS, ALL);
  assert.deepStrictEqual(standings.normalizeRules({}), { scoring: 'BLTA', tiebreakers: ALL });
  assert.deepStrictEqual(standings.normalizeRules({ scoring: 'WIN2', tiebreakers: 'WINS,GAMES' }), { scoring: 'WIN2', tiebreakers: ['WINS', 'GAMES', 'H2H', 'SETS'] });
  assert.deepStrictEqual(standings.normalizeRules({ scoring: 'nonsense', tiebreakers: 'SETS,SETS,XXX,H2H' }), { scoring: 'BLTA', tiebreakers: ['SETS', 'H2H', 'WINS', 'GAMES'] });
  assert.deepStrictEqual(standings.normalizeRules({ scoring: 'WIN1', tiebreakers: ['GAMES', 'WINS', 'SETS', 'H2H'] }), { scoring: 'WIN1', tiebreakers: ['GAMES', 'WINS', 'SETS', 'H2H'] });
  assert.deepStrictEqual(standings.normalizeRules(null), { scoring: 'BLTA', tiebreakers: ALL });
});

// 1 beats 2 (2-0), 3 beats 4 (2-1), 1 beats 3 by walkover
const results = () => [match(1, 2, [[6, 3], [6, 4]]), match(3, 4, [[6, 3], [3, 6], [10, 7]]), match(1, 3, [[6, 0], [6, 0]], { endReason: 'WALKOVER' })];

test('scoring BLTA: 2-0 = 3 points, 2-1 = 2 for the winner and 1 for the loser, a walkover 3 for the winner', () => {
  assert.deepStrictEqual(pts(table(results(), BLTA)), { 1: 6, 2: 0, 3: 2, 4: 1 });
});

test('scoring WIN2: 2 points for a win, 0 for a loss, whatever the score', () => {
  assert.deepStrictEqual(pts(table(results(), { ...BLTA, scoring: 'WIN2' })), { 1: 4, 2: 0, 3: 2, 4: 0 });
});

test('scoring WIN1: 1 point for a win, 0 for a loss', () => {
  assert.deepStrictEqual(pts(table(results(), { ...BLTA, scoring: 'WIN1' })), { 1: 2, 2: 0, 3: 1, 4: 0 });
});

// 1 and 2 finish level on two wins; 2 beat 1 narrowly (head-to-head), but 1 has the better set difference (+2 against +1).
// 3 and 4 are level on one win too (3 beat 4).
const pairs = () => [
  match(2, 1, [[7, 6], [7, 6]]),
  match(1, 3, [[6, 0], [6, 0]]),
  match(1, 4, [[6, 0], [6, 0]]),
  match(2, 3, [[6, 4], [3, 6], [6, 4]]),
  match(4, 2, [[6, 4], [6, 4]]),
  match(3, 4, [[6, 4], [6, 4]]),
];

test('tie-break order: head-to-head first puts the winner of their match ahead; set difference first puts the better set difference ahead', () => {
  const h2hFirst = table(pairs(), { scoring: 'WIN2', tiebreakers: ['H2H', 'SETS', 'WINS', 'GAMES'] });
  const setsFirst = table(pairs(), { scoring: 'WIN2', tiebreakers: ['SETS', 'H2H', 'WINS', 'GAMES'] });
  assert.deepStrictEqual(pts(h2hFirst), { 1: 4, 2: 4, 3: 2, 4: 2 });
  assert.deepStrictEqual(order(h2hFirst), [2, 1, 3, 4]);
  assert.deepStrictEqual(order(setsFirst), [1, 2, 3, 4]);
  assert.deepStrictEqual(h2hFirst.map((r) => r.position), [1, 2, 3, 4]);
});

test('points always come first, whatever the conditions say', () => {
  const rows = table(pairs(), { scoring: 'BLTA', tiebreakers: ['GAMES', 'WINS', 'SETS', 'H2H'] });
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].points >= rows[i].points);
});

test('head-to-head only counts between exactly two level players: a circle of wins shares the place', () => {
  const rows = table([match(1, 2, [[6, 0], [6, 0]]), match(2, 3, [[6, 0], [6, 0]]), match(3, 1, [[6, 0], [6, 0]])], { scoring: 'WIN2', tiebreakers: ALL }, [1, 2, 3]);
  assert.deepStrictEqual(rows.map((r) => r.position), [1, 1, 1]);
});

test('a later condition separates what an earlier one left level (games last)', () => {
  const rows = table([match(1, 2, [[6, 3], [6, 4]]), match(3, 4, [[6, 0], [6, 0]])], BLTA);
  assert.deepStrictEqual(order(rows), [3, 1, 2, 4]); // 3 and 1 are level on points, sets and wins; 3 has the better game difference
  assert.deepStrictEqual(rows.map((r) => r.position), [1, 2, 3, 4]);
});

test('the order of the conditions can be reversed completely', () => {
  const rows = table(pairs(), { scoring: 'WIN2', tiebreakers: ['GAMES', 'WINS', 'SETS', 'H2H'] });
  assert.deepStrictEqual(order(rows).slice(2), [3, 4]);
});

test('without rules the table is calculated as before (points, set difference, wins; the position is shared when level on those)', () => {
  const rows = table([match(1, 2, [[6, 3], [6, 4]]), match(3, 4, [[6, 3], [6, 4]])], undefined);
  assert.deepStrictEqual(rows.map((r) => r.points), [3, 3, 0, 0]);
  assert.deepStrictEqual(rows.map((r) => r.position), [1, 1, 3, 3]);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
