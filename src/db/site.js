const { db } = require('./core');

// The site's top nav (see #header-dynamic-items in every page + renderHeaderNav
// in common.js) — a top-level item has parent_id NULL; a sub-item points at
// one, and only one level of nesting is allowed (enforced in
// routes/headerItems.js, not here). label_en is nullable — a custom item an
// admin only bothers to type once falls back to label_sk on the English
// site rather than disappearing. is_my_profile marks the single row that
// stands in for the "My profile" link — that link's actual label/href/click
// behavior stays driven by player-login state (see .nav-my-profile-link +
// updatePlayerNavLinks in common.js), not by this table's label_sk/label_en/
// link columns, so routes/headerItems.js only ever lets its sort_order be
// edited — but giving it a real row here is what lets an admin move it
// anywhere among the other items instead of it being stuck in a fixed spot.
db.exec(`
  CREATE TABLE IF NOT EXISTS header_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES header_items(id),
    label_sk TEXT NOT NULL,
    label_en TEXT,
    link TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_my_profile INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Tennis court venues an admin maintains (names only for now) — offered as
// autocomplete suggestions wherever a match's location is typed in. The
// match's own `location` column stays free text, so deleting/renaming a
// venue here never touches existing matches.
db.exec(`
  CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Everything the public /courts pages show about a venue. All optional —
// a venue created with just a name (the original behaviour) stays valid.
// surfaces/facilities hold JSON arrays of fixed keys (see src/venues.js),
// so the pages can translate them instead of showing admin-typed text.
// seeded_at marks a venue whose details were filled in once by
// src/venueSeed.js, so a later edit (or clearing a field) is never
// overwritten by the seed on the next boot.
const venueColumns = db.prepare('PRAGMA table_info(venues)').all().map((c) => c.name);
Object.entries({
  slug: 'TEXT',
  area: 'TEXT',
  address: 'TEXT',
  phone: 'TEXT',
  email: 'TEXT',
  website: 'TEXT',
  booking_url: 'TEXT',
  instagram: 'TEXT',
  facebook: 'TEXT',
  court_type: 'TEXT',
  courts_count: 'INTEGER',
  surfaces: 'TEXT',
  opening_hours: 'TEXT',
  price: 'TEXT',
  facilities: 'TEXT',
  description: 'TEXT',
  lat: 'REAL',
  lng: 'REAL',
  seeded_at: 'TEXT',
  image_url: 'TEXT',
  // what Google and link previews show for this court's own page (empty = the shared texts of Backend > SEO > Court page, and the photo above)
  seo_title_sk: 'TEXT',
  seo_title_en: 'TEXT',
  seo_description_sk: 'TEXT',
  seo_description_en: 'TEXT',
  seo_image: 'TEXT',
}).forEach(([column, type]) => {
  if (!venueColumns.includes(column)) db.exec(`ALTER TABLE venues ADD COLUMN ${column} ${type}`);
});
// the position of a venue in the list (Backend > Venues: drag to reorder); venues without one come after the others, alphabetically
if (!db.prepare('PRAGMA table_info(venues)').all().some((c) => c.name === 'sort_order')) db.exec('ALTER TABLE venues ADD COLUMN sort_order INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_slug ON venues(slug)');

// One-shot markers for data migrations that must never re-run (e.g. adding a
// default menu item an admin may later delete on purpose).
db.exec(`
  CREATE TABLE IF NOT EXISTS app_flags (
    key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const headerItemColumns = db.prepare('PRAGMA table_info(header_items)').all().map((c) => c.name);
if (!headerItemColumns.includes('is_my_profile')) {
  db.exec('ALTER TABLE header_items ADD COLUMN is_my_profile INTEGER NOT NULL DEFAULT 0');
}
// An item shown as a green button in the top menu (a switch on the item in /header-admin).
if (!headerItemColumns.includes('highlight')) {
  db.exec('ALTER TABLE header_items ADD COLUMN highlight INTEGER NOT NULL DEFAULT 0');
}
// An item shown as a button with a green frame and green words (the "Turnaje" item; a switch on the item in /header-admin).
if (!headerItemColumns.includes('outline')) {
  db.exec('ALTER TABLE header_items ADD COLUMN outline INTEGER NOT NULL DEFAULT 0');
}
// Róbert Sloboda (who runs the league) is left out of "Hráči mesiaca" on the home page for good, once; the switch on the player in the Players page can
// change it later (an app_flags row stops this from running again)
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'owner_no_highlights'").get()) {
  db.prepare("UPDATE players SET no_highlights = 1 WHERE slug = 'sloboda'").run();
  db.prepare("INSERT INTO app_flags (key) VALUES ('owner_no_highlights')").run();
}
// The doubles badges (counted from doubles matches only, see src/badgeEngine.js), added once. The app_flags row, not the badges, stops a re-add:
// an admin who edits or deletes one keeps it so.
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'doubles_badges'").get()) {
  const next = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM badge_definitions').get() || { n: 0 }).n;
  const add = db.prepare('INSERT INTO badge_definitions (name, description, icon, logic_type, threshold, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['Doubles debut', 'Play your 1st doubles match', '🤝', 'DOUBLES_GAMES', 1],
    ['Doubles regular', 'Play 10 doubles matches', '👥', 'DOUBLES_GAMES', 10],
    ['First doubles win', 'Win your 1st doubles match', '🥇', 'DOUBLES_WINS', 1],
    ['Doubles winner', 'Win 10 doubles matches', '🏅', 'DOUBLES_WINS', 10],
    ['Doubles streak', 'Win 3 doubles matches in a row', '🔥', 'DOUBLES_WIN_STREAK', 3],
    ['Team player', 'Play doubles with 3 different partners', '🎾', 'DOUBLES_PARTNERS', 3],
  ].forEach((row, i) => add.run(...row, next + i));
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('doubles_badges')").run();
}
// Once: the main menu item "Liga" becomes a green button (after that the switch in /header-admin owns it).
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'menu_liga_green'").get()) {
  db.prepare("UPDATE header_items SET highlight = 1 WHERE parent_id IS NULL AND lower(label_sk) = 'liga'").run();
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('menu_liga_green')").run();
}

// Seed the header with the site's existing static nav links, once — after
// that, admins own this list entirely (see /header-admin), same pattern as
// badge_definitions above.
const headerItemCount = db.prepare('SELECT COUNT(*) AS c FROM header_items').get().c;
if (headerItemCount === 0) {
  const seedHeaderItem = db.prepare(
    'INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)'
  );
  [
    ['Zápasy', 'Matches', '/', 0],
    ['Hráči', 'Players', '/players', 1],
    ['Rebríček', 'Rankings', '/rankings', 2],
    ['Hľadám súpera', 'Looking to play', '/looking-to-play', 3],
    ['+ Nový zápas', '+ New match', '/new-match', 4],
  ].forEach(([labelSk, labelEn, link, sortOrder]) => seedHeaderItem.run(labelSk, labelEn, link, sortOrder));
}

// The "My profile" placeholder row — seeded once, separately from the block
// above, so it also gets created for a database that already had header_items
// rows before this row existed (i.e. everyone who deployed the header manager
// before this). Appended at the end by default; an admin can drag... er,
// re-sort it via /header-admin like any other item.
const myProfileRowCount = db.prepare('SELECT COUNT(*) AS c FROM header_items WHERE is_my_profile = 1').get().c;
if (myProfileRowCount === 0) {
  const maxSortOrder = db.prepare('SELECT MAX(sort_order) AS m FROM header_items').get().m;
  db.prepare(
    'INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order, is_my_profile) VALUES (NULL, ?, ?, ?, ?, 1)'
  ).run('Môj profil', 'My profile', '#', (maxSortOrder == null ? 0 : maxSortOrder) + 1);
}

// CourtIQ briefly shipped as its own /courtiq nav item (and seeded itself
// into header_items the same way the "My profile" row above does) before
// becoming a tab on the existing Rankings page instead (see rankings.js) —
// this removes that row from any install that already has it. Cheap to run
// unconditionally on every boot rather than guarding it like the seeds
// above: a DELETE of a row that's already gone is a no-op either way.
db.exec("DELETE FROM header_items WHERE link = '/courtiq'");
