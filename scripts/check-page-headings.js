// Checks the headings of the public pages (not the home page: check-home-headings.js): ONE descriptive H1 written into the HTML in the language of the page, an intro under it,
// the sections of a page as H2s, and the static texts of a page file (data-i18n) written by the server in the language of the page (English under /en/, not Slovak until a script runs).
// Run: node scripts/check-page-headings.js   (starts its own server on a temporary data directory)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-headings-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const html = async (url) => (await fetch(BASE + url)).text();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const h1Of = (page) => ((/<h1[^>]*>([^<]*)<\/h1>/.exec(page) || [])[1] || '').trim();
const introOf = (page) => ((/<p class="page-intro"[^>]*>([^<]*)<\/p>/.exec(page) || [])[1] || '').trim();

const SK = [
  ['/tables', 'Ligové tabuľky BLTA', 'Aktuálne poradie hráčov'],
  ['/rankings', 'Rebríček hráčov BLTA', 'Bodové poradie hráčov'],
  ['/players', 'Hráči amatérskej tenisovej ligy BLTA', 'Komunita rekreačných a amatérskych tenistov v Bratislave.'],
  ['/courts', 'Tenisové kurty v Bratislave', 'Prehľad tenisových kurtov v Bratislave'],
  ['/harmonogram', 'Harmonogram ligy a turnajov BLTA', 'Rozpis sezón a turnajov'],
  ['/vitazi', 'Víťazi ligy a turnajov BLTA', 'Víťazi, finalisti a semifinalisti'],
  ['/rezervacie-kurtov', 'Rezervácie tenisových kurtov', 'Vyber si voľný termín'],
  ['/komunity-a-kluby', 'Komunity a kluby amatérskych tenistov', 'Skupiny hráčov'],
  ['/propozicie', 'Propozície BLTA: pravidlá ligy a turnajov', 'Kompletné a aktuálne pravidlá'],
];
const EN = [
  ['/en/tables', 'BLTA league tables', 'The current standings'],
  ['/en/courts', 'Tennis courts in Bratislava', 'An overview of the tennis courts in Bratislava'],
  ['/en/schedule', 'BLTA league and tournament schedule', 'The schedule of the seasons'],
  ['/en/winners', 'BLTA league and tournament winners', 'The winners, finalists'],
];

test('the Slovak pages have one H1 that says what the page is (with the brand or the place) and an intro under it, all in the HTML', async () => {
  for (const [url, h1, intro] of SK) {
    const page = await html(url);
    assert.strictEqual((page.match(/<h1[ >]/g) || []).length, 1, `${url}: one H1`);
    assert.strictEqual(h1Of(page), h1, `${url}: H1`);
    assert.ok(introOf(page).startsWith(intro), `${url}: intro (${introOf(page).slice(0, 50)})`);
    assert.ok(page.indexOf('<h1') < page.indexOf('class="page-intro"'), `${url}: the intro is under the H1`);
  }
});

test('the English pages are English in the HTML a crawler reads (the heading and the intro), not Slovak until a script runs', async () => {
  for (const [url, h1, intro] of EN) {
    const page = await html(url);
    assert.strictEqual(h1Of(page), h1, `${url}: H1`);
    assert.ok(introOf(page).startsWith(intro), `${url}: intro (${introOf(page).slice(0, 50)})`);
  }
  const looking = await html('/en/looking-to-play');
  assert.strictEqual(h1Of(looking), 'Looking for a tennis opponent in Bratislava');
});

test('the matches page and the blog have a descriptive H1 as well (the matches page draws none of its own: it is there for screen readers and crawlers)', async () => {
  const matches = await html('/matches');
  assert.ok(/<div class="ssr-intro sr-only"><h1>Zápasy amatérskej tenisovej ligy BLTA<\/h1><p>/.test(matches), 'matches');
  assert.ok((await html('/en/matches')).includes('<h1>BLTA amateur tennis league matches</h1>'), 'matches, English');
  assert.strictEqual(h1Of(await html('/blog')), 'Blog BLTA – novinky z amatérskeho tenisu');
  assert.strictEqual(h1Of(await html('/en/blog')), 'BLTA blog – amateur tennis news');
});

test('the new texts exist once per language (a key written twice would be overridden by the older one) and every key a page file points at exists', () => {
  const i18n = read('public/js/i18n.js');
  ['tables', 'rankings', 'players', 'courts', 'schedule', 'winners', 'rv', 'com', 'rules'].forEach((p) => {
    ['h1', p === 'players' ? 'leagueIntro' : 'intro'].forEach((suffix) => {
      assert.strictEqual((i18n.match(new RegExp(`^    '${p}\\.${suffix}':`, 'gm')) || []).length, 2, `${p}.${suffix}: once in Slovak, once in English`);
    });
  });
  assert.strictEqual((i18n.match(/^    'lookingToPlay\.h1':/gm) || []).length, 2);
  const { has } = require('../src/browserTexts');
  ['tables', 'rankings', 'players', 'courts', 'harmonogram', 'vitazi', 'reservations', 'communities', 'looking-to-play', 'propozicie'].forEach((f) => {
    [...read(`public/${f}.html`).matchAll(/data-i18n="([^"]+)"/g)].forEach((m) => assert.ok(has(m[1]), `${f}.html: ${m[1]}`));
  });
});

test('the sections of the pages are H2s: matches (live, planned…), schedule months, winners editions, courts, player sections, season tabs', () => {
  assert.strictEqual((read('public/js/app.js').match(/<h2 class="match-list-heading">/g) || []).length, 4, 'matches page');
  assert.ok(!read('public/js/app.js').includes('<div class="match-list-heading">'), 'no heading left as a div');
  assert.ok(read('public/js/harmonogram.js').includes('<h2 class="sch-month-title">'), 'schedule months');
  assert.ok(read('public/js/vitazi.js').includes('<h2 class="l">${escapeHtml(e.title)}</h2>'), 'winners editions');
  assert.ok(read('public/js/courts.js').includes('<h2 class="court-card-name">'), 'courts');
  const player = read('public/js/player.js') + read('public/player.html') + read('public/js/h2h.js');
  assert.ok(!/<div class="section-label"/.test(player), 'player sections');
  assert.ok(read('public/js/player.js').includes('<div class="section-label-line"><h2 class="section-label">'), 'the info button stays out of the heading');
  assert.ok(read('public/js/season.js').includes('<h2 class="sr-only">${escapeHtml(open.label)}</h2>'), 'the open tab of a season has a heading');
});

test('the page of a player and of a bracket get their name in the H1 in the HTML (not "Loading…")', () => {
  assert.ok(read('public/bracket.html').includes('id="bracket-title"') && read('public/player.html').includes('id="player-name"'), 'the files keep their heading ids');
  const seo = read('src/seo.js');
  assert.ok(seo.includes('const NAME_HEADING') && seo.includes('entity.name'), 'the server writes the name');
});

let child = null;
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
}

(async () => {
  let failed = 0;
  try {
    await startServer();
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* the server still holds the file for a moment: the temporary folder stays */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300); // a moment for the killed server's pipes to close (an immediate exit can crash node on Windows)
})();
