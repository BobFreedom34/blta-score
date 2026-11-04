// Checks who may run the result of a match of a community or club: both players of it (live and by hand, whoever set the match up), the admin of the club
// (live and by hand, even when he does not play), the admin of the site; nobody else. Also the small route the match page asks to show the admin his controls.
// Run: node scripts/check-club-match-results.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubres-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = '', body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09130${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const setup = {};
const sets = [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }];
// a planned match of the club's tournament between two players, set up by the club admin (the only one who can), with a place and a date so it can start
async function newMatch(p1, p2) {
  const r = await call('POST', '/api/matches', { cookie: setup.owner.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: p1.id, player2Id: p2.id, seasonId: setup.t.id, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json.token;
}
const manual = (token, who) => call('POST', `/api/matches/${token}/manual-result`, { cookie: who.cookie, body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
const start = (token, who) => call('POST', `/api/matches/${token}/start`, { cookie: who.cookie, body: { firstServer: 1 } });

test('setup: a club with an admin, a tournament of it, two players and a stranger', async () => {
  setup.owner = await makePlayer('Cr Majitel');
  setup.a = await makePlayer('Cr Alfa');
  setup.b = await makePlayer('Cr Beta');
  setup.stranger = await makePlayer('Cr Cudzi');
  const org = await call('POST', '/api/communities', { cookie: setup.owner.cookie, body: { type: 'CLUB', name: 'Cr Klub', joinPolicy: 'OPEN' } });
  assert.ok(org.json && org.json.id, JSON.stringify(org.json));
  assert.strictEqual((await call('PATCH', `/api/communities/${org.json.id}/approval`, { cookie: adminCookie, body: { approved: true } })).status, 200);
  const t = await call('POST', `/api/communities/${org.json.id}/tournaments`, { cookie: setup.owner.cookie, body: { name: 'Cr Turnaj', venue: 'Kurty', startDate: day(1), endDate: day(2), playType: 'SINGLES' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  setup.t = t.json;
});

test('a player of the match enters its result by hand, though the club admin set the match up; a stranger cannot', async () => {
  const token = await newMatch(setup.a, setup.b);
  const denied = await manual(token, setup.stranger);
  assert.strictEqual(denied.status, 403, JSON.stringify(denied.json));
  const done = await manual(token, setup.b);
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.strictEqual(done.json.status, 'FINISHED');
});

test('the club admin, who does not play, enters a result by hand too', async () => {
  const token = await newMatch(setup.a, setup.b);
  assert.strictEqual((await manual(token, setup.owner)).status, 200);
});

test('the live score: both players and the club admin may start it, a stranger may not', async () => {
  const token = await newMatch(setup.a, setup.b);
  assert.strictEqual((await start(token, setup.stranger)).status, 403);
  assert.strictEqual((await start(token, setup.owner)).status, 200, 'the club admin');
  const other = await newMatch(setup.a, setup.b);
  assert.strictEqual((await start(other, setup.a)).status, 200, 'a player of the match');
  const third = await newMatch(setup.a, setup.b);
  assert.strictEqual((await start(third, setup.b)).status, 200, 'the other player');
});

test('the match page asks whether the visitor is the admin of the club: the club admin and the site admin yes, a player, a stranger and a visitor no', async () => {
  const token = await newMatch(setup.a, setup.b);
  const ask = async (cookie) => (await call('GET', `/api/matches/${token}/can-manage`, { cookie })).json.canManage;
  assert.strictEqual(await ask(setup.owner.cookie), true);
  assert.strictEqual(await ask(adminCookie), true);
  assert.strictEqual(await ask(setup.a.cookie), false);
  assert.strictEqual(await ask(setup.stranger.cookie), false);
  assert.strictEqual(await ask(''), false);
  assert.strictEqual((await call('GET', '/api/matches/no-such-match/can-manage')).status, 404);
});

test('the match page uses it: the controls and the result entry stay open to the admin of the club and to its players', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const match = read('js/match.js');
  const common = read('js/common.js');
  new (require('vm').Script)(match, { filename: 'match.js' });
  new (require('vm').Script)(common, { filename: 'common.js' });
  assert.ok(match.includes('/can-manage') && match.includes('m.viewerManagesClub = clubManager;'), 'the page asks and passes it to the checks');
  assert.ok(/function canManageMatch\(m, isAdminUser\) \{\s*if \(isAdminUser\) return true;\s*if \(m\.viewerManagesClub\) return true;/.test(common), 'canManageMatch knows the club admin');
  assert.ok(/function canManageLiveScore\(m, isAdminUser\) \{\s*if \(isAdminUser\) return true;\s*if \(m\.viewerManagesClub\) return true;/.test(common), 'canManageLiveScore knows the club admin');
  assert.ok(match.includes('const clubPlayer = '), 'a player of a club match may enter the result by hand');
});

// ---------------------------------------------------------------- run
async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await call('POST', '/api/admin/login', { body: { password: 'test' } });
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
