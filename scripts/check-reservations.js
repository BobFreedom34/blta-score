// Checks of the court reservations (/api/reservations, the page /rezervacie-kurtov): courts, spots, the 10-day window, reserving (one
// winner when two players click at once, the limits), cancelling (own, too late, the admin), the admin's tools and the settings.
// The server's clock is fixed (RESERVATIONS_NOW) so the checks give the same result on any day.
// Run: node scripts/check-reservations.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cookieSignature = require('cookie-signature');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-server-'));
const NOW = { date: '2026-10-09', time: '10:15' }; // a Friday

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;
let n = 0;

function addDays(day, k) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  date.setUTCDate(date.getUTCDate() + k);
  return date.toISOString().slice(0, 10);
}
const D = (k) => addDays(NOW.date, k);

const playerCookie = (id) => `blta_player=${encodeURIComponent(`s:${cookieSignature.sign(String(id), 'test')}`)}`;
async function call(method, url, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });
const as = (playerId, method, url, body) => call(method, url, { body, cookie: playerCookie(playerId) });
const newPlayer = (name) => Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, `rv-${n += 1}`).lastInsertRowid);
const view = async (from, cookie) => (await call('GET', `/api/reservations${from ? `?from=${from}` : ''}`, { cookie })).json;
const slotsOf = async (day, courtId) => (await view(day, adminCookie)).slots.filter((s) => s.day === day && (!courtId || s.courtId === courtId));

const S = {};

// ---------------------------------------------------------------- courts
test('courts: the admin adds, renames and orders them; anybody sees them in that order', async () => {
  const c1 = await admin('POST', '/api/reservations/courts', { name: 'Court 1', note: 'antuka' });
  const c2 = await admin('POST', '/api/reservations/courts', { name: 'Court 2' });
  const c3 = await admin('POST', '/api/reservations/courts', { name: 'Court 3' });
  assert.deepStrictEqual([c1.status, c2.status, c3.status], [201, 201, 201]);
  [S.c1, S.c2, S.c3] = [c1.json.id, c2.json.id, c3.json.id];
  assert.strictEqual((await admin('POST', '/api/reservations/courts', { name: 'court 1' })).status, 409, 'same name, any case');
  assert.strictEqual((await admin('POST', '/api/reservations/courts', { name: '  ' })).status, 400);
  assert.strictEqual((await admin('POST', '/api/reservations/courts', { name: 'x'.repeat(61) })).status, 400);
  assert.strictEqual((await call('POST', '/api/reservations/courts', { body: { name: 'Sneaky' } })).status, 401);
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c3}`, { name: 'Court 3 (hala)' })).json.name, 'Court 3 (hala)');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c3}`, { name: 'Court 2' })).status, 409);
  assert.strictEqual((await admin('POST', '/api/reservations/courts/reorder', { ids: [S.c3, S.c1, S.c2] })).status, 200);
  assert.deepStrictEqual((await view()).courts.map((c) => c.name), ['Court 3 (hala)', 'Court 1', 'Court 2']);
  assert.strictEqual((await admin('POST', '/api/reservations/courts/reorder', { ids: [S.c1] })).status, 400);
  assert.strictEqual((await admin('POST', '/api/reservations/courts/reorder', { ids: [S.c1, S.c1, S.c2] })).status, 400);
  await admin('POST', '/api/reservations/courts/reorder', { ids: [S.c1, S.c2, S.c3] });
  assert.deepStrictEqual((await view()).courts.map((c) => c.id), [S.c1, S.c2, S.c3]);
});

