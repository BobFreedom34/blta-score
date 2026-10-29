// The walk over every admin route (phase 2, the tournaments of clubs): the admin of a club may use ONLY the per-tournament routes that were opened to him
// (the routes registered with requireSeasonManager, and only for the tournaments of his own club); every other route that asks for an admin or the super
// admin must stay shut for him, for a plain member of his club and for a visitor - with the ids of his own tournament, of another club's tournament and of
// a league season alike.
// The routes are read from the source: server.js (which router is mounted where) and src/routes/*.js (which route is registered with which guard), so a
// route added later is walked too.
// Run: node scripts/check-club-tournaments-permissions.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubperm-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;
let hit = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
  hit += 1;
  const h = { 'X-Forwarded-For': `10.${Math.floor(hit / 60000) % 250}.${Math.floor(hit / 250) % 250}.${hit % 250}` }; // a new address for every call: no rate limit gets in the way
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };
let seq = 0;
const uniq = (p) => `${p} ${(seq += 1)} ${Math.random().toString(36).slice(2, 6)}`;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09080${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}

// ---------- the routes, read from the source ----------

function scanRoutes() {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const required = new Map();
  for (const m of server.matchAll(/const (?:\{\s*router:\s*)?(\w+)(?:\s*\})? = require\('\.\/src\/routes\/(\w+)'\)/g)) required.set(m[1], m[2]);
  const mounts = [];
  for (const m of server.matchAll(/app\.use\('(\/api\/[\w-]+)',\s*(\w+)\)/g)) if (required.has(m[2])) mounts.push({ prefix: m[1], file: required.get(m[2]) });
  const routes = [];
  for (const mount of mounts) {
    const src = fs.readFileSync(path.join(ROOT, 'src/routes', `${mount.file}.js`), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,([^]*?)\(\s*req\s*,/g)) {
      const guard = m[3];
      let kind = 'other';
      if (guard.length > 400) kind = 'unparsed';
      else if (/requireSeasonManager/.test(guard)) kind = 'manager';
      else if (/requireSuperAdmin/.test(guard)) kind = 'admin';
      else if (/requireAdmin|requireCityAdmin/.test(guard)) kind = 'admin';
      routes.push({ ...mount, method: m[1].toUpperCase(), path: m[2].replace(/\(\\\\d\+\)/g, ''), kind });
    }
  }
  return routes;
}

// ---------- worlds: the things a route can be pointed at ----------

// a club tournament with a bracket (and its matches), a group, a registration and a plain match; `club` is false for a league season
async function world(club) {
  const w = {};
  if (club) {
    w.owner = await makePlayer(uniq('Organizator'));
    w.org = (await call('POST', '/api/communities', { cookie: w.owner.cookie, body: { type: 'CLUB', name: uniq('Klub') } })).json;
    assert.ok(w.org && w.org.id, JSON.stringify(w.org));
    assert.strictEqual((await call('PATCH', `/api/communities/${w.org.id}/approval`, { body: { approved: true } })).status, 200);
    withDb((f) => f.prepare("UPDATE organisations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE id = ?").run(w.org.id));
    const made = await call('POST', `/api/communities/${w.org.id}/tournaments`, { cookie: w.owner.cookie, body: { name: uniq('Turnaj'), playType: 'SINGLES', startDate: future(10), endDate: future(11) } });
    assert.strictEqual(made.status, 201, JSON.stringify(made.json));
    w.seasonId = made.json.id;
    w.orgId = w.org.id;
  } else {
    const made = await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE', startDate: future(10), endDate: future(60) } });
    w.seasonId = made.json.id;
    w.orgId = 1;
  }
  const players = [];
  for (const n of ['Alfa', 'Beta', 'Gama', 'Delta']) players.push((await call('POST', '/api/players', { body: { name: uniq(n) } })).json);
  w.playerId = players[0].id;
  const bracket = await call('POST', '/api/brackets', { body: { name: uniq('Pavuk'), format: 'BO3', seasonId: w.seasonId, category: 'ELITE', entries: players.map((p, i) => ({ playerId: p.id, seed: i + 1 })) } });
  assert.strictEqual(bracket.status, 201, JSON.stringify(bracket.json));
  w.bracketId = bracket.json.id;
  w.nodeId = bracket.json.nodes[0].id;
  const match = bracket.json.nodes.map((n) => n.match).find(Boolean);
  w.token = match ? match.token : (await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: players[0].name, player2Name: players[1].name, location: 'Kurt 1' } })).json.token;
  const group = await call('POST', `/api/seasons/${w.seasonId}/groups`, { body: { name: uniq('Skupina'), category: 'NOVICE' } });
  w.groupId = group.json && group.json.id ? group.json.id : 1;
  const reg = await call('POST', `/api/seasons/${w.seasonId}/registrations/admin`, { body: { playerId: players[3].id, category: 'ELITE' } });
  w.rid = reg.json && reg.json.id ? reg.json.id : (withDb((f) => (f.prepare('SELECT id FROM season_registrations WHERE season_id = ? ORDER BY id DESC').get(w.seasonId) || {}).id) || 1);
  return w;
}

