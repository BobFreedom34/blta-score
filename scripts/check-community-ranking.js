// Checks of the own ranking of a community or club (the tab Rebríček of its page): GET / PUT /api/communities/:id/ranking[/:playerId]. Every ACTIVE member is in it by
// himself (with 0 points, no rank), the admin sets the points by hand, nobody else may, players with equal points share a rank, and the tab is on the page.
// Run: node scripts/check-community-ranking.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comrank-'));
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
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };

// a real player who is logged in with the phone number; returns { id, name, cookie }
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09080${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}

const setup = {};
const rank = (who, id, points) => call('PUT', `/api/communities/${setup.org.id}/ranking/${id}`, { cookie: who.cookie, body: { points } });
const names = (r) => r.json.items.map((i) => `${i.rank === null ? '-' : i.rank}:${i.name}:${i.points}`);
const get = () => call('GET', `/api/communities/${setup.org.id}/ranking`);

test('setup: a club with an admin and three members, and a player outside it', async () => {
  setup.owner = await makePlayer('Rk Owner');
  setup.a = await makePlayer('Rk Alfa');
  setup.b = await makePlayer('Rk Beta');
  setup.c = await makePlayer('Rk Gama');
  setup.outsider = await makePlayer('Rk Outsider');
  const org = await call('POST', '/api/communities', { cookie: setup.owner.cookie, body: { type: 'CLUB', name: 'Rk Klub', joinPolicy: 'OPEN' } });
  assert.ok(org.json && org.json.id, JSON.stringify(org.json));
  setup.org = org.json;
  assert.strictEqual((await call('PATCH', `/api/communities/${setup.org.id}/approval`, { cookie: adminCookie, body: { approved: true } })).status, 200);
  for (const who of [setup.a, setup.b, setup.c]) {
    const joined = await call('POST', `/api/communities/${setup.org.id}/join`, { cookie: who.cookie });
    assert.ok([200, 201].includes(joined.status), JSON.stringify(joined.json));
  }
});

test('the ranking holds every member by himself, nobody added: 0 points, no rank, public', async () => {
  const r = await get();
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(names(r), ['-:Rk Alfa:0', '-:Rk Beta:0', '-:Rk Gama:0', '-:Rk Owner:0'], 'by name while nobody has points');
  assert.ok(r.json.items.every((i) => i.slug && i.playerId), 'each row links to the profile');
});

test('the admin of the club sets the points: sorted by points, equal points share a rank (1, 2, 2, 4), a member with none has no rank', async () => {
  assert.strictEqual((await rank(setup.owner, setup.a.id, 30)).status, 200);
  assert.strictEqual((await rank(setup.owner, setup.b.id, 50)).status, 200);
  assert.strictEqual((await rank(setup.owner, setup.c.id, 30)).status, 200);
  const r = await get();
  assert.deepStrictEqual(names(r), ['1:Rk Beta:50', '2:Rk Alfa:30', '2:Rk Gama:30', '-:Rk Owner:0']);
  assert.strictEqual((await rank(setup.owner, setup.owner.id, 10)).status, 200, 'the admin is a member too');
  assert.deepStrictEqual(names(await get()), ['1:Rk Beta:50', '2:Rk Alfa:30', '2:Rk Gama:30', '4:Rk Owner:10']);
});

