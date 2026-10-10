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
const mailer = require('../mailer');

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

// the colour of a court's free spots ('' = the green of the site): added after the first version, so the table is upgraded in place
if (!db.prepare('PRAGMA table_info(reservation_courts)').all().some((c) => c.name === 'color')) {
  db.exec("ALTER TABLE reservation_courts ADD COLUMN color TEXT NOT NULL DEFAULT ''");
}

// the price of one hour on a court in euro (0 = no price shown): a spot costs the rate times its length
if (!db.prepare('PRAGMA table_info(reservation_courts)').all().some((c) => c.name === 'hour_rate')) {
  db.exec('ALTER TABLE reservation_courts ADD COLUMN hour_rate REAL NOT NULL DEFAULT 0');
}

for (const column of ['rate_wd_am', 'rate_wd_pm', 'rate_we']) {
  if (!db.prepare('PRAGMA table_info(reservation_courts)').all().some((c) => c.name === column)) db.exec(`ALTER TABLE reservation_courts ADD COLUMN ${column} REAL`);
}

const WINDOW_DAYS = 7;
const MAX_AHEAD_DAYS = 365;
const MAX_CREATE = 1000;
const DEFAULTS = { maxActive: 2, cancelHours: 2, afternoonFrom: '16:00' };

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

const validAfternoon = (v) => typeof v === 'string' && /^([01][0-9]|2[0-3]):[03]0$/.test(v) && v >= '06:00' && v <= '22:00';

