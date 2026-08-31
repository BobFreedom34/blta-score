const express = require('express');
const auth = require('../auth');
const backup = require('../backup');

const router = express.Router();

router.get('/session', (req, res) => {
  res.json({ isAdmin: auth.isAdmin(req) });
});

router.post('/login', (req, res) => {
  const password = req.body.password || '';
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin login is not configured on this server (ADMIN_PASSWORD is unset)' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  auth.logIn(res);
  res.json({ isAdmin: true });
});

router.post('/logout', (req, res) => {
  auth.logOut(res);
  res.json({ isAdmin: false });
});

// Runs the same backup the nightly schedule does, on demand — for
// confirming the Google Drive setup actually works right after adding the
// env vars, without waiting for the next scheduled run (see src/backup.js).
router.post('/backup-now', auth.requireAdmin, async (req, res) => {
  try {
    const result = await backup.runBackup();
    if (result.skipped) {
      return res.status(400).json({ error: 'Backup is not configured — set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_BACKUP_FOLDER_ID' });
    }
    res.json({ ok: true, stamp: result.stamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
