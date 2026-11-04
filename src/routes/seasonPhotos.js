// The gallery of a tournament or a season (its tab Galéria): photos of the event itself, kept in the SAME Google Drive folder as the photos of the matches (see
// drivePhotos.js - the database only holds the Drive file id). Anyone may look; the organiser may add and remove: an admin of the site, or the admin of the club
// that runs the event (clubTournaments.canManageSeason). Mounted at /api/seasons, so the paths here are /:id/photos....
const express = require('express');
const multer = require('multer');
const db = require('../db');
const drivePhotos = require('../drivePhotos');
const clubTournaments = require('../clubTournaments');
const { SIGNATURES } = require('./matchPhotos');
const { getPlayerId } = require('../auth');

const router = express.Router();

const MAX_PHOTOS = 200;
const MAX_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

// the event, or an answer that it does not exist (an event of a club that is hidden does not exist for the public)
function seasonOr404(req, res) {
  const season = /^\d+$/.test(req.params.id) ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id)) : null;
  if (!season || clubTournaments.publicFace(season).hidden) {
    res.status(404).json({ error: 'Season not found' });
    return null;
  }
  return season;
}

const countPhotos = (seasonId) => db.prepare('SELECT COUNT(*) AS n FROM season_photos WHERE season_id = ?').get(seasonId).n;

function serializePhoto(photo, canManage) {
  const uploader = photo.uploaded_by_player_id ? db.prepare('SELECT name FROM players WHERE id = ?').get(photo.uploaded_by_player_id) : null;
  return {
    id: photo.id,
    url: drivePhotos.imageUrl(photo.drive_file_id),
    thumbUrl: drivePhotos.thumbUrl(photo.drive_file_id),
    addedBy: uploader ? uploader.name : null,
    createdAt: photo.created_at,
    canRemove: canManage,
  };
}

router.get('/:id/photos', (req, res) => {
  const season = seasonOr404(req, res);
  if (!season) return;
  const photos = db.prepare('SELECT * FROM season_photos WHERE season_id = ? ORDER BY id ASC').all(season.id);
  const enabled = drivePhotos.isConfigured();
  const canManage = clubTournaments.canManageSeason(req, season);
  res.json({ enabled, max: MAX_PHOTOS, canAdd: enabled && canManage && photos.length < MAX_PHOTOS, photos: photos.map((p) => serializePhoto(p, canManage)) });
});

router.post('/:id/photos', (req, res) => {
  const season = seasonOr404(req, res);
  if (!season) return;
  if (!drivePhotos.isConfigured()) return res.status(503).json({ error: 'Photos are not available right now' });
  // before the file is even read, so a visitor cannot make the server buffer 10 MB
  if (!clubTournaments.canManageSeason(req, season)) {
    return res.status(getPlayerId(req) ? 403 : 401).json({ error: 'Only the organiser of this event (or an admin) can add photos to its gallery' });
  }
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 10 MB' : 'Could not process the uploaded file' });
    let uploaded = null;
    let saved = false;
    try {
      if (!req.file || !req.file.size) return res.status(400).json({ error: 'Choose a photo to upload' });
      const type = SIGNATURES[req.file.mimetype];
      if (!type || !type.matches(req.file.buffer)) return res.status(400).json({ error: 'The photo must be a JPEG, PNG or WebP picture' });
      if (countPhotos(season.id) >= MAX_PHOTOS) return res.status(409).json({ error: `A gallery can have at most ${MAX_PHOTOS} photos` });
      try {
        uploaded = await drivePhotos.uploadPhoto(req.file.buffer, req.file.mimetype, `season-${season.id}-${Date.now()}.${type.ext}`);
      } catch (driveErr) {
        console.error('[season photos] Drive upload failed:', driveErr);
        return res.status(502).json({ error: 'Could not save the photo to Google Drive — please try again' });
      }
      // the event may have been deleted, or the gallery filled up, while the file was on its way: then the file leaves Drive again
      const stillThere = db.prepare('SELECT id FROM seasons WHERE id = ?').get(season.id);
      if (!stillThere || countPhotos(season.id) >= MAX_PHOTOS) {
        await drivePhotos.deletePhoto(uploaded.id);
        uploaded = null;
        return stillThere ? res.status(409).json({ error: `A gallery can have at most ${MAX_PHOTOS} photos` }) : res.status(404).json({ error: 'Season not found' });
      }
      const info = db.prepare('INSERT INTO season_photos (season_id, drive_file_id, uploaded_by_player_id) VALUES (?, ?, ?)').run(season.id, uploaded.id, getPlayerId(req) || null);
      saved = true;
      res.status(201).json(serializePhoto(db.prepare('SELECT * FROM season_photos WHERE id = ?').get(Number(info.lastInsertRowid)), true));
    } catch (e) {
      console.error('[season photos] add failed:', e);
      // an error after the upload but before the row was saved must not leave the publicly linked file behind
      if (uploaded && !saved) await drivePhotos.deletePhoto(uploaded.id);
      if (!res.headersSent) res.status(500).json({ error: 'Could not add the photo' });
    }
  });
});

router.delete('/:id/photos/:photoId', async (req, res) => {
  try {
    const season = seasonOr404(req, res);
    if (!season) return;
    if (!clubTournaments.canManageSeason(req, season)) return res.status(getPlayerId(req) ? 403 : 401).json({ error: 'Only the organiser of this event (or an admin) can remove photos from its gallery' });
    const photo = /^\d+$/.test(req.params.photoId) ? db.prepare('SELECT * FROM season_photos WHERE id = ? AND season_id = ?').get(Number(req.params.photoId), season.id) : null;
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    // Drive first (deletePhoto never throws); a Drive hiccup must not keep the photo on the page, so the row goes either way
    await drivePhotos.deletePhoto(photo.drive_file_id);
    db.prepare('DELETE FROM season_photos WHERE id = ?').run(photo.id);
    res.status(204).end();
  } catch (e) {
    console.error('[season photos] remove failed:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Could not remove the photo' });
  }
});

// Called when an event is deleted: the rows go at once, the Drive files in the background.
function removeAllForSeason(seasonId) {
  const photos = db.prepare('SELECT drive_file_id FROM season_photos WHERE season_id = ?').all(seasonId);
  db.prepare('DELETE FROM season_photos WHERE season_id = ?').run(seasonId);
  photos.forEach((p) => { drivePhotos.deletePhoto(p.drive_file_id); });
}

module.exports = router;
module.exports.removeAllForSeason = removeAllForSeason;
