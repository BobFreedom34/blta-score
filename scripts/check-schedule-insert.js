// Check of inserting a match between two matches on a court (dragged onto a taken time in Harmonogram): the match goes in front of the match it was
// dropped on (its first half) or right after it (its second half), the planned matches after it on that court move later; without "insert" a taken time is refused.
// Works on a temporary data directory, calls the planner with a fixed "now".
// Run: node scripts/check-schedule-insert.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-insert-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const schedule = require('../src/tournamentSchedule');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const DAY = '2030-06-15';
const at = (hhmm) => schedule.localToUtcMs(DAY, hhmm);
const iso = (ms) => new Date(ms).toISOString();
const NOW = at('08:00');
let n = 0;

function setup(slug) {
  const id = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES (?, ?, 'TOURNAMENT', ?, ?, 2, 80, '09:00', '21:00', 0, 0, 'NOVICE')").run(slug, slug, DAY, DAY).lastInsertRowid);
  const add = (court, hhmm, status = 'PLANNED') => {
    n += 1;
    const a = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Ins A${n}`).lastInsertRowid);
    const b = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Ins B${n}`).lastInsertRowid);
    const tok = `ins${n}`;
    db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, ?, ?, 'BEST_OF_3', ?, '{}', ?)")
      .run(tok, a, b, hhmm ? iso(at(hhmm)) : null, court, status, id);
    return tok;
  };
  return { season: db.prepare('SELECT * FROM seasons WHERE id = ?').get(id), add };
}
const timeOf = (tok) => { const r = db.prepare('SELECT scheduled_at, court_no FROM matches WHERE share_token = ?').get(tok); return r.scheduled_at && `${r.court_no}@${new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit' }).format(new Date(r.scheduled_at))}`; };

test('dropped on the first half of a match: it takes its time, that match and the ones after it move later', () => {
  const { season, add } = setup('insert-a');
  const m1 = add(1, '09:00'); const m2 = add(1, '10:20'); const m3 = add(1, '11:40'); const late = add(1, '18:00');
  const mover = add(2, '09:00');
  assert.strictEqual(schedule.placeMatch(season, mover, 1, iso(at('10:30')), NOW).status, 409, 'without insert a taken time is refused');
  const done = schedule.placeMatch(season, mover, 1, iso(at('10:30')), NOW, { insert: true });
  assert.ok(!done.error, done.error);
  assert.strictEqual(done.pushed, 2);
  assert.deepStrictEqual([m1, mover, m2, m3, late].map(timeOf), ['1@09:00', '1@10:20', '1@11:40', '1@13:00', '1@18:00'], 'a match far behind (a gap big enough) stays');
});

test('dropped on the second half: it goes right after that match', () => {
  const { season, add } = setup('insert-b');
  const m1 = add(1, '09:00'); const m2 = add(1, '10:20');
  const mover = add(null, null);
  const done = schedule.placeMatch(season, mover, 1, iso(at('09:50')), NOW, { insert: true });
  assert.ok(!done.error, done.error);
  assert.deepStrictEqual([m1, mover, m2].map(timeOf), ['1@09:00', '1@10:20', '1@11:40']);
});

test('a match being played does not move: the inserted one goes after it, a finished one is jumped over', () => {
  const { season, add } = setup('insert-c');
  const live = add(1, '09:00', 'LIVE'); const m2 = add(1, '10:20');
  const mover = add(2, '12:00');
  const done = schedule.placeMatch(season, mover, 1, iso(at('09:10')), at('09:30'), { insert: true });
  assert.ok(!done.error, done.error);
  assert.deepStrictEqual([live, mover, m2].map(timeOf), ['1@09:00', '1@10:20', '1@11:40']);
});

test('a free time needs no pushing', () => {
  const { season, add } = setup('insert-d');
  const m1 = add(1, '09:00');
  const mover = add(2, '09:00');
  const done = schedule.placeMatch(season, mover, 1, iso(at('13:00')), NOW, { insert: true });
  assert.strictEqual(done.pushed, 0);
  assert.deepStrictEqual([m1, mover].map(timeOf), ['1@09:00', '1@13:00']);
});

