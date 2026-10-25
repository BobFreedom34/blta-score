// Check of the card "Zmeny úrovne" of the match page (src/ratingChanges.js, GET /api/matches/:token/rating-changes): a finished singles match shows what it
// did to the CourtIQ of both players, a finished doubles match what it did to the doubles rating of all four; a match that is not finished shows nothing.
// Run: node scripts/check-level-changes.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levels-'));
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
const single = (a, b) => call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: a, player2Name: b, location: 'Kurt 1' } });
const manual = (token, sets, when) => call('POST', `/api/matches/${token}/manual-result`, { body: { sets, location: 'Kurt 1', scheduledAt: when || new Date().toISOString() } });
const changes = (token) => call('GET', `/api/matches/${token}/rating-changes`, { cookie: '' });

let first = null;
test('a finished singles match shows the change of the CourtIQ of both players: the winner up, the loser down', async () => {
  const m = await single('Anna Alfa', 'Boris Beta');
  assert.strictEqual(m.status, 201, JSON.stringify(m.json));
  first = m.json;
  assert.strictEqual((await manual(first.token, [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }], '2026-09-01T10:00:00.000Z')).status, 200);
  const r = await changes(first.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.kind, 'COURTIQ');
  assert.deepStrictEqual(r.json.players.map((p) => [p.name, p.side]), [['Anna Alfa', 1], ['Boris Beta', 2]]);
  const [a, b] = r.json.players;
  assert.ok(a.change > 0, `the winner goes up (${a.change})`);
  assert.ok(b.change < 0, `the loser goes down (${b.change})`);
  assert.ok(Math.abs(a.change * 100 - Math.round(a.change * 100)) < 1e-9, 'two decimals');
  assert.ok(a.level >= 1 && a.level <= 7);
});

test('the change of an older match stays what it was when the players play again', async () => {
  const before = (await changes(first.token)).json.players.map((p) => p.change);
  const second = await single('Boris Beta', 'Anna Alfa');
  assert.strictEqual((await manual(second.json.token, [{ p1: 7, p2: 5 }, { p1: 6, p2: 4 }], '2026-09-08T10:00:00.000Z')).status, 200);
  assert.deepStrictEqual((await changes(first.token)).json.players.map((p) => p.change), before);
  const r = (await changes(second.json.token)).json;
  assert.deepStrictEqual(r.players.map((p) => p.name), ['Boris Beta', 'Anna Alfa']);
  assert.ok(r.players[0].change > 0 && r.players[1].change < 0, 'Boris won the second match');
});

test('a doubles match shows the change of the doubles rating of all four players', async () => {
  const m = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', doubles: true, location: 'Kurt 2', player1Name: 'Cyril Gama', player1bName: 'Dana Delta', player2Name: 'Eva Epsilon', player2bName: 'Filip Fi' } });
  assert.strictEqual(m.status, 201, JSON.stringify(m.json));
  assert.strictEqual((await manual(m.json.token, [{ p1: 6, p2: 1 }, { p1: 6, p2: 2 }])).status, 200);
  const r = (await changes(m.json.token)).json;
  assert.strictEqual(r.kind, 'DOUBLES');
  assert.deepStrictEqual(r.players.map((p) => [p.name, p.side]), [['Cyril Gama', 1], ['Dana Delta', 1], ['Eva Epsilon', 2], ['Filip Fi', 2]]);
  assert.ok(r.players.slice(0, 2).every((p) => p.change > 0) && r.players.slice(2).every((p) => p.change < 0));
});

test('a match that is not finished, or has no rating, shows nothing; an unknown match is a 404', async () => {
  const planned = await single('Greta Gee', 'Hugo Ha');
  const r = await changes(planned.json.token);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.players, []);
  assert.strictEqual((await changes('nope-nope')).status, 404);
});

test('the match page carries the card and its words', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  const js = read('js/match.js');
  assert.ok(js.includes('levelChangesHtml') && js.includes('/rating-changes') && js.includes('lc-card'));
  const i18n = read('js/i18n.js');
  ['match.levelChanges', 'match.levelChangesDoubles'].forEach((k) => assert.strictEqual(i18n.split(`'${k}'`).length, 3, `${k} in Slovak and English`));
  assert.ok(read('css/style.css').includes('.lc-change.up'));
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
