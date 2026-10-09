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

// ---------------------------------------------------------------- a tiny SMTP server that keeps the e-mails the app sends
const net = require('net');
const mails = [];
let smtpPort = 0;
function startSmtpSink() {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = '';
      let inData = false;
      let from = '';
      let rcpts = [];
      const send = (s) => sock.write(`${s}\r\n`);
      send('220 sink ESMTP');
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          if (inData) {
            const i = buf.indexOf('\r\n.\r\n');
            if (i < 0) return;
            mails.push({ from, to: rcpts.slice(), raw: buf.slice(0, i) });
            buf = buf.slice(i + 5);
            inData = false;
            rcpts = [];
            send('250 queued');
            continue;
          }
          const i = buf.indexOf('\r\n');
          if (i < 0) return;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO') sock.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n');
          else if (cmd === 'AUTH') send('235 ok');
          else if (cmd === 'MAIL') { from = line; send('250 ok'); }
          else if (cmd === 'RCPT') { rcpts.push(line.replace(/^RCPT TO:\s*<?/i, '').replace(/>?\s*$/, '')); send('250 ok'); }
          else if (cmd === 'DATA') { inData = true; send('354 go'); }
          else if (cmd === 'QUIT') { send('221 bye'); sock.end(); }
          else send('250 ok');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => { smtpPort = server.address().port; resolve(server); });
  });
}
// subject and text of a kept e-mail, decoded (quoted-printable / base64 / encoded words)
function readMail(m) {
  const [head, ...rest] = m.raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  const header = (name) => (new RegExp(String.raw`^${name}:\s*([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)`, 'im').exec(head) || [])[1] || '';
  const words = (v) => v.replace(/\r?\n[ \t]/g, '').replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (all, kind, data) => (kind.toUpperCase() === 'B'
    ? Buffer.from(data, 'base64').toString('utf8')
    : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')));
  const cte = header('Content-Transfer-Encoding').toLowerCase();
  let text = body;
  if (cte === 'base64') text = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  else if (cte === 'quoted-printable') text = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return { to: m.to, subject: words(header('Subject')).trim(), replyTo: words(header('Reply-To')).trim(), text: text.replace(/\r\n/g, '\n') };
}
const waitForMails = async (count, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (mails.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return mails.length;
};

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

test('courts: each court can get a colour for its free spots', async () => {
  const col = (id) => view().then((v) => v.courts.find((c) => c.id === id).color);
  assert.strictEqual(await col(S.c1), '', 'no colour = the default green');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { color: '#1A73E8' })).json.color, '#1a73e8', 'normalised to lower case');
  assert.strictEqual(await col(S.c1), '#1a73e8', 'the public page gets it too');
  await admin('PATCH', `/api/reservations/courts/${S.c1}`, { name: 'Court 1' });
  assert.strictEqual(await col(S.c1), '#1a73e8', 'a patch without colour keeps it');
  for (const bad of ['red', '#12', '#GGGGGG', 'rgb(1,2,3)', 5]) {
    assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { color: bad })).status, 400, 'refused: ' + bad);
  }
  assert.strictEqual(await col(S.c1), '#1a73e8', 'refused values change nothing');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { color: '' })).json.color, '', 'empty resets to the default');
  const made = await admin('POST', '/api/reservations/courts', { name: 'Colour test', color: '#00AAFF' });
  assert.strictEqual(made.json.color, '#00aaff', 'a new court can be created with a colour');
  assert.strictEqual((await admin('POST', '/api/reservations/courts', { name: 'Bad colour', color: 'blue' })).status, 400);
  await admin('DELETE', `/api/reservations/courts/${made.json.id}`);
  assert.deepStrictEqual((await view()).courts.map((c) => c.id), [S.c1, S.c2, S.c3], 'cleaned up');
});

