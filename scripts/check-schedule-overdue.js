// Check of the court planner: a match whose time has come but that was neither started nor finished is taken as being played, so its court is not
// offered to a new match (the other free courts are). Works on a temporary data directory, calls the planner with a fixed "now".
// Run: node scripts/check-schedule-overdue.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overdue-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const schedule = require('../src/tournamentSchedule');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const DAY = '2030-06-15';
const at = (hhmm) => schedule.localToUtcMs(DAY, hhmm);
const iso = (ms) => new Date(ms).toISOString();

test('a new match is not put on the court of a planned match that is overdue; the free court is used', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Overdue Cup', 'overdue-cup', 'TOURNAMENT', ?, ?, 2, 35, '10:00', '14:00', 0, 0, 'ELITE')").run(DAY, DAY).lastInsertRowid);
  const players = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Overdue ${n}`).lastInsertRowid));
  const state = '{}';
  const addMatch = (p1, p2, court, when) => Number(db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES (?, 'ELITE', ?, ?, ?, ?, 'BEST_OF_3', 'PLANNED', ?, ?)")
    .run(`tok${p1}${p2}`, p1, p2, when ? iso(when) : null, court || null, state, season).lastInsertRowid);
  // court 1: a match planned for 10:00 that nobody started (still being played); court 2 is free
  const running = addMatch(players[0], players[1], 1, at('10:00'));
  // a new match without a time (other players)
  const fresh = addMatch(players[2], players[3], null, null);
  const now = at('11:05');
  const res = schedule.autoPlan(season, { mode: 'fill', now });
  assert.ok(!res.error, res.error);
  const row = db.prepare('SELECT court_no, scheduled_at FROM matches WHERE id = ?').get(fresh);
  assert.strictEqual(row.court_no, 2, 'the new match goes to the free court 2, not to court 1 where the overdue match still is');
  assert.ok(row.scheduled_at, 'it has a time');
  assert.strictEqual(db.prepare('SELECT court_no FROM matches WHERE id = ?').get(running).court_no, 1, 'the overdue match stays on its court');
});

test('an old planned match from long ago does not keep its court', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Old Cup', 'old-cup', 'TOURNAMENT', ?, ?, 1, 35, '10:00', '14:00', 0, 0, 'ELITE')").run(DAY, DAY).lastInsertRowid);
  const players = ['G', 'H', 'I', 'J'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Old ${n}`).lastInsertRowid));
  db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES ('oldtok1', 'ELITE', ?, ?, ?, 1, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(players[0], players[1], iso(at('10:00') - 3 * 86400000), season);
  const fresh = Number(db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, season_id) VALUES ('oldtok2', 'ELITE', ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(players[2], players[3], season).lastInsertRowid);
  const res = schedule.autoPlan(season, { mode: 'fill', now: at('11:05') });
  assert.ok(!res.error, res.error);
  assert.strictEqual(db.prepare('SELECT court_no FROM matches WHERE id = ?').get(fresh).court_no, 1);
});

test('an unscheduled match says why: it does not fit into the day (DAY_END), or a place exists and it waits (WAIT)', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Why Cup', 'why-cup', 'TOURNAMENT', ?, ?, 2, 35, '10:00', '12:00', 0, 0, 'ELITE')").run(DAY, DAY).lastInsertRowid);
  const players = ['K', 'L'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Why ${n}`).lastInsertRowid));
  const fresh = db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, season_id) VALUES ('whytok', 'ELITE', ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(players[0], players[1], season);
  const get = (now) => schedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season), now).matches.find((m) => m.token === 'whytok');
  assert.strictEqual(get(at('10:30')).why.code, 'WAIT');
  const late = get(at('11:40')).why;
  assert.strictEqual(late.code, 'DAY_END', JSON.stringify(late));
  assert.strictEqual(late.end, '12:00');
  void fresh;
});


test('"build it backwards": a match without a time is laid out from the start of the day even when the day is over; the ordinary fill finds no room; the placed match is locked', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Back Cup', 'back-cup', 'TOURNAMENT', ?, ?, 2, 35, '10:00', '12:00', 0, 0, 'ELITE')").run(DAY, DAY).lastInsertRowid);
  const players = ['M', 'N', 'O', 'P'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Back ${n}`).lastInsertRowid));
  const add = (p1, p2, token) => Number(db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, season_id) VALUES (?, 'ELITE', ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(token, p1, p2, season).lastInsertRowid);
  const a = add(players[0], players[1], 'backtok1');
  const b = add(players[2], players[3], 'backtok2');
  const evening = at('17:30');
  const normal = schedule.autoPlan(season, { mode: 'fill', now: evening });
  assert.strictEqual(normal.placed, 0, 'after the end of the day nothing fits');
  const res = schedule.autoPlan(season, { mode: 'backfill', now: evening });
  assert.ok(!res.error, res.error);
  assert.strictEqual(res.placed, 2);
  const rows = [a, b].map((id) => db.prepare('SELECT court_no, scheduled_at, slot_locked FROM matches WHERE id = ?').get(id));
  assert.ok(rows.every((r) => r.scheduled_at === iso(at('10:00')) && r.slot_locked === 1), JSON.stringify(rows));
  assert.deepStrictEqual(rows.map((r) => r.court_no).sort(), [1, 2], 'two courts, both at the start of the day');
});

