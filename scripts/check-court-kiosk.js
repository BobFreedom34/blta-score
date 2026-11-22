// Checks of the kiosk of a court of a tournament (a phone that lies on the court, lists its matches and scores them): the link and its QR code, what the kiosk may do (only the
// live score of the matches of its own court), and that a new link switches the old phones off.
// Run: node scripts/check-court-kiosk.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null; // a second connection to the temporary database, to put matches on a court (the draw and the planner are tested elsewhere)

async function call(method, url, { body, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or js */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });

let season;
const players = [];
const matches = {};
let kiosk1 = null; // { token, cookie }

async function makeMatch(name, p1, p2, courtNo) {
  const made = await admin('POST', '/api/matches', { category: 'FRIENDLY', player1Id: p1.id, player2Id: p2.id, format: 'BO3_STB', location: 'Kurt 1', scheduledAt: '2099-05-01T08:00:00.000Z' });
  assert.strictEqual(made.status, 201, made.text);
  db.prepare('UPDATE matches SET season_id = ?, court_no = ? WHERE share_token = ?').run(season.id, courtNo, made.json.token);
  matches[name] = made.json.token;
  return made.json.token;
}
const tokenOfUrl = (url) => url.split('/kiosk/')[1];
const cookieOfRes = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
const asKiosk = (method, url, body) => call(method, url, { body, cookie: kiosk1.cookie });

test('setup: a tournament with two courts and matches on both', async () => {
  const made = await admin('POST', '/api/seasons', { name: 'Kiosk Cup 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' });
  assert.strictEqual(made.status, 201, made.text);
  const set = await admin('PATCH', `/api/seasons/${made.json.id}`, { courtCount: 2 });
  assert.strictEqual(set.status, 200, set.text);
  season = set.json;
  for (const name of ['Ki Player One', 'Ki Player Two', 'Ki Player Three', 'Ki Player Four']) players.push((await admin('POST', '/api/players', { name })).json);
  await makeMatch('a1', players[0], players[1], 1);
  await makeMatch('a2', players[2], players[3], 1);
  await makeMatch('b1', players[0], players[2], 2);
});

