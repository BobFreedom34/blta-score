// Checks of the app's own ranking tables (src/rankingPoints.js, src/rankingsSeed.js, /api/rankings):
//   - the points rules for every score and level, in-process
//   - the one-time start-up step: the saved numbers become the tables, the ledger of earlier matches is rebuilt
//   - the real flow through the API: finish, restart, re-finish, delete, walkover, a friendly, an admin's edit
//   - nothing is sent anywhere (a fake "WordPress plugin" is given as the old SPORTSPRESS_* address and must stay unvisited)
// Run: node scripts/check-rankings.js   (uses temporary data folders; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'rankingsBaseline.json'), 'utf8'));
const inProcessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankings-unit-'));
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankings-server-'));
// the in-process part uses its own data folder (db.js reads it when it is first required)
process.env.DATA_DIR = inProcessDir;
const db = require('../src/db');
const rankingPoints = require('../src/rankingPoints');
const { seedRankings } = require('../src/rankingsSeed');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ================================================================ the rules, in-process
function match(category, s1, s2, extra = {}) {
  return {
    id: 1, category, player1_id: 1, player2_id: 2, format: 'BO3', status: 'FINISHED', winner_id: s1 > s2 ? 1 : 2, end_reason: null,
    state: JSON.stringify({ setsWon: { 1: s1, 2: s2 } }), ...extra,
  };
}
const pointsOf = (m) => {
  const c = rankingPoints.computeAwards(m);
  if (!c) return null;
  return { winner: c.awards[0].points, loser: c.awards[1].points, winnerId: c.awards[0].playerId, tables: c.tableKeys.join('+') };
};

test('points: win 2:0 → 3, win 2:1 → 2, loss 1:2 → 1, loss 0:2 → 0, times 10 / 7 / 4', async () => {
  const expected = { ELITE: [30, 0, 20, 10], NEXT_GEN: [21, 0, 14, 7], NOVICE: [12, 0, 8, 4] };
  Object.entries(expected).forEach(([category, [w20, l20, w21, l21]]) => {
    const straight = pointsOf(match(category, 2, 0));
    assert.deepStrictEqual([straight.winner, straight.loser], [w20, l20], `${category} 2:0`);
    const three = pointsOf(match(category, 2, 1));
    assert.deepStrictEqual([three.winner, three.loser], [w21, l21], `${category} 2:1`);
  });
});

test('points go to the right player and to the overall and the category table', async () => {
  const first = pointsOf(match('ELITE', 2, 0));
  assert.strictEqual(first.winnerId, 1);
  assert.strictEqual(first.tables, 'blta+elite_race');
  const second = pointsOf(match('NEXT_GEN', 0, 2));
  assert.strictEqual(second.winnerId, 2);
  assert.strictEqual(second.tables, 'blta+next_gen_race');
  assert.strictEqual(pointsOf(match('NOVICE', 1, 2)).tables, 'blta+novice_race');
});

test('only BLTA matches count (a friendly, a VIP cup, an unknown category earn nothing)', async () => {
  ['FRIENDLY', 'VIP_CUP', 'ATA_TENNIS', 'OTHER', '', null].forEach((category) => assert.strictEqual(pointsOf(match(category, 2, 0)), null, String(category)));
});

test('a walkover or a retirement is a clean 3 / 0 for the winner, whatever the partial score says', async () => {
  const walkover = pointsOf(match('ELITE', 0, 0, { end_reason: 'WALKOVER', winner_id: 2 }));
  assert.deepStrictEqual([walkover.winner, walkover.loser, walkover.winnerId], [30, 0, 2]);
  const retired = pointsOf(match('NOVICE', 1, 0, { end_reason: 'RETIREMENT', winner_id: 1 }));
  assert.deepStrictEqual([retired.winner, retired.loser, retired.winnerId], [12, 0, 1]);
});

test('matches that are not decided in two sets earn nothing (nothing decided, one set, five sets, broken state)', async () => {
  assert.strictEqual(pointsOf(match('ELITE', 0, 0)), null);
  assert.strictEqual(pointsOf(match('ELITE', 1, 0, { format: 'BO1' })), null);
  assert.strictEqual(pointsOf(match('ELITE', 3, 1, { format: 'BO5' })), null);
  assert.strictEqual(pointsOf(match('ELITE', 1, 1)), null);
  assert.strictEqual(pointsOf({ ...match('ELITE', 2, 0), state: 'not json' }), null);
});

