// Checks that a community or club that decides on every request (join policy APPROVAL) shows nothing but its header to somebody who is not a member yet:
// no description, contact, news, members or events, until he is approved (src/communities.js: isLockedFor, src/routes/communities.js).
// Run: node scripts/check-community-locked.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-locked-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
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
  const phone = `09100${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let owner;
let member;
let waiting;
let stranger;
let locked;
let open;
let postId;

test('setup: a community that decides on every request (with a post and a tournament), an open one, a member, a waiting player and a stranger', async () => {
  [owner, member, waiting, stranger] = [await makePlayer('Zam Majitel'), await makePlayer('Zam Clen'), await makePlayer('Zam Caka'), await makePlayer('Zam Cudzi')];
  locked = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Zamknuta komunita', description: 'Tajny popis', contact: 'tajne@kontakt.sk', joinPolicy: 'APPROVAL' } })).json;
  open = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Otvorena komunita', description: 'Verejny popis', contact: 'verejne@kontakt.sk', joinPolicy: 'OPEN' } })).json;
  assert.ok(locked.id && open.id);
  const post = await call('POST', `/api/communities/${locked.id}/posts`, { cookie: owner.cookie, body: { body: 'Len pre clenov' } });
  assert.strictEqual(post.status, 201, JSON.stringify(post.json));
  postId = post.json.id;
  await call('POST', `/api/communities/${open.id}/posts`, { cookie: owner.cookie, body: { body: 'Pre vsetkych' } });
  const t = await call('POST', `/api/communities/${locked.id}/tournaments`, { cookie: owner.cookie, body: { name: 'Zamknuty turnaj', startDate: '2026-12-01', endDate: '2026-12-02', playType: 'SINGLES' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  await call('POST', `/api/communities/${locked.id}/join`, { cookie: member.cookie });
  assert.strictEqual((await call('POST', `/api/communities/${locked.id}/members/${member.id}/approve`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${locked.id}/join`, { cookie: waiting.cookie })).json.status, 'PENDING');
});

test('a visitor, a stranger and a player waiting for the approval see the header only: name, kind, city, number of members; no description, no contact', async () => {
  for (const who of [{ cookie: '' }, stranger, waiting]) {
    const r = await call('GET', `/api/communities/${locked.slug}`, { cookie: who.cookie });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.locked, true);
    assert.strictEqual(r.json.name, 'Zamknuta komunita');
    assert.strictEqual(r.json.type, 'COMMUNITY');
    assert.ok(r.json.memberCount >= 1);
    assert.strictEqual(r.json.description, '');
    assert.strictEqual(r.json.contact, '');
    assert.ok(Array.isArray(r.json.previewPhotos));
    assert.ok(!JSON.stringify(r.json).includes('Tajny') && !JSON.stringify(r.json).includes('tajne@'), 'nothing of it leaks');
  }
});

test('the list shows no description of a locked community either', async () => {
  const list = (await call('GET', '/api/communities', { cookie: '' })).json.items;
  const item = list.find((o) => o.id === locked.id);
  assert.ok(item && item.description === '' && item.contact === '' && item.locked === true);
  assert.strictEqual(list.find((o) => o.id === open.id).description, 'Verejny popis');
});

test('the news, the members, the events and the reactions of a locked community are refused (403, locked) to the same people', async () => {
  for (const who of [{ cookie: '' }, stranger, waiting]) {
    for (const url of [`/api/communities/${locked.id}/posts`, `/api/communities/${locked.id}/members`, `/api/communities/${locked.id}/tournaments`]) {
      const r = await call('GET', url, { cookie: who.cookie });
      assert.strictEqual(r.status, 403, `${url}: ${JSON.stringify(r.json)}`);
      assert.strictEqual(r.json.locked, true);
    }
  }
  assert.strictEqual((await call('POST', `/api/communities/${locked.id}/posts/${postId}/reactions`, { cookie: stranger.cookie, body: { emoji: '🔥' } })).status, 403);
});

test('an approved member sees everything; so do the admin of the community and the super admin', async () => {
  for (const who of [member, owner, { cookie: adminCookie }]) {
    const r = await call('GET', `/api/communities/${locked.slug}`, { cookie: who.cookie });
    assert.strictEqual(r.json.locked, false);
    assert.strictEqual(r.json.description, 'Tajny popis');
    assert.strictEqual((await call('GET', `/api/communities/${locked.id}/posts`, { cookie: who.cookie })).status, 200);
    assert.strictEqual((await call('GET', `/api/communities/${locked.id}/members`, { cookie: who.cookie })).status, 200);
    assert.strictEqual((await call('GET', `/api/communities/${locked.id}/tournaments`, { cookie: who.cookie })).status, 200);
  }
});

test('the approval opens it: the waiting player sees it all the moment he is approved', async () => {
  assert.strictEqual((await call('POST', `/api/communities/${locked.id}/members/${waiting.id}/approve`, { cookie: owner.cookie })).status, 200);
  const r = await call('GET', `/api/communities/${locked.slug}`, { cookie: waiting.cookie });
  assert.strictEqual(r.json.locked, false);
  assert.strictEqual((await call('GET', `/api/communities/${locked.id}/posts`, { cookie: waiting.cookie })).status, 200);
});

test('a community that lets everybody join stays open to look at', async () => {
  const r = await call('GET', `/api/communities/${open.slug}`, { cookie: '' });
  assert.strictEqual(r.json.locked, false);
  assert.strictEqual(r.json.description, 'Verejny popis');
  assert.strictEqual((await call('GET', `/api/communities/${open.id}/posts`, { cookie: '' })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${open.id}/members`, { cookie: '' })).status, 200);
});

test('the page side: a locked community shows its header, the join button and the note only', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/community.js'), 'utf8');
  assert.ok(js.includes('org.locked') && js.includes("t('com.lockedNote')") && js.includes('previewPhotos'));
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual(i18n.split("'com.lockedNote':").length - 1, 2);
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
    const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
