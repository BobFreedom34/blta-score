// One-off: creates the seasons/groups from seasonData.js and tags the existing BLTA matches with their
// season and group. Runs at most once per database (flag in app_flags); admins manage everything
// themselves afterwards in /seasons-admin, so later edits and deletions are never overwritten.

const { SEASONS } = require('./seasonData');

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// "Ľubomír Šimkovič" / "Lubomir Simkovic" / "Jerry O’Neil" all compare equal.
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Note like: 7. kolo NEXT GEN "Technifibre"
const KOLO_RE = /^\s*\d+\.\s*kolo\s+(ELITE|NEXT\s*GEN|NOVICE)\s*["„“”](.+?)["„“”]/i;
const SEASON_WORDS = [
  [/summer\s*rally/i, 'summer-rally-series-2026'],
  [/winter\s*opening/i, 'winter-opening-series-2026'],
  [/autumn|jesenn/i, 'autumn-finals-series-2026'],
];

// Summer's play-offs and finals were played in September–November, i.e. inside the autumn window.
const PLAYOFF_RE = /play-?off|fin[aá]le|semi/i;

function indexSeasons(seasons) {
  return seasons.map((s) => ({
    ...s,
    groups: s.groups.map((g) => ({ ...g, members: new Set(g.players.map(fold)) })),
  }));
}

// match: { category, notes, date (ISO string), player1, player2 (names) }
// Returns { seasonSlug, groupName } — either may be null. Only BLTA categories get anything.
function assign(match, indexed) {
  if (!BLTA_CATEGORIES.includes(match.category)) return { seasonSlug: null, groupName: null };
  const day = String(match.date || '').slice(0, 10);
  const notes = String(match.notes || '');

  const kolo = notes.match(KOLO_RE);
  if (kolo) {
    const cat = kolo[1].toUpperCase().replace(/\s+/g, '_');
    const name = fold(kolo[2]);
    const candidates = indexed.filter((s) => s.groups.some((g) => fold(g.name) === name && g.category === cat));
    if (candidates.length) {
      const season = candidates.find((s) => day >= s.from && day <= s.to) || candidates[candidates.length - 1];
      const group = season.groups.find((g) => fold(g.name) === name && g.category === cat);
      return { seasonSlug: season.slug, groupName: group.name };
    }
  }

  let season = null;
  for (const [re, slug] of SEASON_WORDS) {
    if (re.test(notes)) { season = indexed.find((s) => s.slug === slug) || null; break; }
  }
  if (!season) season = indexed.find((s) => day >= s.from && day <= s.to) || null;
  if (season && season.slug === 'autumn-finals-series-2026' && PLAYOFF_RE.test(notes) && day < '2026-12-01') {
    season = indexed.find((s) => s.slug === 'summer-rally-series-2026') || season;
  }
  if (!season) return { seasonSlug: null, groupName: null };

  const a = fold(match.player1);
  const b = fold(match.player2);
  const group = season.groups.find((g) => (season.anyCategory || g.category === match.category) && g.members.has(a) && g.members.has(b));
  return { seasonSlug: season.slug, groupName: group ? group.name : null };
}

