// Checks of the questions and answers of the national page (src/faq.js, src/routes/faq.js, Backend > Q&A): the questions that came with the page,
// public reading, the super admin adding / changing / re-ordering / removing, the checks of what is written, and a city admin kept out.
// Run: node scripts/check-faq.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { cookie = adminCookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const item = (n) => ({ q_sk: `Otázka ${n}?`, a_sk: `Odpoveď ${n}.\nDruhý riadok.`, q_en: `Question ${n}?`, a_en: `Answer ${n}.` });

test('the questions that came with the page are there, in order, for everybody', async () => {
  const r = await call('GET', '/api/faq', { cookie: '' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.items.length, 9);
  assert.strictEqual(r.json.items[0].q_sk, 'Čo je SLTA?');
  assert.strictEqual(r.json.items[0].q_en, 'What is SLTA?');
  assert.ok(r.json.items.every((i) => i.a_sk && i.a_en));
});

test('the super admin adds a question (at the end), changes it and removes it', async () => {
  const add = await call('POST', '/api/faq', { body: item(10) });
  assert.strictEqual(add.status, 201, JSON.stringify(add.json));
  assert.strictEqual(add.json.items.length, 10);
  assert.strictEqual(add.json.items[9].id, add.json.id);
  assert.strictEqual(add.json.items[9].a_sk, 'Odpoveď 10.\nDruhý riadok.', 'line breaks stay');
  const put = await call('PUT', `/api/faq/${add.json.id}`, { body: { ...item(10), q_sk: '  Nová   otázka?  ', a_en: '' } });
  assert.strictEqual(put.status, 200);
  const changed = put.json.items.find((i) => i.id === add.json.id);
  assert.strictEqual(changed.q_sk, 'Nová otázka?', 'spaces are tidied');
  assert.strictEqual(changed.a_en, '', 'the English answer may stay empty');
  assert.strictEqual((await call('DELETE', `/api/faq/${add.json.id}`)).json.items.length, 9);
  assert.strictEqual((await call('DELETE', `/api/faq/${add.json.id}`)).status, 404);
  assert.strictEqual((await call('PUT', `/api/faq/${add.json.id}`, { body: item(1) })).status, 404);
});

test('the Slovak question and answer are needed, and the texts are not too long', async () => {
  assert.strictEqual((await call('POST', '/api/faq', { body: { ...item(1), q_sk: ' ' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/faq', { body: { ...item(1), a_sk: '' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/faq', { body: { ...item(1), a_en: 'x'.repeat(3001) } })).status, 400);
  assert.strictEqual((await call('GET', '/api/faq')).json.items.length, 9, 'nothing was added');
});

test('re-ordering: the order given is the order shown; unknown and repeated ids are ignored; the ones left out go last', async () => {
  const ids = (await call('GET', '/api/faq')).json.items.map((i) => i.id);
  const wanted = [ids[2], ids[0], 9999, ids[2], ids[1]];
  const r = await call('PUT', '/api/faq/order', { body: { ids: wanted } });
  assert.deepStrictEqual(r.json.items.slice(0, 3).map((i) => i.id), [ids[2], ids[0], ids[1]]);
  assert.strictEqual(r.json.items.length, 9);
  assert.deepStrictEqual((await call('GET', '/api/faq', { cookie: '' })).json.items.map((i) => i.id), r.json.items.map((i) => i.id), 'the same for everybody');
});

test('only the super admin writes; a visitor and a city admin are refused', async () => {
  const id = (await call('GET', '/api/faq')).json.items[0].id;
  for (const [method, url, body] of [['POST', '/api/faq', item(1)], ['PUT', `/api/faq/${id}`, item(1)], ['PUT', '/api/faq/order', { ids: [id] }], ['DELETE', `/api/faq/${id}`]]) {
    assert.strictEqual((await call(method, url, { cookie: '', body })).status, 401, `${method} ${url} without a login`);
  }
  const city = await call('POST', '/api/leagues', { body: { name: 'Kosice' } });
  await call('POST', '/api/city-admins', { body: { name: 'Martin K', email: 'martin@example.com', leagueId: city.json.id, password: 'long-enough-1' } });
  const login = await call('POST', '/api/admin/login', { cookie: '', body: { email: 'martin@example.com', password: 'long-enough-1' } });
  const cityCookie = cookieOf(login);
  assert.ok(cityCookie, 'the city admin could not log in');
  for (const [method, url, body] of [['POST', '/api/faq', item(1)], ['PUT', `/api/faq/${id}`, item(1)], ['PUT', '/api/faq/order', { ids: [id] }], ['DELETE', `/api/faq/${id}`]]) {
    const r = await call(method, url, { cookie: cityCookie, body, headers: { 'X-Backend': '1' } });
    assert.ok(r.status === 403, `${method} ${url} by a city admin gave ${r.status}`);
  }
  assert.strictEqual((await call('GET', '/api/faq')).json.items.length, 9, 'nothing changed');
});

test('the backend page is there and kept out of search engines', async () => {
  const page = await fetch(`${base}/faq-admin`);
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('faq-admin-root'));
  assert.ok((await (await fetch(`${base}/robots.txt`)).text()).includes('Disallow: /faq-admin'));
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
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
    assert.ok(adminCookie, 'the admin login gave no cookie');
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
