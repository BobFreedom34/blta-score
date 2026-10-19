// Checks of the public pages of a city under the national address (slta.sk/<slug>/..., see server.js "The whole site of a city" and
// public/js/localize.js): the same site as blta.sk with the city's own data. The prefix is taken off the address, the page learns it
// (window.CITY_BASE) and the brand of the city, the lists of the page (/api/...) show the city's own seasons, players and venues, a hidden city
// is for its admins only, a city with a domain of its own is sent there, the password lock covers the cities and remembers where you wanted to go.
// Run: node scripts/check-city-pages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citypages-'));
const port = 3100 + Math.floor(Math.random() * 800);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let superCookie = '';
let cityId = 0;

// a request with the Host header of the site it is meant for (fetch will not send one)
function as(host, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: 'localhost', port, path: url, method, headers: { Host: host, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const JSONH = { 'Content-Type': 'application/json' };
const local = (m, u, b, cookie) => as('localhost', u, { method: m, body: b, headers: { ...JSONH, ...(cookie ? { Cookie: cookie } : {}) } });
const nat = (u, cookie, method = 'GET', body) => as('slta.localhost', u, { method, body, headers: { ...JSONH, ...(cookie ? { Cookie: cookie } : {}) } });
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

test('a city with data: the super admin makes it and fills it in (and it starts hidden)', async () => {
  const city = await local('POST', '/api/leagues', { name: 'Kosice' }, superCookie);
  assert.strictEqual(city.status, 201);
  cityId = city.json.id;
  assert.strictEqual(city.json.status, 'HIDDEN');
  const pick = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  const cookie = `${superCookie}; ${cookieOf(pick)}`;
  assert.strictEqual((await local('POST', '/api/seasons', { name: 'Kosice Jar 2027', startDate: '2027-03-01', endDate: '2027-06-30' }, cookie)).status, 201);
  assert.strictEqual((await local('POST', '/api/venues', { name: 'Kosice Court' }, cookie)).status, 201);
  assert.strictEqual((await local('POST', '/api/players', { name: 'Peter Kosicky' }, cookie)).status, 201);
  // and the first city has its own
  assert.strictEqual((await local('POST', '/api/seasons', { name: 'Bratislava Jar 2027', startDate: '2027-03-01', endDate: '2027-06-30' }, superCookie)).status, 201);
  assert.strictEqual((await local('POST', '/api/players', { name: 'Bratislava Hrac' }, superCookie)).status, 201);
});

test('a hidden city is not shown to visitors, only to its admin', async () => {
  const visitor = await nat('/kosice');
  assert.strictEqual(visitor.status, 404);
  assert.strictEqual((await nat('/kosice/api/seasons')).status, 404);
  assert.strictEqual((await nat('/kosice/css/style.css')).status, 200, 'the files of a page are always there');
  const admin = await nat('/kosice', superCookie);
  assert.strictEqual(admin.status, 200, 'the admin prepares it');
  const set = await local('PATCH', `/api/leagues/${cityId}`, { status: 'ACTIVE' }, superCookie);
  assert.strictEqual(set.status, 200);
  assert.strictEqual((await nat('/kosice')).status, 200, 'visible once it is active');
});

test('the home page of a city: the site with its prefix, brand and address', async () => {
  const r = await nat('/kosice');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes('window.CITY_BASE="/kosice"'), 'the page learns its prefix');
  assert.ok(r.body.includes('"brand":"SLTA Kosice"'), 'and the brand of the city');
  assert.ok(/<title>[^<]*SLTA Kosice[^<]*<\/title>/.test(r.body) && !/<title>[^<]*BLTA/.test(r.body), 'the title carries the brand of the city');
  assert.ok(/rel="canonical" href="http:\/\/slta\.localhost(:\d+)?\/kosice\/?"/.test(r.body), 'the canonical address has the prefix');
  assert.ok(r.body.includes('/js/localize.js'), 'it is the real home page of the site');
  const trailing = await nat('/kosice/');
  assert.strictEqual(trailing.status, 200);
  const blta = await local('GET', '/');
  assert.ok(!blta.body.includes('CITY_BASE'), 'blta.sk is untouched');
});

test('the pages of a city: a page with an address of its own, a backend page, the files, the script of the addresses', async () => {
  const rankings = await nat('/kosice/rankings');
  assert.strictEqual(rankings.status, 200);
  assert.ok(rankings.body.includes('window.CITY_BASE="/kosice"'));
  assert.ok(/rel="canonical" href="http:\/\/slta\.localhost(:\d+)?\/kosice\/rankings"/.test(rankings.body), 'canonical: ' + (rankings.body.match(/<link rel="canonical"[^>]*>/) || ['none'])[0]);
  const english = await nat('/kosice/en/rankings');
  assert.strictEqual(english.status, 200, 'the English address works under the prefix');
  assert.strictEqual((await nat('/kosice/admin')).status, 200, 'the backend page too');
  assert.ok((await nat('/kosice/admin')).body.includes('window.CITY_BASE="/kosice"'));
  assert.strictEqual((await nat('/kosice/css/style.css')).status, 200);
  assert.strictEqual((await nat('/kosice/js/localize.js')).headers['content-type'].includes('javascript'), true);
  assert.ok((await nat('/kosice/js/localize.js')).body.includes('BLTA_LOCALIZE.boot('), 'the generated one, not the raw source');
  assert.strictEqual((await nat('/kosice/nonsense-page')).status, 404);
  assert.strictEqual((await nat('/kosice/?x=1')).status, 302, 'a query on the home page goes to the list of matches');
  assert.ok(/^\/kosice\/(zapasy|matches)[^/]*\?x=1$/.test((await nat('/kosice/?x=1')).headers.location), 'and keeps the prefix');
});

test('the lists of a city show its own data and the first city shows its own', async () => {
  const seasons = await nat('/kosice/api/seasons');
  assert.deepStrictEqual(seasons.json.map((s) => s.name), ['Kosice Jar 2027']);
  assert.deepStrictEqual((await nat('/kosice/api/players')).json.map((p) => p.name), ['Peter Kosicky']);
  assert.deepStrictEqual((await nat('/kosice/api/venues')).json.map((v) => v.name), ['Kosice Court']);
  assert.strictEqual((await nat('/kosice/api/leagues/current')).json.slug, 'kosice', 'the city of the page');
  assert.deepStrictEqual((await nat('/kosice/api/matches')).json, []);
  assert.deepStrictEqual((await nat('/kosice/api/carousel')).json, [], 'no pictures copied from another city');
  assert.deepStrictEqual((await nat('/kosice/api/header-items')).json, [], 'and its own menu');
  const ranks = await nat('/kosice/api/rankings');
  assert.strictEqual(ranks.status, 200);
  ranks.json.tables.forEach((t) => assert.ok(!t.rows.some((r) => r.name === 'Bratislava Hrac'), 'the rankings of a city show its own players'));
  assert.strictEqual((await nat('/kosice/api/highlights/month')).status, 200);
  assert.strictEqual((await nat('/kosice/api/match-of-the-week')).status, 200);
  assert.strictEqual((await nat('/kosice/api/availability')).status, 200);
  const first = await local('GET', '/api/seasons');
  assert.ok(first.json.some((s) => s.name === 'Bratislava Jar 2027') && !first.json.some((s) => s.name === 'Kosice Jar 2027'), 'Bratislava is separate');
});

test('the admin of the city works on the national address too', async () => {
  const made = await local('POST', '/api/city-admins', { name: 'Martin K', email: 'martin@example.com', leagueId: cityId, password: 'long-enough-1' }, superCookie);
  assert.strictEqual(made.status, 201);
  const login = await nat('/kosice/api/admin/login', '', 'POST', { email: 'martin@example.com', password: 'long-enough-1' });
  assert.strictEqual(login.status, 200);
  const cookie = cookieOf(login);
  const session = await nat('/kosice/api/admin/session', cookie);
  assert.strictEqual(session.json.role, 'CITY');
  assert.strictEqual(session.json.acting.slug, 'kosice');
  const season = await nat('/kosice/api/seasons', cookie, 'POST', { name: 'Kosice Leto 2027', startDate: '2027-07-01', endDate: '2027-09-30' });
  assert.strictEqual(season.status, 201);
  assert.ok((await nat('/kosice/api/seasons')).json.some((s) => s.name === 'Kosice Leto 2027'));
  assert.ok(!(await local('GET', '/api/seasons')).json.some((s) => s.name === 'Kosice Leto 2027'));
});

test('a city with a domain of its own is sent there; other addresses of the national site are as before', async () => {
  const moved = await nat('/bratislava/rebricek');
  assert.strictEqual(moved.status, 302);
  assert.strictEqual(moved.headers.location, 'https://blta.sk/rebricek');
  assert.strictEqual((await nat('/matches')).status, 302, 'not a city: on to blta.sk');
  assert.strictEqual((await nat('/')).status, 200, 'the national page');
  assert.ok((await nat('/')).body.includes('id="mesta"'));
});

test('the password lock covers the cities and sends the visitor back to where he wanted to go', async () => {
  assert.strictEqual((await local('PUT', '/api/leagues/national-lock', { enabled: true, password: 'sesame1' }, superCookie)).status, 200);
  const page = await nat('/kosice/rankings');
  assert.strictEqual(page.status, 401);
  assert.ok(page.body.includes('name="password"') && page.body.includes('value="/kosice/rankings"'), 'the password page remembers the address');
  assert.strictEqual((await nat('/kosice/api/seasons')).status, 401);
  assert.strictEqual((await nat('/kosice/css/style.css')).status, 200);
  const wrong = await as('slta.localhost', '/unlock', { method: 'POST', body: 'password=nope&lang=sk&next=%2Fkosice%2Frankings', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(wrong.status, 401);
  const right = await as('slta.localhost', '/unlock', { method: 'POST', body: 'password=sesame1&lang=sk&next=%2Fkosice%2Frankings', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(right.status, 302);
  assert.strictEqual(right.headers.location, '/kosice/rankings');
  const open = await nat('/kosice/rankings', cookieOf(right));
  assert.strictEqual(open.status, 200);
  const evil = await as('slta.localhost', '/unlock', { method: 'POST', body: 'password=sesame1&lang=sk&next=%2F%2Fevil.example', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(evil.headers.location, '/', 'never to another site');
  assert.strictEqual((await local('PUT', '/api/leagues/national-lock', { enabled: false }, superCookie)).status, 200);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await local('POST', '/api/admin/login', { password: 'test' });
    superCookie = cookieOf(login);
    assert.ok(superCookie, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
