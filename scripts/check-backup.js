// Checks of the Google Drive backup schedule (src/backup.js) against a fake Drive: one backup a day, nothing on a restart or a second check,
// only the missing file when half of the day's backup is there, nothing before the night slot, a failure e-mail at most once a day.
// Run: node scripts/check-backup.js   (no network, no real Drive; uses a temporary data directory)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-data-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test';
process.env.SESSION_SECRET = 'test';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = 'refresh';
process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID = 'folder1';

// no real Google login: the library hands out a fixed token
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'google-auth-library') {
    return { OAuth2Client: class { setCredentials() {} async getAccessToken() { return { token: 'token' }; } } };
  }
  return realLoad.call(this, request, ...rest);
};

// a photo on the "disk", so there is a files.zip to make
fs.mkdirSync(path.join(dataDir, 'winner-photos'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'winner-photos', 'a.jpg'), Buffer.alloc(2000, 7));

const backup = require('../src/backup');
const mailer = require('../src/mailer');
const mails = [];
mailer.sendBackupFailedEmail = async (err) => { mails.push(err.message); };

// the fake Drive: a list of files, answering the three calls the backup makes (list, upload, delete)
let drive = [];
let uploads = [];
let lookups = 0;
let failLookups = false;
let nextId = 1;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (method === 'POST' && u.includes('/upload/drive/v3/files')) {
    const body = Buffer.from(init.body).toString('latin1');
    const name = JSON.parse(body.match(/\{.*\}/)[0]).name;
    const file = { id: `f${nextId++}`, name, createdTime: new Date().toISOString() };
    drive.push(file);
    uploads.push(name);
    return json({ id: file.id, name });
  }
  if (method === 'DELETE') {
    const id = u.split('/').pop();
    drive = drive.filter((f) => f.id !== id);
    return json({});
  }
  if (method === 'GET' && u.includes('/drive/v3/files?')) {
    const q = decodeURIComponent(u.match(/[?&]q=([^&]*)/)[1]);
    if (q.includes("name contains 'blta-score-'")) return json({ files: drive });
    lookups += 1;
    if (failLookups) return json({ error: 'nope' }, 500);
    const wanted = [...q.matchAll(/name = '([^']+)'/g)].map((m) => m[1]);
    return json({ files: drive.filter((f) => wanted.includes(f.name)) });
  }
  throw new Error(`unexpected request: ${method} ${u}`);
};

const day = new Date().toISOString().slice(0, 10);
const dbName = `blta-score-backup-${day}.db`;
const zipName = `blta-score-files-${day}.zip`;
const night = new Date(`${day}T03:00:00Z`);
const evening = new Date(`${day}T20:00:00Z`);
const tooEarly = new Date(`${day}T00:20:00Z`);
const reset = () => { uploads = []; lookups = 0; };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('before the night slot nothing happens, not even a look at Drive', async () => {
  reset();
  const r = await backup.runScheduledBackup(tooEarly);
  assert.strictEqual(r.tooEarly, true);
  assert.deepStrictEqual([uploads.length, lookups], [0, 0]);
});

test('the first check of the day makes the backup: the database and the zip of the files', async () => {
  reset();
  const r = await backup.runScheduledBackup(night);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(uploads, [dbName, zipName]);
});

test('later checks, a restart or a deploy the same day upload nothing', async () => {
  reset();
  for (const t of [evening, night, evening]) {
    const r = await backup.runScheduledBackup(t);
    assert.strictEqual(r.alreadyDone, true, JSON.stringify(r));
  }
  assert.strictEqual(uploads.length, 0);
  assert.strictEqual(drive.filter((f) => f.name === dbName).length, 1, 'one database file of the day');
});

test('half a backup (the zip is missing) is completed: only the zip goes up', async () => {
  reset();
  drive = drive.filter((f) => f.name !== zipName);
  const r = await backup.runScheduledBackup(evening);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(uploads, [zipName]);
});

test('"Back up now" (force) always uploads both files', async () => {
  reset();
  const r = await backup.runBackup({ force: true });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(uploads, [dbName, zipName]);
});

test('without photos on the disk there is no zip to wait for', async () => {
  drive = [];
  reset();
  fs.rmSync(path.join(dataDir, 'winner-photos'), { recursive: true, force: true });
  assert.deepStrictEqual((await backup.runScheduledBackup(night)).ok, true);
  assert.deepStrictEqual(uploads, [dbName]);
  reset();
  assert.strictEqual((await backup.runScheduledBackup(evening)).alreadyDone, true);
  assert.strictEqual(uploads.length, 0);
});

test('a Drive that cannot be asked: no upload, and the failure e-mail goes out once for the day, not every hour', async () => {
  drive = [];
  reset();
  failLookups = true;
  for (let i = 0; i < 3; i += 1) {
    const r = await backup.runScheduledBackup(night);
    assert.strictEqual(r.ok, false);
  }
  failLookups = false;
  assert.strictEqual(uploads.length, 0, 'nothing is uploaded blindly');
  assert.strictEqual(mails.length, 1, `mails: ${mails.length}`);
  const again = await backup.runScheduledBackup(night); // Drive is back: the day gets its backup
  assert.strictEqual(again.ok, true);
  assert.deepStrictEqual(uploads, [dbName]); // (the photos were removed by the test above, so there is no zip)
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
