const express = require('express');
const auth = require('../auth');

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

module.exports = router;