// ---------------------------------------------------------------- spots
test('spots: Thursday 10:00-12:00 is one spot; overlaps are skipped; blocks split a range', async () => {
  const one = await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(6), start: '10:00', end: '12:00' });
  assert.deepStrictEqual(one.json, { created: 1, skipped: 0 });
  const [slot] = await slotsOf(D(6), S.c1);
  assert.deepStrictEqual([slot.start, slot.end, slot.status], ['10:00', '12:00', 'FREE']);
  // overlapping the same court: skipped; the next court and the next half hour are fine
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(6), start: '11:00', end: '13:00' })).json, { created: 0, skipped: 1 });
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c1, S.c2], date: D(6), start: '12:00', end: '13:00' })).json, { created: 2, skipped: 0 });
  // 14:00-18:00 in one-hour spots on two courts
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c1, S.c2], date: D(6), start: '14:00', end: '18:00', blockMinutes: 60 })).json, { created: 8, skipped: 0 });
  assert.strictEqual((await slotsOf(D(6), S.c2)).length, 5);
  // 30-minute spots, including one that ends at midnight
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: D(7), start: '23:00', end: '24:00', blockMinutes: 30 })).json, { created: 2, skipped: 0 });
  assert.deepStrictEqual((await slotsOf(D(7), S.c3)).map((s) => [s.start, s.end]), [['23:00', '23:30'], ['23:30', '24:00']]);
});

test('spots: bad input is refused', async () => {
  const bad = [
    [{ courtIds: [S.c1], date: D(8), start: '10:15', end: '11:00' }, /hour or the half hour/],
    [{ courtIds: [S.c1], date: D(8), start: '10:00', end: '10:00' }, /after the start/],
    [{ courtIds: [S.c1], date: D(8), start: '12:00', end: '10:00' }, /after the start/],
    [{ courtIds: [S.c1], date: D(8), start: '14:00', end: '17:30', blockMinutes: 60 }, /divide/],
    [{ courtIds: [S.c1], date: D(8), start: '14:00', end: '17:00', blockMinutes: 45 }, /multiple of 30/],
    [{ courtIds: [], date: D(8), start: '10:00', end: '11:00' }, /at least one court/],
    [{ courtIds: [99999], date: D(8), start: '10:00', end: '11:00' }, /does not exist/],
    [{ courtIds: [S.c1], date: D(-1), start: '10:00', end: '11:00' }, /in the past/],
    [{ courtIds: [S.c1], date: '2026-02-30', start: '10:00', end: '11:00' }, /not valid/],
    [{ courtIds: [S.c1], fromDate: D(1), toDate: D(5), weekdays: [], start: '10:00', end: '11:00' }, /weekday/],
    [{ courtIds: [S.c1], fromDate: D(5), toDate: D(1), weekdays: [1], start: '10:00', end: '11:00' }, /before the first/],
    [{ courtIds: [S.c1], fromDate: D(1), toDate: D(400), weekdays: [1], start: '10:00', end: '11:00' }, /days ahead/],
    [{ courtIds: [S.c1, S.c2, S.c3], fromDate: D(1), toDate: D(300), weekdays: [1, 2, 3, 4, 5, 6, 7], start: '06:00', end: '22:00', blockMinutes: 30 }, /more than 1000/],
  ];
  for (const [body, pattern] of bad) {
    const r = await admin('POST', '/api/reservations/slots', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
    assert.ok(pattern.test(r.json.error), `${JSON.stringify(body)}: ${r.json.error}`);
  }
  assert.strictEqual((await call('POST', '/api/reservations/slots', { body: { courtIds: [S.c1], date: D(8), start: '10:00', end: '11:00' } })).status, 401);
});

test('spots: a repeating pattern adds the chosen weekdays; today only what has not ended', async () => {
  // Mondays and Wednesdays between D(10) and D(24)
  const r = await admin('POST', '/api/reservations/slots', { courtIds: [S.c2], fromDate: D(10), toDate: D(24), weekdays: [1, 3], start: '18:00', end: '20:00' });
  const expected = []; for (let k = 10; k <= 24; k += 1) { const w = new Date(`${D(k)}T12:00:00Z`).getUTCDay(); if (w === 1 || w === 3) expected.push(D(k)); }
  assert.deepStrictEqual(r.json, { created: expected.length, skipped: 0 });
  const got = (await view(D(10))).slots.filter((s) => s.courtId === S.c2 && s.start === '18:00').map((s) => s.day);
  assert.ok(expected.slice(0, 4).every((d) => got.includes(d)));
  // today, now 10:15: the 09:00 hour is over (skipped), 12:00 and 17:00 are still to come
  const today = await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '09:00', end: '10:00' });
  assert.deepStrictEqual(today.json, { created: 0, skipped: 1 });
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '12:00', end: '13:00' })).json, { created: 1, skipped: 0 });
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '10:00', end: '11:00' })).json, { created: 1, skipped: 0 }, 'one that is running now still can be added');
});

