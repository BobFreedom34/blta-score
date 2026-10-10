// Checks of "Hráč mesiaca" (GET /api/highlights/month): the player of the last full month (BLTA points of that month by the league's rules, then
// wins) and the player with the biggest courtIQ progress; plus the admin's points audit (GET /api/rankings/audit). The date is fixed
// (HIGHLIGHTS_NOW) so the result is the same on any day.
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
const player = (name, slug, hidden = 0) => Number(db.prepare('INSERT INTO players (name, slug, hidden) VALUES (?, ?, ?)').run(name, slug, hidden).lastInsertRowid);
// a match won 2:0 (or 2:1 with `three`) by `winner`; the points ledger is left EMPTY on purpose: the card goes by the rules, not the ledger
const match = (p1, p2, winner, when, category = 'NOVICE', status = 'FINISHED', three = false) => {
  const sets = winner === p1 ? { 1: 2, 2: three ? 1 : 0 } : { 1: three ? 1 : 0, 2: 2 };
  return Number(db.prepare(
    "INSERT INTO matches (category, player1_id, player2_id, format, state, status, winner_id, scheduled_at) VALUES (?, ?, ?, 'BO3', ?, ?, ?, ?)",
  ).run(category, p1, p2, JSON.stringify({ setsWon: sets }), status, status === 'FINISHED' ? winner : null, when).lastInsertRowid);
};
const rating = (playerId, matchId, value) => db.prepare('INSERT INTO courtiq_rating_history (player_id, match_id, rating, deviation, volatility) VALUES (?, ?, ?, 100, 0.06)').run(playerId, matchId, value);
const entries = new Map();
const award = (playerId, matchId, points) => {
  if (!entries.has(playerId)) {
    entries.set(playerId, Number(db.prepare("INSERT INTO ranking_entries (table_key, player_id, name, name_key, points, matches, position) VALUES ('blta', ?, ?, ?, 0, 0, 0)")
      .run(playerId, `p${playerId}`, `p${playerId}`).lastInsertRowid));
  }
  db.prepare('INSERT INTO ranking_awards (match_id, entry_id, points) VALUES (?, ?, ?)').run(matchId, entries.get(playerId), points);
};

const S = {};

test('nobody yet: no matches in the last full month', async () => {
  const r = await get();
  assert.deepStrictEqual(r, { month: '2026-09', player: null, improved: null });
});

test('the player of the month: most points by the league rules, then wins; the longest run of wins; only the month counts', async () => {
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
  m.cat = match(S.b, S.d, S.b, '2026-09-14T10:00:00.000Z', 'FRIENDLY'); // not a BLTA category
  m.planned = match(S.b, S.d, null, '2026-09-16T10:00:00.000Z', 'NOVICE', 'PLANNED');
  Object.assign(S, { m });
  // Novice 2:0 is worth 12: Anna won four of them in the month (the August and October ones do not count)
  const r = await get();
  assert.strictEqual(r.month, '2026-09');
  assert.deepStrictEqual(r.player, { id: S.a, name: 'Anna Víťazná', slug: 'anna-vitazna', category: null, photoUrl: '', wins: 4, played: 5, points: 48, streak: 3 });
  db.prepare('UPDATE players SET photo_url = ? WHERE id = ?').run('/player-photos/anna.jpg', S.a);
  assert.strictEqual((await get()).player.photoUrl, '/player-photos/anna.jpg', 'the card shows the profile photo');
});

test('the points follow the rules: Elite 2:0 = 30, a win in three sets = 2 x the level; best-of-1 / best-of-5 earn nothing', async () => {
  // five Elite 2:0 wins are 150 (the live case where the ledger had missed one and the card said 120)
  const z = player('Zdenko Elitný', 'zdenko-elitny');
  const opp = player('Olaf Súper', 'olaf-super');
  for (let i = 1; i <= 5; i += 1) match(z, opp, z, `2026-09-${String(20 + i).padStart(2, '0')}T08:00:00.000Z`, 'ELITE');
  let r = await get();
  assert.deepStrictEqual([r.player.id, r.player.points, r.player.wins, r.player.played, r.player.streak], [z, 150, 5, 5, 5], 'five Elite 2:0 wins are 150, not 120');
  // a win in three sets is worth 2 x 10 = 20
  const three = match(z, opp, z, '2026-09-27T08:00:00.000Z', 'ELITE', 'FINISHED', true);
  assert.strictEqual((await get()).player.points, 170);
  db.prepare('DELETE FROM matches WHERE id = ?').run(three);
  // a match with three sets won (best of 5) earns nothing
  db.prepare("UPDATE matches SET state = ? WHERE player1_id = ? AND scheduled_at = '2026-09-21T08:00:00.000Z'").run(JSON.stringify({ setsWon: { 1: 3, 2: 0 } }), z);
  assert.strictEqual((await get()).player.points, 120, 'a 3:0 match earns nothing');
  db.prepare('DELETE FROM matches WHERE player1_id = ? AND category = ?').run(z, 'ELITE');
});

