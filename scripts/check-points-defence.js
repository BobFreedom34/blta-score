// Checks of the defence of the points (src/rankingExpiry.js): the points of the overall BLTA table leave it 52 weeks after what earned them, every Monday,
// before the weekly "you moved N places" message is worked out. In-process with its own data folder: touches nothing else.
// Run: node scripts/check-points-defence.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defence-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const rankingPoints = require('../src/rankingPoints');
const expiry = require('../src/rankingExpiry');
const changeLog = require('../src/changeLog');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let counter = 0;
const player = (name) => Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, name.toLowerCase().replace(/\W+/g, '-')).lastInsertRowid);
function match(category, p1, p2, s1, s2, day) {
  counter += 1;
  return Number(db.prepare(`INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, winner_id, scheduled_at, end_time)
    VALUES (?, ?, ?, ?, 'BO3', 'FINISHED', ?, ?, ?, ?)`).run(`def-${counter}`, category, p1, p2, JSON.stringify({ setsWon: { 1: s1, 2: s2 } }), s1 > s2 ? p1 : p2, `${day}T10:00:00.000Z`, `${day}T11:00:00.000Z`).lastInsertRowid);
}
const row = (id) => db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
const award = (id) => rankingPoints.reconcile(null, row(id));
const entry = (tableKey, playerId) => rankingPoints.entryFor(tableKey, playerId, false);
const pts = (tableKey, playerId) => { const e = entry(tableKey, playerId); return e ? e.points : undefined; };
const items = (playerId) => db.prepare('SELECT x.* FROM ranking_expiry x JOIN ranking_entries e ON e.id = x.entry_id WHERE e.player_id = ? AND e.table_key = ? ORDER BY x.id').all(playerId, 'blta');
const at = (iso) => new Date(iso);

const S = {};

test('the Monday and the day that is 52 weeks before it: the same all week', async () => {
  assert.strictEqual(expiry.cutoffFor(at('2026-11-16T05:00:00Z')), '2025-11-17');
  assert.strictEqual(expiry.cutoffFor(at('2026-11-18T12:00:00Z')), '2025-11-17');
  assert.strictEqual(expiry.cutoffFor(at('2026-11-22T23:00:00Z')), '2025-11-17', 'Sunday is still the week of Monday the 16th');
  assert.strictEqual(expiry.cutoffFor(at('2026-11-23T00:30:00Z')), '2025-11-24');
});

test('a finished league match puts a dated item behind the points of the winner in the BLTA table (not in a race table, nothing for 0 points)', async () => {
  S.a = player('Def Player A');
  S.b = player('Def Player B');
  S.m1 = match('ELITE', S.a, S.b, 2, 0, '2025-11-20');
  award(S.m1);
  assert.strictEqual(pts('blta', S.a), 30);
  assert.strictEqual(pts('elite_race', S.a), 30);
  const list = items(S.a);
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual([list[0].kind, list[0].points, list[0].event_date, list[0].match_id], ['MATCH', 30, '2025-11-20', S.m1]);
  assert.strictEqual(items(S.b).length, 0, 'a loser with 0 points has nothing to lose later');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM ranking_expiry x JOIN ranking_entries e ON e.id = x.entry_id WHERE e.table_key != 'blta'").get().n, 0);
  // some points of his own in the table that have no date (an admin's) stay
  db.prepare('UPDATE ranking_entries SET points = 50 WHERE id = ?').run(entry('blta', S.a).id);
});

test('nothing goes off before the Monday that is 52 weeks later; then the points go, the match count stays, the race table is not touched, the log says it', async () => {
  const sunday = expiry.applyDue(at('2026-11-22T20:00:00Z'));
  assert.deepStrictEqual(sunday, { items: 0, players: 0 }, 'the match of 20.11.2025 is still valid on Sunday 22.11.2026');
  assert.strictEqual(pts('blta', S.a), 50);
  const monday = expiry.applyDue(at('2026-11-23T00:10:00Z'));
  assert.deepStrictEqual(monday, { items: 1, players: 1 });
  assert.strictEqual(pts('blta', S.a), 20, '50 - 30');
  assert.strictEqual(entry('blta', S.a).matches, 1, 'the number of matches is not touched');
  assert.strictEqual(pts('elite_race', S.a), 30, 'the race tables are not defended');
  const log = changeLog.list({ kind: 'DEFENCE' }).items;
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual([log[0].ranking[0].name, log[0].ranking[0].before, log[0].ranking[0].after, log[0].ranking[0].delta], ['Def Player A', 50, 20, -30]);
  assert.strictEqual(log[0].expired[0].points, 30);
  assert.deepStrictEqual(expiry.applyDue(at('2026-11-23T09:00:00Z')), { items: 0, players: 0 }, 'it is done once');
  assert.deepStrictEqual(expiry.applyDue(at('2026-11-25T09:00:00Z')), { items: 0, players: 0 });
});

test('the points never go below 0', async () => {
  const c = player('Def Player C');
  const m = match('NOVICE', c, S.b, 2, 0, '2025-12-01');
  award(m);
  assert.strictEqual(pts('blta', c), 12);
  db.prepare('UPDATE ranking_entries SET points = 5 WHERE id = ?').run(entry('blta', c).id); // an admin lowered it by hand
  expiry.applyDue(at('2026-12-07T01:00:00Z'));
  assert.strictEqual(pts('blta', c), 0);
});

