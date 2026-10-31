// Checks of the media library (src/routes/media.js, Backend > Media): an admin uploads pictures, they are shown at /media/<file>, renamed and deleted;
// only pictures are accepted; every city has its own library; the pictures that are on the server already (here: a carousel slide) are listed for
// reuse; a city admin works on his own library only.
// Run: node scripts/check-media.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, url, { cookie = adminCookie, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
// a picture of its own (a few extra bytes after the PNG, which a viewer ignores): the same bytes are one picture for the library
const unique = (n) => Buffer.concat([PNG, Buffer.from(`-${n}`)]);
const picture = (name = 'logo.png', type = 'image/png', bytes = PNG) => { const f = new FormData(); f.append('image', new Blob([bytes], { type }), name); return f; };
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('an admin uploads a picture; it is in the library and shown at its address', async () => {
  const up = await call('POST', '/api/media', { form: picture('Hero Kosice.png') });
  assert.strictEqual(up.status, 201, JSON.stringify(up.json));
  const m = up.json.added[0];
  assert.ok(m.url.startsWith('/media/') && m.url.endsWith('.png') && m.name === 'Hero Kosice.png' && m.size === PNG.length);
  const shown = await fetch(base + m.url);
  assert.strictEqual(shown.status, 200);
  assert.strictEqual(shown.headers.get('content-type'), 'image/png');
  const list = await call('GET', '/api/media');
  assert.deepStrictEqual(list.json.library.map((x) => x.id), [m.id]);
  assert.strictEqual(list.json.server, undefined, 'the pictures of the server only on request');
});

test('several pictures at once; only pictures are accepted; only an admin', async () => {
  const f = new FormData();
  f.append('image', new Blob([unique(1)], { type: 'image/png' }), 'a.png');
  f.append('image', new Blob([unique(2)], { type: 'image/png' }), 'b.png');
  const two = await call('POST', '/api/media', { form: f });
  assert.strictEqual(two.json.added.length, 2);
  const bad = await call('POST', '/api/media', { form: picture('x.txt', 'text/plain', Buffer.from('hello')) });
  assert.strictEqual(bad.status, 400, 'a text file is not a picture');
  assert.strictEqual((await call('POST', '/api/media', { cookie: '', form: picture() })).status, 401);
  assert.strictEqual((await call('GET', '/api/media', { cookie: '' })).status, 401);
  assert.strictEqual((await call('DELETE', '/api/media/1', { cookie: '' })).status, 401);
});

test('the same picture uploaded again is the one in the library already (from any page), also one from before the fingerprint existed', async () => {
  const before = (await call('GET', '/api/media')).json.library.length;
  const first = await call('POST', '/api/media', { form: picture('share.png', 'image/png', unique(7)) });
  assert.strictEqual(first.json.added.length, 1);
  const again = await call('POST', '/api/media', { form: picture('other-name.png', 'image/png', unique(7)) });
  assert.strictEqual(again.status, 201);
  assert.deepStrictEqual([again.json.added.length, again.json.reused.length], [0, 1]);
  assert.strictEqual(again.json.files[0].id, first.json.added[0].id, 'the same picture comes back');
  assert.strictEqual((await call('GET', '/api/media')).json.library.length, before + 1, 'one copy only');
  // a mix in one request: one known, one new, in the order of the files
  const f = new FormData();
  f.append('image', new Blob([unique(8)], { type: 'image/png' }), 'new.png');
  f.append('image', new Blob([unique(7)], { type: 'image/png' }), 'known.png');
  const mix = await call('POST', '/api/media', { form: f });
  assert.deepStrictEqual([mix.json.added.length, mix.json.reused.length], [1, 1]);
  assert.deepStrictEqual(mix.json.files.map((x) => x.id), [mix.json.added[0].id, first.json.added[0].id]);
  // a picture that was stored before there were fingerprints (empty hash) is recognised too, and gets its fingerprint
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  db.prepare("UPDATE media_files SET hash = '' WHERE id = ?").run(first.json.added[0].id);
  db.close();
  const legacy = await call('POST', '/api/media', { form: picture('legacy.png', 'image/png', unique(7)) });
  assert.deepStrictEqual([legacy.json.added.length, legacy.json.reused.length], [0, 1], 'an old row is found by its bytes');
  // another city has its own library: the same bytes are a picture of its own there (see the next tests)
});

