// Checks of the match photos routes: GET / POST / DELETE /api/matches/:token/photos, who may add and remove, the limit of 5, the notification
// rows, the checks of the file itself, a failing Drive, and the clean-up when a match is deleted. The server runs against a fake Google Drive
// (scripts/lib/fake-drive-preload.js) that logs every call it gets, so what was sent to Drive (and in which order) can be checked too.
// Run: node scripts/check-match-photos.js   (starts its own servers on temporary data directories; no network, no real Drive)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cookieSignature = require('cookie-signature');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'lib', 'fake-drive-preload.js').split(path.sep).join('/');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const servers = [];

// ---- servers ----
async function startServer(name, { configured }) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const srv = { base: `http://localhost:${port}`, dir, logFile: path.join(dir, 'drive.log'), failFile: path.join(dir, 'drive.fail'), adminCookie: '', child: null };
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
  for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
  if (configured) {
    Object.assign(env, {
      GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_PHOTOS_FOLDER_ID: 'photos-folder',
      NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --require "${PRELOAD}"`, FAKE_DRIVE_LOG: srv.logFile, FAKE_DRIVE_FAIL: srv.failFile,
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

const signed = (name, value) => `${name}=${encodeURIComponent(`s:${cookieSignature.sign(String(value), 'test')}`)}`;
const playerCookie = (id) => signed('blta_player', id);
const refereeCookie = signed('blta_referee', 'ok');

async function call(srv, method, url, { body, form, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(srv.base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

// ---- pictures ----
const JPEG = (extra = 16) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(extra, 1), Buffer.from([0xff, 0xd9])]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(16, 3)]);
const photoForm = (buf, type = 'image/jpeg', field = 'photo', filename = 'photo.jpg') => {
  const form = new FormData();
  form.append(field, new Blob([buf], { type }), filename);
  return form;
};
const upload = (srv, token, cookie, buf = JPEG(), type = 'image/jpeg') => call(srv, 'POST', `/api/matches/${token}/photos`, { form: photoForm(buf, type), cookie });

// ---- the fake Drive's log and the database of a server ----
const driveLog = (srv) => (fs.existsSync(srv.logFile) ? fs.readFileSync(srv.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const liveDriveFiles = (srv) => {
  const log = driveLog(srv);
  const deleted = new Set(log.filter((e) => e.op === 'fileDelete').map((e) => e.id));
  return log.filter((e) => e.op === 'upload' && !deleted.has(e.id)).map((e) => e.id);
};
function sql(srv, query, ...params) {
  const d = new DatabaseSync(path.join(srv.dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
}
const matchId = (srv, token) => sql(srv, 'SELECT id FROM matches WHERE share_token = ?', token)[0].id;
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return fn();
}

// ---- state shared by the tests ----
let off; let on; // the server without Drive settings, the server with
let p1; let p2; let p3; // players: the two in the match and an outsider
let t1; // the main match
let c1; let c2; let c3; let adm; // cookies
const newMatch = async (srv, a, b) => {
  const made = await call(srv, 'POST', '/api/matches', { cookie: srv.adminCookie, body: { category: 'FRIENDLY', player1Id: a.id, player2Id: b.id, format: 'BO3_STB', location: 'Inter', scheduledAt: '2026-10-11T08:30:00.000Z' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  return made.json.token;
};

test('a server without Drive settings: GET says the feature is off, POST answers 503', async () => {
  const pa = (await call(off, 'POST', '/api/players', { cookie: off.adminCookie, body: { name: 'Off A' } })).json;
  const pb = (await call(off, 'POST', '/api/players', { cookie: off.adminCookie, body: { name: 'Off B' } })).json;
  const token = await newMatch(off, pa, pb);
  const got = await call(off, 'GET', `/api/matches/${token}/photos`, { cookie: off.adminCookie });
  assert.strictEqual(got.status, 200, got.text);
  assert.deepStrictEqual([got.json.enabled, got.json.canAdd, got.json.max, got.json.photos], [false, false, 5, []]);
  const posted = await upload(off, token, off.adminCookie);
  assert.strictEqual(posted.status, 503, posted.text);
  assert.strictEqual((await call(off, 'GET', '/api/matches/nope/photos')).status, 404, 'unknown match');
});

test('a logged-out visitor can look (enabled, nothing to add), but cannot add; an unknown match is 404', async () => {
  const a = await call(on, 'POST', '/api/players', { cookie: on.adminCookie, body: { name: 'Tomáš Paulen' } });
  p1 = a.json;
  p2 = (await call(on, 'POST', '/api/players', { cookie: on.adminCookie, body: { name: 'Peter Laučík' } })).json;
  p3 = (await call(on, 'POST', '/api/players', { cookie: on.adminCookie, body: { name: 'Outsider Olo' } })).json;
  [c1, c2, c3, adm] = [playerCookie(p1.id), playerCookie(p2.id), playerCookie(p3.id), on.adminCookie];
  t1 = await newMatch(on, p1, p2);
  const got = await call(on, 'GET', `/api/matches/${t1}/photos`);
  assert.strictEqual(got.status, 200, got.text);
  assert.deepStrictEqual([got.json.enabled, got.json.canAdd, got.json.max, got.json.photos], [true, false, 5, []]);
  const posted = await upload(on, t1, '');
  assert.ok([401, 403].includes(posted.status), `visitor: ${posted.status}`);
  assert.strictEqual((await call(on, 'GET', '/api/matches/nope/photos')).status, 404);
  assert.strictEqual((await upload(on, 'nope', c1)).status, 404);
  assert.strictEqual(driveLog(on).length, 0, 'nothing reached Drive');
});

test('a player who is not in the match, and a referee, get 403', async () => {
  for (const [who, cookie] of [['outsider player', c3], ['referee', refereeCookie]]) {
    const r = await upload(on, t1, cookie);
    assert.strictEqual(r.status, 403, `${who}: ${r.status} ${r.text}`);
    const got = await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie });
    assert.strictEqual(got.json.canAdd, false, `${who} cannot add`);
  }
  assert.strictEqual(driveLog(on).length, 0, 'nothing reached Drive');
});

let firstPhoto;
test('player 1 adds a JPEG: 201, shown in the list, only they (and the admin) can remove it; the Drive file is made readable', async () => {
  const r = await upload(on, t1, c1);
  assert.strictEqual(r.status, 201, r.text);
  firstPhoto = r.json;
  assert.deepStrictEqual(Object.keys(firstPhoto).sort(), ['addedBy', 'canRemove', 'createdAt', 'id', 'thumbUrl', 'url']);
  assert.strictEqual(firstPhoto.addedBy, 'Tomáš Paulen');
  assert.strictEqual(firstPhoto.canRemove, true);
  assert.ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=fake\d+&sz=w1600$/.test(firstPhoto.url), firstPhoto.url);
  assert.ok(firstPhoto.thumbUrl.endsWith('&sz=w400'), firstPhoto.thumbUrl);
  const log = driveLog(on);
  assert.deepStrictEqual(log.map((e) => e.op), ['upload', 'permCreate']);
  assert.strictEqual(log[0].mime, 'image/jpeg');
  assert.strictEqual(log[0].size, JPEG().length);

  const mine = (await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie: c1 })).json;
  assert.deepStrictEqual([mine.canAdd, mine.photos.length, mine.photos[0].id, mine.photos[0].canRemove], [true, 1, firstPhoto.id, true]);
  const theirs = (await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie: c2 })).json;
  assert.deepStrictEqual([theirs.canAdd, theirs.photos[0].canRemove, theirs.photos[0].addedBy], [true, false, 'Tomáš Paulen']);
  const visitor = (await call(on, 'GET', `/api/matches/${t1}/photos`)).json;
  assert.deepStrictEqual([visitor.canAdd, visitor.photos[0].canRemove], [false, false]);
  const asAdmin = (await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie: adm })).json;
  assert.deepStrictEqual([asAdmin.canAdd, asAdmin.photos[0].canRemove], [true, true]);
});

test('PNG and WebP are accepted too', async () => {
  const t = await newMatch(on, p1, p2);
  assert.strictEqual((await upload(on, t, c1, PNG(), 'image/png')).status, 201);
  assert.strictEqual((await upload(on, t, c1, WEBP(), 'image/webp')).status, 201);
  const mimes = driveLog(on).filter((e) => e.op === 'upload').slice(-2).map((e) => e.mime);
  assert.deepStrictEqual(mimes, ['image/png', 'image/webp']);
});

test('the other player gets a notification row for the photo, the uploader does not', async () => {
  const rows = sql(on, 'SELECT * FROM photo_notifications WHERE match_id = ?', matchId(on, t1));
  assert.deepStrictEqual(rows.map((r) => [r.player_id, r.photo_id, r.seen]), [[p2.id, firstPhoto.id, 0]]);
});

test('an admin upload shows addedBy null and notifies both players', async () => {
  const r = await upload(on, t1, adm);
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.addedBy, null);
  assert.strictEqual(r.json.canRemove, true);
  const rows = sql(on, 'SELECT player_id FROM photo_notifications WHERE photo_id = ? ORDER BY player_id', r.json.id);
  assert.deepStrictEqual(rows.map((x) => x.player_id).sort(), [p1.id, p2.id].sort());
  const other = (await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie: c1 })).json;
  assert.deepStrictEqual(other.photos.map((p) => p.addedBy), ['Tomáš Paulen', null], 'oldest first');
  assert.strictEqual(other.photos[1].canRemove, false, 'a player cannot remove the admin\'s photo');
});

test('at most 5 per match: the 6th is refused with 409 before anything goes to Drive', async () => {
  for (let i = 0; i < 3; i += 1) assert.strictEqual((await upload(on, t1, i % 2 ? c1 : c2)).status, 201, `photo ${i + 3}`);
  const full = (await call(on, 'GET', `/api/matches/${t1}/photos`, { cookie: c1 })).json;
  assert.deepStrictEqual([full.photos.length, full.canAdd], [5, false]);
  const before = driveLog(on).length;
  for (const cookie of [c1, c2, adm]) assert.strictEqual((await upload(on, t1, cookie)).status, 409);
  assert.strictEqual(driveLog(on).length, before, 'no upload for a refused photo');
});

test('two simultaneous uploads with 4 existing: one is 201, one 409, and the loser\'s Drive file is deleted again', async () => {
  const t = await newMatch(on, p1, p2);
  for (let i = 0; i < 4; i += 1) assert.strictEqual((await upload(on, t, adm)).status, 201);
  const [a, b] = await Promise.all([upload(on, t, c1), upload(on, t, c2)]);
  assert.deepStrictEqual([a.status, b.status].sort(), [201, 409], `${a.status} ${a.text} / ${b.status} ${b.text}`);
  const rows = sql(on, 'SELECT drive_file_id FROM match_photos WHERE match_id = ?', matchId(on, t));
  assert.strictEqual(rows.length, 5);
  const live = liveDriveFiles(on);
  for (const r of rows) assert.ok(live.includes(r.drive_file_id), `${r.drive_file_id} is in Drive`);
  const loserFiles = driveLog(on).filter((e) => e.op === 'fileDelete').map((e) => e.id);
  assert.strictEqual(loserFiles.length, 1, 'exactly one file was deleted again');
  assert.ok(!rows.some((r) => r.drive_file_id === loserFiles[0]), 'and it is not one the database keeps');
});

test('a text file, a fake image, an empty file, a missing file and an 11 MB file are all 400 and never reach Drive', async () => {
  const t = await newMatch(on, p1, p2);
  const before = driveLog(on).length;
  const cases = [
    ['text file', () => upload(on, t, c1, Buffer.from('hello, not a picture'), 'text/plain')],
    ['text under an image type', () => upload(on, t, c1, Buffer.from('hello, not a picture'), 'image/jpeg')],
    ['a PNG that says it is a JPEG', () => upload(on, t, c1, PNG(), 'image/jpeg')],
    ['gif', () => upload(on, t, c1, Buffer.from('GIF89a......'), 'image/gif')],
    ['empty file', () => upload(on, t, c1, Buffer.alloc(0), 'image/jpeg')],
    ['no file', () => call(on, 'POST', `/api/matches/${t}/photos`, { form: photoForm(JPEG(), 'image/jpeg', 'other'), cookie: c1 })],
    ['11 MB file', () => upload(on, t, c1, JPEG(11 * 1024 * 1024), 'image/jpeg')],
  ];
  for (const [what, run] of cases) {
    const r = await run();
    assert.strictEqual(r.status, 400, `${what}: ${r.status} ${r.text}`);
    assert.ok(r.json && typeof r.json.error === 'string', `${what}: the answer is JSON { error }`);
  }
  assert.strictEqual(driveLog(on).length, before, 'no Drive call at all');
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM match_photos WHERE match_id = ?', matchId(on, t))[0].n, 0);
  assert.strictEqual((await upload(on, t, c1, JPEG(9 * 1024 * 1024))).status, 201, 'but 9 MB is fine');
});

test('a failing Drive: 502, no row, no notification', async () => {
  const t = await newMatch(on, p1, p2);
  fs.writeFileSync(on.failFile, 'fail');
  try {
    const r = await upload(on, t, c1);
    assert.strictEqual(r.status, 502, r.text);
    assert.ok(r.json && r.json.error);
  } finally { fs.rmSync(on.failFile, { force: true }); }
  const id = matchId(on, t);
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM match_photos WHERE match_id = ?', id)[0].n, 0);
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM photo_notifications WHERE match_id = ?', id)[0].n, 0);
  assert.strictEqual((await upload(on, t, c1)).status, 201, 'and it works again once Drive does');
});

test('removing: the other player and a visitor get 403, a photo of another match 404; the uploader\'s delete is 204, the link is revoked before the file is deleted', async () => {
  const photos = (await call(on, 'GET', `/api/matches/${t1}/photos`)).json.photos;
  const target = photos[0]; // player 1's
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${target.id}`, { cookie: c2 })).status, 403);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${target.id}`)).status, 403);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${target.id}`, { cookie: refereeCookie })).status, 403);
  const other = await newMatch(on, p1, p2);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${other}/photos/${target.id}`, { cookie: adm })).status, 404, 'not on that match');
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/99999`, { cookie: adm })).status, 404);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/abc`, { cookie: adm })).status, 404);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/nope/photos/${target.id}`, { cookie: adm })).status, 404);
  assert.strictEqual((await call(on, 'GET', `/api/matches/${t1}/photos`)).json.photos.length, 5, 'still all there');

  const fileId = sql(on, 'SELECT drive_file_id FROM match_photos WHERE id = ?', target.id)[0].drive_file_id;
  const mark = driveLog(on).length;
  const r = await call(on, 'DELETE', `/api/matches/${t1}/photos/${target.id}`, { cookie: c1 });
  assert.strictEqual(r.status, 204, r.text);
  const ops = driveLog(on).slice(mark).filter((e) => e.id === fileId).map((e) => e.op);
  assert.deepStrictEqual(ops, ['permDelete', 'fileDelete']);
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM match_photos WHERE id = ?', target.id)[0].n, 0);
  assert.strictEqual((await call(on, 'GET', `/api/matches/${t1}/photos`)).json.photos.length, 4);
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${target.id}`, { cookie: c1 })).status, 404, 'already gone');
});

test('the admin can remove anyone\'s photo; the row goes even if Drive fails', async () => {
  const photos = (await call(on, 'GET', `/api/matches/${t1}/photos`)).json.photos;
  const adminOne = photos.find((p) => p.addedBy === null);
  const fileId = sql(on, 'SELECT drive_file_id FROM match_photos WHERE id = ?', adminOne.id)[0].drive_file_id;
  const mark = driveLog(on).length;
  assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${adminOne.id}`, { cookie: adm })).status, 204);
  assert.deepStrictEqual(driveLog(on).slice(mark).filter((e) => e.id === fileId).map((e) => e.op), ['permDelete', 'fileDelete']);

  const next = (await call(on, 'GET', `/api/matches/${t1}/photos`)).json.photos[0];
  fs.writeFileSync(on.failFile, 'fail');
  try {
    assert.strictEqual((await call(on, 'DELETE', `/api/matches/${t1}/photos/${next.id}`, { cookie: adm })).status, 204, 'Drive down: still removed');
  } finally { fs.rmSync(on.failFile, { force: true }); }
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM match_photos WHERE id = ?', next.id)[0].n, 0);
});

