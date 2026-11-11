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
  ['.sch-lists .sch-row', '.sch-reg {', ':is(.sch-lists, .com-news-tournament) .sch-eta', ':is(.sch-lists, .com-news-tournament) .sch-chip'].forEach((rule) => assert.ok(css.includes(rule), `style.css has ${rule}`));
  assert.ok(!/\.sl-sched \.sch-(card|row|go|reg|acts|eta|chip|tags|title|sub|date|info|text|name)/.test(read('slta.html')), 'slta.html no longer carries its own copy of the card rules');
  assert.ok(read('slta.html').includes('class="sl-sched sch-lists"'), 'the national schedule carries sch-lists');
  assert.ok(/id="sch-root" class="sch-lists"/.test(read('harmonogram.html')), 'the schedule page carries sch-lists');
});

test('the schedule page builds the same row: countdown, tags, chips, Registrácia next to Viac info, no logo; all events in the order of time', () => {
  const js = read('js/harmonogram.js');
  const row = read('js/schedule-row.js'); // (the row itself is drawn by the one template that the cards of the clubs use too)
  ['sch-eta', 'sch-tags', 'sch-chip', 'sch-extra', 'sch-acts', 'sch-reg'].forEach((s) => assert.ok(row.includes(s), `schedule-row.js has ${s}`));
  assert.ok(js.includes('schRow.html') && js.includes('registrationOpen'), 'the schedule page draws its rows with the shared template');
  assert.ok(!js.includes('sch-logo') && !row.includes('sch-logo'), 'the row has no logo');
  assert.ok(!js.includes('runningHtml'), 'the running events are not pulled out of the order of time: past, running and coming stand by their dates');
  assert.ok(js.includes('BLTA_LOCALIZE'), 'the registration button goes to the address of the page language');
});

test('ONE template: the Harmonogram and the tournament cards of the clubs draw the row with schRow.html and share the rules in style.css', () => {
  const club = read('js/community-post.js');
  assert.ok(club.includes('schRow.html') && !club.includes('class="sch-row'), 'the club card has no markup of its own');
  assert.ok(read('js/harmonogram.js').includes('schRow.html') && !read('js/harmonogram.js').includes('class="sch-row'), 'the Harmonogram has no markup of its own');
  for (const page of ['harmonogram.html', 'community.html', 'communities.html']) assert.ok(read(page).includes('/js/schedule-row.js'), `${page} loads the template`);
  assert.ok(read('slta.html').includes('/js/schedule-row.js') && read('slta.html').includes('schRow.html') && !read('slta.html').includes('class="sch-row'), 'the national page draws its rows with the template too');
  const css = read('css/style.css');
  assert.ok(css.includes(':is(.sch-lists, .com-news-tournament) .sch-row.has-poster'), 'the poster rules are written once for both');
  assert.ok(!/.com-news-tournament .sch-(date|go|acts|name)/.test(css), 'the club card has no copy of the row rules');
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
