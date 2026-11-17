// The texts of the browser files (public/js/i18n.js and its parts i18n-<part>.js: t(key); public/js/about.js: the info window) for the server, so that a page can say in its HTML what the browser
// would say after the script ran. The two files are run once, in a sandbox with the few browser things they touch faked (nothing of the real page is reachable).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
let sandbox = null;

function load() {
  if (sandbox) return sandbox;
  const noop = () => {};
  const win = {};
  const context = vm.createContext({
    window: win,
    document: { documentElement: {}, body: { classList: { add: noop, remove: noop } }, querySelectorAll: () => [], getElementById: () => null, addEventListener: noop, readyState: 'complete' },
    localStorage: { getItem: () => null, setItem: noop },
    navigator: { language: 'sk' },
    escapeHtml: (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    api: () => Promise.reject(new Error('no browser')),
  });
  // the texts of the parts of the site (i18n-<part>.js) first, then i18n.js, which merges them: the server wants all of them, a page only the ones it needs
  const parts = fs.readdirSync(JS_DIR).filter((f) => /^i18n-.+\.js$/.test(f)).sort();
  for (const file of [...parts, 'i18n.js']) vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'about.js'), 'utf8'), context, { filename: 'about.js' });
  sandbox = { context, win };
  return sandbox;
}

// t(key, lang, vars, city) like t() in the browser; city = { brand, name, locative } for the page of a city other than the first (its {brand} and {place})
function t(key, lang = 'sk', vars, city) {
  const { context, win } = load();
  win.CITY = city ? { first: false, brand: city.brand, name: city.name, locative: city.locative || '' } : undefined;
  context.__key = key;
  context.__vars = vars;
  context.__lang = lang === 'en' ? 'en' : 'sk';
  return vm.runInContext('currentLang = __lang; t(__key, __vars)', context);
}

// Does the dictionary have this key (in Slovak or English)?
function has(key) {
  const { context } = load();
  context.__key = key;
  return vm.runInContext('!!(TRANSLATIONS.sk[__key] || TRANSLATIONS.en[__key])', context);
}

module.exports = { load, t, has };
