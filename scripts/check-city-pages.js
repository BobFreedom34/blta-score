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
const local = (m, u, b, cookie) => as('localhost', u, { method: m, body: b, headers: { ...JSONH, ...(cookie ? { Cookie: cookie, 'X-Backend': '1' } : {}) } });
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

test('the Backend tells where the visitors of the city it works on find it, and its links to public pages use that', async () => {
  // opened on blta.sk (a host that is not a national one) while the super admin works on Kosice: the public site is slta.sk/kosice
  const pick = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  assert.strictEqual(pick.status, 200);
  assert.strictEqual(pick.json.acting.slug, 'kosice');
  assert.strictEqual(pick.json.acting.publicBase, 'https://slta.sk/kosice');
  // a city with a domain of its own is reached there
  assert.strictEqual((await local('PATCH', `/api/leagues/${cityId}`, { domain: 'kosice.example.sk' }, superCookie)).status, 200);
  const withDomain = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  assert.strictEqual(withDomain.json.acting.publicBase, 'https://kosice.example.sk');
  assert.strictEqual((await local('PATCH', `/api/leagues/${cityId}`, { domain: '' }, superCookie)).status, 200);
  // the pieces of the pages: the links are marked, one listener puts the address on them
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  assert.ok(read('js/common.js').includes("a[data-public]") && read('js/common.js').includes('publicBase'));
  // a city admin sees only the tabs of the Backend he may use, also at slta.sk/<city>/admin where the links carry the prefix of the city; the contact form of the whole site is not his
  assert.ok(read('js/common.js').includes('const tabPath') && read('js/common.js').includes('SUPER_ONLY_TABS.includes(tabPath(a))'), 'the tabs are compared without the prefix of the city');
  assert.ok(read('js/header-admin.js').includes("me.role === 'CITY'"), 'the contact card is for the super admin only');
  ['seasons-admin', 'bracket-admin', 'season-draw', 'venues-admin'].forEach((f) => assert.ok(read(`js/${f}.js`).includes('data-public'), `${f}.js marks its links`));
});

test('the blog and the rules are the city\'s own', async () => {
  const kosice = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  const withCity = `${superCookie}; ${cookieOf(kosice)}`;
  // a first article and a first rule of the city
  const article = await local('POST', '/api/articles/admin', { slugSk: 'novy-turnaj-kosice', slugEn: 'new-tournament-kosice', titleSk: 'Novy turnaj v Kosiciach', titleEn: 'New tournament in Kosice', bodySk: '<p>Text o BLTA</p>', status: 'PUBLISHED' }, withCity);
  assert.strictEqual(article.status, 201, JSON.stringify(article.json));
  const rule = await local('POST', '/api/rules', { title: 'Pravidla Kosice', navLabel: 'Kosice', html: '<p>Kosicke pravidlo</p>' }, withCity);
  assert.strictEqual(rule.status, 201, JSON.stringify(rule.json));
  // the blog of Kosice shows it, the blog of Bratislava does not
  assert.deepStrictEqual((await nat('/kosice/api/articles')).json.map((a) => a.slug), ['novy-turnaj-kosice']);
  assert.ok(!(await local('GET', '/api/articles')).json.some((a) => a.slug === 'novy-turnaj-kosice'), 'not on the first city');
  const page = await nat('/kosice/novy-turnaj-kosice');
  assert.strictEqual(page.status, 200, 'the article is at its own address under the city');
  assert.ok(page.body.includes('Novy turnaj v Kosiciach') && page.body.includes('Text o SLTA Kosice'), 'and speaks of the city');
  assert.strictEqual((await local('GET', '/novy-turnaj-kosice')).status, 404, 'but not on blta.sk');
  const list = await nat('/kosice/blog');
  assert.ok(list.body.includes('Novy turnaj v Kosiciach'));
  assert.ok(!(await local('GET', '/blog')).body.includes('Novy turnaj v Kosiciach'), 'the list of Bratislava is its own');
  // the rules page
  const rules = await nat('/kosice/propozicie');
  assert.strictEqual(rules.status, 200);
  assert.ok(rules.body.includes('Kosicke pravidlo'), 'the rules of the city');
  assert.ok(!(await local('GET', '/propozicie')).body.includes('Kosicke pravidlo'), 'not the ones of the first city');
  // the backend lists follow the city that is worked on
  assert.deepStrictEqual((await local('GET', '/api/rules', undefined, withCity)).json.map((r) => r.title), ['Pravidla Kosice']);
  assert.ok((await local('GET', '/api/rules', undefined, superCookie)).json.every((r) => r.title !== 'Pravidla Kosice'), 'the first city has its own');
  assert.strictEqual((await local('GET', `/api/articles/admin/${article.json.id}`, undefined, superCookie)).status, 404, 'an article of another city is not found');
  assert.strictEqual((await local('PUT', `/api/rules/${rule.json.id}`, { title: 'x', html: '<p>x</p>' }, superCookie)).status, 404, 'nor a rule');
});

