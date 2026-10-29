// Checks that on phones and tablets the language switch is a row in the person-icon dropdown (not a pill in the top bar), and that the desktop strip keeps its
// own switch. Static checks of public/js/common.js, public/js/i18n.js and public/css/style.css.
// Run: node scripts/check-lang-switch-mobile.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at));
};

test('the account dropdown gets a language row with the two languages, and it switches through setLang', () => {
  const js = read('js/common.js');
  const fn = js.slice(js.indexOf('function buildLangRow'), js.indexOf('mountLangRow();'));
  assert.ok(fn.length > 200 && fn.includes('function mountLangRow'), 'buildLangRow and mountLangRow exist');
  ['auth-lang-row', 'auth-lang-seg', 'auth-menu-panel', 'setLang(', 'currentLang', "t('nav.language')", 'textContent'].forEach((s) => assert.ok(fn.includes(s), `${s} is used`));
  assert.ok(!/innerHTML/.test(fn), 'only DOM text');
  const i18n = read('js/i18n.js');
  assert.strictEqual(i18n.split("'nav.language':").length, 3, 'the label exists in both languages');
});

test('below 1025px the pill is gone from the top bar and the row shows; above it the row is hidden and the pill stays', () => {
  const css = read('css/style.css');
  assert.ok(/\.auth-lang-row \{[^}]*display: none/.test(css), 'hidden by default (desktop)');
  const at = css.indexOf('/* language: phones and tablets');
  assert.ok(at >= 0, 'the mobile block is there');
  const block = css.slice(at, css.indexOf('}\n}', at) + 3);
  assert.ok(/@media \(max-width: 1024px\)/.test(block), 'for the hamburger widths');
  assert.ok(/#lang-switcher \{ display: none/.test(block), 'the pill is hidden there');
  assert.ok(/\.auth-lang-row \{ display: flex/.test(block), 'the row is shown there');
  assert.ok(rule(css, '.lang-switcher').includes('display: flex'), 'the desktop switch is untouched');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
