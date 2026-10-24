// Photos of a match: up to 5 per match, kept in Google Drive (see drivePhotos.js — the database only holds the Drive file id).
// Anyone may look; the two players of the match and an admin may add; whoever added a photo (and an admin) may remove it.
// Mounted at /api/matches next to the matches router, so the paths here are /:token/photos….
const express = require('express');
const multer = require('multer');
const db = require('../db');
const drivePhotos = require('../drivePhotos');
const { isAdmin, getPlayerId, isReferee } = require('../auth');

const router = express.Router();

const MAX_PHOTOS = 5;
const MAX_BYTES = 10 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

// What the browser says the file is is not trusted on its own: the first bytes have to be that kind of picture as well, so a text
// file renamed to .jpg never goes to Drive. Returns the file extension, or null when the bytes are not that type.
const SIGNATURES = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

function getRowOr404(req, res) {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return row;
}

// every player of a match: the two of a singles match, the four of a doubles match
const playerIdsOf = (row) => [row.player1_id, row.player2_id, row.player1b_id, row.player2b_id].filter(Boolean);

// Deliberately narrower than the match-management check in matches.js: only one of the two players of this match or an admin — not a
// referee, and not a player who merely created the match.
function canAddTo(req, row) {
  if (isAdmin(req)) return true;
  const playerId = getPlayerId(req);
  return !!playerId && playerIdsOf(row).includes(playerId);
}

function countPhotos(matchId) {
  return db.prepare('SELECT COUNT(*) AS n FROM match_photos WHERE match_id = ?').get(matchId).n;
}

function serializePhoto(photo, req) {
  const uploader = photo.uploaded_by_player_id
    ? db.prepare('SELECT name FROM players WHERE id = ?').get(photo.uploaded_by_player_id)
    : null;
  const playerId = getPlayerId(req);
  return {
    id: photo.id,
    url: drivePhotos.imageUrl(photo.drive_file_id),
    thumbUrl: drivePhotos.thumbUrl(photo.drive_file_id),
    addedBy: uploader ? uploader.name : null,
    createdAt: photo.created_at,
    canRemove: isAdmin(req) || (!!playerId && photo.uploaded_by_player_id === playerId),
  };
}

function notifyChanged(req, row) {
  const io = req.app.get('io');
  io.to(`match:${row.share_token}`).emit('photos:changed', { token: row.share_token });
  // the match lists show a "Photo" pill, so they reload too
  io.emit('matches:changed', { token: row.share_token, status: row.status });
}

router.get('/:token/photos', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const photos = db.prepare('SELECT * FROM match_photos WHERE match_id = ? ORDER BY id ASC').all(row.id);
  const enabled = drivePhotos.isConfigured();
  res.json({
    enabled,
    max: MAX_PHOTOS,
    canAdd: enabled && canAddTo(req, row) && photos.length < MAX_PHOTOS,
    photos: photos.map((p) => serializePhoto(p, req)),
  });
});

