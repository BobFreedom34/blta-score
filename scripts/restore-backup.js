// Restores a backup of the app (the two files src/backup.js puts in the Google Drive folder every night) into a data folder:
//   blta-score-backup-<date>.db   the database
//   blta-score-files-<date>.zip   the photos and images that live on the disk next to it (optional)
//
// Run:  node scripts/restore-backup.js <backup.db> [files.zip] [--to <data folder>] [--force]
//       --to      where to restore (default: DATA_DIR from the environment, else ./data — the same folder the server uses)
//       --force   the folder already has a database: move it (and its -wal / -shm) aside as *.before-restore-<time> instead of stopping. Nothing is ever deleted.
// Stop the server first. The backup is checked before anything is touched (SQLite integrity check, the main tables, the zip's checksums), so a damaged or wrong
// file is refused and the folder stays as it was. Try it on an empty folder (--to) to see that a backup is good, without touching the real data.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const DB_NAME = 'blta-score.db';
const MUST_HAVE = ['players', 'matches', 'seasons'];

// every file of a zip as { name, data } — the central directory is read (archiver writes sizes there), each file is inflated and its checksum compared
function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip file (no end of directory)');
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const files = [];
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('the zip directory is damaged');
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const compressed = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`the zip entry ${name} is damaged`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`the zip entry ${name} uses an unknown compression (${method})`);
    if (data.length !== size || zlib.crc32(data) !== crc) throw new Error(`the zip entry ${name} does not match its checksum`);
    files.push({ name, data });
  }
  return files;
}

// the folder a zip entry goes to, or an error when it would leave the data folder (../ or an absolute path)
function safeTarget(dir, name) {
  const target = path.resolve(dir, name);
  if (path.isAbsolute(name) || (target !== path.resolve(dir) && !target.startsWith(path.resolve(dir) + path.sep))) throw new Error(`the zip has a file outside the data folder: ${name}`);
  return target;
}

function checkDatabase(file) {
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    const verdict = probe.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    if (verdict.length !== 1 || verdict[0] !== 'ok') throw new Error(`the database is damaged: ${verdict.slice(0, 3).join('; ')}`);
    const tables = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const missing = MUST_HAVE.filter((t) => !tables.has(t));
    if (missing.length) throw new Error(`this is not a backup of the app: no table ${missing.join(', ')}`);
    const count = (t) => probe.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return { players: count('players'), matches: count('matches'), seasons: count('seasons') };
  } finally {
    probe.close();
  }
}

// returns { counts, files, movedAside }
function restore({ dbFile, zipFile, dir, force = false }) {
  const counts = checkDatabase(dbFile);
  const entries = zipFile ? readZip(fs.readFileSync(zipFile)) : [];
  entries.forEach((e) => safeTarget(dir, e.name)); // all checked before the first write
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, DB_NAME);
  const movedAside = [];
  const present = [target, `${target}-wal`, `${target}-shm`].filter((f) => fs.existsSync(f));
  if (present.length && !force) throw new Error(`${target} already exists. Stop the server and run again with --force (the old database is kept next to it) or restore into another folder with --to.`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  present.forEach((f) => { const aside = `${f}.before-restore-${stamp}`; fs.renameSync(f, aside); movedAside.push(aside); });
  fs.copyFileSync(dbFile, target);
  entries.forEach((e) => {
    const out = safeTarget(dir, e.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.data);
  });
  return { counts, files: entries.length, movedAside };
}

module.exports = { restore, readZip, checkDatabase };

if (require.main === module) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const [, value] = args.splice(i, 2); return value; };
  const force = args.includes('--force');
  const to = take('--to');
  const [dbFile, zipFile] = args.filter((a) => !a.startsWith('--'));
  if (!dbFile) {
    console.error('Usage: node scripts/restore-backup.js <backup.db> [files.zip] [--to <data folder>] [--force]');
    process.exit(2);
  }
  const dir = path.resolve(to || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  try {
    const r = restore({ dbFile: path.resolve(dbFile), zipFile: zipFile && path.resolve(zipFile), dir, force });
    console.log(`Restored into ${dir}`);
    console.log(`  database: ${r.counts.players} players, ${r.counts.matches} matches, ${r.counts.seasons} seasons`);
    console.log(`  files:    ${r.files}${zipFile ? '' : ' (no zip given: the photos on the disk were not touched)'}`);
    r.movedAside.forEach((f) => console.log(`  kept the old one as ${f}`));
    console.log('Start the server again.');
  } catch (err) {
    console.error(`Not restored: ${err.message}`);
    process.exit(1);
  }
}