test('a longer match in a full 3-day schedule with "max 2 matches a day" is planned quickly (the server ran out of memory on it)', () => {
  const id = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, max_matches_per_day, categories) VALUES ('Busy', 'busy-3', 'TOURNAMENT', ?, ?, 3, 90, '09:00', '21:00', 5, 1, 2, 'NOVICE')").run(DAY, '2030-06-17').lastInsertRowid);
  const players = Array.from({ length: 24 }, (_, i) => Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Busy ${i}`).lastInsertRowid));
  const toks = [];
  for (let k = 0; k < 36; k += 1) {
    const tok = `busy${k}`;
    toks.push(tok);
    db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(tok, players[k % 24], players[(k * 5 + 7) % 24], id);
  }
  schedule.autoPlan(id, { mode: 'rebuild', now: NOW });
  const t0 = Date.now();
  const rss0 = process.memoryUsage().rss;
  [120, 180, 240].forEach((len, i) => assert.ok(!schedule.setDuration(db.prepare('SELECT * FROM seasons WHERE id = ?').get(id), toks[i], len).error));
  assert.ok(Date.now() - t0 < 3000, `3 changes of length took ${Date.now() - t0} ms`);
  assert.ok(process.memoryUsage().rss - rss0 < 150 * 1048576, `they took ${Math.round((process.memoryUsage().rss - rss0) / 1048576)} MB`);
  assert.ok(!/function[^{]*\{[^}]*new Intl\.DateTimeFormat/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'tournamentSchedule.js'), 'utf8')), 'the date formatters are made once, not per call');
});

test('a match made longer pushes only the matches after it on its own court; nothing jumps to another court (automatic schedule on, not started)', () => {
  const id = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Longer', 'longer-1', 'TOURNAMENT', ?, ?, 3, 90, '09:00', '21:00', 0, 1, 'NOVICE')").run(DAY, DAY).lastInsertRowid);
  const add = (tok, court, hhmm) => {
    const a = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Longer ${tok} A`).lastInsertRowid);
    const b = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Longer ${tok} B`).lastInsertRowid);
    db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, slot_locked, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, ?, ?, 0, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(tok, a, b, iso(at(hhmm)), court, id);
    return tok;
  };
  const c3a = add('lg1', 3, '17:00'); const c3b = add('lg2', 3, '18:30');
  const c1 = add('lg3', 1, '09:00'); // court 1 is free from 10:30: the planner used to move lg2 there
  const done = schedule.setDuration(db.prepare('SELECT * FROM seasons WHERE id = ?').get(id), c3a, 120);
  assert.ok(!done.error, done.error);
  assert.strictEqual(done.pushed, 1);
  assert.deepStrictEqual([c3a, c3b, c1].map(timeOf), ['3@17:00', '3@19:00', '1@09:00'], 'the next match stays on Kurt 3, 30 minutes later');
});

test('the page sends insert and shows it while dragging', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'court-schedule.js'), 'utf8');
  assert.ok(js.includes('insert: !!target.insert'), 'the drop sends insert');
  assert.ok(js.includes('cs-drop-insert'), 'the frame shows it');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'seasons', 'schedule.js'), 'utf8').includes("{ insert: body.insert === true }"));
});

test('many schedule changes do not flood the site: one message per tournament at most every 3 s, pages without the schedule ignore it', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'seasons', 'schedule.js'), 'utf8');
  assert.ok(/SCHEDULE_EMIT_MS = 3000/.test(route) && /pendingEmits\.has\(season\.id\)\) return/.test(route), 'the messages are joined');
  for (const f of ['app.js', 'player.js', 'embed-live.js', 'home.js', 'tables.js', 'common-site.js']) {
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8').includes("e.status === 'SCHEDULE') return"), `${f} ignores a schedule change`);
  }
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'season.js'), 'utf8').includes('e.seasonId !== season.id) return'), 'a tournament page ignores another tournament');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
try { db.close(); } catch { /* closed */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary folder */ }
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