// what a :param of a route means, by its name and by the router it is in
function valueOf(name, route, w) {
  if (name === 'token') return w.token;
  if (name === 'groupId') return w.groupId;
  if (name === 'rid') return w.rid;
  if (name === 'nodeId') return w.nodeId;
  if (name === 'playerId' || name === 'memberId') return w.playerId;
  if (name === 'pairId') return 1;
  if (name === 'category') return 'ELITE';
  if (name === 'id') {
    if (route.file === 'seasons') return w.seasonId;
    if (route.file === 'brackets') return w.bracketId;
    if (route.file === 'players' || route.file === 'player') return w.playerId;
    if (route.file === 'communities') return w.orgId;
    return 1;
  }
  return 1;
}
const urlOf = (route, w) => route.prefix + route.path.replace(/:(\w+)/g, (_, name) => String(valueOf(name, route, w))).replace(/\/\/+$/, '/');
// (a new bracket names its season in the body, which is what the guard of that route looks at)
const bodyOf = (route, w) => (route.method === 'GET' || route.method === 'DELETE' ? undefined : (route.file === 'brackets' && route.method === 'POST' && route.path === '/' ? { seasonId: w.seasonId } : {}));
// refused = the answer of a guard that keeps somebody out; anything else means the guard let him in (or something broke)
const refused = (r) => [401, 403, 404].includes(r.status);
const describe = (route, who, w, r) => `${who} ${route.method} ${urlOf(route, w)} -> ${r.status} ${JSON.stringify(r.json || '').slice(0, 80)}`;

let routes = [];
let worldA;
let worldB;
let worldL;
let organiserA;
let member;

// The routes that were opened to the admin of a club, on purpose (tasks 2 and 3 of the plan of phase 2). Opening another route to him means putting it here
// in the same change, so it is a decision somebody read; a route that silently joins or leaves this set fails the test.
const OPENED_TO_CLUB_ADMIN = ['DELETE /api/brackets/:id', 'DELETE /api/brackets/:id/nodes/:nodeId/result', 'DELETE /api/seasons/:id', 'DELETE /api/seasons/:id/doubles/pairs/:pairId',
  'DELETE /api/seasons/:id/draw/:category', 'DELETE /api/seasons/:id/hero', 'DELETE /api/seasons/:id/logo', 'DELETE /api/seasons/groups/:groupId',
  'DELETE /api/seasons/groups/:groupId/members/:playerId', 'DELETE /api/seasons/registrations/:rid', 'GET /api/seasons/:id', 'GET /api/seasons/:id/doubles',
  'GET /api/seasons/:id/draw', 'GET /api/seasons/:id/draw/groups-suggestion', 'GET /api/seasons/:id/registrations', 'GET /api/seasons/:id/registrations.csv',
  'GET /api/seasons/:id/schedule-preview', 'PATCH /api/brackets/:id', 'PATCH /api/brackets/:id/nodes/:nodeId/result', 'PATCH /api/brackets/:id/slots/:nodeId',
  'PATCH /api/seasons/:id', 'PATCH /api/seasons/:id/schedule/settings', 'PATCH /api/seasons/groups/:groupId', 'PATCH /api/seasons/groups/:groupId/members/:playerId',
  'PATCH /api/seasons/registrations/:rid', 'POST /api/brackets/', 'POST /api/brackets/:id/consolation', 'POST /api/seasons/:id/doubles/pairs', 'POST /api/seasons/:id/draw',
  'POST /api/seasons/:id/draw/bracket', 'POST /api/seasons/:id/groups', 'POST /api/seasons/:id/hero', 'POST /api/seasons/:id/logo', 'POST /api/seasons/:id/registrations/admin',
  'POST /api/seasons/:id/registrations/categories', 'POST /api/seasons/:id/registrations/remind', 'POST /api/seasons/:id/schedule', 'POST /api/seasons/:id/schedule/auto',
  'POST /api/seasons/:id/seeds', 'POST /api/seasons/groups/:groupId/members', 'POST /api/seasons/groups/:groupId/members/:playerId/withdraw',
  'POST /api/seasons/groups/:groupId/members/import', 'PUT /api/seasons/:id/schedule/matches/:token'];

