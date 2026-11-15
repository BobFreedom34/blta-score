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

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 5).join('\n      ')}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
try { db.close(); } catch { /* ignore */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open on Windows */ }
process.exit(failed ? 1 : 0);
