// Checks of a registered player dropping out himself (the button "Odhlásiť sa" on the page of a tournament): the setting of the organiser (hours before the start, empty = the
// player cannot), the rule (too late, the draw is made), what happens (the registration is gone, the first substitute is in, the admins of the club get a bell row), who may.
// Run: node scripts/check-unregister.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unreg-'));
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
  const phone = `09140${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, phone, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// the player registers himself (the public form, with the profile he chose)
function register(season, who) {
  ipCounter += 1;
  return call('POST', `/api/seasons/${season.id}/registrations`, { headers: { 'x-forwarded-for': `10.8.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` }, body: { name: who.name, phone: who.phone, email: `u${ipCounter}@example.com`, playerId: who.id } });
}
const view = async (season, cookie = '') => (await call('GET', `/api/seasons/by-slug/${season.slug}`, { cookie })).json;
const bell = async (who) => (await call('GET', '/api/player/notifications', { cookie: who.cookie })).json.filter((n) => n.type === 'REGISTRATION');
const setHours = (season, value) => call('PATCH', `/api/seasons/${season.id}`, { cookie: setup.owner.cookie, body: { unregisterHours: value } });
const drop = (season, who) => call('DELETE', `/api/seasons/${season.id}/registrations/mine`, { cookie: who ? who.cookie : '' });

const setup = {};
async function newTournament(name, startOffset) {
  const t = await call('POST', `/api/communities/${setup.org.id}/tournaments`, { cookie: setup.owner.cookie, body: { name, venue: 'Kurty', startDate: day(startOffset), endDate: day(startOffset + 1), playType: 'SINGLES' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.json.id}`, { cookie: setup.owner.cookie, body: { registrationOpen: true, maxPlayers: 1 } })).status, 200);
  return (await call('GET', `/api/seasons/by-slug/${t.json.slug}`, { cookie: setup.owner.cookie })).json;
}

