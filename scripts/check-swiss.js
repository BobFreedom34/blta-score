// Checks of the Swiss system (format SWISS of a tournament category, src/swiss.js): the pairing (no rematch, byes), the number of rounds, the next round made by itself or by the
// organiser's button, the table with Buchholz and the final standing after the last round.
// Run: node scripts/check-swiss.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swiss-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let counter = 0;

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
async function newTournament(name) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-07-01', endDate: '2099-07-03' });
  assert.strictEqual(made.status, 201, made.text);
  return made.json;
}
async function register(season, category, count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = (await call('POST', '/api/players', { name: `${category} Swiss ${counter}` })).json;
    const reg = await call('POST', `/api/seasons/${season.id}/registrations/admin`, { playerId: p.id, category, phone: `0908${String(300000 + counter)}`, email: `s${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    list.push({ player: p, reg: reg.json });
  }
  return list;
}
const draw = (season, body) => call('POST', `/api/seasons/${season.id}/draw`, body);
const overview = async (season, category) => (await call('GET', `/api/seasons/${season.id}/draw`)).json.categories.find((c) => c.category === category);
const matchesOf = async (season) => (await call('GET', `/api/matches?seasonId=${season.id}`)).json;
// the higher player id wins 2:0
async function play(m) {
  const winner = Math.max(m.player1.id, m.player2.id);
  const set = m.player1.id === winner ? { p1: 6, p2: 2 } : { p1: 2, p2: 6 };
  const r = await call('POST', `/api/matches/${m.token}/manual-result`, { sets: [set, set], location: 'Kurt 1', scheduledAt: m.scheduledAt || '2099-07-01T10:00:00.000Z' });
  assert.strictEqual(r.status, 200, r.text);
}
const roundOf = (ms, r) => ms.filter((m) => m.round === r);
const pairKey = (m) => (m.player1.id < m.player2.id ? `${m.player1.id}-${m.player2.id}` : `${m.player2.id}-${m.player1.id}`);

// ---------- the pairing, without a server ----------

// (the pairing is pure, but the module opens a database when it loads: a temporary one of its own)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swiss-unit-'));
const swiss = require('../src/swiss');

test('the number of rounds: the logarithm of the players rounded up, at least 2, at most one less than the players', () => {
  assert.deepStrictEqual([4, 5, 6, 8, 9, 16, 17, 32].map(swiss.roundsFor), [2, 3, 3, 3, 4, 4, 5, 5]);
  assert.strictEqual(swiss.roundsFor(2), 1);
  assert.strictEqual(swiss.roundsFor(3), 2);
});

test('round 1: the first half of the players against the second (the best against the weakest); with an odd number the last one has the bye', () => {
  assert.deepStrictEqual(swiss.firstRound([1, 2, 3, 4, 5, 6, 7, 8]), { pairs: [[1, 5], [2, 6], [3, 7], [4, 8]], bye: null });
  assert.deepStrictEqual(swiss.firstRound([1, 2, 3, 4, 5]), { pairs: [[1, 3], [2, 4]], bye: 5 });
});

test('the later rounds: the best player without an opponent against the best he has not played; never a rematch, never a second bye (a simulation of many sizes)', () => {
  const random = (() => { let x = 12345; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();
  for (let n = 4; n <= 16; n += 1) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const points = new Map(ids.map((id) => [id, 0]));
    const played = new Set();
    const hadBye = new Set();
    const rounds = swiss.roundsFor(n);
    for (let round = 1; round <= rounds; round += 1) {
      const order = round === 1 ? ids : [...ids].sort((a, b) => points.get(b) - points.get(a) || a - b);
      const made = round === 1 ? swiss.firstRound(order) : swiss.pairRound(order, played, hadBye);
      assert.ok(made, `${n} players, round ${round}: a round exists`);
      const seen = new Set();
      made.pairs.forEach(([a, b]) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        assert.ok(!played.has(key), `${n} players, round ${round}: no rematch ${key}`);
        played.add(key);
        [a, b].forEach((x) => { assert.ok(!seen.has(x)); seen.add(x); });
        points.set(random() < 0.5 ? a : b, points.get(a) + 3); // (somebody wins: only the points matter for the next round)
      });
      if (made.bye !== null) { assert.ok(!hadBye.has(made.bye), `${n} players, round ${round}: a second bye`); hadBye.add(made.bye); seen.add(made.bye); points.set(made.bye, points.get(made.bye) + 3); }
      assert.strictEqual(seen.size, n, `${n} players, round ${round}: everybody has an opponent or the bye`);
    }
  }
});

// ---------- the draw and the rounds, through the API ----------

test('the draw: 8 players, 3 rounds, one table, round 1 made (4 matches, the best against the weakest); fewer than 4 players or too many rounds are refused', async () => {
  const t = await newTournament('Swiss Eight');
  const players = await register(t, 'ELITE', 3);
  const few = await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' });
  assert.strictEqual(few.status, 400, few.text);
  assert.ok(/at least 4 players/.test(few.json.error), few.json.error);
  await register(t, 'ELITE', 5);
  // seeds: the registered order is the seeding
  const regs = (await call('GET', `/api/seasons/${t.id}/registrations`)).json.filter((r) => r.category === 'ELITE');
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'ELITE', seeds: regs.map((r, i) => ({ id: r.id, seed: i + 1 })) })).status, 200);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3', rounds: 8 })).status, 400, 'at most 7 rounds of 8 players');
  const made = await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.rounds, 3);
  assert.strictEqual(made.json.groups.length, 1);
  assert.strictEqual(made.json.matches, 4);
  const ms = await matchesOf(t);
  assert.strictEqual(ms.length, 4);
  assert.ok(ms.every((m) => m.round === 1));
  const seedOf = new Map(regs.map((r, i) => [r.playerId, i + 1]));
  assert.deepStrictEqual(ms.map((m) => [seedOf.get(m.player1.id), seedOf.get(m.player2.id)].sort((a, b) => a - b).join('-')).sort(), ['1-5', '2-6', '3-7', '4-8']);
  const ov = await overview(t, 'ELITE');
  assert.strictEqual(ov.settings.format, 'SWISS');
  assert.strictEqual(ov.settings.rounds, 3);
  assert.deepStrictEqual({ round: ov.swiss.round, rounds: ov.swiss.rounds, canMakeNext: ov.swiss.canMakeNext, finished: ov.swiss.finished }, { round: 1, rounds: 3, canMakeNext: false, finished: false });
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 409, 'a second draw is refused');
  void players;
});

test('the rounds go on by themselves: the winners meet the winners, nobody plays the same opponent twice, the table has Buchholz, the final standing comes after the last round', async () => {
  const t = await newTournament('Swiss Play');
  await register(t, 'ELITE', 8);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 201);
  const seen = new Set();
  for (let round = 1; round <= 3; round += 1) {
    const ms = await matchesOf(t);
    const now = roundOf(ms, round);
    assert.strictEqual(now.length, 4, `round ${round} has 4 matches`);
    if (round > 1) {
      // the players with the same points meet: after round 1 four winners (3) and four losers (0)
      const standing = (await call('GET', `/api/seasons/${t.id}/standings`, undefined, { admin: false })).json.groups[0];
      const points = new Map(standing.rows.map((r) => [r.player.id, r.points]));
      now.forEach((m) => assert.strictEqual(points.get(m.player1.id) - points.get(m.player2.id) <= 3, true));
      if (round === 2) now.forEach((m) => assert.strictEqual(points.get(m.player1.id), points.get(m.player2.id), 'round 2: the same points meet'));
    }
    now.forEach((m) => { const k = pairKey(m); assert.ok(!seen.has(k), `no rematch ${k}`); seen.add(k); });
    const before = (await overview(t, 'ELITE')).swiss;
    assert.strictEqual(before.round, round);
    for (const m of now) await play(m);
  }
  const ms = await matchesOf(t);
  assert.strictEqual(ms.length, 12, '3 rounds of 4 matches, no fourth round');
  const ov = await overview(t, 'ELITE');
  assert.deepStrictEqual({ round: ov.swiss.round, finished: ov.swiss.finished, canMakeNext: ov.swiss.canMakeNext }, { round: 3, finished: true, canMakeNext: false });
  const group = (await call('GET', `/api/seasons/${t.id}/standings`, undefined, { admin: false })).json.groups[0];
  assert.deepStrictEqual(group.swiss, { round: 3, rounds: 3, finished: true });
  assert.ok(group.rows.every((r) => Number.isInteger(r.buchholz)), 'Buchholz in every row');
  assert.strictEqual(group.rows[0].points, 9, 'the best won all three');
  const final = (await call('GET', `/api/seasons/${t.id}/final-standings`, undefined, { admin: false })).json;
  assert.strictEqual(final.sections.length, 1);
  assert.strictEqual(final.complete, true);
  assert.strictEqual(final.sections[0].rows.length, 8);
  assert.strictEqual(final.sections[0].rows[0].from, 1);
});

test('the final standing is not complete before the last round, though the matches made so far are all played', async () => {
  const t = await newTournament('Swiss Partial');
  await register(t, 'ELITE', 4);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 201);
  for (const m of roundOf(await matchesOf(t), 1)) await play(m); // round 2 is made by itself
  assert.strictEqual((await matchesOf(t)).length, 4);
  for (const m of (await matchesOf(t)).filter((x) => x.status !== 'FINISHED')) await play(m);
  const final = (await call('GET', `/api/seasons/${t.id}/final-standings`, undefined, { admin: false })).json;
  assert.strictEqual(final.complete, true, '4 players have 2 rounds: now it is over');
  const t2 = await newTournament('Swiss Partial 2');
  await register(t2, 'ELITE', 6);
  assert.strictEqual((await draw(t2, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 201);
  for (const m of roundOf(await matchesOf(t2), 1)) await play(m);
  const ms = await matchesOf(t2);
  assert.strictEqual(ms.length, 6, 'round 2 was made');
  const mid = (await call('GET', `/api/seasons/${t2.id}/final-standings`, undefined, { admin: false })).json;
  assert.strictEqual(mid.complete, false, 'round 2 of 3 is still to be played');
});

test('an odd number of players: one has the bye in every round (a different player each time, the points of a win), 5 players', async () => {
  const t = await newTournament('Swiss Five');
  await register(t, 'ELITE', 5);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 201);
  const byes = [];
  for (let round = 1; round <= 3; round += 1) {
    const now = roundOf(await matchesOf(t), round);
    assert.strictEqual(now.length, 2, `round ${round}: 2 matches, one player rests`);
    const ov = await overview(t, 'ELITE');
    assert.ok(ov.swiss.bye, 'the bye is shown');
    byes.push(ov.swiss.bye.id);
    for (const m of now) await play(m);
  }
  assert.strictEqual(new Set(byes).size, 3, 'nobody has a second bye');
  const group = (await call('GET', `/api/seasons/${t.id}/standings`, undefined, { admin: false })).json.groups[0];
  assert.strictEqual(group.rows.reduce((s, r) => s + r.played, 0), 5 * 3, 'a bye counts as a played round: 3 each');
  const byeRow = group.rows.find((r) => r.player.id === byes[0]);
  assert.ok(byeRow.points >= 3, 'the points of a win for the bye');
  assert.strictEqual((await overview(t, 'ELITE')).swiss.finished, true);
});

test('made to go on by hand: the next round only on the button, refused while the round is not played, refused after the last round', async () => {
  const t = await newTournament('Swiss Hand');
  await register(t, 'ELITE', 8);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3', autoBracket: false, rounds: 2 })).status, 201);
  assert.strictEqual((await overview(t, 'ELITE')).settings.rounds, 2);
  const early = await call('POST', `/api/seasons/${t.id}/draw/swiss-round`, { category: 'ELITE' });
  assert.strictEqual(early.status, 409, early.text);
  for (const m of roundOf(await matchesOf(t), 1)) await play(m);
  assert.strictEqual((await matchesOf(t)).length, 4, 'not made by itself');
  assert.strictEqual((await overview(t, 'ELITE')).swiss.canMakeNext, true);
  const next = await call('POST', `/api/seasons/${t.id}/draw/swiss-round`, { category: 'ELITE' });
  assert.strictEqual(next.status, 201, next.text);
  assert.strictEqual(next.json.round, 2);
  assert.strictEqual((await matchesOf(t)).length, 8);
  for (const m of roundOf(await matchesOf(t), 2)) await play(m);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw/swiss-round`, { category: 'ELITE' })).status, 409, 'all rounds are played');
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw/swiss-round`, { category: 'NOVICE' })).status, 400, 'a category without a Swiss draw');
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw/swiss-round`, { category: 'ELITE' }, { admin: false })).status, 401);
});