// ---------------------------------------------------------------- the window
test('the window: 10 days from today, never before it; the public sees short names, the admin full ones', async () => {
  const w = await view();
  assert.deepStrictEqual([w.today, w.from, w.to, w.days.length, w.canShiftBack], [NOW.date, NOW.date, D(9), 10, false]);
  assert.strictEqual((await view(D(-5))).from, NOW.date, 'an earlier start is moved to today');
  const next = await view(D(10));
  assert.deepStrictEqual([next.from, next.to, next.canShiftBack], [D(10), D(19), true]);
  assert.strictEqual((await view('nonsense')).from, NOW.date);
  assert.ok(w.slots.every((s) => s.day >= NOW.date && s.day <= D(9)));
  assert.strictEqual(w.me, null);
  assert.strictEqual(w.admin, false);
  assert.strictEqual((await view(undefined, adminCookie)).admin, true);
  // a slot that has started is marked past
  const todays = (await view()).slots.filter((s) => s.day === NOW.date);
  assert.ok(todays.find((s) => s.start === '10:00').past, 'the 10:00 spot started 15 minutes ago');
  assert.ok(!todays.find((s) => s.start === '12:00').past);
});

// ---------------------------------------------------------------- reserving
test('reserving: only a logged-in player; the name goes into the spot; a second player cannot take it', async () => {
  S.a = newPlayer('Anna Testová');
  S.b = newPlayer('Boris Skúšobný');
  const spot = (await slotsOf(D(6), S.c1)).find((s) => s.start === '10:00');
  S.spot = spot.id;
  assert.strictEqual((await call('POST', `/api/reservations/slots/${spot.id}/reserve`)).status, 401, 'not logged in');
  const ok = await as(S.a, 'POST', `/api/reservations/slots/${spot.id}/reserve`);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.deepStrictEqual([ok.json.slot.start, ok.json.slot.end, ok.json.slot.court], ['10:00', '12:00', 'Court 1']);
  const asB = (await call('GET', `/api/reservations?from=${D(6)}`, { cookie: playerCookie(S.b) })).json.slots.find((s) => s.id === spot.id);
  assert.deepStrictEqual([asB.status, asB.label, asB.mine, asB.name], ['RESERVED', 'Anna T.', false, undefined], 'others see a short name only');
  const asA = (await call('GET', `/api/reservations?from=${D(6)}`, { cookie: playerCookie(S.a) })).json;
  assert.strictEqual(asA.slots.find((s) => s.id === spot.id).mine, true);
  assert.deepStrictEqual(asA.me, { playerId: S.a, active: 1 });
  const full = (await slotsOf(D(6), S.c1)).find((s) => s.id === spot.id);
  assert.deepStrictEqual([full.name, full.playerId], ['Anna Testová', S.a], 'the admin sees the full name');
  const second = await as(S.b, 'POST', `/api/reservations/slots/${spot.id}/reserve`);
  assert.deepStrictEqual([second.status, second.json.code], [409, 'TAKEN']);
  assert.strictEqual((await as(S.a, 'POST', `/api/reservations/slots/${spot.id}/reserve`)).status, 409, 'not twice');
  assert.strictEqual((await as(S.a, 'POST', '/api/reservations/slots/999999/reserve')).status, 404);
});