test('the SEO is the city\'s own: texts, noindex, sitemap; the addresses are shared', async () => {
  const pick = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  const withCity = `${superCookie}; ${cookieOf(pick)}`;
  // before anything is saved: the first texts with the name of the city, and the pages are hidden while the city is not Active
  const first = await local('GET', '/api/seo', undefined, withCity);
  assert.strictEqual(first.status, 200);
  assert.ok(!first.json.some((p) => p.key === 'slta'), 'the national page is not a page of a city');
  const rankings = first.json.find((p) => p.key === 'rankings');
  assert.ok(rankings.city && !rankings.slugsEditable, 'the addresses are not the city\'s to change');
  assert.ok(!/BLTA/.test(rankings.values.sk.title) && rankings.values.sk.title.includes('SLTA Kosice'), 'the first texts speak of the city: ' + rankings.values.sk.title);
  // the city is Active (an earlier test), so its pages are indexed by default
  assert.strictEqual(rankings.noindex, false);
  // saving: the texts of Kosice, not of Bratislava
  const body = { noindex: false, sk: { ...rankings.values.sk, title: 'Rebricek hracov v Kosiciach', description: 'Kosicky rebricek.' }, en: rankings.values.en };
  const saved = await local('PUT', '/api/seo/rankings', body, withCity);
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  const page = await nat('/kosice/rankings');
  assert.ok(page.body.includes('<title>Rebricek hracov v Kosiciach</title>'), 'the page of the city has its own title');
  assert.ok(page.body.includes('content="Kosicky rebricek."'), 'and its own description');
  assert.ok(/<meta name="robots" content="index, follow/.test(page.body), 'and may be indexed');
  const first1 = await local('GET', '/rankings');
  const bratislavaSeo = (await local('GET', '/api/seo', undefined, superCookie)).json.find((p) => p.key === 'rankings');
  assert.ok(!bratislavaSeo.values.sk.title.includes('Kosiciach'), 'the first city has its own texts');
  assert.ok(bratislavaSeo.slugsEditable && !bratislavaSeo.city, 'and the super admin changes the addresses there');
  // noindex of one page of the city
  const hide = await local('PUT', '/api/seo/rankings', { ...body, noindex: true }, withCity);
  assert.strictEqual(hide.status, 200);
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test((await nat('/kosice/rankings')).body), 'hidden from search engines');
  const sitemap = await nat('/kosice/sitemap.xml');
  assert.ok(sitemap.body.includes('/kosice/') && !sitemap.body.includes('/kosice/rankings<') && !sitemap.body.includes('/kosice/rankings"'), 'a hidden page is not in the sitemap');
  assert.ok(sitemap.body.includes('kosice-jar-2027'), 'the seasons of the city are');
  assert.ok(!sitemap.body.includes('bratislava-jar-2027'), 'but not those of another city');
  const blta = await local('GET', '/sitemap.xml');
  assert.ok(!blta.body.includes('kosice-jar-2027') && blta.body.includes('bratislava-jar-2027'), 'blta.sk lists its own');
  // a city admin saves texts for his city only, and cannot touch the national page or the addresses
  await local('POST', '/api/city-admins', { name: 'Seo Admin', email: 'seo@example.com', leagueId: cityId, password: 'long-enough-2' }, superCookie);
  const login = await nat('/kosice/api/admin/login', '', 'POST', { email: 'seo@example.com', password: 'long-enough-2' });
  const cityCookie = cookieOf(login);
  const mine = await nat('/kosice/api/seo', cityCookie);
  assert.strictEqual(mine.status, 200);
  assert.ok(mine.json.every((p) => p.city && !p.slugsEditable));
  assert.strictEqual((await nat('/kosice/api/seo/rankings', cityCookie, 'PUT', { ...body, noindex: false, slugs: { sk: 'hacked', en: 'hacked' } })).status, 200);
  assert.strictEqual((await nat('/kosice/api/seo/court-paths', cityCookie)).status, 403, 'the addresses of the courts are the super admin\'s');
  assert.strictEqual((await nat('/kosice/api/seo/slta', cityCookie, 'PUT', body)).status, 404);
  assert.ok((await nat('/kosice/rankings')).status === 200 && (await nat('/kosice/hacked')).status === 404, 'a city admin cannot change an address');
  assert.strictEqual((await local('GET', '/rankings')).status, 200, 'the address of the first city is as before');
});

