// Check of the tab "Pavúk" of a league season (public/js/seasons-admin.js + public/js/bracket-admin.js): the play-off brackets of the season are managed in the
// season card; the script of the brackets is wrapped (its names do not clash with the other admin scripts) and still serves Backend > Brackets.
// Run: node scripts/check-season-brackets-tab.js   (reads the files only; touches nothing)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a league season has the tab Pavúk after Rozpis, with a panel that mounts the bracket admin for the season', () => {
  const js = read('js/seasons-admin.js');
  assert.ok(js.includes("['schedule', 'Rozpis'], ['brackets', 'Pavúk']"), 'the tab comes after Rozpis');
  assert.ok(js.includes('data-panel="brackets"') && js.includes('season-brackets'));
  assert.ok(js.includes('window.mountBracketAdmin(bracketsHost, id)'));
  assert.ok(read('seasons-admin.html').includes('/js/bracket-admin.js'), 'the season page loads the script of the brackets');
});

test('the script of the brackets is wrapped, exposes mountBracketAdmin, and still boots on the page Backend > Brackets', () => {
  const js = read('js/bracket-admin.js');
  assert.ok(js.startsWith('(function bracketAdmin() {'), 'wrapped: no top-level names of its own');
  assert.ok(js.includes('window.mountBracketAdmin = '));
  assert.ok(js.includes("if (scopeSeasonId) brackets = brackets.filter((b) => b.seasonId === scopeSeasonId);"), 'the tab lists only the brackets of its season');
  assert.ok(js.includes('const seasonId = scopeSeasonId ||'), 'a new bracket of the tab is made for its season');
  assert.ok(read('bracket-admin.html').includes('id="bracket-admin-root"') && read('bracket-admin.html').includes('/js/bracket-admin.js'));
});

let failed = 0;
tests.forEach((t) => {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
});
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
