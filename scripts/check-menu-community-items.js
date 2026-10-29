// Checks that "Komunity a kluby" reaches the menu of EVERY city (src/seasonSeed.js ensureCommunityMenuItems): the menu is data of each city, so the item added in
// Backend > Menu of the first city was missing everywhere else. Messages ("Správy") is not a menu item any more: it is an icon in the top strip of every page.
// Run: node scripts/check-menu-community-items.js   (works on an in-memory database; touches nothing else)
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const seasonSeed = require('../src/seasonSeed');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE app_flags (key TEXT PRIMARY KEY);
    CREATE TABLE header_items (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, label_sk TEXT, label_en TEXT, link TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      is_my_profile INTEGER NOT NULL DEFAULT 0, highlight INTEGER NOT NULL DEFAULT 0, league_id INTEGER NOT NULL DEFAULT 1);
  `);
  [1, 2, 3, 4].forEach((id) => db.prepare('INSERT INTO leagues (id, slug) VALUES (?, ?)').run(id, `c${id}`));
  const add = (league, link, sort, parent = null) => db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order, league_id) VALUES (?, ?, ?, ?, ?, ?)').run(parent, link, link, link, sort, league);
  add(1, '/', 0); add(1, '/communities', 1); add(1, '/messages', 2);        // the first city has both already
  add(2, '/', 0); add(2, '/rankings', 1);                                     // a city with a menu and none of them
  add(3, '/', 0); add(3, '/messages', 1);                                     // a city with one of them
  // city 4 has no menu at all
  return { db, add };
}
const links = (db, league) => db.prepare('SELECT link FROM header_items WHERE league_id = ? AND parent_id IS NULL ORDER BY sort_order, id').all(league).map((r) => r.link);

test('every city that has a menu gets the item it lacks, at the end; the one it has is not doubled', () => {
  const { db } = makeDb();
  seasonSeed.ensureCommunityMenuItems(db);
  assert.deepStrictEqual(links(db, 1), ['/', '/communities', '/messages'], 'the first city is unchanged');
  assert.deepStrictEqual(links(db, 2), ['/', '/rankings', '/communities']);
  assert.deepStrictEqual(links(db, 3), ['/', '/messages', '/communities'], 'an existing Messages item is left as it is (the page hides it)');
  const item = db.prepare("SELECT label_sk, label_en FROM header_items WHERE league_id = 2 AND link = '/communities'").get();
  assert.deepStrictEqual([item.label_sk, item.label_en], ['Komunity a kluby', 'Communities and clubs']);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM header_items WHERE league_id = 2 AND link = '/messages'").get().n, 0, 'Messages is not put in the menu');
});

test('a city without any menu is left alone (its admin builds the menu), and it is not seeded later behind his back', () => {
  const { db } = makeDb();
  seasonSeed.ensureCommunityMenuItems(db);
  assert.deepStrictEqual(links(db, 4), []);
});

test('it runs once per city: a second run adds nothing, and an item an admin deleted afterwards stays deleted', () => {
  const { db } = makeDb();
  seasonSeed.ensureCommunityMenuItems(db);
  const before = JSON.stringify([1, 2, 3, 4].map((id) => links(db, id)));
  db.prepare("DELETE FROM header_items WHERE league_id = 2 AND link = '/communities'").run();
  seasonSeed.ensureCommunityMenuItems(db);
  assert.deepStrictEqual(links(db, 2), ['/', '/rankings'], 'deleted by the admin of the city: not put back');
  assert.strictEqual(JSON.stringify([1, 3, 4].map((id) => links(db, id))), JSON.stringify(JSON.parse(before).filter((_, i) => i !== 1)), 'nothing else changed');
});

test('a city that already has the link as a sub-item is not given a second one', () => {
  const { db, add } = makeDb();
  const parent = Number(add(2, '/more', 2).lastInsertRowid);
  add(2, '/communities', 0, parent);
  seasonSeed.ensureCommunityMenuItems(db);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM header_items WHERE league_id = 2 AND link = '/communities'").get().n, 1);
});

test('Messages is an icon in the top strip (with its unread badge) and the old menu item is not drawn', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/js/common.js'), 'utf8');
  assert.ok(js.includes("id = 'topbar-msg'") && js.includes("courtIcon('send')") && js.includes("t('msg.heading')"), 'the icon link in .topbar-right');
  assert.ok(js.includes("getElementById('topbar-msg')") && js.includes('nav-msg-badge'), 'the unread badge goes on the icon');
  assert.ok(js.includes("i.link !== '/messages'"), 'the main menu skips the Messages item of a city that still has it');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  assert.ok(css.includes('.topbar-msg { order: 9;'), 'it sits just before the bell');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
