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
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const mailer = require('./mailer');

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const DB_FILE = path.join(db.dataDir, 'blta-score.db');

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
// db file's raw bytes) rather than pulling in the full `googleapis`
// package just for this one call — google-auth-library alone handles the
// service-account JWT exchange, and a Drive upload is one fetch away from
// there.
async function uploadFile(token, name, buffer) {
  const boundary = 'blta-score-backup-boundary';
  const metadata = { name, parents: [process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID] };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/x-sqlite3\r\n\r\n'
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
// doesn't grow forever — one file/day means this is just "keep the last
// RETENTION_DAYS days" in practice.
async function pruneOldBackups(token) {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and name contains 'blta-score-backup-'`);
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

async function runBackup() {
  if (!isConfigured()) {
    console.warn('[backup] Google OAuth env vars not fully set — skipping backup. See .env.example.');
    return { skipped: true };
  }
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const name = `blta-score-backup-${stamp}.db`;
  try {
    const buffer = snapshotDbFile();
    const token = await getAccessToken();
    const file = await uploadFile(token, name, buffer);
    await pruneOldBackups(token);
    console.log(`[backup] Uploaded ${name} (${buffer.length} bytes) to Google Drive as file ${file.id}.`);
    return { ok: true, name, id: file.id, bytes: buffer.length };
  } catch (err) {
    console.error('[backup] Backup failed:', err);
    try {
      await mailer.sendBackupFailedEmail(err);
    } catch (mailErr) {
      console.error('[backup] Also failed to send the failure-alert email:', mailErr);
    }
    return { ok: false, error: err.message };
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
function startScheduledBackups() {
  if (!isConfigured()) {
    console.log('[backup] Google Drive backup is not configured — see .env.example (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN / GOOGLE_DRIVE_BACKUP_FOLDER_ID). Backups are OFF.');
    return;
  }
  // A few minutes after boot (not instantly — let the rest of startup
  // settle first), then every 24h for as long as the process stays up.
  setTimeout(() => { runBackup(); }, 3 * 60 * 1000);
  setInterval(() => { runBackup(); }, ONE_DAY_MS);
}

module.exports = { isConfigured, runBackup, startScheduledBackups };
