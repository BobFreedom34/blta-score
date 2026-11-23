// Checks of point-by-point scoring (15-30-40-Ad) in the scoring engine: games, deuce/advantage, tie-breaks, the end of a set and of the match,
// the timeline (state.log) and that scoring by games still works as before.
// Run: node scripts/check-match-points.js   (pure functions, no server)
const assert = require('assert');
const engine = require('../src/matchEngine');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const F = 'BO3';
const pts = (state, format, seq) => { let s = state; for (const p of seq) s = engine.applyPoint(s, format, p); return s; };
const labels = (s) => engine.gamePointLabels(s.game).join('-');

test('points run 15, 30, 40 and the fourth wins the game', () => {
  let s = engine.initState(F);
  s = pts(s, F, [1]); assert.strictEqual(labels(s), '15-0');
  s = pts(s, F, [2, 1]); assert.strictEqual(labels(s), '30-15');
  s = pts(s, F, [1]); assert.strictEqual(labels(s), '40-15');
  s = pts(s, F, [1]);
  assert.strictEqual(s.sets[0].p1, 1);
  assert.strictEqual(s.game, undefined, 'the next game starts at 0-0');
});

test('deuce and advantage: 40-40, Ad, back to deuce, then the game', () => {
  let s = pts(engine.initState(F), F, [1, 1, 1, 2, 2, 2]);
  assert.strictEqual(labels(s), '40-40');
  s = pts(s, F, [1]); assert.strictEqual(labels(s), 'Ad-40');
  s = pts(s, F, [2]); assert.strictEqual(labels(s), '40-40');
  s = pts(s, F, [2]); assert.strictEqual(labels(s), '40-Ad');
  assert.strictEqual(s.sets[0].p1 + s.sets[0].p2, 0, 'no game yet');
  s = pts(s, F, [2]);
  assert.strictEqual(s.sets[0].p2, 1);
});

test('a set ends 6-0 after 24 points, and the next set starts', () => {
  let s = engine.initState(F);
  s = pts(s, F, new Array(24).fill(1));
  assert.strictEqual(s.sets[0].winner, 1);
  assert.strictEqual(s.setsWon[1], 1);
  assert.strictEqual(s.currentSet, 1);
  assert.strictEqual(s.game, undefined);
});

test('6-6 starts a tie-break and its points are plain points', () => {
  let s = engine.initState(F);
  for (let g = 0; g < 6; g += 1) s = pts(pts(s, F, [1, 1, 1, 1]), F, [2, 2, 2, 2]);
  assert.ok(s.sets[0].tiebreak, 'tie-break started at 6-6');
  s = pts(s, F, [1, 2, 1]);
  assert.deepStrictEqual(s.sets[0].tiebreak, { p1: 2, p2: 1 });
  assert.strictEqual(s.log[s.log.length - 1].sc, '2-1');
  s = pts(s, F, [1, 1, 1, 1, 1]); // 7-1
  assert.strictEqual(s.sets[0].winner, 1);
  assert.strictEqual(s.log[s.log.length - 1].sc, 'SET');
});

test('a point is refused once the match is decided', () => {
  let s = engine.initState('BO1');
  s = pts(s, 'BO1', new Array(24).fill(2));
  assert.strictEqual(s.status, 'COMPLETE');
  assert.strictEqual(s.log[s.log.length - 1].sc, 'MATCH');
  assert.throws(() => engine.applyPoint(s, 'BO1', 1), /decided/);
});

test('the timeline: one entry per point, game number and who won', () => {
  const s = pts(engine.initState(F), F, [1, 2, 1, 1, 1]);
  assert.strictEqual(s.log.length, 5);
  assert.deepStrictEqual(s.log.map((e) => e.sc), ['15-0', '15-15', '30-15', '40-15', 'GAME']);
  assert.ok(s.log.every((e) => e.n === 1 && e.s === 0 && e.k === 'P'));
  assert.deepStrictEqual(s.log.map((e) => e.w), [1, 2, 1, 1, 1]);
  assert.strictEqual(s.log[4].g, '1-0');
});

test('the game buttons still work: no log for a match never scored by points, and they drop the points of a game', () => {
  const plain = engine.applyDelta(engine.initState(F), F, 1, 1);
  assert.strictEqual(plain.log, undefined);
  assert.strictEqual(plain.game, undefined);
  let s = pts(engine.initState(F), F, [1, 1]);
  s = engine.applyDelta(s, F, 2, 1);
  assert.strictEqual(s.game, undefined);
  assert.strictEqual(s.sets[0].p2, 1);
  assert.strictEqual(s.log[s.log.length - 1].sc, 'G+');
});

test('the state of the input is never changed', () => {
  const a = pts(engine.initState(F), F, [1, 2]);
  const copy = JSON.stringify(a);
  engine.applyPoint(a, F, 1);
  assert.strictEqual(JSON.stringify(a), copy);
});

test('a match tie-break (deciding set) counts points to 10, two clear', () => {
  let s = engine.initState('BO3_STB');
  s = pts(s, 'BO3_STB', new Array(24).fill(1));
  s = pts(s, 'BO3_STB', new Array(24).fill(2));
  assert.ok(s.sets[2].isSuperTiebreak);
  s = pts(s, 'BO3_STB', new Array(10).fill(1));
  assert.strictEqual(s.status, 'COMPLETE');
  assert.strictEqual(s.winner, 1);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
