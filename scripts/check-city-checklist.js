// Checks of the launch checklist of a city (src/cityChecklist.js, Backend > Cities): a new city has nothing ticked, every step ticks by itself
// when its data is there (and only for that city), and the numbers add up.
// Run: node scripts/check-city-checklist.js   (works on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
// the modules that make the tables of the texts (the server loads them all when it starts)
require('../src/rules');
require('../src/about');
require('../src/seo');
const { checklistOf } = require('../src/cityChecklist');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const cityId = () => db.prepare("SELECT id FROM leagues WHERE slug = 'nitra'").get().id;
const tick = (list, key) => list.items.find((i) => i.key === key).ok;

test('a new city (hidden, no data) has nothing ticked but the steps that do not need data', () => {
  db.prepare("INSERT INTO leagues (slug, name, brand_name, status) VALUES ('nitra', 'Nitra', 'SLTA Nitra', 'HIDDEN')").run();
  const list = checklistOf(cityId());
  assert.strictEqual(list.total, 11);
  assert.strictEqual(list.done, 0, JSON.stringify(list.items.filter((i) => i.ok).map((i) => i.key)));
  assert.ok(list.items.every((i) => i.label && i.hint && i.page.startsWith('/')));
});

test('every step ticks when its data is there', () => {
  const id = cityId();
  db.prepare('UPDATE leagues SET lat = 48.3, lng = 18.08 WHERE id = ?').run(id);
  assert.ok(tick(checklistOf(id), 'pin'));
  db.prepare("INSERT INTO venues (name, slug, league_id) VALUES ('Kurty Nitra', 'kurty-nitra', ?)").run(id);
  assert.ok(tick(checklistOf(id), 'venue'));
  db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, league_id, registration_open) VALUES ('Nitra Open', 'nitra-open', 'LEAGUE', '2999-01-01', '2999-04-30', ?, 1)").run(id);
  const afterSeason = checklistOf(id);
  assert.ok(tick(afterSeason, 'season') && tick(afterSeason, 'registration'));
  db.prepare("INSERT INTO rules_sections (slug, nav_label, title, body_html, sort_order, league_id) VALUES ('r', 'R', 'Rules', '<p>x</p>', 0, ?)").run(id);
  assert.ok(tick(checklistOf(id), 'rules'));
  db.prepare("INSERT INTO header_items (label_sk, label_en, link, sort_order, league_id) VALUES ('Domov', 'Home', '/', 0, ?)").run(id);
  assert.ok(tick(checklistOf(id), 'menu'));
  db.prepare("INSERT INTO about_sections (league_id, tab, lang, title, html) VALUES (?, 'us', 'sk', 'O nas', '<p>text</p>')").run(id);
  assert.ok(tick(checklistOf(id), 'about'));
  db.prepare("INSERT INTO carousel_slides (image_url, league_id, active) VALUES ('/img/x.png', ?, 1)").run(id);
  assert.ok(tick(checklistOf(id), 'carousel'));
  db.prepare("INSERT INTO seo_city_pages (league_id, page_key, lang, title) VALUES (?, 'home', 'sk', 'Nitra')").run(id);
  assert.ok(tick(checklistOf(id), 'seo'));
  db.prepare("INSERT INTO city_admins (league_id, name, email, password_hash) VALUES (?, 'Org', 'org@example.com', 'x')").run(id);
  assert.ok(tick(checklistOf(id), 'organiser'));
  db.prepare("UPDATE leagues SET status = 'COMING_SOON' WHERE id = ?").run(id);
  const full = checklistOf(id);
  assert.ok(tick(full, 'visible'));
  assert.strictEqual(full.done, full.total, 'everything is ready');
});

test('registration is not ticked for a season that has ended or is closed', () => {
  const id = cityId();
  db.prepare("UPDATE seasons SET end_date = '2001-01-01' WHERE league_id = ?").run(id);
  assert.strictEqual(tick(checklistOf(id), 'registration'), false, 'an ended season takes no registration');
  db.prepare("UPDATE seasons SET end_date = '2999-04-30', registration_open = 0 WHERE league_id = ?").run(id);
  assert.strictEqual(tick(checklistOf(id), 'registration'), false, 'a closed registration');
});

test('the data of one city does not tick the steps of another', () => {
  db.prepare("INSERT INTO leagues (slug, name, brand_name, status, lat, lng) VALUES ('zilina', 'Žilina', 'SLTA Žilina', 'HIDDEN', NULL, NULL)").run();
  const other = checklistOf(db.prepare("SELECT id FROM leagues WHERE slug = 'zilina'").get().id);
  assert.strictEqual(other.done, 0);
  assert.strictEqual(checklistOf(999999), null, 'a city that does not exist');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held on Windows; it is a temporary folder */ }
process.exit(failed ? 1 : 0);
