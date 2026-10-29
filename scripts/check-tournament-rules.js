// Checks of the scoring and tie-break rules a tournament chooses (Basic info > Bodovanie a podmienky): saving and validating them
// (POST /api/seasons, PATCH /api/seasons/:id), and that the group table follows them (GET /api/seasons/:id/standings).
// The calculation itself is checked on its own in check-standings-rules.js.
// Run: node scripts/check-tournament-rules.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { body, cookie = adminCookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
let seq = 0;
const tournament = (extra = {}) => call('POST', '/api/seasons', { body: { name: `Turnaj pravidla ${seq += 1}`, startDate: '2026-12-01', endDate: '2026-12-02', kind: 'TOURNAMENT', ...extra } });
const ALL = ['H2H', 'SETS', 'WINS', 'GAMES'];

test('a new tournament has the BLTA scoring and the conditions in the default order unless it chooses', async () => {
  const made = await tournament();
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.scoring, 'BLTA');
  assert.deepStrictEqual(made.json.tiebreakers, ALL);
  const got = await call('GET', `/api/seasons/${made.json.id}`);
  assert.strictEqual(got.json.scoring, 'BLTA');
  assert.deepStrictEqual(got.json.tiebreakers, ALL);
});

test('a tournament can choose the scoring and the order of the conditions; all four are always kept', async () => {
  const made = await tournament({ scoring: 'WIN2', tiebreakers: ['SETS', 'WINS'] });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.scoring, 'WIN2');
  assert.deepStrictEqual(made.json.tiebreakers, ['SETS', 'WINS', 'H2H', 'GAMES']);
  const one = await tournament({ scoring: 'WIN1', tiebreakers: ['GAMES', 'WINS', 'SETS', 'H2H'] });
  assert.strictEqual(one.json.scoring, 'WIN1');
  assert.deepStrictEqual(one.json.tiebreakers, ['GAMES', 'WINS', 'SETS', 'H2H']);
});

test('an unknown scoring or condition is refused (400), nothing is created', async () => {
  const before = (await call('GET', '/api/seasons')).json.length;
  assert.strictEqual((await tournament({ scoring: 'THREE' })).status, 400);
  assert.strictEqual((await tournament({ tiebreakers: ['SETS', 'LUCK'] })).status, 400);
  assert.strictEqual((await tournament({ tiebreakers: 'SETS' })).status, 400);
  assert.strictEqual((await call('GET', '/api/seasons')).json.length, before);
});

test('a league season has no rules of its own', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: `Liga pravidla ${seq += 1}`, startDate: '2026-12-01', endDate: '2027-02-02', scoring: 'WIN1' } });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.scoring, null);
  assert.strictEqual(made.json.tiebreakers, null);
});

test('the rules can be changed later; a bad change is refused and leaves them as they were', async () => {
  const made = await tournament();
  const changed = await call('PATCH', `/api/seasons/${made.json.id}`, { body: { name: made.json.name, startDate: '2026-12-01', endDate: '2026-12-02', scoring: 'WIN1', tiebreakers: ['WINS', 'GAMES', 'SETS', 'H2H'] } });
  assert.strictEqual(changed.status, 200, changed.text);
  assert.strictEqual(changed.json.scoring, 'WIN1');
  assert.deepStrictEqual(changed.json.tiebreakers, ['WINS', 'GAMES', 'SETS', 'H2H']);
  const bad = await call('PATCH', `/api/seasons/${made.json.id}`, { body: { name: made.json.name, startDate: '2026-12-01', endDate: '2026-12-02', scoring: 'nope' } });
  assert.strictEqual(bad.status, 400);
  const kept = await call('GET', `/api/seasons/${made.json.id}`);
  assert.strictEqual(kept.json.scoring, 'WIN1');
  // a change that does not mention the rules keeps them
  const other = await call('PATCH', `/api/seasons/${made.json.id}`, { body: { name: `${made.json.name} B`, startDate: '2026-12-01', endDate: '2026-12-02' } });
  assert.strictEqual(other.json.scoring, 'WIN1');
  assert.deepStrictEqual(other.json.tiebreakers, ['WINS', 'GAMES', 'SETS', 'H2H']);
});