// ================================================================ the one-time start-up step, in-process
function insertPlayer(name, slug) {
  return Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, slug).lastInsertRowid);
}
let counter = 0;
function insertMatch(category, p1, p2, s1, s2, { snapshot = null, endTime = '2026-01-01T10:00:00.000Z' } = {}) {
  counter += 1;
  return Number(db.prepare(`INSERT INTO matches (share_token, category, player1_id, player2_id, format, status, state, winner_id, end_time, ranking_points_snapshot)
    VALUES (?, ?, ?, ?, 'BO3', 'FINISHED', ?, ?, ?, ?)`).run(`tok-${counter}`, category, p1, p2, JSON.stringify({ setsWon: { 1: s1, 2: s2 } }), s1 > s2 ? p1 : p2, endTime, snapshot).lastInsertRowid);
}
const rowOf = (tableKey, name) => db.prepare('SELECT * FROM ranking_entries WHERE table_key = ? AND name_key = ?').get(tableKey, rankingPoints.normalizeName(name));
const baseRow = (tableKey, name) => baseline.tables.find((t) => t.key === tableKey).rows.find((r) => rankingPoints.normalizeName(r.name) === rankingPoints.normalizeName(name));
const setup = {};

test('start-up step: the saved numbers become the tables; an old admin correction is applied; players are linked by name', async () => {
  const eliteRows = baseline.tables.find((t) => t.key === 'elite_race').rows;
  setup.leader = eliteRows[0].name;
  setup.other = eliteRows[1].name;
  setup.leaderId = insertPlayer(setup.leader, 'leader');
  setup.otherId = insertPlayer(setup.other, 'other');
  db.prepare('INSERT INTO ranking_overrides (table_key, player_name, points) VALUES (?, ?, ?)').run('elite_race', rankingPoints.normalizeName(setup.leader), 9999);
  // two matches that had been sent to blta.sk: one finished before the copy was taken, one after it
  setup.oldMatch = insertMatch('ELITE', setup.leaderId, setup.otherId, 2, 1, { snapshot: '{"tableId":1,"raceKey":"eliterace","awards":{}}', endTime: '2020-01-01T10:00:00.000Z' });
  setup.newMatch = insertMatch('NEXT_GEN', setup.leaderId, setup.otherId, 2, 0, { snapshot: '{"tableId":1,"raceKey":"nextgenrace","awards":{}}', endTime: '2999-01-01T10:00:00.000Z' });
  // and one that was never sent (no snapshot): it is not in the numbers, and it stays out
  setup.unsent = insertMatch('NOVICE', setup.leaderId, setup.otherId, 2, 0, { snapshot: null });
  // a match of a player who is not in the saved numbers at all, sent before the copy: nothing of his to take back, no row made
  setup.strangerId = insertPlayer('Not In The Numbers', 'stranger');
  setup.strangerMatch = insertMatch('ELITE', setup.strangerId, setup.otherId, 2, 0, { snapshot: '{"tableId":1,"raceKey":"eliterace","awards":{}}', endTime: '2020-01-02T10:00:00.000Z' });

  const result = seedRankings(db);
  assert.strictEqual(result.rows, baseline.tables.reduce((n, t) => n + t.rows.length, 0));
  assert.strictEqual(result.backfilled, 2);
  assert.strictEqual(result.added, 1);

  // every row is there with the saved numbers — except the ones the checks below look at on purpose
  baseline.tables.forEach((t) => t.rows.forEach((r) => {
    const entry = rowOf(t.key, r.name);
    assert.ok(entry, `${t.key}: ${r.name} missing`);
    const touched = [setup.leader, setup.other].includes(r.name) && ['elite_race', 'blta', 'next_gen_race'].includes(t.key);
    if (!touched) assert.strictEqual(entry.points, r.points, `${t.key}: ${r.name}`);
    assert.ok(entry.matches >= (r.matches || 0));
  }));
  assert.strictEqual(rowOf('elite_race', setup.leader).points, 9999, 'the old admin correction wins');
  assert.strictEqual(rowOf('elite_race', setup.leader).player_id, setup.leaderId, 'linked to the player of that name');
  assert.strictEqual(rowOf('elite_race', 'Not In The Numbers'), undefined, 'no row made for a player who was not in the numbers');
});