test('the organiser makes ONE kiosk link for the tournament: a QR code and an address; only the organiser', async () => {
  const before = await admin('GET', `/api/seasons/${season.id}/kiosk`);
  assert.strictEqual(before.status, 200, before.text);
  assert.deepStrictEqual([before.json.url, before.json.qr], [null, null]);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/kiosk`)).status, 401, 'no admin, no link');
  assert.strictEqual((await call('GET', `/api/seasons/${season.id}/kiosk`)).status, 401);
  const made = await admin('POST', `/api/seasons/${season.id}/kiosk`);
  assert.strictEqual(made.status, 201, made.text);
  assert.ok(/[/]kiosk[/][A-Za-z0-9_-]{30,}$/.test(made.json.url), made.json.url);
  assert.ok(made.json.qr.startsWith('data:image/png;base64,'));
  kiosk1 = { token: tokenOfUrl(made.json.url), cookie: '' };
  assert.strictEqual((await admin('GET', `/api/seasons/${season.id}/kiosk`)).json.url, made.json.url, 'the same link is read back');
});

test('the link shows the courts to pick from (no cookie yet); picking court 1 gives the matches of THAT court only, and the cookie; wrong tokens and courts are a 404', async () => {
  const courts = await call('GET', `/api/kiosk/${kiosk1.token}`);
  assert.strictEqual(courts.status, 200, courts.text);
  assert.deepStrictEqual(courts.json.courts.map((c) => [c.courtNo, c.name]), [[1, 'Kurt 1'], [2, 'Kurt 2']]);
  assert.ok(!cookieOfRes(courts).includes('blta_kiosk'), 'choosing nothing gives no rights');
  const r = await call('GET', `/api/kiosk/${kiosk1.token}/court/1`);
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual([r.json.courtNo, r.json.courtName, r.json.seasonName], [1, 'Kurt 1', 'Kiosk Cup 2099']);
  assert.deepStrictEqual(r.json.matches.map((m) => m.token).sort(), [matches.a1, matches.a2].sort(), 'court 1 only');
  kiosk1.cookie = cookieOfRes(r);
  assert.ok(kiosk1.cookie.includes('blta_kiosk='), 'the cookie');
  for (const bad of ['nope', 'x'.repeat(32), kiosk1.token.slice(1), '..%2Fadmin']) assert.strictEqual((await call('GET', `/api/kiosk/${bad}`)).status, 404, bad);
  for (const bad of ['0', '3', '99', 'abc', '1.5', '-1']) assert.strictEqual((await call('GET', `/api/kiosk/${kiosk1.token}/court/${bad}`)).status, 404, `court ${bad}`);
  const session = await call('GET', '/api/player/session', { cookie: kiosk1.cookie });
  assert.deepStrictEqual(session.json.kioskCourt, { seasonId: season.id, courtNo: 1 });
  assert.strictEqual(session.json.isAdmin, false);
  assert.strictEqual((await call('GET', '/api/player/session')).json.kioskCourt, null, 'a browser without the cookie is no kiosk');
});

test('the short address /turnaj<number> asks for the 5-digit code of the kiosk and hands out the long link; wrong codes are counted and lock it; a tournament with no kiosk is a 404', async () => {
  const view = (await admin('GET', `/api/seasons/${season.id}/kiosk`)).json;
  assert.ok(view.shortUrl.endsWith(`/turnaj${season.id}`) && !view.shortUrl.includes('/kiosk/'), view.shortUrl);
  assert.ok(/^[0-9]{5}$/.test(view.code), 'a 5-digit code');
  const page = await call('GET', `/turnaj${season.id}`);
  assert.strictEqual(page.status, 200);
  assert.ok(page.text.includes('/js/kiosk.js') && /noindex/.test(page.headers.get('x-robots-tag') || ''));
  const open = (code, number = season.id) => call('POST', `/api/kiosk/turnaj/${number}/open`, { body: { code } });
  const wrongCode = view.code === '00000' ? '11111' : '00000';
  // the right code gives the long link (it opens the courts); no cookie is given yet - the court is what gives the rights
  const ok = await open(view.code);
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.token, kiosk1.token);
  assert.ok(!cookieOfRes(ok).includes('blta_kiosk'));
  assert.strictEqual((await open('12ab5')).status, 401, 'letters');
  assert.strictEqual((await open('')).status, 401, 'nothing');
  assert.strictEqual((await open(undefined)).status, 401);
  assert.strictEqual((await open(wrongCode, 999999)).status, 404, 'no such tournament');
  assert.strictEqual((await call('POST', '/api/kiosk/turnaj/abc/open', { body: { code: view.code } })).status, 404, 'not a number');
  // a tournament that has no kiosk looks the same as one that does not exist
  const other = await admin('POST', '/api/seasons', { name: 'No Kiosk Cup', kind: 'TOURNAMENT', startDate: '2099-06-01', endDate: '2099-06-02' });
  assert.strictEqual((await open(view.code, other.json.id)).status, 404);
  // 5 wrong codes in all (three were counted above), then the short address is shut for ten minutes - the right code does not open it either
  assert.strictEqual((await open(wrongCode)).status, 401, 'the fourth wrong code');
  assert.strictEqual((await open(wrongCode)).status, 429, 'the fifth wrong code closes it');
  assert.strictEqual((await open(view.code)).status, 429, 'closed, also for the right code');
  assert.strictEqual((await call('GET', `/api/kiosk/${kiosk1.token}`)).status, 200, 'the long link and its QR code still work');
});

test('the kiosk runs the live score of a match on its court: start, point, undo, pause, resume', async () => {
  const t = matches.a1;
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/start`, { firstServer: 1 })).status, 200);
  for (let i = 0; i < 4; i += 1) assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/score`, { player: 1, delta: 1 })).status, 200);
  const undo = await asKiosk('POST', `/api/matches/${t}/undo`);
  assert.strictEqual(undo.status, 200, undo.text);
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/pause`)).status, 200);
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/resume`)).status, 200);
  const shown = await call('GET', `/api/matches/${t}`);
  assert.strictEqual(shown.json.courtNo, 1, 'the match says which court it is on');
});

test('the kiosk of court 1 cannot touch a match of court 2, nor anything outside the live score', async () => {
  const other = matches.b1;
  for (const [action, body] of [['start', { firstServer: 1 }], ['score', { player: 1, delta: 1 }], ['undo'], ['pause']]) {
    const r = await asKiosk('POST', `/api/matches/${other}/${action}`, body);
    assert.strictEqual(r.status, 403, `${action}: ${r.text}`);
  }
  assert.strictEqual((await asKiosk('PATCH', `/api/matches/${matches.a2}`, { location: 'Elsewhere' })).status, 401, 'editing a match is not part of it');
  assert.strictEqual((await asKiosk('DELETE', `/api/matches/${matches.a2}`)).status, 401, 'nor is deleting one');
  assert.strictEqual((await asKiosk('POST', `/api/matches/${matches.a1}/restart`)).status, 403, 'a restart throws the score away: not from a phone on the court');
  assert.strictEqual((await asKiosk('GET', `/api/seasons/${season.id}/kiosk`)).status, 401, 'no organiser rights');
});

test('a finished match is closed to the kiosk (no more points, no undo)', async () => {
  const t = matches.a2;
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/start`, { firstServer: 2 })).status, 200);
  db.prepare("UPDATE matches SET status = 'FINISHED', end_time = ?, winner_id = ? WHERE share_token = ?").run(new Date().toISOString(), players[2].id, t);
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/score`, { player: 2, delta: 1 })).status, 403, 'finished: no more points');
  assert.strictEqual((await asKiosk('POST', `/api/matches/${t}/undo`)).status, 403, 'nor undo');
});

test('a phone that picks court 2 can score court 2 and no longer court 1; a new link replaces the old one: the old address and the phones that held its cookie stop working; removing the link does the same', async () => {
  const two = await call('GET', `/api/kiosk/${kiosk1.token}/court/2`);
  const phone2 = cookieOfRes(two);
  assert.strictEqual((await call('POST', `/api/matches/${matches.b1}/start`, { body: { firstServer: 1 }, cookie: phone2 })).status, 200, 'court 2 phone, a match of court 2');
  assert.strictEqual((await call('POST', `/api/matches/${matches.a1}/pause`, { cookie: phone2 })).status, 403, 'court 2 phone, a match of court 1');
  const again = await admin('POST', `/api/seasons/${season.id}/kiosk`);
  assert.strictEqual(again.status, 201, again.text);
  const newToken = tokenOfUrl(again.json.url);
  assert.ok(/^[0-9]{5}$/.test(again.json.code), 'the new link has a code');
  assert.notStrictEqual(newToken, kiosk1.token);
  assert.strictEqual((await call('GET', `/api/kiosk/${kiosk1.token}`)).status, 404, 'the old address');
  assert.strictEqual((await asKiosk('POST', `/api/matches/${matches.a1}/pause`)).status, 403, 'the old cookie');
  assert.strictEqual((await call('GET', '/api/player/session', { cookie: kiosk1.cookie })).json.kioskCourt, null);
  const opened = await call('GET', `/api/kiosk/${newToken}/court/1`);
  assert.strictEqual(opened.status, 200);
  kiosk1 = { token: newToken, cookie: cookieOfRes(opened) };
  assert.strictEqual((await asKiosk('POST', `/api/matches/${matches.a1}/pause`)).status, 200, 'the new cookie works');
  assert.strictEqual((await admin('DELETE', `/api/seasons/${season.id}/kiosk`)).status, 200);
  assert.strictEqual((await call('GET', `/api/kiosk/${newToken}`)).status, 404, 'removed');
  assert.strictEqual((await asKiosk('POST', `/api/matches/${matches.a1}/resume`)).status, 403);
});

test('the kiosk page is a plain noindex page; Backend > SEO lists it as a utility page', async () => {
  const r = await call('GET', '/kiosk/anything');
  assert.strictEqual(r.status, 200);
  assert.ok(/noindex/.test(r.headers.get('x-robots-tag') || ''));
  assert.ok(r.text.includes('/js/kiosk.js'));
  assert.ok(r.text.includes('/js/common-forms.js'), 'the names of the categories (categoryLabel needs CATEGORY_LABELS) - a list of an Elite match fails without it');
  const sitemap = (await call('GET', '/sitemap.xml')).text;
  assert.ok(!/\/kiosk[\/<"\s]/.test(sitemap), 'not in the sitemap');
  const seo = (await admin('GET', '/api/seo')).json;
  const entry = seo.find((p) => p.key === 'kiosk');
  assert.ok(entry, 'listed in Backend > SEO');
  assert.ok(!/\(new page\)/.test(entry.label), 'listed by hand, not picked up as a new page');
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
