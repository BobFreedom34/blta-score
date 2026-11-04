// Checks of the bell notification of the admins of a community or club when somebody registers for one of its tournaments: every ACTIVE admin gets one (not the
// player who registered, not a plain member, not a visitor), a substitute registration says so, it counts as unread, opens the manage page and can be marked read;
// a tournament of the league itself notifies nobody. Also the wording of its push (src/pushTexts.js) and the bell texts.
// Run: node scripts/check-registration-bell.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regbell-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;
let ipCounter = 0;

async function call(method, url, { cookie = '', body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09120${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
// a public registration (a different address each time: the form allows only a few from one)
function register(season, name, extra = {}) {
  ipCounter += 1;
  return call('POST', `/api/seasons/${season.id}/registrations`, {
    headers: { 'x-forwarded-for': `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
    body: { name, phone: `0906${String(200000 + ipCounter)}`, email: `r${ipCounter}@example.com`, ...extra },
  });
}
const bell = async (who) => (await call('GET', '/api/player/notifications', { cookie: who.cookie })).json.filter((n) => n.type === 'REGISTRATION');
const unread = async (who) => (await call('GET', '/api/player/session', { cookie: who.cookie })).json.unreadNotificationCount;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const setup = {};

test('setup: a club with two admins and a plain member; a tournament of it with room for one player', async () => {
  setup.owner = await makePlayer('Rb Majitel');
  setup.admin2 = await makePlayer('Rb Druhy Admin');
  setup.member = await makePlayer('Rb Clen');
  const org = await call('POST', '/api/communities', { cookie: setup.owner.cookie, body: { type: 'CLUB', name: 'Rb Klub', joinPolicy: 'OPEN' } });
  assert.ok(org.json && org.json.id, JSON.stringify(org.json));
  setup.org = org.json;
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.org.id}/approval`, { cookie: adminCookie, body: { approved: true } })).status, 200);
  for (const who of [setup.admin2, setup.member]) assert.ok([200, 201].includes((await call('POST', `/api/communities/${setup.org.id}/join`, { cookie: who.cookie })).status));
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.org.id}/members/${setup.admin2.id}`, { cookie: setup.owner.cookie, body: { role: 'ADMIN' } })).status, 200);
  const t = await call('POST', `/api/communities/${setup.org.id}/tournaments`, { cookie: setup.owner.cookie, body: { name: 'Rb Turnaj', venue: 'Kurty', startDate: day(10), endDate: day(11), playType: 'SINGLES' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  setup.t = t.json;
  assert.strictEqual((await call('PATCH', `/api/seasons/${setup.t.id}`, { cookie: setup.owner.cookie, body: { registrationOpen: true, maxPlayers: 1 } })).status, 200);
});

test('a visitor registers: both admins of the club get a bell row, a plain member and the visitor get none', async () => {
  const r = await register(setup.t, 'Anton Prihlaseny');
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  for (const who of [setup.owner, setup.admin2]) {
    const rows = await bell(who);
    assert.strictEqual(rows.length, 1, `${who.name}: ${JSON.stringify(rows)}`);
    assert.deepStrictEqual([rows[0].registration.name, rows[0].registration.substitute, rows[0].registration.seasonId, rows[0].registration.seasonName, rows[0].registration.orgName, rows[0].seen],
      ['Anton Prihlaseny', false, setup.t.id, 'Rb Turnaj', 'Rb Klub', false]);
  }
  assert.deepStrictEqual(await bell(setup.member), []);
  assert.ok((await unread(setup.owner)) >= 1, 'it counts as unread (the bubble of the bell)');
});

test('the one after the maximum is a substitute, and the notification says so', async () => {
  const r = await register(setup.t, 'Berta Nahradnicka');
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.substitute, true);
  const rows = await bell(setup.owner);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.find((n) => n.registration.name === 'Berta Nahradnicka').registration.substitute, true);
});

test('an admin who registers himself is not told about it, the other admin is', async () => {
  const before = [(await bell(setup.owner)).length, (await bell(setup.admin2)).length];
  const r = await register(setup.t, setup.owner.name, { playerId: setup.owner.id });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.deepStrictEqual([(await bell(setup.owner)).length, (await bell(setup.admin2)).length], [before[0], before[1] + 1]);
});

test('a notification is marked read from the bell; the unread count drops; another player cannot mark it', async () => {
  const rows = await bell(setup.owner);
  const first = rows.find((n) => !n.seen);
  const count = await unread(setup.owner);
  assert.strictEqual((await call('POST', `/api/player/notifications/registration/${first.id}/read`, { cookie: setup.member.cookie })).status, 404, 'not his');
  const done = await call('POST', `/api/player/notifications/registration/${first.id}/read`, { cookie: setup.owner.cookie });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.strictEqual(done.json.unreadNotificationCount, count - 1);
  assert.strictEqual((await bell(setup.owner)).find((n) => n.id === first.id).seen, true);
});

test('a tournament of the league itself (no club) notifies nobody; a deleted tournament leaves no dead row in the bell', async () => {
  const own = await call('POST', '/api/seasons', { cookie: adminCookie, body: { name: 'Ligovy turnaj', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: day(20), endDate: day(21) } });
  assert.strictEqual((await call('PATCH', `/api/seasons/${own.json.id}`, { cookie: adminCookie, body: { registrationOpen: true, maxPlayers: 8 } })).status, 200);
  const before = [(await bell(setup.owner)).length, (await bell(setup.admin2)).length];
  assert.strictEqual((await register(own.json, 'Cyril Ligovy')).status, 201);
  assert.deepStrictEqual([(await bell(setup.owner)).length, (await bell(setup.admin2)).length], before);
  // the club's tournament is deleted: its rows are not listed any more
  const del = await call('DELETE', `/api/seasons/${setup.t.id}?withMatches=1`, { cookie: setup.owner.cookie });
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.deepStrictEqual(await bell(setup.owner), []);
});

test('the push and the bell have their words in both languages, and the click opens the manage page of the event', () => {
  const texts = require('../src/pushTexts');
  const sk = texts.build('REGISTRATION', { name: 'Anton', seasonName: 'Turnaj 1', seasonId: 7, orgName: 'COURTCREW' }, 'sk');
  assert.deepStrictEqual([sk.title, sk.body, sk.url], ['🎾 Anton sa prihlásil do Turnaj 1', 'COURTCREW', '/community-tournament/7']);
  assert.strictEqual(texts.build('REGISTRATION', { name: 'Anton', seasonName: 'Turnaj 1', seasonId: 7, substitute: true }, 'en').title, '🎾 Anton registered as a substitute for Turnaj 1');
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const i18n = read('js/i18n.js');
  for (const key of ['notif.registrationTitle', 'notif.registrationSubTitle']) assert.strictEqual((i18n.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length, 2, `${key} in both languages`);
  const common = read('js/common.js');
  assert.ok(common.includes("n.type === 'REGISTRATION'") && common.includes("notif.type === 'REGISTRATION' ? 'registration'") && common.includes('/community-tournament/${notif.registration.seasonId}'), 'the bell shows it, marks it read and opens the manage page');
  new (require('vm').Script)(common, { filename: 'common.js' });
});

// ---------------------------------------------------------------- run
async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', PUSH_DRY_RUN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
