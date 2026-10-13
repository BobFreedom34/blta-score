// Daily off-site backup of the SQLite database to a Google Drive folder —
// the persistent disk on Render survives a redeploy, but has no backup of
// its own, so this is the actual disaster-recovery story for real
// match/player data (losing a laptop, by contrast, loses nothing here —
// see db.js's dataDir and README).
//
// Uses OAuth2 delegated as the account's own user, not a service account:
// Google Drive gives service accounts zero storage quota of their own on
// a personal (non-Workspace) account — even writing into a folder shared
// with it as Editor is rejected with storageQuotaExceeded — so files have
// to be created as the real user instead. See .env.example for the
// one-time setup (a Cloud OAuth client + running
// scripts/get-drive-refresh-token.js once to mint the refresh token).
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const mailer = require('./mailer');

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const DB_FILENAME = 'blta-score.db';
const DB_FILE = path.join(db.dataDir, DB_FILENAME);
// Everything else on the persistent disk that isn't the database itself
// (badge icons today — see routes/badges.js's ICONS_DIR — and whatever
// else ends up living there later) gets zipped up as a second file. The
// database only stores a path like /badge-icons/whatever.png, never the
// image bytes, so skipping this would silently lose every such upload.
// Deliberately generic (everything under dataDir except the db and its
// WAL/SHM siblings) rather than a hardcoded "badge-icons" list, so a
// future upload feature is covered here automatically.
const DB_SIDE_FILES = new Set([DB_FILENAME, `${DB_FILENAME}-wal`, `${DB_FILENAME}-shm`]);

function isConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID
  );
}

let oauthClient = null;
function getAuth() {
  if (!oauthClient) {
    oauthClient = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    oauthClient.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  }
  return oauthClient;
}

async function getAccessToken() {
  const { token } = await getAuth().getAccessToken();
  return token;
}