test('the scan finds the routes: the guarded ones are numerous, and the routes opened to the club admin are exactly the ones decided on', () => {
  routes = scanRoutes();
  assert.deepStrictEqual(routes.filter((r) => r.kind === 'manager').map((r) => `${r.method} ${r.prefix}${r.path}`).sort(), OPENED_TO_CLUB_ADMIN, 'the set of routes opened to the club admin changed');
  const count = (kind) => routes.filter((r) => r.kind === kind).length;
  assert.ok(routes.length >= 280, `${routes.length} routes found`);
  assert.ok(count('admin') >= 90, `${count('admin')} admin routes found`);
  assert.ok(count('manager') >= 40, `${count('manager')} manager routes found`);
  assert.deepStrictEqual([...new Set(routes.filter((r) => r.kind === 'manager').map((r) => r.file))].sort(), ['brackets', 'seasons']);
  assert.ok(count('unparsed') <= 3, `${count('unparsed')} routes could not be read: ${routes.filter((r) => r.kind === 'unparsed').map((r) => r.prefix + r.path)}`);
  console.log(`      ${routes.length} routes: ${count('admin')} admin, ${count('manager')} manager, ${count('other')} other, ${count('unparsed')} unparsed`);
});

test('set up: club A with its organiser and a plain member, club B, a league season - each with a bracket, a group, a registration and a match', async () => {
  worldA = await world(true);
  worldB = await world(true);
  worldL = await world(false);
  organiserA = worldA.owner;
  member = await makePlayer(uniq('Clen'));
  assert.strictEqual((await call('POST', `/api/communities/${worldA.org.id}/join`, { cookie: member.cookie })).status, 200);
});

test('every route that asks for an admin stays shut for the organiser of a club, a plain member and a visitor - with the ids of his own tournament, of another club and of a league season', async () => {
  const violations = [];
  const adminRoutes = routes.filter((r) => r.kind === 'admin');
  for (const route of adminRoutes) {
    for (const [who, cookie] of [['organiser A', organiserA.cookie], ['member', member.cookie], ['visitor', '']]) {
      for (const w of [worldA, worldB, worldL]) {
        const r = await call(route.method, urlOf(route, w), { cookie, body: bodyOf(route, w) });
        if (!refused(r)) violations.push(describe(route, who, w, r));
      }
    }
  }
  assert.deepStrictEqual(violations, [], `${adminRoutes.length} admin routes walked`);
  console.log(`      ${adminRoutes.length} admin routes x 3 users x 3 worlds`);
});

test('the routes opened to the club admin answer him for the tournament of his own club only; a member, a visitor and the admin of another club never get in', async () => {
  const violations = [];
  const organiserB = worldB.owner;
  const managerRoutes = routes.filter((r) => r.kind === 'manager');
  for (const route of managerRoutes) {
    // the others, with the ids of club A
    for (const [who, cookie] of [['member', member.cookie], ['visitor', ''], ['organiser B', organiserB.cookie]]) {
      const r = await call(route.method, urlOf(route, worldA), { cookie, body: bodyOf(route, worldA) });
      if (!refused(r)) violations.push(describe(route, who, worldA, r));
    }
    // the organiser of A with the ids of club B and of a league season
    for (const w of [worldB, worldL]) {
      const r = await call(route.method, urlOf(route, w), { cookie: organiserA.cookie, body: bodyOf(route, w) });
      if (!refused(r)) violations.push(describe(route, 'organiser A', w, r));
    }
    // and with his own: the guard lets him in (what the route then answers is its own business, but never the answer of a guard)
    const mine = await world(true);
    const r = await call(route.method, urlOf(route, mine), { cookie: mine.owner.cookie, body: bodyOf(route, mine) });
    if ([401, 403, 429].includes(r.status) || r.status >= 500) violations.push(describe(route, 'organiser of his own', mine, r));
  }
  assert.deepStrictEqual(violations, [], `${managerRoutes.length} manager routes walked`);
  console.log(`      ${managerRoutes.length} manager routes x (3 + 2 + 1) calls`);
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
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