// the planner's own window (set on the schedule page): by default the playing times of the tournament form; the organiser can change them there, or empty one of them
function planCup(name, planStart, planEnd, matches) {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories, plan_start, plan_end) VALUES (?, ?, 'TOURNAMENT', ?, ?, 1, 35, '10:00', '12:00', 0, 0, 'ELITE', ?, ?)")
    .run(name, name.toLowerCase().replace(/\W+/g, '-'), DAY, DAY, planStart, planEnd).lastInsertRowid);
  for (let i = 0; i < matches; i += 1) {
    const p1 = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`${name} ${i}a`).lastInsertRowid);
    const p2 = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`${name} ${i}b`).lastInsertRowid);
    db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, season_id) VALUES (?, 'ELITE', ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(`${name}${i}`.replace(/\W+/g, ''), p1, p2, season);
  }
  return season;
}
const placedOf = (season) => db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND scheduled_at IS NOT NULL').get(season).n;

test('the planner follows the playing times of the form by default (10-12: 3 matches of 35 minutes on one court)', () => {
  const season = planCup('Plan Default', null, null, 5);
  const res = schedule.autoPlan(season, { mode: 'fill', now: at('09:00') });
  assert.strictEqual(res.placed, 3);
  const s = schedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season), at('09:00')).settings;
  assert.strictEqual(s.dayTimes[DAY].end, '12:00');
  assert.strictEqual(s.planEnd, null);
});

test('the organiser sets the end of the planning to 13:00 on the schedule: the planner plans until 13:00 and the schedule shows until 13:00', () => {
  const season = planCup('Plan Until Thirteen', null, '13:00', 5);
  const res = schedule.autoPlan(season, { mode: 'fill', now: at('09:00') });
  assert.strictEqual(res.placed, 5, 'two more fit: 11:45 and 12:20 end at 12:55');
  const s = schedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season), at('09:00')).settings;
  assert.strictEqual(s.dayView[DAY].end, '13:00');
  assert.strictEqual(s.dayStart, '10:00', 'the times of the form are not touched');
  assert.strictEqual(s.dayEnd, '12:00');
});

test('a start of the planning of its own: the first match is not before it', () => {
  const season = planCup('Plan From Eleven', '11:00', null, 1);
  schedule.autoPlan(season, { mode: 'fill', now: at('09:00') });
  assert.strictEqual(db.prepare('SELECT scheduled_at FROM matches WHERE season_id = ?').get(season).scheduled_at, iso(at('11:00')));
});

test('no end of the planning: every match is placed under the others and the schedule grows with them', () => {
  const season = planCup('Plan Open', null, '', 12);
  const res = schedule.autoPlan(season, { mode: 'fill', now: at('09:00') });
  assert.strictEqual(res.placed, 12, 'nothing is left out: 12 x 35 minutes on one court is 7 hours');
  const view = schedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(season), at('09:00')).settings;
  assert.strictEqual(view.openEnd, true);
  assert.strictEqual(view.dayView[DAY].start, '10:00');
  assert.strictEqual(view.dayView[DAY].end, '17:00', 'the last match ends at 17:00: 10:00 + 12 x 35 min');
  // an empty schedule without an end shows three hours, not the whole day
  const empty = planCup('Plan Open Empty', null, '', 0);
  assert.strictEqual(schedule.getSchedule(db.prepare('SELECT * FROM seasons WHERE id = ?').get(empty), at('09:00')).settings.dayView[DAY].end, '13:00');
});

test('the settings of the planning are checked: a bad time, an end before the start, a window shorter than one match', () => {
  const season = planCup('Plan Check', null, null, 0);
  const row = () => db.prepare('SELECT * FROM seasons WHERE id = ?').get(season);
  assert.ok(schedule.saveSettings(row(), { planEnd: '25:00' }).error);
  assert.ok(schedule.saveSettings(row(), { planStart: '14:00', planEnd: '13:00' }).error);
  assert.ok(schedule.saveSettings(row(), { planStart: '10:00', planEnd: '10:20' }).error, 'shorter than a match of 35 minutes');
  assert.ok(schedule.saveSettings(row(), { planStart: '10:00', planEnd: '13:00' }).ok);
  const saved = row();
  assert.strictEqual(saved.plan_start, '10:00');
  assert.strictEqual(saved.plan_end, '13:00');
  assert.ok(schedule.saveSettings(row(), { planStart: null, planEnd: '' }).ok);
  assert.strictEqual(row().plan_start, null, 'null = follow the form again');
  assert.strictEqual(row().plan_end, '', 'empty = no limit');
});
let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 5).join('\n      ')}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
try { db.close(); } catch { /* ignore */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open on Windows */ }
process.exit(failed ? 1 : 0);
