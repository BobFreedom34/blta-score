// Checks of the cities (leagues) of SLTA: Bratislava (BLTA) is the first one and owns everything that existed before; the public list for the
// city picker (hidden cities left out); creating, changing and deleting a city (admin only, valid and unique address and domain, the addresses
// the app itself uses are taken); the city of a request by its own domain.
// Run: node scripts/check-leagues.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leagues-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// a request with another Host header (fetch will not send one)
function callAs(host, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port, path: url, headers: { Host: host } }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    }).on('error', reject);
  });
}

let kosice = null;

test('Bratislava is the first city and owns what existed before', async () => {
  const list = (await call('GET', '/api/leagues', undefined, { admin: false })).json;
  const ba = list.find((l) => l.slug === 'bratislava');
  assert.ok(ba, 'Bratislava is on the list');
  assert.strictEqual(ba.id, 1);
  assert.strictEqual(ba.brandName, 'BLTA');
  assert.strictEqual(ba.status, 'ACTIVE');
  const seasons = (await call('GET', '/api/seasons', undefined, { admin: false })).json;
  assert.strictEqual(ba.seasons, seasons.length, 'every season belongs to Bratislava');
  assert.ok(ba.seasons > 0);
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  for (const table of ['seasons', 'venues', 'players', 'matches', 'header_items', 'winner_editions', 'carousel_slides']) {
    const other = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE league_id != 1`).get().n;
    assert.strictEqual(other, 0, `${table}: nothing outside Bratislava`);
  }
  db.close();
});

test('only the admin creates a city, and the data is checked', async () => {
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Košice' }, { admin: false })).status, 401);
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'K' })).status, 400, 'too short');
  const reserved = await call('POST', '/api/leagues', { name: 'Players', slug: 'players' });
  assert.strictEqual(reserved.status, 400, 'an address the app uses');
  assert.ok(/used by the app/.test(reserved.json.error));
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Admin', slug: 'cities-admin' })).status, 400, '-admin addresses are the backend');
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Bratislava' })).status, 400, 'the address bratislava is taken');
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Test', domain: 'not a domain' })).status, 400);
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Test', domain: 'blta.sk' })).status, 400, 'the domain belongs to Bratislava');
  assert.strictEqual((await call('POST', '/api/leagues', { name: 'Test', status: 'WILD' })).status, 400);
});

test('a new city: the address and the brand come from the name, it starts hidden', async () => {
  const r = await call('POST', '/api/leagues', { name: 'Košice', lat: 48.7164, lng: 21.2611 });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  kosice = r.json;
  assert.strictEqual(kosice.slug, 'kosice');
  assert.strictEqual(kosice.brandName, 'SLTA Košice');
  assert.strictEqual(kosice.status, 'HIDDEN');
  assert.strictEqual(kosice.players, 0);
  const publicList = (await call('GET', '/api/leagues', undefined, { admin: false })).json;
  assert.ok(!publicList.some((l) => l.slug === 'kosice'), 'hidden: not on the picker');
  assert.strictEqual((await call('GET', '/api/leagues/kosice', undefined, { admin: false })).status, 404);
  assert.strictEqual((await call('GET', '/api/leagues/kosice')).status, 200, 'the admin sees it');
  assert.ok((await call('GET', '/api/leagues/all')).json.some((l) => l.slug === 'kosice'));
  assert.strictEqual((await call('GET', '/api/leagues/all', undefined, { admin: false })).status, 401);
});

test('changing a city: it appears on the picker, after Bratislava; the address stays unique', async () => {
  const r = await call('PATCH', `/api/leagues/${kosice.id}`, { status: 'COMING_SOON', brandName: 'SLTA Košice' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const list = (await call('GET', '/api/leagues', undefined, { admin: false })).json;
  assert.deepStrictEqual(list.map((l) => l.slug), ['bratislava', 'kosice']);
  assert.strictEqual((await call('PATCH', `/api/leagues/${kosice.id}`, { slug: 'bratislava' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/leagues/${kosice.id}`, {})).status, 400, 'nothing to update');
  assert.strictEqual((await call('PATCH', '/api/leagues/1', { status: 'HIDDEN' })).status, 400, 'the first city stays visible');
  assert.strictEqual((await call('PATCH', '/api/leagues/999', { name: 'Nowhere' })).status, 404);
});

test('the own domain of a city: the request is that city, any other host is Bratislava', async () => {
  assert.strictEqual((await call('PATCH', `/api/leagues/${kosice.id}`, { domain: 'https://www.Kosice-Liga.sk/' })).json.domain, 'kosice-liga.sk', 'normalised');
  assert.strictEqual((await callAs('kosice-liga.sk', '/api/leagues/current')).json.slug, 'kosice');
  assert.strictEqual((await callAs('www.kosice-liga.sk:443', '/api/leagues/current')).json.slug, 'kosice');
  assert.strictEqual((await callAs('blta.sk', '/api/leagues/current')).json.slug, 'bratislava');
  assert.strictEqual((await callAs('localhost', '/api/leagues/current')).json.slug, 'bratislava', 'unknown host');
  assert.strictEqual((await call('PATCH', `/api/leagues/${kosice.id}`, { domain: '' })).json.domain, '');
  assert.strictEqual((await callAs('kosice-liga.sk', '/api/leagues/current')).json.slug, 'bratislava', 'the domain was taken away');
});

test('deleting: never the first city, never a city that owns data', async () => {
  assert.strictEqual((await call('DELETE', '/api/leagues/1')).status, 400);
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const venue = db.prepare('SELECT id FROM venues LIMIT 1').get();
  assert.ok(venue, 'a venue to give to Košice');
  db.prepare('UPDATE venues SET league_id = ? WHERE id = ?').run(kosice.id, venue.id);
  const blocked = await call('DELETE', `/api/leagues/${kosice.id}`);
  assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.json));
  db.prepare('UPDATE venues SET league_id = 1 WHERE id = ?').run(venue.id);
  db.close();
  assert.strictEqual((await call('DELETE', `/api/leagues/${kosice.id}`, undefined, { admin: false })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/leagues/${kosice.id}`)).status, 200);
  assert.strictEqual((await call('GET', '/api/leagues/kosice')).status, 404);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'admin login gave no cookie');
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
