// Checks of "Copy from another city" in Backend > Info: the endpoint that gives an admin the Info texts of another city (GET /api/about/of/:cityId) and the
// browser script that copies them tab by tab with the normal save (PUT /api/about/:tab).
// Run: node scripts/check-about-copy.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'about-copy-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';

function call(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: 'localhost', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie, 'X-Backend': '1' } : {}) };
    const req = http.request({ host: 'localhost', port: PORT, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const as = (method, url, body, cookie = admin) => call(method, url, { body, cookie });
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

const TEXT = { sk: { title: 'O nás', html: '<p>Text <strong>Bratislava</strong></p>' }, en: { title: 'About us', html: '<p>English text</p>' } };
let kosiceId = 0;
let kosiceCookie = '';

test('an admin can read the Info texts of another city; a visitor cannot; an unknown city is a 404', async () => {
  assert.strictEqual((await call('GET', '/api/about/of/1')).status, 401);
  const none = await as('GET', '/api/about/of/1');
  assert.strictEqual(none.status, 200);
  assert.deepStrictEqual(none.json, { city: { id: 1, name: 'Bratislava' }, useDefaults: true, tabs: {} });
  assert.strictEqual((await as('GET', '/api/about/of/99999')).status, 404);
  assert.strictEqual((await as('GET', '/api/about/of/abc')).status, 404);
});

test('what a city has written comes back per tab and language, and another city has its own', async () => {
  assert.strictEqual((await as('PUT', '/api/about/us', TEXT)).status, 200);
  assert.strictEqual((await as('PUT', '/api/about/rules', { sk: { title: 'Pravidlá', html: '<p>p</p>' }, en: { title: '', html: '' } })).status, 200);
  const city = await as('POST', '/api/leagues', { name: 'Kosice' });
  assert.strictEqual(city.status, 201);
  kosiceId = city.json.id;
  const pick = await as('POST', '/api/admin/acting-city', { leagueId: kosiceId });
  assert.strictEqual(pick.status, 200);
  // the backend now works on Kosice (the cookie of the choice goes with the next requests)
  const cookie = `${admin}; ${cookieOf(pick)}`.replace(/^; /, '');
  kosiceCookie = cookie;
  const own = await as('GET', '/api/about', undefined, cookie);
  assert.deepStrictEqual(own.json, { useDefaults: false, tabs: {} });
  const first = await as('GET', '/api/about/of/1', undefined, cookie);
  assert.deepStrictEqual(Object.keys(first.json.tabs).sort(), ['rules', 'us']);
  assert.strictEqual(first.json.tabs.us.sk.title, 'O nás');
  assert.strictEqual(first.json.tabs.us.en.html, '<p>English text</p>');
  assert.strictEqual(first.json.useDefaults, true);
  assert.deepStrictEqual((await as('GET', `/api/about/of/${kosiceId}`, undefined, cookie)).json.tabs, {});
});

test('copying is the normal save into the city that is worked on: its tab is replaced, the other city is not touched', async () => {
  const from = (await as('GET', '/api/about/of/1', undefined, kosiceCookie)).json;
  for (const tab of Object.keys(from.tabs)) assert.strictEqual((await as('PUT', `/api/about/${tab}`, from.tabs[tab], kosiceCookie)).status, 200);
  const k = (await as('GET', '/api/about', undefined, kosiceCookie)).json;
  assert.deepStrictEqual(k.tabs.us, TEXT);
  assert.strictEqual(k.tabs.rules.sk.title, 'Pravidlá');
  assert.deepStrictEqual(Object.keys(k.tabs).sort(), ['rules', 'us']);
  // Bratislava keeps what it had
  assert.deepStrictEqual((await as('GET', '/api/about/of/1', undefined, kosiceCookie)).json.tabs.us, TEXT);
  // a second copy replaces the tab again
  assert.strictEqual((await as('PUT', '/api/about/us', { sk: { title: 'Zmena', html: '<p>z</p>' }, en: { title: '', html: '' } }, kosiceCookie)).status, 200);
  assert.strictEqual((await as('PUT', '/api/about/us', TEXT, kosiceCookie)).status, 200);
  assert.deepStrictEqual((await as('GET', '/api/about', undefined, kosiceCookie)).json.tabs.us, TEXT);
});

test('the Backend > Info script has the copy box and copies tab by tab, skipping tabs the other city has nothing for', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/about-admin.js'), 'utf8');
  assert.ok(js.includes('Copy the texts from another city'));
  assert.ok(js.includes("api(`/about/of/${from.id}`)"));
  assert.ok(js.includes('other.useDefaults ? defaults(tab, lang)'), 'the first city\'s built-in text is copied too');
  assert.ok(/continue;/.test(js), 'an empty tab is skipped');
  assert.ok(js.includes('c.id !== me.acting.id'), 'a city cannot be copied into itself');
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    admin = cookieOf(await call('POST', '/api/admin/login', { body: { password: 'test' } }));
    assert.ok(admin, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 5).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
