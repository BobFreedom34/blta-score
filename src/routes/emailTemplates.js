// Backend > E-mails: the texts of the plain-text e-mails the site sends (src/emailTemplates.js). Super admin only.
const express = require('express');
const { requireSuperAdmin } = require('../auth');
const templates = require('../emailTemplates');

const router = express.Router();

router.get('/', requireSuperAdmin, (req, res) => {
  res.json({ groups: templates.GROUPS, templates: templates.list() });
});

router.put('/:key', requireSuperAdmin, (req, res) => {
  const out = templates.save(req.params.key, req.body);
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
});

// back to the built-in text
router.delete('/:key', requireSuperAdmin, (req, res) => {
  const out = templates.reset(req.params.key);
  if (out.error) return res.status(404).json({ error: out.error });
  res.json(out);
});

// the e-mail as it would read with the text typed now ({ subject?, body? }), filled with the example values: nothing is saved, nothing is sent
router.post('/:key/preview', requireSuperAdmin, (req, res) => {
  if (!templates.list().some((t) => t.key === req.params.key)) return res.status(404).json({ error: 'Unknown e-mail' });
  const b = req.body || {};
  if ((b.body != null && (typeof b.body !== 'string' || b.body.length > 4000)) || (b.subject != null && (typeof b.subject !== 'string' || b.subject.length > 200))) return res.status(400).json({ error: 'The text is too long' });
  res.json(templates.render(req.params.key, templates.sampleVars(req.params.key), { subject: b.subject, body: b.body }));
});

// sends the e-mail with the example values to an address, so it can be seen in a real inbox ({ to, subject?, body? })
router.post('/:key/test', requireSuperAdmin, async (req, res) => {
  if (!templates.list().some((t) => t.key === req.params.key)) return res.status(404).json({ error: 'Unknown e-mail' });
  const b = req.body || {};
  const to = String(b.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
  try {
    const sent = await require('../mailer').sendTemplateTest(req.params.key, to, { subject: typeof b.subject === 'string' ? b.subject : '', body: typeof b.body === 'string' ? b.body : '' });
    if (!sent) return res.status(503).json({ error: 'The mail server is not set up (SMTP), nothing was sent' });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
