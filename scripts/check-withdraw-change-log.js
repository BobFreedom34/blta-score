// Checks that withdrawing a player from a group (their unplayed matches become walkovers) shows in the change log (Backend > Points log) and in the
// ranking points, like any other finished match. Runs the real flow through the API.
// Run: node scripts/check-withdraw-change-log.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-log-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let db = null;
let n = 0;

async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const newPlayer = (name) => Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, `wd-${n += 1}`).lastInsertRowid);
async function newMatch(category, p1, p2, groupId, seasonId) {
  const r = await call('POST', '/api/matches', { category, format: 'BO3', player1Id: p1, player2Id: p2, location: 'Court 1' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  db.prepare("UPDATE matches SET group_id = ?, season_id = ?, stage = 'GROUP' WHERE share_token = ?").run(groupId, seasonId, r.json.token);
  return r.json;
}
const log = async (query = '') => (await call('GET', `/api/changelog${query}`)).json;
const setup = {};

test('setup: a group of three players with three unplayed matches', async () => {
  setup.a = newPlayer('Wd Alpha');
  setup.b = newPlayer('Wd Bravo');
  setup.c = newPlayer('Wd Charlie');
  const season = await call('POST', '/api/seasons', { name: 'Wd Season', startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.strictEqual(season.status, 201);
  setup.season = season.json.id;
  const group = await call('POST', `/api/seasons/${setup.season}/groups`, { name: 'Wd Group', category: 'ELITE' });
  assert.ok(group.status === 201 || group.status === 200, JSON.stringify(group.json));
  setup.group = (group.json.groups || [group.json]).find((g) => g.name === 'Wd Group').id;
  [setup.a, setup.b, setup.c].forEach((id, i) => db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(setup.group, id, i));
  setup.ab = await newMatch('ELITE', setup.a, setup.b, setup.group, setup.season);
  setup.ac = await newMatch('ELITE', setup.a, setup.c, setup.group, setup.season);
  setup.bc = await newMatch('ELITE', setup.b, setup.c, setup.group, setup.season);
  assert.strictEqual((await log()).items.length, 0, 'the log starts empty');
});

test('withdrawing a player turns their matches into walkovers and writes one row per match to the log, with the group table and the ranking points', async () => {
  const r = await call('POST', `/api/seasons/groups/${setup.group}/members/${setup.a}/withdraw`, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.walkovers, 2);
  const { items } = await log();
  assert.strictEqual(items.length, 2, 'one row per walkover');
  items.forEach((e) => {
    assert.strictEqual(e.kind, 'FINISHED');
    assert.ok(e.title.includes('Wd Alpha'), e.title);
    assert.strictEqual(e.group.groupName, 'Wd Group');
    const winner = e.group.rows.find((row) => row.pointsAfter === 3);
    assert.ok(winner && winner.pointsBefore === 0 && winner.inMatch, `the opponent got the 3 points: ${JSON.stringify(e.group.rows)}`);
    // a walkover is a clean 2:0: the winner earns the ranking points, the loser 0
    assert.ok(e.ranking.length > 0 && e.ranking.every((x) => x.delta > 0 && x.name !== 'Wd Alpha'), JSON.stringify(e.ranking));
  });
  // the third match (Bravo vs Charlie) is not touched
  assert.strictEqual(db.prepare('SELECT status FROM matches WHERE share_token = ?').get(setup.bc.token).status, 'PLANNED');
});

test('the ranking points of the opponents are really in the tables', async () => {
  const points = (id) => db.prepare('SELECT COALESCE(SUM(points), 0) AS p FROM ranking_entries WHERE player_id = ?').get(id).p;
  assert.ok(points(setup.b) > 0, 'Bravo has points from the walkover');
  assert.ok(points(setup.c) > 0, 'Charlie has points from the walkover');
  assert.strictEqual(points(setup.a), 0);
});

test('the one-off catch-up gives the walkovers of an old withdrawal (made before the fix) their points once: 21 each in Next Gen, a log row each, nothing twice', async () => {
  const x = newPlayer('Slz Out');
  const y = newPlayer('Slz Yankee');
  const z = newPlayer('Slz Zulu');
  const season = await call('POST', '/api/seasons', { name: 'Slz Season', startDate: '2026-01-01', endDate: '2026-12-31' });
  const group = await call('POST', `/api/seasons/${season.json.id}/groups`, { name: 'Slazenger', category: 'NEXT_GEN' });
  const gid = (group.json.groups || [group.json]).find((g) => g.name === 'Slazenger').id;
  [x, y, z].forEach((id, i) => db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(gid, id, i));
  db.prepare("UPDATE season_group_members SET withdrawn_at = '2026-11-03T10:00:00.000Z' WHERE group_id = ? AND player_id = ?").run(gid, x);
  const xy = await newMatch('NEXT_GEN', x, y, gid, season.json.id);
  const zx = await newMatch('NEXT_GEN', z, x, gid, season.json.id);
  const yz = await newMatch('NEXT_GEN', y, z, gid, season.json.id);
  // what the old withdrawal did: only the match row, no ranking points, no log
  db.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ?, end_reason = 'WALKOVER', end_time = '2026-11-03T10:00:00.000Z' WHERE share_token = ?").run(y, xy.token);
  db.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ?, end_reason = 'WALKOVER', end_time = '2026-11-03T10:00:00.000Z' WHERE share_token = ?").run(z, zx.token);
  db.prepare("DELETE FROM app_flags WHERE key = 'withdraw_walkover_points_slazenger'").run(); // (the server's own start already ran it once, on the seeded group with nothing to fix)
  const logBefore = (await log()).items.length;
  const run = () => JSON.parse(require('child_process').execFileSync(process.execPath, ['-e',
    "const db=require('./src/db');console.log(JSON.stringify(require('./src/withdrawCatchUp').catchUp(db)))"], { cwd: ROOT, env: { ...process.env, DATA_DIR: serverDir }, encoding: 'utf8' }).trim().split('\n').pop());
  const first = run(); assert.strictEqual(first.fixed, 2, JSON.stringify(first));
  const pts = (id, table) => (db.prepare('SELECT points FROM ranking_entries WHERE player_id = ? AND table_key = ?').get(id, table) || { points: 0 }).points;
  assert.deepStrictEqual([pts(y, 'blta'), pts(y, 'next_gen_race'), pts(z, 'blta'), pts(z, 'next_gen_race'), pts(x, 'blta')], [21, 21, 21, 21, 0]);
  assert.strictEqual((await log()).items.length, logBefore + 2, 'one log row per walkover');
  assert.strictEqual(db.prepare('SELECT status FROM matches WHERE share_token = ?').get(yz.token).status, 'PLANNED', 'a match that is not a walkover is not touched');
  assert.deepStrictEqual(run(), { skipped: true }, 'it runs once');
  assert.strictEqual(pts(y, 'blta'), 21);
});

// ---------------------------------------------------------------- run
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
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
  assert.ok(cookie, 'admin login gave no cookie');
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
