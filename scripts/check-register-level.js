// Checks of the tennis level asked at registration (Novice = beginner, Next Gen = intermediate/advanced, Elite = very advanced): required and validated by the server, stored,
// claimed profiles get it too, visible to a logged-in player and an admin but never to a visitor; every login window has the field with its texts.
// Run: node scripts/check-register-level.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvl-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;

async function call(method, url, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, res };
}
const register = (name, phone, tennisLevel) => call('POST', '/api/player/register', { body: { name, phone, email: `${phone}@example.com`, ...(tennisLevel === undefined ? {} : { tennisLevel }) } });
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('the level is required: no level, an empty one and a made-up one are all refused with levelRequired', async () => {
  for (const bad of [undefined, '', 'PRO', 'novice', 'FRIENDLY']) {
    const r = await register('Level Bad', '0900222001', bad);
    assert.strictEqual(r.status, 400, String(bad));
    assert.strictEqual(r.json.errorCode, 'levelRequired');
  }
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM players WHERE name = 'Level Bad'").get().c, 0, 'nobody was created');
});

test('each of the three levels registers a player and is stored', async () => {
  let n = 0;
  for (const level of ['NOVICE', 'NEXT_GEN', 'ELITE']) {
    n += 1;
    const r = await register(`Level Player ${n}`, `090022200${n + 1}`, level);
    assert.strictEqual(r.status, 201, r.text);
    assert.strictEqual(db.prepare('SELECT tennis_level AS l FROM players WHERE name = ?').get(`Level Player ${n}`).l, level);
  }
});

test('a profile an admin made without a phone is claimed at registration and gets the level too', async () => {
  const made = await call('POST', '/api/players', { body: { name: 'Level Claimed' }, cookie: adminCookie });
  assert.strictEqual(made.status, 201, made.text);
  const r = await register('Level Claimed', '0900222009', 'ELITE');
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(db.prepare("SELECT tennis_level AS l FROM players WHERE name = 'Level Claimed'").get().l, 'ELITE');
});

test('the level is for a logged-in player and an admin, never for a visitor (like the phone and the e-mail)', async () => {
  const id = db.prepare("SELECT id FROM players WHERE name = 'Level Player 2'").get().id;
  const visitor = await call('GET', `/api/players/${id}`);
  assert.strictEqual(visitor.status, 200, visitor.text);
  assert.ok(!('tennis_level' in visitor.json), 'not for a visitor');
  assert.ok(!('phone' in visitor.json));
  const admin = await call('GET', `/api/players/${id}`, { cookie: adminCookie });
  assert.strictEqual(admin.json.tennis_level, 'NEXT_GEN');
  const other = await register('Level Viewer', '0900222010', 'NOVICE');
  const player = await call('GET', `/api/players/${id}`, { cookie: cookieOf(other) });
  assert.strictEqual(player.json.tennis_level, 'NEXT_GEN');
});

test('every page with the login window has the select with the three levels, and the texts exist in both languages', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  const withForm = pages.filter((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').includes('player-login-register-form'));
  assert.ok(withForm.length > 10);
  withForm.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    assert.ok(html.includes('id="player-login-register-level-input"'), `${f}: the level select`);
    ['NOVICE', 'NEXT_GEN', 'ELITE'].forEach((v) => assert.ok(html.includes(`<option value="${v}"`), `${f}: ${v}`));
  });
  const i18n = require('./i18n-source').i18nSource();
  ['login.registerLevelLabel', 'login.registerLevelPlaceholder', 'login.level.NOVICE', 'login.level.NEXT_GEN', 'login.level.ELITE', 'login.error.levelRequired']
    .forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length - 1, 2, `${k} in both languages`));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/common-player.js'), 'utf8').includes('body: { name, email, phone, tennisLevel,'), 'the form sends the level');
});

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
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
