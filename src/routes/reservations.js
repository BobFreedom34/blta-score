// Court reservations (public page /reservations, Backend > Reservations): the admin adds courts and "spots" (a court on a day from a
// time to a time, in 30-minute steps — e.g. Thursday 10:00-12:00 is ONE spot); a logged-in player takes a free spot and their name goes
// into it. Times are local Slovak time (Europe/Bratislava), kept as plain 'YYYY-MM-DD' and 'HH:MM' text, so there is no time-zone or
// daylight-saving arithmetic anywhere: "now" is read once as local text and compared as text.
//
// Rules (the numbers are settings, see /settings): a player holds at most `maxActive` future reservations (0 = no limit), cannot hold two
// that overlap in time (on any court), cannot reserve a spot that has started, and can cancel their own reservation up to `cancelHours`
// before it starts. The admin can assign a spot to a player or a guest name, cancel any reservation and delete spots.
const express = require('express');
const db = require('../db');
const { requireAdmin, getPlayerId, isAdmin } = require('../auth');

const router = express.Router();

db.exec(`
  CREATE TABLE IF NOT EXISTS reservation_courts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS court_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    court_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    player_id INTEGER,
    guest_name TEXT NOT NULL DEFAULT '',
    reserved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_court_slots_day ON court_slots(day, court_id);
  CREATE INDEX IF NOT EXISTS idx_court_slots_player ON court_slots(player_id);
`);

const WINDOW_DAYS = 10;
const MAX_AHEAD_DAYS = 365;
const MAX_CREATE = 1000;
const DEFAULTS = { maxActive: 2, cancelHours: 2 };

// ---------------------------------------------------------------- time (local Slovak text)

// { date: 'YYYY-MM-DD', time: 'HH:MM' } in Europe/Bratislava. RESERVATIONS_NOW ('YYYY-MM-DD HH:MM') fixes the clock for the checks.
function nowLocal() {
  const fixed = process.env.RESERVATIONS_NOW;
  if (fixed && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fixed)) return { date: fixed.slice(0, 10), time: fixed.slice(11, 16) };
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const START_TIME = /^([01]\d|2[0-3]):(00|30)$/;
const END_TIME = /^(([01]\d|2[0-3]):(00|30)|24:00)$/;
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// calendar arithmetic on 'YYYY-MM-DD' text (noon UTC, so no day is ever skipped or doubled)
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
function isRealDay(day) {
  if (!ISO_DAY.test(day)) return false;
  return addDays(day, 0) === day;
}
// 1 = Monday … 7 = Sunday
function isoWeekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return w === 0 ? 7 : w;
}
const stamp = (day, time) => `${day} ${time}`;
const started = (slot, now) => stamp(slot.day, slot.start_time) <= stamp(now.date, now.time);

// ---------------------------------------------------------------- settings

function getSettings() {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = 'reservations'").get();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* use the defaults */ }
  return {
    maxActive: Number.isInteger(saved.maxActive) && saved.maxActive >= 0 ? saved.maxActive : DEFAULTS.maxActive,
    cancelHours: Number.isInteger(saved.cancelHours) && saved.cancelHours >= 0 ? saved.cancelHours : DEFAULTS.cancelHours,
  };
}

// ---------------------------------------------------------------- helpers

// "Tomáš Podhorný" -> "Tomáš P." (the public grid shows a short name, like the page it is modelled on)
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

function emitChanged(req) {
  try { req.app.get('io').emit('reservations:changed', {}); } catch { /* no socket server (checks) */ }
}

function slotRow(id) {
  return db.prepare(`
    SELECT s.*, c.name AS court_name, p.name AS player_name
    FROM court_slots s JOIN reservation_courts c ON c.id = s.court_id LEFT JOIN players p ON p.id = s.player_id
    WHERE s.id = ?
  `).get(id);
}

function isTaken(slot) {
  return slot.player_id !== null || slot.guest_name !== '';
}

