// Checks of the account made by a registration to a series / tournament (POST /api/seasons/:id/registrations): a visitor who is not in the app
// yet becomes a player and is logged in (the page then asks for the 5-digit code); a roster name without a phone is claimed the same way; an
// existing player who has a phone is never touched; a phone of another player stops the account.
// Run: node scripts/check-season-account.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let db = null;
let n = 0;

async function call(method, url, { body, cookie = '', ip } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['X-Forwarded-For'] = ip; // every check comes from its own "address": the registration limit is per address
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  const setCookie = res.headers.getSetCookie();
  const player = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('blta_player=')) || '';
  return { status: res.status, json, player, setCookie: setCookie.join(';') };
}
const season = (name, extra = {}) => Number(db.prepare('INSERT INTO seasons (name, slug, registration_open, kind) VALUES (?, ?, 1, ?)').run(name, `s-${n += 1}`, extra.kind || 'SERIES').lastInsertRowid);
const roster = (name, phone = null) => Number(db.prepare('INSERT INTO players (name, slug, phone) VALUES (?, ?, ?)').run(name, `r-${n += 1}`, phone).lastInsertRowid);
const register = (seasonId, body, opts = {}) => call('POST', `/api/seasons/${seasonId}/registrations`, { body: { category: 'NOVICE', note: '', ...body }, ip: `10.0.${n += 1}.1`, ...opts });
const playerByName = (name) => db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(name);
const entries = (seasonId) => db.prepare('SELECT * FROM season_registrations WHERE season_id = ?').all(seasonId);

test('a new visitor becomes a player, is logged in, and has to create the code', async () => {
  const s = season('Account series');
  const r = await register(s, { name: 'Nový Účastník', phone: '0903 111 222', email: 'novy@example.com' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.account, 'created');
  assert.strictEqual(r.json.pinSetupRequired, true);
  const p = playerByName('Nový Účastník');
  assert.ok(p, 'the player exists');
  assert.deepStrictEqual([p.phone, p.email, p.slug], ['0903111222', 'novy@example.com', 'ucastnik']);
  assert.strictEqual(p.category, null, 'the category is for the admin to give');
  assert.ok(r.player, 'logged in');
  const session = await call('GET', '/api/player/session', { cookie: r.player });
  assert.deepStrictEqual([session.json.isPlayer, session.json.playerId, session.json.needsPinSetup], [true, p.id, true]);
  const e = entries(s);
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].player_id, p.id, 'the entry belongs to the new player');
  // the player can finish the account: create the code
  const pin = await call('POST', '/api/player/set-pin', { body: { pin: '12345', confirmPin: '12345' }, cookie: r.player });
  assert.strictEqual(pin.status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: '0903111222', pin: '12345' } });
  assert.strictEqual(login.json.playerId, p.id, 'and log in later with phone + code');
});

test('phone forms: 9 digits get the leading 0, an international number is kept; a wrong shape makes no account', async () => {
  const s = season('Phones');
  const a = await register(s, { name: 'Devät Číslic', phone: '905123456', email: 'a@example.com' });
  assert.strictEqual(a.json.account, 'created');
  assert.strictEqual(playerByName('Devät Číslic').phone, '0905123456');
  const b = await register(s, { name: 'Medzi Národný', phone: '+421 944 555 666', email: 'b@example.com' });
  assert.strictEqual(b.json.account, 'created');
  assert.strictEqual(playerByName('Medzi Národný').phone, '+421944555666');
  const c = await register(s, { name: 'Zlé Číslo', phone: '1234567890', email: 'c@example.com' });
  assert.strictEqual(c.status, 201, 'the registration itself still works');
  assert.strictEqual(c.json.account, 'none');
  assert.strictEqual(playerByName('Zlé Číslo'), undefined);
  assert.strictEqual(c.player, '', 'nobody is logged in');
  assert.strictEqual(entries(s).find((x) => x.name === 'Zlé Číslo').player_id, null);
});

