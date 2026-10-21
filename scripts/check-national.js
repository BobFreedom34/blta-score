// Checks of the national site slta.sk (src/national.js): on its host the app serves the national page (the picker of the cities, in Slovak and
// English, with slta.sk as its address and its own sitemap), the files the page needs and the public list of the cities; any other page address
// goes on to blta.sk and anything else is not found. The other hosts (blta.sk) never serve the national page and do not list it.
// The site can be locked with a password (Backend > Cities) and is hidden from search engines: the page and the list of the cities ask for the
// password, a wrong one is refused (and counted), the right one gives a cookie, a new password cancels the old cookies, and every answer, the
// robots.txt and the sitemap tell search engines to stay away until the page is switched on in Backend > SEO.
// Run: node scripts/check-national.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'national-'));
const port = 3100 + Math.floor(Math.random() * 800);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
const setNoindex = (on) => { const db = new DatabaseSync(path.join(dir, 'blta-score.db')); db.prepare("UPDATE seo_pages SET noindex = ? WHERE page_key = 'slta'").run(on ? 1 : 0); db.close(); };

// a request with the Host header of the site it is meant for (fetch will not send one)
function as(host, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: 'localhost', port, path: url, method, headers: { Host: host, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const admin = (method, url, body) => as('localhost', url, { method, body, headers: { 'Content-Type': 'application/json', Cookie: adminCookie } });
const unlock = (host, password, lang = 'sk') => as(host, '/unlock', { method: 'POST', body: `password=${encodeURIComponent(password)}&lang=${lang}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
const cookieOf = (r) => ((r.headers['set-cookie'] || [])[0] || '').split(';')[0];

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

test('slta.sk starts hidden from search engines: tag, header, robots.txt and an empty sitemap', async () => {
  const page = await as('slta.sk', '/');
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(page.body), 'the page says noindex');
  assert.strictEqual(page.headers['x-robots-tag'], 'noindex, nofollow');
  const robots = await as('slta.sk', '/robots.txt');
  assert.ok(/Disallow: \/\s*$/m.test(robots.body) && !robots.body.includes('Sitemap'), 'robots.txt closes everything');
  const sm = await as('slta.sk', '/sitemap.xml');
  assert.ok(!sm.body.includes('<loc>'), 'nothing in the sitemap');
  assert.ok(!(await as('blta.sk', '/')).headers['x-robots-tag'], 'blta.sk is not hidden');
});

test('slta.sk switched on in Backend > SEO: its own sitemap and robots.txt', async () => {
  setNoindex(false);
  const page = await as('slta.sk', '/');
  assert.ok(/<meta name="robots" content="index, follow/.test(page.body), 'the page may be indexed');
  assert.ok(!page.headers['x-robots-tag'], 'no header any more');
  const sm = await as('slta.sk', '/sitemap.xml');
  assert.strictEqual(sm.status, 200);
  assert.ok(sm.body.includes('<loc>https://slta.sk/</loc>') && sm.body.includes('<loc>https://slta.sk/en</loc>'), 'both languages of the main page');
  assert.ok(!sm.body.includes('/season/') && !sm.body.includes('/players'), 'nothing of blta.sk');
  const robots = await as('slta.sk', '/robots.txt');
  assert.ok(robots.body.includes('Sitemap: https://slta.sk/sitemap.xml'));
  setNoindex(true);
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

test('the carousel of the national page: its own slides, edited by the super admin only, shown in the page', async () => {
  assert.deepStrictEqual(JSON.parse((await as('slta.sk', '/api/leagues/carousel')).body), [], 'no slides at first');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const send = async (url) => { const f = new FormData(); f.append('image', new Blob([png], { type: 'image/png' }), 's.png'); const r = await fetch(`http://localhost:${port}${url}`, { method: 'POST', body: f, headers: { Cookie: adminCookie } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const nationalSlide = await send('/api/carousel?scope=national');
  assert.strictEqual(nationalSlide.status, 201);
  const citySlide = await send('/api/carousel');
  assert.strictEqual(citySlide.status, 201);
  assert.strictEqual((await admin('PATCH', `/api/carousel/${nationalSlide.json.id}`, { captionSk: 'Vitaj v SLTA', captionEn: 'Welcome to SLTA', subtextSk: 'Liga vo vasom meste', link: '/en' })).status, 200);
  const list = JSON.parse((await as('slta.sk', '/api/leagues/carousel')).body);
  assert.deepStrictEqual(list.map((s) => s.id), [nationalSlide.json.id], 'only the national slide, not the one of Bratislava');
  assert.strictEqual(list[0].captionSk, 'Vitaj v SLTA');
  assert.deepStrictEqual(JSON.parse((await as('blta.sk', '/api/carousel')).body).map((s) => s.id), [citySlide.json.id], 'blta.sk keeps its own carousel');
  assert.deepStrictEqual(JSON.parse((await admin('GET', '/api/carousel/all?scope=national')).body).map((s) => s.id), [nationalSlide.json.id]);
  assert.deepStrictEqual(JSON.parse((await admin('GET', '/api/carousel/all')).body).map((s) => s.id), [citySlide.json.id]);
  const page = await as('slta.sk', '/');
  assert.ok(page.body.includes('id="home-carousel"') && page.body.includes('/api/leagues/carousel'), 'the page shows it');
  assert.ok(!page.body.includes('/api/leagues/featured'), 'not the slider of the seasons');
});

test('the Registration button of a city leads to a page that exists: the season page at its own address, in both languages', async () => {
  const city = JSON.parse((await as('slta.sk', '/api/leagues')).body)[0];
  assert.ok(city.currentSeason, 'the first city has a running or coming season');
  const { path: p } = city.currentSeason;
  assert.ok(p && p.sk && p.en && p.en.startsWith('/en/'), JSON.stringify(p));
  assert.strictEqual((await as('blta.sk', p.sk)).status, 200, p.sk);
  assert.strictEqual((await as('blta.sk', p.en)).status, 200, p.en);
  // a season page whose address was changed in Backend > SEO (blta.sk: /sezona/...) is NOT at the code address any more: the button must use the real one
  const code = `/season/${city.currentSeason.slug}`;
  if (p.sk !== code) assert.strictEqual((await as('blta.sk', code)).status, 404, 'the code address is retired: that was the broken link');
});

test('the Registration button leads to the season that takes registrations, not to a running one whose registration is closed', async () => {
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const today = new Date().toISOString().slice(0, 10);
  const running = db.prepare("SELECT slug FROM seasons WHERE league_id = 1 AND kind = 'LEAGUE' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) LIMIT 1").get(today, today);
  const coming = db.prepare("SELECT slug FROM seasons WHERE league_id = 1 AND kind = 'LEAGUE' AND start_date > ? ORDER BY start_date LIMIT 1").get(today);
  assert.ok(running && coming, 'a running and a coming season');
  db.prepare("UPDATE seasons SET registration_open = 0 WHERE slug = ?").run(running.slug);
  db.prepare("UPDATE seasons SET registration_open = 1 WHERE slug = ?").run(coming.slug);
  const city = JSON.parse((await as('slta.sk', '/api/leagues')).body)[0];
  assert.strictEqual(city.registrationOpen, true);
  assert.strictEqual(city.registrationSeason.slug, coming.slug, 'the coming season takes registrations');
  assert.ok(city.registrationSeason.path.sk.endsWith(coming.slug) && city.registrationSeason.path.en.startsWith('/en/'));
  assert.strictEqual((await as('blta.sk', city.registrationSeason.path.sk)).status, 200);
  // nothing open anywhere: no season to register to
  db.prepare("UPDATE seasons SET registration_open = 0 WHERE league_id = 1").run();
  const closed = JSON.parse((await as('slta.sk', '/api/leagues')).body)[0];
  assert.strictEqual(closed.registrationOpen, false);
  assert.strictEqual(closed.registrationSeason, null);
  // and the running season is the one when it is the only one that is open
  db.prepare("UPDATE seasons SET registration_open = 1 WHERE slug = ?").run(running.slug);
  assert.strictEqual(JSON.parse((await as('slta.sk', '/api/leagues')).body)[0].registrationSeason.slug, running.slug);
  db.prepare("UPDATE seasons SET registration_open = 1 WHERE league_id = 1").run();
  db.close();
});

test('the block for new organisers: how to reach us comes from the contact of the site, only the public part of it', async () => {
  const page = await as('slta.sk', '/');
  assert.ok(page.body.includes('id="organizator"') && page.body.includes('Chceš sa stať organizátorom ligy vo svojom meste?'), 'the block is on the page');
  assert.ok(page.body.includes('href="#organizator"'), 'and in the menu');
  assert.ok(/Want to become the organiser of a league in your city?/.test((await as('slta.sk', '/en')).body === '' ? '' : page.body), 'English text is in the page too');
  const r = await as('slta.sk', '/api/leagues/contact');
  assert.strictEqual(r.status, 200);
  const c = JSON.parse(r.body);
  assert.deepStrictEqual(Object.keys(c).sort(), ['email', 'phone', 'whatsappUrl'], 'no address, IBAN or other details');
  assert.ok(/@/.test(c.email));
});

test('the card of a city: players, categories, seasons played and tournaments played', async () => {
  const get = async () => JSON.parse((await as('slta.sk', '/api/leagues')).body)[0];
  const before = await get();
  assert.strictEqual(before.categories, 3, 'a league season has all three categories');
  assert.deepStrictEqual(before.categoryList, ['ELITE', 'NEXT_GEN', 'NOVICE']);
  assert.ok(before.lastSeason, 'the season that ended last is named');
  assert.ok(Number.isInteger(before.seasonsPlayed) && Number.isInteger(before.tournamentsPlayed), 'numbers');
  assert.ok(before.seasonsPlayed >= 1, 'the seasons that are over are counted');
  const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const made = (await admin('POST', '/api/seasons', { name: 'Finished Cup', startDate: iso(-30), endDate: iso(-28), kind: 'TOURNAMENT', categories: ['ELITE'] }));
  assert.strictEqual(made.status, 201, made.body);
  await admin('POST', '/api/seasons', { name: 'Coming Cup', startDate: iso(20), endDate: iso(21), kind: 'TOURNAMENT', categories: ['ELITE'] });
  const after = await get();
  assert.strictEqual(after.tournamentsPlayed, before.tournamentsPlayed + 1, 'only the tournament that is over is counted');
  assert.strictEqual(after.seasonsPlayed, before.seasonsPlayed, 'a tournament is not a season');
  assert.strictEqual(after.lastTournament, 'Finished Cup', 'the tournament that ended last is named');
});

test('the schedule of a city on the national page: what runs now first (the league), then the next year, with real links', async () => {
  const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const make = async (name, start, end, kind) => JSON.parse((await admin('POST', '/api/seasons', { name, startDate: start, endDate: end, kind })).body);
  await make('Running Tournament', iso(-2), iso(3), 'TOURNAMENT');
  await make('Far Future Cup', iso(500), iso(502), 'TOURNAMENT');
  await make('Spring Cup', iso(40), iso(41), 'TOURNAMENT');
  const r = await as('slta.sk', '/api/leagues/bratislava/schedule?lang=sk');
  assert.strictEqual(r.status, 200);
  const d = JSON.parse(r.body);
  const items = d.items;
  assert.ok(items.length >= 3, 'items');
  assert.strictEqual(items[0].state, 'now');
  assert.strictEqual(items[0].type, 'LEAGUE', 'the running league is the first object');
  const running = items.filter((e) => e.state === 'now');
  assert.ok(running.some((e) => e.name === 'Running Tournament'), 'a running tournament follows the league');
  assert.ok(running.findIndex((e) => e.type === 'LEAGUE') < running.findIndex((e) => e.name === 'Running Tournament'));
  const future = items.filter((e) => e.state === 'future');
  assert.ok(future.some((e) => e.name === 'Spring Cup'), 'upcoming within a year');
  assert.ok(!items.some((e) => e.name === 'Far Future Cup'), 'nothing further than a year');
  assert.ok(items.every((e) => e.endDate >= d.today), 'nothing that is over');
  assert.deepStrictEqual(future.map((e) => e.startDate), [...future.map((e) => e.startDate)].sort(), 'the coming ones soonest first');
  assert.ok(items.every((e) => !e.link || e.link.startsWith('https://blta.sk/')), 'the links lead to the real page on the own domain of the city: ' + items[0].link);
    const en = JSON.parse((await as('slta.sk', '/api/leagues/bratislava/schedule?lang=en')).body);
  assert.ok(en.items[0].link.startsWith('https://blta.sk/en/'), en.items[0].link);
  assert.strictEqual((await as('blta.sk', new URL(items[0].link).pathname)).status, 200, 'and the link works');
  assert.strictEqual((await as('slta.sk', '/api/leagues/nowhere/schedule')).status, 404);
  const page = await as('slta.sk', '/');
  assert.ok(page.body.includes('id="sch"') && page.body.includes('/schedule?lang='), 'the page shows it');
});

test('the lock belongs to the admin: a password of 6 characters or more, never given back', async () => {
  assert.strictEqual((await as('localhost', '/api/leagues/national-lock')).status, 401, 'not for the public');
  assert.strictEqual((await admin('PUT', '/api/leagues/national-lock', { enabled: true })).status, 400, 'a password is needed');
  assert.strictEqual((await admin('PUT', '/api/leagues/national-lock', { enabled: true, password: '12345' })).status, 400, 'too short');
  const on = await admin('PUT', '/api/leagues/national-lock', { enabled: true, password: 'sesame1' });
  assert.strictEqual(on.status, 200);
  assert.deepStrictEqual(JSON.parse(on.body), { locked: true, hasPassword: true });
  assert.ok(!on.body.includes('sesame1'), 'the password is not given back');
});

test('locked: the page and the list of the cities ask for the password, the files of the page and blta.sk do not', async () => {
  const page = await as('slta.sk', '/');
  assert.strictEqual(page.status, 401);
  assert.ok(page.body.includes('name="password"') && page.body.includes('noindex'), 'the password page, never indexed');
  assert.ok(!page.body.includes('id="mesta"'), 'the real page is not in the answer');
  const en = await as('slta.sk', '/en');
  assert.strictEqual(en.status, 401);
  assert.ok(en.body.includes('Enter the password') || en.body.includes('Enter'), 'English');
  assert.strictEqual((await as('slta.sk', '/api/leagues')).status, 401);
  assert.strictEqual((await as('slta.sk', '/css/style.css')).status, 200);
  assert.strictEqual((await as('slta.sk', '/matches')).status, 302, 'other pages still go on to blta.sk');
  assert.strictEqual(page.headers['x-robots-tag'], 'noindex, nofollow');
  assert.strictEqual((await as('blta.sk', '/')).status, 200, 'blta.sk is open');
  assert.strictEqual((await as('blta.sk', '/api/leagues')).status, 200);
  assert.ok(/Disallow: \//.test((await as('slta.sk', '/robots.txt')).body));
});

test('a wrong password is refused, the right one gives a cookie for the page and the list', async () => {
  const wrong = await unlock('slta.sk', 'nope');
  assert.strictEqual(wrong.status, 401);
  assert.ok(wrong.body.includes('Nesprávne heslo'));
  assert.ok(!cookieOf(wrong), 'no cookie');
  const right = await unlock('slta.sk', 'sesame1');
  assert.strictEqual(right.status, 302);
  assert.strictEqual(right.headers.location, '/');
  const cookie = cookieOf(right);
  assert.ok(cookie.startsWith('slta_access='), 'the cookie');
  assert.ok(/HttpOnly/i.test(right.headers['set-cookie'][0]), 'not readable by scripts');
  const page = await as('slta.sk', '/', { headers: { Cookie: cookie } });
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('id="mesta"'), 'the real page');
  assert.strictEqual((await as('slta.sk', '/api/leagues', { headers: { Cookie: cookie } })).status, 200);
  assert.strictEqual((await as('slta.sk', '/', { headers: { Cookie: 'slta_access=1.abc' } })).status, 401, 'a made-up cookie is no good');
  assert.strictEqual((await unlock('slta.sk', 'sesame1', 'en')).headers.location, '/en');
});

test('a new password cancels the cookies of the old one', async () => {
  const old = cookieOf(await unlock('slta.sk', 'sesame1'));
  assert.strictEqual((await as('slta.sk', '/', { headers: { Cookie: old } })).status, 200);
  assert.strictEqual((await admin('PUT', '/api/leagues/national-lock', { enabled: true, password: 'another-one' })).status, 200);
  assert.strictEqual((await as('slta.sk', '/', { headers: { Cookie: old } })).status, 401, 'the old cookie stopped working');
  assert.strictEqual((await unlock('slta.sk', 'sesame1')).status, 401, 'the old password too');
  assert.strictEqual((await as('slta.sk', '/', { headers: { Cookie: cookieOf(await unlock('slta.sk', 'another-one')) } })).status, 200);
});

test('unlocked: the page is open again, still hidden from search engines until it is switched on', async () => {
  const off = await admin('PUT', '/api/leagues/national-lock', { enabled: false });
  assert.deepStrictEqual(JSON.parse(off.body), { locked: false, hasPassword: true });
  const page = await as('slta.sk', '/');
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('id="mesta"'));
  assert.strictEqual(page.headers['x-robots-tag'], 'noindex, nofollow', 'the SEO switch is still off');
  assert.strictEqual((await as('slta.sk', '/api/leagues')).status, 200);
  // the old password is kept: locking again without a new one uses it
  assert.strictEqual((await admin('PUT', '/api/leagues/national-lock', { enabled: true })).status, 200);
  assert.strictEqual((await as('slta.sk', '/')).status, 401);
});

test('too many wrong passwords from one address are stopped', async () => {
  let last = 0;
  for (let i = 0; i < 9; i += 1) last = (await unlock('slta.sk', 'wrong-' + i)).status;
  assert.strictEqual(last, 429);
  assert.strictEqual((await unlock('slta.sk', 'another-one')).status, 429, 'even the right one has to wait');
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
    const login = await fetch(`http://localhost:${port}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
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
