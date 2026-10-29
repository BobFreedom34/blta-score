// Checks the login form of /admin (public/js/admin.js): the super admin and a city admin are two separate logins. The default is the super admin, with a
// password only (no email field a browser could fill with the saved email of a player); the email field exists only in the city admin mode, and an email is
// sent only from there. Static checks of the page script.
// Run: node scripts/check-admin-login-form.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8').replace(/\r\n/g, '\n');
const start = js.indexOf('function renderLoggedOut');
const end = js.indexOf('// The admin of a city: what he runs');
const form = js.slice(start, end);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the form has a switch between "Super admin" and "City admin", and starts as the super admin', () => {
  assert.ok(start >= 0 && end > start, 'the login form code was found');
  assert.ok(/function renderLoggedOut\(mode = 'SUPER'\)/.test(form), 'the default mode is the super admin');
  assert.ok(form.includes('Super admin') && form.includes('City admin'), 'both logins are named');
  assert.ok(form.includes('data-mode="SUPER"') && form.includes('data-mode="CITY"') && form.includes('renderLoggedOut(a.dataset.mode'), 'the switch re-draws the form in the chosen mode');
});

test('the email field exists only for a city admin, and an email is sent only from there', () => {
  assert.strictEqual(form.split('id="email"').length, 2, 'one email input');
  const at = form.indexOf('id="email"');
  assert.ok(form.slice(form.lastIndexOf('${', at), at).startsWith('${city ?'), 'the email input is inside the city admin branch only');
  assert.ok(form.includes("mode === 'CITY'") && /email: mode === 'CITY'/.test(form), 'no email is sent in the super admin mode');
  assert.ok(!form.includes('leave empty if you are the super admin'), 'the confusing hint is gone');
});

test('the password field never lets a browser fill in somebody else\'s saved login', () => {
  assert.ok(/id="password"[^>]*autocomplete="(current-password|off)"/.test(form), 'the password field has an explicit autocomplete');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
