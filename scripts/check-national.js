// Checks of the national site slta.sk (src/national.js): on its host the app serves the national page (the picker of the cities, in Slovak and
// English, with slta.sk as its address and its own sitemap), the files the page needs and the public list of the cities; any other page address
// goes on to blta.sk and anything else is not found. The other hosts (blta.sk) never serve the national page and do not list it.
// Run: node scripts/check-national.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'national-'));
const port = 3100 + Math.floor(Math.random() * 800);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;

// a request with the Host header of the site it is meant for (fetch will not send one)
function as(host, url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, path: url, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('slta.sk: the main page is the national page, with slta.sk as its address', async () => {
  const r = await as('slta.sk', '/');
  assert.strictEqual(r.status, 200);
  assert.ok(/<title>SLTA - Slovenská liga tenisových amatérov<\/title>/.test(r.body), 'its own title');
  assert.ok(r.body.includes('<link rel="canonical" href="https://slta.sk/">'), 'canonical');
  assert.ok(r.body.includes('<meta property="og:site_name" content="SLTA">'), 'site name');
  assert.ok(r.body.includes('hreflang="en" href="https://slta.sk/en"'), 'English alternate');
  assert.ok(r.body.includes('id="mesta"'), 'the picker is on the page');
  assert.ok(!r.body.includes('BLTA - Živé skóre'), 'not the home page of blta.sk');
});

test('slta.sk: the English page, and www.slta.sk is the same site', async () => {
  const en = await as('slta.sk', '/en');
  assert.strictEqual(en.status, 200);
  assert.ok(/<html lang="en"/.test(en.body), 'English');
  assert.ok(/<title>SLTA - Slovak Amateur Tennis League<\/title>/.test(en.body), 'English title');
  assert.ok(en.body.includes('<link rel="canonical" href="https://slta.sk/en">'));
  const www = await as('www.slta.sk', '/');
  assert.strictEqual(www.status, 200);
  assert.ok(www.body.includes('<link rel="canonical" href="https://slta.sk/">'), 'www has the address without www');
});

test('slta.sk: the files of the page and the public list of the cities are served', async () => {
  assert.strictEqual((await as('slta.sk', '/css/style.css')).status, 200);
  assert.strictEqual((await as('slta.sk', '/favicon-64.png')).status, 200);
  const list = await as('slta.sk', '/api/leagues');
  assert.strictEqual(list.status, 200);
  const cities = JSON.parse(list.body);
  assert.strictEqual(cities[0].slug, 'bratislava');
  assert.strictEqual(cities[0].url, 'https://blta.sk', 'a city with its own domain says it');
  assert.strictEqual((await as('slta.sk', '/api/leagues/bratislava')).status, 200);
});

test('slta.sk: any other page goes on to blta.sk, anything else is not found', async () => {
  const page = await as('slta.sk', '/matches?x=1');
  assert.strictEqual(page.status, 302);
  assert.strictEqual(page.headers.location, 'https://blta.sk/matches?x=1');
  assert.strictEqual((await as('slta.sk', '/season/winter-opening-series-2026')).headers.location, 'https://blta.sk/season/winter-opening-series-2026');
  assert.strictEqual((await as('slta.sk', '/slta.html')).status, 302, 'the file of the page is not a page of its own');
  assert.strictEqual((await as('slta.sk', '/api/matches')).status, 404, 'the rest of the API is not served here');
  assert.strictEqual((await as('slta.sk', '/api/admin/login', { method: 'POST' })).status, 404);
  assert.strictEqual((await as('slta.sk', '/api/leagues/all')).status, 401, 'the admin list stays for the admin');
});

test('slta.sk: its own sitemap and robots.txt', async () => {
  const sm = await as('slta.sk', '/sitemap.xml');
  assert.strictEqual(sm.status, 200);
  assert.ok(sm.body.includes('<loc>https://slta.sk/</loc>') && sm.body.includes('<loc>https://slta.sk/en</loc>'), 'both languages of the main page');
  assert.ok(!sm.body.includes('/season/') && !sm.body.includes('/players'), 'nothing of blta.sk');
  const robots = await as('slta.sk', '/robots.txt');
  assert.ok(robots.body.includes('Sitemap: https://slta.sk/sitemap.xml'));
});

test('blta.sk: its home page is unchanged, the national page is not served and not listed', async () => {
  const home = await as('blta.sk', '/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('<title>BLTA - '), 'the home page of BLTA');
  for (const p of ['/slta', '/slta.html', '/en/slta']) assert.strictEqual((await as('blta.sk', p)).status, 404, `${p} is not a page of blta.sk`);
  const sm = (await as('blta.sk', '/sitemap.xml')).body;
  assert.ok(!sm.includes('/slta'), 'the national page is not in the sitemap of blta.sk');
  assert.ok(sm.includes('/players') || sm.includes('/rankings') || sm.includes('/rebricek'), 'the sitemap of blta.sk is the usual one');
  assert.strictEqual((await as('localhost', '/slta')).status, 404);
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
