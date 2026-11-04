// Checks of the final standings of a tournament (GET /api/seasons/:id/final-standings, the tab "Konečné poradie"): an elimination bracket gives 1st, 2nd and then the round each player
// lost in (the semi-finalists share 3rd-4th, the quarter-finalists 5th-8th), a draw in progress is provisional, the matches for the places give exact places, groups without a bracket
// are listed one by one, and the players out in the groups follow the bracket players. Also the tab on the page.
// Run: node scripts/check-final-standings.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalst-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
let counter = 0;
async function newTournament(name) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-07-01', endDate: '2099-07-03' });
  assert.strictEqual(made.status, 201, made.text);
  return made.json;
}
async function register(season, category, count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = (await call('POST', '/api/players', { name: `Fs ${String(counter).padStart(3, '0')}` })).json;
    const reg = await call('POST', `/api/seasons/${season.id}/registrations/admin`, { playerId: p.id, category, phone: `0907${String(100000 + counter)}`, email: `fs${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    list.push({ player: p, reg: reg.json });
  }
  return list;
}
const draw = (season, body) => call('POST', `/api/seasons/${season.id}/draw`, body);
const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`)).json;
const standingsOf = async (season) => (await call('GET', `/api/seasons/${season.id}/final-standings`, undefined, { admin: false })).json;
// plays a match: the higher player id wins
async function playMatch(token) {
  const m = (await call('GET', `/api/matches/${token}`)).json;
  const win = { p1: 6, p2: 2 };
  const set = m.player1.id > m.player2.id ? win : { p1: win.p2, p2: win.p1 };
  const r = await call('POST', `/api/matches/${token}/manual-result`, { sets: [set, set], location: 'Kurt 1', scheduledAt: '2099-07-01T10:00:00.000Z' });
  assert.strictEqual(r.status, 200, r.text);
}
async function playAll(season) {
  for (let guard = 0; guard < 40; guard += 1) {
    const ms = (await call('GET', `/api/matches?seasonId=${season.id}&status=PLANNED`)).json;
    const open = ms.filter((m) => m.status === 'PLANNED');
    if (!open.length) return;
    for (const m of open) await playMatch(m.token);
  }
}
const idOf = (list) => list.map((x) => x.player.id);
const section = (data, key) => data.sections.find((s) => s.key === key);

test('an elimination bracket of 8: in progress it is provisional (everybody still plays), when played 1st, 2nd, two semi-finalists 3rd-4th, four quarter-finalists 5th-8th', async () => {
  const t = await newTournament('Final Elimination');
  const players = await register(t, 'ELITE', 8);
  assert.deepStrictEqual((await standingsOf(t)).sections, [], 'nothing drawn yet: nothing to show');
  const made = await draw(t, { category: 'ELITE', format: 'ELIMINATION', mode: 'AUTO', mainFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  let data = await standingsOf(t);
  assert.strictEqual(data.complete, false);
  let s = section(data, 'category-ELITE');
  assert.strictEqual(s.title, 'Elite');
  assert.ok(s.rows.length === 8 && s.rows.every((r) => r.stage === 'PLAYING' && r.from === 1 && r.to === 8), 'all still playing');
  await playAll(t);
  data = await standingsOf(t);
  assert.strictEqual(data.complete, true);
  s = section(data, 'category-ELITE');
  const ids = players.map((p) => p.player.id).sort((a, b) => b - a); // the higher id always wins
  const stages = s.rows.map((r) => [r.stage, r.from, r.to]);
  assert.deepStrictEqual(stages, [['WINNER', 1, 1], ['FINALIST', 2, 2], ['SEMI', 3, 4], ['SEMI', 3, 4], ['QUARTER', 5, 8], ['QUARTER', 5, 8], ['QUARTER', 5, 8], ['QUARTER', 5, 8]]);
  assert.strictEqual(s.rows[0].player.id, ids[0], 'the strongest player won');
  assert.strictEqual(new Set(idOf(s.rows)).size, 8, 'everybody once');
  assert.ok(s.rows[1].player.id < ids[0], 'the finalist is below the winner');
  // (who meets whom depends on the draw, so only the shape is checked)
  assert.ok(s.rows.every((r) => r.player.name && r.player.slug), 'each row has the name and the profile');
});

test('an elimination bracket of 6 (byes): the players who skipped round 1 are ranked by how far they got', async () => {
  const t = await newTournament('Final Byes');
  await register(t, 'ELITE', 6);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'ELIMINATION', mode: 'AUTO', mainFormat: 'BO3' })).status, 201);
  await playAll(t);
  const s = section(await standingsOf(t), 'category-ELITE');
  assert.strictEqual(s.rows.length, 6);
  assert.deepStrictEqual(s.rows.map((r) => r.stage), ['WINNER', 'FINALIST', 'SEMI', 'SEMI', 'QUARTER', 'QUARTER']);
  assert.deepStrictEqual(s.rows.map((r) => [r.from, r.to]), [[1, 1], [2, 2], [3, 4], [3, 4], [5, 6], [5, 6]]);
});

