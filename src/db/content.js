const { db } = require('./core');

// Tournaments and other events of the schedule page (/harmonogram). League seasons are not stored here — the page reads
// them from the seasons table. categories: comma list of ELITE, NEXT_GEN, NOVICE.
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    venue TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT 'ELITE,NEXT_GEN,NOVICE',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// The winners page (/vitazi, Backend > Winners): an edition (a series or tournament) has category blocks, a block has up to four
// places (slot 1 winner, 2 finalist, 3 and 4 semifinalists). A place is a player (player_id) or a typed name, with an optional own
// photo (<data dir>/winner-photos, photo_url is its /winner-photos/… address). Foreign keys are not enforced here (see the
// PRAGMA above), so the winners router deletes a parent's children itself and reads a missing player/season as "not linked".
db.exec(`
  CREATE TABLE IF NOT EXISTS winner_editions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS winner_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edition_id INTEGER NOT NULL REFERENCES winner_editions(id) ON DELETE CASCADE,
    category TEXT CHECK (category IN ('ELITE', 'NEXT_GEN', 'NOVICE')),
    title TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS winner_places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id INTEGER NOT NULL REFERENCES winner_blocks(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
    player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    photo_url TEXT,
    UNIQUE (block_id, slot)
  );
`);

// Small site-wide texts edited in the backend, one JSON value per key ('contact' = the contact window, see routes/contact.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// The image carousel at the top of the home page (Backend > Carousel). The pictures are files on the persistent disk
// (<data dir>/carousel), image_url is their /carousel-images/… address.
db.exec(`
  CREATE TABLE IF NOT EXISTS carousel_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    caption_sk TEXT NOT NULL DEFAULT '',
    caption_en TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// A slide's heading is caption_sk / caption_en; the thin line under it is the subtext.
const carouselColumns = db.prepare('PRAGMA table_info(carousel_slides)').all().map((c) => c.name);
if (!carouselColumns.includes('subtext_sk')) {
  db.exec("ALTER TABLE carousel_slides ADD COLUMN subtext_sk TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE carousel_slides ADD COLUMN subtext_en TEXT NOT NULL DEFAULT ''");
}
// The picture phones get instead of the main one (16:9, a file in <data dir>/carousel); empty = the main picture is used.
if (!carouselColumns.includes('mobile_image_url')) {
  db.exec('ALTER TABLE carousel_slides ADD COLUMN mobile_image_url TEXT');
}
