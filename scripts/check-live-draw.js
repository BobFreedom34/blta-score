// Checks of the draw in front of the camera ("Žreb naživo", src/liveDraw.js, public/draw-live.html): the plan that is shown is exactly the draw that is saved (groups, brackets, the table of
// 6, the Swiss table), the lot is made from a key whose lock is shown first and which anybody can check in the browser (public/js/draw-verify.js), nothing is saved before the organiser says so, a draw
// that no longer fits the players is refused, every start is written down, a saved draw is public and replayable.
// Run: node scripts/check-live-draw.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const DrawVerify = require('../public/js/draw-verify.js');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldraw-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

let counter = 0;
// a tournament with registered players: { tournament, regs: [{ player, reg }] } per category
async function tournamentWith(name, categories) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03' });
  assert.strictEqual(made.status, 201, made.text);
  const tournament = made.json;
  const people = {};
  for (const [category, count] of Object.entries(categories)) {
    people[category] = [];
    for (let i = 0; i < count; i += 1) {
      counter += 1;
      const p = await call('POST', '/api/players', { name: `${category} Hráč ${String(counter).padStart(2, '0')}` });
      assert.strictEqual(p.status, 201, p.text);
      const reg = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { playerId: p.json.id, category, phone: `0903${String(100000 + counter)}`, email: `p${counter}@example.com` });
      assert.strictEqual(reg.status, 201, reg.text);
      people[category].push({ player: p.json, reg: reg.json });
    }
  }
  return { tournament, people };
}
const seed = async (t, category, list, n) => {
  const items = list.map((x, i) => ({ id: x.reg.id, seed: i < n ? i + 1 : null }));
  const r = await call('POST', `/api/seasons/${t.id}/seeds`, { category, seeds: items });
  assert.strictEqual(r.status, 200, r.text);
};
const prepare = (t, category, options) => call('POST', `/api/seasons/${t.id}/draw/live/prepare`, { category, ...options });
const commit = (t, recordId) => call('POST', `/api/seasons/${t.id}/draw/live/commit`, { recordId });
const overviewOf = async (t, category) => (await call('GET', `/api/seasons/${t.id}/draw`)).json.categories.find((c) => c.category === category);

// every entrant is placed exactly once, on a seat of its own, and the seeded players come first
function assertPlanIsComplete(plan) {
  const ids = new Set(plan.entrants.map((e) => e.id));
  assert.strictEqual(plan.steps.length, plan.entrants.length);
  assert.deepStrictEqual(new Set(plan.steps.map((s) => s.e)), ids, 'every player is placed once');
  assert.strictEqual(new Set(plan.steps.map((s) => JSON.stringify(s.slot))).size, plan.steps.length, 'every seat is used once');
  const kinds = plan.steps.map((s) => s.kind);
  const lastSeed = kinds.lastIndexOf('SEED');
  assert.ok(kinds.slice(0, lastSeed + 1).every((k) => k === 'SEED'), 'the seeded players are shown first');
  assert.strictEqual(kinds.filter((k) => k === 'SEED').length, plan.entrants.filter((e) => e.seed).length);
}

let t1; let p1;

test('setup: a tournament with Elite 10 (3 seeded), Next Gen 9 (2 seeded) and Novice 6 players', async () => {
  ({ tournament: t1, people: p1 } = await tournamentWith('Live Open 2026', { ELITE: 10, NEXT_GEN: 9, NOVICE: 6 }));
  await seed(t1, 'ELITE', p1.ELITE, 3);
  await seed(t1, 'NEXT_GEN', p1.NEXT_GEN, 2);
});

