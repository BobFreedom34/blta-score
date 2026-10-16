// Checks of the order of the tennis venues (Backend > Venues, drag to reorder; the public Courts page follows it): alphabetical until an
// admin orders them, POST /api/venues/reorder (admin only, only existing venues, each once), a new venue goes to the end.
// Run: node scripts/check-venue-order.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vorder-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const names = async () => (await call('GET', '/api/venues', undefined, { admin: false })).json.map((v) => v.name);

let mine = [];

test('setup: three venues of my own; the list is alphabetical until somebody orders it', async () => {
  const before = await names();
  for (const name of ['Zeta Court', 'Alfa Court', 'Mid Court']) {
    const r = await call('POST', '/api/venues', { name });
    assert.strictEqual(r.status, 201, r.text);
    mine.push(r.json);
  }
  const after = await names();
  assert.deepStrictEqual(after, [...after].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'alphabetical');
  assert.strictEqual(after.length, before.length + 3);
});

test('only an admin can reorder, and only with venues that exist, each once', async () => {
  const ids = (await call('GET', '/api/venues')).json.map((v) => v.id);
  assert.strictEqual((await call('POST', '/api/venues/reorder', { ids }, { admin: false })).status, 401);
  assert.strictEqual((await call('POST', '/api/venues/reorder', { ids: [] })).status, 400);
  assert.strictEqual((await call('POST', '/api/venues/reorder', { ids: [ids[0], ids[0]] })).status, 400);
  assert.strictEqual((await call('POST', '/api/venues/reorder', { ids: [999999] })).status, 400);
});

test('the order set by the admin is what the list (and so the public page) shows; a venue left out follows the listed ones', async () => {
  const all = (await call('GET', '/api/venues')).json;
  const [zeta, alfa, mid] = ['Zeta Court', 'Alfa Court', 'Mid Court'].map((n) => all.find((v) => v.name === n));
  const first = await call('POST', '/api/venues/reorder', { ids: [zeta.id, mid.id, alfa.id] });
  assert.strictEqual(first.status, 200, first.text);
  const order = (await names());
  assert.deepStrictEqual(order.slice(0, 3), ['Zeta Court', 'Mid Court', 'Alfa Court']);
  // only a part is listed: the others keep their relative order after it
  const rest = order.slice(3);
  await call('POST', '/api/venues/reorder', { ids: [alfa.id] });
  assert.deepStrictEqual(await names(), ['Alfa Court', 'Zeta Court', 'Mid Court', ...rest]);
});

test('a new venue goes to the end of an ordered list', async () => {
  const added = await call('POST', '/api/venues', { name: 'Newest Court' });
  assert.strictEqual(added.status, 201, added.text);
  const order = await names();
  assert.strictEqual(order[order.length - 1], 'Newest Court');
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
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 40000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
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
