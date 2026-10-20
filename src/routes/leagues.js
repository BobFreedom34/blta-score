// The cities (leagues) of SLTA: the public list for the picker on the national page, and the admin's management of them (Backend > Cities).
// Only the admin (the super admin) creates, changes or deletes a city; the admins of a single city come with the next step.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const leagues = require('../leagues');
const national = require('../national');
const carousel = require('./carousel');

const router = express.Router();

// the checks shared by the creation and the change; returns { fields } or { error }
function parse(body, existing) {
  const fields = {};
  if (body.name !== undefined || !existing) {
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60) return { error: 'The name of the city is required (2-60 characters)' };
    fields.name = name;
  }
  if (body.brandName !== undefined) {
    const brand = String(body.brandName || '').replace(/\s+/g, ' ').trim();
    if (brand.length > 60) return { error: 'The brand name is too long (max 60 characters)' };
    fields.brand_name = brand;
  } else if (!existing) {
    fields.brand_name = `SLTA ${fields.name}`;
  }
  if (body.slug !== undefined || !existing) {
    const slug = leagues.slugify(body.slug || fields.name || (existing && existing.name));
    if (!slug) return { error: 'The address (slug) needs letters or digits' };
    if (leagues.RESERVED_SLUGS.has(slug) || slug.endsWith('-admin')) return { error: `"${slug}" is used by the app itself — pick another address` };
    const taken = leagues.bySlug(slug);
    if (taken && (!existing || taken.id !== existing.id)) return { error: `The address "${slug}" is already used by ${taken.name}` };
    fields.slug = slug;
  }
  if (body.domain !== undefined) {
    const domain = leagues.normalizeDomain(body.domain);
    if (domain === null) return { error: 'The domain is not valid (e.g. blta.sk)' };
    if (domain) {
      const other = db.prepare('SELECT id, name FROM leagues WHERE domain = ?').get(domain);
      if (other && (!existing || other.id !== existing.id)) return { error: `The domain ${domain} already belongs to ${other.name}` };
    }
    fields.domain = domain;
  }
  if (body.status !== undefined) {
    if (!leagues.STATUSES.includes(body.status)) return { error: `The status must be one of ${leagues.STATUSES.join(', ')}` };
    fields.status = body.status;
  }
  for (const key of ['lat', 'lng']) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') { fields[key] = null; continue; }
    const n = Number(body[key]);
    if (!Number.isFinite(n) || Math.abs(n) > 180) return { error: `${key} is not a number` };
    fields[key] = n;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: 'The order is a whole number' };
    fields.sort_order = n;
  }
  return { fields };
}

// The password lock of the national site (slta.sk): admin only. The password is kept as a hash and never given back.
router.get('/national-lock', auth.requireSuperAdmin, (req, res) => {
  res.json({ locked: national.isLocked(), hasPassword: national.hasPassword() });
});
router.put('/national-lock', auth.requireSuperAdmin, (req, res) => {
  const done = national.setLock({ enabled: !!(req.body && req.body.enabled), password: req.body && req.body.password });
  if (done.error) return res.status(400).json({ error: done.error });
  res.json({ locked: national.isLocked(), hasPassword: national.hasPassword() });
});

// Public: the slides of the carousel at the top of the national page (Backend > Carousel, "National page"), in order
router.get('/carousel', (req, res) => {
  res.json(db.prepare('SELECT * FROM carousel_slides WHERE active = 1 AND league_id = ? ORDER BY sort_order, id').all(carousel.NATIONAL).map(carousel.serialize));
});

// Public: the cities of the picker (without the hidden ones), in the order of the admin
router.get('/', (req, res) => {
  const rows = db.prepare("SELECT * FROM leagues WHERE status != 'HIDDEN' ORDER BY sort_order, name").all();
  res.json(rows.map((r) => leagues.serialize(r)));
});

// Admin: all of them, with the domains
router.get('/all', auth.requireSuperAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM leagues ORDER BY sort_order, name').all().map((r) => leagues.serialize(r, { admin: true })));
});

// The city of this request (the own domain, otherwise Bratislava)
router.get('/current', (req, res) => {
  res.json(leagues.serialize(req.league));
});

router.get('/:slug', (req, res) => {
  const row = leagues.bySlug(req.params.slug);
  if (!row || (row.status === 'HIDDEN' && !auth.isAdmin(req))) return res.status(404).json({ error: 'City not found' });
  res.json(leagues.serialize(row, { admin: auth.isAdmin(req) }));
});

router.post('/', auth.requireSuperAdmin, (req, res) => {
  const parsed = parse(req.body || {}, null);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const f = { status: 'HIDDEN', domain: '', lat: null, lng: null, ...parsed.fields };
  // a town of Slovakia gets its pin on the map by its name (unless coordinates were given)
  if (f.lat === null && f.lng === null) { const c = leagues.coordsFor(f.name); if (c) [f.lat, f.lng] = c; }
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM leagues').get().m ?? -1) + 1;
  const info = db.prepare('INSERT INTO leagues (slug, name, brand_name, domain, status, lat, lng, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(f.slug, f.name, f.brand_name, f.domain, f.status, f.lat, f.lng, f.sort_order ?? next);
  leagues.invalidate();
  res.status(201).json(leagues.serialize(leagues.byId(Number(info.lastInsertRowid)), { admin: true }));
});

router.patch('/:id', auth.requireSuperAdmin, (req, res) => {
  const row = leagues.byId(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'City not found' });
  const parsed = parse(req.body || {}, row);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const keys = Object.keys(parsed.fields);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
  // the first city is the home of everything that existed before: it stays on the picker and keeps its name
  if (row.id === leagues.DEFAULT_LEAGUE_ID && parsed.fields.status === 'HIDDEN') return res.status(400).json({ error: 'The first city cannot be hidden' });
  db.prepare(`UPDATE leagues SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...parsed.fields, id: row.id });
  leagues.invalidate();
  res.json(leagues.serialize(leagues.byId(row.id), { admin: true }));
});

// A city that owns nothing yet (a mistake, or a plan that was dropped); never the first one
router.delete('/:id', auth.requireSuperAdmin, (req, res) => {
  const row = leagues.byId(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'City not found' });
  if (row.id === leagues.DEFAULT_LEAGUE_ID) return res.status(400).json({ error: 'The first city cannot be deleted' });
  if (leagues.hasData(row.id)) return res.status(409).json({ error: `${row.name} already has seasons, players or venues — hide it instead of deleting it` });
  db.prepare('DELETE FROM leagues WHERE id = ?').run(row.id);
  leagues.invalidate();
  res.json({ ok: true });
});

module.exports = router;
