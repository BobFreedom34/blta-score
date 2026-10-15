// Checks of "Zápas týždňa": GET /api/match-of-the-week picks the most interesting league match of the next 7 days (or a live one).
// Run: node scripts/check-match-of-the-week.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motw-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const execSql = (statement, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'));
  try { d.prepare(statement).run(...params); } finally { d.close(); }
};
const inDays = (n, hour = 10) => new Date(Date.now() + n * 24 * 60 * 60 * 1000 + hour * 0).toISOString();
const S = (a, b) => ({ p1: a, p2: b });
let counter = 0;
const newPlayer = async (name) => {
  counter += 1;
  const r = await call('POST', '/api/players', { name: `${name} ${counter}` });
  assert.strictEqual(r.status, 201, r.text);
  return r.json;
};
const planned = async (category, p1, p2, days) => {
  const r = await call('POST', '/api/matches', { category, format: 'BO3', player1Id: p1.id, player2Id: p2.id, location: 'Court 1', scheduledAt: inDays(days) });
  assert.strictEqual(r.status, 201, r.text);
  return r.json.token;
};
const played = async (category, p1, p2, sets) => {
  const made = await call('POST', '/api/matches', { category, format: 'BO3', player1Id: p1.id, player2Id: p2.id, location: 'Court 1' });
  const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { sets, location: 'Court 1', scheduledAt: '2026-09-20T10:00:00.000Z' });
  assert.strictEqual(done.status, 200, done.text);
  return made.json.token;
};
const motw = async () => (await call('GET', '/api/match-of-the-week')).json;
const removeAllPlanned = () => execSql("DELETE FROM matches WHERE status = 'PLANNED'");

test('no match in the next 7 days: token is null', async () => {
  assert.deepStrictEqual(await motw(), { token: null });
});

test('friendlies, matches further than 7 days away and matches in the past are never chosen', async () => {
  const [a, b] = [await newPlayer('Fri A'), await newPlayer('Fri B')];
  await planned('FRIENDLY', a, b, 2);
  await planned('NOVICE', a, b, 10);
  await planned('NOVICE', a, b, -3);
  assert.deepStrictEqual(await motw(), { token: null });
  removeAllPlanned();
});

test('a higher league category wins when nothing else separates two matches', async () => {
  const [a, b, c, d] = [await newPlayer('Cat A'), await newPlayer('Cat B'), await newPlayer('Cat C'), await newPlayer('Cat D')];
  await planned('NOVICE', a, b, 3);
  const elite = await planned('ELITE', c, d, 3);
  assert.strictEqual((await motw()).token, elite);
  removeAllPlanned();
});

test('players who have met before beat strangers, and the more even their record the better; the record is counted from player 1', async () => {
  const [a, b, c, d, e, f] = await Promise.all(['H A', 'H B', 'H C', 'H D', 'H E', 'H F'].map(newPlayer));
  await played('NOVICE', a, b, [S(6, 3), S(6, 4)]); // a wins
  await played('NOVICE', b, a, [S(6, 2), S(6, 2)]); // b wins (player 1 this time)
  await planned('NOVICE', c, d, 1); // no history
  const rivals = await planned('NOVICE', a, b, 2); // 1 — 1
  const oneSided = await planned('NOVICE', e, f, 1);
  await played('NOVICE', e, f, [S(6, 0), S(6, 0)]);
  await played('NOVICE', e, f, [S(6, 1), S(6, 1)]);
  const pick = await motw();
  assert.strictEqual(pick.token, rivals, `chosen ${pick.token}, one-sided was ${oneSided}`);
  assert.deepStrictEqual(pick.h2h, { p1Wins: 1, p2Wins: 1, total: 2 });
  removeAllPlanned();
});

test('a live match beats a planned one, whatever its category', async () => {
  const [a, b, c, d] = [await newPlayer('Live A'), await newPlayer('Live B'), await newPlayer('Live C'), await newPlayer('Live D')];
  await planned('ELITE', a, b, 1);
  const novice = await planned('NOVICE', c, d, 5);
  execSql("UPDATE matches SET status = 'LIVE' WHERE share_token = ?", novice);
  assert.strictEqual((await motw()).token, novice);
  removeAllPlanned();
  execSql("DELETE FROM matches WHERE status = 'LIVE'");
});

test('the response is public (no login needed)', async () => {
  const saved = adminCookie;
  adminCookie = '';
  const res = await call('GET', '/api/match-of-the-week');
  adminCookie = saved;
  assert.strictEqual(res.status, 200);
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
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
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
