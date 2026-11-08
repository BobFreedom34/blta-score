// Check that editing a match of a tournament (the "Upraviť zápas" window: place, time, notes, the players) keeps it in its tournament and group. The window always sends the
// category of the match; a tournament match is "Iné" (OTHER), and saving it used to clear its season and group, so it was left behind as an ordinary match of the league.
// Run: node scripts/check-tournament-match-edit.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-server-'));

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
let group;
const players = [];
let token = '';

test('setup: a tournament with a group and a match of it (category Iné), as a Swiss round makes them', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Edit Cup 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-01' } });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  for (const name of ['Edit Alfa', 'Edit Beta', 'Edit Gama']) players.push((await call('POST', '/api/players', { body: { name } })).json);
  const g = db.prepare("INSERT INTO season_groups (season_id, name, category) VALUES (?, 'Skupina A', 'OPEN')").run(tournament.id);
  group = Number(g.lastInsertRowid);
  const m = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', player1Id: players[0].id, player2Id: players[1].id, format: 'BO1', location: 'Kurt 1', scheduledAt: '2099-05-01T08:00:00.000Z' } });
  assert.strictEqual(m.status, 201, m.text);
  token = m.json.token;
  db.prepare("UPDATE matches SET category = 'OTHER', season_id = ?, group_id = ?, round = 3, stage = 'GROUP' WHERE share_token = ?").run(tournament.id, group, token);
  const seen = (await call('GET', `/api/matches/${token}`)).json;
  assert.ok(seen.season && seen.group, 'the match is in its tournament and group');
});

const kept = async () => {
  const m = (await call('GET', `/api/matches/${token}`)).json;
  return { season: m.season && m.season.name, group: !!m.group, round: m.round, category: m.category, p1: m.player1.name, p2: m.player2.name, location: m.location };
};

test('saving the "Upraviť zápas" window (the way it sends everything, the category as it was) keeps the match in its tournament and group', async () => {
  const body = { category: 'OTHER', location: 'Kurt 3', scheduledAt: '2099-05-01T09:00:00.000Z', notes: 'poznamka', ballsPlayer: null, courtPlayer: null };
  const r = await call('PATCH', `/api/matches/${token}`, { body });
  assert.strictEqual(r.status, 200, r.text);
  const after = await kept();
  assert.strictEqual(after.season, 'Edit Cup 2099', 'still in the tournament');
  assert.strictEqual(after.group, true, 'still in the group');
  assert.deepStrictEqual([after.round, after.category, after.location], [3, 'OTHER', 'Kurt 3']);
  const sched = (await call('GET', `/api/seasons/${tournament.id}/schedule`, { cookie: '' })).json;
  assert.ok(sched.matches.some((x) => x.token === token), 'and it is in the schedule of the tournament');
});

test('changing the players of the match (admin) keeps it in its tournament and group too', async () => {
  const r = await call('PATCH', `/api/matches/${token}`, { body: { category: 'OTHER', location: 'Kurt 3', scheduledAt: '2099-05-01T09:00:00.000Z', notes: '', player1Id: players[0].id, player2Id: players[2].id } });
  assert.strictEqual(r.status, 200, r.text);
  const after = await kept();
  assert.deepStrictEqual([after.p1, after.p2], ['Edit Alfa', 'Edit Gama'], 'the players changed');
  assert.strictEqual(after.season, 'Edit Cup 2099');
  assert.strictEqual(after.group, true);
});

test('a match of a tournament cannot be moved to another category (that would take it out of the tournament)', async () => {
  for (const category of ['FRIENDLY', 'ELITE']) {
    const r = await call('PATCH', `/api/matches/${token}`, { body: { category } });
    assert.strictEqual(r.status, 400, `${category}: ${r.text}`);
  }
  const after = await kept();
  assert.strictEqual(after.category, 'OTHER');
  assert.strictEqual(after.season, 'Edit Cup 2099');
});

test('a league match still moves between categories as before, and a friendly match has no season', async () => {
  const m = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', player1Id: players[0].id, player2Id: players[1].id, format: 'BO1', location: 'x', scheduledAt: '2099-05-02T08:00:00.000Z' } });
  const t2 = m.json.token;
  const r = await call('PATCH', `/api/matches/${t2}`, { body: { category: 'ELITE' } });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual((await call('GET', `/api/matches/${t2}`)).json.category, 'ELITE');
  const back = await call('PATCH', `/api/matches/${t2}`, { body: { category: 'FRIENDLY' } });
  assert.strictEqual(back.status, 200, back.text);
  assert.strictEqual((await call('GET', `/api/matches/${t2}`)).json.category, 'FRIENDLY');
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
