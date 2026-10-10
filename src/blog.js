// The blog: articles written in Backend > Blog (/blog-admin). Each article has a Slovak and an English version and a WHOLE address of its own per
// language (/nove-tricka-pre-blta, /en/new-t-shirts…) — the addresses the articles had on the old website, so the search engines keep finding
// them. The pages are rendered on the server (the text is in the HTML for a crawler) by src/seo.js + server.js; this file holds the table, the
// seed of the four articles of the old website, the checks of what the admin saves and the HTML of the list and of an article.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { sanitizeHtml, plainText } = require('./htmlSanitize');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug_sk TEXT NOT NULL UNIQUE,
    slug_en TEXT NOT NULL UNIQUE,
    title_sk TEXT NOT NULL,
    title_en TEXT NOT NULL DEFAULT '',
    excerpt_sk TEXT NOT NULL DEFAULT '',
    excerpt_en TEXT NOT NULL DEFAULT '',
    body_sk TEXT NOT NULL DEFAULT '',
    body_en TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    seo_title_sk TEXT NOT NULL DEFAULT '',
    seo_title_en TEXT NOT NULL DEFAULT '',
    seo_desc_sk TEXT NOT NULL DEFAULT '',
    seo_desc_en TEXT NOT NULL DEFAULT '',
    keywords_sk TEXT NOT NULL DEFAULT '',
    keywords_en TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'DRAFT')),
    published_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(status, published_at);
`);

const UPLOAD_DIR = path.join(db.dataDir, 'blog-images');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SUFFIX = { sk: ' - BLTA - Bratislavská Liga Tenisových Amatérov', en: ' - BLTA - Bratislava Amateur Tennis League' };
const TEXT = {
  sk: { heading: 'Blog', sub: 'Novinky z tenisovej amatérskej ligy BLTA', readMore: 'Čítať viac', back: '← Všetky články', empty: 'Zatiaľ tu nie sú žiadne články.', by: 'BLTA' },
  en: { heading: 'Blog', sub: 'News from the BLTA amateur tennis league', readMore: 'Read more', back: '← All articles', empty: 'There are no articles yet.', by: 'BLTA' },
};
const LOCALE = { sk: 'sk-SK', en: 'en-GB' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const seo = () => require('./seo'); // loaded when needed (seo.js loads this file first)

// ---------------------------------------------------------------- the rows

// what one language of an article shows: the English texts fall back to the Slovak ones (like on the old website)
function pick(row, lang) {
  const en = lang === 'en';
  const title = (en && row.title_en) || row.title_sk;
  const body = (en && row.body_en) || row.body_sk;
  const excerpt = (en && row.excerpt_en) || row.excerpt_sk;
  const description = (en ? row.seo_desc_en : row.seo_desc_sk) || (en && row.seo_desc_sk) || excerpt || plainText(body).slice(0, 155);
  return {
    slug: en ? row.slug_en : row.slug_sk, title, body, excerpt, description,
    seoTitle: (en ? row.seo_title_en : row.seo_title_sk) || `${title}${SUFFIX[lang]}`,
    keywords: (en ? row.keywords_en : row.keywords_sk) || '',
    image: row.image_url, published: row.published_at, modified: row.modified_at,
  };
}

const publishedRows = () => db.prepare("SELECT * FROM articles WHERE status = 'PUBLISHED' ORDER BY published_at DESC, id DESC").all();

// [{ code: '/article/<slug>', sk, en }] — the whole addresses of the published articles (src/seo.js adds them to its routes)
function publishedAddresses() {
  return db.prepare("SELECT slug_sk, slug_en FROM articles WHERE status = 'PUBLISHED'").all()
    .map((r) => ({ code: `/article/${r.slug_sk}`, sk: r.slug_sk, en: r.slug_en }));
}

// is `slug` the address of an article in `lang`? (`exceptId` = the article being edited)
function addressTaken(lang, slug, exceptId = 0) {
  const column = lang === 'en' ? 'slug_en' : 'slug_sk';
  return !!db.prepare(`SELECT 1 FROM articles WHERE ${column} = ? AND id != ?`).get(slug, exceptId);
}

// ---------------------------------------------------------------- the pages

const dateText = (iso, lang) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bratislava' });
};
const urlOf = (code, lang) => seo().pageUrl(code, lang);

// the list of the blog: a card per published article
function listHtml(lang) {
  const t = TEXT[lang];
  const cards = publishedRows().map((row) => {
    const a = pick(row, lang);
    const href = urlOf(`/article/${row.slug_sk}`, lang);
    const image = a.image ? `<a class="blog-card-img" href="${esc(href)}"><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy"></a>` : '';
    return `<article class="blog-card">${image}<div class="blog-card-body"><div class="blog-meta">${esc(dateText(a.published, lang))}</div><h2><a href="${esc(href)}">${esc(a.title)}</a></h2><p>${esc(a.excerpt || plainText(a.body).slice(0, 180))}</p><a class="blog-more" href="${esc(href)}">${esc(t.readMore)} →</a></div></article>`;
  });
  return `<h1 class="blog-h1">${esc(t.heading)}</h1><p class="home-sub">${esc(t.sub)}</p>${cards.length ? `<div class="blog-grid">${cards.join('')}</div>` : `<div class="empty-state">${esc(t.empty)}</div>`}`;
}

