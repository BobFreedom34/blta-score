// Checks of Backend > Footer (/api/footer): what is saved changes the footer of the public pages (description, contact, groups of links, the row of cities, small
// print), per city and for the national site; bad input is refused; it can go back to the built-in footer; who may change what.
// Run: node scripts/check-footer-admin.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footer-admin-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';
let kosiceId = 0;
let kosiceCookie = '';

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
const blta = (url, opts = {}) => as('localhost', url, opts);
const slta = (url, opts = {}) => as('slta.localhost', url, opts);
const put = (body, query = '', cookie = admin) => blta(`/api/footer${query}`, { method: 'PUT', body, cookie });
const footerOf = (html) => (/<footer class="site-footer sf">[\s\S]*?<\/footer>/.exec(html) || [''])[0];
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

const BASE = { desc: { sk: '', en: '' }, contact: {}, groups: null, showCities: true, legal: { sk: '', en: '' } };

test('only an admin can read or change it; GET gives the saved values, the built-in ones and the pages a link can point at', async () => {
  assert.strictEqual((await blta('/api/footer')).status, 401);
  assert.strictEqual((await put(BASE, '', '')).status, 401);
  const r = await blta('/api/footer', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.scope, 1);
  assert.strictEqual(r.json.settings.groups, null);
  assert.strictEqual(r.json.builtIn.groups.length, 3);
  assert.ok(r.json.builtIn.groups[0].links.every((l) => l.page || l.url));
  assert.ok(/Bratislave/.test(r.json.builtIn.desc.sk) && r.json.builtIn.contact && r.json.builtIn.contact.email);
  assert.ok(r.json.pages.some((p) => p.code === '/matches') && !r.json.pages.some((p) => p.code.includes(':')));
});

test('a description, a contact and a line of small print change the card of the footer in the right language', async () => {
  const saved = await put({ ...BASE, desc: { sk: 'Náš vlastný popis.', en: 'Our own description.' }, contact: { address: 'Hlavná 1\n040 01 Košice', email: 'ahoj@example.sk', instagramUrl: 'https://www.instagram.com/mojaliga' }, legal: { sk: 'Moje OZ', en: 'My club' } });
  assert.strictEqual(saved.status, 200);
  const sk = footerOf((await blta('/tables')).body);
  assert.ok(sk.includes('Náš vlastný popis.') && !/Liga pre rekreačných/.test(sk));
  assert.ok(sk.includes('Hlavná 1<br>040 01 Košice') && sk.includes('mailto:ahoj@example.sk'));
  assert.ok(sk.includes('https://www.instagram.com/mojaliga') && sk.includes('aria-label="Facebook"'), 'the own link, the rest from the contact window');
  assert.ok(/© \d{4} BLTA · Moje OZ/.test(sk) && !sk.includes('IČO'));
  const en = footerOf((await blta('/en/tables')).body);
  assert.ok(en.includes('Our own description.') && /BLTA · My club/.test(en));
});

test('own groups of links: pages (their public address, in the language of the page), own addresses, a link to another website opens in a new tab', async () => {
  const groups = [
    { sk: 'Hrať', en: 'Play', links: [{ sk: 'Zápasy', en: 'Matches', page: '/matches' }, { sk: 'Registrácia', en: 'Register', url: '/registracia' }, { sk: 'Kontakt', en: 'Contact', url: '#kontakt' }] },
    { sk: 'Partneri', en: 'Partners', links: [{ sk: 'Tenisová škola', en: 'Tennis school', url: 'https://skola.example/tenis' }] },
  ];
  assert.strictEqual((await put({ ...BASE, groups })).status, 200);
  const seo = (await blta('/api/seo', { cookie: admin })).json.find((p) => p.key === 'matches');
  const f = footerOf((await blta('/')).body);
  assert.deepStrictEqual([...f.matchAll(/<p class="sf-h">([^<]*)</g)].map((m) => m[1]), ['Hrať', 'Partneri']);
  assert.ok(f.includes(`<a href="/${seo.slugs.sk}">Zápasy</a>`));
  assert.ok(f.includes('<a href="/registracia">Registrácia</a>') && !f.includes('<li><a href="#kontakt">Kontakt</a></li>') && f.includes('class="sf-contact" href="#kontakt"'));
  assert.ok(f.includes('<a href="https://skola.example/tenis" target="_blank" rel="noopener">Tenisová škola</a>'));
  const en = footerOf((await blta('/en')).body);
  assert.ok(en.includes('<p class="sf-h">Partners</p>') && en.includes('>Tennis school<'));
  assert.ok(en.includes(`<a href="/en/${seo.slugs.en}">Matches</a>`));
});

