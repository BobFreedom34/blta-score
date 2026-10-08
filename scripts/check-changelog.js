// Checks of the change log (Backend > Log, /api/changelog): what a finished, restarted, corrected or deleted match changed in the
// ranking points and the league group table, and manual ranking corrections. Runs the real flow through the API.
// Run: node scripts/check-changelog.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let db = null;
let n = 0;

async function call(method, url, body, withCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const newPlayer = (name) => Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, `lg-${n += 1}`).lastInsertRowid);
async function newMatch(category, p1, p2, groupId = null, seasonId = null) {
  const r = await call('POST', '/api/matches', { category, format: 'BO3', player1Id: p1, player2Id: p2, location: 'Court 1' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  if (groupId) db.prepare("UPDATE matches SET group_id = ?, season_id = ?, stage = 'GROUP' WHERE share_token = ?").run(groupId, seasonId, r.json.token);
  return r.json;
}
const finish = (token, sets, extra = {}) => call('POST', `/api/matches/${token}/manual-result`, { sets, location: 'Court 1', scheduledAt: '2026-10-08T10:00:00.000Z', ...extra });
const S = (a, b) => ({ p1: a, p2: b });
const log = async (query = '') => (await call('GET', `/api/changelog${query}`)).json;
const count = () => db.prepare('SELECT COUNT(*) AS n FROM change_log').get().n;
const rank = (entry, name, tableKey) => entry.ranking.find((r) => r.name === name && r.tableKey === tableKey);
const grp = (entry, name) => entry.group.rows.find((r) => r.name === name);

const setup = {};

test('setup: a season with an Elite group', async () => {
  setup.a = newPlayer('Log Alpha');
  setup.b = newPlayer('Log Bravo');
  setup.c = newPlayer('Log Charlie');
  const season = await call('POST', '/api/seasons', { name: 'Log Season', startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.strictEqual(season.status, 201);
  setup.season = season.json.id;
  const group = await call('POST', `/api/seasons/${setup.season}/groups`, { name: 'Log Group', category: 'ELITE' });
  assert.ok(group.status === 201 || group.status === 200, JSON.stringify(group.json));
  setup.group = (group.json.groups || [group.json]).find((g) => g.name === 'Log Group').id;
  assert.strictEqual(count(), 0, 'the log starts empty');
});

test('a match that is only created or played live writes nothing', async () => {
  const m = await newMatch('ELITE', setup.a, setup.b, setup.group, setup.season);
  assert.strictEqual(count(), 0);
  assert.strictEqual((await call('GET', `/api/matches/${m.token}`, undefined, false)).status, 200);
  assert.strictEqual(count(), 0);
  db.prepare('DELETE FROM matches WHERE share_token = ?').run(m.token);
});

test('finishing a group match logs the ranking points and the group table', async () => {
  const m = await newMatch('ELITE', setup.a, setup.b, setup.group, setup.season);
  assert.strictEqual((await finish(m.token, [S(6, 3), S(6, 4)])).status, 200);
  setup.first = m;
  const { items } = await log();
  assert.strictEqual(items.length, 1);
  const e = items[0];
  assert.strictEqual(e.kind, 'FINISHED');
  assert.strictEqual(e.title, 'Log Alpha vs Log Bravo');
  assert.strictEqual(e.matchToken, m.token);
  assert.strictEqual(e.category, 'ELITE');
  assert.ok(/6:3/.test(e.score) || e.score.length > 0, `score: ${e.score}`);
  assert.ok(e.createdAt);
  // ranking: the winner got 30 in the overall and the Elite table; the loser got 0 (not a change)
  assert.deepStrictEqual([rank(e, 'Log Alpha', 'blta').before, rank(e, 'Log Alpha', 'blta').after, rank(e, 'Log Alpha', 'blta').delta], [0, 30, 30]);
  assert.deepStrictEqual([rank(e, 'Log Alpha', 'elite_race').after, rank(e, 'Log Alpha', 'elite_race').delta], [30, 30]);
  assert.strictEqual(e.ranking.length, 2);
  assert.ok(e.ranking.every((r) => r.tableLabel));
  // the group table: Alpha 0 → 3 points, Bravo played one match
  assert.strictEqual(e.group.groupName, 'Log Group');
  assert.strictEqual(e.group.seasonName, 'Log Season');
  assert.strictEqual(e.group.category, 'ELITE');
  const alpha = grp(e, 'Log Alpha');
  assert.deepStrictEqual([alpha.pointsBefore, alpha.pointsAfter, alpha.playedBefore, alpha.playedAfter, alpha.winsAfter, alpha.inMatch], [0, 3, 0, 1, 1, true]);
  const bravo = grp(e, 'Log Bravo');
  assert.deepStrictEqual([bravo.pointsBefore, bravo.pointsAfter, bravo.playedAfter], [0, 0, 1]);
  assert.strictEqual(alpha.positionAfter, 1);
});

test('restarting a match logs what it took back, finishing it again with another score logs the new points', async () => {
  const before = count();
  assert.strictEqual((await call('POST', `/api/matches/${setup.first.token}/restart`)).status, 200);
  assert.strictEqual(count(), before + 1);
  const reopened = (await log()).items[0];
  assert.strictEqual(reopened.kind, 'REOPENED');
  assert.strictEqual(rank(reopened, 'Log Alpha', 'blta').delta, -30);
  assert.deepStrictEqual([grp(reopened, 'Log Alpha').pointsBefore, grp(reopened, 'Log Alpha').pointsAfter], [3, 0]);
  assert.strictEqual((await finish(setup.first.token, [S(3, 6), S(6, 4), S(4, 6)])).status, 200);
  const again = (await log()).items[0];
  assert.strictEqual(again.kind, 'FINISHED');
  assert.strictEqual(rank(again, 'Log Bravo', 'blta').delta, 20);
  assert.strictEqual(rank(again, 'Log Alpha', 'blta').delta, 10);
  // a 2:1: 2 points for the winner and 1 for the loser in the group table
  assert.deepStrictEqual([grp(again, 'Log Bravo').pointsAfter, grp(again, 'Log Alpha').pointsAfter], [2, 1]);
});

test('other players whose position moved are in the group part too', async () => {
  const m = await newMatch('ELITE', setup.c, setup.b, setup.group, setup.season);
  assert.strictEqual((await finish(m.token, [S(6, 0), S(6, 0)])).status, 200);
  const e = (await log()).items[0];
  const alpha = e.group.rows.find((r) => r.name === 'Log Alpha');
  assert.ok(alpha, 'Alpha is listed');
  assert.strictEqual(alpha.inMatch, false);
  assert.notStrictEqual(alpha.positionBefore, alpha.positionAfter);
  assert.strictEqual(e.group.rows[0].inMatch, true, 'the players of the match come first');
});

test('deleting a finished match logs the points it takes with it', async () => {
  const d = await newMatch('ELITE', setup.a, setup.c, setup.group, setup.season);
  await finish(d.token, [S(6, 1), S(6, 1)]);
  const before = count();
  assert.strictEqual((await call('DELETE', `/api/matches/${d.token}`)).status, 204);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(count(), before + 1);
  const e = (await log()).items[0];
  assert.strictEqual(e.kind, 'DELETED');
  assert.strictEqual(e.title, 'Log Alpha vs Log Charlie');
  assert.strictEqual(rank(e, 'Log Alpha', 'blta').delta, -30);
  assert.deepStrictEqual([grp(e, 'Log Alpha').pointsBefore - grp(e, 'Log Alpha').pointsAfter], [3]);
});

test('a walkover is logged as 3 / 0 for the winner; a friendly and an unfinished delete write nothing', async () => {
  const w = await newMatch('NEXT_GEN', setup.a, setup.b);
  const before = count();
  assert.strictEqual((await finish(w.token, [], { winner: 2, reason: 'WALKOVER' })).status, 200);
  const e = (await log()).items[0];
  assert.strictEqual(count(), before + 1);
  assert.strictEqual(rank(e, 'Log Bravo', 'next_gen_race').delta, 21);
  assert.strictEqual(e.group, null, 'no group, no group part');
  const f = await newMatch('FRIENDLY', setup.a, setup.b);
  await finish(f.token, [S(6, 1), S(6, 1)]);
  assert.strictEqual(count(), before + 1, 'a friendly changes nothing');
  const live = await newMatch('ELITE', setup.b, setup.c);
  assert.strictEqual((await call('DELETE', `/api/matches/${live.token}`)).status, 204);
  assert.strictEqual(count(), before + 1, 'deleting a match that was never finished changes nothing');
});

test('a manual correction of the ranking points is logged, an unchanged value is not', async () => {
  const before = count();
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Log%20Alpha', { points: 55 })).status, 200);
  assert.strictEqual(count(), before + 1);
  let e = (await log()).items[0];
  assert.strictEqual(e.kind, 'MANUAL');
  assert.strictEqual(e.title, 'Log Alpha');
  assert.deepStrictEqual([e.ranking[0].before, e.ranking[0].after, e.ranking[0].delta, e.ranking[0].tableKey], [0, 55, 55, 'tournaments']);
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Log%20Alpha', { points: 55 })).status, 200);
  assert.strictEqual(count(), before + 1, 'the same value again is no change');
  assert.strictEqual((await call('PUT', '/api/rankings/points/tournaments/Log%20Alpha', { points: 40 })).status, 200);
  e = (await log()).items[0];
  assert.deepStrictEqual([e.ranking[0].before, e.ranking[0].after, e.ranking[0].delta], [55, 40, -15]);
});

test('the list: newest first, paged, filtered by kind and by a name; only for an admin', async () => {
  const all = await log('?limit=200');
  assert.ok(all.items.length >= 6);
  assert.ok(all.items.every((x, i) => i === 0 || x.id < all.items[i - 1].id), 'newest first');
  const page1 = await log('?limit=2');
  assert.strictEqual(page1.items.length, 2);
  assert.strictEqual(page1.hasMore, true);
  const page2 = await log(`?limit=2&before=${page1.items[1].id}`);
  assert.ok(page2.items[0].id < page1.items[1].id);
  assert.deepStrictEqual((await log('?kind=MANUAL')).items.map((x) => x.kind), ['MANUAL', 'MANUAL']);
  assert.ok((await log('?kind=DELETED')).items.every((x) => x.kind === 'DELETED'));
  const byName = await log('?q=Charlie');
  assert.ok(byName.items.length >= 2 && byName.items.every((x) => JSON.stringify(x).includes('Log Charlie')));
  assert.strictEqual((await log('?q=Nobody%20Like%20This')).items.length, 0);
  assert.strictEqual((await call('GET', '/api/changelog', undefined, false)).status, 401);
});

test('a log row keeps its text after the match and the players are gone', async () => {
  const e = (await log('?kind=DELETED')).items[0];
  assert.strictEqual(e.title, 'Log Alpha vs Log Charlie');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE share_token = ?').get(e.matchToken).n, 0);
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
