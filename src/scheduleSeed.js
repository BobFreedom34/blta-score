// One-off: the two tournaments of the 2025 calendar that blta.sk lists on its schedule page, so the app's schedule
// starts with the same events. Runs once (flag in app_flags); after that the events are managed in /seasons-admin and
// are never re-created or overwritten.
const TOURNAMENTS = [
  { name: 'Slávia Filozof Cup 2025', start: '2025-09-27', end: '2025-09-28', venue: 'Nevädzová 804/2, 821 01 Ružinov', link: 'https://www.blta.sk/events/slavia-filozof-cup-2025/', categories: 'ELITE,NEXT_GEN,NOVICE' },
  { name: 'Tenis ONE Trophy 2025', start: '2025-12-13', end: '2025-12-14', venue: 'Nobelova 34, 831 02 Bratislava', link: 'https://www.blta.sk/events/tenis-one-trophy-2025/', categories: 'ELITE,NEXT_GEN' },
];

function seedScheduleEvents(db) {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'schedule_events_seeded'").get()) return { skipped: true };
  const insert = db.prepare('INSERT INTO schedule_events (name, start_date, end_date, venue, link, categories) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    TOURNAMENTS.forEach((e) => insert.run(e.name, e.start, e.end, e.venue, e.link, e.categories));
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('schedule_events_seeded')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { inserted: TOURNAMENTS.length };
}

module.exports = { seedScheduleEvents };
