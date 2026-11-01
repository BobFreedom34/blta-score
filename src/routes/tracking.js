// /api/tracking — the Google Tag Manager container of blta.sk and of slta.sk (Backend > Tracking). Super admin only: a container can run any script on every
// page of the site, so it is not something a city admin may set. GET: { blta: { gtmId, consent }, slta: { gtmId, consent } }; PUT /:site (blta | slta).
const express = require('express');
const tracking = require('../tracking');
const { requireSuperAdmin } = require('../auth');

const router = express.Router();

router.get('/', requireSuperAdmin, (req, res) => res.json(Object.fromEntries(tracking.SITES.map((site) => [site, tracking.get(site)]))));

router.put('/:site', requireSuperAdmin, (req, res) => {
  const r = tracking.set(req.params.site, req.body);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  res.json(r);
});

module.exports = router;
