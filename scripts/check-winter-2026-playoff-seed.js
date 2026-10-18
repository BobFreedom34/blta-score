// Checks of the one-off seed of the Winter Opening Series 2026 play-offs (src/winter2026PlayoffSeed.js): it waits until all 32 players are there
// (nothing is written without them), then builds the three brackets with every result when the app starts, creates no match, runs only once and
// never brings back a bracket an admin deleted.
// Run: node scripts/check-winter-2026-playoff-seed.js   (starts its own server a few times on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos26seed-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const DATA = require('../src/winter2026PlayoffData.json');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let log = '';

const FULL = { 'Paľo Piroha': 'Pavol Piroha', 'Paľo Blahút': 'Pavol Blahut', 'Robo Sloboda': 'Róbert Sloboda', 'Peťo Hladký': 'Peter Hladký', 'Braňo Bložon': 'Branislav Bložon', 'Kubo Paločný': 'Jakub Paločný', 'Jano Szalay': 'Jan Szalay' };
const appNames = [...new Set(Object.values(DATA.brackets).flatMap((ms) => ms.flatMap((m) => [m.p1, m.p2])))].map((n) => FULL[n] || n);
const allMatches = Object.values(DATA.brackets).reduce((sum, ms) => sum + ms.length, 0);

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function startServer() {
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
  for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
  log = '';
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${log}`)), 60000);
    child.stdout.on('data', (d) => { log += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'admin login gave no cookie');
}
async function stopServer() {
  if (!child) return;
  const c = child;
  child = null;
  c.removeAllListeners('exit');
  c.kill();
  await new Promise((r) => setTimeout(r, 600));
}
const restart = async () => { await stopServer(); await startServer(); };

const season = async () => (await call('GET', '/api/seasons')).json.find((s) => s.name === 'Winter Opening Series 2026');
const brackets = async () => (await call('GET', `/api/seasons/${(await season()).id}/brackets`)).json;

test('the season is there (the app seeds it), the players are not: nothing is written and it says so', async () => {
  assert.ok(await season(), 'season');
  assert.strictEqual((await brackets()).length, 0);
  assert.ok(/Winter 2026 play-offs: not written/.test(log), `log: ${log}`);
});

test('31 of the 32 players are not enough: still nothing is written', async () => {
  for (const name of appNames.filter((n) => n !== 'Dmytro Novitskyi')) {
    const p = await call('POST', '/api/players', { name });
    assert.strictEqual(p.status, 201, `${name}: ${JSON.stringify(p.json)}`);
  }
  await restart();
  assert.strictEqual((await brackets()).length, 0);
  assert.ok(/Dmytro Novitskyi/.test(log), 'the missing player is named');
});

test('with all 32 players the next start builds the three brackets with every result, and the champions are right', async () => {
  assert.strictEqual((await call('POST', '/api/players', { name: 'Dmytro Novitskyi' })).status, 201);
  await restart();
  assert.ok(/Winter 2026 play-off brackets added/.test(log), `log: ${log}`);
  const list = await brackets();
  assert.deepStrictEqual(list.map((b) => b.category).sort(), ['ELITE', 'NEXT_GEN', 'NOVICE']);
  const champion = { ELITE: 'Róbert Sloboda', NEXT_GEN: 'Peter Bicko', NOVICE: 'Ján Beňo' };
  const sizes = { ELITE: 16, NEXT_GEN: 8, NOVICE: 8 };
  let results = 0;
  for (const b of list) {
    const full = (await call('GET', `/api/brackets/${b.id}`)).json;
    assert.strictEqual(full.size, sizes[b.category], `${b.category} size`);
    assert.strictEqual(full.season.name, 'Winter Opening Series 2026');
    assert.strictEqual(full.autoCreateMatches, false, 'a historical bracket creates no matches');
    const final = full.nodes.find((n) => n.round === full.rounds);
    const winner = [final.player1, final.player2].find((p) => p && p.id === final.winnerId);
    assert.strictEqual(winner && winner.name, champion[b.category], `${b.category} champion`);
    assert.ok(full.nodes.filter((n) => !n.isBye).every((n) => n.winnerId && n.isManualResult), `${b.category}: every slot has a hand-entered result`);
    results += full.nodes.filter((n) => n.isManualResult).length;
  }
  assert.strictEqual(results, allMatches);
});

test('the scores are on the slots, winner first, and the retirement is kept', async () => {
  const elite = (await brackets()).find((b) => b.category === 'ELITE');
  const scores = (await call('GET', `/api/brackets/${elite.id}`)).json.nodes.map((n) => n.scoreSummary);
  assert.ok(scores.includes('6-1, 6-7, 6-4'), 'Ivan - Tobiášová');
  assert.ok(scores.includes('6-0, 7-5'), 'the final');
  assert.ok(scores.includes('Ret.'), 'Blahut - Varga, retired');
});

test('no ordinary match is created', async () => {
  assert.strictEqual((await call('GET', '/api/matches')).json.length, 0);
});

test('it runs only once and does not bring back a bracket an admin deleted', async () => {
  await restart();
  assert.strictEqual((await brackets()).length, 3, 'no second set');
  const novice = (await brackets()).find((b) => b.category === 'NOVICE');
  assert.strictEqual((await call('DELETE', `/api/brackets/${novice.id}`)).status, 200);
  await restart();
  assert.strictEqual((await brackets()).length, 2, 'the deleted one stays deleted');
});

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    await stopServer();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