test('deleting the match removes its photo rows and notifications and deletes the files in Drive', async () => {
  const id = matchId(on, t1);
  const files = sql(on, 'SELECT drive_file_id FROM match_photos WHERE match_id = ?', id).map((r) => r.drive_file_id);
  assert.ok(files.length >= 2, `${files.length} photos left`);
  assert.ok(sql(on, 'SELECT COUNT(*) AS n FROM photo_notifications WHERE match_id = ?', id)[0].n > 0, 'there are notifications');
  const mark = driveLog(on).length;
  const r = await call(on, 'DELETE', `/api/matches/${t1}`, { cookie: adm });
  assert.strictEqual(r.status, 204, r.text);
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM match_photos WHERE match_id = ?', id)[0].n, 0);
  assert.strictEqual(sql(on, 'SELECT COUNT(*) AS n FROM photo_notifications WHERE match_id = ?', id)[0].n, 0);
  const gone = () => { const del = driveLog(on).slice(mark).filter((e) => e.op === 'fileDelete').map((e) => e.id); return files.every((f) => del.includes(f)); };
  assert.ok(await waitFor(gone), 'every file got a Drive delete');
  assert.strictEqual((await call(on, 'GET', `/api/matches/${t1}/photos`)).status, 404);
});

async function main() {
  let failed = 0;
  try {
    off = await startServer('off', { configured: false });
    on = await startServer('on', { configured: true });
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    for (const s of servers) if (s.child) s.child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
