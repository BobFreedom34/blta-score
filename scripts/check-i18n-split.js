// Checks of the split of the translations: public/js/i18n.js holds the texts every page needs, the texts of a part of the site live in
// public/js/i18n-<part>.js, which a page loads before i18n.js. For every public page file: the keys it uses (data-i18n*, t('key'), the keys its scripts
// and the scripts common.js adds use, and the keys built at run time like `about.cats.${key}`) must be found, in Slovak and in English, in the files that
// page loads — otherwise the page shows the bare key. Run: node scripts/check-i18n-split.js
const assert = require('assert');
const U = require('./i18n-usage');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed++; console.error(`FAIL ${name}\n     ${err.message}`); }
}

const parts = U.partFiles();
const everything = U.dictionaryOf(U.allFiles());
const allKeys = Object.keys(everything.sk);

test('Slovak and English have the same keys', () => {
  const en = new Set(Object.keys(everything.en));
  const sk = new Set(allKeys);
  const onlySk = allKeys.filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !sk.has(k));
  assert.deepStrictEqual({ onlySk, onlyEn }, { onlySk: [], onlyEn: [] }, 'a text is missing in one language');
});

test('every file has the same keys in both languages, and no key is in two files', () => {
  const seen = new Map();
  for (const f of U.allFiles()) {
    const d = U.dictionaryOf(['i18n.js'].includes(f) ? [f] : [f, 'i18n.js']);
    const own = (lang) => Object.keys(d[lang]).filter((k) => !(f !== 'i18n.js' && U.dictionaryOf(['i18n.js'])[lang][k] !== undefined));
    const sk = own('sk');
    const en = own('en');
    assert.deepStrictEqual(sk.sort(), en.sort(), `${f}: Slovak and English keys differ`);
    sk.forEach((k) => { assert.ok(!seen.has(k), `${k} is in ${seen.get(k)} and in ${f}`); seen.set(k, f); });
  }
  assert.strictEqual(seen.size, allKeys.length);
});

test('the parts are a few coarse files, each with texts in it', () => {
  assert.ok(parts.length >= 1 && parts.length <= 10, `${parts.length} parts`);
});

// pages that never loaded i18n.js (own texts in the page, Slovak only): the split does not touch them
const WITHOUT_I18N = new Set(['slta.html']);
const pages = U.pageFiles();
assert.ok(pages.length > 40, 'the public pages were found');

for (const page of pages) {
  test(`${page}: every key it uses is in the files it loads, in both languages`, () => {
    const html = U.read(page);
    const files = U.i18nFilesOf(html);
    const needed = U.keysNeededBy(page, allKeys);
    if (!files.length) {
      if (WITHOUT_I18N.has(page)) return;
      assert.strictEqual(needed.size, 0, `uses ${needed.size} texts but loads no i18n.js (${[...needed].slice(0, 5).join(', ')})`);
      return;
    }
    assert.strictEqual(files[files.length - 1], 'i18n.js', 'i18n.js must come after the parts it merges');
    assert.strictEqual(new Set(files).size, files.length, 'a file is loaded twice');
    const dict = U.dictionaryOf(files);
    for (const lang of ['sk', 'en']) {
      const missing = [...needed].filter((k) => !dict[lang][k]);
      assert.deepStrictEqual(missing.slice(0, 8), [], `${missing.length} texts missing in ${lang}: load the i18n-<part>.js with them`);
    }
    // a part the page does not need is only weight
    for (const f of files.filter((x) => x !== 'i18n.js')) {
      const own = Object.keys(U.dictionaryOf([f, 'i18n.js']).sk).filter((k) => U.dictionaryOf(['i18n.js']).sk[k] === undefined);
      assert.ok(own.some((k) => needed.has(k)), `${f} is loaded but no text of it is used`);
    }
    // the parts come before i18n.js, and i18n.js before common.js (applyStaticTranslations runs at the end of i18n.js)
    const order = [...html.matchAll(/<script[^>]*\ssrc="\/js\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
    const at = (n) => order.indexOf(n);
    if (at('common.js') >= 0) assert.ok(at('i18n.js') < at('common.js'), 'i18n.js before common.js');
  });
}

test('the server has all the texts (mail, push, SEO and the info page read them through src/browserTexts.js)', () => {
  const texts = require('../src/browserTexts');
  for (const k of ['nav.matches', 'season.regDone', 'com.heading', 'about.btn', 'courtiq.cardLabel', 'rankings.playerCol', 'match.reasonLabel']) assert.ok(texts.has(k), k);
  assert.strictEqual(texts.t('com.heading', 'en'), 'Communities and clubs');
});

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
