// One-off: the tournaments of the schedule (the schedule_events table, edited in /schedule-admin) become seasons of the type
// TOURNAMENT, so a tournament has everything a season has — its own page (/season/<slug>), the info tiles and description,
// registration, groups, brackets, matches and winners — and is edited in /seasons-admin. Runs once (flag in app_flags). The
// events are removed from schedule_events (the schedule page reads tournaments from the seasons now; the table stays for the
// plain events without a page). A winners edition with the same title as a tournament is linked to it, so its winners show on
// the tournament page.
const CATEGORY_KEYS = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tournament';
}

function migrateTournaments(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'tournaments_as_seasons'").get()) return { skipped: true };
  const events = db.prepare('SELECT * FROM schedule_events ORDER BY start_date, id').all();
  const taken = (slug) => !!db.prepare('SELECT 1 FROM seasons WHERE slug = ?').get(slug);
  const insert = db.prepare("INSERT INTO seasons (name, slug, start_date, end_date, sort_order, kind, venue, categories) VALUES (?, ?, ?, ?, ?, 'TOURNAMENT', ?, ?)");
  const link = db.prepare('UPDATE winner_editions SET season_id = ? WHERE season_id IS NULL AND lower(title) = lower(?)');
  db.exec('BEGIN');
  try {
    let order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM seasons').get().m;
    events.forEach((e) => {
      const base = slugify(e.name);
      let slug = base;
      for (let n = 2; taken(slug); n += 1) slug = `${base}-${n}`;
      const picked = String(e.categories || '').split(',').filter((c) => CATEGORY_KEYS.includes(c));
      const categories = picked.length && picked.length < CATEGORY_KEYS.length ? picked.join(',') : null;
      order += 1;
      const id = Number(insert.run(e.name, slug, e.start_date, e.end_date || null, order, e.venue || null, categories).lastInsertRowid);
      link.run(id, e.name);
      db.prepare('DELETE FROM schedule_events WHERE id = ?').run(e.id);
    });
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('tournaments_as_seasons')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { moved: events.length };
}

module.exports = { migrateTournaments };
