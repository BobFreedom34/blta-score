// Checks of Backend > Tracking: the Google Tag Manager container of blta.sk and of slta.sk — who may set it, the validation, where the tag goes (every public
// page of the right website, not the backend or the embeds), the consent defaults and the banner script.
// Run: node scripts/check-tracking.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';

// a request with the Host header of the website it is meant for (fetch will not send one)
function as(host, url, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: host, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    const req = http.request({ host: 'localhost', port: PORT, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, body: text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const blta = (url, opts) => as('localhost', url, opts);
const slta = (url, opts) => as('slta.localhost', url, opts);
const hasTag = (html, id) => html.includes(`'dataLayer','${id}')`);
const put = (site, body, cookie = admin) => blta(`/api/tracking/${site}`, { method: 'PUT', body, cookie });

test('without a container nothing is added to any page', async () => {
  for (const r of [await blta('/'), await blta('/matches'), await slta('/')]) {
    assert.strictEqual(r.status, 200);
    assert.ok(!/<!-- Google Tag Manager -->|consent\.js/.test(r.body), 'a tag is on a page without a container');
  }
});

test('only the super admin can read or set it', async () => {
  assert.strictEqual((await blta('/api/tracking')).status, 401);
  assert.strictEqual((await put('blta', { gtmId: 'GTM-AAAA111' }, '')).status, 401);
  const r = await blta('/api/tracking', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { blta: { gtmId: '', consent: true }, slta: { gtmId: '', consent: true } });
});

test('an ID that is not a Tag Manager ID is refused, and an unknown website', async () => {
  for (const bad of ['G-ABC123', 'GTM-', 'GTM-a b', '<script>', 'GTM-ABC1234"+alert(1)+"', 'GTM-TOOLONGTOOLONGTOOLONG']) {
    const r = await put('blta', { gtmId: bad });
    assert.strictEqual(r.status, 400, `${bad} was accepted`);
  }
  assert.strictEqual((await put('nope', { gtmId: 'GTM-AAAA111' })).status, 404);
  assert.strictEqual((await blta('/api/tracking', { cookie: admin })).json.blta.gtmId, '');
});

test('blta.sk gets its container, with consent defaults, the choice of an earlier visit and the banner script', async () => {
  const saved = await put('blta', { gtmId: ' gtm-blta123 ', consent: true });
  assert.strictEqual(saved.status, 200);
  assert.deepStrictEqual(saved.json, { gtmId: 'GTM-BLTA123', consent: true });
  const r = await blta('/');
  assert.ok(hasTag(r.body, 'GTM-BLTA123'));
  assert.ok(/gtag\('consent','default',Object\.assign\(\{ad_storage:'denied'/.test(r.body));
  assert.ok(r.body.includes("localStorage.getItem('blta-cookies')==='granted'"));
  assert.ok(/<script src="\/js\/consent\.js(\?v=[0-9a-f]+)?" defer><\/script>/.test(r.body)); // (the address carries ?v=<hash of the file>, see src/assets.js)
  // the tag is the first thing in the head: before the Analytics tag the page has by hand (so the consent defaults come first) and before the title
  const at = r.body.indexOf('<!-- Google Tag Manager -->');
  assert.ok(at > 0 && at < r.body.indexOf('<title>'));
  if (r.body.includes('gtag/js')) assert.ok(at < r.body.indexOf('gtag/js'), 'the consent defaults come after the Analytics tag');
  assert.strictEqual((r.body.match(/<!-- Google Tag Manager -->/g) || []).length, 1);
});

test('the tag is on the other public pages of blta.sk, in both languages and on a season, a player, a court', async () => {
  for (const url of ['/matches', '/tables', '/rankings', '/players', '/courts', '/en', '/en/matches', '/blog']) {
    const r = await blta(url);
    assert.strictEqual(r.status, 200, url);
    assert.ok(hasTag(r.body, 'GTM-BLTA123'), `no tag on ${url}`);
  }
  assert.ok(hasTag((await blta('/matches')).body, 'GTM-BLTA123'));
  assert.ok(hasTag((await blta('/this-is-not-a-page')).body, 'GTM-BLTA123'), 'the 404 page is a page too');
});

test('slta.sk is a website of its own: no tag until its own container is set, then its own tag (also on a city page), never the one of blta.sk', async () => {
  assert.ok(!/Google Tag Manager -->/.test((await slta('/')).body), 'blta.sk container leaked to slta.sk');
  assert.strictEqual((await put('slta', { gtmId: 'GTM-SLTA999', consent: false })).status, 200);
  const home = await slta('/');
  assert.ok(hasTag(home.body, 'GTM-SLTA999'));
  assert.ok(!home.body.includes('GTM-BLTA123'));
  // consent off: only the tag, no consent defaults and no banner
  assert.ok(!/gtag\('consent'/.test(home.body) && !home.body.includes('consent.js'));
  const rank = await slta('/slta-rankings');
  if (rank.status === 200) assert.ok(hasTag(rank.body, 'GTM-SLTA999'));
  // and blta.sk still has its own
  assert.ok(hasTag((await blta('/')).body, 'GTM-BLTA123') && !(await blta('/')).body.includes('GTM-SLTA999'));
});

test('the backend, the embeds for other websites and the login pages never get the tag', async () => {
  for (const url of ['/admin', '/faq-admin', '/tracking-admin', '/seo-admin', '/login-history', '/embed/live', '/embed/compact', '/embed/rankings', '/compact', '/compactblta']) {
    const r = await blta(url, { cookie: admin });
    assert.ok(!/Google Tag Manager -->/.test(r.body), `${url} got the tag`);
  }
  const files = await blta('/js/common.js');
  assert.ok(!/GTM-BLTA123/.test(files.body));
  assert.ok(!/GTM-BLTA123/.test((await blta('/api/seasons')).body));
});

test('a match page (public, shared in chats) gets the tag', async () => {
  const r = await blta('/match/not-a-real-token');
  assert.strictEqual(r.status, 200);
  assert.ok(hasTag(r.body, 'GTM-BLTA123'));
});

test('turning it off (an empty ID) takes the tag away again, and the consent choice is kept when the ID is changed', async () => {
  assert.strictEqual((await put('blta', { gtmId: 'GTM-BLTA777', consent: false })).status, 200);
  assert.deepStrictEqual((await blta('/api/tracking', { cookie: admin })).json.blta, { gtmId: 'GTM-BLTA777', consent: false });
  assert.ok(hasTag((await blta('/')).body, 'GTM-BLTA777'));
  assert.ok(!(await blta('/')).body.includes('GTM-BLTA123'));
  assert.strictEqual((await put('blta', { gtmId: '' })).status, 200);
  assert.ok(!/Google Tag Manager -->/.test((await blta('/')).body));
});

test('no page file carries an Analytics tag or a Meta Pixel of its own any more (both are set up inside Tag Manager)', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length > 40);
  pages.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    assert.ok(!/gtag\/js|G-W3BY57RTF9|gtag\('config'/.test(html), `${f} still has a Google Analytics tag`);
    assert.ok(!/fbq\(|connect\.facebook\.net|facebook\.com\/tr\?/.test(html), `${f} still has a Meta Pixel`);
  });
});

test('the banner script and the backend page exist, and the page asks for the super admin tab', async () => {
  const js = await blta('/js/consent.js');
  assert.strictEqual(js.status, 200);
  assert.ok(js.body.includes("'blta-cookies'") && js.body.includes("window.gtag('consent', 'update'"));
  assert.ok(js.body.includes('Súhlasím') && js.body.includes('Accept'));
  const page = await blta('/tracking-admin');
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('tracking-admin-root'));
  assert.ok(/Disallow: \/tracking-admin/.test((await blta('/robots.txt')).body));
  const common = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  assert.ok(common.includes("'/tracking-admin'"));
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
    const login = await blta('/api/admin/login', { method: 'POST', body: { password: 'test' } });
    admin = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
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