test('the group table follows the rules: the points per result and the order of the conditions', async () => {
  const season = (await tournament({ scoring: 'WIN2', tiebreakers: ['H2H', 'SETS', 'WINS', 'GAMES'] })).json;
  const group = await call('POST', `/api/seasons/${season.id}/groups`, { body: { name: 'A', category: 'ELITE' } });
  assert.strictEqual(group.status, 201, group.text);
  const ids = {};
  for (const n of [1, 2, 3, 4]) {
    const p = await call('POST', '/api/players', { body: { name: `Pravidla Hrac${n} ${seq}` } });
    assert.ok([200, 201].includes(p.status), p.text);
    ids[n] = p.json.id;
  }
  // 2 beat 1 narrowly; 1 beat 3 and 4 easily; 2 beat 3 (2-1) and lost to 4; 3 beat 4 -> 1 and 2 level on two wins, 1 has the better set difference
  const results = [
    [2, 1, [[7, 6], [7, 6]]], [1, 3, [[6, 0], [6, 0]]], [1, 4, [[6, 0], [6, 0]]],
    [2, 3, [[6, 4], [3, 6], [6, 4]]], [4, 2, [[6, 4], [6, 4]]], [3, 4, [[6, 4], [6, 4]]],
  ];
  for (const [a, b, sets] of results) {
    const made = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Id: ids[a], player2Id: ids[b], groupId: group.json.id, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
    assert.strictEqual(made.status, 201, made.text);
    const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { body: { sets: sets.map(([p1, p2]) => ({ p1, p2 })), location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
    assert.strictEqual(done.status, 200, done.text);
  }
  const namesOf = async () => (await call('GET', `/api/seasons/${season.id}/standings`, { cookie: '' })).json;
  const first = await namesOf();
  assert.deepStrictEqual(first.rules, { scoring: 'WIN2', tiebreakers: ['H2H', 'SETS', 'WINS', 'GAMES'] });
  const rows = first.groups[0].rows;
  assert.deepStrictEqual(rows.map((r) => r.points), [4, 4, 2, 2], 'a win is 2 points, a loss 0');
  assert.deepStrictEqual(rows.slice(0, 2).map((r) => r.player.id), [ids[2], ids[1]], 'head-to-head first: the winner of their match is ahead');
  const patched = await call('PATCH', `/api/seasons/${season.id}`, { body: { name: season.name, startDate: '2026-12-01', endDate: '2026-12-02', tiebreakers: ['SETS', 'H2H', 'WINS', 'GAMES'] } });
  assert.strictEqual(patched.status, 200, patched.text);
  const second = (await namesOf()).groups[0].rows;
  assert.deepStrictEqual(second.slice(0, 2).map((r) => r.player.id), [ids[1], ids[2]], 'set difference first: the better set difference is ahead');
  const blta = await call('PATCH', `/api/seasons/${season.id}`, { body: { name: season.name, startDate: '2026-12-01', endDate: '2026-12-02', scoring: 'BLTA' } });
  assert.strictEqual(blta.status, 200, blta.text);
  assert.ok((await namesOf()).groups[0].rows.some((r) => r.points === 3), 'BLTA: a 2-0 win is 3 points');
});

test('the league page is not touched: a season without rules still has no rules in its standings', async () => {
  const league = await call('POST', '/api/seasons', { body: { name: `Liga bez ${seq += 1}`, startDate: '2026-12-01', endDate: '2027-02-02' } });
  const st = await call('GET', `/api/seasons/${league.json.id}/standings`, { cookie: '' });
  assert.strictEqual(st.status, 200);
  assert.strictEqual(st.json.rules, null);
});

test('the page side: the shared form is on the Backend card, the club manage page and the club create window; the tournament page says how the tables are calculated', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  for (const page of ['seasons-admin.html', 'tournaments-admin.html', 'club-tournament.html']) {
    const html = pub(page);
    assert.ok(html.indexOf('/js/tournament-rules.js') >= 0 && html.indexOf('/js/tournament-rules.js') < html.indexOf('/js/seasons-admin.js'), `${page} loads the rules form before the card`);
  }
  assert.ok(pub('community.html').indexOf('/js/tournament-rules.js') < pub('community.html').indexOf('/js/community.js'));
  const card = pub('js/seasons-admin.js');
  assert.ok(card.includes('Bodovanie a podmienky') && card.includes('TournamentRules.read(') && card.includes('TournamentRules.mount('), 'the card shows, wires and saves the rules');
  const club = pub('js/community.js');
  assert.ok(club.includes("TournamentRules.html('club'") && club.includes('TournamentRules.read('), 'the club create window asks for the rules');
  const form = pub('js/tournament-rules.js');
  for (const text of ['BLTA bodovanie', '2 body za výhru', '1 bod za výhru', 'Vzájomný zápas', 'Rozdiel setov', 'Počet výhier', 'Rozdiel gemov']) assert.ok(form.includes(text), text);
  const i18n = pub('js/i18n.js');
  for (const key of ['season.rulesScoring.BLTA', 'season.rulesScoring.WIN2', 'season.rulesScoring.WIN1', 'season.rulesOrder', 'season.rulesTie.H2H', 'season.rulesTie.GAMES', 'com.tFieldRules']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  }
  assert.ok(pub('js/season.js').includes('standings.rules'), 'the tournament page shows the rules');
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k.startsWith('SMTP_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
      if (i === 99) throw new Error(`the server did not start: ${output}`);
    }
    const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held for a moment on Windows; it is a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
