// Checks that a backup can really be put back (scripts/restore-backup.js): a server writes data, the backup files are made the way src/backup.js makes them
// (the database after a WAL checkpoint, a zip of the other files), they are restored into an empty folder, and a server started on that folder shows the same
// data and the same pictures. Also: a damaged database, a wrong file, a zip that reaches outside the folder and an existing database are all refused.
// Run: node scripts/check-restore.js   (starts its own servers on temporary folders; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const archiver = require('archiver');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { restore, readZip } = require('./restore-backup');

const ROOT = path.join(__dirname, '..');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `restore-${name}-`));
const dirs = [];
const folder = (name) => { const d = tmp(name); dirs.push(d); return d; };

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const children = [];
async function startServer(dataDir) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  return { child, base: `http://localhost:${port}` };
}
const stop = (child) => new Promise((resolve) => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000); });

function zipOf(entries) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    entries.forEach(({ name, data, store }) => archive.append(data, { name, store: !!store }));
    archive.finalize();
  });
}

const PHOTO = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201e221bc330000000049454e44ae426082', 'hex');
let source = '';
let backupDb = '';
let backupZip = null;

// ---------------------------------------------------------------- the backup
test('a running app is backed up the way the nightly backup does it', async () => {
  source = folder('source');
  const { child } = await startServer(source);
  const db = new DatabaseSync(path.join(source, 'blta-score.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare("INSERT INTO players (name, slug) VALUES ('Zálohovaný Hráč', 'zalohovany-hrac')").run();
  db.prepare("INSERT INTO seasons (name, slug) VALUES ('Záloha Cup', 'zaloha-cup')").run();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  backupDb = path.join(folder('backup'), 'blta-score-backup.db');
  fs.writeFileSync(backupDb, fs.readFileSync(path.join(source, 'blta-score.db')));
  db.close();
  await stop(child);
  fs.mkdirSync(path.join(source, 'badge-icons'), { recursive: true });
  backupZip = await zipOf([{ name: 'badge-icons/restored.png', data: PHOTO }, { name: 'carousel/slide one.png', data: PHOTO }]);
  assert.ok(fs.statSync(backupDb).size > 0);
});

// ---------------------------------------------------------------- the restore
test('the backup is restored into an empty folder and a server started on it shows the same data and pictures', async () => {
  const zipFile = path.join(path.dirname(backupDb), 'files.zip');
  fs.writeFileSync(zipFile, backupZip);
  const target = folder('target');
  const r = restore({ dbFile: backupDb, zipFile, dir: target });
  assert.strictEqual(r.files, 2);
  assert.strictEqual(r.counts.players, 1);
  assert.deepStrictEqual(fs.readFileSync(path.join(target, 'badge-icons', 'restored.png')), PHOTO);
  assert.deepStrictEqual(fs.readFileSync(path.join(target, 'carousel', 'slide one.png')), PHOTO);
  const { child, base } = await startServer(target);
  try {
    const players = await (await fetch(`${base}/api/players`)).json();
    assert.ok(players.some((p) => p.name === 'Zálohovaný Hráč'), 'the player is not in the restored app');
    const seasons = await (await fetch(`${base}/api/seasons`)).json();
    assert.ok(seasons.some((s) => s.slug === 'zaloha-cup'), 'the season is not in the restored app');
    const picture = await fetch(`${base}/badge-icons/restored.png`);
    assert.strictEqual(picture.status, 200);
    assert.deepStrictEqual(Buffer.from(await picture.arrayBuffer()), PHOTO);
  } finally {
    await stop(child);
  }
});

test('the database alone can be restored (the photos on the disk stay as they are)', () => {
  const target = folder('dbonly');
  fs.mkdirSync(path.join(target, 'badge-icons'));
  fs.writeFileSync(path.join(target, 'badge-icons', 'keep.png'), PHOTO);
  const r = restore({ dbFile: backupDb, dir: target });
  assert.strictEqual(r.files, 0);
  assert.ok(fs.existsSync(path.join(target, 'badge-icons', 'keep.png')));
  assert.ok(fs.existsSync(path.join(target, 'blta-score.db')));
});

test('a folder that has a database is not overwritten; with force the old one is kept next to it', () => {
  const target = folder('existing');
  fs.writeFileSync(path.join(target, 'blta-score.db'), 'the old database');
  fs.writeFileSync(path.join(target, 'blta-score.db-wal'), 'old wal');
  assert.throws(() => restore({ dbFile: backupDb, dir: target }), /already exists/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'blta-score.db'), 'utf8'), 'the old database');
  const r = restore({ dbFile: backupDb, dir: target, force: true });
  assert.strictEqual(r.movedAside.length, 2);
  r.movedAside.forEach((f) => assert.ok(fs.existsSync(f), `${f} is gone`));
  assert.strictEqual(fs.readFileSync(r.movedAside.find((f) => f.includes('.db.before')), 'utf8'), 'the old database');
  assert.ok(!fs.existsSync(path.join(target, 'blta-score.db-wal')), 'the old wal file is still in place');
  const check = new DatabaseSync(path.join(target, 'blta-score.db'), { readOnly: true });
  assert.strictEqual(check.prepare('SELECT COUNT(*) AS n FROM players').get().n, 1);
  check.close();
});