// db: the app's node:sqlite handle. Idempotent via app_flags.
function run(db) {
  const flag = db.prepare("SELECT 1 FROM app_flags WHERE key = 'seasons_seeded'").get();
  if (flag) return { skipped: true };

  const insertSeason = db.prepare('INSERT INTO seasons (name, slug, start_date, end_date, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insertGroup = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)');
  const seasonId = {};
  const groupId = {};

  db.exec('BEGIN');
  try {
    SEASONS.forEach((s, i) => {
      const existing = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(s.slug);
      const id = existing ? existing.id : Number(insertSeason.run(s.name, s.slug, s.from, s.to, i).lastInsertRowid);
      seasonId[s.slug] = id;
      s.groups.forEach((g, j) => {
        const row = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ?').get(id, g.name);
        groupId[`${s.slug}|${g.name}`] = row ? row.id : Number(insertGroup.run(id, g.name, g.category, j).lastInsertRowid);
      });
    });

    const indexed = indexSeasons(SEASONS);
    const rows = db.prepare(`
      SELECT m.id, m.category, m.notes, COALESCE(m.scheduled_at, m.end_time, m.created_at) AS d, p1.name AS n1, p2.name AS n2
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      WHERE m.category IN ('ELITE', 'NEXT_GEN', 'NOVICE') AND m.season_id IS NULL
    `).all();
    const update = db.prepare('UPDATE matches SET season_id = ?, group_id = ? WHERE id = ?');
    let tagged = 0;
    for (const r of rows) {
      const res = assign({ category: r.category, notes: r.notes, date: r.d, player1: r.n1, player2: r.n2 }, indexed);
      if (!res.seasonSlug) continue;
      update.run(seasonId[res.seasonSlug], res.groupName ? groupId[`${res.seasonSlug}|${res.groupName}`] : null, r.id);
      tagged += 1;
    }
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('seasons_seeded')").run();
    db.exec('COMMIT');
    return { skipped: false, tagged, total: rows.length };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// One-off correction: Winter Opening Series 2026 was drawn on 21.12.2025 and its first group matches were played
// in the last days of December, so those matches belong to it, not to the previous season (whose play-offs ended
// before). Moves the season boundary and re-tags only the BLTA matches dated 21–31 December 2025 that are still
// tagged with the previous season. Runs once.
function fixWinterStart(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'seasons_winter_start_fix'").get()) return { skipped: true };
  const first = db.prepare("SELECT id FROM seasons WHERE slug = 'blta-nulty-rocnik-2025'").get();
  const winter = db.prepare("SELECT id FROM seasons WHERE slug = 'winter-opening-series-2026'").get();
  let moved = 0;
  db.exec('BEGIN');
  try {
    if (first && winter) {
      db.prepare("UPDATE seasons SET end_date = '2025-12-20' WHERE id = ? AND end_date = '2025-12-31'").run(first.id);
      db.prepare("UPDATE seasons SET start_date = '2025-12-21' WHERE id = ? AND start_date = '2026-01-01'").run(winter.id);
      const indexed = indexSeasons(SEASONS);
      const groupId = {};
      SEASONS.forEach((s) => {
        const sid = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(s.slug);
        if (!sid) return;
        s.groups.forEach((g) => {
          const row = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ?').get(sid.id, g.name);
          if (row) groupId[`${s.slug}|${g.name}`] = row.id;
        });
      });
      const rows = db.prepare(`
        SELECT m.id, m.category, m.notes, COALESCE(m.scheduled_at, m.end_time, m.created_at) AS d, p1.name AS n1, p2.name AS n2
        FROM matches m
        JOIN players p1 ON p1.id = m.player1_id
        JOIN players p2 ON p2.id = m.player2_id
        WHERE m.category IN ('ELITE', 'NEXT_GEN', 'NOVICE') AND m.season_id = ?
          AND substr(COALESCE(m.scheduled_at, m.end_time, m.created_at), 1, 10) BETWEEN '2025-12-21' AND '2025-12-31'
      `).all(first.id);
      const update = db.prepare('UPDATE matches SET season_id = ?, group_id = ? WHERE id = ?');
      for (const r of rows) {
        const res = assign({ category: r.category, notes: r.notes, date: r.d, player1: r.n1, player2: r.n2 }, indexed);
        if (res.seasonSlug !== 'winter-opening-series-2026') continue;
        update.run(winter.id, res.groupName ? (groupId[`${res.seasonSlug}|${res.groupName}`] || null) : null, r.id);
        moved += 1;
      }
    }
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('seasons_winter_start_fix')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { skipped: false, moved };
}

// The "Tables" menu item, added once (an admin can rename, move or delete it afterwards).
function ensureTablesMenuItem(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'menu_tables_added'").get()) return;
  if (!db.prepare("SELECT 1 FROM header_items WHERE link = '/tables'").get()) {
    const rankings = db.prepare("SELECT sort_order FROM header_items WHERE link = '/rankings' AND parent_id IS NULL").get();
    const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM header_items').get().m;
    const sortOrder = rankings ? rankings.sort_order : (maxSort == null ? 0 : maxSort) + 1;
    db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)')
      .run('Tabuľky', 'Tables', '/tables', sortOrder);
  }
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('menu_tables_added')").run();
}

// The match list moved from / to /matches when the league overview became the home page. One time: menu items that
// pointed at / now point at /matches, and a new first item "Domov"/"Home" points at the overview. After that
// the admin owns the menu again.
function ensureHomeMenuItem(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'menu_home_matches'").get()) return;
  db.prepare("UPDATE header_items SET link = '/matches' WHERE link = '/'").run();
  const first = db.prepare('SELECT MIN(sort_order) AS m FROM header_items').get().m;
  db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)')
    .run('Domov', 'Home', '/', (first == null ? 0 : first) - 1);
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('menu_home_matches')").run();
}

// The "Harmonogram" menu item (the schedule page), added once right after "Tabuľky" (an admin can rename, move or delete it
// afterwards).
function ensureScheduleMenuItem(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'menu_schedule_added'").get()) return;
  if (!db.prepare("SELECT 1 FROM header_items WHERE link = '/harmonogram'").get()) {
    const tables = db.prepare("SELECT sort_order FROM header_items WHERE link = '/tables' AND parent_id IS NULL").get();
    let sortOrder;
    if (tables) {
      sortOrder = tables.sort_order + 1;
      db.prepare('UPDATE header_items SET sort_order = sort_order + 1 WHERE parent_id IS NULL AND sort_order >= ?').run(sortOrder);
    } else {
      const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM header_items').get().m;
      sortOrder = (maxSort == null ? 0 : maxSort) + 1;
    }
    db.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)')
      .run('Harmonogram', 'Schedule', '/harmonogram', sortOrder);
  }
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('menu_schedule_added')").run();
}

module.exports = { run, assign, indexSeasons, fold, BLTA_CATEGORIES, ensureTablesMenuItem, ensureHomeMenuItem, ensureScheduleMenuItem, fixWinterStart };
