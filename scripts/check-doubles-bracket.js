// Checks of the doubles draws (src/bracketEngine.js, src/routes/brackets.js, is_doubles): every entrant of a draw is a pair, the matches the draw
// makes are doubles matches with the right partners, a winning pair goes on (also through a bye), a doubles draw stays out of the league and has no
// consolation draw, and what is refused.
// Run: node scripts/check-doubles-bracket.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dblbracket-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const P = {}; // name -> id
async function players(names) {
  for (const name of names) {
    const r = await call('POST', '/api/players', { body: { name } });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.json));
    P[name] = r.json.id;
  }
}
const pair = (a, b, seed) => ({ playerId: P[a], partnerId: P[b], seed });
const create = (extra = {}) => call('POST', '/api/brackets', { body: { name: 'Štvorhra pohár', format: 'BO3', doubles: true, ...extra } });
const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`, { cookie: '' })).json;
const node = (b, round, position) => b.nodes.find((n) => n.round === round && n.position === position);
const matchOf = async (token) => (await call('GET', `/api/matches/${token}`, { cookie: '' })).json;
const finish = (token, sets) => call('POST', `/api/matches/${token}/manual-result`, { body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });

test('a seeded doubles draw: every entrant a pair, the first matches are doubles matches with the right partners', async () => {
  await players(['Ada A', 'Ben B', 'Cyril C', 'Dana D', 'Emil E', 'Fero F', 'Gita G', 'Hugo H']);
  const r = await create({ entries: [pair('Ada A', 'Ben B', 1), pair('Cyril C', 'Dana D', 2), pair('Emil E', 'Fero F', 3), pair('Gita G', 'Hugo H', 4)] });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const b = r.json;
  assert.strictEqual(b.isDoubles, true);
  assert.strictEqual(b.size, 4);
  const n0 = node(b, 1, 0);
  const n1 = node(b, 1, 1);
  assert.strictEqual(n0.player1.name, 'Ada A / Ben B', 'seed 1 meets seed 4');
  assert.strictEqual(n0.player2.name, 'Gita G / Hugo H');
  assert.strictEqual(n1.player1.name, 'Cyril C / Dana D');
  assert.strictEqual(n0.player1.slug, null, 'a pair has no profile');
  assert.deepStrictEqual(n0.player1.team.map((p) => p.name), ['Ada A', 'Ben B']);
  assert.ok(n0.match && n1.match, 'a match for each pairing');
  const m = await matchOf(n0.match.token);
  assert.strictEqual(m.isDoubles, true);
  assert.deepStrictEqual(m.team1.map((p) => p.name), ['Ada A', 'Ben B']);
  assert.deepStrictEqual(m.team2.map((p) => p.name), ['Gita G', 'Hugo H']);
  assert.strictEqual(m.category, 'OTHER');
  r.tokens = [n0.match.token, n1.match.token];
  global.drawA = { id: b.id, tokens: r.tokens };
});

test('the winning pair goes on with its partner, and the final is a doubles match too', async () => {
  const { id, tokens } = global.drawA;
  assert.strictEqual((await finish(tokens[0], [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }])).status, 200);
  assert.strictEqual((await finish(tokens[1], [{ p1: 3, p2: 6 }, { p1: 4, p2: 6 }])).status, 200, 'the second pair of the other half wins');
  const b = await bracketOf(id);
  const final = node(b, 2, 0);
  assert.strictEqual(final.player1.name, 'Ada A / Ben B');
  assert.strictEqual(final.player2.name, 'Emil E / Fero F');
  assert.ok(final.match, 'the final has its match');
  const m = await matchOf(final.match.token);
  assert.deepStrictEqual([m.team1.map((p) => p.name), m.team2.map((p) => p.name)], [['Ada A', 'Ben B'], ['Emil E', 'Fero F']]);
  assert.strictEqual((await finish(final.match.token, [{ p1: 7, p2: 5 }, { p1: 6, p2: 4 }])).status, 200);
  const done = await bracketOf(id);
  assert.strictEqual(node(done, 2, 0).winnerId, P['Ada A'], 'the winner of the final is the winning pair (by its first player)');
  const rank = await call('GET', '/api/doubles/ranking', { cookie: '' });
  const row = (n) => rank.json.rows.find((x) => x.name === n);
  assert.deepStrictEqual([row('Ada A').wins, row('Ben B').wins, row('Ada A').played], [2, 2, 2], 'the draw counts in the doubles ranking, for both of the pair');
  assert.strictEqual(row('Dana D').played, 1);
  const iq = await call('GET', `/api/courtiq/player/${P['Ada A']}`, { cookie: '' });
  assert.strictEqual(iq.json.gamesPlayed, 0, 'never the singles CourtIQ');
});

test('an odd number of pairs: the bye keeps the partner, who plays in the next round', async () => {
  await players(['Iva I', 'Jan J', 'Kuba K', 'Lea L', 'Maro M', 'Nina N']);
  const r = await create({ name: 'Tri páry', entries: [pair('Iva I', 'Jan J', 1), pair('Kuba K', 'Lea L', 2), pair('Maro M', 'Nina N', 3)] });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const b = r.json;
  const bye = b.nodes.find((n) => n.round === 1 && n.isBye);
  assert.ok(bye, 'one bye');
  const real = b.nodes.find((n) => n.round === 1 && !n.isBye);
  assert.ok(real.match, 'the real pairing has a match');
  assert.ok(!node(b, 2, 0).match, 'the final waits for the other pair');
  assert.strictEqual((await finish(real.match.token, [{ p1: 6, p2: 1 }, { p1: 6, p2: 1 }])).status, 200);
  const after = await bracketOf(b.id);
  const final = node(after, 2, 0);
  assert.ok(final.match, 'the final is made');
  const m = await matchOf(final.match.token);
  assert.strictEqual(m.isDoubles, true);
  const names = [...m.team1, ...m.team2].map((p) => p.name).sort();
  assert.strictEqual(names.length, 4);
  assert.ok(new Set(names).size === 4, 'four different players, with the partners of the pair that had the bye');
  assert.ok(names.includes('Iva I') && names.includes('Jan J'), 'the top seed (the bye) is in it with its partner');
});

test('what is refused: a league category, a missing partner, a player twice, one pair only, a consolation draw', async () => {
  await players(['Olga O', 'Pavol P', 'Rado R', 'Sona S']);
  const entries = [pair('Olga O', 'Pavol P', 1), pair('Rado R', 'Sona S', 2)];
  assert.strictEqual((await create({ category: 'ELITE', entries })).status, 400, 'no league category');
  assert.strictEqual((await create({ entries: [{ playerId: P['Olga O'], seed: 1 }, pair('Rado R', 'Sona S', 2)] })).status, 400, 'a pair needs a partner');
  assert.strictEqual((await create({ entries: [pair('Olga O', 'Pavol P', 1), pair('Pavol P', 'Sona S', 2)] })).status, 400, 'a partner listed as a player');
  assert.strictEqual((await create({ entries: [pair('Olga O', 'Olga O', 1), pair('Rado R', 'Sona S', 2)] })).status, 400, 'a player as his own partner');
  assert.strictEqual((await create({ entries: [pair('Olga O', 'Pavol P', 1)] })).status, 400, 'one pair is no draw');
  const ok = await create({ name: 'Dva páry', entries });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  const c = await call('POST', `/api/brackets/${ok.json.id}/consolation`, { body: {} });
  assert.strictEqual(c.status, 400, 'no consolation draw for doubles');
  const patch = await call('PATCH', `/api/brackets/${ok.json.id}`, { body: { category: 'NOVICE' } });
  assert.strictEqual(patch.status, 400, 'and it cannot be moved into a league category later');
  const list = await call('GET', '/api/brackets');
  assert.ok(list.json.find((x) => x.id === ok.json.id).isDoubles);
  assert.strictEqual((await call('DELETE', `/api/brackets/${ok.json.id}`)).status, 200);
});

test('a manual doubles draw: the pair of each slot is given when it is seated', async () => {
  await players(['Tomas T', 'Uma U', 'Vlado V', 'Wanda W', 'Xena X']);
  const r = await create({ name: 'Ručný pavúk', size: 2 });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const slot = node(r.json, 1, 0);
  const noPartner = await call('PATCH', `/api/brackets/${r.json.id}/slots/${slot.id}`, { body: { player1Id: P['Tomas T'], player2Id: P['Vlado V'] } });
  assert.strictEqual(noPartner.status, 400, 'partners are needed');
  const dup = await call('PATCH', `/api/brackets/${r.json.id}/slots/${slot.id}`, { body: { player1Id: P['Tomas T'], player1PartnerId: P['Uma U'], player2Id: P['Vlado V'], player2PartnerId: P['Uma U'] } });
  assert.strictEqual(dup.status, 400, 'the four must be different');
  const ok = await call('PATCH', `/api/brackets/${r.json.id}/slots/${slot.id}`, { body: { player1Id: P['Tomas T'], player1PartnerId: P['Uma U'], player2Id: P['Vlado V'], player2PartnerId: P['Wanda W'] } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const seated = node(ok.json, 1, 0);
  assert.strictEqual(seated.player1.name, 'Tomas T / Uma U');
  assert.strictEqual(seated.player2.name, 'Vlado V / Wanda W');
  assert.ok(seated.match, 'the match is made when both pairs are seated');
  const m = await matchOf(seated.match.token);
  assert.deepStrictEqual([m.team1.map((p) => p.name), m.team2.map((p) => p.name)], [['Tomas T', 'Uma U'], ['Vlado V', 'Wanda W']]);
});

test('a past doubles draw (no matches): the winner is entered by hand and the pairs stay', async () => {
  await players(['Yan Y', 'Zoe Z', 'Alex A2', 'Bela B2']);
  const r = await create({ name: 'Minulý turnaj', autoCreateMatches: false, entries: [pair('Yan Y', 'Zoe Z', 1), pair('Alex A2', 'Bela B2', 2)] });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const n = node(r.json, 1, 0);
  assert.ok(!n.match);
  const res = await call('PATCH', `/api/brackets/${r.json.id}/nodes/${n.id}/result`, { body: { winnerId: P['Alex A2'], score: '6-4, 6-4' } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const done = node(res.json, 1, 0);
  assert.strictEqual(done.winnerId, P['Alex A2']);
  assert.strictEqual(done.player2.name, 'Alex A2 / Bela B2');
});

test('the admin page carries the pieces', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/bracket-admin.js'), 'utf8');
  ['body.doubles = true', 'partnerId', 'player1PartnerId', 'bracket-doubles'].forEach((s) => assert.ok(js.includes(s), 'bracket-admin.js: ' + s));
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
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
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
