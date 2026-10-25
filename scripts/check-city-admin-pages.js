// Check that a city admin is an admin on the pages of his OWN city only (src/auth.js adminSession, src/routes/admin.js login): the admin of Bratislava
// (blta.sk) is a visitor on slta.sk/kosice and the admin of Kosice is one on blta.sk and on slta.sk/zilina; an account logs in on the address of its
// own city only; an address that belongs to no city (a development host) and the super admin are as before.
// Run: node scripts/check-city-admin-pages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityadminpages-'));
const port = 3100 + Math.floor(Math.random() * 800);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let superCookie = '';
const ids = {};

function as(host, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: 'localhost', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body: text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const BRA = 'blta.localhost'; // the own domain of Bratislava (set below)
const NAT = 'slta.localhost'; // the national site: slta.localhost/<city>
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const session = async (host, prefix, cookie) => (await as(host, `${prefix}/api/admin/session`, { headers: cookie ? { Cookie: cookie } : {} })).json;
const login = (host, prefix, email, password) => as(host, `${prefix}/api/admin/login`, { method: 'POST', body: { email, password } });

test('setup: Bratislava gets its own domain, two more cities are made, each with an admin', async () => {
  assert.strictEqual((await as('localhost', '/api/leagues/1', { method: 'PATCH', body: { domain: BRA }, headers: { Cookie: superCookie } })).status, 200);
  for (const name of ['Kosice', 'Zilina']) {
    const c = await as('localhost', '/api/leagues', { method: 'POST', body: { name }, headers: { Cookie: superCookie } });
    assert.strictEqual(c.status, 201);
    ids[name] = c.json.id;
    assert.strictEqual((await as('localhost', `/api/leagues/${c.json.id}`, { method: 'PATCH', body: { status: 'ACTIVE' }, headers: { Cookie: superCookie } })).status, 200);
  }
  const mk = (name, email, leagueId) => as('localhost', '/api/city-admins', { method: 'POST', body: { name, email, leagueId, password: 'long-enough-1' }, headers: { Cookie: superCookie } });
  assert.strictEqual((await mk('Bra Admin', 'bra@example.com', 1)).status, 201);
  assert.strictEqual((await mk('Kos Admin', 'kos@example.com', ids.Kosice)).status, 201);
});

let braCookie = '';
let kosCookie = '';
test('an account logs in on the address of its own city', async () => {
  const bra = await login(BRA, '', 'bra@example.com', 'long-enough-1');
  assert.strictEqual(bra.status, 200, bra.body);
  braCookie = cookieOf(bra);
  const kos = await login(NAT, '/kosice', 'kos@example.com', 'long-enough-1');
  assert.strictEqual(kos.status, 200, kos.body);
  kosCookie = cookieOf(kos);
});

test('an account is refused on the address of another city, and no cookie is given', async () => {
  const onKosice = await login(NAT, '/kosice', 'bra@example.com', 'long-enough-1');
  assert.strictEqual(onKosice.status, 403);
  assert.ok(/Bratislava|runs/.test(onKosice.json.error), onKosice.body);
  assert.strictEqual(cookieOf(onKosice), '');
  assert.strictEqual((await login(BRA, '', 'kos@example.com', 'long-enough-1')).status, 403, 'the admin of Kosice on blta.sk');
  assert.strictEqual((await login(NAT, '/zilina', 'kos@example.com', 'long-enough-1')).status, 403, 'and on another city under slta.sk');
  assert.strictEqual((await login(NAT, '/kosice', 'bra@example.com', 'wrong-wrong')).status, 401, 'a wrong password is still just wrong');
});

test('the cookie of a city admin counts as admin on his own city only: on another city he is a visitor', async () => {
  assert.strictEqual((await session(BRA, '', braCookie)).isAdmin, true, 'Bratislava admin on blta.sk');
  assert.strictEqual((await session(NAT, '/kosice', braCookie)).isAdmin, false, 'Bratislava admin on slta.sk/kosice');
  assert.strictEqual((await session(NAT, '/zilina', braCookie)).isAdmin, false, 'on slta.sk/zilina');
  assert.strictEqual((await session(NAT, '/kosice', kosCookie)).isAdmin, true, 'Kosice admin on slta.sk/kosice');
  assert.strictEqual((await session(BRA, '', kosCookie)).isAdmin, false, 'Kosice admin on blta.sk');
  assert.strictEqual((await session(NAT, '/zilina', kosCookie)).isAdmin, false, 'Kosice admin on slta.sk/zilina');
  // what needs an admin is refused there as for any visitor
  assert.strictEqual((await as(NAT, '/kosice/api/venues', { method: 'POST', body: { name: 'Mine' }, headers: { Cookie: braCookie, 'X-Backend': '1' } })).status, 401);
  assert.strictEqual((await as(NAT, '/kosice/api/venues', { method: 'POST', body: { name: 'Kosice Court' }, headers: { Cookie: kosCookie, 'X-Backend': '1' } })).status, 201);
});

test('the super admin works on every city, and a development host (no city) leaves a city admin as he was', async () => {
  for (const [host, prefix] of [[BRA, ''], [NAT, '/kosice'], [NAT, '/zilina']]) assert.strictEqual((await session(host, prefix, superCookie)).role, 'SUPER', `${host}${prefix}`);
  assert.strictEqual((await session('localhost', '', braCookie)).isAdmin, true, 'a development host belongs to no city');
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
    const lg = await as('localhost', '/api/admin/login', { method: 'POST', body: { password: 'test' } });
    superCookie = cookieOf(lg);
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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
