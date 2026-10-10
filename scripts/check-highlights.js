// Checks of "Hráč mesiaca" (GET /api/highlights/month): the player of the last full month (BLTA points in that month, then wins) and the player
// with the biggest courtIQ progress. The date is fixed (HIGHLIGHTS_NOW) so the result is the same on any day.
// Run: node scripts/check-highlights.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-server-'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-unit-')); // for requiring the route module below
const { ratingToBand } = require('../src/courtIQEngine');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let db = null;

const get = async () => (await fetch(`${BASE}/api/highlights/month`)).json();
const player = (name, slug, extra = 0) => Number(db.prepare('INSERT INTO players (name, slug, hidden) VALUES (?, ?, ?)').run(name, slug, extra).lastInsertRowid);
const match = (p1, p2, winner, when, category = 'NOVICE', status = 'FINISHED') => Number(db.prepare(
  "INSERT INTO matches (category, player1_id, player2_id, format, state, status, winner_id, scheduled_at) VALUES (?, ?, ?, 'BEST_OF_3', '{}', ?, ?, ?)",
).run(category, p1, p2, status, status === 'FINISHED' ? winner : null, when).lastInsertRowid);
const entries = new Map();
const award = (playerId, matchId, points) => {
  if (!entries.has(playerId)) {
    entries.set(playerId, Number(db.prepare("INSERT INTO ranking_entries (table_key, player_id, name, name_key, points, matches, position) VALUES ('blta', ?, ?, ?, 0, 0, 0)")
      .run(playerId, `p${playerId}`, `p${playerId}`).lastInsertRowid));
  }
  db.prepare('INSERT INTO ranking_awards (match_id, entry_id, points) VALUES (?, ?, ?)').run(matchId, entries.get(playerId), points);
};
const rating = (playerId, matchId, value) => db.prepare('INSERT INTO courtiq_rating_history (player_id, match_id, rating, deviation, volatility) VALUES (?, ?, ?, 100, 0.06)').run(playerId, matchId, value);

const S = {};

test('nobody yet: no matches in the last full month', async () => {
  const r = await get();
  assert.deepStrictEqual(r, { month: '2026-09', player: null, improved: null });
});

test('the player of the month: most BLTA points of the month, then wins; the longest run of wins; only the month counts', async () => {
  S.a = player('Anna Víťazná', 'anna-vitazna');
  S.b = player('Boris Druhý', 'boris-druhy');
  S.c = player('Cyril Pokrok', 'cyril-pokrok');
  S.d = player('Dana Tretia', 'dana-tretia');
  S.h = player('Hidden Hviezda', 'hidden-hviezda', 1);
  S.e = player('Eva Jedna', 'eva-jedna');
  S.f = player('Fero Jedna', 'fero-jedna');
  const m = {};
  m.aug = match(S.a, S.c, S.a, '2026-08-20T10:00:00.000Z'); // before the month
  m.s1 = match(S.a, S.b, S.a, '2026-09-03T10:00:00.000Z');
  m.s2 = match(S.a, S.c, S.a, '2026-09-05T10:00:00.000Z');
  m.s3 = match(S.a, S.d, S.a, '2026-09-08T10:00:00.000Z');
  m.s4 = match(S.a, S.b, S.b, '2026-09-12T10:00:00.000Z'); // Anna loses: the run is broken
  m.s5 = match(S.c, S.b, S.b, '2026-09-15T10:00:00.000Z');
  m.s6 = match(S.a, S.c, S.a, '2026-09-20T10:00:00.000Z');
  m.oct = match(S.a, S.d, S.a, '2026-10-02T10:00:00.000Z'); // after the month
  m.one = match(S.e, S.f, S.e, '2026-09-10T10:00:00.000Z'); // one match only: not enough
  m.hid1 = match(S.h, S.d, S.h, '2026-09-11T10:00:00.000Z');
  m.hid2 = match(S.h, S.d, S.h, '2026-09-13T10:00:00.000Z');
  m.cat = match(S.b, S.d, S.b, '2026-09-14T10:00:00.000Z', 'OTHER'); // not a BLTA category
  m.planned = match(S.b, S.d, null, '2026-09-16T10:00:00.000Z', 'NOVICE', 'PLANNED');
  Object.assign(S, { m });
  [m.s1, m.s2, m.s3, m.s6].forEach((id) => award(S.a, id, 50)); // 200 in the month
  award(S.a, m.aug, 100); // not this month
  award(S.a, m.oct, 100);
  [m.s4, m.s5].forEach((id) => award(S.b, id, 30)); // 60
  award(S.e, m.one, 500);
  [m.hid1, m.hid2].forEach((id) => award(S.h, id, 400));
  const r = await get();
  assert.strictEqual(r.month, '2026-09');
  assert.deepStrictEqual(r.player, { id: S.a, name: 'Anna Víťazná', slug: 'anna-vitazna', category: null, wins: 4, played: 5, points: 200, streak: 3 });
});

