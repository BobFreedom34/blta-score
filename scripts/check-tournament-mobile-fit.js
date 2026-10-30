// Guards the tournament forms against sideways overflow on small phones (320-360px): a grid column of the tournament editor must never ask for more
// width than the screen has, so every `minmax(Npx, 1fr)` in these scripts is written `minmax(min(Npx, 100%), 1fr)`.
// Run: node scripts/check-tournament-mobile-fit.js   (reads the files only)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const bareMinmax = (text) => [...text.matchAll(/minmax\((\d+)px\s*,\s*1fr\)/g)].map((m) => m[0]);

test('the draw, the category sorting and the hero photos of a tournament use columns that shrink on a phone', () => {
  for (const file of ['js/season-draw.js', 'js/season-assign.js']) assert.deepStrictEqual(bareMinmax(read(file)), [], `${file} has a column with a fixed minimum`);
  const css = read('css/style.css');
  for (const selector of ['.sa-hero-grid', '.tr-box']) {
    const line = css.split('\n').find((l) => l.startsWith(`${selector} {`));
    assert.ok(line, `${selector} has a rule`);
    assert.deepStrictEqual(bareMinmax(line), [], `${selector} has a column with a fixed minimum`);
    assert.ok(/minmax\(min\(\d+px, 100%\), 1fr\)/.test(line), `${selector} shrinks`);
  }
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
