// Checks of the consolation draw ("útecha") of the PRINCE format picked by the organiser: consolationMode MANUAL makes no consolation with the main draw,
// the round-1 losers are listed as the matches are decided, the organiser ticks who plays, and the draw is made automatically (the neighbours of the main
// draw meet, a player whose neighbour does not play meets the nearest one) or empty to seat by hand. The default (AUTO) is unchanged.
// Run: node scripts/check-manual-consolation.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const engine = require('../src/bracketEngine');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-cons-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let db = null;
let counter = 0;

async function call(method, url, body, { admin = true } = {}) {
  const headers = {};
  if (admin && cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// a tournament with `count` registered players in a category
async function tournamentWith(name, category, count) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03', categories: [category] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = await call('POST', '/api/players', { name: `Hráč ${String(counter).padStart(2, '0')}` });
    assert.strictEqual(p.status, 201, JSON.stringify(p.json));
    const reg = await call('POST', `/api/seasons/${made.json.id}/registrations/admin`, { playerId: p.json.id, category, phone: `0903${String(100000 + counter)}`, email: `p${counter}@example.com` });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));
  }
  return made.json;
}
const overviewOf = async (t, category) => (await call('GET', `/api/seasons/${t.id}/draw`)).json.categories.find((c) => c.category === category);
const bracketsOf = (t) => db.prepare('SELECT * FROM brackets WHERE season_id = ? ORDER BY id').all(t.id);
// round-1 nodes of the main bracket with their match; the first player of every match wins (the match is written as played)
function decideRound1(mainId, losersToSkip = []) {
  const nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = 1 ORDER BY position').all(mainId);
  const losers = [];
  nodes.forEach((n) => {
    if (!n.player1_id || !n.player2_id || !n.match_id) return;
    if (losersToSkip.includes(n.position)) return;
    db.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ? WHERE id = ?").run(n.player1_id, n.match_id);
    losers.push({ position: n.position, playerId: n.player2_id });
  });
  return losers;
}

let t1; let main1; let losers1;

test('setup: PRINCE with the consolation picked by the organiser makes the main draw only; nobody is listed before a match is decided', async () => {
  t1 = await tournamentWith('Prince Picks 2099', 'NEXT_GEN', 8);
  const draw = await call('POST', `/api/seasons/${t1.id}/draw`, { category: 'NEXT_GEN', format: 'PRINCE', mode: 'AUTO', consolationMode: 'MANUAL' });
  assert.strictEqual(draw.status, 201, JSON.stringify(draw.json));
  const all = bracketsOf(t1);
  assert.strictEqual(all.length, 1, 'only the main bracket');
  assert.notStrictEqual(all[0].kind, 'CONSOLATION');
  main1 = all[0];
  const c = await overviewOf(t1, 'NEXT_GEN');
  assert.strictEqual(c.consolationMode, 'MANUAL');
  assert.strictEqual(c.canMakeConsolation, false, 'the old automatic button is not offered');
  assert.ok(c.consolationPicks, 'the list of the round-1 losers is there');
  assert.deepStrictEqual(c.consolationPicks.losers, []);
  assert.strictEqual(c.consolationPicks.open, 4, 'four round-1 matches to play');
});

test('the round-1 losers appear in the list as the matches are decided, in the order of the matches; all of them play until the organiser unticks', async () => {
  losers1 = decideRound1(main1.id, [3]); // the 4th match is still open
  const list = (await call('GET', `/api/brackets/${main1.id}/consolation-picks`)).json;
  assert.strictEqual(list.losers.length, 3);
  assert.strictEqual(list.open, 1);
  assert.deepStrictEqual(list.losers.map((l) => l.position), [0, 1, 2]);
  assert.ok(list.losers.every((l) => l.plays === true && l.name));
  assert.strictEqual(list.playing, 3);
  const c = await overviewOf(t1, 'NEXT_GEN');
  assert.strictEqual(c.consolationPicks.losers.length, 3);
  decideRound1(main1.id); // the last one is decided later: it joins the list
  const later = (await call('GET', `/api/brackets/${main1.id}/consolation-picks`)).json;
  assert.strictEqual(later.losers.length, 4);
  assert.strictEqual(later.open, 0);
  losers1 = later.losers;
});

test('only the organiser can see or change the list; a player who did not lose in round 1 is refused', async () => {
  assert.strictEqual((await call('GET', `/api/brackets/${main1.id}/consolation-picks`, undefined, { admin: false })).status, 401);
  assert.strictEqual((await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { playerId: losers1[0].playerId, plays: false }, { admin: false })).status, 401);
  const winner = db.prepare('SELECT player1_id FROM bracket_matches WHERE bracket_id = ? AND round = 1 ORDER BY position').get(main1.id).player1_id;
  assert.strictEqual((await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { playerId: winner, plays: false })).status, 400);
});

test('the organiser unticks one player; the list says 3 of 4 play; a draw needs at least two', async () => {
  const put = await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { playerId: losers1[1].playerId, plays: false });
  assert.strictEqual(put.status, 200, JSON.stringify(put.json));
  assert.strictEqual(put.json.playing, 3);
  assert.strictEqual(put.json.losers.find((l) => l.playerId === losers1[1].playerId).plays, false);
  // untick everyone but one: refused
  await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { picks: [{ playerId: losers1[0].playerId, plays: false }, { playerId: losers1[2].playerId, plays: false }] });
  const few = await call('POST', `/api/brackets/${main1.id}/consolation`, { format: 'BO3_G4_STB', fromPicks: true, mode: 'AUTO' });
  assert.strictEqual(few.status, 400);
  await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { picks: [{ playerId: losers1[0].playerId, plays: true }, { playerId: losers1[2].playerId, plays: true }] });
});