test('reserving: two players at the same moment — exactly one gets it', async () => {
  const spot = (await slotsOf(D(6), S.c2)).find((s) => s.start === '12:00');
  const [x, y, z] = await Promise.all([
    as(S.a, 'POST', `/api/reservations/slots/${spot.id}/reserve`),
    as(S.b, 'POST', `/api/reservations/slots/${spot.id}/reserve`),
    as(newPlayer('Cyril Tretí'), 'POST', `/api/reservations/slots/${spot.id}/reserve`),
  ]);
  const codes = [x.status, y.status, z.status].sort();
  assert.deepStrictEqual(codes, [201, 409, 409], JSON.stringify([x.json, y.json, z.json]));
  const holder = (await slotsOf(D(6), S.c2)).find((s) => s.id === spot.id);
  assert.strictEqual(holder.status, 'RESERVED');
  // clean up for the later checks
  await admin('POST', `/api/reservations/slots/${spot.id}/cancel`);
});

test('reserving: a spot that has started cannot be taken; the player limit and overlaps are enforced', async () => {
  const running = (await slotsOf(NOW.date, S.c3)).find((s) => s.start === '10:00');
  const r = await as(S.b, 'POST', `/api/reservations/slots/${running.id}/reserve`);
  assert.deepStrictEqual([r.status, r.json.code], [409, 'PAST']);
  // default limit: 2 at a time. Anna holds one (D(6) 10:00); a second is fine, a third is not
  const free = (await slotsOf(D(6))).filter((s) => s.status === 'FREE' && s.courtId === S.c1 && s.start >= '14:00');
  assert.strictEqual((await as(S.a, 'POST', `/api/reservations/slots/${free[0].id}/reserve`)).status, 201);
  const third = await as(S.a, 'POST', `/api/reservations/slots/${free[1].id}/reserve`);
  assert.deepStrictEqual([third.status, third.json.code], [409, 'LIMIT']);
  // with a higher limit she can go on, but not into a time she already holds on another court
  assert.strictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 5, cancelHours: 2 })).status, 200);
  const sameTimeOtherCourt = (await slotsOf(D(6), S.c2)).find((s) => s.start === free[0].start);
  const clash = await as(S.a, 'POST', `/api/reservations/slots/${sameTimeOtherCourt.id}/reserve`);
  assert.deepStrictEqual([clash.status, clash.json.code], [409, 'OVERLAP']);
  const clash2 = (await slotsOf(D(6), S.c2)).find((s) => s.start === '12:00' && s.status === 'FREE');
  assert.strictEqual((await as(S.a, 'POST', `/api/reservations/slots/${clash2.id}/reserve`)).status, 201, 'a different time works');
  // no limit at all
  await admin('PUT', '/api/reservations/settings', { maxActive: 0, cancelHours: 2 });
  assert.strictEqual((await as(S.a, 'POST', `/api/reservations/slots/${free[1].id}/reserve`)).status, 201);
  S.annasSpots = [S.spot, free[0].id, clash2.id, free[1].id];
});

