// Checks of "Pozvi kamaráta": the personal invite link /pozvanka/<slug> (counted once per browser, remembers the inviter in a cookie), the credit
// at registration (only for a NEW player), the counters of the inviter and the admin's overview.
// Run: node scripts/check-invites.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cookieSignature = require('cookie-signature');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;

const playerCookie = (id) => `blta_player=${encodeURIComponent(`s:${cookieSignature.sign(String(id), 'test')}`)}`;
async function call(method, url, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, res };
}
const newPlayer = (name, slug, extra = '') => Number(db.prepare('INSERT INTO players (name, slug, category) VALUES (?, ?, ?)').run(name, slug, extra || 'NOVICE').lastInsertRowid);
const mine = async (id) => (await call('GET', '/api/invites/mine', { cookie: playerCookie(id) })).json;
const register = (name, phone, cookie) => call('POST', '/api/player/register', { body: { name, phone, email: `${phone}@example.com` }, cookie });

let anna;

test('the link: a visit is counted once per browser, goes to the home page and remembers the inviter', async () => {
  anna = newPlayer('Anna Pozývateľka', 'anna-pozyvatelka');
  assert.deepStrictEqual(await mine(anna), { slug: 'anna-pozyvatelka', opened: 0, registered: 0, played: 0 });
  const first = await call('GET', '/pozvanka/anna-pozyvatelka');
  assert.strictEqual(first.status, 302);
  assert.strictEqual(first.res.headers.get('location'), '/');
  const setCookie = first.res.headers.getSetCookie().join(';');
  assert.ok(/blta_ref=anna-pozyvatelka/.test(setCookie), setCookie);
  assert.strictEqual((await mine(anna)).opened, 1);
  // the same browser again (it sends the cookie): not counted again
  assert.strictEqual((await call('GET', '/pozvanka/anna-pozyvatelka', { cookie: 'blta_ref=anna-pozyvatelka' })).status, 302);
  assert.strictEqual((await mine(anna)).opened, 1, 'a reload is not a new visit');
  // another browser counts
  await call('GET', '/pozvanka/anna-pozyvatelka');
  assert.strictEqual((await mine(anna)).opened, 2);
  // the preview fetchers of the messengers open the link when it is sent: they are not visits (this was the second "opened" of one invitation)
  for (const agent of ['WhatsApp/2.23.20 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Twitterbot/1.0']) {
    const bot = await fetch(`${BASE}/pozvanka/anna-pozyvatelka`, { redirect: 'manual', headers: { 'User-Agent': agent } });
    assert.strictEqual(bot.status, 302, agent);
    assert.ok(!bot.headers.getSetCookie().join(';').includes('blta_ref'), `${agent} got the cookie`);
  }
  assert.strictEqual((await mine(anna)).opened, 2, 'the preview fetchers are not counted');
  // a phone browser is
  const phone = await fetch(`${BASE}/pozvanka/anna-pozyvatelka`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' } });
  assert.ok(phone.headers.getSetCookie().join(';').includes('blta_ref'));
  assert.strictEqual((await mine(anna)).opened, 3);
  // the inviter opening their own link (logged in) is not a visit
  const own = await fetch(`${BASE}/pozvanka/anna-pozyvatelka`, { redirect: 'manual', headers: { Cookie: playerCookie(anna) } });
  assert.strictEqual(own.status, 302);
  assert.ok(!own.headers.getSetCookie().join(';').includes('blta_ref'));
  assert.strictEqual((await mine(anna)).opened, 3, 'your own opens do not count');
  // an unknown link: just the home page, nothing counted, no cookie
  const unknown = await call('GET', '/pozvanka/nobody-here');
  assert.strictEqual(unknown.status, 302);
  assert.ok(!unknown.res.headers.getSetCookie().join(';').includes('blta_ref'));
  // a hidden player has no link
  const hidden = newPlayer('Skrytý', 'skryty');
  db.prepare('UPDATE players SET hidden = 1 WHERE id = ?').run(hidden);
  assert.ok(!(await call('GET', '/pozvanka/skryty')).res.headers.getSetCookie().join(';').includes('blta_ref'));
});

test('the admin can put a player\'s opened counter back to zero (registered players stay)', async () => {
  const bob = newPlayer('Reset Hráč', 'reset-hrac');
  await call('GET', '/pozvanka/reset-hrac');
  await call('GET', '/pozvanka/reset-hrac');
  assert.strictEqual((await mine(bob)).opened, 2);
  assert.strictEqual((await call('DELETE', '/api/invites/visits/reset-hrac', { cookie: playerCookie(bob) })).status, 401, 'admin only');
  assert.strictEqual((await call('DELETE', '/api/invites/visits/nobody-here', { cookie: adminCookie })).status, 404);
  const done = await call('DELETE', '/api/invites/visits/reset-hrac', { cookie: adminCookie });
  assert.deepStrictEqual([done.status, done.json.removed], [200, 2]);
  assert.strictEqual((await mine(bob)).opened, 0);
  assert.strictEqual((await mine(anna)).opened, 3, 'nobody else is touched');
});

test('registering through the link credits the inviter; only a new player counts', async () => {
  const r = await register('Nový Hráč', '0903111222', 'blta_ref=anna-pozyvatelka');
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const now = await mine(anna);
  assert.strictEqual(now.registered, 1);
  assert.strictEqual(now.played, 0);
  const row = db.prepare('SELECT invited_by FROM players WHERE name = ?').get('Nový Hráč');
  assert.strictEqual(row.invited_by, anna);
  // without the cookie nobody is credited
  assert.strictEqual((await register('Bez Pozvánky', '0903222333')).status, 201);
  assert.strictEqual(db.prepare('SELECT invited_by FROM players WHERE name = ?').get('Bez Pozvánky').invited_by, null);
  // claiming an existing profile without a phone is not a new player: not credited
  db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run('Starý Profil', 'stary-profil');
  assert.strictEqual((await register('Starý Profil', '0903333444', 'blta_ref=anna-pozyvatelka')).status, 201);
  assert.strictEqual(db.prepare('SELECT invited_by FROM players WHERE name = ?').get('Starý Profil').invited_by, null);
  assert.strictEqual((await mine(anna)).registered, 1);
  // a cookie that names nobody is ignored
  assert.strictEqual((await register('Cudzí Odkaz', '0903444555', 'blta_ref=nikto')).status, 201);
  assert.strictEqual(db.prepare('SELECT invited_by FROM players WHERE name = ?').get('Cudzí Odkaz').invited_by, null);
});

test('played: the counter follows the invited players\' finished matches', async () => {
  const invited = db.prepare('SELECT id FROM players WHERE name = ?').get('Nový Hráč').id;
  assert.strictEqual((await mine(anna)).played, 0);
  db.prepare("INSERT INTO matches (category, player1_id, player2_id, format, state, status) VALUES ('NOVICE', ?, ?, 'BEST_OF_3', '{}', 'PLANNED')").run(invited, anna);
  assert.strictEqual((await mine(anna)).played, 0, 'a planned match is not played');
  db.prepare("UPDATE matches SET status = 'FINISHED' WHERE player1_id = ?").run(invited);
  assert.strictEqual((await mine(anna)).played, 1);
});

test('the admin overview: who invited whom, the best recruiters; players cannot see it', async () => {
  const bob = newPlayer('Bob Druhý', 'bob-druhy');
  await call('GET', '/pozvanka/anna-pozyvatelka');
  const r2 = await register('Ďalší Nový', '0904555666', 'blta_ref=anna-pozyvatelka');
  assert.strictEqual(r2.status, 201);
  assert.strictEqual((await register('Tretí Nový', '0904666777', 'blta_ref=bob-druhy')).status, 201);
  const all = await call('GET', '/api/invites/admin', { cookie: adminCookie });
  assert.strictEqual(all.status, 200);
  assert.deepStrictEqual(all.json.invited.map((p) => [p.name, p.inviter]).sort(), [['Nový Hráč', 'Anna Pozývateľka'], ['Ďalší Nový', 'Anna Pozývateľka'], ['Tretí Nový', 'Bob Druhý']].sort());
  assert.deepStrictEqual(all.json.top.map((t) => [t.name, t.count]), [['Anna Pozývateľka', 2], ['Bob Druhý', 1]]);
  assert.ok(all.json.opened >= 3);
  assert.strictEqual(all.json.invited.find((p) => p.name === 'Nový Hráč').played, true);
  assert.strictEqual(all.json.invited.find((p) => p.name === 'Ďalší Nový').played, false);
  assert.strictEqual((await call('GET', '/api/invites/admin', { cookie: playerCookie(bob) })).status, 401);
  assert.strictEqual((await call('GET', '/api/invites/admin')).status, 401);
  assert.strictEqual((await call('GET', '/api/invites/mine')).status, 401, 'login needed');
});

test('the home page and the players page carry the invite pieces', async () => {
  const home = await call('GET', '/');
  assert.strictEqual(home.status, 200);
  assert.ok((await call('GET', '/js/home.js')).text.includes('/pozvanka/'));
  assert.ok((await call('GET', '/js/i18n.js')).text.includes('invite.whatsapp'));
  assert.ok((await call('GET', '/players')).text.includes('invites-admin'));
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
