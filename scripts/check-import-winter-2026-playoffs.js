// Checks of scripts/import-winter-2026-playoffs.js on a throwaway copy of the app: the season and the 43 players are made first, then the import
// creates the three brackets with their results: the looking run changes nothing, the real run builds them, a second run leaves them alone,
// a missing player stops everything before anything is written.
// Run: node scripts/check-import-winter-2026-playoffs.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { run } = require('./import-winter-2026-playoffs');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos26-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'winter-opening-2026-playoffs.json'), 'utf8'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
const quiet = () => {};

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// the full names the app has for the nicknames on Rankedin
const FULL = { 'Paľo Piroha': 'Pavol Piroha', 'Paľo Blahút': 'Pavol Blahut', 'Robo Sloboda': 'Róbert Sloboda', 'Peťo Hladký': 'Peter Hladký', 'Braňo Bložon': 'Branislav Bložon', 'Kubo Paločný': 'Jakub Paločný', 'Jano Szalay': 'Jan Szalay' };
const appNames = [...new Set(Object.values(DATA.brackets).flatMap((ms) => ms.flatMap((m) => [m.p1, m.p2])))].map((n) => FULL[n] || n);
const allMatches = Object.values(DATA.brackets).reduce((sum, ms) => sum + ms.length, 0);

test('setup: the season (the app seeds it) and the 32 players', async () => {
  const seasons = (await call('GET', '/api/seasons')).json.filter((x) => x.name === 'Winter Opening Series 2026');
  if (!seasons.length) {
    const s = await call('POST', '/api/seasons', { name: 'Winter Opening Series 2026', startDate: '2026-01-01', endDate: '2026-04-30' });
    assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  }
  for (const name of appNames) {
    const p = await call('POST', '/api/players', { name });
    assert.strictEqual(p.status, 201, `${name}: ${JSON.stringify(p.json)}`);
  }
  assert.strictEqual(appNames.length, 32);
});

test('a missing player stops everything and nothing is written', async () => {
  const players = (await call('GET', '/api/players')).json;
  const gone = players.find((p) => p.name === 'Dmytro Novitskyi');
  const del = await call('DELETE', `/api/players/${gone.id}`);
  assert.ok([200, 204].includes(del.status), `delete player: ${del.status}`);
  await assert.rejects(() => run({ base, password: 'test', apply: true, log: quiet }), /Dmytro Novitskyi/);
  const season = (await call('GET', '/api/seasons')).json.find((s) => s.name === 'Winter Opening Series 2026');
  assert.strictEqual((await call('GET', `/api/seasons/${season.id}/brackets`)).json.length, 0);
  assert.strictEqual((await call('POST', '/api/players', { name: 'Dmytro Novitskyi' })).status, 201);
});

test('looking only: reports and changes nothing', async () => {
  const res = await run({ base, apply: false, log: quiet });
  assert.strictEqual(res.planned, 3);
  assert.strictEqual((await call('GET', `/api/seasons/${res.season.id}/brackets`)).json.length, 0);
});

test('the import creates the three brackets with every result, and the champions are right', async () => {
  const res = await run({ base, password: 'test', apply: true, log: quiet });
  assert.strictEqual(res.created.length, 3);
  const list = (await call('GET', `/api/seasons/${res.season.id}/brackets`)).json;
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
  const season = (await call('GET', '/api/seasons')).json.find((s) => s.name === 'Winter Opening Series 2026');
  const elite = (await call('GET', `/api/seasons/${season.id}/brackets`)).json.find((b) => b.category === 'ELITE');
  const full = (await call('GET', `/api/brackets/${elite.id}`)).json;
  const scores = full.nodes.map((n) => n.scoreSummary);
  assert.ok(scores.includes('6-1, 6-7, 6-4'), 'Ivan - Tobiášová');
  assert.ok(scores.includes('6-0, 7-5'), 'the final');
  assert.ok(scores.includes('Ret.'), 'Blahut - Varga, retired');
});

test('no ordinary match, ranking or player statistic is touched', async () => {
  const matches = (await call('GET', '/api/matches')).json;
  assert.strictEqual(matches.length, 0, 'the import creates no match');
});

test('a second run leaves the existing brackets alone', async () => {
  const res = await run({ base, password: 'test', apply: true, log: quiet });
  assert.strictEqual(res.created.length, 0);
  assert.strictEqual((await call('GET', `/api/seasons/${res.season.id}/brackets`)).json.length, 3);
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
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 40000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'admin login gave no cookie');
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