test('rename and delete (the file goes with it)', async () => {
  const [first] = (await call('GET', '/api/media')).json.library.slice(-1);
  const renamed = await call('PATCH', `/api/media/${first.id}`, { body: { name: 'Logo of the league.png' } });
  assert.strictEqual(renamed.json.name, 'Logo of the league.png');
  assert.strictEqual((await call('PATCH', `/api/media/${first.id}`, { body: { name: '  ' } })).status, 400);
  assert.strictEqual((await call('DELETE', `/api/media/${first.id}`)).status, 200);
  assert.strictEqual((await fetch(base + first.url)).status, 404, 'the file is gone');
  assert.strictEqual((await call('DELETE', `/api/media/${first.id}`)).status, 404);
});

test('the pictures that are on the server already are listed for reuse (a carousel slide)', async () => {
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'slide.png');
  const slide = await call('POST', '/api/carousel', { form });
  assert.strictEqual(slide.status, 201, JSON.stringify(slide.json));
  const withServer = await call('GET', '/api/media?server=1');
  const found = withServer.json.server.find((x) => x.url === slide.json.imageUrl);
  assert.ok(found, 'the slide is listed');
  assert.strictEqual(found.place, 'Carousel');
  assert.strictEqual((await fetch(base + found.url)).status, 200, 'and can be read to use it again');
});

test('every city has its own library; a city admin works on his own only', async () => {
  const city = await call('POST', '/api/leagues', { body: { name: 'Kosice' } });
  const pick = await call('POST', '/api/admin/acting-city', { body: { leagueId: city.json.id } });
  const withCity = `${adminCookie}; ${cookieOf(pick)}`;
  const X = { 'X-Backend': '1' };
  assert.deepStrictEqual((await call('GET', '/api/media', { cookie: withCity, headers: X })).json.library, [], 'Kosice starts empty');
  const up = await call('POST', '/api/media', { cookie: withCity, headers: X, form: picture('kosice.png') });
  assert.strictEqual(up.status, 201);
  const mine = up.json.added[0];
  assert.ok(!(await call('GET', '/api/media')).json.library.some((x) => x.id === mine.id), 'not in the first city');
  assert.strictEqual((await call('DELETE', `/api/media/${mine.id}`, { headers: X })).status, 404, 'the first city cannot delete it');
  // a city admin
  await call('POST', '/api/city-admins', { body: { name: 'Martin K', email: 'martin@example.com', leagueId: city.json.id, password: 'long-enough-1' } });
  const login = await call('POST', '/api/admin/login', { cookie: '', body: { email: 'martin@example.com', password: 'long-enough-1' } });
  const cityCookie = cookieOf(login);
  const own = await call('GET', '/api/media', { cookie: cityCookie, headers: X });
  assert.deepStrictEqual(own.json.library.map((x) => x.id), [mine.id], 'he sees his city');
  assert.strictEqual((await call('POST', '/api/media', { cookie: cityCookie, headers: X, form: picture('two.png') })).status, 201);
  const firstCity = (await call('GET', '/api/media')).json.library[0];
  assert.strictEqual((await call('DELETE', `/api/media/${firstCity.id}`, { cookie: cityCookie, headers: X })).status, 404, 'not the first city\'s picture');
});

test('the page of the backend exists and is not a public page', async () => {
  const page = await call('GET', '/media-admin', { cookie: '' });
  assert.strictEqual(page.status, 200);
  assert.ok((await fetch(`${base}/robots.txt`).then((r) => r.text())).includes('Disallow: /media-admin'));
  assert.ok(!(await fetch(`${base}/sitemap.xml`).then((r) => r.text())).includes('media-admin'));
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