test('automatic consolation from the ticked players: the neighbours meet, a player without a neighbour gets the bye', async () => {
  // losers at positions 0, 2, 3 play (position 1 unticked): 0 has no neighbour (1 is out) -> bye, 2 and 3 are neighbours -> they meet
  const made = await call('POST', `/api/brackets/${main1.id}/consolation`, { format: 'BO3_G4_STB', fromPicks: true, mode: 'AUTO' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.kind, 'CONSOLATION');
  assert.strictEqual(made.json.size, 4);
  const round1 = made.json.nodes.filter((n) => n.round === 1).sort((a, b) => a.position - b.position);
  const idsOf = (n) => [n.player1, n.player2].filter(Boolean).map((p) => p.id).sort((x, y) => x - y);
  const byPosition = (pos) => losers1.find((l) => l.position === pos).playerId;
  assert.deepStrictEqual(idsOf(round1[0]), [byPosition(0)], 'the bye');
  assert.deepStrictEqual(idsOf(round1[1]), [byPosition(2), byPosition(3)].sort((x, y) => x - y), 'the neighbours meet');
  assert.strictEqual(bracketsOf(t1).length, 2);
  // the list is closed once the consolation draw exists
  assert.strictEqual((await call('PUT', `/api/brackets/${main1.id}/consolation-picks`, { playerId: losers1[2].playerId, plays: false })).status, 409);
  assert.strictEqual((await call('POST', `/api/brackets/${main1.id}/consolation`, { format: 'BO3_G4_STB', fromPicks: true, mode: 'AUTO' })).status, 400, 'a second one is refused');
  const c = await overviewOf(t1, 'NEXT_GEN');
  assert.strictEqual(c.consolationPicks, null);
});

test('manual consolation: an empty bracket of the right size for the ticked players, to be seated by hand', async () => {
  const t2 = await tournamentWith('Prince By Hand 2099', 'NOVICE', 8);
  assert.strictEqual((await call('POST', `/api/seasons/${t2.id}/draw`, { category: 'NOVICE', format: 'PRINCE', mode: 'AUTO', consolationMode: 'MANUAL' })).status, 201);
  const main2 = bracketsOf(t2)[0];
  decideRound1(main2.id);
  const made = await call('POST', `/api/brackets/${main2.id}/consolation`, { format: 'BO3_G4_STB', fromPicks: true, mode: 'MANUAL' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.kind, 'CONSOLATION');
  assert.strictEqual(made.json.size, 4);
  assert.ok(made.json.nodes.filter((n) => n.round === 1).every((n) => !n.player1 && !n.player2), 'nobody is seated');
  // the organiser seats two of them in the first slot with the ordinary slot editor
  const slot = made.json.nodes.find((n) => n.round === 1 && n.position === 0);
  const rows = db.prepare('SELECT player1_id, player2_id FROM bracket_matches WHERE bracket_id = ? AND round = 1 ORDER BY position').all(main2.id);
  const a = rows[0].player2_id; const b = rows[1].player2_id;
  const seat = await call('PATCH', `/api/brackets/${made.json.id}/slots/${slot.id}`, { player1Id: a, player2Id: b });
  assert.strictEqual(seat.status, 200, JSON.stringify(seat.json));
});

test('the default is unchanged: a PRINCE draw in AUTO mode makes the consolation with the main draw and no list is offered', async () => {
  const t3 = await tournamentWith('Prince Auto 2099', 'ELITE', 8);
  assert.strictEqual((await call('POST', `/api/seasons/${t3.id}/draw`, { category: 'ELITE', format: 'PRINCE', mode: 'AUTO' })).status, 201);
  const kinds = bracketsOf(t3).map((b) => b.kind || 'MAIN');
  assert.deepStrictEqual(kinds, ['MAIN', 'CONSOLATION']);
  const c = await overviewOf(t3, 'ELITE');
  assert.strictEqual(c.consolationMode, 'AUTO');
  assert.strictEqual(c.consolationPicks, null);
});

test('pairConsolation: the neighbours of the main draw meet; a player without a neighbour meets the nearest one; the byes go to those without a neighbour', () => {
  const at = (positions) => positions.map((position, i) => ({ playerId: 100 + i, position }));
  const shape = (positions) => engine.pairConsolation(at(positions)).slots.map((s) => s.map((p) => p.position));
  assert.deepStrictEqual(shape([0, 1, 2, 3, 4, 5, 6, 7]), [[0, 1], [2, 3], [4, 5], [6, 7]]);
  assert.deepStrictEqual(shape([0, 1, 2, 4, 5, 6, 7]), [[0, 1], [2], [4, 5], [6, 7]], '7 players, 1 bye to the one without a neighbour');
  assert.deepStrictEqual(shape([0, 1, 2, 5, 6, 7]), [[0, 1], [2], [5], [6, 7]], '6 players, 2 byes to the two without a neighbour');
  assert.deepStrictEqual(shape([0, 2, 4, 6]), [[0, 2], [4, 6]], 'nobody has a neighbour: each meets the nearest one');
  assert.deepStrictEqual(shape([1, 6]), [[1, 6]]);
  assert.deepStrictEqual(shape([0, 2, 3, 5, 7]), [[0], [2, 3], [5], [7]], '5 players in a bracket of 8: 3 byes, one match');
});

test('the draw panel has the setting, the list and the two buttons', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'season-draw.js'), 'utf8');
  ['sd-cons-mode', 'consolationMode', 'sd-pick', 'cons-auto', 'cons-manual', '/consolation-picks', 'fromPicks'].forEach((k) => assert.ok(js.includes(k), k));
});

async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    db = new DatabaseSync(path.join(dir, 'blta-score.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack ? err.message : err).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (db) db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
