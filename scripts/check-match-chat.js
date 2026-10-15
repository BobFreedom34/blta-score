// Checks of the chat of a match: anyone can read it, only a logged-in player or an admin can write, the name on a message is the login's
// own (never the one sent in the request), and the notification goes to the other player (both when an admin who is not playing writes).
// Run: node scripts/check-match-chat.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cookieSignature = require('cookie-signature');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

const signed = (name, value) => `${name}=${encodeURIComponent(`s:${cookieSignature.sign(String(value), 'test')}`)}`;
const playerCookie = (id) => signed('blta_player', id);

async function call(method, url, { body, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const sql = (query, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
};
const bell = async (cookie) => (await call('GET', '/api/player/notifications', { cookie })).json.filter((n) => n.type === 'CHAT_MESSAGE');

let a; let b; let token; let ca; let cb;

test('setup: two players and a match', async () => {
  a = (await call('POST', '/api/players', { cookie: adminCookie, body: { name: 'Chat Anna' } })).json;
  b = (await call('POST', '/api/players', { cookie: adminCookie, body: { name: 'Chat Boris' } })).json;
  [ca, cb] = [playerCookie(a.id), playerCookie(b.id)];
  const made = await call('POST', '/api/matches', { cookie: adminCookie, body: { category: 'FRIENDLY', player1Id: a.id, player2Id: b.id, format: 'BO3_STB', location: 'Inter', scheduledAt: '2026-10-11T08:30:00.000Z' } });
  assert.strictEqual(made.status, 201, made.text);
  token = made.json.token;
});

test('a logged-out visitor can read the chat but cannot write: 401, nothing stored', async () => {
  assert.strictEqual((await call('GET', `/api/matches/${token}/messages`)).status, 200);
  const posted = await call('POST', `/api/matches/${token}/messages`, { body: { author: 'Somebody', body: 'hello' } });
  assert.strictEqual(posted.status, 401, posted.text);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM messages')[0].n, 0);
});

test('a referee (shared code, not a player) cannot write either', async () => {
  const posted = await call('POST', `/api/matches/${token}/messages`, { cookie: signed('blta_referee', 'ok'), body: { body: 'hello' } });
  assert.strictEqual(posted.status, 401, posted.text);
});

test("a player writes: the author is the login's name, whatever name the request carries; the other player is notified, the writer is not", async () => {
  const posted = await call('POST', `/api/matches/${token}/messages`, { cookie: ca, body: { author: 'Fake Name', body: 'Kedy hráme?' } });
  assert.strictEqual(posted.status, 201, posted.text);
  assert.strictEqual(posted.json.author, 'Chat Anna');
  assert.strictEqual(posted.json.body, 'Kedy hráme?');
  const read = (await call('GET', `/api/matches/${token}/messages`)).json;
  assert.deepStrictEqual(read.map((m) => [m.author, m.body]), [['Chat Anna', 'Kedy hráme?']]);
  assert.strictEqual((await bell(cb)).length, 1);
  assert.strictEqual((await bell(ca)).length, 0);
});

test('a player who is not in the match may write too (any logged-in player), and both players of the match are notified', async () => {
  const c = (await call('POST', '/api/players', { cookie: adminCookie, body: { name: 'Chat Cyril' } })).json;
  const posted = await call('POST', `/api/matches/${token}/messages`, { cookie: playerCookie(c.id), body: { body: 'Držím palce' } });
  assert.strictEqual(posted.status, 201, posted.text);
  assert.strictEqual(posted.json.author, 'Chat Cyril');
  assert.strictEqual((await bell(ca)).length, 1);
  assert.strictEqual((await bell(cb)).length, 2);
});

test('an admin who is not a player writes as "Admin" and both players are notified', async () => {
  const before = [(await bell(ca)).length, (await bell(cb)).length];
  const posted = await call('POST', `/api/matches/${token}/messages`, { cookie: adminCookie, body: { author: 'Fake', body: 'Termín potvrdený' } });
  assert.strictEqual(posted.status, 201, posted.text);
  assert.strictEqual(posted.json.author, 'Admin');
  assert.deepStrictEqual([(await bell(ca)).length, (await bell(cb)).length], [before[0] + 1, before[1] + 1]);
});

test('an empty message is 400; a long one is cut to 500 characters', async () => {
  assert.strictEqual((await call('POST', `/api/matches/${token}/messages`, { cookie: cb, body: { body: '   ' } })).status, 400);
  const long = await call('POST', `/api/matches/${token}/messages`, { cookie: cb, body: { body: 'x'.repeat(700) } });
  assert.strictEqual(long.status, 201);
  assert.strictEqual(long.json.body.length, 500);
});

test('an unknown match is 404', async () => {
  assert.strictEqual((await call('POST', '/api/matches/nope/messages', { cookie: ca, body: { body: 'x' } })).status, 404);
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
