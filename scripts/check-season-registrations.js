// Checks of adding a player to a season by hand (Backend > Seasons > Registrations > Add a player):
// POST /api/seasons/:id/registrations/admin — phone, e-mail and category come from the player's profile.
// Run: node scripts/check-season-registrations.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regs-check-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let db = null;

async function call(method, url, body, withCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

let n = 0;
const season = (name, open = 0) => Number(db.prepare('INSERT INTO seasons (name, slug, registration_open) VALUES (?, ?, ?)').run(name, `s-${n += 1}`, open).lastInsertRowid);
const player = (name, extra = {}) => Number(db.prepare('INSERT INTO players (name, slug, phone, email, category) VALUES (?, ?, ?, ?, ?)')
  .run(name, `p-${n += 1}`, extra.phone || null, extra.email || null, extra.category || null).lastInsertRowid);
const add = (seasonId, body, withCookie = true) => call('POST', `/api/seasons/${seasonId}/registrations/admin`, body, withCookie);
const list = async (seasonId) => (await call('GET', `/api/seasons/${seasonId}/registrations`)).json;

test('only an admin can add a player to a season', async () => {
  const s = season('Auth');
  const p = player('Auth Player');
  assert.strictEqual((await add(s, { playerId: p, category: 'ELITE' }, false)).status, 401);
});

test('phone and e-mail come from the profile, the category too', async () => {
  const s = season('Profile');
  const p = player('Profile Player', { phone: '0902 955 945', email: 'profile@example.com', category: 'Next Gen' });
  const r = await add(s, { playerId: p });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.name, 'Profile Player');
  assert.strictEqual(r.json.phone, '0902955945');
  assert.strictEqual(r.json.email, 'profile@example.com');
  assert.strictEqual(r.json.category, 'NEXT_GEN');
  assert.strictEqual(r.json.playerId, p);
  const rows = await list(s);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].paid, false);
});

test('typed phone, e-mail and category win over the profile', async () => {
  const s = season('Override');
  const p = player('Override Player', { phone: '0900111222', email: 'old@example.com', category: 'ELITE' });
  const r = await add(s, { playerId: p, category: 'NOVICE', phone: '+421 911 222 333', email: 'new@example.com' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.phone, '+421911222333');
  assert.strictEqual(r.json.email, 'new@example.com');
  assert.strictEqual(r.json.category, 'NOVICE');
});

test('a player without contact details can still be added', async () => {
  const s = season('NoContact');
  const p = player('No Contact', { category: 'NOVICE' });
  const r = await add(s, { playerId: p });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.phone, '');
  assert.strictEqual(r.json.email, '');
});

test('a category is needed when the profile has none', async () => {
  const s = season('NoCategory');
  const p = player('No Category');
  assert.strictEqual((await add(s, { playerId: p })).status, 400);
  assert.strictEqual((await add(s, { playerId: p, category: 'ELITE' })).status, 201);
});

test('the same player cannot be added twice', async () => {
  const s = season('Twice');
  const p = player('Twice Player', { category: 'ELITE' });
  assert.strictEqual((await add(s, { playerId: p })).status, 201);
  const again = await add(s, { playerId: p });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.json.code, 'ALREADY_REGISTERED');
  assert.strictEqual((await list(s)).length, 1);
  // the same player in another season is fine
  assert.strictEqual((await add(season('Other'), { playerId: p })).status, 201);
});

test('unknown player, season, bad phone or bad e-mail are refused', async () => {
  const s = season('Bad');
  const p = player('Bad Input', { category: 'ELITE' });
  assert.strictEqual((await add(s, { playerId: 999999 })).status, 400);
  assert.strictEqual((await add(s, {})).status, 400);
  assert.strictEqual((await add(999999, { playerId: p })).status, 404);
  assert.strictEqual((await add(s, { playerId: p, phone: '123' })).status, 400);
  assert.strictEqual((await add(s, { playerId: p, email: 'not an email' })).status, 400);
  assert.strictEqual((await list(s)).length, 0);
});

test('it works while the registration of the season is closed, and a paid tick can be given', async () => {
  const s = season('Closed', 0);
  const p = player('Closed Player', { category: 'ELITE' });
  const r = await add(s, { playerId: p, paid: true });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.paid, true);
});

async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
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
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    db = new DatabaseSync(path.join(dataDir, 'blta-score.db'));
    db.exec('PRAGMA busy_timeout = 5000');
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
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
