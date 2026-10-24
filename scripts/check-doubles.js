// Checks of the doubles (štvorhra), phase 1 (src/doubles.js, src/routes/doubles.js, the doubles part of src/routes/matches.js): a doubles match
// is made with four players, shows the pair on each side, counts in the doubles ranking and statistics but never in the singles side of the app
// (singles lists, CourtIQ, badges), and its refusals.
// Run: node scripts/check-doubles.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubles-'));
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

const FOUR = { player1Name: 'Anna Alfa', player1bName: 'Boris Beta', player2Name: 'Cyril Gama', player2bName: 'Dana Delta' };
const make = (extra = {}) => call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', doubles: true, location: 'Kurt 1', ...FOUR, ...extra } });
const manual = (token, sets) => call('POST', `/api/matches/${token}/manual-result`, { body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });

let first = null;
let second = null;
let ids = {};

test('a doubles match has four players; each side shows as the pair', async () => {
  const r = await make();
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  first = r.json;
  assert.strictEqual(first.isDoubles, true);
  assert.strictEqual(first.player1.name, 'Anna Alfa / Boris Beta');
  assert.strictEqual(first.player2.name, 'Cyril Gama / Dana Delta');
  assert.deepStrictEqual(first.team1.map((p) => p.name), ['Anna Alfa', 'Boris Beta']);
  assert.deepStrictEqual(first.team2.map((p) => p.name), ['Cyril Gama', 'Dana Delta']);
  ids = { anna: first.team1[0].id, boris: first.team1[1].id, cyril: first.team2[0].id, dana: first.team2[1].id };
  const single = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: 'Eva Epsilon', player2Name: 'Filip Fi', location: 'Kurt 2' } });
  assert.strictEqual(single.json.isDoubles, false);
  assert.strictEqual(single.json.team1, null);
  assert.strictEqual(single.json.player1.name, 'Eva Epsilon');
});

test('what is refused: a league category, three players, the same person twice, proposing times, nobody logged in', async () => {
  assert.strictEqual((await make({ category: 'ELITE' })).status, 400);
  assert.strictEqual((await make({ player2bName: '' })).status, 400, 'three players');
  assert.strictEqual((await make({ player2bName: 'anna  alfa' })).status, 400, 'the same person twice');
  assert.strictEqual((await make({ proposalSlots: [new Date(Date.now() + 86400000).toISOString()], proposalVenues: ['Kurt'] })).status, 400, 'proposing times');
  assert.strictEqual((await call('POST', '/api/matches', { cookie: '', body: { category: 'FRIENDLY', format: 'BO3', doubles: true, ...FOUR } })).status, 401);
});

test('a finished doubles match gives each of its four players a win or a loss in the doubles ranking', async () => {
  const done = await manual(first.token, [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }]);
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.strictEqual(done.json.status, 'FINISHED');
  const r = await call('GET', '/api/doubles/ranking', { cookie: '' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.json.pointsWin, r.json.pointsLoss], [3, 1]);
  const row = (name) => r.json.rows.find((x) => x.name === name);
  assert.deepStrictEqual([row('Anna Alfa').points, row('Anna Alfa').wins, row('Anna Alfa').rank], [3, 1, 1]);
  assert.deepStrictEqual([row('Boris Beta').points, row('Boris Beta').rank], [3, 1], 'a tie shares the rank');
  assert.deepStrictEqual([row('Cyril Gama').points, row('Cyril Gama').losses, row('Cyril Gama').rank], [1, 1, 3]);
  assert.strictEqual(r.json.rows.length, 4);
});

