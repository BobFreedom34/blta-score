// The texts of the browser files (public/js/i18n.js: t(key); public/js/about.js: the info window) for the server, so that a page can say in its HTML what the browser
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
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'i18n.js'), 'utf8'), context, { filename: 'i18n.js' });
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'about.js'), 'utf8'), context, { filename: 'about.js' });
  sandbox = { context, win };
  return sandbox;
}

// t(key, lang, vars) like t() in the browser
function t(key, lang = 'sk', vars) {
  const { context } = load();
  context.__key = key;
  context.__vars = vars;
  context.__lang = lang === 'en' ? 'en' : 'sk';
  return vm.runInContext('currentLang = __lang; t(__key, __vars)', context);
}

module.exports = { load, t };
