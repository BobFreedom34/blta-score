// Checks of the structured data (JSON-LD), the readable intro and the security headers of the public pages.
// Run: node scripts/check-structured-data.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-server-'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
let child = null;
let db = null;

const getPage = async (url, headers = {}) => {
  const res = await fetch(BASE + url, { headers, redirect: 'manual' });
  return { status: res.status, text: await res.text(), headers: res.headers };
};
// the JSON-LD graph of a page (all the @graph entries of all its ld+json scripts)
function graphOf(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const data = JSON.parse(m[1].replace(/\\u003c/g, '<'));
    out.push(...(data['@graph'] || [data]));
  }
  return out;
}
const ofType = (graph, type) => graph.find((g) => g['@type'] === type);

// ---------------------------------------------------------------- headers
test('every page answers with the security headers and hides the server software', async () => {
  const r = await getPage('/');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(/camera=\(self\)/.test(r.headers.get('permissions-policy')));
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(/frame-ancestors 'self'/.test(r.headers.get('content-security-policy')));
  assert.ok(/object-src 'none'/.test(r.headers.get('content-security-policy')));
  assert.strictEqual(r.headers.get('x-powered-by'), null);
  // also an API answer and a file
  assert.strictEqual((await getPage('/api/seasons')).headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual((await getPage('/css/style.css')).headers.get('x-content-type-options'), 'nosniff');
});

test('HSTS only goes out over https', async () => {
  assert.strictEqual((await getPage('/')).headers.get('strict-transport-security'), null);
  const r = await getPage('/', { 'X-Forwarded-Proto': 'https' });
  assert.ok(/max-age=\d+/.test(r.headers.get('strict-transport-security')));
});

test('the embeds that other websites put in a frame are not blocked from it', async () => {
  for (const url of ['/embed/live', '/embed/compact', '/embed/rankings', '/compact', '/compactblta']) {
    const r = await getPage(url);
    assert.strictEqual(r.headers.get('x-frame-options'), null, `${url} has X-Frame-Options`);
    assert.ok(!/frame-ancestors/.test(r.headers.get('content-security-policy') || ''), `${url} limits frame-ancestors`);
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  }
});

// ---------------------------------------------------------------- structured data
test('the home page says who the site is: an organisation and a website', async () => {
  const g = graphOf((await getPage('/')).text);
  const org = ofType(g, 'SportsOrganization');
  assert.ok(org, 'no organisation');
  assert.strictEqual(org.name, 'BLTA');
  assert.ok(/\/img\/blta-logo\.png$/.test(org.logo));
  assert.strictEqual(org.sport, 'Tennis');
  const site = ofType(g, 'WebSite');
  assert.ok(site && site.url.endsWith('/'), 'no website');
  assert.ok(!ofType(g, 'BreadcrumbList'), 'the home page has no breadcrumb');
});

test('a season is a sports event with its dates, and has a breadcrumb through Harmonogram', async () => {
  db.prepare("INSERT INTO seasons (name, slug, start_date, end_date) VALUES ('Summer Rally 2026', 'summer-rally-2026', '2026-05-01', '2026-08-31')").run();
  const r = await getPage('/season/summer-rally-2026');
  assert.strictEqual(r.status, 200);
  const g = graphOf(r.text);
  const ev = ofType(g, 'SportsEvent');
  assert.ok(ev, 'no event');
  assert.strictEqual(ev.name, 'Summer Rally 2026');
  assert.strictEqual(ev.startDate, '2026-05-01');
  assert.strictEqual(ev.endDate, '2026-08-31');
  assert.ok(ev.location && ev.organizer && ev.eventStatus);
  const crumbs = ofType(g, 'BreadcrumbList').itemListElement;
  assert.deepStrictEqual(crumbs.map((c) => c.position), [1, 2, 3]);
  assert.strictEqual(crumbs[0].name, 'BLTA');
  assert.strictEqual(crumbs[2].name, 'Summer Rally 2026');
});

test('a tournament carries its venue, its time of day with the time zone of the day, the capacity and the entry fee as an offer', async () => {
  db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, venue, entry_fee, registration_open, day_start, day_end, max_players) VALUES ('Sunday Series 15.11.', 'sunday-series-15-11', 'TOURNAMENT', '2026-11-15', '2026-11-15', 'TKP Nobelko, Nobelovo námestie 6', '10,50 €', 1, '10:00', '12:00', 16)").run();
  db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, entry_fee, registration_open, day_start, day_end) VALUES ('Summer Free Cup', 'summer-free-cup', 'TOURNAMENT', '2026-07-04', '2026-07-04', 'zadarmo', 0, '09:30', '18:00')").run();
  const ev = ofType(graphOf((await getPage('/tournament/sunday-series-15-11')).text), 'SportsEvent');
  assert.ok(ev, 'no event');
  assert.strictEqual(ev.startDate, '2026-11-15T10:00:00+01:00', 'winter: +01:00');
  assert.strictEqual(ev.endDate, '2026-11-15T12:00:00+01:00');
  assert.strictEqual(ev.location.name, 'TKP Nobelko, Nobelovo námestie 6');
  assert.strictEqual(ev.maximumAttendeeCapacity, 16);
  assert.strictEqual(ev.offers.price, '10.5');
  assert.strictEqual(ev.offers.priceCurrency, 'EUR');
  assert.strictEqual(ev.offers.availability, 'https://schema.org/InStock');
  assert.strictEqual(ev.isAccessibleForFree, false);
  const free = ofType(graphOf((await getPage('/tournament/summer-free-cup')).text), 'SportsEvent');
  assert.strictEqual(free.startDate, '2026-07-04T09:30:00+02:00', 'summer: +02:00');
  assert.strictEqual(free.offers.price, '0');
  assert.strictEqual(free.isAccessibleForFree, true);
  assert.strictEqual(free.offers.availability, 'https://schema.org/SoldOut', 'registration closed');
});

