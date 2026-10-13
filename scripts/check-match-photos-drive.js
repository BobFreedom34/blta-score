// Checks of the Google Drive client for match photos (src/drivePhotos.js) against a fake Drive: an upload goes into the photos folder and
// is then made readable by link, a failed permission call leaves no orphan file behind, a delete revokes the link before removing the
// file and never throws, and the image URLs come from one template that an env var can override.
// Run: node scripts/check-match-photos-drive.js   (no network, no real Drive; uses a temporary data directory)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-photos-drive-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test';
process.env.SESSION_SECRET = 'test';
// deliberately none of the Google variables yet: isConfigured() is tested while they come in one by one
for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_DRIVE_PHOTOS_FOLDER_ID', 'PHOTO_IMAGE_URL_TEMPLATE']) delete process.env[k];

// no real Google login: the library hands out a fixed token
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'google-auth-library') {
    return { OAuth2Client: class { setCredentials() {} async getAccessToken() { return { token: 'token' }; } } };
  }
  return realLoad.call(this, request, ...rest);
};

const photos = require('../src/drivePhotos');

// the fake Drive: records every call, and fails the ones a test asks it to
let calls = [];
let failPermissions = false;
let failDeletes = false;
let throwOnFetch = false;
let nextId = 1;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (throwOnFetch) throw new Error('network down');
  const call = { method, url: u, auth: init.headers && init.headers.Authorization };
  calls.push(call);
  if (method === 'POST' && u.includes('/upload/drive/v3/files')) {
    const body = Buffer.from(init.body).toString('latin1');
    call.metadata = JSON.parse(body.match(/\{.*\}/)[0]);
    call.body = body;
    return json({ id: `p${nextId++}`, name: call.metadata.name });
  }
  if (method === 'POST' && /\/drive\/v3\/files\/[^/]+\/permissions/.test(u)) {
    call.permission = JSON.parse(init.body);
    return failPermissions ? json({ error: 'nope' }, 403) : json({ id: 'anyoneWithLink' });
  }
  if (method === 'DELETE') return failDeletes ? json({ error: 'nope' }, 500) : json({});
  throw new Error(`unexpected request: ${method} ${u}`);
};

const reset = () => { calls = []; failPermissions = false; failDeletes = false; throwOnFetch = false; };
const summary = () => calls.map((c) => `${c.method} ${c.url.replace('https://www.googleapis.com', '').split('?')[0]}`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('isConfigured is false until the OAuth settings and the photos folder are all set', () => {
  assert.strictEqual(photos.isConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
  assert.strictEqual(photos.isConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
  assert.strictEqual(photos.isConfigured(), false);
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN = 'refresh';
  assert.strictEqual(photos.isConfigured(), false, 'the backup folder alone is not enough: photos have their own');
  process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID = 'folder1';
  assert.strictEqual(photos.isConfigured(), false, 'the backup folder alone is not enough: photos have their own');
  process.env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID = 'photos1';
  assert.strictEqual(photos.isConfigured(), true);
});

test('uploadPhoto puts the file into the photos folder, then makes it readable by anyone with the link', async () => {
  reset();
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  const r = await photos.uploadPhoto(bytes, 'image/jpeg', 'match-7.jpg');
  assert.deepStrictEqual(r, { id: 'p1' });
  assert.strictEqual(calls.length, 2, summary().join(' | '));
  assert.ok(calls[0].url.includes('/upload/drive/v3/files'), calls[0].url);
  assert.deepStrictEqual(calls[0].metadata, { name: 'match-7.jpg', parents: ['photos1'] });
  assert.ok(calls[0].body.includes('Content-Type: image/jpeg'), 'the bytes go up with their own type');
  assert.strictEqual(calls[0].auth, 'Bearer token');
  assert.strictEqual(calls[1].method, 'POST');
  assert.ok(calls[1].url.includes('/drive/v3/files/p1/permissions'), calls[1].url);
  assert.deepStrictEqual(calls[1].permission, { type: 'anyone', role: 'reader' });
});

test('a failing permission call deletes the uploaded file again and rejects', async () => {
  reset();
  failPermissions = true;
  await assert.rejects(() => photos.uploadPhoto(Buffer.from('x'), 'image/png', 'a.png'));
  const del = calls.filter((c) => c.method === 'DELETE');
  assert.strictEqual(del.length, 1, summary().join(' | '));
  assert.ok(del[0].url.endsWith(`/drive/v3/files/p${nextId - 1}`), del[0].url);
});

test('deletePhoto revokes the public link first, then deletes the file, and returns true', async () => {
  reset();
  assert.strictEqual(await photos.deletePhoto('abc'), true);
  assert.strictEqual(calls.length, 2, summary().join(' | '));
  assert.strictEqual(calls[0].method, 'DELETE');
  assert.ok(calls[0].url.includes('/drive/v3/files/abc/permissions/anyoneWithLink'), calls[0].url);
  assert.strictEqual(calls[1].method, 'DELETE');
  assert.ok(calls[1].url.endsWith('/drive/v3/files/abc'), calls[1].url);
});

test('deletePhoto never throws: a failing Drive call (or no network) gives false', async () => {
  reset();
  failDeletes = true;
  assert.strictEqual(await photos.deletePhoto('abc'), false);
  reset();
  throwOnFetch = true;
  assert.strictEqual(await photos.deletePhoto('abc'), false);
});

test('imageUrl and thumbUrl come from one template that PHOTO_IMAGE_URL_TEMPLATE can replace', () => {
  const big = photos.imageUrl('abc');
  assert.ok(big.includes('abc') && big.includes('w1600'), big);
  assert.ok(photos.imageUrl('abc', 800).includes('w800'));
  const thumb = photos.thumbUrl('abc');
  assert.ok(thumb.includes('abc') && !thumb.includes('w1600'), thumb);
  process.env.PHOTO_IMAGE_URL_TEMPLATE = 'https://img.example/{id}/w{width}.jpg';
  assert.strictEqual(photos.imageUrl('abc'), 'https://img.example/abc/w1600.jpg');
  assert.strictEqual(photos.imageUrl('abc', 400), 'https://img.example/abc/w400.jpg');
  assert.ok(photos.thumbUrl('abc').startsWith('https://img.example/abc/w'));
  delete process.env.PHOTO_IMAGE_URL_TEMPLATE;
});

test('the two photo tables exist with their indexes', () => {
  const db = require('../src/db');
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepStrictEqual(cols('match_photos'), ['id', 'match_id', 'drive_file_id', 'uploaded_by_player_id', 'created_at']);
  assert.deepStrictEqual(cols('photo_notifications'), ['id', 'player_id', 'match_id', 'photo_id', 'seen', 'created_at']);
  const idx = (t) => db.prepare(`PRAGMA index_list(${t})`).all().map((i) => i.name);
  assert.ok(idx('match_photos').includes('idx_match_photos_match'));
  assert.ok(idx('photo_notifications').includes('idx_photo_notifications_player'));
  const r = db.prepare('INSERT INTO match_photos (match_id, drive_file_id) VALUES (1, ?)').run('f');
  const row = db.prepare('SELECT * FROM match_photos WHERE id = ?').get(r.lastInsertRowid);
  assert.strictEqual(row.uploaded_by_player_id, null);
  assert.ok(/^\d{4}-\d\d-\d\dT/.test(row.created_at), row.created_at);
});

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
  }
  try { require('../src/db').close && require('../src/db').close(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 200));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* the database may still be open on Windows */ }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
