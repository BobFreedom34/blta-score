const { db } = require('./core');

// ---------- the cities (leagues) ----------
// One app serves every city: SLTA (Slovenská liga tenisových amatérov) has a league per city, each with its own seasons, players, venues and
// rankings, and Bratislava is BLTA, the first one (id 1). The design and the code are shared by all of them; what belongs to a city carries its
// league_id. Everything that already existed belongs to Bratislava (the DEFAULT 1 below), so nothing changes for the visitors of blta.sk.
// slug: the address slta.sk/<slug>; domain: an own domain of the city ('' = only slta.sk/<slug>), e.g. blta.sk for Bratislava;
// status: ACTIVE (running), ACTIVE_SEEKING (running and still looking for an organiser), PREPARING (in preparation), COMING_SOON (pre-registration only), SEEKING_ORGANIZER (a league is wanted, nobody runs it yet),
// HIDDEN (not shown on the picker).
db.exec(`
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    brand_name TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'HIDDEN',
    lat REAL,
    lng REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);
if (!db.prepare('SELECT 1 FROM leagues WHERE id = 1').get()) {
  db.prepare("INSERT INTO leagues (id, slug, name, brand_name, domain, status, lat, lng, sort_order) VALUES (1, 'bratislava', 'Bratislava', 'BLTA', 'blta.sk', 'ACTIVE', 48.1486, 17.1077, 0)").run();
}
// The name of the city in the 6th case ("v Košiciach"), written by hand in Backend > Cities: Slovak cannot be declined by a rule, and the home page of a city says
// "SLTA Košice – Slovenská liga tenisových amatérov v Košiciach" (and its intro "… pre rekreačných hráčov v Košiciach").
if (!db.prepare('PRAGMA table_info(leagues)').all().some((c) => c.name === 'name_locative')) {
  db.exec("ALTER TABLE leagues ADD COLUMN name_locative TEXT NOT NULL DEFAULT ''");
  const known = { bratislava: 'v Bratislave', kosice: 'v Košiciach', trnava: 'v Trnave', 'banska-bystrica': 'v Banskej Bystrici' };
  Object.keys(known).forEach((slug) => db.prepare("UPDATE leagues SET name_locative = ? WHERE slug = ? AND name_locative = ''").run(known[slug], slug));
}
for (const table of ['seasons', 'venues', 'players', 'matches', 'header_items', 'winner_editions', 'carousel_slides', 'brackets', 'schedule_events']) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes('league_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN league_id INTEGER NOT NULL DEFAULT 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_league ON ${table}(league_id)`);
}

// A match belongs to the city of its season (else of its first player), whoever creates it and from wherever in the app.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_matches_league AFTER INSERT ON matches
  BEGIN
    UPDATE matches SET league_id = COALESCE((SELECT league_id FROM seasons WHERE id = NEW.season_id), (SELECT league_id FROM players WHERE id = NEW.player1_id), 1)
    WHERE id = NEW.id AND NEW.league_id = 1;
  END;
`);

// The admins of a single city (Backend > Admins). The super admin is not in this table: it logs in with the ADMIN_PASSWORD of the server.
// A city admin runs only the seasons, players, venues, brackets, winners, pictures and menu of the city of league_id.
db.exec(`
  CREATE TABLE IF NOT EXISTS city_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_city_admins_league ON city_admins(league_id);
`);

// Lookups the lists and the group tables make on every request: a player's matches (either side), a group's or a
// season's matches, and the date order. Without these each one reads the whole matches table.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id);
  CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_id);
  CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
  CREATE INDEX IF NOT EXISTS idx_matches_scheduled_at ON matches(scheduled_at);
`);
