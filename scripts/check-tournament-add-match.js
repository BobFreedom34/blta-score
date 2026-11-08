// Checks of adding a match to a tournament by hand (GET /api/seasons/:id/match-options, POST /api/seasons/:id/matches): the match is a real match of the group and the
// round (it counts in the table), rules for the players, the court and the time, and who may do it.
// Run: node scripts/check-tournament-add-match.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tam-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;

async function call(method, url, { body, cookie = adminCookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

let tournament;
let groupId;
const P = {};
const NAMES = ['Anna Alfa', 'Boris Beta', 'Cyril Gama', 'Dana Delta', 'Emil Epsilon', 'Filip Zeta', 'Outsider Mimo'];
const options = (cookie) => call('GET', `/api/seasons/${tournament.id}/match-options`, { cookie });
const add = (body, cookie) => call('POST', `/api/seasons/${tournament.id}/matches`, { body, cookie });
const matchCount = () => db.prepare('SELECT COUNT(*) AS n FROM matches WHERE group_id = ?').get(groupId).n;
const schedule = async () => (await call('GET', `/api/seasons/${tournament.id}/schedule`, { cookie: '' })).json;

test('setup: a tournament with courts, a Swiss group of six players and a finished match of round 1', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Add Cup 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-01' } });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  const set = await call('PATCH', `/api/seasons/${tournament.id}`, { body: { courtCount: 2, matchMinutes: 30, restMinutes: 0, dayStart: '09:00', dayEnd: '12:00' } });
  assert.strictEqual(set.status, 200, set.text);
  for (const name of NAMES) P[name.split(' ')[0]] = (await call('POST', '/api/players', { body: { name } })).json;
  db.prepare("INSERT INTO tournament_categories (season_id, category, format, group_format) VALUES (?, 'OPEN', 'SWISS', 'BO1')").run(tournament.id);
  groupId = Number(db.prepare("INSERT INTO season_groups (season_id, name, category) VALUES (?, 'Skupina A', 'OPEN')").run(tournament.id).lastInsertRowid);
  ['Anna', 'Boris', 'Cyril', 'Dana', 'Emil', 'Filip'].forEach((n, i) => db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(groupId, P[n].id, i));
  const m = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', player1Id: P.Anna.id, player2Id: P.Boris.id, format: 'BO1', location: 'x', scheduledAt: '2099-05-01T08:00:00.000Z' } });
  assert.strictEqual(m.status, 201, m.text);
  db.prepare("UPDATE matches SET category = 'OTHER', season_id = ?, group_id = ?, round = 1, stage = 'GROUP' WHERE share_token = ?").run(tournament.id, groupId, m.json.token);
});

test('the form data: the groups of the tournament with their players, the rounds, the courts; for the organiser only', async () => {
  const o = await options();
  assert.strictEqual(o.status, 200, o.text);
  assert.strictEqual(o.json.courtCount, 2);
  const g = o.json.groups.find((x) => x.id === groupId);
  assert.ok(g, 'the group');
  assert.deepStrictEqual(g.players.map((p) => p.name).sort(), ['Anna Alfa', 'Boris Beta', 'Cyril Gama', 'Dana Delta', 'Emil Epsilon', 'Filip Zeta']);
  assert.deepStrictEqual([g.currentRound, g.name], [1, 'Skupina A']);
  assert.strictEqual((await options('')).status, 401, 'a visitor');
  const league = await call('POST', '/api/seasons', { body: { name: 'Liga X', startDate: '2099-03-01', endDate: '2099-06-01' } });
  assert.ok([400, 404].includes((await call('GET', `/api/seasons/${league.json.id}/match-options`)).status), 'a league season has none (refused like the other tournament-only routes)');
});

test('a match is added to the group and the round: a real match of the tournament that the planner puts on a court', async () => {
  const before = matchCount();
  const r = await add({ groupId, round: 3, player1Id: P.Cyril.id, player2Id: P.Dana.id });
  assert.strictEqual(r.status, 201, r.text);
  assert.ok(r.json.token);
  assert.strictEqual(matchCount(), before + 1);
  const m = (await call('GET', `/api/matches/${r.json.token}`)).json;
  assert.deepStrictEqual([m.season && m.season.name, !!m.group, m.round, m.category, m.stage, m.status, m.format], ['Add Cup 2099', true, 3, 'OTHER', 'GROUP', 'PLANNED', 'BO1'], 'in the tournament, group and round, with the format of the group');
  const row = (await schedule()).matches.find((x) => x.token === r.json.token);
  assert.ok(row, 'in the schedule of the tournament');
  assert.ok(row.courtNo && row.scheduledAt, 'placed on a court by the planner');
});

test('with a court and a time it goes exactly there; a taken court at that time refuses it and creates nothing', async () => {
  const r = await add({ groupId, round: 3, player1Id: P.Emil.id, player2Id: P.Filip.id, courtNo: 2, scheduledAt: '2099-05-01T09:00:00.000Z' });
  assert.strictEqual(r.status, 201, r.text);
  const row = (await schedule()).matches.find((x) => x.token === r.json.token);
  assert.deepStrictEqual([row.courtNo, row.scheduledAt, row.locked], [2, '2099-05-01T09:00:00.000Z', true]);
  const before = matchCount();
  const taken = await add({ groupId, round: 4, player1Id: P.Anna.id, player2Id: P.Cyril.id, courtNo: 2, scheduledAt: '2099-05-01T09:00:00.000Z' });
  assert.strictEqual(taken.status, 409, taken.text);
  assert.strictEqual(matchCount(), before, 'nothing was created');
  const badCourt = await add({ groupId, round: 4, player1Id: P.Anna.id, player2Id: P.Cyril.id, courtNo: 9, scheduledAt: '2099-05-01T10:00:00.000Z' });
  assert.strictEqual(badCourt.status, 400, badCourt.text);
  assert.strictEqual(matchCount(), before);
});

test('the rules: both players of the group and different; a rematch and two matches of a player in one round need the confirmation', async () => {
  const bad = [
    [{ groupId, round: 5, player1Id: P.Anna.id, player2Id: P.Anna.id }, 400, 'the same player twice'],
    [{ groupId, round: 5, player1Id: P.Anna.id, player2Id: P.Outsider.id }, 400, 'a player who is not in the group'],
    [{ groupId: 99999, round: 5, player1Id: P.Anna.id, player2Id: P.Cyril.id }, 404, 'a group that does not exist'],
    [{ groupId, round: 0, player1Id: P.Anna.id, player2Id: P.Cyril.id }, 400, 'round 0'],
    [{ groupId, round: 'x', player1Id: P.Anna.id, player2Id: P.Cyril.id }, 400, 'a round that is not a number'],
    [{ groupId, round: 5 }, 400, 'no players'],
  ];
  const before = matchCount();
  for (const [body, status, label] of bad) assert.strictEqual((await add(body)).status, status, label);
  assert.strictEqual(matchCount(), before, 'nothing was created');
  const rematch = await add({ groupId, round: 5, player1Id: P.Boris.id, player2Id: P.Anna.id });
  assert.strictEqual(rematch.status, 409, rematch.text);
  assert.strictEqual(rematch.json.code, 'REMATCH');
  const sameRound = await add({ groupId, round: 3, player1Id: P.Cyril.id, player2Id: P.Boris.id });
  assert.strictEqual(sameRound.status, 409, sameRound.text);
  assert.strictEqual(sameRound.json.code, 'SAME_ROUND');
  assert.strictEqual(matchCount(), before, 'still nothing');
  const forced = await add({ groupId, round: 5, player1Id: P.Boris.id, player2Id: P.Anna.id, force: true });
  assert.strictEqual(forced.status, 201, forced.text);
  assert.strictEqual(matchCount(), before + 1, 'with the confirmation it is made');
});

test('only the organiser can add a match; the new match is part of the group table', async () => {
  const r = await add({ groupId, round: 6, player1Id: P.Dana.id, player2Id: P.Emil.id }, '');
  assert.strictEqual(r.status, 401, 'a visitor');
  const standings = (await call('GET', `/api/seasons/${tournament.id}/standings`, { cookie: '' })).json;
  const group = (standings.groups || []).find((g) => g.id === groupId);
  assert.ok(group, 'the group table');
  assert.ok(group.matchesTotal >= 4, `the added matches count in the table: ${group.matchesTotal}`);
});

test('the Harmonogram has the button and the form: for the organiser only, with the confirmation for a rematch and a second match in a round', async () => {
  const js = (await call('GET', '/js/court-schedule.js', { cookie: '' })).text;
  const admin = js.slice(js.indexOf('function csAdminHtml()'), js.indexOf('// ---------- drawing ----------'));
  assert.ok(admin.includes('data-cs="addmatch"'), 'the button is in the admin part of the Harmonogram');
  for (const piece of ['function csOpenAddMatch(', '/match-options', '/matches`', 'REMATCH', 'SAME_ROUND', "kind === 'addmatch'", 'cs-addmatch-modal']) assert.ok(js.includes(piece), piece);
  const i18n = (await call('GET', '/css/style.css', { cookie: '' })).text;
  assert.ok(i18n.includes('.cs-addmatch'), 'its styles');
});

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
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
  db = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
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
    if (db) db.close();
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
