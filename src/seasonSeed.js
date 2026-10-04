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

module.exports = { run, assign, indexSeasons, fold, BLTA_CATEGORIES };