test('the row of cities can be switched off', async () => {
  assert.ok(footerOf((await blta('/')).body).includes('class="sf-cities"'));
  assert.strictEqual((await put({ ...BASE, showCities: false })).status, 200);
  assert.ok(!footerOf((await blta('/')).body).includes('class="sf-cities"'));
});

test('a part of the contact can be left out altogether, also the one that comes from the contact window; an empty field alone would show it again', async () => {
  assert.strictEqual((await put(BASE)).status, 200);
  let f = footerOf((await blta('/')).body);
  assert.ok(f.includes('Bárdošova 2939/23') && f.includes('mailto:info@blta.sk') && f.includes('aria-label="Instagram"'), 'the contact window shows by default');
  assert.strictEqual((await put({ ...BASE, contactHidden: ['address'] })).status, 200);
  f = footerOf((await blta('/')).body);
  assert.ok(!f.includes('Bárdošova') && f.includes('mailto:info@blta.sk'), 'only the address is gone');
  assert.strictEqual((await put({ ...BASE, contactHidden: ['address', 'email', 'instagramUrl'] })).status, 200);
  f = footerOf((await blta('/')).body);
  assert.ok(!f.includes('sf-address') && !f.includes('aria-label="Instagram"') && f.includes('aria-label="Facebook"'), 'no address block, no Instagram, the other links stay');
  assert.deepStrictEqual((await blta('/api/footer', { cookie: admin })).json.settings.contactHidden.sort(), ['address', 'email', 'instagramUrl']);
  // unknown names are dropped
  assert.deepStrictEqual((await put({ ...BASE, contactHidden: ['address', 'bogus'] })).json.settings.contactHidden, ['address']);
  // a city: what it types is shown unless it is hidden
  assert.strictEqual((await put({ ...BASE, contactHidden: ['email'], contact: { email: 'x@example.sk', address: 'Moja 1' } })).status, 200);
  f = footerOf((await blta('/')).body);
  assert.ok(f.includes('Moja 1') && !f.includes('x@example.sk') && !f.includes('info@blta.sk'));
  assert.strictEqual((await put(BASE)).status, 200);
});