test('the draw can be deleted while nothing is played (the byes go with it), and made again', async () => {
  const t = await newTournament('Swiss Delete');
  await register(t, 'ELITE', 5);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3' })).status, 201);
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.id}/draw/ELITE`)).status, 200);
  assert.strictEqual((await matchesOf(t)).length, 0);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SWISS', groupFormat: 'BO3', rounds: 2 })).status, 201);
  assert.strictEqual((await overview(t, 'ELITE')).swiss.rounds, 2);
  // played: refused
  for (const m of roundOf(await matchesOf(t), 1)) await play(m);
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.id}/draw/ELITE`)).status, 409);
});

test('the Swiss system is in the draw panel: the button, the number of rounds, the next round, the round in the table', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const panel = read('public/js/season-draw.js');
  assert.ok(panel.includes('SWISS:'), 'the format has its button');
  const order = [...panel.matchAll(/^ {2}([A-Z_]+): \[/gm)].map((m) => m[1]);
  assert.strictEqual(order[order.length - 1], 'SIX_ROUNDS', 'the 6 players format stays the last one');
  assert.ok(order.indexOf('SWISS') > order.indexOf('GROUPS_BRACKET'));
  assert.ok(panel.includes('swiss-round'), 'the button of the next round');
  assert.ok(read('public/js/group-table.js').includes('group.swiss'), 'the table says which round it is');
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k.startsWith('SMTP_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
      if (i === 99) throw new Error(`the server did not start: ${output}`);
    }
    const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
