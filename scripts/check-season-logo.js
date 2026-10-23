// Checks of the logo upload of a season (src/routes/seasons.js, Backend > Seasons > "Logo"): an admin sends a picture, the season keeps the address,
// the picture is served, a new one replaces (and removes) the old file, the logo can be taken away, and only pictures from an admin are accepted.
// Run: node scripts/check-season-logo.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-logo-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, url, { cookie = adminCookie, body, form } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const picture = (name = 'logo.png', type = 'image/png', bytes = PNG) => { const f = new FormData(); f.append('photo', new Blob([bytes], { type }), name); return f; };
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

let seasonId = null;
let firstUrl = '';

test('an admin uploads the logo of a season: the season keeps its address and the picture is served', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Logo Test Series', startDate: '2027-01-01', endDate: '2027-04-30' } });
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.json));
  seasonId = made.json.id;
  const up = await call('POST', `/api/seasons/${seasonId}/logo`, { form: picture('logo.png') });
  assert.strictEqual(up.status, 200, JSON.stringify(up.json));
  firstUrl = up.json.logoUrl;
  assert.ok(/^\/season-heroes\/.+-logo-.+\.png$/.test(firstUrl), firstUrl);
  const shown = await fetch(base + firstUrl);
  assert.strictEqual(shown.status, 200);
  const list = await call('GET', '/api/seasons', { cookie: '' });
  assert.strictEqual(list.json.find((s) => s.id === seasonId).logoUrl, firstUrl);
});

test('a new logo replaces the old one and the old file is removed', async () => {
  const up = await call('POST', `/api/seasons/${seasonId}/logo`, { form: picture('logo2.png') });
  assert.strictEqual(up.status, 200);
  assert.notStrictEqual(up.json.logoUrl, firstUrl);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual((await fetch(base + firstUrl)).status, 404, 'the old file is gone');
  assert.strictEqual((await fetch(base + up.json.logoUrl)).status, 200);
});

test('the logo can be taken away', async () => {
  const gone = await call('DELETE', `/api/seasons/${seasonId}/logo`);
  assert.strictEqual(gone.status, 200);
  assert.strictEqual(gone.json.logoUrl, '');
});

test('only pictures, and only from an admin', async () => {
  const bad = await call('POST', `/api/seasons/${seasonId}/logo`, { form: picture('x.txt', 'text/plain', Buffer.from('hello')) });
  assert.strictEqual(bad.status, 400, 'a text file is not a picture');
  assert.strictEqual((await call('POST', `/api/seasons/${seasonId}/logo`, { cookie: '', form: picture() })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/seasons/${seasonId}/logo`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('POST', '/api/seasons/999999/logo', { form: picture() })).status, 404);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
      if (i === 99) throw new Error(`the server did not start: ${output}`);
    }
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
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
