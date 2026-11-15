// Checks of the pop-ups about an event (Backend > Popups, /api/popups and /api/player/popup): the admin makes and changes them (bad input is refused), a logged-in
// player gets the one that is active and that he is not registered for, closing it / saying no / registering end it the right way, the numbers add up, "ask everybody
// again" works, and who may do what. The rules that depend on time are in check-popups-rules.js.
// Run: node scripts/check-popups.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popups-'));
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
  if (cookie) { h.Cookie = cookie; h['X-Backend'] = '1'; }
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09150${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, phone, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const as = (who) => ({ cookie: who.cookie });
// a player's browser asks without X-Backend (a public page), so no admin header
const next = async (who) => (await fetch(`${base}/api/player/popup/next`, { headers: who ? { Cookie: who.cookie } : {} }).then((r) => r.json())).popup;
const playerPost = (who, id, action, body = {}) => fetch(`${base}/api/player/popup/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
const register = (season, who) => {
  ipCounter += 1;
  return call('POST', `/api/seasons/${season.id}/registrations`, { headers: { 'x-forwarded-for': `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` }, body: { name: who.name, phone: who.phone, email: `p${ipCounter}@example.com`, category: 'ELITE', playerId: who.id } });
};
const get = async () => (await call('GET', '/api/popups', { cookie: adminCookie })).json;
const make = (body) => call('POST', '/api/popups', { cookie: adminCookie, body });
const setup = {};

test('setup: a season that takes registrations (and one that does not), three players', async () => {
  const s = await call('POST', '/api/seasons', { cookie: adminCookie, body: { name: 'Pop Sezona 2027', kind: 'LEAGUE', startDate: day(30), endDate: day(200), categories: ['ELITE', 'NEXT_GEN', 'NOVICE'] } });
  assert.ok([200, 201].includes(s.status), JSON.stringify(s.json));
  setup.season = s.json;
  const pr = await call("PATCH", `/api/seasons/${setup.season.id}`, { cookie: adminCookie, body: { registrationOpen: true, maxPlayers: 50 } }); assert.strictEqual(pr.status, 200, JSON.stringify(pr.json));
  const c = await call('POST', '/api/seasons', { cookie: adminCookie, body: { name: 'Pop Zatvorena', kind: 'LEAGUE', startDate: day(30), endDate: day(200), categories: ['ELITE'] } });
  setup.closed = c.json; await call('PATCH', `/api/seasons/${setup.closed.id}`, { cookie: adminCookie, body: { registrationOpen: false } }); assert.ok(setup.closed && setup.closed.id, JSON.stringify(c.json));
  setup.a = await makePlayer('Pop Alfa');
  setup.b = await makePlayer('Pop Beta');
  setup.c = await makePlayer('Pop Gama');
});

test('only an admin manages them; bad input is refused', async () => {
  assert.strictEqual((await fetch(`${base}/api/popups`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/popups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.strictEqual((await make({ seasonId: 99999 })).status, 400, 'an event that does not exist');
  assert.strictEqual((await make({ seasonId: setup.season.id, startsAt: 'x' })).status, 400);
  assert.strictEqual((await make({ seasonId: setup.season.id, startsAt: day(5), endsAt: day(2) })).status, 400, 'ends before it starts');
  assert.strictEqual((await make({ seasonId: setup.season.id, repeatDays: 0 })).status, 400);
  assert.strictEqual((await make({ seasonId: setup.season.id, repeatDays: 61 })).status, 400);
  assert.strictEqual((await get()).popups.length, 0, 'nothing was saved');
});

test('a popup is made: active, listed with the events it can be about; texts with markup stay text', async () => {
  const made = await make({ seasonId: setup.season.id, headline: { sk: 'Nezabudni sa registrovať do <b>ďalšej</b> sezóny', en: '' }, message: { sk: 'Ahoj', en: '' }, startsAt: day(-1), endsAt: day(20), repeatDays: 3, audience: 'ALL' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  setup.popup = made.json.popups[0];
  assert.strictEqual(setup.popup.status, 'ACTIVE');
  assert.strictEqual(setup.popup.seasonName, 'Pop Sezona 2027');
  assert.ok(made.json.events.some((e) => e.id === setup.season.id && e.registrationOpen));
  assert.ok(made.json.events.some((e) => e.id === setup.closed.id && !e.registrationOpen));
  assert.deepStrictEqual([setup.popup.stats.shown, setup.popup.stats.registered, setup.popup.stats.declined, setup.popup.stats.waiting], [0, 0, 0, 0]);
  assert.deepStrictEqual(setup.popup.stats.declinedPlayers, []);
});

test('a logged-in player gets it with the event (photo, dates, category choice); a visitor gets nothing', async () => {
  assert.strictEqual(await next(null), null);
  const p = await next(setup.a);
  assert.ok(p, 'player A gets the popup');
  assert.strictEqual(p.id, setup.popup.id);
  assert.strictEqual(p.event.name, 'Pop Sezona 2027');
  assert.strictEqual(p.event.startDate, day(30));
  assert.strictEqual(p.event.endDate, day(200));
  assert.strictEqual(p.event.categoryChoice, true);
  assert.deepStrictEqual(p.event.categories, ['ELITE', 'NEXT_GEN', 'NOVICE']);
  assert.ok(p.event.codePath.startsWith('/season/'));
  assert.ok(p.headline.sk.includes('<b>'), 'the text is data: the page escapes it');
  // the form is filled in from his profile: the session gives his own phone (and e-mail, category) back
  const me = await fetch(`${base}/api/player/session`, { headers: { Cookie: setup.a.cookie } }).then((r) => r.json());
  assert.strictEqual(me.playerPhone, setup.a.phone);
  assert.ok('playerEmail' in me && 'playerCategory' in me);
});

test('the cross closes it for now (it does not come back at once); the numbers count who saw it', async () => {
  assert.strictEqual((await playerPost(setup.a, setup.popup.id, 'seen')).status, 200);
  assert.strictEqual((await playerPost(setup.a, setup.popup.id, 'dismiss')).status, 200);
  assert.strictEqual(await next(setup.a), null, 'closed less than 3 days ago');
  assert.ok(await next(setup.b), 'the others still get it');
  const s = (await get()).popups[0].stats;
  assert.strictEqual(s.shown, 1);
  assert.strictEqual(s.waiting, 1);
});

test('"I don\'t want to register" ends it for good, and the reason is counted', async () => {
  assert.strictEqual((await playerPost(setup.b, setup.popup.id, 'seen')).status, 200);
  assert.strictEqual((await playerPost(setup.b, setup.popup.id, 'decline')).status, 200);
  assert.strictEqual(await next(setup.b), null);
  assert.strictEqual((await playerPost(setup.b, setup.popup.id, 'reason', { reason: 'NO_TIME' })).status, 200);
  assert.strictEqual((await playerPost(setup.b, setup.popup.id, 'reason', { reason: 'bogus' })).status, 200);
  const s = (await get()).popups[0].stats;
  assert.strictEqual(s.declined, 1);
  assert.strictEqual(s.reasons.NO_TIME, 1);
  assert.deepStrictEqual(s.declinedPlayers.map((d) => [d.name, d.reason]), [['Pop Beta', 'NO_TIME']], 'the Backend sees who said no and why');
  assert.strictEqual(s.waiting, 1, 'A is still deciding');
});

test('a player who registers (through the popup or the page) is not asked any more and counts as registered', async () => {
  assert.strictEqual((await playerPost(setup.c, setup.popup.id, 'seen')).status, 200);
  assert.ok(await next(setup.c));
  const r = await register(setup.season, setup.c);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(await next(setup.c), null);
  const s = (await get()).popups[0].stats;
  assert.strictEqual(s.registered, 1);
  assert.strictEqual(s.shown, 3);
  assert.strictEqual(s.impressions, 3);
});

test('"ask everybody again" brings it back to who closed it or said no, never to a registered player', async () => {
  const r = await call('POST', `/api/popups/${setup.popup.id}/reset`, { cookie: adminCookie, body: {} });
  assert.strictEqual(r.status, 200);
  assert.ok(await next(setup.a));
  assert.ok(await next(setup.b));
  assert.strictEqual(await next(setup.c), null);
  assert.strictEqual(r.json.popups[0].stats.declined, 0);
});

test('the player routes need a player, and know only the popups of this city', async () => {
  assert.strictEqual((await playerPost(null, setup.popup.id, 'dismiss')).status, 401);
  assert.strictEqual((await playerPost(setup.a, 99999, 'dismiss')).status, 404);
});

test('switched off, not started yet, ended, or the registration closed: nothing is shown; switching back on shows it', async () => {
  const put = (patch) => call('PUT', `/api/popups/${setup.popup.id}`, { cookie: adminCookie, body: { ...patchBase(), ...patch } });
  const patchBase = () => ({ seasonId: setup.season.id, headline: setup.popup.headline, message: setup.popup.message, startsAt: day(-1), endsAt: day(20), repeatDays: 3, audience: 'ALL', enabled: true });
  let r = await put({ enabled: false });
  assert.strictEqual(r.json.popups[0].status, 'OFF');
  assert.strictEqual(await next(setup.a), null);
  r = await put({ startsAt: day(3) });
  assert.strictEqual(r.json.popups[0].status, 'SCHEDULED');
  assert.strictEqual(await next(setup.a), null);
  r = await put({ startsAt: day(-10), endsAt: day(-2) });
  assert.strictEqual(r.json.popups[0].status, 'ENDED');
  assert.strictEqual(await next(setup.a), null);
  assert.strictEqual((await call('PATCH', `/api/seasons/${setup.season.id}`, { cookie: adminCookie, body: { registrationOpen: false } })).status, 200);
  r = await put({});
  assert.strictEqual(r.json.popups[0].status, 'CLOSED');
  assert.strictEqual(await next(setup.a), null);
  const pr = await call("PATCH", `/api/seasons/${setup.season.id}`, { cookie: adminCookie, body: { registrationOpen: true } }); assert.strictEqual(pr.status, 200, JSON.stringify(pr.json));
  r = await put({});
  assert.strictEqual(r.json.popups[0].status, 'ACTIVE');
  assert.ok(await next(setup.a));
});


test('registering through the popup asks no category (the organiser sorts the player); the ordinary form still needs one, and a popup cannot register somebody else', async () => {
  const d = await makePlayer('Pop Delta');
  const e = await makePlayer('Pop Epsilon');
  const post = (who, body) => { ipCounter += 1; return call('POST', `/api/seasons/${setup.season.id}/registrations`, { cookie: who ? who.cookie : '', headers: { 'x-forwarded-for': `10.7.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` }, body: { phone: d.phone, email: 'd@example.com', category: '', ...body } }); };
  assert.strictEqual((await post(d, { name: d.name, playerId: d.id })).status, 400, 'the ordinary form needs a category');
  assert.strictEqual((await post(null, { name: d.name, playerId: d.id, popup: true })).status, 400, 'not logged in');
  assert.strictEqual((await post(e, { name: d.name, playerId: d.id, popup: true })).status, 400, 'not for somebody else');
  const ok = await post(d, { name: d.name, playerId: d.id, popup: true });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.category, '');
  const regs = await call('GET', `/api/seasons/${setup.season.id}/registrations`, { cookie: adminCookie });
  assert.strictEqual(regs.json.find((r) => r.player_id === d.id || r.name === d.name).category, '');
});
test('the preview shows what a player sees; a popup is deleted with its numbers', async () => {
  const pv = await call('GET', `/api/popups/${setup.popup.id}/preview`, { cookie: adminCookie });
  assert.strictEqual(pv.status, 200);
  assert.strictEqual(pv.json.popup.event.name, 'Pop Sezona 2027');
  assert.strictEqual((await call('GET', '/api/popups/99999/preview', { cookie: adminCookie })).status, 404);
  const del = await call('DELETE', `/api/popups/${setup.popup.id}`, { cookie: adminCookie });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.popups.length, 0);
  assert.strictEqual(await next(setup.a), null);
});

test('the backend page, its tab and the robots rule exist; the script is loaded by the pages', async () => {
  const page = await fetch(`${base}/popups-admin`);
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('popups-admin-root'));
  assert.ok(/Disallow: \/popups-admin/.test(await (await fetch(`${base}/robots.txt`)).text()));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8').includes("'/popups-admin'"));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8').includes('/js/event-popup.js'));
});

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
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
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
void as;