test('the Info window of the home page is the city\'s own', async () => {
  const pick = await local('POST', '/api/admin/acting-city', { leagueId: cityId }, superCookie);
  const withCity = `${superCookie}; ${cookieOf(pick)}`;
  // nothing written: a city has no window, the first city keeps the texts that came with the site
  assert.deepStrictEqual((await nat('/kosice/api/about')).json, { useDefaults: false, tabs: {} });
  assert.strictEqual((await local('GET', '/api/about')).json.useDefaults, true);
  // the city writes its first tab (the text is cleaned: no script, no event handler)
  const body = { sk: { title: 'Co je SLTA Kosice', html: '<p>Liga v Kosiciach</p><script>alert(1)</script><p onclick="x()">Druhy</p>' }, en: { title: 'What is SLTA Kosice', html: '<p>A league in Kosice</p>' } };
  const saved = await local('PUT', '/api/about/us', body, withCity);
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  const city = (await nat('/kosice/api/about')).json;
  assert.deepStrictEqual(Object.keys(city.tabs), ['us']);
  assert.strictEqual(city.tabs.us.sk.title, 'Co je SLTA Kosice');
  assert.ok(city.tabs.us.sk.html.includes('Liga v Kosiciach') && !/<script|onclick/.test(city.tabs.us.sk.html), 'cleaned: ' + city.tabs.us.sk.html);
  assert.strictEqual(city.tabs.us.en.html, '<p>A league in Kosice</p>');
  // the first city is untouched
  assert.deepStrictEqual((await local('GET', '/api/about')).json.tabs, {});
  assert.strictEqual((await local('PUT', '/api/about/nonsense', body, withCity)).status, 400);
  assert.strictEqual((await local('PUT', '/api/about/us', body)).status, 401, 'a visitor cannot write');
  // removing it brings the city back to no window
  assert.strictEqual((await local('DELETE', '/api/about/us', undefined, withCity)).status, 200);
  assert.deepStrictEqual((await nat('/kosice/api/about')).json.tabs, {});
  assert.strictEqual((await local('PUT', '/api/about/us', body, withCity)).status, 200);
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
  // and writes the blog and the rules of the city, but not of the other one
  assert.strictEqual((await nat('/kosice/api/articles/admin', cookie)).status, 200);
  assert.strictEqual((await nat('/kosice/api/about/tour', cookie, 'PUT', { sk: { title: 'Turnaje', html: '<p>x</p>' }, en: { title: '', html: '' } })).status, 200, 'and the Info window');
  assert.deepStrictEqual(Object.keys((await nat('/kosice/api/about')).json.tabs).sort(), ['tour', 'us']);
  assert.deepStrictEqual(Object.keys((await local('GET', '/api/about')).json.tabs), [], 'not the first city\'s');
  assert.strictEqual((await nat('/kosice/api/rules', cookie, 'POST', { title: 'Druhe pravidlo', html: '<p>2</p>' })).status, 201);
  assert.strictEqual((await local('GET', '/api/city-admins', undefined, cookie)).status, 403);
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