test('courts: an hour rate per court (euro, 0 = no price)', async () => {
  const rate = (id) => view().then((v) => v.courts.find((c) => c.id === id).hourRate);
  assert.strictEqual(await rate(S.c1), 0, 'no rate by default');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: '18' })).json.hourRate, 18);
  assert.strictEqual(await rate(S.c1), 18, 'the public page gets it too');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: '12,5' })).json.hourRate, 12.5, 'a comma is fine');
  await admin('PATCH', `/api/reservations/courts/${S.c1}`, { name: 'Court 1' });
  assert.strictEqual(await rate(S.c1), 12.5, 'a patch without a rate keeps it');
  for (const bad of ['abc', '-5', '1001', '1.2.3', '1e3']) {
    assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: bad })).status, 400, 'refused: ' + bad);
  }
  assert.strictEqual(await rate(S.c1), 12.5, 'refused values change nothing');
  assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: '' })).json.hourRate, 0, 'empty = no price');
  const made = await admin('POST', '/api/reservations/courts', { name: 'Rate test', hourRate: 20 });
  assert.strictEqual(made.json.hourRate, 20);
  assert.strictEqual((await admin('POST', '/api/reservations/courts', { name: 'Bad rate', hourRate: 'free' })).status, 400);
  await admin('DELETE', `/api/reservations/courts/${made.json.id}`);
});

test('courts: other prices for weekday mornings, weekday afternoons and the weekend; where the afternoon starts is a rule', async () => {
  const court = (id) => view().then((v) => v.courts.find((c) => c.id === id));
  assert.deepStrictEqual((await court(S.c1)).rates, { weekdayMorning: null, weekdayAfternoon: null, weekend: null }, 'no other prices by default');
  const r = await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: 18, rates: { weekdayMorning: '12', weekend: '30,5' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.rates, { weekdayMorning: 12, weekdayAfternoon: null, weekend: 30.5 });
  await admin('PATCH', `/api/reservations/courts/${S.c1}`, { name: 'Court 1' });
  assert.strictEqual((await court(S.c1)).rates.weekdayMorning, 12, 'a patch without prices keeps them');
  const cleared = await admin('PATCH', `/api/reservations/courts/${S.c1}`, { rates: { weekdayMorning: '' } });
  assert.strictEqual(cleared.json.rates.weekdayMorning, null, 'empty = the same as the hour rate again');
  assert.strictEqual(cleared.json.rates.weekend, 30.5, 'the others stay');
  for (const bad of ['abc', '-1', '1001']) {
    assert.strictEqual((await admin('PATCH', `/api/reservations/courts/${S.c1}`, { rates: { weekend: bad } })).status, 400, 'refused: ' + bad);
  }
  const made = await admin('POST', '/api/reservations/courts', { name: 'Rates test', hourRate: 10, rates: { weekend: 15 } });
  assert.strictEqual(made.json.rates.weekend, 15);
  await admin('DELETE', `/api/reservations/courts/${made.json.id}`);
  await admin('PATCH', `/api/reservations/courts/${S.c1}`, { hourRate: 0, rates: { weekend: '' } });
  // the rule: where the afternoon starts
  assert.strictEqual((await view()).settings.afternoonFrom, '16:00');
  const set = await admin('PUT', '/api/reservations/settings', { maxActive: 2, cancelHours: 2, afternoonFrom: '17:30' });
  assert.strictEqual(set.json.afternoonFrom, '17:30');
  for (const bad of ['5:00', '16:15', '23:00', 'noon']) {
    assert.strictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 2, cancelHours: 2, afternoonFrom: bad })).status, 400, 'refused: ' + bad);
  }
  assert.strictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 2, cancelHours: 2 })).json.afternoonFrom, '17:30', 'left out = kept');
  await admin('PUT', '/api/reservations/settings', { maxActive: 2, cancelHours: 2, afternoonFrom: '16:00' });
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
  const inWindow = expected.filter((d) => d <= D(16)); // the window is 7 days from D(10)
  assert.ok(inWindow.length >= 2 && inWindow.every((d) => got.includes(d)), got.join());
  // today, now 10:15: the 09:00 hour is over (skipped), 12:00 and 17:00 are still to come
  const today = await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '09:00', end: '10:00' });
  assert.deepStrictEqual(today.json, { created: 0, skipped: 1 });
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '12:00', end: '13:00' })).json, { created: 1, skipped: 0 });
  assert.deepStrictEqual((await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: NOW.date, start: '10:00', end: '11:00' })).json, { created: 1, skipped: 0 }, 'one that is running now still can be added');
});