test('a phone that belongs to another player: the entry is saved, no account, nobody logged in', async () => {
  const s = season('Phone taken');
  roster('Majiteľ Čísla', '0902 777 888');
  const r = await register(s, { name: 'Niekto Iný', phone: '+421902777888', email: 'x@example.com' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.account, 'phoneTaken');
  assert.strictEqual(r.json.pinSetupRequired, false);
  assert.strictEqual(r.player, '');
  assert.strictEqual(playerByName('Niekto Iný'), undefined, 'no new player');
  assert.strictEqual(entries(s).length, 1);
});

test('an existing player with a phone is never touched or logged in (anybody can type a name)', async () => {
  const s = season('Existing');
  const id = roster('Hotový Hráč', '0901 000 111');
  db.prepare('UPDATE players SET email = ? WHERE id = ?').run('own@example.com', id);
  const r = await register(s, { name: 'Hotový Hráč', phone: '0911 222 333', email: 'someone-else@example.com' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.account, 'exists');
  assert.strictEqual(r.player, '', 'not logged in');
  const p = db.prepare('SELECT phone, email FROM players WHERE id = ?').get(id);
  assert.deepStrictEqual([p.phone, p.email], ['0901 000 111', 'own@example.com'], 'the profile is as it was');
  assert.strictEqual(entries(s)[0].player_id, id, 'the entry is linked to the player');
});

test('a roster player without a phone is claimed: phone and e-mail are put in, and the visitor is logged in', async () => {
  const s = season('Claim');
  const id = roster('Zo Zoznamu');
  const r = await register(s, { name: 'Zo Zoznamu', phone: '0915 444 555', email: 'zoznam@example.com' });
  assert.strictEqual(r.json.account, 'claimed', JSON.stringify(r.json));
  assert.strictEqual(r.json.pinSetupRequired, true);
  const p = db.prepare('SELECT phone, email FROM players WHERE id = ?').get(id);
  assert.deepStrictEqual([p.phone, p.email], ['0915444555', 'zoznam@example.com']);
  const session = await call('GET', '/api/player/session', { cookie: r.player });
  assert.deepStrictEqual([session.json.playerId, session.json.needsPinSetup], [id, true]);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM players WHERE name = 'Zo Zoznamu'").get().n, 1, 'no second player');
  // a roster player without a phone whose number is taken by someone else: no claim
  const id2 = roster('Zo Zoznamu Dva');
  const r2 = await register(s, { name: 'Zo Zoznamu Dva', phone: '0915 444 555', email: 'dva@example.com' });
  assert.strictEqual(r2.json.account, 'phoneTaken');
  assert.strictEqual(db.prepare('SELECT phone FROM players WHERE id = ?').get(id2).phone, null);
});

test('a similar name asks first and makes no account; confirming the new name does', async () => {
  const s = season('Similar');
  roster('Peter Hladký', '0900 100 200');
  const first = await register(s, { name: 'Peter Hladkyy', phone: '0917 100 100', email: 'ph@example.com' });
  assert.strictEqual(first.status, 409);
  assert.strictEqual(first.json.code, 'SIMILAR_PLAYERS');
  assert.strictEqual(playerByName('Peter Hladkyy'), undefined, 'nothing was created while asking');
  assert.strictEqual(entries(s).length, 0);
  const confirmed = await register(s, { name: 'Peter Hladkyy', phone: '0917 100 100', email: 'ph@example.com', confirmNew: true });
  assert.strictEqual(confirmed.json.account, 'created');
});

test('closed registration, a repeat and a tournament', async () => {
  const closed = season('Closed');
  db.prepare('UPDATE seasons SET registration_open = 0 WHERE id = ?').run(closed);
  const c = await register(closed, { name: 'Pridneskoro Prišiel', phone: '0918 000 001', email: 'late@example.com' });
  assert.strictEqual(c.status, 403);
  assert.strictEqual(playerByName('Pridneskoro Prišiel'), undefined, 'no account when the registration is refused');
  const s = season('Repeat');
  assert.strictEqual((await register(s, { name: 'Dvakrát Prihlásený', phone: '0918 000 002', email: 'twice@example.com' })).json.account, 'created');
  const again = await register(s, { name: 'Dvakrát Prihlásený', phone: '0918 000 003', email: 'twice@example.com' });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM players WHERE name = 'Dvakrát Prihlásený'").get().n, 1);
  const t = season('Turnaj', { kind: 'TOURNAMENT' });
  const r = await call('POST', `/api/seasons/${t}/registrations`, { body: { name: 'Turnajový Nováčik', phone: '0918 000 004', email: 't@example.com' }, ip: '10.9.9.9' });
  assert.deepStrictEqual([r.status, r.json.account], [201, 'created']);
});

test('an invite link brings the inviter credit for the new player', async () => {
  const s = season('Invite');
  const inviter = roster('Pozývateľ Série', '0919 000 000');
  const slug = db.prepare('SELECT slug FROM players WHERE id = ?').get(inviter).slug;
  const r = await register(s, { name: 'Pozvaný Hráč', phone: '0919 000 005', email: 'inv@example.com' }, { cookie: `blta_ref=${slug}` });
  assert.strictEqual(r.json.account, 'created');
  assert.strictEqual(playerByName('Pozvaný Hráč').invited_by, inviter);
});

test('the page and the texts: the thank-you says an account was made and the code step follows', async () => {
  const js = await (await fetch(`${BASE}/js/season.js`)).text();
  assert.ok(js.includes('pinSetupRequired') && js.includes('refreshPlayerAuth()') && js.includes('season.regAccount'));
  const i18n = await (await fetch(`${BASE}/js/i18n.js`)).text();
  assert.ok(i18n.includes("'season.regAccount': 'Vytvorili sme ti aj účet") && i18n.includes("'season.regAccount': 'We have also created your account"));
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
