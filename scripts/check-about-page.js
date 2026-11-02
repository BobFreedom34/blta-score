// Checks the page "Info o lige" (/info-o-amaterskej-tenisovej-lige, English /en/about-the-amateur-tennis-league): the text of the "O nás – info o lige" window of the
// home page as a page. It is written into the HTML on the server (src/aboutPage.js runs public/js/about.js and the texts of public/js/i18n.js), listed in
// Backend > SEO and the sitemap, and its menu item is added as the LAST sub-item of "Liga" (src/seasonSeed.js ensureInfoMenuItems).
// Run: node scripts/check-about-page.js   (starts its own server on a temporary data directory; touches nothing else)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const seasonSeed = require('../src/seasonSeed');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'about-page-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function menuDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY);
    CREATE TABLE app_flags (key TEXT PRIMARY KEY);
    CREATE TABLE about_sections (league_id INTEGER NOT NULL, tab TEXT NOT NULL, lang TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', html TEXT NOT NULL DEFAULT '', PRIMARY KEY (league_id, tab, lang));
    CREATE TABLE header_items (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, label_sk TEXT, label_en TEXT, link TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      is_my_profile INTEGER NOT NULL DEFAULT 0, highlight INTEGER NOT NULL DEFAULT 0, league_id INTEGER NOT NULL DEFAULT 1);
  `);
  [1, 2, 3, 4].forEach((id) => db.prepare('INSERT INTO leagues (id) VALUES (?)').run(id));
  const add = (league, label, link, sort, parent = null) => Number(db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order, league_id) VALUES (?, ?, ?, ?, ?, ?)').run(parent, label, label, link, sort, league).lastInsertRowid);
  [1, 2, 3].forEach((league) => {
    const liga = add(league, 'Liga', '#', 1);
    add(league, 'Zápasy', '/matches', 0, liga);
    add(league, 'Propozície', '/propozicie', 5, liga);
  });
  add(4, 'Domov', '/', 0); // a city with no "Liga" item
  db.prepare("INSERT INTO about_sections (league_id, tab, lang, html) VALUES (2, 'us', 'sk', '<p>Text</p>')").run();
  return db;
}
const children = (db, league) => db.prepare("SELECT label_sk, link FROM header_items WHERE league_id = ? AND parent_id = (SELECT id FROM header_items WHERE league_id = ? AND parent_id IS NULL AND label_sk = 'Liga') ORDER BY sort_order, id").all(league, league);

test('"Info o lige" becomes the last sub-item of "Liga" in the first city and in a city that has written its info texts', () => {
  const db = menuDb();
  seasonSeed.ensureInfoMenuItems(db);
  [1, 2].forEach((league) => {
    const kids = children(db, league);
    assert.deepStrictEqual({ ...kids[kids.length - 1] }, { label_sk: 'Info o lige', link: '/about-league' }, `city ${league}: last place`);
    assert.strictEqual(kids.filter((k) => k.link === '/about-league').length, 1);
  });
  assert.strictEqual(db.prepare("SELECT label_en FROM header_items WHERE link = '/about-league' AND league_id = 1").get().label_en, 'League info');
});

test('a city that has written nothing (or has no "Liga" item) is not given a page with nothing on it; it gets the item when it writes its texts', () => {
  const db = menuDb();
  seasonSeed.ensureInfoMenuItems(db);
  assert.ok(!children(db, 3).some((k) => k.link === '/about-league'), 'nothing written: no item');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM header_items WHERE league_id = 4 AND link = '/about-league'").get().n, 0, 'no Liga item: left alone');
  db.prepare("INSERT INTO about_sections (league_id, tab, lang, html) VALUES (3, 'rules', 'en', '<p>Rules</p>')").run();
  seasonSeed.ensureInfoMenuItems(db);
  assert.ok(children(db, 3).some((k) => k.link === '/about-league'), 'written later: added on the next start');
});

test('it runs once per city: a second run adds nothing, and an item an admin deleted stays deleted', () => {
  const db = menuDb();
  seasonSeed.ensureInfoMenuItems(db);
  db.prepare("DELETE FROM header_items WHERE league_id = 1 AND link = '/about-league'").run();
  seasonSeed.ensureInfoMenuItems(db);
  assert.ok(!children(db, 1).some((k) => k.link === '/about-league'), 'not put back');
  assert.strictEqual(children(db, 2).filter((k) => k.link === '/about-league').length, 1, 'not doubled');
});

// ---------------------------------------------------------------- the page
const get = async (url) => {
  const res = await fetch(BASE + url, { redirect: 'manual' });
  return { status: res.status, text: await res.text() };
};
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the Slovak page is written into the HTML: one H1, the five sections of the window, links in the language of the page', async () => {
  const { status, text } = await get('/info-o-amaterskej-tenisovej-lige');
  assert.strictEqual(status, 200);
  assert.strictEqual((text.match(/<h1>/g) || []).length, 1, 'one H1');
  assert.ok(/<h1>Info o amatérskej tenisovej lige<\/h1>/.test(text));
  ['us', 'rules', 'cats', 'dates', 'tour'].forEach((k) => assert.ok(text.includes(`id="about-${k}"`), `section ${k}`));
  assert.ok(text.includes('Čo je to BLTA?') && text.includes('Termíny turnajov'), 'the text of the window, in Slovak');
  assert.ok(text.includes('href="/propozicie"') && text.includes('href="/harmonogram"'), 'its links');
  assert.ok(text.includes('<link rel="canonical" href="http://localhost:' + PORT + '/info-o-amaterskej-tenisovej-lige">'), 'canonical');
  assert.ok(/Winter Opening Series/.test(textOf(text)), 'the cycles of the league are in the text');
});

test('the English page says the same in English, with English links and the other language marked', async () => {
  const { status, text } = await get('/en/about-the-amateur-tennis-league');
  assert.strictEqual(status, 200);
  assert.ok(/<html lang="en"/.test(text) && /<h1>About the amateur tennis league<\/h1>/.test(text));
  assert.ok(text.includes('What is BLTA?') && text.includes('Tournament dates'));
  assert.ok(text.includes('href="/en/propozicie"') || text.includes('href="/en/rules"'), 'links go to the English pages');
  assert.ok(text.includes('hreflang="sk" href="http://localhost:' + PORT + '/info-o-amaterskej-tenisovej-lige"'), 'hreflang sk');
});

test('the button of the home page is a real link to the page, in the language of the home page (so a crawler finds it in the HTML)', async () => {
  const sk = (await get('/')).text;
  assert.ok(sk.includes('<a class="home-about-btn" id="home-about-btn" href="/info-o-amaterskej-tenisovej-lige">'), 'Slovak home');
  const en = (await get('/en')).text;
  assert.ok(en.includes('<a class="home-about-btn" id="home-about-btn" href="/en/about-the-amateur-tennis-league">'), 'English home');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/about.js'), 'utf8');
  assert.ok(js.includes('e.preventDefault();') && js.includes('e.ctrlKey || e.metaKey'), 'a plain click opens the window, Ctrl/Cmd-click follows the link');
});

test('what the city wrote in Backend > Info takes the place of the text that came with the site', async () => {
  const db = new DatabaseSync(path.join(dataDir, 'blta-score.db'));
  db.prepare("INSERT OR REPLACE INTO about_sections (league_id, tab, lang, title, html) VALUES (1, 'us', 'sk', 'Naša liga', '<p>Vlastný text ligy.</p>')").run();
  db.close();
  const { text } = await get('/info-o-amaterskej-tenisovej-lige');
  assert.ok(text.includes('Naša liga') && text.includes('Vlastný text ligy.'), 'the saved text');
  assert.ok(!text.includes('Čo je to BLTA?'), 'instead of the default of that tab');
  assert.ok(text.includes('Propozície BLTA'), 'the other tabs keep theirs');
});

test('the page is in Backend > SEO and in the sitemap in both languages, and the info page script and the menu icon are wired', async () => {
  const sitemap = (await get('/sitemap.xml')).text;
  assert.ok(sitemap.includes('/info-o-amaterskej-tenisovej-lige') && sitemap.includes('/en/about-the-amateur-tennis-league'), 'sitemap');
  const seo = fs.readFileSync(path.join(ROOT, 'src/seo.js'), 'utf8');
  assert.ok(seo.includes("key: 'about-league'") && seo.includes("slugSk: 'info-o-amaterskej-tenisovej-lige'") && seo.includes("slug: 'about-the-amateur-tennis-league'"), 'PAGES and ENGLISH entries');
  const html = fs.readFileSync(path.join(ROOT, 'public/about-league.html'), 'utf8');
  assert.ok(html.includes('<!--PAGE_SSR-->') && html.includes('<!--ABOUT_PAGE-->') && html.includes('/js/about-league.js'), 'page file');
  const common = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  assert.ok(common.includes("'/about-league': 'info'"), 'menu icon');
});

// ---------------------------------------------------------------- run
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
  process.exit(failed ? 1 : 0);
})();