function getSettings() {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = 'reservations'").get();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* use the defaults */ }
  return {
    maxActive: Number.isInteger(saved.maxActive) && saved.maxActive >= 0 ? saved.maxActive : DEFAULTS.maxActive,
    cancelHours: Number.isInteger(saved.cancelHours) && saved.cancelHours >= 0 ? saved.cancelHours : DEFAULTS.cancelHours,
    afternoonFrom: validAfternoon(saved.afternoonFrom) ? saved.afternoonFrom : DEFAULTS.afternoonFrom, // the prices of the afternoon start here
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

// The price of a spot in euro (0 = none), worked out half hour by half hour like the page does: weekday morning / weekday afternoon
// (from the rule `afternoonFrom`) / weekend, each falling back to the court's hour rate.
function spotPrice(court, slot, settings) {
  const weekend = isoWeekday(slot.day) >= 6;
  let eur = 0;
  for (let m = toMinutes(slot.start_time); m < toMinutes(slot.end_time); m += 30) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;
    const own = weekend ? court.rate_we : hhmm >= settings.afternoonFrom ? court.rate_wd_pm : court.rate_wd_am;
    eur += (own === null || own === undefined ? court.hour_rate : own) / 2;
  }
  return Math.round(eur * 100) / 100;
}
const euroText = (eur) => `${Number.isInteger(eur) ? eur : eur.toFixed(2).replace('.', ',')} €`;

// Tells the admin and (with an e-mail on file) the player about a reservation the player has just made. Never lets a failure reach
// the player: the reservation is already made.
function notifyReserved(slot, playerId) {
  try {
    const player = db.prepare('SELECT name, email, phone FROM players WHERE id = ?').get(playerId);
    const court = db.prepare('SELECT * FROM reservation_courts WHERE id = ?').get(slot.court_id);
    if (!player || !court) return;
    const settings = getSettings();
    const eur = spotPrice(court, slot, settings);
    mailer.sendCourtReservationEmails({
      player: { name: player.name, email: player.email || '', phone: player.phone || '' },
      court: court.name, note: court.note || '', day: slot.day, start: slot.start_time, end: slot.end_time,
      price: eur > 0 ? euroText(eur) : '', cancelHours: settings.cancelHours,
    }).catch((err) => console.error('[court reservation] e-mails failed:', err.message));
  } catch (err) {
    console.error('[court reservation] e-mails failed:', err.message);
  }
}

// Tells about a cancelled reservation (the data of the spot as it was): the admin when the player cancelled, the player (with an e-mail
// on file) either way. Never lets a failure reach whoever cancelled.
function notifyCancelled(slot, playerId, byAdmin) {
  try {
    const player = db.prepare('SELECT name, email, phone FROM players WHERE id = ?').get(playerId);
    const court = db.prepare('SELECT * FROM reservation_courts WHERE id = ?').get(slot.court_id);
    if (!player || !court) return;
    const eur = spotPrice(court, slot, getSettings());
    mailer.sendCourtCancellationEmails({
      byAdmin,
      player: { name: player.name, email: player.email || '', phone: player.phone || '' },
      court: court.name, day: slot.day, start: slot.start_time, end: slot.end_time, price: eur > 0 ? euroText(eur) : '',
    }).catch((err) => console.error('[court cancellation] e-mail failed:', err.message));
  } catch (err) {
    console.error('[court cancellation] e-mail failed:', err.message);
  }
}

// Only BLTA players can reserve a court: a player with a category (Elite, Next Gen or Novice) assigned in the backend.
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
function canReserve(playerId) {
  const row = db.prepare('SELECT category FROM players WHERE id = ?').get(playerId);
  return !!row && BLTA_CATEGORIES.includes(row.category);
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

// GET /api/reservations?from=YYYY-MM-DD — the courts and the spots of the 7 days from `from` (never before today).
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
  const courts = db.prepare(`SELECT ${COURT_COLS} FROM reservation_courts ORDER BY sort_order, id`).all().map(courtOut);
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
    me: me !== null ? { playerId: me, active, canReserve: canReserve(me) } : null,
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
  if (!canReserve(me)) return res.status(403).json({ code: 'NOT_BLTA', error: 'Only BLTA players with an assigned category can reserve a court — ask the admin' });
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
  notifyReserved(slot, me);
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
  if (slot.player_id) notifyCancelled(slot, slot.player_id, admin); // a guest's spot has no player to write to
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin: courts

// '#rrggbb' (any case) -> lowercase, '' (or nothing) -> '' (the default green); anything else -> null
const RATE_ERROR = 'The hour rate must be a number from 0 to 1000 (euro)';
// '18', '18,5', 18.5 -> a number rounded to cents; ''/null -> 0 (no price); anything else (negative, text, too big) -> null
function cleanRate(value) {
  if (value === undefined || value === null) return 0;
  const text = String(value).trim().replace(',', '.');
  if (text === '') return 0;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100) / 100;
  return n >= 0 && n <= 1000 ? n : null;
}

// the prices of a court: `hourRate` is the price of an hour at any time (0 = no price shown); `rates` can set another price for the
// weekday mornings, weekday afternoons and the weekend (all day) (null = the same as hourRate). Where "afternoon" starts is a rule.
const RATE_KEYS = { weekdayMorning: 'rate_wd_am', weekdayAfternoon: 'rate_wd_pm', weekend: 'rate_we' };
const COURT_COLS = 'id, name, note, color, hour_rate AS hourRate, rate_wd_am, rate_wd_pm, rate_we';
function courtOut(row) {
  if (!row) return row;
  const out = { id: row.id, name: row.name, note: row.note, color: row.color, hourRate: row.hourRate, rates: {} };
  Object.entries(RATE_KEYS).forEach(([key, column]) => { out.rates[key] = row[column] === undefined ? null : row[column]; });
  return out;
}
// '' / null -> null (the same as hourRate), a number >= 0 -> the number, anything else -> undefined (refused)
function cleanOverride(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(',', '.');
  if (text === '') return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) return undefined;
  const n = Math.round(Number(text) * 100) / 100;
  return n >= 0 && n <= 1000 ? n : undefined;
}
// the three other prices from a request body, keeping the court's current ones for what is not sent; { error } when one is wrong
function readRates(body, court) {
  const out = {};
  const sent = body.rates && typeof body.rates === 'object' ? body.rates : {};
  for (const [key, column] of Object.entries(RATE_KEYS)) {
    if (sent[key] === undefined) { out[column] = court ? court[column] : null; continue; }
    const v = cleanOverride(sent[key]);
    if (v === undefined) return { error: RATE_ERROR };
    out[column] = v;
  }
  return { rates: out };
}