// ---------------------------------------------------------------- what is refused (and nothing is touched)
test('a damaged database, a file that is not a database and a database of something else are refused', () => {
  const target = folder('refused');
  const damaged = path.join(folder('bad'), 'damaged.db');
  const bytes = fs.readFileSync(backupDb);
  fs.writeFileSync(damaged, Buffer.concat([bytes.subarray(0, 4096), Buffer.alloc(8192, 7), bytes.subarray(12288)]));
  assert.throws(() => restore({ dbFile: damaged, dir: target }));
  const text = path.join(path.dirname(damaged), 'not-a-database.db');
  fs.writeFileSync(text, 'hello, I am not a database at all');
  assert.throws(() => restore({ dbFile: text, dir: target }));
  const other = path.join(path.dirname(damaged), 'other.db');
  const o = new DatabaseSync(other);
  o.exec('CREATE TABLE cats (name TEXT)');
  o.close();
  assert.throws(() => restore({ dbFile: other, dir: target }), /not a backup of the app/);
  assert.throws(() => restore({ dbFile: path.join(target, 'missing.db'), dir: target }), /no such file/);
  assert.ok(!fs.existsSync(path.join(target, 'blta-score.db')), 'a refused backup left a database behind');
});

test('a zip that reaches outside the data folder, or whose checksum does not match, is refused before anything is written', async () => {
  const target = folder('evilzip');
  const outside = path.join(path.dirname(target), 'e.txt');
  const good = await zipOf([{ name: 'AAAAAAAAAA', data: Buffer.from('evil') }]);
  const evil = Buffer.from(good.toString('latin1').split('AAAAAAAAAA').join('../' + 'b/e.txt'.slice(0, 7)), 'latin1');
  assert.strictEqual(evil.length, good.length);
  const zipFile = path.join(folder('zips'), 'evil.zip');
  fs.writeFileSync(zipFile, evil);
  assert.throws(() => restore({ dbFile: backupDb, zipFile, dir: target }), /outside the data folder/);
  assert.ok(!fs.existsSync(path.join(target, 'blta-score.db')), 'the database was written although the zip was refused');
  assert.ok(!fs.existsSync(outside));
  // a changed byte in the file data
  const intact = await zipOf([{ name: 'a/b.txt', data: Buffer.from('some photo bytes, long enough to be stored'), store: true }]);
  const flipped = Buffer.from(intact);
  const at = flipped.indexOf(Buffer.from('some photo'));
  assert.ok(at > 0, 'the test zip does not hold the bytes as they are');
  flipped[at] ^= 0xff;
  assert.throws(() => readZip(flipped));
  assert.throws(() => readZip(Buffer.from('not a zip')), /not a zip/);
});

test('the command line restores, and says no when it must', () => {
  const { spawnSync } = require('child_process');
  const target = folder('cli');
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'restore-backup.js'), ...args], { encoding: 'utf8' });
  let r = run(backupDb, '--to', target);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/1 players/.test(r.stdout), r.stdout);
  r = run(backupDb, '--to', target);
  assert.strictEqual(r.status, 1);
  assert.ok(/already exists/.test(r.stderr), r.stderr);
  assert.strictEqual(run().status, 2);
});

async function main() {
  let failed = 0;
  try {
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } finally {
    children.forEach((c) => c.kill());
    await new Promise((r) => setTimeout(r, 500));
    dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
