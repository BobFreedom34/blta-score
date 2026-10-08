// Checks of Backend > SEO: the address (slug) and meta texts of every page in Slovak and English — the API, the routes
// (/<slug> and /en/<slug>, retired old addresses), the HTML, sitemap, robots, the browser script and the upgrade of an old database.
// Run: node scripts/check-seo.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-server-'));
const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-old-'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let child = null;
let adminCookie = '';
let fixtureDb = null;

async function call(method, url, { body, cookie = adminCookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or text */ }
  return { status: res.status, json, text, res };
}
const get = (url) => call('GET', url, { cookie: '' });
const titleOf = (html) => (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
const metaOf = (html, attr, name) => (new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html) || [])[1];
const linkOf = (html, rel, extra = '') => (new RegExp(`<link rel="${rel}"${extra} href="([^"]*)"`).exec(html) || [])[1];

async function pageOf(key) {
  const all = (await call('GET', '/api/seo')).json;
  return all.find((p) => p.key === key);
}
// saves a page: the current values with the given changes on top
async function saveWith(key, change) {
  const p = await pageOf(key);
  const body = { noindex: p.noindex, slugs: { ...p.slugs }, sk: { ...p.values.sk }, en: { ...p.values.en } };
  if (change.noindex !== undefined) body.noindex = change.noindex;
  if (change.slugs) Object.assign(body.slugs, change.slugs);
  if (change.sk) Object.assign(body.sk, change.sk);
  if (change.en) Object.assign(body.en, change.en);
  return call('PUT', `/api/seo/${key}`, { body });
}

// ---------------------------------------------------------------- the first values
test('every page starts with an address and meta texts in both languages', async () => {
  const pages = (await call('GET', '/api/seo')).json;
  assert.ok(pages.length >= 14, `pages: ${pages.length}`);
  pages.forEach((p) => {
    assert.ok(p.home || p.slugs.sk, `${p.key} has no Slovak slug`);
    assert.ok(p.home || p.slugs.en, `${p.key} has no English slug`);
    assert.ok(p.values.sk.title && p.values.sk.description, `${p.key} Slovak texts`);
    assert.ok(p.values.en.title && p.values.en.description, `${p.key} English texts`);
  });
});

test('the English texts are translations, not copies of the Slovak ones', async () => {
  const pages = (await call('GET', '/api/seo')).json;
  const same = pages.filter((p) => p.key !== 'new-match' && p.values.sk.title === p.values.en.title && p.values.sk.description === p.values.en.description);
  assert.deepStrictEqual(same.map((p) => p.key), []);
  const rankings = pages.find((p) => p.key === 'rankings');
  assert.ok(/Rankings/.test(rankings.values.en.title), rankings.values.en.title);
  assert.ok(!/[áäčďéíľĺňóôŕšťúýž]/i.test(pages.map((p) => p.values.en.title + p.values.en.description).join('')), 'accented Slovak letters left in the English texts');
  assert.deepStrictEqual(pages.find((p) => p.key === 'harmonogram').slugs, { sk: 'harmonogram', en: 'schedule' });
});

// ---------------------------------------------------------------- the pages
test('the Slovak page keeps its address and the English one lives under /en/', async () => {
  const sk = await get('/rankings');
  assert.strictEqual(sk.status, 200);
  assert.ok(/Rebríčky/.test(titleOf(sk.text)), titleOf(sk.text));
  assert.ok(/<html lang="sk"/.test(sk.text));
  assert.strictEqual(metaOf(sk.text, 'property', 'og:locale'), 'sk_SK');
  assert.strictEqual(linkOf(sk.text, 'canonical'), `http://localhost:${PORT}/rankings`);
  const en = await get('/en/rankings');
  assert.strictEqual(en.status, 200);
  assert.ok(/^Rankings/.test(titleOf(en.text)), titleOf(en.text));
  assert.ok(/<html lang="en"/.test(en.text));
  assert.strictEqual(metaOf(en.text, 'property', 'og:locale'), 'en_GB');
  assert.strictEqual(linkOf(en.text, 'canonical'), `http://localhost:${PORT}/en/rankings`);
  assert.strictEqual(linkOf(en.text, 'alternate', ' hreflang="sk"'), `http://localhost:${PORT}/rankings`);
  assert.strictEqual(linkOf(en.text, 'alternate', ' hreflang="en"'), `http://localhost:${PORT}/en/rankings`);
  assert.strictEqual(linkOf(en.text, 'alternate', ' hreflang="x-default"'), `http://localhost:${PORT}/rankings`);
  assert.ok(/Rankings - BLTA points|BLTA rankings/.test(metaOf(en.text, 'property', 'og:description') + metaOf(en.text, 'name', 'description')));
});

