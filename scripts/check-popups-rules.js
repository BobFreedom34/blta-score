// Check of the time rules of the pop-ups about an event (src/eventPopups.js): a popup that was closed with the cross comes back after the days the organiser set (3 by
// default) and not before, a player who said no never sees it again, the audience "players of earlier seasons", the dates. Works on a temporary data directory with a fixed "now".
// Run: node scripts/check-popups-rules.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popups-rules-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const popups = require('../src/eventPopups');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const DAY = 86400000;
const NOW = Date.parse('2030-03-10T10:00:00Z');
const dayStr = (ms) => popups.today(ms);

const league = Number(db.prepare('SELECT MIN(id) AS id FROM leagues').get().id);
const season = (name, extra = {}) => Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, league_id, registration_open, categories) VALUES (?, ?, 'LEAGUE', ?, ?, ?, 1, 'ELITE')")
  .run(name, name.toLowerCase().replace(/\W+/g, '-'), extra.start || '2030-09-01', extra.end || '2031-06-30', league).lastInsertRowid);
const player = (n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Rules ${n}`).lastInsertRowid);
// (each test has the only popup, so the others of the earlier tests do not answer for it)
const popup = (seasonId, body = {}) => { const id = popups.create(league, { seasonId, repeatDays: 3, audience: 'ALL', ...body }).id; db.prepare('DELETE FROM event_popups WHERE id != ?').run(id); return id; };

test('closed with the cross: not again before the days are over, then again', () => {
  const s = season('Rules One');
  const p = popup(s);
  const a = player('A');
  assert.ok(popups.nextFor(a, league, NOW));
  popups.markShown(p, a, NOW);
  popups.markDismissed(p, a, NOW);
  assert.strictEqual(popups.nextFor(a, league, NOW + 1 * DAY), null, 'a day later');
  assert.strictEqual(popups.nextFor(a, league, NOW + 3 * DAY - 1000), null, 'just before 3 days');
  assert.ok(popups.nextFor(a, league, NOW + 3 * DAY + 1000), 'after 3 days it comes back');
  // closed again: another 3 days
  popups.markDismissed(p, a, NOW + 4 * DAY);
  assert.strictEqual(popups.nextFor(a, league, NOW + 6 * DAY), null);
  assert.ok(popups.nextFor(a, league, NOW + 7 * DAY + 1000));
});

test('the number of days is the organiser\'s (1 to 60)', () => {
  const s = season('Rules Two');
  const p = popup(s, { repeatDays: 7 });
  const a = player('B');
  popups.markDismissed(p, a, NOW);
  assert.strictEqual(popups.nextFor(a, league, NOW + 6 * DAY), null);
  assert.ok(popups.nextFor(a, league, NOW + 7 * DAY + 1000));
  assert.ok(popups.create(league, { seasonId: s, repeatDays: 1 }).id);
  assert.ok(popups.create(league, { seasonId: s, repeatDays: 0 }).error);
});

test('"I don\'t want to register" is for good', () => {
  const s = season('Rules Three');
  const p = popup(s);
  const a = player('C');
  popups.markShown(p, a, NOW);
  popups.markDeclined(p, a, 'NO_TIME', NOW);
  assert.strictEqual(popups.nextFor(a, league, NOW + 400 * DAY), null);
  assert.strictEqual(popups.get(p).season_id, s);
});

test('the dates: from (included) to (included)', () => {
  const s = season('Rules Four', { start: '2030-09-01', end: '2031-06-30' });
  const a = player('D');
  const p = popup(s, { startsAt: dayStr(NOW + 2 * DAY), endsAt: dayStr(NOW + 5 * DAY) });
  assert.strictEqual(popups.nextFor(a, league, NOW), null, 'not started');
  assert.ok(popups.nextFor(a, league, NOW + 2 * DAY), 'the first day');
  assert.ok(popups.nextFor(a, league, NOW + 5 * DAY), 'the last day');
  assert.strictEqual(popups.nextFor(a, league, NOW + 6 * DAY), null, 'ended');
  void p;
});

test('"players of earlier seasons": only who registered or played in another season of the city', () => {
  const old = season('Rules Old', { start: '2029-09-01', end: '2030-02-28' });
  const next = season('Rules New');
  const p = popup(next, { audience: 'PAST' });
  const veteran = player('Veteran');
  const newcomer = player('Newcomer');
  db.prepare("INSERT INTO season_registrations (season_id, player_id, name, phone, email, category) VALUES (?, ?, 'V', '0900000000', 'v@example.com', 'ELITE')").run(old, veteran);
  assert.ok(popups.nextFor(veteran, league, NOW), 'the veteran is asked');
  assert.strictEqual(popups.nextFor(newcomer, league, NOW), null, 'the newcomer is not');
  // only the popup of the new season is in question (the old season is over, it has no popup)
  void p;
});

test('a registered player, a season of another city or one without registration is never asked', () => {
  const s = season('Rules Five');
  const p = popup(s);
  const a = player('E');
  assert.ok(popups.nextFor(a, league, NOW));
  db.prepare("INSERT INTO season_registrations (season_id, player_id, name, phone, email, category) VALUES (?, ?, 'E', '0900000001', 'e@example.com', 'ELITE')").run(s, a);
  assert.strictEqual(popups.nextFor(a, league, NOW), null, 'registered');
  const b = player('F');
  assert.ok(popups.nextFor(b, league, NOW));
  assert.strictEqual(popups.nextFor(b, league + 999, NOW), null, 'another city');
  db.prepare('UPDATE seasons SET registration_open = 0 WHERE id = ?').run(s);
  assert.strictEqual(popups.nextFor(b, league, NOW), null, 'registration closed');
  void p;
});

test('"ask everybody again" clears the closing and the "no", not the numbers of who saw it', () => {
  const s = season('Rules Six');
  const p = popup(s);
  const a = player('G');
  popups.markShown(p, a, NOW);
  popups.markDeclined(p, a, 'OTHER', NOW);
  assert.strictEqual(popups.nextFor(a, league, NOW + DAY), null);
  popups.resetResponses(popups.get(p));
  assert.ok(popups.nextFor(a, league, NOW + DAY));
  assert.strictEqual(popups.list(league, NOW).find((x) => x.id === p).stats.shown, 1);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 5).join('\n      ')}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
try { db.close(); } catch { /* ignore */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open on Windows */ }
process.exit(failed ? 1 : 0);