function cleanColor(value) {
  if (value === undefined || value === null) return '';
  const v = String(value).trim().toLowerCase();
  if (v === '') return '';
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

router.post('/courts', requireAdmin, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  const color = cleanColor(req.body.color);
  const rate = cleanRate(req.body.hourRate);
  if (!name) return res.status(400).json({ error: 'The court needs a name' });
  if (name.length > 60 || note.length > 200) return res.status(400).json({ error: 'The name or the note is too long' });
  if (color === null) return res.status(400).json({ error: 'The colour must look like #1a73e8' });
  if (rate === null) return res.status(400).json({ error: RATE_ERROR });
  const extra = readRates(req.body, null);
  if (extra.error) return res.status(400).json({ error: extra.error });
  if (db.prepare('SELECT 1 FROM reservation_courts WHERE lower(name) = lower(?)').get(name)) return res.status(409).json({ error: 'A court with this name already exists' });
  const next = (db.prepare('SELECT MAX(sort_order) AS m FROM reservation_courts').get().m ?? -1) + 1;
  const id = Number(db.prepare('INSERT INTO reservation_courts (name, note, sort_order, color, hour_rate, rate_wd_am, rate_wd_pm, rate_we) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, note, next, color, rate, extra.rates.rate_wd_am, extra.rates.rate_wd_pm, extra.rates.rate_we).lastInsertRowid);
  emitChanged(req);
  res.status(201).json(courtOut(db.prepare(`SELECT ${COURT_COLS} FROM reservation_courts WHERE id = ?`).get(id)));
});

router.patch('/courts/:id', requireAdmin, (req, res) => {
  const court = db.prepare('SELECT * FROM reservation_courts WHERE id = ?').get(Number(req.params.id));
  if (!court) return res.status(404).json({ error: 'Court not found' });
  const name = req.body.name === undefined ? court.name : String(req.body.name).trim();
  const note = req.body.note === undefined ? court.note : String(req.body.note).trim();
  const color = req.body.color === undefined ? court.color : cleanColor(req.body.color);
  const rate = req.body.hourRate === undefined ? court.hour_rate : cleanRate(req.body.hourRate);
  if (!name) return res.status(400).json({ error: 'The court needs a name' });
  if (name.length > 60 || note.length > 200) return res.status(400).json({ error: 'The name or the note is too long' });
  if (color === null) return res.status(400).json({ error: 'The colour must look like #1a73e8' });
  if (rate === null) return res.status(400).json({ error: RATE_ERROR });
  const extra = readRates(req.body, court);
  if (extra.error) return res.status(400).json({ error: extra.error });
  if (db.prepare('SELECT 1 FROM reservation_courts WHERE lower(name) = lower(?) AND id != ?').get(name, court.id)) return res.status(409).json({ error: 'A court with this name already exists' });
  db.prepare('UPDATE reservation_courts SET name = ?, note = ?, color = ?, hour_rate = ?, rate_wd_am = ?, rate_wd_pm = ?, rate_we = ? WHERE id = ?').run(name, note, color, rate, extra.rates.rate_wd_am, extra.rates.rate_wd_pm, extra.rates.rate_we, court.id);
  emitChanged(req);
  res.json(courtOut(db.prepare(`SELECT ${COURT_COLS} FROM reservation_courts WHERE id = ?`).get(court.id)));
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

// Moves many spots at once, e.g. every Thursday evening one hour later. Body: { courtIds (empty = all), fromDate, toDate, weekdays (empty =
// every day), startFrom / startUntil (only spots starting between these times), shiftMinutes (a multiple of 30, may be negative), toCourtId
// (optional: move them to this court), includeReserved (default false: reserved spots stay where they are), dryRun }.
// The result is checked as a whole: a spot that would end up overlapping a spot that stays (or another moved one), cross midnight or
// land in the past is left where it is and counted — nothing is half-done. dryRun only reports what would happen.
router.post('/slots/bulk-edit', requireAdmin, (req, res) => {
  const b = req.body || {};
  const now = nowLocal();
  if (!isRealDay(b.fromDate || '') || !isRealDay(b.toDate || '') || b.toDate < b.fromDate) return res.status(400).json({ error: 'Choose the first and the last day' });
  if (b.toDate > addDays(now.date, MAX_AHEAD_DAYS)) return res.status(400).json({ error: `Spots can be moved up to ${MAX_AHEAD_DAYS} days ahead` });
  const shift = b.shiftMinutes === undefined || b.shiftMinutes === null || b.shiftMinutes === '' ? 0 : Number(b.shiftMinutes);
  if (!Number.isInteger(shift) || shift % 30 !== 0 || Math.abs(shift) > 720) return res.status(400).json({ error: 'The shift must be a multiple of 30 minutes, up to 12 hours' });
  let toCourt = null;
  if (b.toCourtId !== undefined && b.toCourtId !== null && b.toCourtId !== '') {
    toCourt = Number(b.toCourtId);
    if (!db.prepare('SELECT 1 FROM reservation_courts WHERE id = ?').get(toCourt)) return res.status(400).json({ error: 'That court does not exist' });
  }
  // the length: set to exactly lengthMinutes, or changed by lengthDelta (both multiples of 30; the start stays, the end moves)
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const setLength = num(b.lengthMinutes);
  const lengthDelta = num(b.lengthDelta) || 0;
  if (setLength !== null && (!Number.isInteger(setLength) || setLength % 30 !== 0 || setLength < 30 || setLength > 720)) return res.status(400).json({ error: 'The length must be a multiple of 30 minutes, from 30 minutes to 12 hours' });
  if (!Number.isInteger(lengthDelta) || lengthDelta % 30 !== 0 || Math.abs(lengthDelta) > 720) return res.status(400).json({ error: 'The change of length must be a multiple of 30 minutes, up to 12 hours' });
  if (setLength !== null && lengthDelta !== 0) return res.status(400).json({ error: 'Set the length or change it, not both' });
  if (shift === 0 && toCourt === null && setLength === null && lengthDelta === 0) return res.status(400).json({ error: 'Choose a change: the time, the length or a court' });
  const startFrom = b.startFrom ? String(b.startFrom) : '';
  const startUntil = b.startUntil ? String(b.startUntil) : '';
  if ((startFrom && !START_TIME.test(startFrom)) || (startUntil && !START_TIME.test(startUntil))) return res.status(400).json({ error: 'The times of the filter must be on the hour or the half hour' });
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((n) => n >= 1 && n <= 7) : [];
  const courtIds = Array.isArray(b.courtIds) ? b.courtIds.map(Number).filter(Number.isInteger) : [];
  const from = b.fromDate < now.date ? now.date : b.fromDate;

  const inRange = db.prepare('SELECT * FROM court_slots WHERE day >= ? AND day <= ?').all(from, b.toDate);
  const matched = inRange.filter((s) => (!courtIds.length || courtIds.includes(s.court_id))
    && (!weekdays.length || weekdays.includes(isoWeekday(s.day)))
    && (!startFrom || s.start_time >= startFrom) && (!startUntil || s.start_time <= startUntil));
  if (matched.length > 2000) return res.status(400).json({ error: 'That matches more than 2000 spots — use a shorter period' });

  const result = { matched: matched.length, moved: 0, skippedReserved: 0, skippedInvalid: 0, skippedConflict: 0, examples: [] };
  const staying = new Set(); // ids of spots that do not move
  const target = new Map(); // id -> { court, start, end }
  const courtLabel = (id) => (db.prepare('SELECT name FROM reservation_courts WHERE id = ?').get(id) || {}).name || '?';
  const note = (s, why) => { if (result.examples.length < 5) result.examples.push(`${courtLabel(s.court_id)} ${s.day} ${s.start_time}–${s.end_time}: ${why}`); };
  matched.forEach((s) => {
    if (isTaken(s) && !b.includeReserved) { staying.add(s.id); result.skippedReserved += 1; return; }
    const start = toMinutes(s.start_time) + shift;
    const length = setLength !== null ? setLength : toMinutes(s.end_time) - toMinutes(s.start_time) + lengthDelta;
    const end = start + length;
    if (length < 30) { staying.add(s.id); result.skippedInvalid += 1; note(s, 'would be shorter than 30 minutes'); return; }
    if (start < 0 || end > 1440) { staying.add(s.id); result.skippedInvalid += 1; note(s, 'would cross midnight'); return; }
    if (s.day === now.date && fromMinutes(end === 1440 ? 1439 : end) <= now.time) { staying.add(s.id); result.skippedInvalid += 1; note(s, 'that time is already over today'); return; }
    target.set(s.id, { court: toCourt === null ? s.court_id : toCourt, start: fromMinutes(start), end: end === 1440 ? '24:00' : fromMinutes(end) });
  });
  // a spot whose new place overlaps a spot that stays (or another moved spot) stays too; repeat until nothing changes
  const placeOf = (s) => (target.has(s.id) ? target.get(s.id) : { court: s.court_id, start: s.start_time, end: s.end_time });
  const clashOf = (s) => {
    const t = target.get(s.id);
    return inRange.find((o) => o.id !== s.id && o.day === s.day && placeOf(o).court === t.court && overlaps(placeOf(o).start, placeOf(o).end, t.start, t.end));
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of matched) {
      if (!target.has(s.id)) continue;
      const other = clashOf(s);
      if (other) { target.delete(s.id); staying.add(s.id); result.skippedConflict += 1; note(s, `would overlap the spot ${placeOf(other).start}–${placeOf(other).end}`); changed = true; }
    }
  }
  result.moved = target.size;
  if (!b.dryRun && target.size) {
    const update = db.prepare('UPDATE court_slots SET court_id = ?, start_time = ?, end_time = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      target.forEach((t, id) => update.run(t.court, t.start, t.end, id));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    emitChanged(req);
  }
  res.json({ ...result, dryRun: !!b.dryRun });
});

// Changes a spot: { courtId, day, start, end } — any of them. A free spot is changed as asked; a reserved one needs { force: true }
// (the player keeps the reservation, now at the new time or place). The new place must not overlap another spot of that court.
router.patch('/slots/:id', requireAdmin, (req, res) => {
  const slot = slotRow(Number(req.params.id));
  if (!slot) return res.status(404).json({ error: 'That spot does not exist' });
  const b = req.body || {};
  const now = nowLocal();
  const next = {
    courtId: b.courtId === undefined ? slot.court_id : Number(b.courtId),
    day: b.day === undefined ? slot.day : b.day,
    start: b.start === undefined ? slot.start_time : b.start,
    end: b.end === undefined ? slot.end_time : b.end,
  };
  if (!db.prepare('SELECT 1 FROM reservation_courts WHERE id = ?').get(next.courtId)) return res.status(400).json({ error: 'That court does not exist' });
  if (!START_TIME.test(next.start || '') || !END_TIME.test(next.end || '')) return res.status(400).json({ error: 'Times must be on the hour or the half hour, like 10:00 or 10:30' });
  if (toMinutes(next.end) <= toMinutes(next.start)) return res.status(400).json({ error: 'The end must be after the start' });
  if (!isRealDay(next.day || '')) return res.status(400).json({ error: 'The date is not valid' });
  if (next.day < now.date) return res.status(400).json({ error: 'A spot cannot be moved into the past' });
  if (next.day > addDays(now.date, MAX_AHEAD_DAYS)) return res.status(400).json({ error: `Spots can be added up to ${MAX_AHEAD_DAYS} days ahead` });
  if (next.day === now.date && next.end <= now.time) return res.status(400).json({ error: 'That time is already over today' });
  const clash = db.prepare('SELECT start_time, end_time FROM court_slots WHERE court_id = ? AND day = ? AND id != ?').all(next.courtId, next.day, slot.id)
    .find((x) => overlaps(x.start_time, x.end_time, next.start, next.end));
  if (clash) return res.status(409).json({ code: 'CLASH', error: `There is already a spot from ${clash.start_time} to ${clash.end_time} on that court that day` });
  if (isTaken(slot) && !(b.force === true || b.force === 1 || b.force === '1')) {
    return res.status(409).json({ code: 'RESERVED', error: `${slot.guest_name || slot.player_name || 'Somebody'} has reserved this spot`, name: slot.guest_name || slot.player_name || '' });
  }
  db.prepare('UPDATE court_slots SET court_id = ?, day = ?, start_time = ?, end_time = ? WHERE id = ?').run(next.courtId, next.day, next.start, next.end, slot.id);
  emitChanged(req);
  res.json({ ok: true });
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
  const afternoonFrom = req.body.afternoonFrom === undefined ? getSettings().afternoonFrom : req.body.afternoonFrom;
  if (!validAfternoon(afternoonFrom)) return res.status(400).json({ error: 'The afternoon prices can start at a full or half hour between 06:00 and 22:00' });
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('reservations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ maxActive, cancelHours, afternoonFrom }));
  emitChanged(req);
  res.json(getSettings());
});

module.exports = router;