// ---------------------------------------------------------------- the window
test('the window: 7 days from today, never before it; the public sees short names, the admin full ones', async () => {
  const w = await view();
  assert.deepStrictEqual([w.today, w.from, w.to, w.days.length, w.canShiftBack], [NOW.date, NOW.date, D(6), 7, false]);
  assert.strictEqual((await view(D(-5))).from, NOW.date, 'an earlier start is moved to today');
  const next = await view(D(7));
  assert.deepStrictEqual([next.from, next.to, next.canShiftBack], [D(7), D(13), true]);
  assert.strictEqual((await view('nonsense')).from, NOW.date);
  assert.ok(w.slots.every((s) => s.day >= NOW.date && s.day <= D(6)));
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
  assert.deepStrictEqual(mine.settings, { maxActive: 0, cancelHours: 2, afternoonFrom: '16:00' });
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
  assert.deepStrictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 3, cancelHours: 12 })).json, { maxActive: 3, cancelHours: 12, afternoonFrom: '16:00' });
  assert.deepStrictEqual((await view()).settings, { maxActive: 3, cancelHours: 12, afternoonFrom: '16:00' });
  assert.deepStrictEqual((await admin('GET', '/api/reservations/settings')).json, { maxActive: 3, cancelHours: 12, afternoonFrom: '16:00' });
});

// ---------------------------------------------------------------- editing a spot
test('edit: the admin changes the time, the day and the court of a spot; overlaps and bad values are refused', async () => {
  const made = await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(4), start: '09:00', end: '10:00' });
  assert.deepStrictEqual(made.json, { created: 1, skipped: 0 });
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(4), start: '12:00', end: '13:00' });
  const slots = await slotsOf(D(4), S.c1);
  const spot = slots.find((s) => s.start === '09:00');
  const other = slots.find((s) => s.start === '12:00');
  assert.strictEqual((await call('PATCH', `/api/reservations/slots/${spot.id}`, { body: { start: '09:30' } })).status, 401);
  // the time
  assert.strictEqual((await admin('PATCH', `/api/reservations/slots/${spot.id}`, { start: '09:30', end: '11:00' })).status, 200);
  let now = (await slotsOf(D(4), S.c1)).find((s) => s.id === spot.id);
  assert.deepStrictEqual([now.start, now.end], ['09:30', '11:00']);
  // only the end
  assert.strictEqual((await admin('PATCH', `/api/reservations/slots/${spot.id}`, { end: '10:30' })).status, 200);
  now = (await slotsOf(D(4), S.c1)).find((s) => s.id === spot.id);
  assert.deepStrictEqual([now.start, now.end], ['09:30', '10:30']);
  // an overlap with the other spot of that court
  const clash = await admin('PATCH', `/api/reservations/slots/${spot.id}`, { end: '12:30' });
  assert.deepStrictEqual([clash.status, clash.json.code], [409, 'CLASH']);
  assert.ok(/12:00 to 13:00/.test(clash.json.error), clash.json.error);
  // touching is fine
  assert.strictEqual((await admin('PATCH', `/api/reservations/slots/${spot.id}`, { end: '12:00' })).status, 200);
  // another day and another court
  assert.strictEqual((await admin('PATCH', `/api/reservations/slots/${spot.id}`, { day: D(5), courtId: S.c3 })).status, 200);
  now = (await view(D(4), adminCookie)).slots.find((s) => s.id === spot.id);
  assert.deepStrictEqual([now.day, now.courtId, now.start, now.end], [D(5), S.c3, '09:30', '12:00']);
  // bad values
  const bad = [
    [{ start: '09:10' }, /half hour/], [{ end: '09:00' }, /after the start/], [{ day: D(-1) }, /past/], [{ day: '2026-13-01' }, /not valid/],
    [{ courtId: 99999 }, /court does not exist/], [{ day: D(400) }, /days ahead/], [{ day: NOW.date, start: '08:00', end: '09:00' }, /already over/],
  ];
  for (const [body, pattern] of bad) {
    const r = await admin('PATCH', `/api/reservations/slots/${spot.id}`, body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
    assert.ok(pattern.test(r.json.error), `${JSON.stringify(body)}: ${r.json.error}`);
  }
  assert.strictEqual((await admin('PATCH', '/api/reservations/slots/999999', { start: '10:00' })).status, 404);
  assert.ok(other, 'the other spot is still there');
});