test('setting the points again changes them (no second row); 0 takes a member back to no rank', async () => {
  assert.deepStrictEqual(names(await rank(setup.owner, setup.a.id, 70)), ['1:Rk Alfa:70', '2:Rk Beta:50', '3:Rk Gama:30', '4:Rk Owner:10']);
  assert.strictEqual(withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM organisation_ranking WHERE organisation_id = ?').get(setup.org.id).n), 4);
  assert.deepStrictEqual(names(await rank(setup.owner, setup.owner.id, 0)), ['1:Rk Alfa:70', '2:Rk Beta:50', '3:Rk Gama:30', '-:Rk Owner:0']);
});

test('a member who joins later is in the ranking at once; one who leaves is out of it (his points are kept for when he comes back)', async () => {
  const late = await makePlayer('Rk Pozdny');
  assert.ok([200, 201].includes((await call('POST', `/api/communities/${setup.org.id}/join`, { cookie: late.cookie })).status));
  assert.ok(names(await get()).includes('-:Rk Pozdny:0'), 'new member: 0 points');
  assert.strictEqual((await rank(setup.owner, late.id, 5)).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${setup.org.id}/leave`, { cookie: late.cookie })).status, 200);
  assert.ok(!names(await get()).some((n) => n.includes('Rk Pozdny')), 'left: not in the ranking');
  assert.strictEqual((await rank(setup.owner, late.id, 6)).status, 404, 'and cannot be given points');
  assert.ok([200, 201].includes((await call('POST', `/api/communities/${setup.org.id}/join`, { cookie: late.cookie })).status));
  assert.ok(names(await get()).includes('4:Rk Pozdny:5'), 'back again with the points he had: ' + names(await get()));
});

test('a plain member and a visitor cannot set points; the ranking stays as it was', async () => {
  const before = names(await get());
  assert.strictEqual((await rank(setup.b, setup.b.id, 999)).status, 403);
  assert.strictEqual((await rank({ cookie: '' }, setup.b.id, 999)).status, 401);
  assert.deepStrictEqual(names(await get()), before);
});

test('the points are a whole number from 0 to 1 000 000, and only a member is in the ranking', async () => {
  for (const bad of [-1, 1.5, 'abc', null, 1000001, undefined]) assert.strictEqual((await rank(setup.owner, setup.a.id, bad)).status, 400, `points ${bad}`);
  assert.strictEqual((await rank(setup.owner, setup.outsider.id, 5)).status, 404, 'a player who is not a member');
  assert.strictEqual((await rank(setup.owner, 999999, 5)).status, 404);
  assert.strictEqual((await rank(setup.owner, setup.c.id, 0)).status, 200, '0 is allowed');
  assert.strictEqual((await rank(setup.owner, setup.c.id, 30)).status, 200);
});

test('the super admin of the site can set the points of any club too', async () => {
  const r = await rank({ cookie: adminCookie }, setup.b.id, 80);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.items[0].name, 'Rk Beta');
});

test('deleting the club deletes its ranking', async () => {
  assert.strictEqual((await call('DELETE', `/api/communities/${setup.org.id}`, { cookie: setup.owner.cookie })).status, 200);
  assert.strictEqual(withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM organisation_ranking WHERE organisation_id = ?').get(setup.org.id).n), 0);
});

test('the page has the tab Rebríček in the 3rd place (after Udalosti, before Info), in both languages, with no "add a player" form and the points edited only for who manages', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/community.js'), 'utf8');
  new (require('vm').Script)(js, { filename: 'community.js' });
  const order = ["['news', 'com.tabNews']", "['events', 'com.tabEvents']", "['ranking', 'com.tabRanking']", "['info', 'com.tabInfo']"].map((s) => js.indexOf(s));
  assert.ok(order.every((n) => n >= 0) && order.every((n, i) => !i || order[i - 1] < n), 'tab order: ' + order);
  assert.ok(js.includes("['news', 'events', 'ranking', 'info'].includes(hash)"), '#ranking opens the tab');
  const fn = /function rankingHtml\(\) \{[\s\S]*?\n  \}/.exec(js)[0];
  assert.ok(fn.includes('const manage = isActing() && org.approved;') && fn.includes('${manage ? `<span class="com-rank-edit">'), 'the inputs only for who manages');
  assert.ok(!fn.includes('rank-add') && !fn.includes('candidates'), 'nobody is added by hand');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  for (const key of ['tabRanking', 'rankEmpty', 'rankPlayer', 'rankPoints', 'rankSave', 'rankSaved', 'rankHint', 'rankInvalid']) {
    assert.strictEqual((i18n.match(new RegExp(`'com\\.${key}':`, 'g')) || []).length, 2, `com.${key} in Slovak and English`);
    assert.ok(js.includes(`'com.${key}'`), `com.${key} is used`);
  }
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