// the reservations of a player that have not started yet
function activeOf(playerId, now) {
  return db.prepare('SELECT * FROM court_slots WHERE player_id = ?').all(playerId).filter((s) => !started(s, now));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

// ---------------------------------------------------------------- the public page's data

// GET /api/reservations?from=YYYY-MM-DD — the courts and the spots of the 10 days from `from` (never before today).
router.get('/', (req, res) => {
  const now = nowLocal();
  let from = typeof req.query.from === 'string' && isRealDay(req.query.from) ? req.query.from : now.date;
  if (from < now.date) from = now.date;
  if (from > addDays(now.date, MAX_AHEAD_DAYS)) from = addDays(now.date, MAX_AHEAD_DAYS);
  const to = addDays(from, WINDOW_DAYS - 1);
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(from, i));

  const admin = isAdmin(req);
  const me = getPlayerId(req);
  const settings = getSettings();
  const courts = db.prepare('SELECT id, name, note FROM reservation_courts ORDER BY sort_order, id').all();
  const rows = db.prepare(`
    SELECT s.*, p.name AS player_name, p.slug AS player_slug
    FROM court_slots s LEFT JOIN players p ON p.id = s.player_id
    WHERE s.day >= ? AND s.day <= ? ORDER BY s.day, s.start_time, s.court_id
  `).all(from, to);
  const slots = rows.map((s) => {
    const taken = isTaken(s);
    const isStarted = started(s, now);
    const full = s.guest_name || s.player_name || (s.player_id ? '?' : '');
    const mine = me !== null && s.player_id === me;
    return {
      id: s.id,
      courtId: s.court_id,
      day: s.day,
      start: s.start_time,
      end: s.end_time,
      status: taken ? 'RESERVED' : 'FREE',
      past: isStarted,
      mine,
      label: taken ? shortName(full) : '',
      // the admin sees the full name and who it is; everyone else only the short name
      ...(admin ? { name: taken ? full : '', playerId: s.player_id, guest: !!s.guest_name } : {}),
      // a player can cancel their own spot until `cancelHours` before it starts
      canCancel: mine && stampBefore(s, now, settings.cancelHours),
    };
  });
  const active = me !== null ? activeOf(me, now).length : 0;
  res.json({
    today: now.date, nowTime: now.time, from, to, days, courts, slots, settings,
    me: me !== null ? { playerId: me, active } : null,
    admin,
    canShiftBack: from > now.date,
  });
});

// true when the spot starts at least `hours` hours after now
function stampBefore(slot, now, hours) {
  const start = new Date(`${slot.day}T${slot.start_time}:00Z`).getTime();
  const current = new Date(`${now.date}T${now.time}:00Z`).getTime();
  return start - current >= hours * 3600 * 1000 && !started(slot, now);
}

// the player's own reservations (for the "my reservations" list)
router.get('/mine', (req, res) => {
  const me = getPlayerId(req);
  if (me === null) return res.status(401).json({ error: 'Please log in as a player' });
  const now = nowLocal();
  const settings = getSettings();
  const rows = db.prepare(`
    SELECT s.*, c.name AS court_name FROM court_slots s JOIN reservation_courts c ON c.id = s.court_id
    WHERE s.player_id = ? AND s.day >= ? ORDER BY s.day, s.start_time
  `).all(me, now.date).filter((s) => !(s.day === now.date && s.end_time <= now.time));
  res.json({
    settings,
    reservations: rows.map((s) => ({ id: s.id, court: s.court_name, day: s.day, start: s.start_time, end: s.end_time, started: started(s, now), canCancel: stampBefore(s, now, settings.cancelHours) })),
  });
});

// ---------------------------------------------------------------- reserving and cancelling

router.post('/slots/:id/reserve', (req, res) => {
  const me = getPlayerId(req);
  if (me === null) return res.status(401).json({ code: 'LOGIN', error: 'Please log in as a player to reserve a court' });
  const slot = slotRow(Number(req.params.id));
  if (!slot) return res.status(404).json({ error: 'That spot does not exist any more' });
  const now = nowLocal();
  const settings = getSettings();
  if (started(slot, now)) return res.status(409).json({ code: 'PAST', error: 'This time has already started' });
  if (isTaken(slot)) return res.status(409).json({ code: 'TAKEN', error: 'Somebody has just taken this spot' });
  const mine = activeOf(me, now);
  if (settings.maxActive > 0 && mine.length >= settings.maxActive) {
    return res.status(409).json({ code: 'LIMIT', error: `You can hold ${settings.maxActive} reservation${settings.maxActive === 1 ? '' : 's'} at a time — cancel one first`, maxActive: settings.maxActive });
  }
  const clash = mine.find((s) => s.day === slot.day && overlaps(s.start_time, s.end_time, slot.start_time, slot.end_time));
  if (clash) return res.status(409).json({ code: 'OVERLAP', error: 'You already have a reservation at this time' });
  // one statement decides who gets it: only a still-free spot is changed
  const changed = db.prepare("UPDATE court_slots SET player_id = ?, guest_name = '', reserved_at = ? WHERE id = ? AND player_id IS NULL AND guest_name = ''")
    .run(me, new Date().toISOString(), slot.id).changes;
  if (!changed) return res.status(409).json({ code: 'TAKEN', error: 'Somebody has just taken this spot' });
  emitChanged(req);
  res.status(201).json({ ok: true, slot: { id: slot.id, court: slot.court_name, day: slot.day, start: slot.start_time, end: slot.end_time } });
});