test('a season without a start date gets no event (Google lists an event only with a date), but keeps its breadcrumb', async () => {
  db.prepare("INSERT INTO seasons (name, slug) VALUES ('No Dates Cup', 'no-dates-cup')").run();
  const g = graphOf((await getPage('/season/no-dates-cup')).text);
  assert.ok(!ofType(g, 'SportsEvent'));
  assert.ok(ofType(g, 'BreadcrumbList'));
});

test('a player is a person and a court is a place with its address and position', async () => {
  db.prepare("INSERT INTO players (name, slug) VALUES ('Ján Novák', 'jan-novak')").run();
  const person = ofType(graphOf((await getPage('/player/jan-novak')).text), 'Person');
  assert.ok(person);
  assert.strictEqual(person.name, 'Ján Novák');
  assert.strictEqual(person.memberOf.name, 'BLTA');
  db.prepare("INSERT INTO venues (name, slug, area, address, lat, lng, phone, website) VALUES ('TK Slovan', 'tk-slovan', 'Bratislava - Nové Mesto', 'Junácka 6', 48.17, 17.12, '+421900000000', 'https://slovan.example')").run();
  const r = await getPage('/courts/tk-slovan');
  assert.strictEqual(r.status, 200);
  const place = ofType(graphOf(r.text), 'SportsActivityLocation');
  assert.ok(place, 'no place');
  assert.strictEqual(place.name, 'TK Slovan');
  assert.strictEqual(place.address.streetAddress, 'Junácka 6');
  assert.strictEqual(place.address.addressCountry, 'SK');
  assert.deepStrictEqual([place.geo.latitude, place.geo.longitude], [48.17, 17.12]);
  assert.strictEqual(place.telephone, '+421900000000');
  assert.deepStrictEqual(place.sameAs, ['https://slovan.example']);
  const crumbs = ofType(graphOf(r.text), 'BreadcrumbList').itemListElement;
  assert.strictEqual(crumbs.length, 3);
});

