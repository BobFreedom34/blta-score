// Checks the headings of the home page: ONE H1 with the name of the league (and a short intro under it) written into the HTML in the language of the page, the section titles
// as real H2s, and the footer's group titles not being headings. Run: node scripts/check-home-headings.js   (starts its own server on a temporary data directory)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-headings-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const html = async (url) => (await fetch(BASE + url)).text();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the Slovak home page has one H1, "BLTA – Bratislavská Liga tenisových amatérov", with the intro under it, then the buttons, all in the HTML', async () => {
  const page = await html('/');
  assert.strictEqual((page.match(/<h1[ >]/g) || []).length, 1, 'one H1');
  assert.ok(page.includes('<h1 class="home-h1">BLTA – Bratislavská Liga tenisových amatérov</h1>'), 'H1 text');
  assert.ok(!page.includes('home-kicker'), 'no small label above the H1');
  assert.ok(/<p class="home-intro">Amatérska tenisová liga pre rekreačných hráčov v Bratislave\./.test(page), 'intro');
  assert.ok(page.indexOf('<h1') < page.indexOf('class="home-intro"') && page.indexOf('class="home-intro"') < page.indexOf('class="home-head-actions"') && page.indexOf('class="home-head-actions"') < page.indexOf('id="home-season-card"'), 'order: H1, intro, buttons, the card of the season');
  ['home-auth', 'home-about-btn', 'home-state', 'home-sub', 'home-head-logo-link'].forEach((id) => assert.ok(page.includes(`"${id}`) || page.includes(`id="${id}`), `${id} is still there for home.js`));
});

test('the English home page says the same in English (not the Slovak text until a script runs)', async () => {
  const page = await html('/en');
  assert.ok(page.includes('<h1 class="home-h1">BLTA – Bratislava Amateur Tennis League</h1>'));
  assert.ok(/<p class="home-intro">An amateur tennis league for recreational players in Bratislava\./.test(page));
});

test('the footer group titles (Liga, Hrať, Komunita) are not H2s of the page', async () => {
  const page = await html('/');
  assert.ok(!/<h2 class="sf-h">/.test(page), 'no heading');
  assert.ok(/<p class="sf-h">Liga<\/p>/.test(page), 'still drawn as the same label');
});

test('the section titles of the home page are H2s with the link outside the heading, and the links say where they go', () => {
  const rows = read('public/js/match-rows.js');
  assert.ok(rows.includes('heading = true) {') && rows.includes("heading ? 'h2' : 'div'") && /<\/\$\{tag\}>\$\{linkHref/.test(rows), 'secTitle: an h2 by default, the link after it (outside the heading)');
  const home = read('public/js/home.js');
  assert.ok(home.includes("secTitle(t('home.mine'), note, '', '', false)"), 'My season (only a signed-in player sees it) is not a heading');
  assert.ok(!/<h[1-6]/.test(read('public/js/home-carousel.js')), 'the slides of the carousel have no headings');
  ['home.allResults', 'home.allUpcoming', 'home.wholeRanking', 'home.allLooking'].forEach((k) => assert.ok(home.includes(`t('${k}')`), `${k} on a link`));
  ["t('home.all')", "t('home.whole')", "t('home.everyone')"].forEach((k) => assert.ok(!home.includes(k), `${k} is not left on the home page`));
});

test('the texts of another city: its brand, the full name of the league and the city in the 6th case (nothing about Bratislava)', () => {
  const { t } = require('../src/browserTexts');
  assert.strictEqual(t('home.h1City', 'sk', { brand: 'SLTA Košice', place: ' v Košiciach' }), 'SLTA Košice – Slovenská liga tenisových amatérov v Košiciach');
  assert.strictEqual(t('home.h1City', 'sk', { brand: 'SLTA Košice', place: '' }), 'SLTA Košice – Slovenská liga tenisových amatérov', 'no place written yet');
  assert.strictEqual(t('home.h1City', 'en', { brand: 'SLTA Košice', place: ' in Košice' }), 'SLTA Košice – Slovak Amateur Tennis League in Košice');
  assert.ok(t('home.introCity', 'sk', { place: ' v Košiciach' }).startsWith('Amatérska tenisová liga pre rekreačných hráčov v Košiciach. Hraj'));
  ['sk', 'en'].forEach((lang) => assert.ok(!/Bratislav/.test(t('home.introCity', lang, { place: '' })), `introCity ${lang}`));
});

test('every new key exists in both languages', () => {
  const { t } = require('../src/browserTexts');
  ['home.h1', 'home.h1City', 'home.intro', 'home.introCity', 'home.latestResults', 'home.allResults', 'home.allUpcoming', 'home.wholeRanking', 'home.allLooking'].forEach((k) => {
    ['sk', 'en'].forEach((lang) => assert.notStrictEqual(t(k, lang, { brand: 'X' }), k, `${k} (${lang})`));
  });
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