router.post('/slots/:id/cancel', (req, res) => {
  const slot = slotRow(Number(req.params.id));
  if (!slot) return res.status(404).json({ error: 'That spot does not exist any more' });
  if (!isTaken(slot)) return res.status(409).json({ code: 'FREE', error: 'This spot is not reserved' });
  const now = nowLocal();
  const admin = isAdmin(req);
  if (!admin) {
    const me = getPlayerId(req);
    if (me === null) return res.status(401).json({ code: 'LOGIN', error: 'Please log in as a player' });
    if (slot.player_id !== me) return res.status(403).json({ error: 'You can cancel only your own reservation' });
    const settings = getSettings();
    if (!stampBefore(slot, now, settings.cancelHours)) {
      return res.status(409).json({ code: 'TOO_LATE', error: settings.cancelHours > 0 ? `A reservation can be cancelled until ${settings.cancelHours} h before it starts — ask the admin` : 'This time has already started', cancelHours: settings.cancelHours });
    }
  }
  db.prepare("UPDATE court_slots SET player_id = NULL, guest_name = '', reserved_at = NULL WHERE id = ?").run(slot.id);
  emitChanged(req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin: courts

router.post('/courts', requireAdmin, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!name) return res.status(400).json({ error: 'The court needs a name' });
  if (name.length > 60 || note.length > 200) return res.status(400).json({ error: 'The name or the note is too long' });
  if (db.prepare('SELECT 1 FROM reservation_courts WHERE lower(name) = lower(?)').get(name)) return res.status(409).json({ error: 'A court with this name already exists' });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM reservation_courts').get().m ?? -1) + 1;
  const id = Number(db.prepare('INSERT INTO reservation_courts (name, note, sort_order) VALUES (?, ?, ?)').run(name, note, next).lastInsertRowid);
  emitChanged(req);
  res.status(201).json(db.prepare('SELECT id, name, note FROM reservation_courts WHERE id = ?').get(id));
});

router.patch('/courts/:id', requireAdmin, (req, res) => {
  const court = db.prepare('SELECT * FROM reservation_courts WHERE id = ?').get(Number(req.params.id));
  if (!court) return res.status(404).json({ error: 'Court not found' });
  const name = req.body.name === undefined ? court.name : String(req.body.name).trim();
  const note = req.body.note === undefined ? court.note : String(req.body.note).trim();
  if (!name) return res.status(400).json({ error: 'The court needs a name' });
  if (name.length > 60 || note.length > 200) return res.status(400).json({ error: 'The name or the note is too long' });
  if (db.prepare('SELECT 1 FROM reservation_courts WHERE lower(name) = lower(?) AND id != ?').get(name, court.id)) return res.status(409).json({ error: 'A court with this name already exists' });
  db.prepare('UPDATE reservation_courts SET name = ?, note = ? WHERE id = ?').run(name, note, court.id);
  emitChanged(req);
  res.json(db.prepare('SELECT id, name, note FROM reservation_courts WHERE id = ?').get(court.id));
});

// Deleting a court deletes its spots; with reservations that have not started yet it needs ?force=1 (the players lose them).
router.delete('/courts/:id', requireAdmin, (req, res) => {
  const court = db.prepare('SELECT * FROM reservation_courts WHERE id = ?').get(Number(req.params.id));
  if (!court) return res.status(404).json({ error: 'Court not found' });
  const now = nowLocal();
  const reserved = db.prepare('SELECT * FROM court_slots WHERE court_id = ?').all(court.id).filter((s) => isTaken(s) && !started(s, now));
  if (reserved.length && req.query.force !== '1') {
    return res.status(409).json({ code: 'HAS_RESERVATIONS', error: `${reserved.length} upcoming reservation${reserved.length === 1 ? '' : 's'} would be lost`, count: reserved.length });
  }
  db.prepare('DELETE FROM court_slots WHERE court_id = ?').run(court.id);
  db.prepare('DELETE FROM reservation_courts WHERE id = ?').run(court.id);
  emitChanged(req);
  res.json({ ok: true });
});

// The courts in the given order: { ids } — exactly all of them, each once.
router.post('/courts/reorder', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const current = db.prepare('SELECT id FROM reservation_courts').all().map((r) => r.id);
  if (!ids.every(Number.isInteger) || new Set(ids).size !== ids.length || ids.length !== current.length || !ids.every((id) => current.includes(id))) {
    return res.status(400).json({ error: 'The list does not match the courts' });
  }
  ids.forEach((id, i) => db.prepare('UPDATE reservation_courts SET sort_order = ? WHERE id = ?').run(i, id));
  emitChanged(req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin: spots

// Adds spots. Body: { courtIds, start, end, blockMinutes (0 = one spot for the whole range, else 30/60/90/… minutes each),
// and either date (one day) or fromDate + toDate + weekdays (1 = Monday … 7 = Sunday) }. A spot that would overlap an existing one
// on the same court is skipped (and counted). Days before today are refused.
router.post('/slots', requireAdmin, (req, res) => {
  const b = req.body || {};
  const now = nowLocal();
  const courtIds = Array.isArray(b.courtIds) ? [...new Set(b.courtIds.map(Number))] : [];
  if (!courtIds.length) return res.status(400).json({ error: 'Choose at least one court' });
  const courts = courtIds.map((id) => db.prepare('SELECT id FROM reservation_courts WHERE id = ?').get(id));
  if (courts.some((c) => !c)) return res.status(400).json({ error: 'One of the courts does not exist' });
  if (!START_TIME.test(b.start || '') || !END_TIME.test(b.end || '')) return res.status(400).json({ error: 'Times must be on the hour or the half hour, like 10:00 or 10:30' });
  if (toMinutes(b.end) <= toMinutes(b.start)) return res.status(400).json({ error: 'The end must be after the start' });
  const block = b.blockMinutes === undefined || b.blockMinutes === null || b.blockMinutes === '' ? 0 : Number(b.blockMinutes);
  if (!Number.isInteger(block) || block < 0 || (block > 0 && block % 30 !== 0)) return res.status(400).json({ error: 'The length of a spot must be a multiple of 30 minutes' });
  const total = toMinutes(b.end) - toMinutes(b.start);
  if (block > 0 && total % block !== 0) return res.status(400).json({ error: `${fromMinutes(toMinutes(b.start))}–${b.end} does not divide into ${block}-minute spots` });

  let days = [];
  if (b.date !== undefined && b.date !== null && b.date !== '') {
    if (!isRealDay(b.date)) return res.status(400).json({ error: 'The date is not valid' });
    days = [b.date];
  } else {
    if (!isRealDay(b.fromDate || '') || !isRealDay(b.toDate || '')) return res.status(400).json({ error: 'Choose the first and the last day' });
    const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((n) => n >= 1 && n <= 7) : [];
    if (!weekdays.length) return res.status(400).json({ error: 'Choose at least one weekday' });
    if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The last day is before the first day' });
    if (b.toDate > addDays(now.date, MAX_AHEAD_DAYS)) return res.status(400).json({ error: `Spots can be added up to ${MAX_AHEAD_DAYS} days ahead` });
    for (let d = b.fromDate; d <= b.toDate; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) days.push(d);
  }
  if (days.some((d) => d < now.date)) return res.status(400).json({ error: 'Spots cannot be added in the past' });
  if (days.some((d) => d > addDays(now.date, MAX_AHEAD_DAYS))) return res.status(400).json({ error: `Spots can be added up to ${MAX_AHEAD_DAYS} days ahead` });

  const pieces = [];
  if (block === 0) pieces.push([b.start, b.end]);
  else for (let m = toMinutes(b.start); m < toMinutes(b.end); m += block) pieces.push([fromMinutes(m), m + block === 1440 ? '24:00' : fromMinutes(m + block)]);
  if (days.length * pieces.length * courtIds.length > MAX_CREATE) return res.status(400).json({ error: `That would add more than ${MAX_CREATE} spots at once — use a shorter period` });

  let created = 0;
  let skipped = 0;
  const insert = db.prepare('INSERT INTO court_slots (court_id, day, start_time, end_time) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const courtId of courtIds) {
      for (const day of days) {
        const existing = db.prepare('SELECT start_time, end_time FROM court_slots WHERE court_id = ? AND day = ?').all(courtId, day);
        for (const [s, e] of pieces) {
          if (day === now.date && e <= now.time) { skipped += 1; continue; } // already over today
          if (existing.some((x) => overlaps(x.start_time, x.end_time, s, e))) { skipped += 1; continue; }
          insert.run(courtId, day, s, e);
          existing.push({ start_time: s, end_time: e });
          created += 1;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (created) emitChanged(req);
  res.status(201).json({ created, skipped });
});

// Removes spots that nobody has taken: { courtIds (empty = all), fromDate, toDate }. Reserved spots are never touched here.
router.post('/slots/clear', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!isRealDay(b.fromDate || '') || !isRealDay(b.toDate || '') || b.toDate < b.fromDate) return res.status(400).json({ error: 'Choose the first and the last day' });
  const now = nowLocal();
  const from = b.fromDate < now.date ? now.date : b.fromDate;
  const courtIds = Array.isArray(b.courtIds) ? b.courtIds.map(Number).filter(Number.isInteger) : [];
  const rows = db.prepare("SELECT id, court_id FROM court_slots WHERE day >= ? AND day <= ? AND player_id IS NULL AND guest_name = ''").all(from, b.toDate)
    .filter((s) => !courtIds.length || courtIds.includes(s.court_id));
  rows.forEach((s) => db.prepare('DELETE FROM court_slots WHERE id = ?').run(s.id));
  if (rows.length) emitChanged(req);
  res.json({ removed: rows.length });
});

// Deleting a reserved spot needs ?force=1 (the player loses the reservation).
router.delete('/slots/:id', requireAdmin, (req, res) => {
  const slot = slotRow(Number(req.params.id));
  if (!slot) return res.status(404).json({ error: 'That spot does not exist' });
  if (isTaken(slot) && req.query.force !== '1') {
    return res.status(409).json({ code: 'RESERVED', error: `${slot.guest_name || slot.player_name || 'Somebody'} has reserved this spot`, name: slot.guest_name || slot.player_name || '' });
  }
  db.prepare('DELETE FROM court_slots WHERE id = ?').run(slot.id);
  emitChanged(req);
  res.json({ ok: true });
});

// The admin puts a player (playerId) or a guest (guestName) into a free spot — the player limit does not apply.
router.post('/slots/:id/assign', requireAdmin, (req, res) => {
  const slot = slotRow(Number(req.params.id));
  if (!slot) return res.status(404).json({ error: 'That spot does not exist' });
  if (isTaken(slot)) return res.status(409).json({ code: 'TAKEN', error: 'This spot is already reserved' });
  const guest = typeof req.body.guestName === 'string' ? req.body.guestName.trim() : '';
  let playerId = null;
  if (req.body.playerId !== undefined && req.body.playerId !== null && req.body.playerId !== '') {
    playerId = Number(req.body.playerId);
    if (!db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) return res.status(400).json({ error: 'That player does not exist' });
  } else if (!guest) {
    return res.status(400).json({ error: 'Choose a player or type a name' });
  }
  if (guest.length > 60) return res.status(400).json({ error: 'The name is too long' });
  db.prepare('UPDATE court_slots SET player_id = ?, guest_name = ?, reserved_at = ? WHERE id = ?')
    .run(playerId, playerId ? '' : guest, new Date().toISOString(), slot.id);
  emitChanged(req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin: settings

router.get('/settings', requireAdmin, (req, res) => res.json(getSettings()));

router.put('/settings', requireAdmin, (req, res) => {
  const maxActive = Number(req.body.maxActive);
  const cancelHours = Number(req.body.cancelHours);
  if (!Number.isInteger(maxActive) || maxActive < 0 || maxActive > 50) return res.status(400).json({ error: 'The number of reservations per player must be 0 (no limit) to 50' });
  if (!Number.isInteger(cancelHours) || cancelHours < 0 || cancelHours > 168) return res.status(400).json({ error: 'Cancelling can be closed 0 to 168 hours before the start' });
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('reservations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ maxActive, cancelHours }));
  emitChanged(req);
  res.json(getSettings());
});

module.exports = router;