// ---------------------------------------------------------------- cancelling
test('cancelling: your own, not another player\'s; the admin may cancel any', async () => {
  assert.strictEqual((await as(S.b, 'POST', `/api/reservations/slots/${S.spot}/cancel`)).status, 403);
  assert.strictEqual((await call('POST', `/api/reservations/slots/${S.spot}/cancel`)).status, 401);
  assert.strictEqual((await as(S.a, 'POST', `/api/reservations/slots/${S.spot}/cancel`)).status, 200);
  assert.strictEqual((await slotsOf(D(6), S.c1)).find((s) => s.id === S.spot).status, 'FREE');
  const again = await as(S.a, 'POST', `/api/reservations/slots/${S.spot}/cancel`);
  assert.deepStrictEqual([again.status, again.json.code], [409, 'FREE']);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${S.annasSpots[1]}/cancel`)).status, 200);
});

test('cancelling: a player can cancel until cancelHours before the start, the admin always', async () => {
  // today 12:00, now 10:15 — 1 h 45 min ahead; the limit is 2 h
  const soon = (await slotsOf(NOW.date, S.c3)).find((s) => s.start === '12:00');
  assert.strictEqual((await as(S.b, 'POST', `/api/reservations/slots/${soon.id}/reserve`)).status, 201);
  const view1 = (await call('GET', '/api/reservations', { cookie: playerCookie(S.b) })).json.slots.find((s) => s.id === soon.id);
  assert.strictEqual(view1.canCancel, false);
  const late = await as(S.b, 'POST', `/api/reservations/slots/${soon.id}/cancel`);
  assert.deepStrictEqual([late.status, late.json.code], [409, 'TOO_LATE']);
  await admin('PUT', '/api/reservations/settings', { maxActive: 0, cancelHours: 1 });
  assert.strictEqual((await call('GET', '/api/reservations', { cookie: playerCookie(S.b) })).json.slots.find((s) => s.id === soon.id).canCancel, true);
  assert.strictEqual((await as(S.b, 'POST', `/api/reservations/slots/${soon.id}/cancel`)).status, 200);
  await as(S.b, 'POST', `/api/reservations/slots/${soon.id}/reserve`);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${soon.id}/cancel`)).status, 200, 'the admin is not bound by the limit');
  await admin('PUT', '/api/reservations/settings', { maxActive: 0, cancelHours: 2 });
});

test('my reservations: login needed; only upcoming ones, with whether they can still be cancelled', async () => {
  assert.strictEqual((await call('GET', '/api/reservations/mine')).status, 401);
  const mine = (await as(S.a, 'GET', '/api/reservations/mine')).json;
  assert.ok(mine.reservations.length >= 2);
  assert.ok(mine.reservations.every((r) => r.day >= NOW.date && r.canCancel === true && r.started === false));
  assert.deepStrictEqual(mine.settings, { maxActive: 0, cancelHours: 2 });
  assert.deepStrictEqual((await as(S.b, 'GET', '/api/reservations/mine')).json.reservations, []);
});

// ---------------------------------------------------------------- the admin's tools
test('admin: assign a player or a guest, delete a spot (a reserved one only when forced), clear the free ones', async () => {
  const free = (await slotsOf(D(6), S.c1)).find((s) => s.id === S.spot);
  assert.strictEqual((await call('POST', `/api/reservations/slots/${free.id}/assign`, { body: { guestName: 'Hosť' } })).status, 401);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${free.id}/assign`, {})).status, 400);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${free.id}/assign`, { playerId: 999999 })).status, 400);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${free.id}/assign`, { guestName: 'Tréner Ján' })).status, 200);
  const guest = (await slotsOf(D(6), S.c1)).find((s) => s.id === free.id);
  assert.deepStrictEqual([guest.status, guest.label, guest.name, guest.guest, guest.playerId], ['RESERVED', 'Tréner J.', 'Tréner Ján', true, null]);
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${free.id}/assign`, { playerId: S.b })).status, 409);
  // delete: reserved needs force
  const refused = await admin('DELETE', `/api/reservations/slots/${free.id}`);
  assert.deepStrictEqual([refused.status, refused.json.code, refused.json.name], [409, 'RESERVED', 'Tréner Ján']);
  assert.strictEqual((await admin('DELETE', `/api/reservations/slots/${free.id}?force=1`)).status, 200);
  assert.strictEqual((await slotsOf(D(6), S.c1)).some((s) => s.id === free.id), false);
  assert.strictEqual((await admin('DELETE', `/api/reservations/slots/${free.id}`)).status, 404);
  // a player is put in by the admin without the limit
  const another = (await slotsOf(D(6), S.c2)).find((s) => s.status === 'FREE');
  assert.strictEqual((await admin('POST', `/api/reservations/slots/${another.id}/assign`, { playerId: S.a })).status, 200);
  // clear the free spots of one court and period: the reserved ones stay
  const before = (await slotsOf(D(6), S.c2)).length;
  const reservedBefore = (await slotsOf(D(6), S.c2)).filter((s) => s.status === 'RESERVED').length;
  const cleared = await admin('POST', '/api/reservations/slots/clear', { courtIds: [S.c2], fromDate: D(6), toDate: D(6) });
  assert.strictEqual(cleared.json.removed, before - reservedBefore);
  assert.strictEqual((await slotsOf(D(6), S.c2)).length, reservedBefore);
  assert.strictEqual((await admin('POST', '/api/reservations/slots/clear', { fromDate: 'x', toDate: D(6) })).status, 400);
  assert.strictEqual((await call('POST', '/api/reservations/slots/clear', { body: { fromDate: D(6), toDate: D(6) } })).status, 401);
});