test('partners, wins and the latest matches of one player', async () => {
  const r2 = await make({ player1Name: 'Anna Alfa', player1bName: 'Cyril Gama', player2Name: 'Boris Beta', player2bName: 'Dana Delta' });
  assert.strictEqual(r2.status, 201, JSON.stringify(r2.json));
  second = r2.json;
  assert.strictEqual((await manual(second.token, [{ p1: 3, p2: 6 }, { p1: 6, p2: 7 }])).status, 200);
  const s = await call('GET', `/api/doubles/player/${ids.anna}`, { cookie: '' });
  assert.strictEqual(s.status, 200);
  assert.deepStrictEqual([s.json.played, s.json.wins, s.json.losses, s.json.points], [2, 1, 1, 4]);
  assert.deepStrictEqual(s.json.partners.map((p) => `${p.name}:${p.wins}-${p.losses}`).sort(), ['Boris Beta:1-0', 'Cyril Gama:0-1']);
  assert.strictEqual(s.json.matches.length, 2);
  assert.strictEqual(s.json.matches[0].won, false, 'the latest match first');
  assert.deepStrictEqual(s.json.matches[0].opponents.sort(), ['Boris Beta', 'Dana Delta']);
  assert.strictEqual((await call('GET', '/api/doubles/player/999999', { cookie: '' })).status, 404);
  const none = await call('GET', '/api/doubles/player/' + (await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: 'Greta Gee', player2Name: 'Hugo Ha', location: 'x' } })).json.player1.id, { cookie: '' });
  assert.strictEqual(none.json.played, 0);
});

test('doubles never reach the singles side: lists, CourtIQ, the player\'s own numbers', async () => {
  const plain = await call('GET', `/api/matches?playerId=${ids.anna}&status=FINISHED`, { cookie: '' });
  assert.strictEqual(plain.json.length, 0, 'a player\'s singles list has no doubles match');
  const withDoubles = await call('GET', `/api/matches?playerId=${ids.anna}&status=FINISHED&withDoubles=1`, { cookie: '' });
  assert.strictEqual(withDoubles.json.length, 2, 'the "my matches" list can ask for them');
  const partner = await call('GET', `/api/matches?playerId=${ids.dana}&status=FINISHED&withDoubles=1`, { cookie: '' });
  assert.strictEqual(partner.json.length, 2, 'the partner of a side sees the match too');
  const iq = await call('GET', `/api/courtiq/player/${ids.anna}`, { cookie: '' });
  assert.strictEqual(iq.json.gamesPlayed, 0, 'no CourtIQ from doubles');
  assert.strictEqual((await call('GET', '/api/courtiq', { cookie: '' })).json.rows.length, 0);
  const search = await call('GET', '/api/matches?q=dana', { cookie: '' });
  assert.ok(search.json.some((m) => m.isDoubles), 'a search finds a match by the partner');
  const counts = await call('GET', `/api/matches/counts?playerId=${ids.anna}&withDoubles=1`, { cookie: '' });
  assert.ok(counts.json.MY_MATCHES >= 2);
});

test('a player who is in a doubles match cannot be deleted', async () => {
  assert.strictEqual((await call('DELETE', `/api/players/${ids.dana}`)).status, 400);
});

test('the players of a doubles match are not swapped by the single-match editor', async () => {
  const r = await call('PATCH', `/api/matches/${second.token}`, { body: { player1Id: ids.dana } });
  assert.strictEqual(r.status, 400, JSON.stringify(r.json));
});

test('the pages carry the pieces: the switch and the four fields, the ranking tab, the profile card, doubles in "my matches"', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  const form = read('new-match.html');
  ['mode-switch', 'player1b', 'player2b', 'doubles-note'].forEach((id) => assert.ok(form.includes(id), 'new-match.html: ' + id));
  const js = read('js/new-match.js');
  assert.ok(js.includes('doubles: true') && js.includes('player1bName') && js.includes('player2bName'), 'new-match.js sends the four players');
  assert.ok(read('js/rankings.js').includes("'/doubles/ranking'"), 'rankings.js loads the doubles ranking');
  assert.ok(read('js/rankings.js').includes('!m.isDoubles'), 'the badges tab leaves doubles out');
  assert.ok(read('player.html').includes('doubles-card') && read('js/player.js').includes('/doubles/player/'), 'the profile card');
  assert.ok(read('js/app.js').includes("'withDoubles'"), 'my matches ask for the doubles too');
  const i18n = read('js/i18n.js');
  ['newMatch.modeDoubles', 'rankings.doublesTab', 'player.doublesLabel'].forEach((k) => assert.strictEqual(i18n.split("'" + k + "'").length, 3, k + ' in Slovak and English'));
  const title = await (await fetch(base + '/match/' + first.token)).text();
  assert.ok(title.includes('Anna Alfa / Boris Beta vs Cyril Gama / Dana Delta'), 'the page title and the link preview name the pairs');
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