test('edit: a reserved spot is changed only when forced, and the player keeps it', async () => {
  const spot = (await slotsOf(D(4), S.c1)).find((s) => s.start === '12:00');
  const p = newPlayer('Dana Presunutá');
  assert.strictEqual((await as(p, 'POST', `/api/reservations/slots/${spot.id}/reserve`)).status, 201);
  const refused = await admin('PATCH', `/api/reservations/slots/${spot.id}`, { start: '12:30', end: '13:30' });
  assert.deepStrictEqual([refused.status, refused.json.code, refused.json.name], [409, 'RESERVED', 'Dana Presunutá']);
  assert.strictEqual((await admin('PATCH', `/api/reservations/slots/${spot.id}`, { start: '12:30', end: '13:30', force: true })).status, 200);
  const moved = (await slotsOf(D(4), S.c1)).find((s) => s.id === spot.id);
  assert.deepStrictEqual([moved.start, moved.end, moved.status, moved.playerId], ['12:30', '13:30', 'RESERVED', p]);
  await admin('POST', `/api/reservations/slots/${spot.id}/cancel`);
});

// ---------------------------------------------------------------- changing many spots at once
const weekdayOf = (day) => { const w = new Date(`${day}T12:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const bulk = (body) => admin('POST', '/api/reservations/slots/bulk-edit', { fromDate: D(20), toDate: D(30), ...body });
const times = async (day, courtId) => (await slotsOf(day, courtId)).map((s) => `${s.start}-${s.end}`);

test('bulk: moving a row of spots one hour later works as a chain; a dry run changes nothing', async () => {
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(20), start: '17:00', end: '20:00', blockMinutes: 60 });
  const dry = await bulk({ courtIds: [S.c1], shiftMinutes: 60, dryRun: true });
  assert.deepStrictEqual([dry.json.matched, dry.json.moved, dry.json.dryRun], [3, 3, true]);
  assert.deepStrictEqual(await times(D(20), S.c1), ['17:00-18:00', '18:00-19:00', '19:00-20:00'], 'unchanged');
  const done = await bulk({ courtIds: [S.c1], shiftMinutes: 60 });
  assert.deepStrictEqual([done.json.matched, done.json.moved, done.json.skippedConflict], [3, 3, 0]);
  assert.deepStrictEqual(await times(D(20), S.c1), ['18:00-19:00', '19:00-20:00', '20:00-21:00']);
  // and back, earlier
  assert.strictEqual((await bulk({ courtIds: [S.c1], shiftMinutes: -60 })).json.moved, 3);
  assert.deepStrictEqual(await times(D(20), S.c1), ['17:00-18:00', '18:00-19:00', '19:00-20:00']);
});

test('bulk: a spot that would overlap one that stays is left alone (nothing is half-done)', async () => {
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: D(21), start: '17:00', end: '20:00', blockMinutes: 60 });
  // only the first two are selected (they start by 18:00); the 19:00 one stays and blocks the second, which blocks the first
  const r = await bulk({ courtIds: [S.c3], startUntil: '18:00', shiftMinutes: 60 });
  assert.deepStrictEqual([r.json.matched, r.json.moved, r.json.skippedConflict], [2, 0, 2]);
  assert.ok(r.json.examples.length === 2 && /overlap/.test(r.json.examples[0]));
  assert.deepStrictEqual(await times(D(21), S.c3), ['17:00-18:00', '18:00-19:00', '19:00-20:00']);
  // a shift of 30 minutes for the first one only (17:00 start): fits between nothing and the 18:00 spot? no — it overlaps; 3 hours later does fit
  const later = await bulk({ courtIds: [S.c3], startFrom: '17:00', startUntil: '17:00', shiftMinutes: 180 });
  assert.deepStrictEqual([later.json.matched, later.json.moved], [1, 1]);
  assert.deepStrictEqual(await times(D(21), S.c3), ['18:00-19:00', '19:00-20:00', '20:00-21:00']);
});

test('bulk: weekdays and the time window narrow the selection; a spot cannot cross midnight', async () => {
  const days = [D(22), D(23), D(24), D(25)];
  for (const d of days) await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: d, start: '10:00', end: '11:00' });
  for (const d of days) await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: d, start: '18:00', end: '19:00' });
  const wd = weekdayOf(D(23));
  const r = await bulk({ courtIds: [S.c1], fromDate: D(22), toDate: D(25), weekdays: [wd], startFrom: '17:00', shiftMinutes: 30 });
  assert.deepStrictEqual([r.json.matched, r.json.moved], [1, 1], 'one weekday, only the evening spot');
  assert.deepStrictEqual(await times(D(23), S.c1), ['10:00-11:00', '18:30-19:30']);
  assert.deepStrictEqual(await times(D(24), S.c1), ['10:00-11:00', '18:00-19:00']);
  // late spots cannot go past midnight
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: D(26), start: '23:00', end: '24:00' });
  const edge = await bulk({ courtIds: [S.c3], fromDate: D(26), toDate: D(26), shiftMinutes: 30 });
  assert.deepStrictEqual([edge.json.moved, edge.json.skippedInvalid], [0, 1]);
  assert.ok(/midnight/.test(edge.json.examples[0]));
  assert.strictEqual((await bulk({ courtIds: [S.c3], fromDate: D(26), toDate: D(26), shiftMinutes: -60 })).json.moved, 1);
  assert.deepStrictEqual(await times(D(26), S.c3), ['22:00-23:00']);
});

test('bulk: reserved spots stay unless asked; the spots can be moved to another court', async () => {
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(27), start: '17:00', end: '19:00', blockMinutes: 60 });
  const [first] = await slotsOf(D(27), S.c1);
  const p = newPlayer('Emil Hromadný');
  assert.strictEqual((await as(p, 'POST', `/api/reservations/slots/${first.id}/reserve`)).status, 201);
  const keep = await bulk({ courtIds: [S.c1], fromDate: D(27), toDate: D(27), shiftMinutes: 120 });
  assert.deepStrictEqual([keep.json.matched, keep.json.moved, keep.json.skippedReserved], [2, 1, 1]);
  assert.deepStrictEqual(await times(D(27), S.c1), ['17:00-18:00', '20:00-21:00'], 'the reserved one did not move, the free one went 2 hours later');
  // including reserved ones, one hour later (the reserved 17:00 spot lands on the free 18:00)
  const all = await bulk({ courtIds: [S.c1], fromDate: D(27), toDate: D(27), shiftMinutes: 60, includeReserved: true });
  assert.strictEqual(all.json.skippedReserved, 0);
  const reservedNow = (await slotsOf(D(27), S.c1)).find((s) => s.status === 'RESERVED');
  assert.deepStrictEqual([reservedNow.start, reservedNow.playerId], ['18:00', p], 'the player kept the reservation');
  // to another court
  const toC3 = await bulk({ courtIds: [S.c1], fromDate: D(27), toDate: D(27), toCourtId: S.c3, includeReserved: true });
  assert.deepStrictEqual([toC3.json.moved], [2]);
  assert.strictEqual((await slotsOf(D(27), S.c1)).length, 0);
  assert.strictEqual((await slotsOf(D(27), S.c3)).length, 2);
  await admin('POST', `/api/reservations/slots/${reservedNow.id}/cancel`);
});

test('bulk: the length of many spots can be set or changed, with or without a shift', async () => {
  // three 1-hour spots with gaps: 09:00, 11:00, 13:00
  for (const t of ['09:00', '11:00', '13:00']) await admin('POST', '/api/reservations/slots', { courtIds: [S.c1], date: D(28), start: t, end: `${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:00` });
  const range = { courtIds: [S.c1], fromDate: D(28), toDate: D(28) };
  // set every length to 90 minutes
  assert.deepStrictEqual((await bulk({ ...range, lengthMinutes: 90, dryRun: true })).json.moved, 3);
  assert.strictEqual((await bulk({ ...range, lengthMinutes: 90 })).json.moved, 3);
  assert.deepStrictEqual(await times(D(28), S.c1), ['09:00-10:30', '11:00-12:30', '13:00-14:30']);
  // 30 minutes shorter
  assert.strictEqual((await bulk({ ...range, lengthDelta: -30 })).json.moved, 3);
  assert.deepStrictEqual(await times(D(28), S.c1), ['09:00-10:00', '11:00-12:00', '13:00-14:00']);
  // 1 hour longer: each one now touches the next (fine) and all three still fit
  assert.strictEqual((await bulk({ ...range, lengthDelta: 60 })).json.moved, 3);
  assert.deepStrictEqual(await times(D(28), S.c1), ['09:00-11:00', '11:00-13:00', '13:00-15:00']);
  // longer again would make them overlap each other: the ones that cannot are left alone, nothing is half-done
  const clash = await bulk({ ...range, lengthDelta: 30 });
  assert.ok(clash.json.skippedConflict >= 1, JSON.stringify(clash.json));
  const after = (await slotsOf(D(28), S.c1)).map((s) => [s.start, s.end]).sort();
  for (let i = 1; i < after.length; i += 1) assert.ok(after[i][0] >= after[i - 1][1], `overlap: ${JSON.stringify(after)}`);
  // too long for the day, too short, and a length together with a shift
  await admin('POST', '/api/reservations/slots', { courtIds: [S.c3], date: D(29), start: '22:00', end: '23:00' });
  const c3 = { courtIds: [S.c3], fromDate: D(29), toDate: D(29) };
  const tooLong = await bulk({ ...c3, lengthMinutes: 180 });
  assert.deepStrictEqual([tooLong.json.moved, tooLong.json.skippedInvalid], [0, 1]);
  assert.ok(/midnight/.test(tooLong.json.examples[0]));
  const short = await bulk({ ...c3, lengthDelta: -60 });
  assert.deepStrictEqual([short.json.moved, short.json.skippedInvalid], [0, 1]);
  assert.ok(/shorter than 30/.test(short.json.examples[0]));
  assert.strictEqual((await bulk({ ...c3, lengthMinutes: 120, shiftMinutes: -60 })).json.moved, 1);
  assert.deepStrictEqual(await times(D(29), S.c3), ['21:00-23:00']);
});

test('bulk: bad input is refused and only the admin may do it', async () => {
  const base = { courtIds: [S.c1], fromDate: D(20), toDate: D(30) };
  const bad = [
    [{ ...base }, /Choose a change/],
    [{ ...base, lengthMinutes: 45 }, /length must be a multiple/],
    [{ ...base, lengthMinutes: 0 }, /length must be a multiple/],
    [{ ...base, lengthMinutes: 750 }, /length must be a multiple/],
    [{ ...base, lengthDelta: 45 }, /change of length/],
    [{ ...base, lengthMinutes: 60, lengthDelta: 30 }, /not both/],
    [{ ...base, shiftMinutes: 45 }, /multiple of 30/],
    [{ ...base, shiftMinutes: 750 }, /multiple of 30/],
    [{ ...base, shiftMinutes: 60, toDate: D(10) }, /last day/],
    [{ ...base, shiftMinutes: 60, fromDate: 'x' }, /first and the last day/],
    [{ ...base, shiftMinutes: 60, toDate: D(500) }, /days ahead/],
    [{ ...base, shiftMinutes: 60, toCourtId: 99999 }, /court does not exist/],
    [{ ...base, shiftMinutes: 60, startFrom: '17:15' }, /half hour/],
  ];
  for (const [body, pattern] of bad) {
    const r = await admin('POST', '/api/reservations/slots/bulk-edit', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
    assert.ok(pattern.test(r.json.error), `${JSON.stringify(body)}: ${r.json.error}`);
  }
  assert.strictEqual((await call('POST', '/api/reservations/slots/bulk-edit', { body: { ...base, shiftMinutes: 60 } })).status, 401);
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
  await startSmtpSink();
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', RESERVATIONS_NOW: `${NOW.date} ${NOW.time}`, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'x', MAIL_FROM: 'BLTA <noreply@example.com>', NOTIFY_EMAIL: 'admin@example.com', PUBLIC_URL: 'https://blta.sk' },
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

// ---------------------------------------------------------------- e-mails
test('e-mails: a reservation tells the admin and confirms to the player, with the price; no e-mail on file = only the admin hears', async () => {
  const before = mails.length;
  const court = (await admin('POST', '/api/reservations/courts', { name: 'Mail test', note: 'antuka, Nobelova 34', hourRate: 10, rates: { weekdayMorning: 12, weekdayAfternoon: 20, weekend: 30 } })).json;
  assert.strictEqual((await admin('PUT', '/api/reservations/settings', { maxActive: 0, cancelHours: 2, afternoonFrom: '16:00' })).status, 200);
  const mk = async (day, start, end) => {
    const r = await admin('POST', '/api/reservations/slots', { courtIds: [court.id], date: day, start, end });
    assert.strictEqual(r.json.created, 1, JSON.stringify(r.json));
    return (await slotsOf(day, court.id)).find((s) => s.start === start);
  };
  const sat = await mk(D(1), '09:00', '10:30'); // Saturday: the weekend price all day
  const monCross = await mk(D(3), '14:00', '17:00'); // Monday over the change at 16:00
  const monShort = await mk(D(3), '09:00', '09:30');
  const maria = newPlayer('Mária Mailová');
  db.prepare('UPDATE players SET email = ?, phone = ? WHERE id = ?').run('maria@example.com', '+421900111222', maria);
  const nikto = newPlayer('Nikto Bezmailu');

  assert.strictEqual((await as(maria, 'POST', `/api/reservations/slots/${sat.id}/reserve`)).status, 201);
  assert.strictEqual(await waitForMails(before + 2), before + 2, 'two e-mails for one reservation');
  const got = mails.slice(before).map(readMail);
  const toAdmin = got.find((m) => m.to.includes('admin@example.com'));
  const toPlayer = got.find((m) => m.to.includes('maria@example.com'));
  assert.ok(toAdmin && toPlayer, JSON.stringify(got.map((m) => m.to)));
  assert.strictEqual(toAdmin.subject, 'Nová rezervácia kurtu: Mária Mailová – Mail test, sobota 10.10.2026 09:00–10:30');
  assert.ok(toAdmin.replyTo.includes('maria@example.com'), 'the admin can reply to the player');
  for (const line of ['Hráč: Mária Mailová', 'Telefón: +421900111222', 'E-mail: maria@example.com', 'Kurt: Mail test', 'Kedy: sobota 10.10.2026, 09:00–10:30', 'Cena: 45 €', 'https://blta.sk/rezervacie-kurtov']) {
    assert.ok(toAdmin.text.includes(line), `admin mail lacks "${line}":\n${toAdmin.text}`);
  }
  assert.strictEqual(toPlayer.subject, 'Rezervácia kurtu potvrdená: Mail test, sobota 10.10.2026 09:00–10:30');
  for (const line of ['Ahoj Mária,', 'tvoja rezervácia kurtu je potvrdená.', 'Kurt: Mail test (antuka, Nobelova 34)', 'Kedy: sobota 10.10.2026, 09:00–10:30', 'Cena: 45 €', 'najneskôr 2 hodiny pred začiatkom', 'https://blta.sk/rezervacie-kurtov']) {
    assert.ok(toPlayer.text.includes(line), `player mail lacks "${line}":\n${toPlayer.text}`);
  }

  // no e-mail on file: only the admin; the price is worked out half hour by half hour (two hours at 12 + one at 20 = 44)
  const mid = mails.length;
  assert.strictEqual((await as(nikto, 'POST', `/api/reservations/slots/${monCross.id}/reserve`)).status, 201);
  assert.strictEqual(await waitForMails(mid + 1), mid + 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(mails.length, mid + 1, 'a player without an e-mail gets none');
  const cross = readMail(mails[mid]);
  assert.deepStrictEqual(mails[mid].to, ['admin@example.com']);
  assert.ok(cross.text.includes('Cena: 44 €') && cross.text.includes('E-mail: -') && cross.text.includes('pondelok 12.10.2026'), cross.text);
  // half an hour in the weekday morning: 6 €
  const mid2 = mails.length;
  assert.strictEqual((await as(nikto, 'POST', `/api/reservations/slots/${monShort.id}/reserve`)).status, 201);
  assert.strictEqual(await waitForMails(mid2 + 1), mid2 + 1);
  assert.ok(readMail(mails[mid2]).text.includes('Cena: 6 €'));
  // a refused reservation sends nothing
  const mid3 = mails.length;
  assert.strictEqual((await as(maria, 'POST', `/api/reservations/slots/${monShort.id}/reserve`)).status, 409);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(mails.length, mid3, 'a refused reservation sends no e-mail');
  // a court without prices: no "Cena" line
  const plain = (await admin('POST', '/api/reservations/courts', { name: 'No price' })).json;
  await admin('POST', '/api/reservations/slots', { courtIds: [plain.id], date: D(2), start: '10:00', end: '11:00' });
  const free = (await slotsOf(D(2), plain.id))[0];
  const mid4 = mails.length;
  assert.strictEqual((await as(maria, 'POST', `/api/reservations/slots/${free.id}/reserve`)).status, 201);
  assert.strictEqual(await waitForMails(mid4 + 2), mid4 + 2);
  mails.slice(mid4).forEach((m) => assert.ok(!readMail(m).text.includes('Cena:'), 'a price on a court without one'));
  await admin('DELETE', `/api/reservations/courts/${court.id}?force=1`);
  await admin('DELETE', `/api/reservations/courts/${plain.id}?force=1`);
});

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