test('admin: a court with upcoming reservations is deleted only when forced, with its spots', async () => {
  const refused = await admin('DELETE', `/api/reservations/courts/${S.c2}`);
  assert.deepStrictEqual([refused.status, refused.json.code], [409, 'HAS_RESERVATIONS']);
  assert.ok(refused.json.count >= 1);
  assert.strictEqual((await admin('DELETE', `/api/reservations/courts/${S.c2}?force=1`)).status, 200);
  assert.deepStrictEqual((await view()).courts.map((c) => c.id), [S.c1, S.c3]);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM court_slots WHERE court_id = ?').get(S.c2).n, 0);
  assert.strictEqual((await admin('DELETE', `/api/reservations/courts/${S.c2}`)).status, 404);
});

test('settings: admin only, checked, and shown on the page data', async () => {
  assert.strictEqual((await call('GET', '/api/reservations/settings')).status, 401);
  assert.strictEqual((await call('PUT', '/api/reservations/settings', { body: { maxActive: 1, cancelHours: 1 } })).status, 401);
  for (const body of [{ maxActive: -1, cancelHours: 2 }, { maxActive: 51, cancelHours: 2 }, { maxActive: 1.5, cancelHours: 2 }, { maxActive: 2, cancelHours: 169 }, { maxActive: 2 }, {}]) {
    assert.strictEqual((await admin('PUT', '/api/reservations/settings', body)).status, 400, JSON.stringify(body));
  }
  assert.deepStrictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 3, cancelHours: 12 })).json, { maxActive: 3, cancelHours: 12 });
  assert.deepStrictEqual((await view()).settings, { maxActive: 3, cancelHours: 12 });
  assert.deepStrictEqual((await admin('GET', '/api/reservations/settings')).json, { maxActive: 3, cancelHours: 12 });
});

// ---------------------------------------------------------------- the page and the search engines
test('page: /rezervacie-kurtov and /en/court-booking exist, the code address is retired, the sitemap lists both', async () => {
  const sk = await fetch(`${BASE}/rezervacie-kurtov`);
  const html = await sk.text();
  assert.strictEqual(sk.status, 200);
  assert.ok(/<title>Rezervácie kurtov - BLTA/.test(html), (html.match(/<title>[^<]*/) || [])[0]);
  assert.ok(html.includes('/js/reservations.js'));
  const en = await fetch(`${BASE}/en/court-booking`);
  assert.strictEqual(en.status, 200);
  assert.ok(/<title>Court booking - BLTA/.test(await en.text()));
  assert.strictEqual((await fetch(`${BASE}/reservations`)).status, 404);
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  assert.ok(sitemap.includes('/rezervacie-kurtov</loc>') && sitemap.includes('/en/court-booking</loc>'));
  const seo = (await admin('GET', '/api/seo')).json.find((p) => p.key === 'reservations');
  assert.deepStrictEqual(seo.slugs, { sk: 'rezervacie-kurtov', en: 'court-booking' });
  assert.ok((await (await fetch(`${BASE}/robots.txt`)).text()).includes('Disallow: /reservations-admin'));
  assert.strictEqual((await fetch(`${BASE}/reservations-admin`)).status, 200);
});

// ---------------------------------------------------------------- run
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', RESERVATIONS_NOW: `${NOW.date} ${NOW.time}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
  db = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  db.exec('PRAGMA busy_timeout = 5000');
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (db) db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
