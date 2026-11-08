// Check of the "Upraviť nastavenia zápasu" modal (openEditMatchModal in public/js/common.js): the same modal (one piece of markup on the page) is opened again and again, so
// its "Uložiť zmeny" button must be usable every time it opens — also after an earlier successful save (the save disables the button while it runs).
// Run: node scripts/check-edit-match-modal.js   (no server: the function is run against a stub page)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'common.js'), 'utf8');
const start = source.indexOf('async function openEditMatchModal(');
const end = source.indexOf('\nlet allPlayers = [];', start);
assert.ok(start > -1 && end > start, 'openEditMatchModal found in common.js');
const fnSource = source.slice(start, end);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// a page with just enough in it for the function: every id gives one stub element, kept for the whole run
function stubPage() {
  const elements = new Map();
  const make = () => ({ style: {}, value: '', textContent: '', dataset: {}, checked: false, disabled: false, classList: { toggle() {}, add() {}, remove() {} }, onclick: null, oninput: null, onsubmit: null });
  const el = (id) => { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); };
  const submit = make();
  const balls = [{ ...make(), dataset: { value: '1' } }, { ...make(), dataset: { value: '2' } }];
  const courts = [{ ...make(), dataset: { value: '1' } }, { ...make(), dataset: { value: '2' } }];
  const document = {
    getElementById: el,
    querySelector: (sel) => (/button\[type="submit"\]/.test(sel) ? submit : null),
    querySelectorAll: (sel) => (sel.includes('balls-row') ? balls : sel.includes('court-row') ? courts : []),
  };
  return { document, el, submit };
}

async function openWith(page, match, isAdmin = false) {
  const sandbox = {
    document: page.document,
    allPlayers: [{ name: 'A' }], loadPlayers: async () => {}, setupFormatOptions() {}, toDateValue: () => '', toTimeValue: () => '',
    t: (k) => k, api: async () => ({}), toast() {}, findPlayerByTypedName: () => null,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fnSource}\nthis.open = openEditMatchModal;`, sandbox);
  await sandbox.open(match, isAdmin, () => {});
}
const match = { token: 'tok', category: 'ELITE', scheduledAt: null, location: 'NTC Bratislava', notes: '', status: 'PLANNED', format: 'BO3', ballsPlayer: 1, courtPlayer: null, isDoubles: false, player1: { name: 'Róbert Sloboda' }, player2: { name: 'Peter Laučík' } };

test('the save button is usable when the modal opens, also when an earlier save left it disabled', async () => {
  const page = stubPage();
  page.submit.disabled = true; // what a successful save left behind
  await openWith(page, match);
  assert.strictEqual(page.submit.disabled, false, 'the button is enabled again');
  assert.strictEqual(page.el('edit-match-modal').style.display, 'flex', 'and the modal is open');
});

test('the venue of the match is in the field, and an empty one can be saved (the field is not required by the modal)', async () => {
  const page = stubPage();
  await openWith(page, match);
  assert.strictEqual(page.el('edit-match-location').value, 'NTC Bratislava');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'match.html'), 'utf8');
  const field = html.match(/<input[^>]*id="edit-match-location"[^>]*>/);
  assert.ok(field && !/\brequired\b/.test(field[0]), 'no required attribute on the venue field');
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