// Plain multipart/related upload built by hand (metadata JSON part + the
// file's raw bytes) rather than pulling in the full `googleapis` package
// just for this one call — google-auth-library alone handles the OAuth
// token refresh, and a Drive upload is one fetch away from there.
async function uploadFile(token, name, buffer, mimeType) {
  const boundary = 'blta-score-backup-boundary';
  const metadata = { name, parents: [process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID] };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Deletes backups older than RETENTION_DAYS from the same folder, so it
// doesn't grow forever — one .db + one files.zip per day means this is
// just "keep the last RETENTION_DAYS days" in practice. The 'blta-score-'
// prefix covers both blta-score-backup-*.db and blta-score-files-*.zip.
async function pruneOldBackups(token) {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and name contains 'blta-score-'`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn('[backup] Could not list existing backups for pruning:', res.status, await res.text());
    return;
  }
  const { files } = await res.json();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = (files || []).filter((f) => new Date(f.createdTime).getTime() < cutoff);
  for (const f of stale) {
    const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!delRes.ok) {
      console.warn(`[backup] Failed to prune old backup ${f.name}:`, delRes.status);
    }
  }
}

// PRAGMA wal_checkpoint(TRUNCATE) flushes every pending write out of the
// WAL file into blta-score.db itself and truncates the WAL back to empty —
// without this, a plain copy of the .db file could miss recent writes that
// are still only sitting in blta-score.db-wal.
function snapshotDbFile() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return fs.readFileSync(DB_FILE);
}

// Recursively lists every file under dataDir except the database itself
// and its WAL/SHM siblings, preserving their relative path.
function listNonDbFiles(dir, baseDir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full);
    if (entry.isDirectory()) {
      results = results.concat(listNonDbFiles(full, baseDir));
    } else if (entry.isFile() && !DB_SIDE_FILES.has(rel)) {
      results.push({ full, rel });
    }
  }
  return results;
}

// Zips every non-database file on the persistent disk into one in-memory
// buffer, preserving their relative folder structure. Returns null
// (rather than an empty zip) when there's nothing to back up yet.
function zipDataFiles() {
  return new Promise((resolve, reject) => {
    const files = listNonDbFiles(db.dataDir, db.dataDir);
    if (!files.length) return resolve(null);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    // Zip entry names are always forward-slash, regardless of the host
    // OS's path separator (only matters when running this on Windows —
    // production is Linux, where path.sep is already '/').
    files.forEach(({ full, rel }) => archive.file(full, { name: rel.split(path.sep).join('/') }));
    archive.finalize();
  });
}

// Which of today's two files are already in the Drive folder? Used by the scheduled run so a restart, a deploy or a second check
// never uploads the same day twice (the app restarts on every deploy, and it used to upload a full backup each time).
async function existingNamesFor(token, names) {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  const nameQuery = names.map((n) => `name = '${n}'`).join(' or ');
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and (${nameQuery})`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive lookup failed: ${res.status} ${await res.text()}`);
  const { files } = await res.json();
  return new Set((files || []).map((f) => f.name));
}

let running = false;
let alertedFor = ''; // the day a failure e-mail was last sent for: a failing scheduled check must not mail every hour

// opts.force (the admin's "Back up now" button): upload both files whatever is already there.
// Without it (the schedule): upload only what today's backup is still missing; nothing at all when it is complete.
async function runBackup(opts = {}) {
  if (!isConfigured()) {
    console.warn('[backup] Google OAuth env vars not fully set — skipping backup. See .env.example.');
    return { skipped: true };
  }
  if (running) return { ok: false, error: 'A backup is already running' };
  running = true;
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dbName = `blta-score-backup-${stamp}.db`;
  const filesName = `blta-score-files-${stamp}.zip`;
  try {
    const token = await getAccessToken();
    let have = new Set();
    if (!opts.force) {
      have = await existingNamesFor(token, [dbName, filesName]);
      const filesExpected = listNonDbFiles(db.dataDir, db.dataDir).length > 0;
      if (have.has(dbName) && (have.has(filesName) || !filesExpected)) {
        return { ok: true, alreadyDone: true, name: dbName };
      }
    }

    let dbResult = null;
    if (!have.has(dbName)) {
      const dbBuffer = snapshotDbFile();
      const dbFile = await uploadFile(token, dbName, dbBuffer, 'application/x-sqlite3');
      console.log(`[backup] Uploaded ${dbName} (${dbBuffer.length} bytes) to Google Drive as file ${dbFile.id}.`);
      dbResult = { id: dbFile.id, bytes: dbBuffer.length };
    }

    let filesResult = null;
    if (!have.has(filesName)) {
      const filesBuffer = await zipDataFiles();
      if (filesBuffer) {
        const filesFile = await uploadFile(token, filesName, filesBuffer, 'application/zip');
        console.log(`[backup] Uploaded ${filesName} (${filesBuffer.length} bytes) to Google Drive as file ${filesFile.id}.`);
        filesResult = { name: filesName, id: filesFile.id, bytes: filesBuffer.length };
      }
    }

    await pruneOldBackups(token);
    return { ok: true, name: dbName, id: dbResult && dbResult.id, bytes: dbResult && dbResult.bytes, files: filesResult };
  } catch (err) {
    console.error('[backup] Backup failed:', err);
    if (opts.force || alertedFor !== stamp) {
      alertedFor = stamp;
      try {
        await mailer.sendBackupFailedEmail(err);
      } catch (mailErr) {
        console.error('[backup] Also failed to send the failure-alert email:', mailErr);
      }
    }
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

// One backup a day, in the night: from this UTC hour on (1 = 02:00 / 03:00 in Bratislava), the first check of a day makes the backup
// and every later check that day finds it in the folder and does nothing. The checks are hourly and also run a few minutes after a
// start, so a restart or deploy never causes a second upload, and a day that was missed (the app was down at night) is made up for.
const CHECK_EVERY_MS = 60 * 60 * 1000;
const BACKUP_FROM_HOUR_UTC = Number(process.env.BACKUP_HOUR_UTC || 1);

async function runScheduledBackup(now = new Date()) {
  if (now.getUTCHours() < BACKUP_FROM_HOUR_UTC) return { skipped: true, tooEarly: true };
  return runBackup();
}

function startScheduledBackups() {
  if (!isConfigured()) {
    console.log('[backup] Google Drive backup is not configured — see .env.example (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN / GOOGLE_DRIVE_BACKUP_FOLDER_ID). Backups are OFF.');
    return;
  }
  // a few minutes after boot (let the rest of startup settle first), then hourly for as long as the process stays up
  setTimeout(() => { runScheduledBackup(); }, 3 * 60 * 1000);
  setInterval(() => { runScheduledBackup(); }, CHECK_EVERY_MS);
}

// getAccessToken is shared with drivePhotos.js (match photos) — same Google login, no second OAuth client.
module.exports = { isConfigured, runBackup, runScheduledBackup, startScheduledBackups, getAccessToken };