test('the matches for the places: 6 players, 2 groups → 1st-2nd from the final, 3rd-4th from the match for the 3rd place, 5th-6th from the match for the 5th place', async () => {
  const t = await newTournament('Final Placement');
  await register(t, 'ELITE', 6);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 3, bracketType: 'PLACEMENT', groupFormat: 'BO3', mode: 'AUTO' })).status, 201);
  await playAll(t); // the groups, and then the three matches made by themselves
  const s = section(await standingsOf(t), 'category-ELITE');
  assert.deepStrictEqual(s.rows.map((r) => [r.from, r.to, r.stage]), [[1, 1, 'PLACE'], [2, 2, 'PLACE'], [3, 3, 'PLACE'], [4, 4, 'PLACE'], [5, 5, 'PLACE'], [6, 6, 'PLACE']]);
  assert.strictEqual(new Set(idOf(s.rows)).size, 6, 'everybody once');
  assert.strictEqual((await standingsOf(t)).complete, true);
});

test('groups then an elimination bracket: the players out in the groups follow the bracket players, by their place in the group', async () => {
  const t = await newTournament('Final Groups Bracket');
  await register(t, 'ELITE', 12);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 4, qualifiers: 2, bracketType: 'ELIMINATION', groupFormat: 'BO3', mainFormat: 'BO3', mode: 'AUTO' })).status, 201);
  await playAll(t);
  const s = section(await standingsOf(t), 'category-ELITE');
  assert.strictEqual(s.rows.length, 12);
  const out = s.rows.filter((r) => r.stage === 'GROUP');
  assert.strictEqual(out.length, 6, '6 of the 12 went on to the bracket of 8');
  assert.deepStrictEqual(out.map((r) => [r.place, r.from, r.to]), [[3, 7, 9], [3, 7, 9], [3, 7, 9], [4, 10, 12], [4, 10, 12], [4, 10, 12]]);
  assert.ok(out.every((r) => r.group), 'with the name of the group');
  assert.deepStrictEqual(s.rows.slice(0, 2).map((r) => r.stage), ['WINNER', 'FINALIST']);
});

test('groups without a bracket: one table per group', async () => {
  const t = await newTournament('Final Groups Only');
  await register(t, 'ELITE', 6);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS', groupSize: 3, groupFormat: 'BO3', mode: 'AUTO' })).status, 201);
  await playAll(t);
  const data = await standingsOf(t);
  assert.strictEqual(data.sections.length, 2);
  data.sections.forEach((s) => {
    assert.strictEqual(s.complete, true);
    assert.deepStrictEqual(s.rows.map((r) => [r.stage, r.from]), [['TABLE', 1], ['TABLE', 2], ['TABLE', 3]]);
  });
});

test('a season of the league: a table per group (its places)', async () => {
  const season = (await call('POST', '/api/seasons', { name: 'Final League', startDate: '2099-01-01', endDate: '2099-12-31' })).json;
  const group = (await call('POST', `/api/seasons/${season.id}/groups`, { name: 'Skupina Test', category: 'ELITE' })).json;
  const gid = (group.groups || [group]).find((g) => g.name === 'Skupina Test').id;
  const a = (await call('POST', '/api/players', { name: 'Fs League A' })).json;
  const b = (await call('POST', '/api/players', { name: 'Fs League B' })).json;
  for (const p of [a, b]) assert.ok([200, 201].includes((await call('POST', `/api/seasons/groups/${gid}/members`, { name: p.name })).status));
  const made = await call('POST', '/api/matches', { category: 'ELITE', format: 'BO3', player1Id: a.id, player2Id: b.id, groupId: gid, seasonId: season.id, location: 'Kurt 1', scheduledAt: '2099-02-01T10:00:00.000Z' });
  assert.strictEqual(made.status, 201, made.text);
  await playMatch(made.json.token);
  const data = await standingsOf(season);
  assert.strictEqual(data.sections.length, 1);
  assert.strictEqual(data.sections[0].title, 'Skupina Test');
  assert.deepStrictEqual(data.sections[0].rows.map((r) => [r.stage, r.from, r.player.id]), [['TABLE', 1, Math.max(a.id, b.id)], ['TABLE', 2, Math.min(a.id, b.id)]], 'the winner first');
  assert.strictEqual(data.sections[0].rows.length, 2);
  assert.strictEqual((await call('GET', '/api/seasons/999999/final-standings', undefined, { admin: false })).status, 404);
});

test('the page has the tab Konečné poradie after the play-off and before the matches, in both languages, and draws the places', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const js = read('js/season.js');
  new (require('vm').Script)(js, { filename: 'season.js' });
  const order = ["key: 'playoff'", "key: 'final'", "key: 'matches'"].map((s) => js.indexOf(s));
  assert.ok(order.every((n) => n >= 0) && order[0] < order[1] && order[1] < order[2], 'tab order: ' + order);
  assert.ok(js.includes("'playoff', 'final', 'matches'") && js.includes('/final-standings') && js.includes('function finalHtml()'));
  const i18n = read('js/i18n.js');
  for (const key of ['navFinal', 'empty.final', 'final.provisional', 'final.hint', 'final.colName', 'final.colResult', 'final.place', 'final.semi', 'final.quarter', 'final.last16', 'final.round', 'final.group', 'final.playing']) {
    assert.strictEqual((i18n.match(new RegExp(`'season\\.${key.replace('.', '\\.')}':`, 'g')) || []).length, 2, `season.${key} in both languages`);
  }
});

// ---------------------------------------------------------------- run
async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