test('start-up step: an earlier match only gets its ledger rows, a newer one is added, an unsent one is left alone', async () => {
  const awards = (matchId) => db.prepare('SELECT * FROM ranking_awards WHERE match_id = ?').all(matchId);
  assert.deepStrictEqual(awards(setup.oldMatch).map((a) => a.points).sort((a, b) => a - b), [10, 10, 20, 20], 'overall + race, winner and loser');
  assert.strictEqual(awards(setup.unsent).length, 0);
  assert.strictEqual(awards(setup.strangerMatch).length, 2, 'only the player who is in the numbers (overall + race)');
  // the Next Gen match after the copy: +21 for the winner in the overall table (on top of the saved number) and in the race table
  assert.strictEqual(rowOf('blta', setup.leader).points, (baseRow('blta', setup.leader).points || 0) + 21);
  assert.strictEqual(rowOf('next_gen_race', setup.leader).points, (baseRow('next_gen_race', setup.leader).points || 0) + 21);
  // the loser of that match gets 0 and the match counts for both
  assert.strictEqual(rowOf('next_gen_race', setup.other).points, baseRow('next_gen_race', setup.other).points === null ? 0 : baseRow('next_gen_race', setup.other).points);
  assert.strictEqual(rowOf('next_gen_race', setup.other).matches, (baseRow('next_gen_race', setup.other).matches || 0) + 1);
});

test('start-up step: it runs once', async () => {
  assert.deepStrictEqual(seedRankings(db), { skipped: true });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM ranking_entries').get().n, baseline.tables.reduce((n, t) => n + t.rows.length, 0));
});

test('a correction of an earlier match takes back exactly what it was worth, then adds the new result', async () => {
  const leaderBlta = rowOf('blta', setup.leader).points;
  const leaderElite = rowOf('elite_race', setup.leader).points;
  const otherBlta = rowOf('blta', setup.other).points;
  const otherElite = rowOf('elite_race', setup.other).points;
  // the old ELITE match 2:1 for the leader is corrected to 0:2
  db.prepare('UPDATE matches SET state = ?, winner_id = ? WHERE id = ?').run(JSON.stringify({ setsWon: { 1: 0, 2: 2 } }), setup.otherId, setup.oldMatch);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(setup.oldMatch);
  rankingPoints.reconcile(null, updated);
  assert.strictEqual(rowOf('blta', setup.leader).points, leaderBlta - 20, 'the 20 points of the 2:1 win are gone, the 0:2 loser gets 0');
  assert.strictEqual(rowOf('elite_race', setup.leader).points, leaderElite - 20);
  assert.strictEqual(rowOf('blta', setup.other).points, otherBlta - 10 + 30, 'the 10 of the 1:2 loss are gone, the 0:2 win is 30');
  assert.strictEqual(rowOf('elite_race', setup.other).points, (otherElite === null ? 0 : otherElite) - 10 + 30);
  // reconcile twice changes nothing
  rankingPoints.reconcile(null, updated);
  assert.strictEqual(rowOf('blta', setup.other).points, otherBlta - 10 + 30);
});

test('a ranking row follows the player when the player is renamed', async () => {
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run('Renamed Player', setup.otherId);
  const tables = rankingPoints.getTables().tables;
  const expected = rowOf('elite_race', setup.other).points;
  assert.ok(tables.find((t) => t.key === 'elite_race').rows.some((r) => r.name === 'Renamed Player' && r.points === expected));
  assert.ok(!tables.find((t) => t.key === 'elite_race').rows.some((r) => r.name === setup.other));
});

// ================================================================ ranks
test('ranks: BLTA overall is 1, 2, 3… (ties in the order they came in), the others share a rank on equal points', async () => {
  const tables = rankingPoints.getTables().tables;
  const blta = tables.find((t) => t.key === 'blta').rows;
  blta.forEach((r, i) => assert.strictEqual(r.rank, i + 1));
  for (let i = 1; i < blta.length; i += 1) assert.ok((blta[i - 1].points ?? -1) >= (blta[i].points ?? -1), 'points never go up down the table');
  const race = tables.find((t) => t.key === 'novice_race').rows;
  race.forEach((r, i) => {
    if (i > 0 && r.points === race[i - 1].points) assert.strictEqual(r.rank, race[i - 1].rank, 'equal points share a rank');
    else assert.strictEqual(r.rank, i + 1);
  });
});

