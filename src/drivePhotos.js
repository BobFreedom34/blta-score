// Match photos live in a Google Drive folder, not on the persistent disk: the photos would otherwise grow the disk (and the daily
// files.zip backup of it) without limit. The database keeps only the Drive file id (match_photos.drive_file_id); the page shows the
// picture straight from Google by a link-based URL, so the app never serves photo bytes itself.
//
// Same OAuth2-as-the-account's-user setup as backup.js (see its header comment and .env.example for why not a service account), and the
// same access-token helper, but a folder of its own: GOOGLE_DRIVE_PHOTOS_FOLDER_ID. The scope stays drive.file, which covers files the
// app created itself — exactly the photos it uploads and later deletes here, nothing else in the Drive.
const backup = require('./backup');

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// The feature is off (no Add button, nothing breaks) unless Drive access and the photos folder are all set — same "not configured →
// skip" convention as the backup.
function isConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID
  );
}

// One template for every picture URL, so the form of the link can be changed (Google has changed what works for embedding Drive
// images before) with an env var instead of a code change. {id} is the Drive file id, {width} the wanted width in pixels.
const DEFAULT_IMAGE_URL_TEMPLATE = 'https://drive.google.com/thumbnail?id={id}&sz=w{width}';

function buildUrl(fileId, width) {
  const template = process.env.PHOTO_IMAGE_URL_TEMPLATE || DEFAULT_IMAGE_URL_TEMPLATE;
  return template.split('{id}').join(encodeURIComponent(fileId)).split('{width}').join(String(width));
}

function imageUrl(fileId, width = 1600) {
  return buildUrl(fileId, width);
}

function thumbUrl(fileId) {
  return buildUrl(fileId, 400);
}

// Same hand-built multipart/related upload as backup.js's uploadFile (metadata JSON part + the raw bytes), into the photos folder.
async function uploadFile(token, name, buffer, mimeType) {
  const boundary = 'blta-score-photo-boundary';
  const metadata = { name, parents: [process.env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID] };
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

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive photo upload failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Uploads the picture, then makes it readable by anyone with the link (that is what lets the page show it with a plain <img>, for
// logged-out visitors too). A photo that cannot be shown is worse than none, so if the permission call fails the file is deleted
// again and the whole upload fails — no half-finished file stays behind in the folder.
async function uploadPhoto(buffer, mimeType, name) {
  const token = await backup.getAccessToken();
  const file = await uploadFile(token, name, buffer, mimeType);
  try {
    const res = await fetch(`${DRIVE_API}/${encodeURIComponent(file.id)}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
    if (!res.ok) throw new Error(`Drive permission failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    try {
      await fetch(`${DRIVE_API}/${encodeURIComponent(file.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch (delErr) {
      console.error('[photos] Could not remove the half-uploaded file', file.id, delErr);
    }
    throw err;
  }
  return { id: file.id };
}

// Revokes the public link first (so even if the file delete fails the picture is no longer reachable by its link), then deletes the
// file. Never throws — a photo's row is removed from the database regardless, and a Drive hiccup must not break that — it logs and
// returns false instead, so a leftover can be found in the log (and in the Drive folder) later.
async function deletePhoto(fileId) {
  try {
    const token = await backup.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const id = encodeURIComponent(fileId);
    const perm = await fetch(`${DRIVE_API}/${id}/permissions/anyoneWithLink`, { method: 'DELETE', headers });
    // 404 = there was no such permission (already revoked): nothing to undo, carry on with the file
    if (!perm.ok && perm.status !== 404) throw new Error(`permission revoke failed: ${perm.status} ${await perm.text()}`);
    const res = await fetch(`${DRIVE_API}/${id}`, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`file delete failed: ${res.status} ${await res.text()}`);
    return true;
  } catch (err) {
    console.error(`[photos] Could not delete Drive file ${fileId}:`, err);
    return false;
  }
}

module.exports = { isConfigured, uploadPhoto, deletePhoto, imageUrl, thumbUrl };
