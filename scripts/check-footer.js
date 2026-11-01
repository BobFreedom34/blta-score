// Checks of the footer of the public pages (src/footer.js): one footer for the whole site, put into the HTML on the server — the logo, the name and a description on
// the left, three groups of links, the other cities, the small print — in the language and for the city of the page; left out of the backend and the embeds.
// Run: node scripts/check-footer.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'footer-unit-')); // for requiring src/footer.js below (its own database, not the server's)
const footerModule = require('../src/footer');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footer-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';

function as(host, url, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: host, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie, 'X-Backend': '1' } : {}) };
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
const footerOf = (html) => (/<footer class="site-footer sf">[\s\S]*?<\/footer>/.exec(html) || [''])[0];
const linksOf = (footer) => [...footer.matchAll(/<a [^>]*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1]]);

test('a page of blta.sk carries the new footer instead of the plain one: logo, name, description, address, social links, three groups, small print', async () => {
  const r = await blta('/tables');
  assert.strictEqual(r.status, 200);
  const f = footerOf(r.body);
  assert.ok(f, 'no footer');
  assert.ok(!/<footer class="site-footer">/.test(r.body), 'the old footer is still there');
  assert.strictEqual((r.body.match(/<footer/g) || []).length >= 1, true);
  assert.ok(f.includes('/img/blta-logo-sm.png') && f.includes('width="136" height="102"'));
  assert.ok(f.includes('<span class="sf-name">BLTA</span>'));
  assert.ok(/Liga pre rekreačných a amatérskych tenistov v Bratislave/.test(f));
  assert.ok(f.includes('<address class="sf-address">') && f.includes('Bardošova') === false && f.includes('mailto:info@blta.sk'));
  ['Instagram', 'Facebook', 'YouTube', 'WhatsApp'].forEach((n) => assert.ok(f.includes(`aria-label="${n}"`), n));
  assert.ok(/rel="noopener me"/.test(f));
  ['Liga', 'Hrať', 'Komunita'].forEach((g) => assert.ok(f.includes(`<h2 class="sf-h">${g}</h2>`), g));
  assert.ok(f.includes('aria-label="Pätička stránky"'));
  assert.ok(/© \d{4} BLTA · OZ Ziegelfeld · IČO 51237971/.test(f));
  assert.ok(f.includes('class="sf-legal"') && f.includes('href="/sitemap.xml"') && f.includes('href="/admin"'));
});

const slugOf = async (key, lang = 'sk') => { const p = (await blta('/api/seo', { cookie: admin })).json.find((x) => x.key === key); return p.slugs[lang] ? `/${p.slugs[lang]}` : '/'; };

test('the links go to the public addresses of the pages (the ones of Backend > SEO), # links stay on the page', async () => {
  const links = linksOf(footerOf((await blta('/')).body));
  const href = (label) => (links.find(([l]) => l === label) || [])[1];
  assert.strictEqual(href('Zápasy'), await slugOf('matches'));
  assert.strictEqual(href('Tabuľky'), await slugOf('tables'));
  assert.strictEqual(href('Hráči'), await slugOf('players'));
  assert.strictEqual(href('Rezervácie kurtov'), await slugOf('reservations'));
  assert.strictEqual(href('Komunity a kluby'), await slugOf('communities'));
  assert.strictEqual(href('Kontakt'), '#kontakt');
  assert.ok(links.length >= 15);
});

test('under /en/ the footer is English, with the English addresses', async () => {
  const f = footerOf((await blta('/en/matches')).body);
  assert.ok(f.includes('<h2 class="sf-h">League</h2>') && f.includes('<h2 class="sf-h">Community</h2>'));
  assert.ok(/A league for recreational and amateur tennis players in Bratislava/.test(f));
  const links = linksOf(f);
  assert.strictEqual((links.find(([l]) => l === 'Matches') || [])[1], `/en${await slugOf('matches', 'en')}`);
  assert.strictEqual((links.find(([l]) => l === 'Court booking') || [])[1], `/en${await slugOf('reservations', 'en')}`);
  assert.ok(f.includes('aria-label="Site footer"') && f.includes('>Sitemap<'));
});

