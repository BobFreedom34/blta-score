// Checks of the seeded players of a bracket draw (src/tournamentDraw.js entriesFor / drawSeedTiers): seeds 1 and 2 keep their seats, seeds 3-4, 5-8, 9-16
// ... are drawn by lot among the seats of their own group (only a complete group), the unseeded are shuffled exactly as before.
// Run: node scripts/check-seed-tiers.js   (unit checks, own temporary data directory)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-tiers-'));
const draw = require('../src/tournamentDraw');
const bracketEngine = require('../src/bracketEngine');
const liveDraw = require('../src/liveDraw');
const DrawVerify = require('../public/js/draw-verify.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// n players, the first k seeded (player id = 100 + its own seed for the seeded ones, 200+ for the rest)
const players = (n, k) => Array.from({ length: n }, (_, i) => ({ player_id: i < k ? 100 + i + 1 : 200 + i, seed: i < k ? i + 1 : null, partner_id: null }));
// the seat (0 = top) of every player after a draw
function seatsOf(n, k, rng) {
  const entries = draw.entriesFor(players(n, k), rng);
  const order = bracketEngine.standardSeedOrder(bracketEngine.nextPowerOfTwo(n));
  const seat = new Map();
  entries.forEach((e) => seat.set(e.playerId, order.indexOf(e.seed)));
  return { seat, entries };
}

test('16 players, 4 seeded: seed 1 is on top, seed 2 starts the lower half', () => {
  for (let s = 1; s <= 100; s += 1) {
    const { seat } = seatsOf(16, 4, mulberry32(s));
    assert.strictEqual(seat.get(101), 0);
    assert.strictEqual(seat.get(102), 8);
  }
});

test('16 players, 4 seeded: seeds 3 and 4 are drawn into the two remaining quarters, both ways happen', () => {
  let threeLow = 0;
  for (let s = 1; s <= 200; s += 1) {
    const { seat } = seatsOf(16, 4, mulberry32(s));
    assert.deepStrictEqual([seat.get(103), seat.get(104)].sort((a, b) => a - b), [4, 12]);
    if (seat.get(103) === 12) threeLow += 1;
  }
  assert.ok(threeLow > 60 && threeLow < 140, `seed 3 was in the lower quarter ${threeLow} times of 200`);
});

test('16 players, 8 seeded: seeds 5-8 are drawn among their four seats, 3-4 among theirs', () => {
  const arrangements = new Set();
  for (let s = 1; s <= 200; s += 1) {
    const { seat } = seatsOf(16, 8, mulberry32(s));
    const order = bracketEngine.standardSeedOrder(16);
    assert.deepStrictEqual([105, 106, 107, 108].map((id) => seat.get(id)).sort((a, b) => a - b), [5, 6, 7, 8].map((no) => order.indexOf(no)).sort((a, b) => a - b));
    arrangements.add([105, 106, 107, 108].map((id) => seat.get(id)).join());
  }
  assert.ok(arrangements.size > 10, `only ${arrangements.size} arrangements of seeds 5-8`);
});

test('a group that is not complete keeps its order (3 seeded: seed 3 keeps its seat; 6 seeded: 5 and 6 keep theirs)', () => {
  const order = bracketEngine.standardSeedOrder(16);
  for (let s = 1; s <= 50; s += 1) {
    assert.strictEqual(seatsOf(16, 3, mulberry32(s)).seat.get(103), order.indexOf(3));
    const six = seatsOf(16, 6, mulberry32(s)).seat;
    assert.strictEqual(six.get(105), order.indexOf(5));
    assert.strictEqual(six.get(106), order.indexOf(6));
  }
});

test('the unseeded are shuffled exactly as before (the order of the draw before this change is kept)', () => {
  const regs = players(16, 4);
  const expected = draw.shuffled(regs.filter((r) => !r.seed), mulberry32(7)).map((r) => r.player_id);
  const got = draw.entriesFor(regs, mulberry32(7)).slice(4).map((e) => e.playerId);
  assert.deepStrictEqual(got, expected);
});

test('everybody gets one seed number from 1 to n, seeded players keep numbers up to the number of seeded players', () => {
  const entries = draw.entriesFor(players(13, 8), mulberry32(3));
  assert.deepStrictEqual(entries.map((e) => e.seed), Array.from({ length: 13 }, (_, i) => i + 1));
  entries.slice(0, 8).forEach((e) => assert.ok(e.playerId < 200, 'a seeded player holds a number up to 8'));
});

test('the draw in front of the camera: the plan of a bracket with seeds 3-4 / 5-8 drawn is checked and confirmed by the verifier (plan.v 2)', async () => {
  for (const k of [4, 8]) {
    for (let i = 0; i < 5; i += 1) {
      const key = require('crypto').randomBytes(32).toString('hex');
      const regs = players(16, k).map((r, n) => ({ ...r, id: n + 1, name: 'P' + (n + 1) }));
      const planned = liveDraw.planBracket(regs, {}, liveDraw.makeRandom(key));
      const record = { seed: key, seedHash: liveDraw.sha256(key), plan: { v: 2, entrants: regs.map((r, input) => ({ id: r.id, name: r.name, seed: r.seed || null, input })), layout: planned.layout, steps: planned.steps } };
      const out = await DrawVerify.verifyRecord(record);
      assert.ok(out.ok, out.problems.join('; '));
      // the seeded players are shown first, in the order the organiser gave
      assert.deepStrictEqual(planned.steps.slice(0, k).map((st) => st.e), regs.slice(0, k).map((r) => r.id));
    }
  }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`ok   ${t.name}`); } catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${e.message.split('\n')[0]}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
