const express = require('express');
const { isConfigured } = require('../push');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => {
  if (!isConfigured()) {
    return res.status(404).json({ error: 'Push notifications are not configured on this server' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

module.exports = router;