test('a match that is corrected after its points went off does not take them off twice; a deleted match takes its item with it', async () => {
  // match 1 (2025-11-20) was already taken off; the result is corrected to 2:1 (20 points for the winner)
  db.prepare("UPDATE matches SET state = ?, winner_id = ? WHERE id = ?").run(JSON.stringify({ setsWon: { 1: 2, 2: 1 } }), S.a, S.m1);
  const before = pts('blta', S.a);
  rankingPoints.reconcile(null, row(S.m1));
  assert.strictEqual(pts('blta', S.a), before + 20, 'the old 30 were not taken back (they were gone), the new 20 are in until the next Monday step');
  expiry.applyDue(at('2026-11-23T10:00:00Z'));
  assert.strictEqual(pts('blta', S.a), before, 'and then they go off the same way');
  // a recent match, then deleted
  const d = player('Def Player D');
  const recent = match('ELITE', d, S.b, 2, 0, '2026-11-10');
  award(recent);
  assert.strictEqual(items(d).length, 1);
  assert.strictEqual(pts('blta', d), 30);
  rankingPoints.reverseForMatch(recent);
  assert.strictEqual(items(d).length, 0, 'the item goes with the match');
  assert.strictEqual(pts('blta', d), 0);
});

test('points of an event with a date (a tournament, a bonus) are added and leave 52 weeks later; an event older than 52 weeks is refused', async () => {
  const now = at('2026-11-13T12:00:00Z');
  const e = player('Def Player E');
  const made = expiry.addDated({ name: 'Def Player E', points: 40, date: '2026-11-15', kind: 'TOURNAMENT', label: 'Tenis ONE Trophy', now });
  assert.deepStrictEqual([made.ok, made.before, made.after], [true, 0, 40]);
  assert.strictEqual(pts('blta', e), 40);
  assert.ok(expiry.addDated({ name: 'Def Player E', points: 10, date: '2025-01-01', kind: 'BONUS', now }).error, 'older than 52 weeks');
  assert.ok(expiry.addDated({ name: 'Def Player E', points: 0, date: '2026-11-15', kind: 'BONUS', now }).error);
  assert.ok(expiry.addDated({ name: 'Def Player E', points: 5, date: '2026-11-15', kind: 'NOPE', now }).error);
  assert.ok(expiry.addDated({ name: 'Nobody Here', points: 5, date: '2026-11-15', kind: 'BONUS', now }).error);
  assert.strictEqual(pts('blta', e), 40);
  expiry.applyDue(at('2027-11-08T10:00:00Z'));
  assert.strictEqual(pts('blta', e), 40, 'Monday 8.11.2027 is too early (the event was on 15.11.2026)');
  expiry.applyDue(at('2027-11-15T10:00:00Z'));
  assert.strictEqual(pts('blta', e), 0);
  const upcoming = expiry.upcoming(3, at('2026-11-13T12:00:00Z'));
  assert.strictEqual(upcoming.length, 3);
  assert.strictEqual(upcoming[0].monday, '2026-11-09');
});

test('the check finds points that nothing stands behind, and an item can be made for points that are counted already', async () => {
  const f = player('Def Player F');
  const e = rankingPoints.entryFor('blta', f, true);
  db.prepare('UPDATE ranking_entries SET points = 15 WHERE id = ?').run(e.id);
  assert.ok(expiry.unaccounted().some((r) => r.name === 'Def Player F' && r.difference === 15));
  const made = expiry.addDated({ name: 'Def Player F', points: 15, date: '2026-11-12', kind: 'OTHER', alreadyCounted: true, now: at('2026-11-13T12:00:00Z') });
  assert.deepStrictEqual([made.before, made.after], [15, 15], 'the points are not added a second time');
  assert.ok(!expiry.unaccounted().some((r) => r.name === 'Def Player F'));
  assert.deepStrictEqual(expiry.forPlayer(f).map((x) => [x.date, x.expires, x.points]), [['2026-11-12', '2027-11-15', 15]], 'what he loses and on which Monday');
});

test('the rankings work out the defence FIRST (so the weekly message already knows the new points)', async () => {
  const g = player('Def Player G');
  const e = rankingPoints.entryFor('blta', g, true);
  db.prepare('UPDATE ranking_entries SET points = 100 WHERE id = ?').run(e.id);
  expiry.addItem({ entryId: e.id, kind: 'OTHER', points: 40, date: '2020-01-01', label: 'old' });
  const { buildRankings } = require('../src/routes/rankings');
  const data = buildRankings();
  const shown = data.tables.find((t) => t.key === 'blta').rows.find((r) => r.name === 'Def Player G');
  assert.strictEqual(shown.points, 60, 'the 40 old points are already off in what the rankings show');
});

test('the first-start list: every item has a kind, a whole number of points above 0 and a date; a match has its token', async () => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'rankingExpirySeed.json'), 'utf8'));
  assert.ok(Array.isArray(list));
  list.forEach(([kind, ref, name, points, date], i) => {
    assert.ok(['MATCH', 'PLAYOFF', 'BONUS', 'TOURNAMENT', 'OTHER'].includes(kind), `item ${i}: kind`);
    assert.ok(Number.isInteger(points) && points > 0, `item ${i}: points`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date), `item ${i}: date`);
    assert.ok(name && (kind !== 'MATCH' || ref), `item ${i}: name / match`);
  });
  // on a database that has none of these players nothing is made (and it is done once)
  const first = expiry.seed();
  assert.strictEqual(first.added, 0);
  assert.deepStrictEqual(expiry.seed(), { skipped: true });
});

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file is still open on Windows */ }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
