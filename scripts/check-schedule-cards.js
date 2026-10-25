// Check that the schedule lists of the site share one design (public/css/style.css .sch-lists): the schedule page of a city (public/js/harmonogram.js)
// and the schedule of a city on the national page (public/slta.html) use the same card rules; the page puts the running events first and gives a
// season with an open registration its green "Registrácia" button.
// Run: node scripts/check-schedule-cards.js   (reads the files only; touches nothing)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the card rules live once, in style.css, and both lists carry the class sch-lists', () => {
  const css = read('css/style.css');
  ['.sch-lists .sch-row', '.sch-reg {', '.sch-lists .sch-eta', '.sch-lists .sch-chip'].forEach((rule) => assert.ok(css.includes(rule), `style.css has ${rule}`));
  assert.ok(!/\.sl-sched \.sch-(card|row|go|reg|acts|eta|chip|tags|title|sub|date|info|text|name)/.test(read('slta.html')), 'slta.html no longer carries its own copy of the card rules');
  assert.ok(read('slta.html').includes('class="sl-sched sch-lists"'), 'the national schedule carries sch-lists');
  assert.ok(/id="sch-root" class="sch-lists"/.test(read('harmonogram.html')), 'the schedule page carries sch-lists');
});

test('the schedule page builds the same row: countdown, tags, chips, Registrácia next to Viac info, no logo; all events in the order of time', () => {
  const js = read('js/harmonogram.js');
  ['sch-eta', 'sch-tags', 'sch-chip', 'sch-extra', 'sch-acts', 'sch-reg', 'registrationOpen'].forEach((s) => assert.ok(js.includes(s), `harmonogram.js has ${s}`));
  assert.ok(!js.includes('sch-logo'), 'the row has no logo');
  assert.ok(!js.includes('runningHtml'), 'the running events are not pulled out of the order of time: past, running and coming stand by their dates');
  assert.ok(js.includes('BLTA_LOCALIZE'), 'the registration button goes to the address of the page language');
});

test('the words exist in both languages', () => {
  const i18n = read('js/i18n.js');
  assert.strictEqual(i18n.split("'schedule.register'").length, 3, 'schedule.register in Slovak and English');
});

let failed = 0;
tests.forEach((t) => {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
});
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