test('the page is served (noindex, no sitemap entry) and the checker works in this runtime', async () => {
  const page = await call('GET', '/draw-live', undefined, { admin: false });
  assert.strictEqual(page.status, 200);
  assert.ok(/noindex/.test(page.text), 'noindex');
  assert.ok(/draw-live\.js/.test(page.text) && /draw-verify\.js/.test(page.text), 'the scripts');
  assert.ok(!/draw-live/.test((await call('GET', '/sitemap.xml', undefined, { admin: false })).text), 'not in the sitemap');
  assert.strictEqual((await call('GET', '/draw-live?record=1', undefined, { admin: false })).status, 200, 'the replay address');
  assert.ok(typeof DrawVerify.verifyRecord === 'function');
});

test('only the organiser can start or save a draw', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${t1.id}/draw/live/prepare`, { category: 'ELITE' }, { admin: false })).status, 401);
  assert.strictEqual((await call('POST', `/api/seasons/${t1.id}/draw/live/commit`, { recordId: 1 }, { admin: false })).status, 401);
});

test('starting a draw writes nothing into the tournament; the lock is the hash of the key', async () => {
  const r = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.seedHash, crypto.createHash('sha256').update(r.json.seed).digest('hex'));
  assert.strictEqual(r.json.seed.length, 64);
  assert.strictEqual(r.json.attempt, 1);
  assertPlanIsComplete(r.json.plan);
  assert.strictEqual(r.json.plan.layout.type, 'GROUPS');
  assert.strictEqual(r.json.plan.layout.groups.length, 3, '10 players, groups of 4: 3 groups');
  assert.strictEqual((await overviewOf(t1, 'ELITE')).stage, 'NONE', 'nothing saved');
  // the seeded players take the seats of the snake: seed 1 in group A, seed 2 in group B, seed 3 in group C
  const seeded = r.json.plan.steps.filter((s) => s.kind === 'SEED');
  assert.deepStrictEqual(seeded.map((s) => s.slot), [{ g: 0, i: 0 }, { g: 1, i: 0 }, { g: 2, i: 0 }]);
  // a draw that was not saved is not public
  assert.strictEqual((await call('GET', `/api/draw-records/${r.json.recordId}`, undefined, { admin: false })).status, 404);
});

test('the shuffle is repeated from the key in the browser code and agrees with the server (groups, bracket, table of 6, Swiss)', async () => {
  const cases = [
    [t1, 'ELITE', { format: 'GROUPS', groupSize: 4 }],
    [t1, 'ELITE', { format: 'GROUPS_BRACKET', groupSize: 5 }],
    [t1, 'NEXT_GEN', { format: 'ELIMINATION' }],
    [t1, 'NEXT_GEN', { format: 'PRINCE' }],
    [t1, 'NOVICE', { format: 'SIX_ROUNDS' }],
    [t1, 'NOVICE', { format: 'SWISS' }],
  ];
  for (const [t, category, options] of cases) {
    const r = await prepare(t, category, options);
    assert.strictEqual(r.status, 201, `${options.format}: ${r.text}`);
    assertPlanIsComplete(r.json.plan);
    const v = await DrawVerify.verifyRecord({ seed: r.json.seed, seedHash: r.json.seedHash, plan: r.json.plan });
    assert.ok(v.ok && v.lockOk, `${options.format}: ${v.problems.join('; ')}`);
  }
});

test('a changed key, lock or seat is caught by the check', async () => {
  const r = await prepare(t1, 'NEXT_GEN', { format: 'ELIMINATION' });
  const rec = { seed: r.json.seed, seedHash: r.json.seedHash, plan: r.json.plan };
  assert.ok((await DrawVerify.verifyRecord(rec)).ok);
  const wrongKey = { ...rec, seed: crypto.randomBytes(32).toString('hex') };
  const a = await DrawVerify.verifyRecord(wrongKey);
  assert.ok(!a.ok && !a.lockOk, 'another key does not fit the lock');
  const plan = JSON.parse(JSON.stringify(rec.plan));
  const drawn = plan.steps.filter((s) => s.kind === 'DRAW');
  [drawn[0].slot, drawn[1].slot] = [drawn[1].slot, drawn[0].slot]; // two players swap seats after the shuffle
  const b = await DrawVerify.verifyRecord({ ...rec, plan });
  assert.ok(!b.ok && b.lockOk, 'swapped seats are found');
});

test('the draws differ from start to start (a fresh key every time), the seeded seats do not', async () => {
  const a = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  const b = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  assert.notStrictEqual(a.json.seed, b.json.seed);
  assert.notStrictEqual(a.json.recordId, b.json.recordId);
  assert.strictEqual(b.json.attempt, a.json.attempt + 1, 'the attempts are counted');
  assert.deepStrictEqual(a.json.plan.steps.filter((s) => s.kind === 'SEED').map((s) => s.e), b.json.plan.steps.filter((s) => s.kind === 'SEED').map((s) => s.e));
});

test('what is saved is exactly what was shown: groups', async () => {
  const r = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(p1.ELITE.map((x) => [x.reg.id, x.player.id]));
  r.json.plan.steps.forEach((s) => assert.strictEqual(saved.json.groups[s.slot.g].playerIds[s.slot.i], playerOf.get(s.e), 'the seat of a player'));
  assert.strictEqual(saved.json.groups.length, r.json.plan.layout.groups.length);
  assert.strictEqual((await overviewOf(t1, 'ELITE')).stage, 'GROUPS');
  assert.strictEqual((await overviewOf(t1, 'ELITE')).liveRecordId, r.json.recordId);
});

test('what is saved is exactly what was shown: a bracket with byes (9 players, 2 seeded)', async () => {
  const r = await prepare(t1, 'NEXT_GEN', { format: 'PRINCE' });
  assert.strictEqual(r.json.plan.layout.size, 16);
  assert.strictEqual(r.json.plan.layout.byes, 7);
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const bracket = (await call('GET', `/api/brackets/${saved.json.main}`)).json;
  const round1 = bracket.nodes.filter((n) => n.round === 1).sort((a, b) => a.position - b.position);
  const playerOf = new Map(p1.NEXT_GEN.map((x) => [x.reg.id, x.player.id]));
  r.json.plan.steps.forEach((s) => {
    const node = round1[Math.floor(s.slot.p / 2)];
    const seat = s.slot.p % 2 === 0 ? node.player1 : node.player2;
    assert.strictEqual(seat && seat.id, playerOf.get(s.e), 'the seat of a player');
  });
  const seats = r.json.plan.layout.seats;
  assert.strictEqual(seats.filter((x) => x.bye).length, 7);
});

test('what is saved is exactly what was shown: the table of 6', async () => {
  const r = await prepare(t1, 'NOVICE', { format: 'SIX_ROUNDS' });
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(p1.NOVICE.map((x) => [x.reg.id, x.player.id]));
  assert.deepStrictEqual(saved.json.groups[0].playerIds, r.json.plan.steps.map((s) => playerOf.get(s.e)));
});

test('a draw is saved once, a saved one is public with its key, and the starts are counted', async () => {
  const rec = (await overviewOf(t1, 'ELITE')).liveRecordId;
  const again = await commit(t1, rec);
  assert.strictEqual(again.status, 409);
  const pub = await call('GET', `/api/draw-records/${rec}`, undefined, { admin: false });
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.json.seedHash, crypto.createHash('sha256').update(pub.json.seed).digest('hex'));
  assert.strictEqual(pub.json.seasonName, 'Live Open 2026');
  assert.ok(pub.json.attempts >= 4, `the starts of the category are counted (${pub.json.attempts})`);
  assert.strictEqual(pub.json.deleted, false);
  assert.ok((await DrawVerify.verifyRecord(pub.json)).ok, 'anybody can repeat the draw from the public record');
  assert.strictEqual((await call('GET', '/api/draw-records/999999', undefined, { admin: false })).status, 404);
});

test('a draw that no longer fits the players (the seeding changed) is refused and nothing is saved', async () => {
  const { tournament: t2, people } = await tournamentWith('Changing Cup', { ELITE: 6 });
  await seed(t2, 'ELITE', people.ELITE, 2);
  const r = await prepare(t2, 'ELITE', { format: 'ELIMINATION' });
  assert.strictEqual(r.status, 201, r.text);
  await seed(t2, 'ELITE', people.ELITE, 3); // one more seeded player after the draw was shown
  const saved = await commit(t2, r.json.recordId);
  assert.strictEqual(saved.status, 409, saved.text);
  assert.strictEqual((await overviewOf(t2, 'ELITE')).stage, 'NONE');
  // a new start fits
  const fresh = await prepare(t2, 'ELITE', { format: 'ELIMINATION' });
  assert.strictEqual((await commit(t2, fresh.json.recordId)).status, 201);
});

test('what the real draw refuses, the live draw refuses before it starts', async () => {
  assert.strictEqual((await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 })).status, 409, 'the draw already exists');
  const { tournament: t3, people } = await tournamentWith('Small Cup', { ELITE: 5, NOVICE: 1 });
  assert.strictEqual((await prepare(t3, 'NOVICE', { format: 'ELIMINATION' })).status, 400, 'one player');
  assert.strictEqual((await prepare(t3, 'ELITE', { format: 'SIX_ROUNDS' })).status, 400, 'exactly 6 players');
  assert.strictEqual((await prepare(t3, 'ELITE', { format: 'ELIMINATION', mode: 'MANUAL' })).status, 400, 'a draw by hand is not a lot');
  assert.strictEqual((await prepare(t3, 'NOPE', { format: 'ELIMINATION' })).status, 400, 'no such category');
  void people;
});

test('the Swiss table: the seeded players first, the others by lot, saved in the order shown', async () => {
  const { tournament: t4, people } = await tournamentWith('Swiss Live', { ELITE: 7 });
  await seed(t4, 'ELITE', people.ELITE, 2);
  const r = await prepare(t4, 'ELITE', { format: 'SWISS' });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.plan.layout.type, 'TABLE');
  assert.deepStrictEqual(r.json.plan.steps.slice(0, 2).map((s) => s.kind), ['SEED', 'SEED']);
  const saved = await commit(t4, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(people.ELITE.map((x) => [x.reg.id, x.player.id]));
  assert.deepStrictEqual(saved.json.groups[0].playerIds, r.json.plan.steps.map((s) => playerOf.get(s.e)));
});

test('a draw that was deleted later stays on record, marked as deleted', async () => {
  const rec = (await overviewOf(t1, 'NOVICE')).liveRecordId;
  assert.ok(rec);
  const del = await call('DELETE', `/api/seasons/${t1.id}/draw/NOVICE`);
  assert.strictEqual(del.status, 200, del.text);
  const pub = await call('GET', `/api/draw-records/${rec}`, undefined, { admin: false });
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.json.deleted, true);
  assert.strictEqual((await overviewOf(t1, 'NOVICE')).liveRecordId, null);
});

test('the draw panel of the organiser has the button and the record link; the page scripts exist', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'season-draw.js'), 'utf8');
  assert.ok(js.includes('data-act="live"') && js.includes("act === 'live'") && js.includes('/draw-live?season='), 'the button');
  assert.ok(js.includes('/draw-live?record='), 'the record link');
  const page = fs.readFileSync(path.join(ROOT, 'public', 'js', 'draw-live.js'), 'utf8');
  for (const piece of ['/draw/live/prepare', '/draw/live/commit', '/draw-records/', 'DrawVerify.verifyRecord', 'requestFullscreen', 'countdown', 'dl-hot', 'dl-fly']) assert.ok(page.includes(piece), piece);
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'draw-live.css'), 'utf8');
  for (const piece of ['.dl-pool-item', '.dl-slot', '.dl-count-num', '.dl-final']) assert.ok(css.includes(piece), piece);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
