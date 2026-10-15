// Checks of the tournament consolation format BO3_G4_STB (two winning sets, each to 4 games with a tie-break at 3-3, the deciding set a
// 10-point match tie-break) in the scoring engine — and that the normal formats still score as before.
// Run: node scripts/check-match-format-g4.js   (pure functions, no server)
const assert = require('assert');
const engine = require('../src/matchEngine');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const F = 'BO3_G4_STB';
const points = (state, formatKey, player, n) => { let s = state; for (let i = 0; i < n; i += 1) s = engine.applyDelta(s, formatKey, player, 1); return s; };
const games = (state, formatKey, p1, p2) => { let s = state; for (let i = 0; i < Math.max(p1, p2); i += 1) { if (i < p1) s = engine.applyDelta(s, formatKey, 1, 1); if (i < p2) s = engine.applyDelta(s, formatKey, 2, 1); } return s; };

test('the format exists with a label and its set rules', () => {
  assert.strictEqual(engine.FORMATS[F].setsToWin, 2);
  assert.strictEqual(engine.FORMATS[F].finalSetSuperTiebreak, true);
  assert.match(engine.FORMATS[F].label, /4 games/);
});

test('a set to 4: 4-0, 4-1 and 4-2 end it; 3-2 does not', () => {
  for (const [a, b] of [[4, 0], [4, 1], [4, 2]]) {
    const s = games(engine.initState(F), F, a, b);
    assert.strictEqual(s.sets[0].winner, 1, `${a}-${b}`);
    assert.strictEqual(s.setsWon[1], 1);
  }
  const open = games(engine.initState(F), F, 3, 2);
  assert.strictEqual(open.sets[0].winner, null);
  assert.strictEqual(open.currentSet, 0);
});

test('at 3-3 a normal tie-break (7 points, two clear) is played and the set ends 4-3', () => {
  let s = games(engine.initState(F), F, 3, 3);
  assert.ok(s.sets[0].tiebreak, 'tie-break started');
  assert.strictEqual(s.sets[0].isSuperTiebreak, false);
  s = points(s, F, 1, 6);
  assert.strictEqual(s.sets[0].winner, null, '6-0 is not enough');
  s = points(s, F, 2, 5);
  s = points(s, F, 1, 1); // 7-5
  assert.strictEqual(s.sets[0].winner, 1);
  assert.deepStrictEqual([s.sets[0].p1, s.sets[0].p2], [4, 3]);
  const lost = games(engine.initState(F), F, 3, 3);
  const l2 = points(points(lost, F, 2, 7), F, 1, 0);
  assert.deepStrictEqual([l2.sets[0].p1, l2.sets[0].p2], [3, 4]);
});

test('a whole match: 4-2, 3-4 (tie-break), then the 10-point match tie-break decides', () => {
  let s = games(engine.initState(F), F, 4, 2);
  s = games(s, F, 3, 3);
  s = points(points(s, F, 1, 3), F, 2, 7); // tie-break 3-7 -> 3-4
  assert.strictEqual(s.setsWon[1], 1);
  assert.strictEqual(s.setsWon[2], 1);
  assert.strictEqual(s.sets[2].isSuperTiebreak, true);
  s = points(s, F, 1, 9);
  assert.strictEqual(s.status, 'IN_PROGRESS');
  s = points(s, F, 2, 8);
  s = points(s, F, 1, 1); // 10-8
  assert.strictEqual(s.status, 'COMPLETE');
  assert.strictEqual(s.winner, 1);
  assert.strictEqual(engine.describeMatch(s), '4-2, 3-4(3), 10-8');
});

test('a result typed by hand is checked against the sets to 4', () => {
  const ok = engine.buildResultFromSets(F, [{ p1: 4, p2: 2 }, { p1: 3, p2: 4, tbP1: 5, tbP2: 7 }, { p1: 10, p2: 8 }]);
  assert.strictEqual(ok.winner, 1);
  assert.strictEqual(engine.describeMatch(ok), '4-2, 3-4(5), 10-8');
  assert.throws(() => engine.buildResultFromSets(F, [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }]), /valid winner/);
  assert.throws(() => engine.buildResultFromSets(F, [{ p1: 5, p2: 3 }, { p1: 4, p2: 1 }]), /valid winner/);
  const straight = engine.buildResultFromSets(F, [{ p1: 4, p2: 1 }, { p1: 4, p2: 0 }]);
  assert.strictEqual(straight.winner, 1);
});

test('an admin correction of a set respects the sets to 4', () => {
  let s = games(engine.initState(F), F, 4, 2);
  assert.throws(() => engine.editSetScore(s, F, 0, 1, 1), /already decided/);
  s = engine.editSetScore(s, F, 0, 1, -1); // 3-2, open again
  assert.strictEqual(s.sets[0].winner, null);
  s = engine.editSetScore(s, F, 0, 2, 1); // 3-3 -> tie-break
  assert.ok(s.sets[0].tiebreak);
});

test('the normal formats still score as before (6 games, a tie-break at 6-6, 7-6)', () => {
  let s = games(engine.initState('BO3'), 'BO3', 6, 4);
  assert.strictEqual(s.sets[0].winner, 1);
  s = games(engine.initState('BO3'), 'BO3', 6, 6);
  assert.ok(s.sets[0].tiebreak);
  s = points(s, 'BO3', 1, 7);
  assert.deepStrictEqual([s.sets[0].p1, s.sets[0].p2], [7, 6]);
  const manual = engine.buildResultFromSets('BO3', [{ p1: 7, p2: 5 }, { p1: 6, p2: 7, tbP1: 4, tbP2: 7 }, { p1: 6, p2: 2 }]);
  assert.strictEqual(manual.winner, 1);
  assert.strictEqual(engine.describeMatch(manual), '7-5, 6-7(4), 6-2');
});

let failed = 0;
tests.forEach(({ name, fn }) => {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
});
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