test('setup: a club with an admin, a tournament 10 days ahead with room for one player, three players', async () => {
  setup.owner = await makePlayer('Un Majitel');
  setup.a = await makePlayer('Un Alfa');
  setup.b = await makePlayer('Un Beta');
  setup.c = await makePlayer('Un Cudzi');
  const org = await call('POST', '/api/communities', { cookie: setup.owner.cookie, body: { type: 'CLUB', name: 'Un Klub', joinPolicy: 'OPEN' } });
  assert.ok(org.json && org.json.id, JSON.stringify(org.json));
  setup.org = org.json;
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.org.id}/approval`, { cookie: adminCookie, body: { approved: true } })).status, 200);
  setup.t = await newTournament('Un Turnaj', 10);
  assert.strictEqual(setup.t.unregisterHours, null, 'by default a player cannot drop out alone');
});

test('the setting: whole hours from 0 to 720, empty clears it; a bad value is refused', async () => {
  for (const bad of [-1, 1.5, 'abc', 721]) assert.strictEqual((await setHours(setup.t, bad)).status, 400, `hours ${bad}`);
  const ok = await setHours(setup.t, 48);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.unregisterHours, 48);
  assert.strictEqual((await setHours(setup.t, 0)).json.unregisterHours, 0, '0 = until the start');
  assert.strictEqual((await setHours(setup.t, '')).json.unregisterHours, null);
  assert.strictEqual((await setHours(setup.t, 48)).json.unregisterHours, 48);
  assert.strictEqual((await call('PATCH', `/api/seasons/${setup.t.id}`, { cookie: setup.owner.cookie, body: { name: 'Un Turnaj' } })).json.unregisterHours, 48, 'saving other things keeps it');
});

test('a registered player sees his own registration (and may drop out); others and visitors see nothing of it', async () => {
  const r = await register(setup.t, setup.a);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const mine = (await view(setup.t, setup.a.cookie)).myRegistration;
  assert.ok(mine && mine.allowed === true && mine.reason === null && mine.substitute === false, JSON.stringify(mine));
  // a tournament starts at the start of its playing day (09:00 in Bratislava = 07:00 or 08:00 UTC): 48 hours before that
  const expected = new Date(`${setup.t.startDate}T08:00:00Z`).getTime() - 48 * 3600000;
  assert.ok(Math.abs(new Date(mine.deadline).getTime() - expected) <= 3600000, `the deadline is 48 hours before the start of the first day: ${mine.deadline}`);
  assert.strictEqual((await view(setup.t, setup.c.cookie)).myRegistration, null);
  assert.strictEqual((await view(setup.t)).myRegistration, null);
});

test('a substitute is told so, can drop out too, and the one after the maximum comes in when the first drops out', async () => {
  const r = await register(setup.t, setup.b);
  assert.strictEqual(r.json.substitute, true);
  assert.strictEqual((await view(setup.t, setup.b.cookie)).myRegistration.substitute, true);
  const before = (await view(setup.t)).registrations.find((x) => x.name === setup.b.name);
  assert.strictEqual(before.substitute, true);
  const out = await drop(setup.t, setup.a);
  assert.strictEqual(out.status, 200, JSON.stringify(out.json));
  const after = await view(setup.t, setup.b.cookie);
  assert.ok(!after.registrations.some((x) => x.name === setup.a.name), 'the registration of the player who dropped out is gone');
  assert.strictEqual(after.registrations.find((x) => x.name === setup.b.name).substitute, false, 'the first substitute is in');
  assert.strictEqual((await view(setup.t, setup.a.cookie)).myRegistration, null, 'he is not registered any more');
});

test('the admins of the club get a bell row "dropped out" (the player himself none); the row counts as unread and can be marked read', async () => {
  const rows = (await bell(setup.owner)).filter((n) => n.registration.kind === 'UNREGISTER');
  assert.strictEqual(rows.length, 1, JSON.stringify(rows));
  assert.deepStrictEqual([rows[0].registration.name, rows[0].registration.seasonId, rows[0].registration.orgName, rows[0].seen], [setup.a.name, setup.t.id, 'Un Klub', false]);
  const kinds = (await bell(setup.owner)).map((n) => n.registration.kind);
  assert.ok(kinds.includes('REGISTER') && kinds.includes('UNREGISTER'), 'registrations and drop-outs are both in the bell');
  assert.deepStrictEqual(await bell(setup.a), []);
  const done = await call('POST', `/api/player/notifications/registration/${rows[0].id}/read`, { cookie: setup.owner.cookie });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
});

test('he can register again after dropping out', async () => {
  assert.strictEqual((await register(setup.t, setup.a)).status, 201);
  assert.strictEqual((await view(setup.t, setup.a.cookie)).myRegistration.substitute, true, 'the place is taken by the other one: he waits');
});

test('without the setting a player cannot drop out alone: 403, and he stays registered; the page says why', async () => {
  const t = await newTournament('Un Bez nastavenia', 10);
  assert.strictEqual((await register(t, setup.c)).status, 201);
  const mine = (await view(t, setup.c.cookie)).myRegistration;
  assert.deepStrictEqual([mine.allowed, mine.reason, mine.deadline], [false, 'OFF', null]);
  const r = await drop(t, setup.c);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'UNREGISTER_OFF');
  assert.ok((await view(t)).registrations.some((x) => x.name === setup.c.name), 'still registered');
});

test('too late (less hours left than the organiser asks) is refused; the page says so', async () => {
  const t = await newTournament('Un Neskoro', 1);
  await setHours(t, 48);
  assert.strictEqual((await register(t, setup.c)).status, 201);
  const mine = (await view(t, setup.c.cookie)).myRegistration;
  assert.deepStrictEqual([mine.allowed, mine.reason], [false, 'LATE']);
  const r = await drop(t, setup.c);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'UNREGISTER_LATE');
});

test('once the draw is made (he has a match) he cannot drop out alone', async () => {
  const t = await newTournament('Un Zrebovane', 10);
  await setHours(t, 48);
  assert.strictEqual((await register(t, setup.c)).status, 201);
  const m = await call('POST', '/api/matches', { cookie: setup.owner.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: setup.c.id, player2Id: setup.b.id, seasonId: t.id, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(m.status, 201, JSON.stringify(m.json));
  const r = await drop(t, setup.c);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'UNREGISTER_DRAW');
  assert.strictEqual((await view(t, setup.c.cookie)).myRegistration.reason, 'DRAW');
});

test('a visitor (not logged in) gets 401, a player who is not registered 404, an unknown event 404', async () => {
  const t = await newTournament('Un Cudzi turnaj', 10);
  await setHours(t, 48);
  assert.strictEqual((await drop(t)).status, 401);
  assert.strictEqual((await drop(t, setup.c)).status, 404);
  assert.strictEqual((await call('DELETE', '/api/seasons/999999/registrations/mine', { cookie: setup.c.cookie })).status, 404);
});

test('the page: the button "Odhlásiť sa" replaces the registration of a registered player, the Backend has the field, the bell and the texts exist in both languages', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const season = read('js/season.js');
  new (require('vm').Script)(season, { filename: 'season.js' });
  assert.ok(season.includes('id="sv-unregister"') && season.includes('/registrations/mine') && season.includes('season.myRegistration'), 'the button and its call');
  assert.ok(season.includes("t('season.register')"), 'the registration button keeps its name');
  const admin = read('js/seasons-admin.js');
  new (require('vm').Script)(admin, { filename: 'seasons-admin.js' });
  assert.ok(admin.includes("input('unregisterHours'") && admin.includes("unregisterHours: f('unregisterHours')"), 'the field in the section Štartovné a registrácia, and its save');
  const common = read('js/common.js');
  new (require('vm').Script)(common, { filename: 'common.js' });
  assert.ok(common.includes("n.registration.kind === 'UNREGISTER' ? 'notif.unregistrationTitle'"), 'the bell');
  const i18n = read('js/i18n.js');
  assert.ok(season.includes("t('season.unregisterNote' + (mine.reason || 'OFF')") && season.includes('id="sv-info"') && season.includes('class="home-tip" id="sv-tip"'), 'the reason is in the popover of the "i" next to the green button, like on the home page');
  assert.ok(read('css/style.css').includes('.sv-btn.reg-on { background: var(--green)'), 'the button of a registered player is green');
  for (const key of ['season.unregisterNoteLATE', 'season.unregisterNoteOFF', 'season.unregisterNoteDRAW']) assert.strictEqual(read('js/i18n.js').split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  for (const key of ['season.unregister', 'season.unregisterConfirm', 'season.unregisterUntil', 'season.unregistered', 'season.registeredNote', 'season.registeredSub', 'season.unregisterOFF', 'season.unregisterLATE', 'season.unregisterDRAW', 'season.unregisterFailed', 'notif.unregistrationTitle']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  }
  const texts = require('../src/pushTexts');
  assert.strictEqual(texts.build('UNREGISTRATION', { name: 'Anton', seasonName: 'Turnaj 1', seasonId: 7, orgName: 'COURTCREW' }, 'sk').title, '🎾 Anton sa odhlásil z Turnaj 1');
  assert.strictEqual(texts.build('UNREGISTRATION', { name: 'Anton', seasonName: 'Turnaj 1', seasonId: 7 }, 'en').title, '🎾 Anton withdrew from Turnaj 1');
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
