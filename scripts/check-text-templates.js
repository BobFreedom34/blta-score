// Checks of the text templates (docs/superpowers/specs/2026-11-19-text-templates-design.md): the safe colours and classes the sanitizers let through,
// the template library, and the e-mail elements. Unit checks, no server needed.
// Run: node scripts/check-text-templates.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'text-templates-')); // before src/rules.js opens its database
const { safeStyle } = require('../src/templateStyle');
const rules = require('../src/rules');
const { sanitizeHtml } = require('../src/htmlSanitize');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('safeStyle keeps allowed colours', () => {
  assert.strictEqual(safeStyle('color:#b2fa06;background:rgba(178,250,6,.12)'), 'color:#b2fa06;background:rgba(178,250,6,.12)');
});
test('safeStyle drops url(), expression() and unknown properties', () => {
  assert.strictEqual(safeStyle('background:url(http://x);position:fixed;color:red'), 'color:red');
});
test('rules.sanitize keeps a pr-note with a colour', () => {
  const html = '<p class="pr-note" style="border-left-color:#b2fa06">A</p>';
  assert.strictEqual(rules.sanitize(html), html);
});
test('rules.sanitize drops script and onclick', () => {
  const out = rules.sanitize('<p onclick="x()">A<script>1</script></p>');
  assert.ok(!/script|onclick/i.test(out.replace(/&lt;script&gt;/g, '')), out);
});
test('sanitizeHtml keeps template classes and divs', () => {
  const html = '<div class="pr-cats"><div class="pr-cat novice">N</div></div>';
  assert.strictEqual(sanitizeHtml(html), html);
});
test('sanitizeHtml drops foreign classes and style url', () => {
  assert.strictEqual(sanitizeHtml('<p class="evil" style="background:url(x)">A</p>'), '<p>A</p>');
});
test('sanitizeHtml leaves an old article unchanged', () => {
  const html = '<h2>T</h2><p>Text <a href="/x">l</a></p>';
  assert.strictEqual(sanitizeHtml(html), html);
});
test('sanitizeHtml balances a plain div inside a template and an unclosed template', () => {
  assert.strictEqual(sanitizeHtml('<div class="pr-cats"><div>a</div>b</div>'), '<div class="pr-cats"><div>a</div>b</div>');
  assert.strictEqual(sanitizeHtml('<div class="pr-cat">a'), '<div class="pr-cat">a</div>');
});
const TEMPLATES = (() => { try { return require('../public/js/text-templates.js'); } catch { return []; } })();
const flat = (h) => h.replace(/>s+</g, '><').trim();
test('there are at least 12 templates with unique ids and names in sk and en', () => {
  assert.ok(TEMPLATES.length >= 12, 'found ' + TEMPLATES.length);
  assert.strictEqual(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  TEMPLATES.forEach((t) => assert.ok(t.name && t.name.sk && t.name.en && t.html, t.id));
});
test('every template survives the Rules sanitizer unchanged', () => {
  TEMPLATES.forEach((t) => assert.strictEqual(flat(rules.sanitize(t.html)), flat(t.html), t.id));
});
test('every template survives the blog sanitizer unchanged', () => {
  TEMPLATES.forEach((t) => assert.strictEqual(flat(sanitizeHtml(t.html)), flat(t.html), t.id));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`ok   ${t.name}`); } catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${e.message.split('\n')[0]}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
