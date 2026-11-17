// Backend > Menu > "Welcome e-mail": the texts of the e-mail a player gets after the first registration (src/welcomeEmail.js). Super admin only.
const express = require('express');
const { requireSuperAdmin } = require('../auth');
const welcome = require('../welcomeEmail');

const router = express.Router();

router.get('/', requireSuperAdmin, (req, res) => {
  res.json({ ...welcome.read(), defaults: welcome.DEFAULTS });
});

router.put('/', requireSuperAdmin, (req, res) => {
  const out = welcome.save(req.body);
  if (out.error) return res.status(400).json({ error: out.error });
  res.json({ ...out, defaults: welcome.DEFAULTS });
});

// sends the e-mail as it stands now (the saved texts) to the address of the admin who asks, so it can be seen in a real inbox
router.post('/test', requireSuperAdmin, async (req, res) => {
  const to = String((req.body && req.body.to) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
  const lang = req.body && req.body.lang === 'en' ? 'en' : 'sk';
  try {
    const sent = await require('../mailer').sendWelcomeEmail({ to, name: 'Jozef', slug: '', lang, force: true });
    if (!sent) return res.status(503).json({ error: 'The mail server is not set up (SMTP), nothing was sent' });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
