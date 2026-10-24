// Check of the number on the tournaments card of the city rankings (slta.sk/rebricky-miest, GET /api/leagues/rankings): it counts the players
// who PLAYED a match of a tournament (finished, no walkover), not everybody who has tournament points (some only got them entered by hand).
// Run: node scripts/check-tournament-player-count.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcount-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('the card counts the players who played a tournament match, not the players with tournament points', async () => {
  const P = {};
  for (const name of ['Adam A', 'Boris B', 'Cyril C', 'Dušan D', 'Emil E', 'Fero F']) {
    const r = await call('POST', '/api/players', { body: { name } });
    P[name] = r.json.id;
  }
  const season = await call('POST', '/api/seasons', { body: { name: 'Letný turnaj', kind: 'TOURNAMENT' } });
  assert.strictEqual(season.status, 201, JSON.stringify(season.json));
  // a draw of the tournament: Adam-Dušan and Boris-Cyril in round 1
  const draw = await call('POST', '/api/brackets', {
    body: {
      name: 'Pavúk', format: 'BO3', category: 'ELITE', seasonId: season.json.id,
      entries: [{ playerId: P['Adam A'], seed: 1 }, { playerId: P['Boris B'], seed: 2 }, { playerId: P['Cyril C'], seed: 3 }, { playerId: P['Dušan D'], seed: 4 }],
    },
  });
  assert.strictEqual(draw.status, 201, JSON.stringify(draw.json));
  const first = draw.json.nodes.find((n) => n.round === 1 && n.match && n.player1.id === P['Adam A']);
  assert.ok(first, 'Adam meets Dušan');
  // only that match is played: Adam, Dušan have played; Boris and Cyril have a match that is only planned
  const done = await call('POST', `/api/matches/${first.match.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  // tournament points entered by hand for three players, two of whom never played a match of it
  for (const [name, points] of [['Adam A', 40], ['Emil E', 30], ['Fero F', 20]]) {
    const r = await call('PUT', `/api/rankings/points/tournaments/${encodeURIComponent(name)}`, { body: { points } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  }
  const r = await call('GET', '/api/leagues/rankings', { cookie: '' });
  assert.strictEqual(r.status, 200);
  const city = r.json.cities.find((c) => c.rankings.tournaments.total > 0);
  assert.ok(city, 'a city with a tournaments ranking');
  assert.ok(city.rankings.tournaments.total >= 3, 'at least the three entered by hand have tournament points (the rest come from the seeded table)');
  assert.strictEqual(city.rankings.tournaments.playerCount, 2, 'but two played a match of a tournament');
});

test('the card shows playerCount when there is one, the number of rows for the other rankings', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/slta-rankings.js'), 'utf8');
  assert.ok(js.includes('r.playerCount !== undefined'));
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
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held for a moment on Windows; it is a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