// A link inside an article to a page of this site is written with the page's code address (/harmonogram, /season/<name>, /): here it becomes
// the public address of the language the article is read in, so a crawler (and a reader without scripts) gets a working link.
function localizeLinks(html, lang) {
  return html.replace(/href="(\/[^"#?]*)([^"]*)"/g, (all, p, tail) => `href="${esc(seo().pageUrl(p.length > 1 ? p.replace(/\/+$/, '') : p, lang))}${tail}"`);
}

// one article: what render() needs — the title, the picture, the meta texts and the HTML of the page
function articleEntity(slugSk, lang) {
  const row = db.prepare("SELECT * FROM articles WHERE slug_sk = ? AND status = 'PUBLISHED'").get(String(slugSk));
  if (!row) return null;
  const a = pick(row, lang);
  a.body = localizeLinks(a.body, lang);
  const t = TEXT[lang];
  const hasImageInBody = a.image && a.body.includes(a.image.split('/').pop());
  const hero = a.image && !hasImageInBody ? `<img class="blog-hero" src="${esc(a.image)}" alt="${esc(a.title)}">` : '';
  const html = `<article class="blog-article"><a class="blog-back" href="${esc(urlOf('/blog', lang))}">${esc(t.back)}</a><h1>${esc(a.title)}</h1><div class="blog-meta">${esc(dateText(a.published, lang))} · ${esc(t.by)}</div>${hero}<div class="blog-body">${a.body}</div></article>`;
  return {
    name: a.title, image: a.image,
    seo: { title: a.seoTitle, description: a.description, keywords: a.keywords },
    ogType: 'article', published: a.published, modified: a.modified, html,
  };
}

// ---------------------------------------------------------------- what the admin saves

const STATUSES = ['PUBLISHED', 'DRAFT'];
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// -> { error } or { values } ready for the table
function check(body, exceptId = 0) {
  const b = body || {};
  const title = text(b.titleSk, 200);
  if (!title) return { error: 'The Slovak title is required' };
  const s = seo();
  const slugSk = s.normalizeSlug(b.slugSk || title);
  const slugEn = s.normalizeSlug(b.slugEn || slugSk);
  for (const [lang, slug] of [['sk', slugSk], ['en', slugEn]]) {
    const problem = s.checkWholeAddress(lang, slug, { exceptArticleId: exceptId, article: true });
    if (problem) return { error: `${lang === 'sk' ? 'Slovak' : 'English'}: ${problem}` };
  }
  const status = STATUSES.includes(b.status) ? b.status : 'PUBLISHED';
  const published = b.publishedAt ? new Date(b.publishedAt) : new Date();
  if (Number.isNaN(published.getTime())) return { error: 'The date of the article is not valid' };
  const image = String(b.imageUrl || '').trim();
  if (image && !/^(https?:\/\/|\/)/.test(image)) return { error: 'The picture must be an address that starts with / or https://' };
  const bodySk = sanitizeHtml(b.bodySk);
  const bodyEn = sanitizeHtml(b.bodyEn);
  return {
    values: {
      slug_sk: slugSk, slug_en: slugEn,
      title_sk: title, title_en: text(b.titleEn, 200),
      excerpt_sk: text(b.excerptSk, 400), excerpt_en: text(b.excerptEn, 400),
      body_sk: bodySk, body_en: bodyEn,
      image_url: image,
      seo_title_sk: text(b.seoTitleSk, 200), seo_title_en: text(b.seoTitleEn, 200),
      seo_desc_sk: text(b.seoDescSk, 400), seo_desc_en: text(b.seoDescEn, 400),
      keywords_sk: text(b.keywordsSk, 300), keywords_en: text(b.keywordsEn, 300),
      status, published_at: published.toISOString(),
    },
  };
}

const COLUMNS = ['slug_sk', 'slug_en', 'title_sk', 'title_en', 'excerpt_sk', 'excerpt_en', 'body_sk', 'body_en', 'image_url', 'seo_title_sk', 'seo_title_en',
  'seo_desc_sk', 'seo_desc_en', 'keywords_sk', 'keywords_en', 'status', 'published_at'];

function serialize(r) {
  return {
    id: r.id, slugSk: r.slug_sk, slugEn: r.slug_en, titleSk: r.title_sk, titleEn: r.title_en, excerptSk: r.excerpt_sk, excerptEn: r.excerpt_en,
    bodySk: r.body_sk, bodyEn: r.body_en, imageUrl: r.image_url, seoTitleSk: r.seo_title_sk, seoTitleEn: r.seo_title_en, seoDescSk: r.seo_desc_sk, seoDescEn: r.seo_desc_en,
    keywordsSk: r.keywords_sk, keywordsEn: r.keywords_en, status: r.status, publishedAt: r.published_at, modifiedAt: r.modified_at,
    urls: { sk: urlOf(`/article/${r.slug_sk}`, 'sk'), en: urlOf(`/article/${r.slug_sk}`, 'en') },
  };
}

const adminList = () => db.prepare('SELECT * FROM articles ORDER BY published_at DESC, id DESC').all().map(serialize);
const getById = (id) => { const r = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(id)); return r ? serialize(r) : null; };

