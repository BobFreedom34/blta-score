// Checks of the one-off seed of the BLTA Nultý Ročník play-off (src/nulty2025PlayoffSeed.js): it waits until all 16 players are there (nothing is
// written without them), then builds the bracket with every result when the app starts (seated as it was drawn, by lot), creates no match, runs
// only once and never brings back a bracket an admin deleted.
// Run: node scripts/check-nulty-2025-playoff-seed.js   (starts its own server a few times on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nulty25seed-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const DATA = require('../src/nulty2025PlayoffData.json');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let log = '';

const FULL = { 'Paľo Piroha': 'Pavol Piroha', 'Robo Sloboda': 'Róbert Sloboda', 'Braňo Bložon': 'Branislav Bložon', 'Kubo Paločný': 'Jakub Paločný' };
const full = (n) => FULL[n] || n;
const matches = DATA.brackets.ELITE;
const appNames = [...new Set(matches.flatMap((m) => [m.p1, m.p2]))].map(full);

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

const season = async () => (await call('GET', '/api/seasons')).json.find((s) => s.name === 'BLTA Nultý Ročník');
const brackets = async () => (await call('GET', `/api/seasons/${(await season()).id}/brackets`)).json;

test('the season is there (the app seeds it), the players are not: nothing is written and it says so', async () => {
  assert.ok(await season(), 'season');
  assert.strictEqual((await brackets()).length, 0);
  assert.ok(/Nultý ročník play-off: not written/.test(log), `log: ${log}`);
});

test('15 of the 16 players are not enough: still nothing is written', async () => {
  for (const name of appNames.filter((n) => n !== 'Michael Dojčan')) {
    const p = await call('POST', '/api/players', { name });
    assert.strictEqual(p.status, 201, `${name}: ${JSON.stringify(p.json)}`);
  }
  await restart();
  assert.strictEqual((await brackets()).length, 0);
  assert.ok(/Michael Dojčan/.test(log), 'the missing player is named');
});

test('with all 16 players the next start builds the bracket as it was drawn, with every result, and the champion is right', async () => {
  assert.strictEqual((await call('POST', '/api/players', { name: 'Michael Dojčan' })).status, 201);
  await restart();
  assert.ok(/Nultý ročník play-off bracket added/.test(log), `log: ${log}`);
  const list = await brackets();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].category, 'ELITE');
  const bracket = (await call('GET', `/api/brackets/${list[0].id}`)).json;
  assert.strictEqual(bracket.size, 16);
  assert.strictEqual(bracket.autoCreateMatches, false, 'a historical bracket creates no matches');
  const first = bracket.nodes.filter((n) => n.round === 1).sort((a, b) => a.position - b.position);
  const pairs = first.map((n) => [n.player1.name, n.player2.name].sort().join(' / '));
  const expected = matches.filter((m) => m.round === 1).sort((a, b) => a.order - b.order).map((m) => [full(m.p1), full(m.p2)].sort().join(' / '));
  assert.deepStrictEqual(pairs, expected, 'round 1 as drawn');
  const final = bracket.nodes.find((n) => n.round === bracket.rounds);
  const winner = [final.player1, final.player2].find((p) => p && p.id === final.winnerId);
  assert.strictEqual(winner && winner.name, 'Róbert Sloboda');
  assert.strictEqual(final.scoreSummary, '6-4, 6-4');
  assert.ok(bracket.nodes.filter((n) => !n.isBye).every((n) => n.winnerId && n.isManualResult), 'every slot has a hand-entered result');
  assert.strictEqual(bracket.nodes.filter((n) => n.isManualResult).length, matches.length);
  assert.ok(bracket.nodes.map((n) => n.scoreSummary).includes('Ret.'), 'the retirement is kept');
});

test('no ordinary match is created', async () => {
  assert.strictEqual((await call('GET', '/api/matches')).json.length, 0);
});

test('it runs only once and does not bring back a bracket an admin deleted', async () => {
  await restart();
  assert.strictEqual((await brackets()).length, 1, 'no second bracket');
  assert.strictEqual((await call('DELETE', `/api/brackets/${(await brackets())[0].id}`)).status, 200);
  await restart();
  assert.strictEqual((await brackets()).length, 0, 'the deleted one stays deleted');
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
