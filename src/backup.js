// Nightly backup of the production database, uploaded badge icons, and a
// snapshot of the codebase itself, zipped and uploaded to a Google Drive
// folder. The database and badge icons never touch git (see .gitignore) —
// git already fully covers the code on its own, but the "also zip up the
// code" option was chosen explicitly so this backup is a single
// self-contained artifact that doesn't depend on GitHub at all.
//
// No-ops entirely (see isConfigured) if GOOGLE_SERVICE_ACCOUNT_JSON /
// GOOGLE_DRIVE_BACKUP_FOLDER_ID aren't set — same "optional integration,
// silently disabled without its env vars" pattern mailer.js/push.js use.
// See .env.example for how to obtain both.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const archiver = require('archiver');
const { DatabaseSync } = require('node:sqlite');
const { google } = require('googleapis');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const REPO_ROOT = path.join(__dirname, '..');
// How many nightly backups to keep in the Drive folder before pruning the
// oldest — keeps the folder from growing forever. ~3 weeks of nightlies.
const RETENTION_COUNT = 21;
// UTC hour the nightly run targets — the exact time doesn't matter much,
// just picked to land in a low-traffic window for a Central-European league.
const BACKUP_HOUR_UTC = 3;

function isConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
}

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    // drive.file (not the broader drive.readonly/drive scope) — this app
    // only ever needs to create/list/delete files it created itself inside
    // the one folder it's been shared into, not read the rest of the
    // account's Drive.
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

// A clean, self-contained copy of the live database — the live .db file
// alone isn't safe to just copy while the server keeps writing to it (WAL
// mode). VACUUM INTO produces a consistent single-file snapshot instead,
// same idea as the manual backup steps this replaces (see the README).
function snapshotDatabase(destPath) {
  const db = new DatabaseSync(path.join(DATA_DIR, 'blta-score.db'), { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

// A manual recursive walk rather than archiver's own directory(dirpath,
// destpath, filterFn) — that filter looked like it should work (returning
// false from it is documented to skip the entry, and archiver's own source
// does check for exactly that), but a real test here showed a file it
// computed excluded:true for still landing in the finished zip anyway.
// Given .env (every secret this app has, including these Google
// credentials themselves) is exactly what this is excluding, that's not a
// risk worth taking on a mechanism that didn't behave as documented —
// walking and calling archive.file() only for paths this function itself
// approved is fully self-contained and easy to verify. Whole directories
// in `skip` are pruned outright (never descended into) rather than merely
// filtered per-file, which also avoids ever walking node_modules.
function addDirToArchive(archive, dirPath, archiveName, skip = []) {
  if (!fs.existsSync(dirPath)) return;
  const walk = (absDir, relDir) => {
    for (const name of fs.readdirSync(absDir)) {
      const rel = relDir ? `${relDir}/${name}` : name;
      if (skip.includes(rel)) continue;
      const abs = path.join(absDir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs, rel);
      else if (stat.isFile()) archive.file(abs, { name: `${archiveName}/${rel}` });
    }
  };
  walk(dirPath, '');
}

async function buildBackupZip() {
  const stamp = new Date().toISOString().slice(0, 10);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blta-backup-'));
  const dbSnapshotPath = path.join(tmpDir, 'blta-score.db');
  snapshotDatabase(dbSnapshotPath);

  const zipName = `blta-score-backup-${stamp}.zip`;
  const zipPath = path.join(tmpDir, zipName);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(dbSnapshotPath, { name: 'database/blta-score.db' });
    addDirToArchive(archive, path.join(DATA_DIR, 'badge-icons'), 'badge-icons');
    // .env excluded deliberately — it (or the platform equivalent) is
    // where every secret this app has lives, including the very Google
    // credentials this backup runs with. Everything else here is already
    // in git and has nothing sensitive on its own.
    addDirToArchive(archive, REPO_ROOT, 'code', ['node_modules', '.git', 'data', '.env', '.claude']);
    archive.finalize();
  });
  return { zipPath, zipName, tmpDir, stamp };
}

async function uploadToGoogleDrive(zipPath, zipName) {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  // Read fully into memory rather than handing googleapis a
  // fs.createReadStream tied to zipPath — that file lives in a tmpDir
  // runBackup's finally block deletes the moment this function settles
  // either way, and a lazily-opened read stream racing that cleanup (e.g.
  // if auth fails before the upload ever touches the stream) throws an
  // unhandled 'error' event nothing here is in a position to catch. A
  // backup zip is small enough that buffering it isn't a real cost, and it
  // makes upload fully independent of tmpDir's lifecycle.
  const buffer = fs.readFileSync(zipPath);
  await drive.files.create({
    requestBody: { name: zipName, parents: [folderId] },
    media: { mimeType: 'application/zip', body: Readable.from(buffer) },
  });

  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });
  const stale = (data.files || []).slice(RETENTION_COUNT);
  for (const file of stale) {
    // Best-effort — one failed delete (e.g. a transient API error)
    // shouldn't fail the backup that just succeeded above it.
    // eslint-disable-next-line no-await-in-loop
    await drive.files.delete({ fileId: file.id }).catch(() => {});
  }
}

// Builds and uploads one backup right now, regardless of the nightly
// schedule below — used by both that schedule and the admin-only
// POST /api/admin/backup-now route for on-demand testing.
async function runBackup() {
  if (!isConfigured()) return { skipped: true };
  const { zipPath, zipName, tmpDir, stamp } = await buildBackupZip();
  try {
    await uploadToGoogleDrive(zipPath, zipName);
    return { skipped: false, stamp };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Runs once at the next occurrence of BACKUP_HOUR_UTC:00, then every 24h
// after that — a plain setTimeout/setInterval pair rather than pulling in
// a cron library for what's just "once a day at a fixed time". Call once
// at server startup (see server.js); a no-op if the feature isn't
// configured, logged once so it's clear from the server logs why nothing's
// showing up in Drive rather than silently never running.
function scheduleNightlyBackup() {
  if (!isConfigured()) {
    console.log('[backup] GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_DRIVE_BACKUP_FOLDER_ID not set — nightly backup disabled');
    return;
  }
  const msUntilNextRun = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), BACKUP_HOUR_UTC, 0, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  };
  const runAndReschedule = async () => {
    try {
      const result = await runBackup();
      console.log(`[backup] nightly backup ${result.skipped ? 'skipped (not configured)' : `uploaded (${result.stamp})`}`);
    } catch (err) {
      console.error('[backup] nightly backup failed:', err.message);
    }
    setTimeout(runAndReschedule, 24 * 60 * 60 * 1000);
  };
  setTimeout(runAndReschedule, msUntilNextRun());
}

module.exports = { runBackup, scheduleNightlyBackup, isConfigured };
