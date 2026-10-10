// Checks of the blog: the HTML sanitizer, the four articles of the old website (their addresses, meta texts and dates as they were there), the pages
// (/blog, an article in Slovak and English), what the sitemap and robots say, and Backend > Blog (create, edit, change the address, draft, delete, upload).
// Run: node scripts/check-blog.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { sanitizeHtml } = require('../src/htmlSanitize');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;

async function call(method, url, { body, cookie = '', headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); } else if (body instanceof FormData) payload = body;
  const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, json, res };
}
const get = (url) => call('GET', url);
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });
const tag = (html, re) => (re.exec(html) || [])[1];
const titleOf = (html) => tag(html, /<title>([^<]*)<\/title>/);
const descOf = (html) => tag(html, /<meta name="description" content="([^"]*)"/);
const canonicalOf = (html) => tag(html, /<link rel="canonical" href="([^"]*)"/);

// ---------------------------------------------------------------- the sanitizer
test('sanitizer: scripts, styles, frames, event handlers and bad addresses go; the article tags stay', () => {
  const clean = (x) => sanitizeHtml(x);
  assert.strictEqual(clean('<p onclick="x()">Hi <script>alert(1)</script>there</p>'), '<p>Hi there</p>');
  assert.strictEqual(clean('<style>p{x:y}</style><p>a</p>'), '<p>a</p>');
  assert.strictEqual(clean('<iframe src="https://evil.example"></iframe><p>a</p>'), '<p>a</p>');
  assert.strictEqual(clean('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.strictEqual(clean('<a href="  JaVaScRiPt:alert(1)">x</a>'), '<a>x</a>');
  assert.strictEqual(clean('<a href="java\tscript:alert(1)">x</a>'), '<a>x</a>');
  assert.strictEqual(clean('<a href="data:text/html;base64,AAAA">x</a>'), '<a>x</a>');
  assert.strictEqual(clean('<img src="data:image/svg+xml;base64,AAAA" alt="x">'), '');
  assert.strictEqual(clean('<img src="x" onerror="alert(1)">'), '', 'a picture without an address of a site is nothing');
  assert.strictEqual(clean('<img src="/img/a.png" onerror="alert(1)" style="x:y" alt="A">'), '<img src="/img/a.png" alt="A" loading="lazy" />');
  assert.strictEqual(clean('<a href="https://example.com/x?a=1&b=2" onclick="x" style="color:red">go</a>'), '<a href="https://example.com/x?a=1&amp;b=2" target="_blank" rel="noopener">go</a>');
  assert.strictEqual(clean('<a href="/blog">in</a> <a href="#top">up</a> <a href="mailto:a@b.sk">m</a>'), '<a href="/blog">in</a> <a href="#top">up</a> <a href="mailto:a@b.sk">m</a>');
  // the broken tags only leave text behind (harmless as text): nothing in it can start a script
  assert.ok(!/</.test(clean('<scr<script>ipt>alert(1)</scr</script>ipt>')), clean('<scr<script>ipt>alert(1)</scr</script>ipt>'));
  assert.strictEqual(clean('<svg onload=alert(1)><p>a</p></svg>'), '', 'a whole svg goes');
  assert.ok(!/<form|<input|<button/i.test(clean('<form action="/x"><input name=a><button>b</button></form>')));
  assert.strictEqual(clean('<div class="x"><span style="a:b">text</span></div>'), 'text', 'layout tags go, the text stays');
  assert.strictEqual(clean('<h1>Big</h1><h6>Small</h6>'), '<h2>Big</h2><h5>Small</h5>');
  assert.strictEqual(clean('<p>one<p>two'), '<p>one<p>two</p></p>', 'open tags are closed');
  assert.strictEqual(clean('</p></div>text'), 'text');
  assert.strictEqual(clean('<p>a</p><p>&nbsp;</p><p></p>'), '<p>a</p>', 'empty paragraphs go');
  assert.strictEqual(clean('<ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote><hr />'), '<ul><li>a</li><li>b</li></ul><blockquote><p>q</p></blockquote><hr />');
  assert.strictEqual(clean('a < b and c > d &amp; e'), 'a &lt; b and c > d &amp; e');
  assert.strictEqual(clean('<!-- note --><p>a</p>'), '<p>a</p>');
  assert.strictEqual(clean('<a href="x" title=\'say "hi"\'>y</a>'), '<a title="say &quot;hi&quot;">y</a>');
  assert.strictEqual(clean(null), '');
});

// ---------------------------------------------------------------- the articles of the old website
const OLD = [
  { sk: '/co-je-blta-a-preco-vznikla', en: '/en/what-is-blta-and-why-was-it-created',
    titleSk: 'Čo je BLTA a prečo vznikla? - BLTA - Bratislavská Liga Tenisových Amatérov', descSk: 'BLTA - je amatérska tenisová liga vytvorená športovcami pre športovcov. Nie profesionálmi. Nie sponzormi. Nie agentúrami.',
    titleEn: 'What is BLTA and why was it created? - BLTA - Bratislava Amateur Tennis League', published: '2025-04-17T15:27:29.000Z', image: 'Co-je-BLTA-a-preco-vznikla.png' },
  { sk: '/nove-tricka-pre-blta', en: '/en/nove-tricka-pre-blta',
    titleSk: 'Nové tričká pre BLTA - BLTA - Bratislavská Liga Tenisových Amatérov', descSk: 'Bratislavská liga tenisových amatérov (BLTA) prináša hráčom ďalšiu novinku – oficiálne ligové tričká.',
    titleEn: 'Nové tričká pre BLTA - BLTA - Bratislavská Liga Tenisových Amatérov', published: '2025-08-31T20:43:44.000Z', image: 'Tricka-Amaterska-tenisova-liga-BLTA.jpg' },
  { sk: '/tenisove-turnaje-pre-amaterov', en: '/en/tenisove-turnaje-pre-amaterov',
    titleSk: 'Tenisové turnaje pre amatérov - BLTA - Bratislavská Liga Tenisových Amatérov', descSk: 'BLTA - je amatérska tenisová liga vytvorená športovcami pre športovcov. Nie profesionálmi. Nie sponzormi. Nie agentúrami.',
    titleEn: 'Tenisové turnaje pre amatérov - BLTA - Bratislavská Liga Tenisových Amatérov', published: '2025-08-22T19:27:16.000Z', image: 'Co-je-BLTA-a-preco-vznikla.png' },
  { sk: '/rozhovor-s-tomasom-podhornym-hracom-blta', en: '/en/rozhovor-s-tomasom-podhornym-hracom-blta',
    titleSk: 'Rozhovor s Tomášom Podhorným - Hráčom BLTA - BLTA - Bratislavská Liga Tenisových Amatérov', descSk: 'BLTA – Bratislavská tenisová liga amatérov prináša do hlavného mesta nový vietor v amatérskom tenise. O tom, prečo sa oplatí zapojiť práve do našej ligy a tenisových turnajov pre amatérov, sme sa porozprávali s hráčom BLTA, Tomášom Podhorným.',
    titleEn: 'Rozhovor s Tomášom Podhorným - Hráčom BLTA - BLTA - Bratislavská Liga Tenisových Amatérov', published: '2025-09-30T19:03:33.000Z', image: 'Vypletanie-rakiet-bratislava-3.jpg' },
];

test('the four articles of the old website are there with the same addresses, titles, descriptions and dates', async () => {
  for (const a of OLD) {
    const sk = await get(a.sk);
    assert.strictEqual(sk.status, 200, a.sk);
    assert.strictEqual(titleOf(sk.text), a.titleSk, a.sk);
    assert.strictEqual(descOf(sk.text), a.descSk, a.sk);
    assert.strictEqual(canonicalOf(sk.text), `${BASE}${a.sk}`);
    assert.ok(sk.text.includes(`property="og:title" content="${a.titleSk}"`), 'og:title is the title tag');
    assert.ok(sk.text.includes('property="og:type" content="article"'));
    assert.ok(sk.text.includes(`article:published_time" content="${a.published}"`), a.published);
    assert.ok(new RegExp(`property="og:image" content="[^"]*${a.image}"`).test(sk.text), a.image);
    assert.ok(sk.text.includes(`rel="alternate" hreflang="en" href="${BASE}${a.en}"`), 'the English address is the alternate');
    assert.ok(sk.text.includes('"@type":"Article"'), 'structured data');
    assert.ok(sk.text.includes('<article class="blog-article">') && sk.text.includes('class="blog-body"'), 'the text is in the HTML');
    const en = await get(a.en);
    assert.strictEqual(en.status, 200, a.en);
    assert.strictEqual(titleOf(en.text), a.titleEn, a.en);
    assert.strictEqual(canonicalOf(en.text), `${BASE}${a.en}`);
    assert.ok(en.text.includes('<html lang="en"'));
    assert.strictEqual((await get(`${a.sk}/`)).status, 200, 'a trailing slash works too (the old addresses had one)');
  }
  assert.ok((await get(OLD[0].en)).text.includes('What is BLTA and why was it created?'), 'the English article has its English title');
});

test('the pattern addresses of an article are retired (404), unknown ones too', async () => {
  for (const url of ['/article/nove-tricka-pre-blta', '/clanok/nove-tricka-pre-blta', '/blog/nove-tricka-pre-blta', '/en/blog/nove-tricka-pre-blta', '/en/co-je-blta-a-preco-vznikla', '/nic-take-neexistuje']) {
    assert.strictEqual((await get(url)).status, 404, url);
  }
});

test('the blog list: both languages, the old SEO texts, a card per article, the picture for link previews', async () => {
  const sk = await get('/blog');
  assert.strictEqual(sk.status, 200);
  assert.strictEqual(titleOf(sk.text), 'Blog - BLTA - Bratislavská Liga Tenisových Amatérov');
  assert.strictEqual(descOf(sk.text), 'Novinky z tenisovej amatérskej ligy BLTA, ktorá sa hrá v Bratislave a v okolí. Ak chces byť informovaný o novinkách z amatérskeho tenisu tak si tu správne.');
  assert.strictEqual((sk.text.match(/class="blog-card"/g) || []).length, 4);
  for (const a of OLD) assert.ok(sk.text.includes(`href="${a.sk}"`), `the list links to ${a.sk}`);
  assert.ok(sk.text.indexOf('rozhovor-s-tomasom') < sk.text.indexOf('nove-tricka') && sk.text.indexOf('nove-tricka') < sk.text.indexOf('tenisove-turnaje') && sk.text.indexOf('tenisove-turnaje') < sk.text.indexOf('co-je-blta'), 'newest first');
  assert.ok(/property="og:image" content="[^"]*lopta-2bllta\.png"/.test(sk.text));
  const en = await get('/en/blog');
  assert.strictEqual(titleOf(en.text), 'Blog - BLTA - Bratislava Amateur Tennis League');
  assert.ok(en.text.includes(`href="${OLD[0].en}"`), 'the English list links to the English addresses');
  assert.ok(en.text.includes('Read more'));
});

test('sitemap lists the blog and the articles in both languages; robots keeps the backend out', async () => {
  const xml = (await get('/sitemap.xml')).text;
  assert.ok(xml.includes(`<loc>${BASE}/blog</loc>`) && xml.includes(`<loc>${BASE}/en/blog</loc>`));
  for (const a of OLD) assert.ok(xml.includes(`<loc>${BASE}${a.sk}</loc>`) && xml.includes(`<loc>${BASE}${a.en}</loc>`), a.sk);
  assert.ok(!xml.includes('/article/'), 'no code address in the sitemap');
  assert.ok((await get('/robots.txt')).text.includes('Disallow: /blog-admin'));
});

// ---------------------------------------------------------------- Backend > Blog
test('Backend > Blog: only the admin; the list has the four articles', async () => {
  assert.strictEqual((await get('/api/articles/admin')).status, 401);
  assert.strictEqual((await call('POST', '/api/articles/admin', { body: { titleSk: 'x' } })).status, 401);
  assert.strictEqual((await call('DELETE', '/api/articles/admin/1')).status, 401);
  assert.strictEqual((await call('POST', '/api/articles/upload')).status, 401);
  const list = await admin('GET', '/api/articles/admin');
  assert.strictEqual(list.json.length, 4);
  assert.ok((await get('/blog-admin')).text.includes('blog-admin.js'));
  assert.ok((await get('/api/articles?lang=sk')).json.length === 4, 'the public list');
});

let created;
test('a new article: the address comes from the title, the text is cleaned, the SEO texts have defaults; it is live at once', async () => {
  const r = await admin('POST', '/api/articles/admin', {
    titleSk: 'Skúšobný článok o tenise', excerptSk: 'Krátky text.',
    bodySk: '<h2>Nadpis</h2><p>Text <strong>tučný</strong> a <a href="/harmonogram">harmonogram</a> a <a href="/">domov</a>.</p><script>alert(1)</script><img src="/x.png" onerror="alert(2)">',
    bodyEn: '<p>English text with <a href="/">home</a>.</p>', titleEn: 'A test article',
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  created = r.json;
  assert.strictEqual(created.slugSk, 'skusobny-clanok-o-tenise');
  assert.strictEqual(created.slugEn, 'skusobny-clanok-o-tenise', 'the English address defaults to the Slovak one');
  assert.ok(!/script|onerror|alert/.test(created.bodySk), created.bodySk);
  const page = await get('/skusobny-clanok-o-tenise');
  assert.strictEqual(page.status, 200);
  assert.strictEqual(titleOf(page.text), 'Skúšobný článok o tenise - BLTA - Bratislavská Liga Tenisových Amatérov', 'title tag default');
  assert.strictEqual(descOf(page.text), 'Krátky text.', 'description default = the short text');
  assert.ok(page.text.includes('<h2>Nadpis</h2>') && !page.text.includes('alert('));
  const en = await get('/en/skusobny-clanok-o-tenise');
  assert.strictEqual(titleOf(en.text), 'A test article - BLTA - Bratislava Amateur Tennis League');
  assert.ok(en.text.includes('English text with <a href="/en">home</a>'), 'a link to the home page becomes the English home address');
  assert.ok((await get('/blog')).text.includes('Skúšobný článok o tenise'));
  assert.ok((await get('/sitemap.xml')).text.includes('/skusobny-clanok-o-tenise'));
});

test('addresses: taken, reserved and other pages\' addresses are refused; a court\'s address too', async () => {
  const make = (extra) => admin('POST', '/api/articles/admin', { titleSk: 'Iný článok', ...extra });
  for (const [slug, why] of [['nove-tricka-pre-blta', 'an article'], ['blog', 'the blog page'], ['api', 'the app'], ['rankings', 'an old code address'], ['skusobny-clanok-o-tenise', 'the new one']]) {
    assert.strictEqual((await make({ slugSk: slug })).status, 400, `${slug} (${why})`);
  }
  assert.strictEqual((await make({ titleSk: '' })).status, 400, 'a title is required');
  assert.strictEqual((await make({ slugEn: 'nove-tricka-pre-blta' })).status, 400, 'the same in English');
  assert.strictEqual((await make({ imageUrl: 'javascript:alert(1)' })).status, 400);
  assert.strictEqual((await make({ publishedAt: 'not a date' })).status, 400);
  // a court with an address of its own
  db.prepare("INSERT INTO venues (name, slug) VALUES ('Kurt Test', 'kurt-test')").run();
  assert.strictEqual((await admin('PUT', '/api/seo/court-paths/kurt-test', { sk: 'kurt-na-testy', en: '' })).status, 200);
  assert.strictEqual((await make({ slugSk: 'kurt-na-testy' })).status, 400, 'a court address');
  // and an article address cannot be given to a court
  assert.strictEqual((await admin('PUT', '/api/seo/court-paths/kurt-test', { sk: 'nove-tricka-pre-blta', en: '' })).status, 400, 'a court cannot take an article address');
});

test('editing: another address (the old one is a 404), a draft is not visible, publishing again brings it back', async () => {
  const r = await admin('PUT', `/api/articles/admin/${created.id}`, { slugSk: 'novy-nazov-clanku', slugEn: 'new-name-of-the-article', titleSk: 'Nový názov' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await get('/skusobny-clanok-o-tenise')).status, 404, 'the old address is gone');
  assert.strictEqual((await get('/novy-nazov-clanku')).status, 200);
  assert.strictEqual((await get('/en/new-name-of-the-article')).status, 200);
  assert.strictEqual((await admin('PUT', `/api/articles/admin/${created.id}`, { slugSk: 'nove-tricka-pre-blta' })).status, 400, 'an address of another article');
  assert.strictEqual((await admin('PUT', `/api/articles/admin/${created.id}`, { status: 'DRAFT' })).status, 200);
  assert.strictEqual((await get('/novy-nazov-clanku')).status, 404, 'a draft is not visible');
  assert.ok(!(await get('/blog')).text.includes('Nový názov'));
  assert.ok(!(await get('/sitemap.xml')).text.includes('novy-nazov-clanku'));
  assert.strictEqual((await admin('PUT', `/api/articles/admin/${created.id}`, { status: 'PUBLISHED' })).status, 200);
  assert.strictEqual((await get('/novy-nazov-clanku')).status, 200);
  assert.strictEqual((await admin('PUT', '/api/articles/admin/99999', { titleSk: 'x' })).status, 404);
});

test('the meta texts an admin writes are the ones the page shows; a missing English text falls back to the Slovak one', async () => {
  await admin('PUT', `/api/articles/admin/${created.id}`, { seoTitleSk: 'Vlastný titulok', seoDescSk: 'Vlastný popis', keywordsSk: 'tenis, blog', titleEn: '', bodyEn: '', excerptEn: '' });
  const sk = await get('/novy-nazov-clanku');
  assert.strictEqual(titleOf(sk.text), 'Vlastný titulok');
  assert.strictEqual(descOf(sk.text), 'Vlastný popis');
  assert.ok(sk.text.includes('<meta name="keywords" content="tenis, blog">'));
  const en = await get('/en/new-name-of-the-article');
  assert.ok(en.text.includes('Nový názov') && en.text.includes('<h2>Nadpis</h2>'), 'the English page shows the Slovak text');
  assert.strictEqual(descOf(en.text), 'Vlastný popis');
});

test('upload: a picture is kept and served; other files are refused', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const up = await call('POST', '/api/articles/upload', { body: form, cookie: adminCookie });
  assert.strictEqual(up.status, 201, up.text);
  assert.ok(/^\/blog-images\/[\w-]+\.png$/.test(up.json.url), up.json.url);
  const shown = await fetch(`${BASE}${up.json.url}`);
  assert.strictEqual(shown.status, 200);
  assert.strictEqual(shown.headers.get('content-type'), 'image/png');
  const bad = new FormData();
  bad.append('image', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
  assert.strictEqual((await call('POST', '/api/articles/upload', { body: bad, cookie: adminCookie })).status, 400);
  const saved = await admin('PUT', `/api/articles/admin/${created.id}`, { imageUrl: up.json.url });
  assert.strictEqual(saved.json.imageUrl, up.json.url);
  assert.ok(/property="og:image" content="[^"]*\/blog-images\//.test((await get('/novy-nazov-clanku')).text), 'the picture is the link preview');
});

test('delete: the address becomes a 404; the others stay; the seed does not come back after a restart-like call', async () => {
  assert.strictEqual((await admin('DELETE', `/api/articles/admin/${created.id}`)).status, 200);
  assert.strictEqual((await get('/novy-nazov-clanku')).status, 404);
  assert.strictEqual((await admin('DELETE', `/api/articles/admin/${created.id}`)).status, 404);
  assert.strictEqual((await admin('GET', '/api/articles/admin')).json.length, 4);
  // an old article deleted by the admin stays deleted (the seed runs once)
  const nove = db.prepare("SELECT id FROM articles WHERE slug_sk = 'nove-tricka-pre-blta'").get();
  assert.strictEqual((await admin('DELETE', `/api/articles/admin/${nove.id}`)).status, 200);
  assert.strictEqual((await get('/nove-tricka-pre-blta')).status, 404);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM app_flags WHERE key = 'blog_seeded'").get().n, 1);
});

test('Backend > SEO lists the blog pages and the menu picker offers the blog', async () => {
  const pages = (await admin('GET', '/api/seo')).json;
  assert.ok(pages.find((p) => p.key === 'blog'), 'the blog list is in Backend > SEO');
  assert.ok(pages.find((p) => p.key === 'article' && p.template), 'the article template is in Backend > SEO');
  assert.ok((await get('/js/header-admin.js')).text.includes("link: '/blog'"));
  assert.ok((await get('/seasons-admin')).text.includes('href="/blog-admin" class="tab">Blog</a>'), 'the Blog tab is on the other backend pages');
});

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', PUBLIC_URL: BASE },
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
