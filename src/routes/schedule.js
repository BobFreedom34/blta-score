const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCategories(raw) {
  return String(raw || '').split(',').filter((c) => CATEGORIES.includes(c));
}

function serializeEvent(e) {
  return {
    type: 'TOURNAMENT',
    eventId: e.id,
    name: e.name,
    startDate: e.start_date,
    endDate: e.end_date || e.start_date,
    venue: e.venue || '',
    link: e.link || '',
    categories: parseCategories(e.categories),
  };
}

// The schedule page: the league seasons (always from the seasons themselves, so changing a season's dates in the
// backend changes the schedule) and the tournaments / other events added in the backend, soonest first. A league
// season has every BLTA category; its "more info" is its season page.
router.get('/', (req, res) => {
  const seasons = db.prepare("SELECT * FROM seasons WHERE start_date IS NOT NULL AND start_date != ''").all().map((s) => ({
    type: 'LEAGUE',
    seasonId: s.id,
    name: s.name,
    startDate: s.start_date,
    endDate: s.end_date || s.start_date,
    venue: '',
    link: `/season/${s.slug}`,
    logoUrl: s.logo_url || '',
    categories: CATEGORIES,
  }));
  const events = db.prepare('SELECT * FROM schedule_events').all().map(serializeEvent);
  const all = [...seasons, ...events].sort((a, b) => (a.startDate + a.name).localeCompare(b.startDate + b.name));
  res.json(all);
});

// Reads and checks the fields of an event from a request body; returns { error } or { values }.
function parseEvent(body, partial) {
  const values = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'Name is required' };
    if (name.length > 120) return { error: 'Name is too long (max 120 characters)' };
    values.name = name;
  }
  if (!partial || body.startDate !== undefined) {
    if (!ISO_DATE.test(body.startDate || '')) return { error: 'Start date is required' };
    values.start_date = body.startDate;
  }
  if (!partial || body.endDate !== undefined) {
    if (body.endDate && !ISO_DATE.test(body.endDate)) return { error: 'End date is not a valid date' };
    values.end_date = body.endDate || null;
  }
  if (!partial || body.venue !== undefined) {
    const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
    if (venue.length > 200) return { error: 'Venue is too long (max 200 characters)' };
    values.venue = venue;
  }
  if (!partial || body.link !== undefined) {
    const link = typeof body.link === 'string' ? body.link.trim() : '';
    if (link.length > 500) return { error: 'Link is too long (max 500 characters)' };
    if (link && !/^(https?:\/\/|\/)/i.test(link)) return { error: 'The link must start with http://, https:// or /' };
    values.link = link;
  }
  if (!partial || body.categories !== undefined) {
    const categories = Array.isArray(body.categories) ? body.categories.filter((c) => CATEGORIES.includes(c)) : [];
    values.categories = (categories.length ? categories : CATEGORIES).join(',');
  }
  return { values };
}

function checkRange(start, end) {
  return !end || end >= start;
}

router.post('/events', requireAdmin, (req, res) => {
  const { error, values } = parseEvent(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  if (!checkRange(values.start_date, values.end_date)) return res.status(400).json({ error: 'The end date is before the start date' });
  const info = db.prepare('INSERT INTO schedule_events (name, start_date, end_date, venue, link, categories) VALUES (?, ?, ?, ?, ?, ?)')
    .run(values.name, values.start_date, values.end_date, values.venue, values.link, values.categories);
  res.status(201).json(serializeEvent(db.prepare('SELECT * FROM schedule_events WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/events/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM schedule_events WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  const { error, values } = parseEvent(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const next = { ...row, ...values };
  if (!checkRange(next.start_date, next.end_date)) return res.status(400).json({ error: 'The end date is before the start date' });
  db.prepare('UPDATE schedule_events SET name = ?, start_date = ?, end_date = ?, venue = ?, link = ?, categories = ? WHERE id = ?')
    .run(next.name, next.start_date, next.end_date, next.venue, next.link, next.categories, row.id);
  res.json(serializeEvent(db.prepare('SELECT * FROM schedule_events WHERE id = ?').get(row.id)));
});

router.delete('/events/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM schedule_events WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Event not found' });
  res.json({ ok: true });
});

module.exports = router;
