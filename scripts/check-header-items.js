// Checks of the menu rules (Backend > Menu, /api/header-items): three levels at most, moving an item together with its
// sub-items, no loops, deleting a branch.
// Run: node scripts/check-header-items.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-check-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let fixtureDb = null;

async function call(method, url, body, withCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
let counter = 0;
async function add(label, parentId = null) {
  const r = await call('POST', '/api/header-items', { labelSk: label, link: `/x-${label}-${counter += 1}`, parentId });
  assert.ok([201, 400].includes(r.status), JSON.stringify(r.json));
  return r;
}
async function made(label, parentId = null) {
  const r = await add(label, parentId);
  assert.strictEqual(r.status, 201, `${label}: ${JSON.stringify(r.json)}`);
  return r.json;
}
// moves an item to another parent (keeps its label and link)
async function move(item, parentId) {
  return call('PATCH', `/api/header-items/${item.id}`, { labelSk: item.labelSk, labelEn: item.labelEn || '', link: item.link, sortOrder: item.sortOrder, parentId });
}
const tree = async () => (await call('GET', '/api/header-items', undefined, false)).json;
const find = (items, id) => {
  for (const i of items) {
    if (i.id === id) return i;
    const f = find(i.children || [], id);
    if (f) return f;
  }
  return null;
};
const rowExists = (id) => !!fixtureDb.prepare('SELECT 1 FROM header_items WHERE id = ?').get(id);

test('only an admin can change the menu', async () => {
  assert.strictEqual((await call('POST', '/api/header-items', { labelSk: 'x', link: '/x' }, false)).status, 401);
});

test('a sub-item can have its own sub-items (three levels)', async () => {
  const a = await made('A1');
  const b = await made('B1', a.id);
  const c = await made('C1', b.id);
  const t = await tree();
  const top = find(t, a.id);
  assert.deepStrictEqual(top.children.map((x) => x.id), [b.id]);
  assert.deepStrictEqual(find(t, b.id).children.map((x) => x.id), [c.id]);
  assert.deepStrictEqual(find(t, c.id).children, []);
});

test('a fourth level is refused', async () => {
  const a = await made('A2');
  const b = await made('B2', a.id);
  const c = await made('C2', b.id);
  const r = await add('D2', c.id);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /three levels/);
});

test('an item with sub-items can be moved under another item (the Seasons under League case)', async () => {
  const league = await made('Liga3');
  const seasons = await made('Sezony3');
  const s1 = await made('S1-3', seasons.id);
  const s2 = await made('S2-3', seasons.id);
  const r = await move(seasons, league.id);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const t = await tree();
  assert.deepStrictEqual(find(t, league.id).children.map((x) => x.id), [seasons.id]);
  assert.deepStrictEqual(find(t, seasons.id).children.map((x) => x.id).sort(), [s1.id, s2.id].sort());
  assert.ok(!t.some((x) => x.id === seasons.id), 'no longer a main item');
});

test('moving a branch that would end up four levels deep is refused', async () => {
  const top = await made('Top4');
  const mid = await made('Mid4', top.id);
  const branch = await made('Branch4');
  const leaf = await made('Leaf4', branch.id);
  await made('Leaf4b', leaf.id); // branch has 3 levels: branch > leaf > leaf4b
  const r = await move(branch, mid.id); // would be top > mid > branch > leaf > leaf4b
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /three levels/);
});

test('an item cannot be placed under itself or under its own sub-item', async () => {
  const a = await made('A5');
  const b = await made('B5', a.id);
  assert.strictEqual((await move(a, a.id)).status, 400);
  assert.strictEqual((await move(a, b.id)).status, 400);
});

test('a sub-sub-item can be moved back to the top', async () => {
  const a = await made('A6');
  const b = await made('B6', a.id);
  const c = await made('C6', b.id);
  const r = await move(c, null);
  assert.strictEqual(r.status, 200);
  assert.ok((await tree()).some((x) => x.id === c.id));
  assert.deepStrictEqual(find(await tree(), b.id).children, []);
});

test('the My profile item cannot have sub-items', async () => {
  const profile = fixtureDb.prepare('SELECT id FROM header_items WHERE is_my_profile = 1').get();
  const r = await add('Under profile', profile.id);
  assert.strictEqual(r.status, 400);
});

test('deleting an item deletes its whole branch', async () => {
  const a = await made('A7');
  const b = await made('B7', a.id);
  const c = await made('C7', b.id);
  const other = await made('Other7');
  assert.strictEqual((await call('DELETE', `/api/header-items/${a.id}`)).status, 204);
  assert.ok(!rowExists(a.id) && !rowExists(b.id) && !rowExists(c.id));
  assert.ok(rowExists(other.id));
});

test('the link is optional: an empty one is stored as #, a heading that only opens its sub-items', async () => {
  const r = await call('POST', '/api/header-items', { labelSk: 'Heading8', link: '' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.link, '#');
  const none = await call('POST', '/api/header-items', { labelSk: 'Heading8b' });
  assert.strictEqual(none.status, 201);
  assert.strictEqual(none.json.link, '#');
  // a real link is kept exactly as typed
  const real = await made('Real8');
  assert.match(real.link, /^\/x-Real8-/);
  // editing a heading to an empty link works too
  const edited = await call('PATCH', `/api/header-items/${r.json.id}`, { labelSk: 'Heading8', link: '' });
  assert.strictEqual(edited.status, 200);
});

test('a label is still required', async () => {
  assert.strictEqual((await call('POST', '/api/header-items', { labelSk: '', link: '/x' })).status, 400);
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
    fixtureDb = new DatabaseSync(path.join(dataDir, 'blta-score.db'));
    fixtureDb.exec('PRAGMA busy_timeout = 5000');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (fixtureDb) fixtureDb.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