test('without Annas points the next one wins: the best of the rest by points, then wins', async () => {
  // Boris and Cyril: put them level in points with Anna out of the way by giving her no awards
  db.prepare('DELETE FROM ranking_awards WHERE entry_id = ?').run(Number(db.prepare('SELECT id FROM ranking_entries WHERE player_id = ?').get(S.a).id));
  const r = await get();
  // Boris: 60 points, 2 wins from 3 matches (beats Anna, beats Cyril, loses to Anna); Anna: 0 points, 4 wins
  assert.strictEqual(r.player.id, S.b);
  assert.deepStrictEqual([r.player.wins, r.player.played, r.player.points], [2, 3, 60]);
  assert.strictEqual(r.player.streak, 2);
});

test('the biggest courtIQ progress of the month: a different player than the player of the month', async () => {
  const { m } = S;
  // before the month (August) everybody has 1500; at the end of September: Anna 1900, Cyril 1750, Boris 1650
  [S.a, S.b, S.c].forEach((id) => rating(id, m.aug, 1500));
  rating(S.a, m.s6, 1900);
  rating(S.c, m.s6, 1750);
  rating(S.b, m.s5, 1650);
  // Boris is the player of the month now: the progress goes to the best of the others — Anna (1500 -> 1900), then Cyril
  const r = await get();
  assert.strictEqual(r.player.id, S.b);
  const from = Number(ratingToBand(1500).toFixed(1));
  assert.deepStrictEqual(r.improved, { id: S.a, name: 'Anna Víťazná', slug: 'anna-vitazna', from, to: Number(ratingToBand(1900).toFixed(1)), delta: Number((Number(ratingToBand(1900).toFixed(1)) - from).toFixed(1)), played: 5 });
  assert.ok(r.improved.delta > 0);
  // a player without a rating from before the month has no baseline
  db.prepare('DELETE FROM courtiq_rating_history WHERE player_id = ? AND match_id = ?').run(S.a, S.m.aug);
  assert.strictEqual((await get()).improved.id, S.c, 'Anna has no baseline: Cyril is next');
  // nobody improved: nothing shown
  db.prepare('DELETE FROM courtiq_rating_history').run();
  assert.strictEqual((await get()).improved, null);
});

test('the month is the last FULL month, also over the new year', async () => {
  const hl = require('../src/routes/highlights');
  assert.deepStrictEqual(hl.lastMonth('2026-10-10'), { month: '2026-09', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
  assert.deepStrictEqual(hl.lastMonth('2026-01-05'), { month: '2025-12', from: '2025-12-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });
  assert.deepStrictEqual(hl.lastMonth('2026-03-31'), { month: '2026-02', from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
});

test('the home page carries the card', async () => {
  assert.ok((await (await fetch(`${BASE}/js/home.js`)).text()).includes('/highlights/month'));
  assert.ok((await (await fetch(`${BASE}/js/i18n.js`)).text()).includes('pom.title'));
});

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', HIGHLIGHTS_NOW: '2026-10-10' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  db = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  db.exec('PRAGMA busy_timeout = 5000');
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (db) db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