test('single cities can be left out of the row: the editor lists them, the footer follows, bad lists are refused', async () => {
  assert.strictEqual((await put(BASE)).status, 200); // the row is on again (an earlier test switched it off)
  // two other cities so there is something to choose from
  const a = await blta('/api/leagues', { method: 'POST', body: { name: 'Zilina' }, cookie: admin });
  const b = await blta('/api/leagues', { method: 'POST', body: { name: 'Presov' }, cookie: admin });
  for (const c of [a, b]) await blta(`/api/leagues/${c.json.id}`, { method: 'PATCH', body: { status: 'SEEKING_ORGANIZER' }, cookie: admin });
  const view = (await blta('/api/footer', { cookie: admin })).json;
  const slugs = view.cities.map((c) => c.slug);
  assert.ok(slugs.includes('slta') && slugs.includes(a.json.slug) && slugs.includes(b.json.slug), slugs.join(','));
  assert.ok(!slugs.includes('bratislava'), 'the city of the footer is not in its own list');
  const pills = (html) => [...footerOf(html).matchAll(/<a class="sf-pill"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const all = pills((await blta('/')).body);
  assert.ok(all.includes('SLTA') && all.some((n) => /Zilina/.test(n)) && all.some((n) => /Presov/.test(n)), all.join(','));
  assert.strictEqual((await put({ ...BASE, hiddenCities: [a.json.slug, 'slta'] })).status, 200);
  const some = pills((await blta('/')).body);
  assert.ok(!some.includes('SLTA') && !some.some((n) => /Zilina/.test(n)) && some.some((n) => /Presov/.test(n)), some.join(','));
  assert.deepStrictEqual((await blta('/api/footer', { cookie: admin })).json.settings.hiddenCities.sort(), ['slta', a.json.slug].sort());
  // all of them left out: no row at all
  assert.strictEqual((await put({ ...BASE, hiddenCities: ['slta', a.json.slug, b.json.slug] })).status, 200);
  assert.ok(!footerOf((await blta('/')).body).includes('class="sf-cities"'), 'no city left: no row');
  for (const bad of [['Bad Slug'], ['x'.repeat(61)], [1], 'slta']) assert.strictEqual((await put({ ...BASE, hiddenCities: bad })).status, 400, JSON.stringify(bad));
  assert.strictEqual((await put({ ...BASE })).status, 200);
  assert.ok(pills((await blta('/')).body).length >= 3, 'back to all cities');
});

test('bad input is refused and nothing is saved: a page that does not exist, javascript:, a link without text, a group without a title, too many groups, bad e-mail or social link', async () => {
  const before = (await blta('/api/footer', { cookie: admin })).json.settings;
  const link = (l) => ({ ...BASE, groups: [{ sk: 'G', en: 'G', links: [l] }] });
  assert.strictEqual((await put(link({ sk: 'x', en: 'x', page: '/nope' }))).status, 400);
  assert.strictEqual((await put(link({ sk: 'x', en: 'x', url: 'javascript:alert(1)' }))).status, 400);
  assert.strictEqual((await put(link({ sk: 'x', en: 'x', url: '//evil.example' }))).status, 400);
  assert.strictEqual((await put(link({ sk: '', en: '', url: 'https://ok.example' }))).status, 400);
  assert.strictEqual((await put({ ...BASE, groups: [{ sk: '', en: '', links: [] }] })).status, 400);
  assert.strictEqual((await put({ ...BASE, groups: Array.from({ length: 7 }, (_, i) => ({ sk: `G${i}`, en: '', links: [] })) })).status, 400);
  assert.strictEqual((await put({ ...BASE, contact: { email: 'not an email' } })).status, 400);
  assert.strictEqual((await put({ ...BASE, contact: { facebookUrl: 'ftp://x' } })).status, 400);
  assert.deepStrictEqual((await blta('/api/footer', { cookie: admin })).json.settings, before);
});

test('text with markup cannot break the footer, and an empty link row is dropped', async () => {
  const groups = [{ sk: 'A<b>', en: '', links: [{ sk: '<img src=x onerror=alert(1)>', en: '', url: '/x' }, { sk: '', en: '', url: '' }] }];
  assert.strictEqual((await put({ ...BASE, groups, desc: { sk: '<script>alert(1)</script>', en: '' } })).status, 200);
  const f = footerOf((await blta('/')).body);
  assert.ok(!/<img src=x|<script>alert|<b>/.test(f), 'markup got through');
  assert.ok(f.includes('&lt;img src=x'));
  assert.strictEqual(((/<nav[\s\S]*?<\/nav>/.exec(f) || [''])[0].match(/<li>/g) || []).length, 1, 'the empty row is gone');
});

test('a city has its own footer: its admin changes it, the one of Bratislava stays; a city admin cannot touch the national one', async () => {
  const city = await blta('/api/leagues', { method: 'POST', body: { name: 'Kosice' }, cookie: admin });
  assert.strictEqual(city.status, 201);
  kosiceId = city.json.id;
  await blta(`/api/leagues/${kosiceId}`, { method: 'PATCH', body: { status: 'ACTIVE', brandName: 'SLTA Košice' }, cookie: admin });
  const pick = await blta('/api/admin/acting-city', { method: 'POST', body: { leagueId: kosiceId }, cookie: admin });
  kosiceCookie = `${admin}; ${cookieOf(pick)}`;
  const mine = await blta('/api/footer', { cookie: kosiceCookie });
  assert.strictEqual(mine.json.scope, kosiceId);
  assert.strictEqual(mine.json.settings.groups, null, 'Bratislava\'s groups are not the city\'s');
  assert.strictEqual(mine.json.builtIn.contact, null);
  assert.strictEqual((await put({ ...BASE, desc: { sk: 'Košický popis.', en: '' }, contact: { email: 'kosice@example.sk' } }, '', kosiceCookie)).status, 200);
  const k = footerOf((await slta('/kosice/tables')).body);
  assert.ok(k.includes('Košický popis.') && k.includes('kosice@example.sk'));
  assert.ok(footerOf((await blta('/')).body).includes('<p class="sf-desc">&lt;script&gt;'), 'Bratislava keeps its own');
  // own links in a city get the prefix of the city
  assert.strictEqual((await put({ ...BASE, groups: [{ sk: 'Viac', en: 'More', links: [{ sk: 'Pravidlá', en: 'Rules', url: '/pravidla' }, { sk: 'Zápasy', en: 'Matches', page: '/matches' }] }] }, '', kosiceCookie)).status, 200);
  const k2 = footerOf((await slta('/kosice/tables')).body);
  assert.ok(k2.includes('<a href="/kosice/pravidla">Pravidlá</a>'));
  assert.ok(/<a href="\/kosice\/[a-z-]+">Zápasy<\/a>/.test(k2));
});

test('the national site has its own footer, only the super admin changes it', async () => {
  const nat = await blta('/api/footer?scope=national', { cookie: admin });
  assert.strictEqual(nat.json.scope, 'national');
  assert.strictEqual(nat.json.builtIn.groups.length, 2);
  assert.strictEqual((await put({ ...BASE, desc: { sk: 'Národný popis SLTA.', en: '' } }, '?scope=national')).status, 200);
  assert.ok(footerOf((await slta('/')).body).includes('Národný popis SLTA.'));
  assert.ok(!footerOf((await blta('/')).body).includes('Národný popis SLTA.'));
  // a city admin (here: a request without the super admin cookie) cannot
  assert.strictEqual((await blta('/api/footer?scope=national')).status, 401);
  const cityAdmin = await blta('/api/admins', { method: 'POST', body: { name: 'Kosicky admin', email: 'ka@example.sk', password: 'heslo-heslo-1', leagueId: kosiceId }, cookie: admin });
  if (cityAdmin.status === 201 || cityAdmin.status === 200) {
    const login = await blta('/api/admin/login', { method: 'POST', body: { email: 'ka@example.sk', password: 'heslo-heslo-1' } });
    const cookie = cookieOf(login);
    if (cookie) assert.strictEqual((await blta('/api/footer?scope=national', { cookie })).status, 403);
  }
});

test('reset goes back to the built-in footer (also for the groups); the backend page and its tab exist', async () => {
  assert.strictEqual((await blta('/api/footer', { method: 'DELETE', cookie: admin })).status, 200);
  const f = footerOf((await blta('/')).body);
  assert.ok(f.includes('Liga pre rekreačných a amatérskych tenistov v Bratislave') && f.includes('<p class="sf-h">Komunita</p>') && f.includes('IČO 51237971'));
  assert.ok(f.includes('class="sf-cities"'), 'the row of cities is back');
  const page = await blta('/footer-admin');
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('footer-admin-root'));
  assert.ok(/Disallow: \/footer-admin/.test((await blta('/robots.txt')).body));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8').includes("'/footer-admin'"));
  assert.ok(!/class="site-footer sf"/.test(page.body), 'the backend keeps its plain footer');
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
    admin = cookieOf(await blta('/api/admin/login', { method: 'POST', body: { password: 'test' } }));
    assert.ok(admin, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && (err.message || err.stack)).split('\n').slice(0, 6).join('\n      ')}`); }
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
