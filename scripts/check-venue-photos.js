// Checks of the venue photos uploaded in /venues-admin: POST / DELETE /api/venues/:id/photo (admin only, JPG/PNG/WebP up to 6 MB), the file
// being served from /venue-photos/, an old upload being removed when it is replaced, a photo shipped with the app being left alone.
// Run: node scripts/check-venue-photos.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vphoto-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

const JPEG = (extra = 16) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(extra, 1), Buffer.from([0xff, 0xd9])]);

async function call(method, url, { body, form, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, res };
}
const photoForm = (buf, type = 'image/jpeg', filename = 'photo.jpg') => {
  const form = new FormData();
  form.append('photo', new Blob([buf], { type }), filename);
  return form;
};
const onDisk = (url) => fs.existsSync(path.join(dir, 'venue-photos', path.basename(url)));

let venue;

test('setup: a venue', async () => {
  const made = await call('POST', '/api/venues', { cookie: adminCookie, body: { name: 'Photo Test Courts' } });
  assert.strictEqual(made.status, 201, made.text);
  venue = made.json;
  assert.strictEqual(venue.imageUrl, null);
});

test('only an admin can upload or remove a photo', async () => {
  assert.strictEqual((await call('POST', `/api/venues/${venue.id}/photo`, { form: photoForm(JPEG()) })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/venues/${venue.id}/photo`)).status, 401);
});

test('the admin uploads a JPEG: the venue gets its address, the file is served, the public list carries it', async () => {
  const up = await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: photoForm(JPEG(64)) });
  assert.strictEqual(up.status, 200, up.text);
  assert.match(up.json.imageUrl, /^\/venue-photos\/photo-test-courts-\d+-[0-9a-f]{8}\.jpg$/);
  assert.ok(onDisk(up.json.imageUrl));
  const served = await fetch(base + up.json.imageUrl);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/jpeg');
  const list = (await call('GET', '/api/venues')).json;
  assert.strictEqual(list.find((v) => v.id === venue.id).imageUrl, up.json.imageUrl);
  venue = up.json;
});

test('a PNG is accepted (and replaces the old upload); a text file, a GIF, an empty request and an oversized file are 400 and change nothing', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]);
  const before = venue.imageUrl;
  const asPng = await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: photoForm(png, 'image/png', 'a.png') });
  assert.strictEqual(asPng.status, 200, asPng.text);
  assert.match(asPng.json.imageUrl, /\.png$/);
  assert.ok(!onDisk(before), 'the replaced upload is removed from the disk');
  venue = asPng.json;
  for (const [buf, type] of [[Buffer.from('hello'), 'text/plain'], [Buffer.from('GIF89a....'), 'image/gif']]) {
    const bad = await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: photoForm(buf, type, 'x') });
    assert.strictEqual(bad.status, 400, `${type}: ${bad.text}`);
  }
  assert.strictEqual((await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: new FormData() })).status, 400);
  const big = await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: photoForm(JPEG(7 * 1024 * 1024)) });
  assert.strictEqual(big.status, 400, big.text);
  assert.strictEqual((await call('GET', `/api/venues`)).json.find((v) => v.id === venue.id).imageUrl, venue.imageUrl, 'nothing changed');
});

test('an unknown venue is 404', async () => {
  assert.strictEqual((await call('POST', '/api/venues/99999/photo', { cookie: adminCookie, form: photoForm(JPEG()) })).status, 404);
  assert.strictEqual((await call('DELETE', '/api/venues/99999/photo', { cookie: adminCookie })).status, 404);
});

test('removing the photo clears the address and deletes the file; deleting the venue deletes its photo too', async () => {
  const url = venue.imageUrl;
  const gone = await call('DELETE', `/api/venues/${venue.id}/photo`, { cookie: adminCookie });
  assert.strictEqual(gone.status, 200, gone.text);
  assert.strictEqual(gone.json.imageUrl, null);
  assert.ok(!onDisk(url));
  const again = await call('POST', `/api/venues/${venue.id}/photo`, { cookie: adminCookie, form: photoForm(JPEG(32)) });
  const second = again.json.imageUrl;
  assert.ok(onDisk(second));
  assert.strictEqual((await call('DELETE', `/api/venues/${venue.id}`, { cookie: adminCookie })).status, 200);
  assert.ok(!onDisk(second), 'the file of a deleted venue is removed');
});

test('a photo shipped with the app (/img/courts/…) is never deleted by removing it from a venue', async () => {
  const made = await call('POST', '/api/venues', { cookie: adminCookie, body: { name: 'Shipped Photo Courts' } });
  const patched = await call('PATCH', `/api/venues/${made.json.id}`, { cookie: adminCookie, body: { imageUrl: '/img/courts/fit-camp.jpg' } });
  assert.strictEqual(patched.json.imageUrl, '/img/courts/fit-camp.jpg');
  assert.strictEqual((await call('DELETE', `/api/venues/${made.json.id}/photo`, { cookie: adminCookie })).status, 200);
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'img', 'courts', 'fit-camp.jpg')));
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