// Invoking multer by hand (as routes/badges.js does) lets a bad upload come back as JSON instead of Express's HTML error page.
router.post('/:token/photos', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!drivePhotos.isConfigured()) return res.status(503).json({ error: 'Match photos are not available right now' });
  // before the file is even read, so a visitor cannot make the server buffer 10 MB
  if (!canAddTo(req, row)) {
    const loggedIn = getPlayerId(req) || isReferee(req); // a referee is somebody, just not a player of this match
    return res.status(loggedIn ? 403 : 401).json({ error: 'Only the two players of this match (or an admin) can add photos' });
  }

  upload.single('photo')(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 10 MB' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    let uploaded = null; // set once the file is in Drive
    let saved = false; // set once its row is committed
    try {
      if (!req.file || !req.file.size) return res.status(400).json({ error: 'Choose a photo to upload' });
      const type = SIGNATURES[req.file.mimetype];
      if (!type || !type.matches(req.file.buffer)) {
        return res.status(400).json({ error: 'The photo must be a JPEG, PNG or WebP picture' });
      }
      // fast fail before anything is sent to Drive; checked again right before the insert, since another upload can land meanwhile
      if (countPhotos(row.id) >= MAX_PHOTOS) return res.status(409).json({ error: `A match can have at most ${MAX_PHOTOS} photos` });

      try {
        uploaded = await drivePhotos.uploadPhoto(req.file.buffer, req.file.mimetype, `match-${row.id}-${Date.now()}.${type.ext}`);
      } catch (driveErr) {
        console.error('[photos] Drive upload failed:', driveErr);
        return res.status(502).json({ error: 'Could not save the photo to Google Drive — please try again' });
      }

      // SQLite is synchronous: from this check to the insert nothing else can run. If the match was deleted or filled up while the
      // file was on its way to Drive, the file is taken out of Drive again instead of staying there with no row.
      const stillThere = db.prepare('SELECT id FROM matches WHERE id = ?').get(row.id);
      if (!stillThere || countPhotos(row.id) >= MAX_PHOTOS) {
        await drivePhotos.deletePhoto(uploaded.id);
        return stillThere
          ? res.status(409).json({ error: `A match can have at most ${MAX_PHOTOS} photos` })
          : res.status(404).json({ error: 'Match not found' });
      }

      // Who is recorded as the uploader: the player of this match who is logged in, even when that person is an admin as well. An admin
      // who is not one of the two players has no uploader id (an admin is not a player), so both players are told about the photo.
      const playerId = getPlayerId(req);
      const uploaderId = playerId && playerIdsOf(row).includes(playerId) ? playerId : null;
      // The photo row and its notifications are written together or not at all, so a failure cannot leave a half-saved photo.
      let photoId;
      try {
        db.exec('BEGIN');
        try {
          const info = db.prepare('INSERT INTO match_photos (match_id, drive_file_id, uploaded_by_player_id) VALUES (?, ?, ?)')
            .run(row.id, uploaded.id, uploaderId);
          photoId = Number(info.lastInsertRowid);
          const notify = db.prepare('INSERT INTO photo_notifications (player_id, match_id, photo_id, seen) VALUES (?, ?, ?, 0)');
          playerIdsOf(row)
            .filter((pid) => pid !== uploaderId)
            .forEach((pid) => notify.run(pid, row.id, photoId));
          db.exec('COMMIT');
        } catch (dbErr) {
          db.exec('ROLLBACK');
          throw dbErr;
        }
      } catch (dbErr) {
        // nothing was saved, so the publicly linked file must not stay in Drive
        console.error('[photos] saving the photo failed:', dbErr);
        await drivePhotos.deletePhoto(uploaded.id);
        uploaded = null;
        return res.status(500).json({ error: 'Could not add the photo' });
      }
      saved = true;

      // From here the photo is saved: nothing below may turn into a 500 (a retry would use up a second slot).
      try { notifyChanged(req, row); } catch (e) { console.error('[photos] could not announce the new photo:', e); }
      let body;
      try {
        body = serializePhoto(db.prepare('SELECT * FROM match_photos WHERE id = ?').get(photoId), req);
      } catch (e) {
        console.error('[photos] could not build the answer for the saved photo:', e);
        body = {
          id: photoId, url: drivePhotos.imageUrl(uploaded.id), thumbUrl: drivePhotos.thumbUrl(uploaded.id), addedBy: null, createdAt: new Date().toISOString(), canRemove: true,
        };
      }
      res.status(201).json(body);
    } catch (e) {
      console.error('[photos] add failed:', e);
      // an error after the upload but before the row was committed must not leave the publicly linked file behind
      if (uploaded && !saved) await drivePhotos.deletePhoto(uploaded.id);
      if (!res.headersSent) res.status(500).json({ error: 'Could not add the photo' });
    }
  });
});

router.delete('/:token/photos/:id', async (req, res) => {
  try {
    const row = getRowOr404(req, res);
    if (!row) return;
    const photo = /^\d+$/.test(req.params.id)
      ? db.prepare('SELECT * FROM match_photos WHERE id = ? AND match_id = ?').get(Number(req.params.id), row.id)
      : null;
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const playerId = getPlayerId(req);
    if (!isAdmin(req) && !(playerId && photo.uploaded_by_player_id === playerId)) {
      return res.status(403).json({ error: 'Only the person who added this photo (or an admin) can remove it' });
    }
    // Drive first (the public link is revoked, then the file deleted); deletePhoto never throws, and a Drive hiccup must not keep the
    // photo on the page, so the row goes either way.
    await drivePhotos.deletePhoto(photo.drive_file_id);
    db.prepare('DELETE FROM photo_notifications WHERE photo_id = ?').run(photo.id);
    db.prepare('DELETE FROM match_photos WHERE id = ?').run(photo.id);
    notifyChanged(req, row);
    res.status(204).end();
  } catch (e) {
    console.error('[photos] remove failed:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Could not remove the photo' });
  }
});

// Called when a match is deleted: the rows go at once, the Drive files in the background (deletePhoto logs its own failures).
function removeAllForMatch(matchId) {
  const photos = db.prepare('SELECT drive_file_id FROM match_photos WHERE match_id = ?').all(matchId);
  db.prepare('DELETE FROM photo_notifications WHERE match_id = ?').run(matchId);
  db.prepare('DELETE FROM match_photos WHERE match_id = ?').run(matchId);
  photos.forEach((p) => { drivePhotos.deletePhoto(p.drive_file_id); });
}

module.exports = router;
module.exports.removeAllForMatch = removeAllForMatch;