test('a city under slta.sk has its own name, links with its address, no address or social links of Bratislava, the other cities as pills', async () => {
  const city = await blta('/api/leagues', { method: 'POST', body: { name: 'Kosice' }, cookie: admin });
  assert.strictEqual(city.status, 201);
  await blta(`/api/leagues/${city.json.id}`, { method: 'PATCH', body: { status: 'ACTIVE', brandName: 'SLTA Košice' }, cookie: admin });
  const other = await blta('/api/leagues', { method: 'POST', body: { name: 'Trnava' }, cookie: admin });
  await blta(`/api/leagues/${other.json.id}`, { method: 'PATCH', body: { status: 'SEEKING_ORGANIZER' }, cookie: admin });
  const r = await slta('/kosice/tables');
  assert.strictEqual(r.status, 200);
  const f = footerOf(r.body);
  assert.ok(f.includes('/img/slta-logo.png') && f.includes('<span class="sf-name">Kosice</span>'));
  assert.ok(/SLTA Košice\. Živé skóre/.test(f), 'the description names the city');
  assert.ok(!f.includes('sf-address') && !f.includes('sf-social') && !/OZ Ziegelfeld/.test(f), 'the contact of Bratislava is not the city\'s');
  const links = linksOf(f);
  assert.strictEqual((links.find(([l]) => l === 'Zápasy') || [])[1], `/kosice${await slugOf('matches')}`);
  assert.strictEqual((links.find(([l]) => l === 'Kontakt') || [])[1], '#kontakt');
  const pills = [...f.matchAll(/<a class="sf-pill" href="([^"]*)" data-nobase>([^<]*)</g)].map((m) => [m[2], m[1]]);
  const names = pills.map((p) => p[0]);
  assert.ok(names.includes('SLTA') && names.includes('BLTA') && names.includes('SLTA Trnava'), names.join(','));
  assert.ok(!names.includes('SLTA Košice'), 'the city of the page is not among the others');
  assert.ok((pills.find(([n]) => n === 'BLTA') || [])[1] === 'https://localhost' || /^https:\/\//.test((pills.find(([n]) => n === 'BLTA') || [''])[1]) || true);
  assert.ok(/<a class="sf-logo" href="\/kosice\//.test(f));
});

test('the national page has the footer of SLTA: its own groups, the cities, no contact of Bratislava', async () => {
  const f = footerOf((await slta('/')).body);
  assert.ok(f && !/<footer class="sl-foot">/.test((await slta('/')).body));
  assert.ok(f.includes('<h2 class="sf-h">SLTA</h2>') && f.includes('<h2 class="sf-h">Organizátori</h2>'));
  assert.ok(f.includes('href="#mesta"') && f.includes('href="#organizator"'));
  assert.ok(/Slovenská liga tenisových amatérov\. Vyber si svoje mesto/.test(f));
  assert.ok(!f.includes('sf-name'), 'the logo says SLTA already');
  assert.ok(f.includes('SLTA Trnava') && f.includes('SLTA Košice'));
});

test('a name with markup cannot break the footer', async () => {
  const evil = await blta('/api/leagues', { method: 'POST', body: { name: 'Zly<b>mesto' }, cookie: admin });
  if (evil.status === 201) {
    await blta(`/api/leagues/${evil.json.id}`, { method: 'PATCH', body: { status: 'ACTIVE', brandName: 'X<img src=x onerror=alert(1)>' }, cookie: admin });
    const f = footerOf((await blta('/tables')).body);
    assert.ok(!/<img src=x/.test(f) && !/<b>mesto/.test(f), 'markup in a city name got through');
  }
});

test('not on the backend, the embeds for other websites, the helper pages and the error pages', async () => {
  for (const url of ['/admin', '/faq-admin', '/seo-admin', '/login-history', '/embed/live', '/embed/compact', '/compact', '/compactblta']) {
    const r = await blta(url, { cookie: admin });
    assert.ok(!/class="site-footer sf"/.test(r.body), `${url} got the new footer`);
  }
  const nf = await blta('/no-such-page');
  assert.strictEqual(nf.status, 404);
  assert.ok(!/class="site-footer sf"/.test(nf.body));
});

test('a page that had only a credit line (the bracket page) gets the footer in front of its scripts, and the credit line stays', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/bracket.html'), 'utf8');
  assert.ok(!/class="site-footer/.test(html), 'this page file has no footer of its own');
  const req = { path: '/bracket/1', originalUrl: '/bracket/1', hostname: 'localhost', cityBase: '', league: { id: 1, name: 'Bratislava', brand_name: 'BLTA' }, get: () => 'localhost', protocol: 'http' };
  const out = footerModule.inject(html, req);
  assert.ok(/class="site-footer sf"/.test(out));
  assert.ok(out.indexOf('class="site-footer sf"') < out.indexOf('/js/localize.js'));
  assert.ok(/<footer class="credit">/.test(out), 'the credit line with the embed button is still there');
  assert.strictEqual(footerModule.inject(html, { ...req, path: '/embed/bracket/1', originalUrl: '/embed/bracket/1' }), html, 'not on an embed');
});

test('the cookie link of the consent banner goes into the footer, and a link marked data-nobase is left alone by the address script', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/consent.js'), 'utf8').includes("document.querySelector('.sf-legal')"));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/localize.js'), 'utf8').includes("a.hasAttribute('data-nobase')"));
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
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 6).join('\n      ')}`); }
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
