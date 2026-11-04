// Checks that the super admin of the site is a hidden member of every community and club: the general feed (GET /api/communities/feed) and the events of the player
// (GET /api/communities/my-events) have the news and the tournaments of all of them, while nothing shows him as a member (member lists and counts stay as they are),
// and a plain player still sees only his own communities.
// Run: node scripts/check-community-feed-superadmin.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfeed-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = '', body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09090${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const setup = {};
async function makeClub(name) {
  const owner = await makePlayer(`Owner ${name}`);
  const org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name, joinPolicy: 'APPROVAL' } })).json;
  assert.ok(org && org.id, JSON.stringify(org));
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/approval`, { cookie: adminCookie, body: { approved: true } })).status, 200);
  const post = await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: `News of ${name}` } });
  assert.ok([200, 201].includes(post.status), JSON.stringify(post.json));
  const t = await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: `Cup of ${name}`, playType: 'SINGLES', startDate: future(10), endDate: future(11), venue: 'Court' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  return { owner, org };
}
const texts = (feed) => feed.json.items.map((i) => (i.type === 'POST' ? i.body : i.name)).sort();

test('setup: two clubs (one decides on every join request), each with news and a tournament; a player who is in neither', async () => {
  setup.a = await makeClub('Alfa Klub');
  setup.b = await makeClub('Beta Klub');
  setup.plain = await makePlayer('Plain Player');
});

test('a plain player sees nothing in his feed (he is in no club)', async () => {
  const r = await call('GET', '/api/communities/feed', { cookie: setup.plain.cookie });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.items, []);
  assert.deepStrictEqual((await call('GET', '/api/communities/my-events', { cookie: setup.plain.cookie })).json.items, []);
});

test('an owner sees only his own club in the feed', async () => {
  const r = await call('GET', '/api/communities/feed', { cookie: setup.a.owner.cookie });
  assert.deepStrictEqual(texts(r), ['Cup of Alfa Klub', 'News of Alfa Klub']);
});

test('the super admin sees the news and the tournaments of every club in the feed, and their events', async () => {
  const r = await call('GET', '/api/communities/feed', { cookie: adminCookie });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(texts(r), ['Cup of Alfa Klub', 'Cup of Beta Klub', 'News of Alfa Klub', 'News of Beta Klub']);
  assert.ok(r.json.items.every((i) => i.organisation && i.organisation.name), 'each item carries its club');
  const ev = await call('GET', '/api/communities/my-events', { cookie: adminCookie });
  assert.deepStrictEqual(ev.json.items.map((e) => e.name).sort(), ['Cup of Alfa Klub', 'Cup of Beta Klub']);
});

test('the super admin as a player too (logged in both ways) sees all of it', async () => {
  const both = `${adminCookie}; ${setup.plain.cookie}`;
  const r = await call('GET', '/api/communities/feed', { cookie: both });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.items.length, 4);
});

test('he is hidden: no member list, no member count, nothing in "my clubs"', async () => {
  for (const { org, owner } of [setup.a, setup.b]) {
    const members = await call('GET', `/api/communities/${org.id}/members`, { cookie: adminCookie });
    assert.strictEqual(members.json.members.length, 1, 'only the owner');
    const detail = (await call('GET', `/api/communities/${org.slug}`, { cookie: adminCookie })).json;
    assert.strictEqual(detail.memberCount, 1);
    assert.ok(detail.me === null || detail.me.status === null, 'he is not a member');
    assert.strictEqual((await call('GET', '/api/communities/mine', { cookie: owner.cookie })).json.items.length, 1);
  }
});

test('a club hidden by moderation, and a club that is not approved yet, stay out of his feed', async () => {
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.b.org.id}/moderation`, { cookie: adminCookie, body: { hidden: true } })).status, 200);
  assert.deepStrictEqual(texts(await call('GET', '/api/communities/feed', { cookie: adminCookie })), ['Cup of Alfa Klub', 'News of Alfa Klub']);
  const owner = await makePlayer('Owner Gama');
  const gama = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: 'Gama Klub' } })).json;
  assert.ok(gama && gama.id);
  assert.deepStrictEqual(texts(await call('GET', '/api/communities/feed', { cookie: adminCookie })), ['Cup of Alfa Klub', 'News of Alfa Klub'], 'not approved: not in the feed');
});

test('a community made after that is in his feed at once (nothing to add him to)', async () => {
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.b.org.id}/moderation`, { cookie: adminCookie, body: { hidden: false } })).status, 200);
  const delta = await makeClub('Delta Klub');
  assert.ok(texts(await call('GET', '/api/communities/feed', { cookie: adminCookie })).includes('News of Delta Klub'));
  assert.strictEqual(delta.org.name, 'Delta Klub');
});

// ---------------------------------------------------------------- run
async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await call('POST', '/api/admin/login', { body: { password: 'test' } });
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