// ================================================================ the real flow, through the API
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
let child = null;
let cookie = '';
let fakePlugin = null;
let pluginHits = 0;
let serverDb = null;
let n = 0;

async function call(method, url, body, withCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const newPlayer = (name) => Number(serverDb.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, `s-${n += 1}`).lastInsertRowid);
async function newMatch(category, p1, p2) {
  const r = await call('POST', '/api/matches', { category, format: 'BO3', player1Id: p1, player2Id: p2, location: 'Court 1' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
const finish = (token, sets, extra = {}) => call('POST', `/api/matches/${token}/manual-result`, { sets, location: 'Court 1', scheduledAt: '2026-10-08T10:00:00.000Z', ...extra });
const S = (a, b) => ({ p1: a, p2: b });
async function tableRow(tableKey, name) {
  const all = (await call('GET', '/api/rankings', undefined, false)).json;
  return all.tables.find((t) => t.key === tableKey).rows.find((r) => r.name === name) || null;
}
const pts = async (tableKey, name) => { const r = await tableRow(tableKey, name); return r ? [r.points, r.matches] : null; };

test('api: the tables are the saved numbers, in all five tabs', async () => {
  const all = (await call('GET', '/api/rankings', undefined, false)).json;
  assert.deepStrictEqual(all.tables.map((t) => t.key), ['blta', 'elite_race', 'next_gen_race', 'novice_race', 'tournaments']);
  baseline.tables.forEach((bt) => {
    const t = all.tables.find((x) => x.key === bt.key);
    assert.strictEqual(t.rows.length, bt.rows.length, bt.key);
    bt.rows.forEach((r) => {
      const row = t.rows.find((x) => x.name === r.name);
      assert.ok(row, `${bt.key}: ${r.name}`);
      assert.strictEqual(row.points, r.points, `${bt.key}: ${r.name} points`);
      assert.strictEqual(row.matches, r.matches, `${bt.key}: ${r.name} matches`);
    });
  });
});

test('api: a finished Elite match 6:3 6:4 gives 30 / 0 in the overall and the Elite table', async () => {
  const a = newPlayer('Api Elite A'); const b = newPlayer('Api Elite B');
  const m = await newMatch('ELITE', a, b);
  const r = await finish(m.token, [S(6, 3), S(6, 4)]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(await pts('blta', 'Api Elite A'), [30, 1]);
  assert.deepStrictEqual(await pts('elite_race', 'Api Elite A'), [30, 1]);
  assert.deepStrictEqual(await pts('blta', 'Api Elite B'), [0, 1]);
  assert.strictEqual(await pts('next_gen_race', 'Api Elite A'), null, 'not in another level\'s table');
});

test('api: a 2:1 gives 14 / 7 (Next Gen) and 8 / 4 (Novice)', async () => {
  const a = newPlayer('Api NG A'); const b = newPlayer('Api NG B');
  assert.strictEqual((await finish((await newMatch('NEXT_GEN', a, b)).token, [S(6, 3), S(4, 6), S(7, 5)])).status, 200);
  assert.deepStrictEqual(await pts('next_gen_race', 'Api NG A'), [14, 1]);
  assert.deepStrictEqual(await pts('next_gen_race', 'Api NG B'), [7, 1]);
  const c = newPlayer('Api NO A'); const d = newPlayer('Api NO B');
  assert.strictEqual((await finish((await newMatch('NOVICE', c, d)).token, [S(3, 6), S(6, 4), S(2, 6)])).status, 200);
  assert.deepStrictEqual(await pts('novice_race', 'Api NO B'), [8, 1]);
  assert.deepStrictEqual(await pts('novice_race', 'Api NO A'), [4, 1]);
});

test('api: a restarted match gives its points back, finishing it again with another result gives the new points', async () => {
  const a = newPlayer('Api Re A'); const b = newPlayer('Api Re B');
  const m = await newMatch('ELITE', a, b);
  await finish(m.token, [S(6, 0), S(6, 0)]);
  assert.deepStrictEqual(await pts('blta', 'Api Re A'), [30, 1]);
  assert.strictEqual((await call('POST', `/api/matches/${m.token}/restart`)).status, 200);
  assert.deepStrictEqual(await pts('blta', 'Api Re A'), [0, 0], 'taken back');
  assert.deepStrictEqual(await pts('blta', 'Api Re B'), [0, 0]);
  assert.strictEqual((await finish(m.token, [S(3, 6), S(6, 4), S(4, 6)])).status, 200);
  assert.deepStrictEqual(await pts('blta', 'Api Re B'), [20, 1]);
  assert.deepStrictEqual(await pts('blta', 'Api Re A'), [10, 1]);
});

test('api: a deleted match takes its points with it', async () => {
  const a = newPlayer('Api Del A'); const b = newPlayer('Api Del B');
  const m = await newMatch('NOVICE', a, b);
  await finish(m.token, [S(6, 2), S(6, 2)]);
  assert.deepStrictEqual(await pts('novice_race', 'Api Del A'), [12, 1]);
  assert.strictEqual((await call('DELETE', `/api/matches/${m.token}`)).status, 204);
  assert.deepStrictEqual(await pts('novice_race', 'Api Del A'), [0, 0]);
});

test('api: a walkover is 3 / 0 for the winner (times the level), a friendly earns nothing', async () => {
  const a = newPlayer('Api Wo A'); const b = newPlayer('Api Wo B');
  const w = await newMatch('NEXT_GEN', a, b);
  const r = await finish(w.token, [], { winner: 2, reason: 'WALKOVER' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(await pts('next_gen_race', 'Api Wo B'), [21, 1]);
  assert.deepStrictEqual(await pts('next_gen_race', 'Api Wo A'), [0, 1]);
  const c = newPlayer('Api Fr A'); const d = newPlayer('Api Fr B');
  const f = await newMatch('FRIENDLY', c, d);
  assert.strictEqual((await finish(f.token, [S(6, 1), S(6, 1)])).status, 200);
  assert.strictEqual(await pts('blta', 'Api Fr A'), null);
});

test('api: an admin sets points — also for a player who is not in the table yet — and bad requests are refused', async () => {
  const p = newPlayer('Api Manual');
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Api%20Manual', { points: 55 })).status, 200);
  assert.deepStrictEqual(await pts('tournaments', 'Api Manual'), [55, 0]);
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Api%20Manual', { points: 60 })).status, 200);
  assert.deepStrictEqual(await pts('tournaments', 'Api Manual'), [60, 0]);
  assert.strictEqual((await call('PUT', '/api/rankings/points/blta/Api%20Manual', { points: null })).status, 200);
  assert.strictEqual((await pts('blta', 'Api Manual'))[0], null);
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Api%20Manual', { points: 1.5 })).status, 400);
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Nobody%20Here', { points: 5 })).status, 400);
  assert.strictEqual((await call('PUT', '/api/rankings/points/nonsense/Api%20Manual', { points: 5 })).status, 400);
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Api%20Manual', { points: 5 }, false)).status, 401);
  assert.ok(p);
});

test('api: the small rank list and the history keep working', async () => {
  const ranks = (await call('GET', '/api/rankings/ranks', undefined, false)).json.ranks;
  assert.strictEqual(ranks[baseline.tables[0].rows[0].name], 1);
  assert.strictEqual((await call('GET', `/api/rankings/history/blta/${encodeURIComponent(baseline.tables[0].rows[0].name)}`, undefined, false)).status, 200);
});

test('nothing is sent to the old plugin (not for a finish, a restart, a delete)', async () => {
  assert.strictEqual(pluginHits, 0, `the fake plugin was visited ${pluginHits} times`);
});

// ================================================================ run
async function main() {
  let failed = 0;
  try {
    // a fake "WordPress plugin": the old settings point at it; it must never be called
    fakePlugin = http.createServer((req, res) => { pluginHits += 1; res.end('{}'); });
    await new Promise((r) => fakePlugin.listen(0, r));
    const pluginUrl = `http://localhost:${fakePlugin.address().port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test',
        SPORTSPRESS_SITE_URL: pluginUrl, SPORTSPRESS_API_USER: 'x', SPORTSPRESS_API_APP_PASSWORD: 'y',
      },
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
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    serverDb = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
    serverDb.exec('PRAGMA busy_timeout = 5000');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    if (fakePlugin) fakePlugin.close();
    try { if (serverDb) serverDb.close(); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
    fs.rmSync(inProcessDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
