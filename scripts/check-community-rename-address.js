// Checks that the address of a community or club follows its name when it is renamed (Next Gen Boys -> COURTCREW: /komunita/courtcrew), that the old address and
// the invitation links made with it still work (the page sends them to the new address and keeps ?invite=...), and that an old address is not given to another community.
// Run: node scripts/check-community-rename-address.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comrename-'));
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
  const phone = `09100${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const page = (url) => fetch(base + url, { redirect: 'manual' });
const setup = {};
const rename = (name, org = setup.org, who = setup.owner) => call('PATCH', `/api/communities/${org.id}`, { cookie: who.cookie, body: { name } });

test('setup: a community "Next Gen Boys"', async () => {
  setup.owner = await makePlayer('Rn Owner');
  const made = await call('POST', '/api/communities', { cookie: setup.owner.cookie, body: { type: 'COMMUNITY', name: 'Next Gen Boys' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  setup.org = made.json;
  assert.strictEqual(setup.org.slug, 'next-gen-boys');
  setup.invite = (await call('GET', `/api/communities/${setup.org.id}/invite`, { cookie: setup.owner.cookie })).json.token;
  assert.ok(setup.invite);
});

test('changing only the description keeps the address', async () => {
  const r = await call('PATCH', `/api/communities/${setup.org.id}`, { cookie: setup.owner.cookie, body: { description: 'A text' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.slug, 'next-gen-boys');
});

test('renaming it to COURTCREW gives the address /courtcrew', async () => {
  const r = await rename('COURTCREW');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual([r.json.name, r.json.slug], ['COURTCREW', 'courtcrew']);
  assert.strictEqual((await call('GET', '/api/communities/courtcrew')).json.id, setup.org.id);
});

test('the old address still reaches it (the API answers with the new address in it), and its app manifest too', async () => {
  const r = await call('GET', '/api/communities/next-gen-boys');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual([r.json.id, r.json.slug], [setup.org.id, 'courtcrew']);
  assert.strictEqual((await call('GET', '/api/communities/next-gen-boys/manifest.json')).status, 200, 'the app of the club');
});

test('the page of the old address is sent to the new one, the invitation (?invite=...) kept; the new address is the page', async () => {
  const old = await page(`/komunita/next-gen-boys?invite=${setup.invite}`);
  assert.strictEqual(old.status, 301);
  assert.strictEqual(old.headers.get('location'), `/komunita/courtcrew?invite=${setup.invite}`);
  const en = await page('/en/community/next-gen-boys');
  assert.strictEqual(en.status, 301);
  assert.ok(/\/en\/community\/courtcrew$/.test(en.headers.get('location')), en.headers.get('location'));
  const fresh = await page('/komunita/courtcrew');
  assert.strictEqual(fresh.status, 200);
  assert.ok((await fresh.text()).includes('COURTCREW'), 'the page is made from the new name');
});

test('another community called "Next Gen Boys" does not take the old address', async () => {
  const other = await makePlayer('Rn Other');
  const made = await call('POST', '/api/communities', { cookie: other.cookie, body: { type: 'COMMUNITY', name: 'Next Gen Boys' } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.json.slug, 'next-gen-boys-2');
  assert.strictEqual((await call('GET', '/api/communities/next-gen-boys')).json.id, setup.org.id, 'the old address is still the renamed one');
  setup.other = { org: made.json, owner: other };
});

test('renaming it back takes the old address again; renaming to a name that is taken adds a number', async () => {
  const back = await rename('Next Gen Boys');
  assert.strictEqual(back.json.slug, 'next-gen-boys');
  assert.strictEqual((await call('GET', '/api/communities/courtcrew')).json.slug, 'next-gen-boys', 'COURTCREW is now the old address');
  const clash = await rename('Next Gen Boys 2', setup.org);
  assert.strictEqual(clash.json.slug, 'next-gen-boys-2-2', 'the address next-gen-boys-2 belongs to the other community');
  assert.strictEqual((await call('GET', '/api/communities/next-gen-boys-2')).json.id, setup.other.org.id);
});

test('only an admin can rename it', async () => {
  const stranger = await makePlayer('Rn Stranger');
  assert.strictEqual((await rename('Hijacked', setup.org, stranger)).status, 403);
  assert.strictEqual((await call('GET', `/api/communities/${setup.org.id}/members`)).status, 200);
});

test('deleting the community frees its old addresses', async () => {
  assert.strictEqual((await call('DELETE', `/api/communities/${setup.org.id}`, { cookie: setup.owner.cookie })).status, 200);
  assert.strictEqual((await call('GET', '/api/communities/courtcrew')).status, 404);
  assert.strictEqual((await call('GET', '/api/communities/next-gen-boys')).status, 404);
});

test('the one-off catch-up gives a community that was renamed before this its new address (the old one stays as a way in), once, and leaves the others alone', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const owner = await makePlayer('Rn Owner 2');
  const a = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Zeta Boys' } })).json;
  const twin = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Zeta Boys' } })).json;
  assert.deepStrictEqual([a.slug, twin.slug], ['zeta-boys', 'zeta-boys-2']);
  // what the old rename did: the name changed, the address did not
  const file = new DatabaseSync(path.join(dir, 'blta-score.db'));
  try {
    file.exec('PRAGMA busy_timeout = 5000');
    file.prepare("UPDATE organisations SET name = 'Omega Crew' WHERE id = ?").run(a.id);
    file.prepare("DELETE FROM app_flags WHERE key = 'org_slugs_follow_names'").run();
  } finally { file.close(); }
  const run = () => JSON.parse(require('child_process').execFileSync(process.execPath, ['-e',
    "const db=require('./src/db');console.log(JSON.stringify(require('./src/communities').slugsFollowNames()))"], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' }).trim().split('\n').pop());
  assert.strictEqual(run(), 1, 'only the renamed one is changed (a twin zeta-boys-2 of its own name is fine)');
  assert.strictEqual((await call('GET', '/api/communities/omega-crew')).json.id, a.id);
  assert.strictEqual((await call('GET', '/api/communities/zeta-boys')).json.slug, 'omega-crew', 'the old address leads to the new one');
  assert.strictEqual((await call('GET', '/api/communities/zeta-boys-2')).json.id, twin.id, 'the twin keeps its address');
  assert.strictEqual(run(), 0, 'it runs once');
});

test('the page follows a renamed address in the address bar, so the invitation link (made from the address of the page) has the new name in it', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/community.js'), 'utf8');
  new (require('vm').Script)(js, { filename: 'community.js' }); // (it has to be a script the browser can run at all)
  assert.ok(js.includes('if (org.slug && org.slug !== slug) {') && js.includes("window.history.replaceState(null, '', parts.join('/')"), 'the address bar follows the new address');
  assert.ok(js.includes('window.location.pathname}?invite='), 'the invitation link is the address of the page');
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
