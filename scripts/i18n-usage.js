// Which translation keys a public page needs, found by reading the page and the scripts it loads (used by scripts/check-i18n-split.js).
// public/js/i18n.js holds the texts every page needs (and t(), tl(), applyStaticTranslations()); the texts of one part of the site live in
// public/js/i18n-<part>.js, which a page loads before i18n.js (they register themselves in window.I18N_PARTS, i18n.js merges them).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const JS = path.join(PUBLIC, 'js');
// scripts that common.js adds to a page when it needs them (a script tag is not in the page file)
const LOADED_BY_COMMON = ['js/event-popup.js', 'js/sponsor-carousel.js'];

const partFiles = () => fs.readdirSync(JS).filter((f) => /^i18n-.+\.js$/.test(f)).sort();

// the dictionary a page gets from the given files (names in public/js, parts first and i18n.js last, like the page does): { sk, en }
const dictionaryCache = new Map();
function dictionaryOf(files) {
  const cacheKey = files.join('|');
  if (!dictionaryCache.has(cacheKey)) dictionaryCache.set(cacheKey, buildDictionary(files));
  return dictionaryCache.get(cacheKey);
}

function buildDictionary(files) {
  const win = {};
  const noop = () => {};
  const context = vm.createContext({
    window: win,
    document: { documentElement: {}, body: { classList: { add: noop, remove: noop } }, querySelectorAll: () => [], getElementById: () => null, addEventListener: noop, readyState: 'complete' },
    localStorage: { getItem: () => null, setItem: noop },
    navigator: { language: 'sk' },
  });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), context, { filename: f });
  return vm.runInContext('TRANSLATIONS', context);
}

const allFiles = () => [...partFiles(), 'i18n.js'];

// the i18n files a page loads, in the order it loads them
function i18nFilesOf(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc="\/js\/(i18n[a-z-]*\.js)[^"]*"/g)) out.push(m[1]);
  return out;
}

const scriptsOf = (html) => [...html.matchAll(/<script[^>]*\ssrc="\/(js\/[^"?]+\.js)/g)].map((m) => m[1]).filter((s) => !/^js\/i18n[a-z-]*\.js$/.test(s));

// the keys one text (a page file or a script) uses: written out in quotes or in data-i18n*="", or built (`prefix.${x}.label`, 'prefix.' + x)
function keysUsedIn(text, keys) {
  const used = new Set();
  const keySet = new Set(keys);
  for (const m of text.matchAll(/['"`]([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9_.]+)['"`]/g)) if (keySet.has(m[1])) used.add(m[1]);
  for (const m of text.matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) if (keySet.has(m[1])) used.add(m[1]);
  const patterns = [];
  // `about.cats.${key}`, `format.${k}.label`
  for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9]*\.[^`]*\$\{[^`]*)`/g)) {
    const re = m[1].split(/\$\{[^}]*\}/).map((s) => s.replace(/\./g, '\\.')).join('[A-Za-z0-9_]+');
    patterns.push(new RegExp(`^${re}$`));
  }
  // 'season.unregisterNote' + reason, 'season.drawFormat.' + f
  for (const m of text.matchAll(/['"]([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9_.]*)['"]\s*\+/g)) patterns.push(new RegExp(`^${m[1].replace(/\./g, '\\.')}[A-Za-z0-9_.]*$`));
  for (const re of patterns) for (const k of keys) if (re.test(k)) used.add(k);
  return used;
}

const fileCache = new Map();
const read = (rel) => {
  if (!fileCache.has(rel)) { try { fileCache.set(rel, fs.readFileSync(path.join(PUBLIC, rel), 'utf8')); } catch { fileCache.set(rel, ''); } }
  return fileCache.get(rel);
};

const usedCache = new Map();
// keysUsedIn of a file under public/, remembered (the same scripts are on many pages)
const keysUsedInFile = (rel, keys) => {
  if (!usedCache.has(rel)) usedCache.set(rel, keysUsedIn(read(rel), keys));
  return usedCache.get(rel);
};

// every key a page needs: its own file, its scripts, and the scripts common.js adds
function keysNeededBy(htmlFile, keys) {
  const html = read(htmlFile);
  const needed = keysUsedIn(html, keys);
  const scripts = new Set([...scriptsOf(html), ...(scriptsOf(html).includes('js/common.js') ? LOADED_BY_COMMON : [])]);
  for (const s of scripts) for (const k of keysUsedInFile(s, keys)) needed.add(k);
  return needed;
}

const pageFiles = () => fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort();

module.exports = { PUBLIC, JS, partFiles, allFiles, dictionaryOf, i18nFilesOf, scriptsOf, keysUsedIn, keysNeededBy, pageFiles, read };