function create(body) {
  const r = check(body);
  if (r.error) return r;
  const v = r.values;
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO articles (${COLUMNS.join(', ')}, modified_at) VALUES (${COLUMNS.map(() => '?').join(', ')}, ?)`).run(...COLUMNS.map((c) => v[c]), now);
  seo().forgetRoutes();
  return { article: getById(info.lastInsertRowid) };
}

function update(id, body) {
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(id));
  if (!row) return { error: 'Article not found', status: 404 };
  const r = check({ ...serialize(row), ...body }, row.id);
  if (r.error) return r;
  const v = r.values;
  db.prepare(`UPDATE articles SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, modified_at = ? WHERE id = ?`).run(...COLUMNS.map((c) => v[c]), new Date().toISOString(), row.id);
  seo().forgetRoutes();
  return { article: getById(row.id) };
}

function remove(id) {
  const info = db.prepare('DELETE FROM articles WHERE id = ?').run(Number(id));
  seo().forgetRoutes();
  return info.changes > 0;
}

// ---------------------------------------------------------------- the first articles

// The four articles of the old website (with their addresses, meta texts and dates, as they were there), once, at the first start.
function seedOldArticles() {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'blog_seeded'").get()) return 0;
  let seed = [];
  try { seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'blogSeed.json'), 'utf8')); } catch (err) { console.error('[blog] no seed:', err.message); }
  const put = db.prepare(`INSERT OR IGNORE INTO articles (${COLUMNS.join(', ')}, modified_at) VALUES (${COLUMNS.map(() => '?').join(', ')}, ?)`);
  let added = 0;
  seed.forEach((a) => {
    added += put.run(...COLUMNS.map((c) => (c === 'body_sk' || c === 'body_en' ? sanitizeHtml(a[c]) : a[c] == null ? '' : a[c])), a.modified_at || a.published_at).changes;
  });
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('blog_seeded')").run();
  if (added) console.log(`[blog] ${added} articles of the old website added`);
  return added;
}

module.exports = {
  UPLOAD_DIR, TEXT, publishedAddresses, addressTaken, listHtml, articleEntity, adminList, getById, create, update, remove, seedOldArticles, publishedRows, pick,
};
