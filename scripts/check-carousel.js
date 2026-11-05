// Checks of the home carousel's pictures (Backend > Carousel): the mobile one (POST/DELETE /api/carousel/:id/mobile-image) and the replacing of the desktop one (POST /api/carousel/:id/image).
// Run: node scripts/check-carousel.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carousel-check-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';

// the smallest valid PNG (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const form = (buffer, type, name = 'p.png') => { const f = new FormData(); f.append('image', new Blob([buffer], { type }), name); return f; };
const files = () => (fs.existsSync(path.join(dataDir, 'carousel')) ? fs.readdirSync(path.join(dataDir, 'carousel')) : []);

async function call(method, url, { body, form: f, withCookie = true } = {}) {
  const headers = {};
  if (withCookie) headers.Cookie = cookie;
  let payload;
  if (f) payload = f;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const newSlide = async () => {
  const r = await call('POST', '/api/carousel', { form: form(PNG, 'image/png') });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const base = (url) => path.basename(url);

test('a new slide has no mobile picture', async () => {
  const s = await newSlide();
  assert.strictEqual(s.mobileImageUrl, '');
});

test('a mobile picture is saved, served and shown by the public list', async () => {
  const s = await newSlide();
  const r = await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.mobileImageUrl, /^\/carousel-images\/slide-m-/);
  assert.notStrictEqual(r.json.mobileImageUrl, r.json.imageUrl);
  assert.ok(files().includes(base(r.json.mobileImageUrl)));
  assert.strictEqual((await fetch(BASE + r.json.mobileImageUrl)).status, 200);
  const pub = (await call('GET', '/api/carousel', { withCookie: false })).json.find((x) => x.id === s.id);
  assert.strictEqual(pub.mobileImageUrl, r.json.mobileImageUrl);
  assert.strictEqual(pub.imageUrl, s.imageUrl, 'the desktop picture stays');
});

test('a second mobile picture replaces the first and deletes its file', async () => {
  const s = await newSlide();
  const first = (await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') })).json;
  const second = (await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') })).json;
  assert.notStrictEqual(first.mobileImageUrl, second.mobileImageUrl);
  assert.ok(!files().includes(base(first.mobileImageUrl)));
  assert.ok(files().includes(base(second.mobileImageUrl)));
});

test('removing the mobile picture deletes the file and keeps the slide', async () => {
  const s = await newSlide();
  const withMobile = (await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') })).json;
  const r = await call('DELETE', `/api/carousel/${s.id}/mobile-image`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.mobileImageUrl, '');
  assert.ok(!files().includes(base(withMobile.mobileImageUrl)));
  assert.ok(files().includes(base(s.imageUrl)));
});

test('deleting a slide deletes both of its pictures', async () => {
  const s = await newSlide();
  const withMobile = (await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') })).json;
  assert.strictEqual((await call('DELETE', `/api/carousel/${s.id}`)).status, 204);
  assert.ok(!files().includes(base(s.imageUrl)));
  assert.ok(!files().includes(base(withMobile.mobileImageUrl)));
});

test('a wrong file type or a file over 6 MB is refused and nothing is written', async () => {
  const s = await newSlide();
  const before = files().length;
  assert.strictEqual((await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(Buffer.from('hello'), 'text/plain', 'a.txt') })).status, 400);
  assert.strictEqual((await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(Buffer.alloc(6 * 1024 * 1024 + 1), 'image/png') })).status, 400);
  assert.strictEqual(files().length, before);
});

test('only an admin can set it, and an unknown slide gives 404 without leaving a file', async () => {
  const s = await newSlide();
  assert.strictEqual((await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png'), withCookie: false })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/carousel/${s.id}/mobile-image`, { withCookie: false })).status, 401);
  const before = files().length;
  assert.strictEqual((await call('POST', '/api/carousel/999999/mobile-image', { form: form(PNG, 'image/png') })).status, 404);
  assert.strictEqual(files().length, before);
});

test('the desktop picture of a slide can be replaced: the new file is served, the old one deleted, the heading and the mobile picture stay', async () => {
  const s = await newSlide();
  const mobile = (await call('POST', `/api/carousel/${s.id}/mobile-image`, { form: form(PNG, 'image/png') })).json;
  assert.strictEqual((await call('PATCH', `/api/carousel/${s.id}`, { body: { captionSk: 'Finále ELITE' } })).status, 200);
  const r = await call('POST', `/api/carousel/${s.id}/image`, { form: form(PNG, 'image/png') });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.imageUrl, /^\/carousel-images\/slide-\d/);
  assert.notStrictEqual(r.json.imageUrl, s.imageUrl);
  assert.ok(files().includes(base(r.json.imageUrl)));
  assert.ok(!files().includes(base(s.imageUrl)), 'the old desktop picture is deleted');
  assert.strictEqual((await fetch(BASE + r.json.imageUrl)).status, 200);
  assert.strictEqual(r.json.captionSk, 'Finále ELITE');
  assert.strictEqual(r.json.mobileImageUrl, mobile.mobileImageUrl);
  assert.ok(files().includes(base(mobile.mobileImageUrl)));
  assert.strictEqual((await call('GET', '/api/carousel', { withCookie: false })).json.find((x) => x.id === s.id).imageUrl, r.json.imageUrl);
});

test('replacing the desktop picture: a wrong file is refused and changes nothing, only an admin may, an unknown slide is 404', async () => {
  const s = await newSlide();
  const before = files().length;
  assert.strictEqual((await call('POST', `/api/carousel/${s.id}/image`, { form: form(Buffer.from('hello'), 'text/plain', 'a.txt') })).status, 400);
  assert.strictEqual((await call('POST', `/api/carousel/${s.id}/image`, { form: form(PNG, 'image/png'), withCookie: false })).status, 401);
  assert.strictEqual((await call('POST', '/api/carousel/999999/image', { form: form(PNG, 'image/png') })).status, 404);
  assert.strictEqual(files().length, before);
  assert.ok(files().includes(base(s.imageUrl)));
});

test('the Backend page has a Replace button under the desktop picture, as under the mobile one', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/carousel-admin.js'), 'utf8');
  new (require('vm').Script)(js, { filename: 'carousel-admin.js' });
  assert.ok(js.includes('data-act="desktop-upload"') && js.includes("'desktop-upload'") && js.includes("desktop ? 'image' : 'mobile-image'"));
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
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