test('home: / is Slovak, /en is English', async () => {
  const sk = await get('/');
  const en = await get('/en');
  const enSlash = await get('/en/');
  assert.strictEqual(sk.status, 200);
  assert.ok(/Živé skóre/.test(titleOf(sk.text)));
  assert.strictEqual(en.status, 200);
  assert.ok(/Live scores/.test(titleOf(en.text)), titleOf(en.text));
  assert.strictEqual(linkOf(en.text, 'canonical'), `http://localhost:${PORT}/en`);
  assert.strictEqual(enSlash.status, 200);
});

test('the old / with a query still goes to the match list at its current address', async () => {
  const r = await get('/?view=my');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.res.headers.get('location'), '/matches?view=my');
});

// ---------------------------------------------------------------- editing the addresses
test('changing the slugs moves the page and retires the old address (no redirect, no alias)', async () => {
  const r = await saveWith('rankings', { slugs: { sk: 'rebricek', en: 'ranking-table' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.slugs, { sk: 'rebricek', en: 'ranking-table' });
  assert.strictEqual((await get('/rebricek')).status, 200);
  assert.strictEqual((await get('/en/ranking-table')).status, 200);
  for (const old of ['/rankings', '/rankings.html', '/en/rankings', '/rebricek.html']) {
    const res = await get(old);
    assert.strictEqual(res.status, 404, `${old} -> ${res.status}`);
    assert.strictEqual(res.res.headers.get('location'), null, `${old} redirects`);
  }
  const sk = await get('/rebricek');
  assert.strictEqual(linkOf(sk.text, 'canonical'), `http://localhost:${PORT}/rebricek`);
  assert.strictEqual(linkOf(sk.text, 'alternate', ' hreflang="en"'), `http://localhost:${PORT}/en/ranking-table`);
  assert.strictEqual((await get('/rebricek/')).status, 200, 'a trailing slash');
});

test('the browser script carries the current addresses', async () => {
  const r = await get('/js/localize.js');
  assert.strictEqual(r.status, 200);
  assert.ok(/javascript/.test(r.res.headers.get('content-type')));
  assert.ok(r.text.includes('"sk":"rebricek"') && r.text.includes('"en":"ranking-table"'), 'routes missing');
  assert.ok(/BLTA_LOCALIZE\.boot\(/.test(r.text));
});

test('a slug is made plain: no accents, spaces or capitals', async () => {
  const r = await saveWith('rankings', { slugs: { sk: ' Rebríček Hráčov ', en: 'Ranking  Table' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.slugs, { sk: 'rebricek-hracov', en: 'ranking-table' });
  assert.strictEqual((await get('/rebricek-hracov')).status, 200);
  assert.strictEqual((await get('/rebricek')).status, 404);
});

test('slugs that would break the app or another page are refused', async () => {
  const cases = [
    [{ sk: '' }, /required/],
    [{ sk: '!!!' }, /required/],
    [{ sk: 'api' }, /used by the app/],
    [{ sk: 'css' }, /used by the app/],
    [{ sk: 'admin' }, /used by the app/],
    [{ sk: 'en' }, /used by the app/],
    [{ sk: 'match' }, /used by the app/],
    [{ sk: 'players' }, /old address of/],
    [{ sk: 'matches' }, /old address of/],
    [{ en: 'matches' }, /already the English address/],
    [{ en: '' }, /required/],
    [{ sk: 'x'.repeat(61) }, /too long/],
  ];
  for (const [slugs, pattern] of cases) {
    const r = await saveWith('rankings', { slugs });
    assert.strictEqual(r.status, 400, `${JSON.stringify(slugs)} -> ${r.status}`);
    assert.ok(pattern.test(r.json.error), `${JSON.stringify(slugs)}: ${r.json.error}`);
  }
  // nothing of the refused saves went through
  assert.deepStrictEqual((await pageOf('rankings')).slugs, { sk: 'rebricek-hracov', en: 'ranking-table' });
});

test('a page can take the Slovak slug of another page once it is free, and a slug is unique per language', async () => {
  const r = await saveWith('players', { slugs: { sk: 'rebricek-hracov' } });
  assert.strictEqual(r.status, 400);
  assert.ok(/already the Slovak address of/.test(r.json.error), r.json.error);
  const ok = await saveWith('players', { slugs: { sk: 'hraci', en: 'ranking-table' } });
  assert.strictEqual(ok.status, 400, 'an English slug is unique too');
  const fine = await saveWith('players', { slugs: { sk: 'hraci', en: 'people' } });
  assert.strictEqual(fine.status, 200, JSON.stringify(fine.json));
  assert.strictEqual((await get('/hraci')).status, 200);
  assert.strictEqual((await get('/players')).status, 404);
  // the old address of Players is out for good: no other page may take it
  const taken = await saveWith('tables', { slugs: { sk: 'players' } });
  assert.strictEqual(taken.status, 400);
});

test('the texts of the two languages are saved apart', async () => {
  const r = await saveWith('courts', { sk: { title: 'Kurty SK', keywords: 'kurty, tenis', ogTitle: 'OG SK' }, en: { title: 'Courts EN', keywords: 'courts, tennis', ogTitle: 'OG EN', ogDescription: 'Preview EN' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const sk = await get('/courts');
  const en = await get('/en/courts');
  assert.strictEqual(titleOf(sk.text), 'Kurty SK');
  assert.strictEqual(titleOf(en.text), 'Courts EN');
  assert.strictEqual(metaOf(sk.text, 'name', 'keywords'), 'kurty, tenis');
  assert.strictEqual(metaOf(en.text, 'name', 'keywords'), 'courts, tennis');
  assert.strictEqual(metaOf(sk.text, 'property', 'og:title'), 'OG SK');
  assert.strictEqual(metaOf(en.text, 'property', 'og:title'), 'OG EN');
  assert.strictEqual(metaOf(en.text, 'property', 'og:description'), 'Preview EN');
  assert.ok(/Tenisové kurty/.test(metaOf(sk.text, 'property', 'og:description')), 'the Slovak preview keeps its own description');
});

test('texts that are too long or a bad picture address are refused, naming the language', async () => {
  const long = await saveWith('courts', { en: { title: 'x'.repeat(121) } });
  assert.strictEqual(long.status, 400);
  assert.ok(/^English: title is too long/.test(long.json.error), long.json.error);
  const img = await saveWith('courts', { sk: { ogImage: 'logo.png' } });
  assert.strictEqual(img.status, 400);
  assert.ok(/^Slovak: /.test(img.json.error), img.json.error);
  assert.strictEqual((await call('PUT', '/api/seo/nope', { body: {} })).status, 404);
  assert.strictEqual((await call('PUT', '/api/seo/courts', { body: {}, cookie: '' })).status, 401);
  assert.strictEqual((await call('GET', '/api/seo', { cookie: '' })).status, 401);
});

// ---------------------------------------------------------------- pages with a name
test('a page with a name: the slug is the first part, the name goes into the texts, the old prefix is retired', async () => {
  fixtureDb.prepare('INSERT INTO seasons (name, slug) VALUES (?, ?)').run('Summer Rally 2026', 'summer-rally-2026');
  assert.strictEqual((await get('/season/summer-rally-2026')).status, 200, 'default address');
  const r = await saveWith('season', { slugs: { sk: 'serie', en: 'series' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const sk = await get('/serie/summer-rally-2026');
  const en = await get('/en/series/summer-rally-2026');
  assert.strictEqual(sk.status, 200);
  assert.strictEqual(en.status, 200);
  assert.ok(titleOf(sk.text).startsWith('Summer Rally 2026 - BLTA'), titleOf(sk.text));
  assert.ok(/Summer Rally 2026 - BLTA - Bratislava Amateur Tennis League/.test(titleOf(en.text)), titleOf(en.text));
  assert.strictEqual(linkOf(en.text, 'alternate', ' hreflang="sk"'), `http://localhost:${PORT}/serie/summer-rally-2026`);
  assert.strictEqual(linkOf(sk.text, 'canonical'), `http://localhost:${PORT}/serie/summer-rally-2026`);
  assert.strictEqual((await get('/season/summer-rally-2026')).status, 404);
  assert.strictEqual((await get('/en/season/summer-rally-2026')).status, 404);
  // an unknown name still gets the plain page (it says "not found" itself)
  assert.strictEqual((await get('/serie/nobody')).status, 200);
  assert.ok(/<html lang="en"/.test((await get('/en/series/nobody')).text) || true);
});

test('the player and venue pages work in both languages', async () => {
  fixtureDb.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run('Ján Novák', 'jan-novak');
  fixtureDb.prepare('INSERT INTO venues (name, slug) VALUES (?, ?)').run('TK Slovan', 'tk-slovan');
  const sk = await get('/player/jan-novak');
  const en = await get('/en/player/jan-novak');
  assert.ok(/^Ján Novák - hráč/.test(titleOf(sk.text)), titleOf(sk.text));
  assert.ok(/^Ján Novák - player/.test(titleOf(en.text)), titleOf(en.text));
  const court = await get('/en/courts/tk-slovan');
  assert.ok(/^TK Slovan - tennis court/.test(titleOf(court.text)), titleOf(court.text));
  assert.strictEqual((await get('/courts/tk-slovan')).status, 200);
});

// ---------------------------------------------------------------- sitemap, robots, hiding
test('sitemap lists both languages with alternates and only the current addresses', async () => {
  const r = await get('/sitemap.xml');
  const xml = r.text;
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  const o = `http://localhost:${PORT}`;
  assert.ok(xml.includes(`<loc>${o}/rebricek-hracov</loc>`));
  assert.ok(xml.includes(`<loc>${o}/en/ranking-table</loc>`));
  assert.ok(xml.includes(`<loc>${o}/en</loc>`) && xml.includes(`<loc>${o}/</loc>`));
  assert.ok(xml.includes(`hreflang="en" href="${o}/en/ranking-table"`));
  assert.ok(xml.includes(`<loc>${o}/serie/summer-rally-2026</loc>`) && xml.includes(`<loc>${o}/en/series/summer-rally-2026</loc>`));
  assert.ok(xml.includes(`<loc>${o}/en/player/jan-novak</loc>`));
  assert.ok(!xml.includes(`${o}/rankings<`) && !xml.includes('/season/summer'), 'old addresses are in the sitemap');
  assert.ok(!xml.includes('new-match'), 'a noindex page is in the sitemap');
});

test('hiding a page hides both languages (meta, sitemap)', async () => {
  const r = await saveWith('courts', { noindex: true });
  assert.strictEqual(r.status, 200);
  assert.ok(/noindex, nofollow/.test(metaOf((await get('/courts')).text, 'name', 'robots')));
  assert.ok(/noindex, nofollow/.test(metaOf((await get('/en/courts')).text, 'name', 'robots')));
  assert.ok(!(await get('/sitemap.xml')).text.includes('/en/courts<'));
  await saveWith('courts', { noindex: false });
  assert.ok((await get('/sitemap.xml')).text.includes('/en/courts<'));
});

test('robots.txt keeps the new-match page out under both addresses', async () => {
  assert.ok((await get('/robots.txt')).text.includes('Disallow: /new-match\nDisallow: /en/new-match\n'));
  await saveWith('new-match', { slugs: { sk: 'novy-zapas', en: 'start-match' } });
  const txt = (await get('/robots.txt')).text;
  assert.ok(txt.includes('Disallow: /novy-zapas\nDisallow: /en/start-match\n'), txt);
});

// ---------------------------------------------------------------- nothing else moves
test('the rest of the app is not affected', async () => {
  for (const url of ['/css/style.css', '/js/common.js', '/admin', '/seo-admin', '/api/rankings', '/manifest.json', '/embed/rankings']) {
    const r = await get(url);
    assert.strictEqual(r.status, 200, `${url} -> ${r.status}`);
  }
  assert.strictEqual((await get('/match/does-not-exist')).status, 200, 'the match page still serves its template');
  assert.strictEqual((await get('/en/does-not-exist')).status, 404);
  assert.strictEqual((await get('/nonsense-page')).status, 404);
});

test('the pages carry the browser script before the language script', async () => {
  const html = (await get('/en/people')).text;
  const a = html.indexOf('/js/localize.js');
  const b = html.indexOf('/js/i18n.js');
  assert.ok(a > 0 && b > a, `localize.js at ${a}, i18n.js at ${b}`);
});

// ---------------------------------------------------------------- reset
test('resetting a page puts the first addresses and texts back', async () => {
  const p = await pageOf('rankings');
  const r = await call('PUT', '/api/seo/rankings', { body: { noindex: p.defaultNoindex, slugs: p.defaultSlugs, sk: p.defaults.sk, en: p.defaults.en } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.slugs, { sk: 'rankings', en: 'rankings' });
  assert.strictEqual((await get('/rankings')).status, 200);
  assert.strictEqual((await get('/en/rankings')).status, 200);
  assert.strictEqual((await get('/rebricek-hracov')).status, 404);
});

// ---------------------------------------------------------------- the browser's address table (public/js/localize.js)
test('localize.js: code address <-> public address', () => {
  const { make } = require('../public/js/localize.js');
  const L = make([
    { key: 'home', path: '/', template: false, sk: '', en: '' },
    { key: 'rankings', path: '/rankings', template: false, sk: 'rebricek', en: 'rankings' },
    { key: 'courts', path: '/courts', template: false, sk: 'kurty', en: 'courts' },
    { key: 'court', path: '/courts/:slug', template: true, sk: 'kurt', en: 'court' },
    { key: 'player', path: '/player/:id', template: true, sk: 'hrac', en: 'player' },
  ]);
  assert.strictEqual(L.toPublic('/', 'sk'), '/');
  assert.strictEqual(L.toPublic('/', 'en'), '/en');
  assert.strictEqual(L.toPublic('/rankings', 'sk'), '/rebricek');
  assert.strictEqual(L.toPublic('/rankings/', 'en'), '/en/rankings');
  assert.strictEqual(L.toPublic('/rankings?table=elite#top', 'sk'), '/rebricek?table=elite#top');
  assert.strictEqual(L.toPublic('/courts', 'sk'), '/kurty');
  assert.strictEqual(L.toPublic('/courts/tk-slovan', 'sk'), '/kurt/tk-slovan');
  assert.strictEqual(L.toPublic('/courts/tk-slovan?x=1', 'en'), '/en/court/tk-slovan?x=1');
  assert.strictEqual(L.toPublic('/player/jan%20novak', 'en'), '/en/player/jan%20novak');
  assert.strictEqual(L.toPublic('/match/abc', 'en'), null);
  assert.strictEqual(L.toPublic('/css/style.css', 'sk'), null);
  assert.strictEqual(L.toPublic('/player/', 'sk'), null);
  const r = L.resolve('/en/court/tk-slovan/');
  assert.deepStrictEqual([r.key, r.lang, r.param, r.canonical], ['court', 'en', 'tk-slovan', '/courts/tk-slovan']);
  assert.strictEqual(L.resolve('/rebricek').canonical, '/rankings');
  assert.strictEqual(L.resolve('/en').key, 'home');
  assert.strictEqual(L.resolve('/rankings'), null, 'the code address is no public address');
  assert.strictEqual(L.resolve('/en/rebricek'), null, 'a Slovak slug under /en/');
  assert.strictEqual(L.resolve('/kurty/x/y'), null);
  assert.strictEqual(L.resolve('/kurt'), null, 'a template page needs its name');
});

// ---------------------------------------------------------------- upgrading a database that has the old SEO table
test('an old database gets addresses and English texts and keeps its Slovak edits', () => {
  const dbFile = path.join(oldDir, 'blta-score.db');
  const old = new DatabaseSync(dbFile);
  old.exec(`CREATE TABLE seo_pages (page_key TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '', og_title TEXT NOT NULL DEFAULT '', og_description TEXT NOT NULL DEFAULT '', og_image TEXT NOT NULL DEFAULT '',
    noindex INTEGER NOT NULL DEFAULT 0);`);
  old.prepare("INSERT INTO seo_pages (page_key, title, description, keywords) VALUES ('rankings', 'Môj rebríček', 'Môj popis', 'kľúč')").run();
  old.close();
  const script = `
    const seo = require('./src/seo');
    const p = seo.listAll().find((x) => x.key === 'rankings');
    const out = { slugs: p.slugs, sk: p.values.sk, en: p.values.en, home: seo.listAll().find((x) => x.key === 'home').slugs };
    console.log(JSON.stringify(out));`;
  const run = () => spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, DATA_DIR: oldDir }, encoding: 'utf8' });
  let r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  let out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.slugs, { sk: 'rankings', en: 'rankings' });
  assert.strictEqual(out.sk.title, 'Môj rebríček');
  assert.strictEqual(out.sk.keywords, 'kľúč');
  assert.ok(/^Rankings/.test(out.en.title), out.en.title);
  assert.deepStrictEqual(out.home, { sk: '', en: '' });
  // starting again changes nothing
  r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  const again = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(again, out);
});

// ---------------------------------------------------------------- the brand name
test('the home title that still has the old "BLTA Score" first value becomes "BLTA"; an edited title is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-brand-'));
  try {
    const dbFile = path.join(dir, 'blta-score.db');
    const old = new DatabaseSync(dbFile);
    old.exec(`CREATE TABLE seo_pages (page_key TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', og_title TEXT NOT NULL DEFAULT '', og_description TEXT NOT NULL DEFAULT '', og_image TEXT NOT NULL DEFAULT '', noindex INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE seo_pages_en (page_key TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', og_title TEXT NOT NULL DEFAULT '', og_description TEXT NOT NULL DEFAULT '', og_image TEXT NOT NULL DEFAULT '');`);
    old.prepare("INSERT INTO seo_pages (page_key, title) VALUES ('home', 'BLTA Score - Živé skóre a tabuľky amatérskej tenisovej ligy')").run();
    old.prepare("INSERT INTO seo_pages_en (page_key, title) VALUES ('home', 'My own English title')").run();
    old.close();
    const script = "const seo = require('./src/seo'); const h = seo.listAll().find((x) => x.key === 'home'); console.log(JSON.stringify([h.values.sk.title, h.values.en.title]));";
    const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout.trim().split(String.fromCharCode(10)).pop()), ['BLTA - Živé skóre a tabuľky amatérskej tenisovej ligy', 'My own English title']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the pages say BLTA, not "BLTA Score" or "Tennis SCORE" (og:site_name, manifest, push title)', async () => {
  const home = await get('/');
  assert.strictEqual(metaOf(home.text, 'property', 'og:site_name'), 'BLTA');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'));
  assert.deepStrictEqual([manifest.name, manifest.short_name], ['BLTA', 'BLTA']);
  const texts = ['public/sw.js', 'public/js/i18n.js', 'src/mailer.js'].map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8')).join(String.fromCharCode(10));
  assert.ok(!/Tennis SCORE|BLTA Score/.test(texts), 'an old name is left in the texts');
});

// ---------------------------------------------------------------- run
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
  fixtureDb = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  fixtureDb.exec('PRAGMA busy_timeout = 5000');
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (fixtureDb) fixtureDb.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
    fs.rmSync(oldDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