test('a fixed page has a two-step breadcrumb; a page that is noindex has no structured data', async () => {
  const crumbs = ofType(graphOf((await getPage('/players')).text), 'BreadcrumbList').itemListElement;
  assert.strictEqual(crumbs.length, 2);
  assert.ok(crumbs[1].item.endsWith('/hraci') || crumbs[1].item.endsWith('/players'), crumbs[1].item);
  assert.ok(!/application\/ld\+json/.test((await getPage('/new-match')).text));
});

test('an English page carries the English language and address', async () => {
  const r = await getPage('/en/players');
  const g = graphOf(r.text);
  const crumbs = ofType(g, 'BreadcrumbList').itemListElement;
  assert.ok(crumbs[1].item.includes('/en/'), crumbs[1].item);
  const home = graphOf((await getPage('/en')).text);
  assert.strictEqual(ofType(home, 'WebSite').inLanguage, 'en');
});

test('a name with a < in it cannot close the script tag', async () => {
  db.prepare("INSERT INTO players (name, slug) VALUES ('A </script><b>x', 'evil-name')").run();
  const r = await getPage('/player/evil-name');
  const scripts = r.text.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  assert.ok(scripts.length >= 1);
  scripts.forEach((s) => assert.ok(!/<\/script>[\s\S]*<\/script>/.test(s) && !/<b>x/.test(s), 'raw < inside the data'));
  assert.ok(graphOf(r.text).some((x) => x.name === 'A </script><b>x'));
});

// ---------------------------------------------------------------- the readable intro
test('the pages that draw everything by script carry a heading and a description in the raw HTML', async () => {
  const season = (await getPage('/season/summer-rally-2026')).text;
  assert.ok(/<div class="ssr-intro"><h1>Summer Rally 2026<\/h1><p>[^<]+<\/p><\/div>/.test(season), 'season intro');
  assert.ok(season.indexOf('ssr-intro') > season.indexOf('id="sv-root"'), 'the intro must sit inside the box the script fills');
  const court = (await getPage('/courts/tk-slovan')).text;
  assert.ok(/<h1>TK Slovan<\/h1>/.test(court), 'court intro');
  assert.ok(court.indexOf('ssr-intro') > court.indexOf('id="court-root"'));
  const matches = (await getPage('/matches')).text;
  assert.ok(/<div class="ssr-intro sr-only"><h1>Zápasy amatérskej tenisovej ligy BLTA<\/h1><p>[^<]+<\/p><\/div>/.test(matches), 'matches intro (hidden variant)');
  const ciq = (await getPage('/courtiq')).text;
  assert.ok(/<h1>[^<]+<\/h1>/.test(ciq.slice(ciq.indexOf('id="ciq-page"'))), 'courtiq intro');
  assert.ok(!/PAGE_SSR/.test(season + court + matches + ciq), 'a marker is left in a page');
});

test('a name in the intro is escaped', async () => {
  const season = db.prepare("INSERT INTO seasons (name, slug, start_date) VALUES ('Cup <i>&</i>', 'cup-escaped', '2026-01-01')").run();
  assert.ok(season);
  const t = (await getPage('/season/cup-escaped')).text;
  assert.ok(t.includes('<h1>Cup &lt;i&gt;&amp;&lt;/i&gt;</h1>'), 'not escaped');
});

test('the page scripts still replace the intro (the loading box is the one they fill)', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/season.html'), 'utf8');
  assert.ok(/id="sv-root"><!--PAGE_SSR-->/.test(html));
  const js = fs.readFileSync(path.join(ROOT, 'public/js/season.js'), 'utf8');
  assert.ok(/rootEl\.innerHTML = /.test(js));
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
  db = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  db.exec('PRAGMA busy_timeout = 5000');
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
    try { if (db) db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
