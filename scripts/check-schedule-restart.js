// Check of the court planner after a match is restarted: a match that ended early freed its court, the next match moved forward onto its time;
// when the match is restarted (it is PLANNED again at its time), the next match goes back behind it instead of both standing at the same time.
// Works on a temporary data directory, calls the planner with a fixed "now".
// Run: node scripts/check-schedule-restart.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-plan-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const schedule = require('../src/tournamentSchedule');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const DAY = '2030-06-15';
const at = (hhmm) => schedule.localToUtcMs(DAY, hhmm);
const iso = (ms) => new Date(ms).toISOString();

test('a restarted match keeps its time; the match that had moved onto that time goes back behind it', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Restart Cup', 'restart-cup', 'TOURNAMENT', ?, ?, 1, 80, '09:00', '21:00', 0, 1, 'NOVICE')").run(DAY, DAY).lastInsertRowid);
  const p = ['A', 'B', 'C', 'D'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Restart ${n}`).lastInsertRowid));
  const add = (tok, a, b, when) => Number(db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, ?, 1, 'BEST_OF_3', 'PLANNED', '{}', ?)")
    .run(tok, a, b, iso(when), season).lastInsertRowid);
  // the first match was given up (it freed the court) and the second moved onto 9:00; then the first was restarted: PLANNED again at 9:00
  const first = add('rs1', p[0], p[1], at('09:00'));
  const second = add('rs2', p[2], p[3], at('09:00'));
  const now = at('08:00');
  schedule.afterRestart(season, first, now);
  const a = db.prepare('SELECT scheduled_at, court_no FROM matches WHERE id = ?').get(first);
  const b = db.prepare('SELECT scheduled_at, court_no FROM matches WHERE id = ?').get(second);
  assert.strictEqual(a.scheduled_at, iso(at('09:00')), 'the restarted match keeps 9:00');
  assert.strictEqual(a.court_no, 1);
  assert.ok(Date.parse(b.scheduled_at) >= at('10:20'), `the other match goes behind it (10:20), not ${b.scheduled_at}`);
});

test('without automatic scheduling nothing is moved', () => {
  const season = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Manual Cup', 'manual-cup', 'TOURNAMENT', ?, ?, 1, 80, '09:00', '21:00', 0, 0, 'NOVICE')").run(DAY, DAY).lastInsertRowid);
  const p = ['E', 'F', 'G', 'H'].map((n) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Manual ${n}`).lastInsertRowid));
  const add = (tok, a, b) => Number(db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, ?, 1, 'BEST_OF_3', 'PLANNED', '{}', ?)")
    .run(tok, a, b, iso(at('09:00')), season).lastInsertRowid);
  const first = add('mn1', p[0], p[1]);
  const second = add('mn2', p[2], p[3]);
  schedule.afterRestart(season, first, at('08:00'));
  assert.strictEqual(db.prepare('SELECT scheduled_at FROM matches WHERE id = ?').get(second).scheduled_at, iso(at('09:00')));
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
try { db.close(); } catch { /* closed */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary folder */ }
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
