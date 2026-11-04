// Checks of the gallery of a tournament or a season (its tab Galéria): GET / POST / DELETE /api/seasons/:id/photos. The server runs against the same fake Google Drive as
// the match photos (scripts/lib/fake-drive-preload.js), so what was sent to Drive can be checked: the gallery uses the same Drive folder, the same upload and the same clean-up.
// Run: node scripts/check-season-photos.js   (starts its own servers on temporary data directories; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'lib', 'fake-drive-preload.js').split(path.sep).join('/');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seasonphotos-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const servers = [];

async function startServer(name, { configured }) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const srv = { base: `http://localhost:${port}`, dir, logFile: path.join(dir, 'drive.log'), adminCookie: '', child: null };
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
  for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
  if (configured) {
    Object.assign(env, {
      GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_PHOTOS_FOLDER_ID: 'photos-folder',
      NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --require "${PRELOAD}"`, FAKE_DRIVE_LOG: srv.logFile,
    });
  }
  srv.child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(srv);
  let output = '';
  srv.child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server ${name} did not start:\n${output}`)), 30000);
    srv.child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    srv.child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server ${name} exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  srv.adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(srv.adminCookie, 'admin login gave no cookie');
  return srv;
}

async function call(srv, method, url, { body, form, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(srv.base + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.clone().json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const driveLog = (srv) => (fs.existsSync(srv.logFile) ? fs.readFileSync(srv.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// a tiny file that starts like a JPEG / PNG (the server looks at the first bytes)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const formOf = (buffer, type, name = 'photo.jpg') => { const f = new FormData(); f.append('photo', new Blob([buffer], { type }), name); return f; };

let main = null;
let season = null;

test('setup: a tournament', async () => {
  main = await startServer('main', { configured: true });
  const made = await call(main, 'POST', '/api/seasons', { cookie: main.adminCookie, body: { name: 'Galéria turnaj', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: '2099-06-01', endDate: '2099-06-02' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  season = made.json;
});

test('the gallery starts empty; anybody may look, only the organiser (admin) is offered the button', async () => {
  const visitor = await call(main, 'GET', `/api/seasons/${season.id}/photos`);
  assert.deepStrictEqual([visitor.status, visitor.json.enabled, visitor.json.canAdd, visitor.json.photos], [200, true, false, []]);
  const admin = await call(main, 'GET', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie });
  assert.deepStrictEqual([admin.json.enabled, admin.json.canAdd, admin.json.max], [true, true, 200]);
  assert.strictEqual((await call(main, 'GET', '/api/seasons/999999/photos')).status, 404);
});

test('a visitor cannot add a photo; a file that is not a picture, and an empty request, never reach Drive', async () => {
  assert.strictEqual((await call(main, 'POST', `/api/seasons/${season.id}/photos`, { form: formOf(JPEG, 'image/jpeg') })).status, 401);
  const text = await call(main, 'POST', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie, form: formOf(Buffer.from('just some text, not a picture'), 'image/jpeg') });
  assert.strictEqual(text.status, 400);
  assert.strictEqual((await call(main, 'POST', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie, form: new FormData() })).status, 400);
  assert.deepStrictEqual(driveLog(main), [], 'nothing was sent to Drive');
});

test('the admin adds photos: they go to Drive (upload, then the public link), and the list has them in order with the picture addresses', async () => {
  const a = await call(main, 'POST', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie, form: formOf(JPEG, 'image/jpeg') });
  assert.strictEqual(a.status, 201, JSON.stringify(a.json));
  const b = await call(main, 'POST', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie, form: formOf(PNG, 'image/png', 'photo.png') });
  assert.strictEqual(b.status, 201, JSON.stringify(b.json));
  assert.ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=fake\d+&sz=w1600$/.test(a.json.url), a.json.url);
  assert.ok(/sz=w400$/.test(a.json.thumbUrl));
  assert.deepStrictEqual(driveLog(main).map((e) => e.op), ['upload', 'permCreate', 'upload', 'permCreate']);
  const list = (await call(main, 'GET', `/api/seasons/${season.id}/photos`)).json;
  assert.deepStrictEqual(list.photos.map((p) => p.id), [a.json.id, b.json.id]);
  assert.ok(list.photos.every((p) => p.canRemove === false), 'a visitor cannot remove');
  const asAdmin = (await call(main, 'GET', `/api/seasons/${season.id}/photos`, { cookie: main.adminCookie })).json;
  assert.ok(asAdmin.photos.every((p) => p.canRemove === true));
});

test('a visitor cannot remove a photo; the admin can: the public link is revoked and the file deleted in Drive', async () => {
  const list = (await call(main, 'GET', `/api/seasons/${season.id}/photos`)).json.photos;
  assert.strictEqual((await call(main, 'DELETE', `/api/seasons/${season.id}/photos/${list[0].id}`)).status, 401);
  assert.strictEqual((await call(main, 'DELETE', `/api/seasons/${season.id}/photos/999999`, { cookie: main.adminCookie })).status, 404);
  assert.strictEqual((await call(main, 'DELETE', `/api/seasons/${season.id}/photos/${list[0].id}`, { cookie: main.adminCookie })).status, 204);
  const ops = driveLog(main).map((e) => e.op);
  assert.deepStrictEqual(ops.slice(-2), ['permDelete', 'fileDelete']);
  assert.strictEqual((await call(main, 'GET', `/api/seasons/${season.id}/photos`)).json.photos.length, 1);
});

test('deleting the tournament deletes its photos: the rows go and the files leave Drive', async () => {
  assert.strictEqual((await call(main, 'DELETE', `/api/seasons/${season.id}?withMatches=1`, { cookie: main.adminCookie })).status, 200);
  await new Promise((r) => setTimeout(r, 600)); // (the files leave Drive in the background)
  const ops = driveLog(main).map((e) => e.op);
  assert.strictEqual(ops.filter((o) => o === 'fileDelete').length, 2, 'both files were deleted from Drive: ' + ops.join(','));
});

test('without Google Drive set up the gallery says it is off (no button) and adding is refused', async () => {
  const off = await startServer('off', { configured: false });
  const made = await call(off, 'POST', '/api/seasons', { cookie: off.adminCookie, body: { name: 'Bez drive', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: '2099-06-01', endDate: '2099-06-02' } });
  const got = await call(off, 'GET', `/api/seasons/${made.json.id}/photos`, { cookie: off.adminCookie });
  assert.deepStrictEqual([got.json.enabled, got.json.canAdd], [false, false]);
  assert.strictEqual((await call(off, 'POST', `/api/seasons/${made.json.id}/photos`, { cookie: off.adminCookie, form: formOf(JPEG, 'image/jpeg') })).status, 503);
});

test('the pages: the gallery tab has the add button and the viewer of the match photos, in both languages', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const season = read('js/season.js');
  assert.ok(season.includes('id="sv-photo-add"') && season.includes('askPhotoSource()') && season.includes('openPhotoViewer(') && season.includes('loadSeasonPhotos(season.id'), 'season.js');
  assert.ok(read('season.html').includes('/js/match-photos.js'), 'season.html loads the photo code');
  const photos = read('js/match-photos.js');
  assert.ok(photos.includes('async function loadSeasonPhotos(') && photos.includes('/seasons/${seasonId}/photos'), 'the photo code serves the gallery');
  const i18n = read('js/i18n.js');
  assert.strictEqual((i18n.match(/'season\.galleryAdd':/g) || []).length, 2, 'the button text in both languages');
  for (const f of ['js/season.js', 'js/match-photos.js']) new (require('vm').Script)(read(f), { filename: f });
});

// ---------------------------------------------------------------- run
(async () => {
  let failed = 0;
  try {
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    servers.forEach((s) => s.child && s.child.kill());
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
