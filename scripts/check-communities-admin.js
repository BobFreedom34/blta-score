// Check of the Backend page of the communities and clubs (public/communities-admin.html, public/js/communities-admin.js): the page exists, its tab is on
// every Backend page, and the names written by players are escaped.
// Run: node scripts/check-communities-admin.js   (static: reads the files, starts nothing)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the Backend page exists, loads its script and marks its own tab as active', () => {
  const html = read('communities-admin.html');
  assert.ok(html.includes('id="communities-admin-root"') && html.includes('/js/communities-admin.js') && html.includes('/js/common.js'));
  assert.ok(/<a href="\/communities-admin" class="tab active">/.test(html));
  assert.ok(!/class="tab active">Venues/.test(html), 'only one active tab');
});

test('every Backend page that has the tab bar has the Communities tab', () => {
  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && read(f).includes('href="/tournaments-admin" class="tab'));
  assert.ok(pages.length >= 20, `${pages.length} pages carry the tab bar`);
  pages.forEach((f) => assert.ok(read(f).includes('href="/communities-admin" class="tab'), `${f} has no Communities tab`));
});

test('the page script escapes what players wrote and uses the moderation route', () => {
  const js = read('js/communities-admin.js');
  assert.ok(/escapeHtml\(o\.name\)/.test(js) && /escapeHtml\(o\.city\)/.test(js));
  assert.ok(js.includes('/moderation') && js.includes('includeHidden=1') && js.includes('checkAdmin()'));
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