test('the points do not depend on the points ledger or on manual corrections of a table total', async () => {
  const q = player('Quido Ledger', 'quido-ledger');
  const w = player('Wanda Ledger', 'wanda-ledger');
  const ids = [1, 2, 3].map((i) => match(q, w, q, `2026-09-${String(10 + i).padStart(2, '0')}T08:00:00.000Z`, 'ELITE'));
  award(q, ids[0], 30); // the ledger knows only one of the three matches, and a manual +30 has no match at all
  db.prepare("UPDATE ranking_entries SET points = 1500 WHERE player_id = ?").run(q);
  const r = await get();
  assert.deepStrictEqual([r.player.id, r.player.points], [q, 90], 'three Elite 2:0 wins are 90 whatever the ledger says');
  db.prepare('DELETE FROM matches WHERE player1_id = ?').run(q);
});

test('the best of the rest wins when somebody else is stronger: by points, then wins', async () => {
  // Boris wins two Elite matches (2 x 30 = 60) against Anna's 48
  db.prepare("UPDATE matches SET category = 'ELITE' WHERE id IN (?, ?)").run(S.m.s4, S.m.s5);
  const r = await get();
  assert.strictEqual(r.player.id, S.b);
  assert.deepStrictEqual([r.player.wins, r.player.played, r.player.points, r.player.streak], [2, 3, 60, 2]);
});

test('the biggest courtIQ progress of the month: a different player than the player of the month, with the photo', async () => {
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
  const to = Number(ratingToBand(1900).toFixed(1));
  assert.deepStrictEqual(r.improved, { id: S.a, name: 'Anna Víťazná', slug: 'anna-vitazna', photoUrl: '/player-photos/anna.jpg', from, to, delta: Number((to - from).toFixed(1)), played: 5 });
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

test('the audit (admin only, read-only): which matches have the points the rules give, which have none, which differ', async () => {
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const audit = async (query = '') => (await fetch(`${BASE}/api/rankings/audit?month=2026-09${query}`, { headers: { Cookie: cookie } })).json();
  assert.strictEqual((await fetch(`${BASE}/api/rankings/audit`)).status, 401, 'admin only');
  const z = player('Zita Audit', 'zita-audit');
  const o = player('Oto Audit', 'oto-audit');
  const withSets = (when, sets) => Number(db.prepare("INSERT INTO matches (category, player1_id, player2_id, format, state, status, winner_id, scheduled_at) VALUES ('ELITE', ?, ?, 'BO3', ?, 'FINISHED', ?, ?)")
    .run(z, o, JSON.stringify({ setsWon: sets }), z, when).lastInsertRowid);
  const ok = withSets('2026-09-02T08:00:00.000Z', { 1: 2, 2: 0 });
  const gap = withSets('2026-09-03T08:00:00.000Z', { 1: 2, 2: 0 });
  const odd = withSets('2026-09-04T08:00:00.000Z', { 1: 2, 2: 1 });
  award(z, ok, 30);
  award(o, ok, 0);
  award(z, odd, 30); // the rules say 20 for a win in three sets
  award(o, odd, 10);
  const all = await audit(`&player=${z}`);
  assert.strictEqual(all.matches, 3);
  const by = Object.fromEntries(all.rows.map((r) => [r.matchId, r.status]));
  assert.deepStrictEqual(by, { [ok]: 'OK', [gap]: 'MISSING', [odd]: 'DIFFERENT' });
  const problems = await audit(`&player=${z}&problems=1`);
  assert.deepStrictEqual(problems.rows.map((r) => r.matchId), [gap, odd]);
  assert.strictEqual(problems.problems, 2);
  const row = problems.rows.find((r) => r.matchId === gap);
  assert.deepStrictEqual(row.expected.map((e) => e.points), [30, 0]);
  assert.deepStrictEqual(row.recorded, []);
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
