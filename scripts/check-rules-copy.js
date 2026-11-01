// Checks of "Copy the rules from another city" in Backend > Rules (POST /api/rules/copy): the sections of another city replace those of the city that is worked
// on, in the same order, with addresses of their own; the other city is not touched; nothing is changed when the copy is refused.
// Run: node scripts/check-rules-copy.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-copy-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';
let kosiceCookie = '';
let kosiceId = 0;
let emptyId = 0;

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
let first = [];

test('Bratislava has the rules that came with the site; the new city has none', async () => {
  first = (await as('GET', '/api/rules')).json;
  assert.ok(first.length >= 3, `sections: ${first.length}`);
  const city = await as('POST', '/api/leagues', { name: 'Kosice' });
  assert.strictEqual(city.status, 201);
  kosiceId = city.json.id;
  const pick = await as('POST', '/api/admin/acting-city', { leagueId: kosiceId });
  kosiceCookie = `${admin}; ${cookieOf(pick)}`;
  assert.deepStrictEqual((await as('GET', '/api/rules', undefined, kosiceCookie)).json, []);
});

test('copying: the sections come over in the same order, with their own addresses; Bratislava is not touched', async () => {
  const r = await as('POST', '/api/rules/copy', { fromCityId: 1 }, kosiceCookie);
  assert.strictEqual(r.status, 200);
  const copy = r.json;
  assert.deepStrictEqual(copy.map((s) => s.title), first.map((s) => s.title));
  assert.deepStrictEqual(copy.map((s) => s.navLabel), first.map((s) => s.navLabel));
  assert.deepStrictEqual(copy.map((s) => s.html), first.map((s) => s.html));
  const own = new Set(copy.map((s) => s.slug));
  assert.strictEqual(own.size, copy.length, 'the addresses are unique');
  first.forEach((s) => assert.ok(!own.has(s.slug), `${s.slug} is used by both cities`));
  assert.deepStrictEqual((await as('GET', '/api/rules', undefined, kosiceCookie)).json.map((s) => s.title), first.map((s) => s.title));
  // Bratislava keeps its own
  assert.deepStrictEqual((await as('GET', '/api/rules/', undefined, admin)).json.map((s) => s.slug).sort(), first.map((s) => s.slug).sort());
});

test('a second copy replaces what the city has (no doubling), and the city page shows the copied rules', async () => {
  const edited = (await as('GET', '/api/rules', undefined, kosiceCookie)).json[0];
  assert.strictEqual((await as('PUT', `/api/rules/${edited.id}`, { title: 'Moja zmena', navLabel: 'x', html: '<p>zmena</p>' }, kosiceCookie)).status, 200);
  const again = await as('POST', '/api/rules/copy', { fromCityId: 1 }, kosiceCookie);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.length, first.length, 'replaced, not added');
  assert.ok(!again.json.some((s) => s.title === 'Moja zmena'));
  assert.strictEqual((await as('GET', `/api/rules`, undefined, kosiceCookie)).json.length, first.length);
  // the public page of the city carries the first section
  const page = await call('GET', '/propozicie', { cookie: undefined });
  assert.strictEqual(page.status, 200);
});

test('refused copies change nothing: from itself, from an unknown city, from a city without rules, from a visitor', async () => {
  const before = (await as('GET', '/api/rules', undefined, kosiceCookie)).json.map((s) => s.id);
  assert.strictEqual((await as('POST', '/api/rules/copy', { fromCityId: kosiceId }, kosiceCookie)).status, 400);
  assert.strictEqual((await as('POST', '/api/rules/copy', { fromCityId: 99999 }, kosiceCookie)).status, 404);
  assert.strictEqual((await as('POST', '/api/rules/copy', {}, kosiceCookie)).status, 404);
  const empty = await as('POST', '/api/leagues', { name: 'Prazdne' });
  emptyId = empty.json.id;
  const refused = await as('POST', '/api/rules/copy', { fromCityId: emptyId }, kosiceCookie);
  assert.strictEqual(refused.status, 400);
  assert.ok(/no rules to copy/.test(refused.json.error));
  assert.strictEqual((await call('POST', '/api/rules/copy', { body: { fromCityId: 1 } })).status, 401);
  assert.deepStrictEqual((await as('GET', '/api/rules', undefined, kosiceCookie)).json.map((s) => s.id), before);
});

test('the Backend > Rules script has the copy box and asks before it replaces what the city has', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/rules-admin.js'), 'utf8');
  assert.ok(js.includes('Copy the rules from another city'));
  assert.ok(js.includes("api('/rules/copy'"));
  assert.ok(js.includes('window.confirm(ask)') && js.includes('What is here now is lost'));
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
