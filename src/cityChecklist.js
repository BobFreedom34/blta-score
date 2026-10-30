// The launch checklist of a city (Backend > Cities): what a new city still needs before it can be opened to the public - a pin on the map, an
// organiser, a venue, a season that takes registrations, its rules, menu, info texts, home carousel and SEO texts. Every item is worked out from
// the data of the city itself (nothing is stored), so it ticks by itself as the city's backend fills up.
// Each item: { key, ok, label, hint, page } - `page` is the Backend page where it is done.
const db = require('./db');

function checklistOf(leagueId) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return null;
  const today = new Date().toISOString().slice(0, 10);
  const n = (sql, ...args) => db.prepare(sql).get(leagueId, ...args).n;

  const items = [
    {
      key: 'pin', page: '/leagues-admin', label: 'A pin on the map',
      hint: 'Latitude and longitude, so the city shows on the map of slta.sk.',
      ok: league.lat != null && league.lng != null,
    },
    {
      key: 'organiser', page: '/admins-admin', label: 'An organiser with a login',
      hint: 'A city admin who runs the league (Backend > Admins).',
      ok: n('SELECT COUNT(*) AS n FROM city_admins WHERE league_id = ?') > 0,
    },
    {
      key: 'venue', page: '/venues-admin', label: 'At least one venue',
      hint: 'The courts where the matches are played.',
      ok: n('SELECT COUNT(*) AS n FROM venues WHERE league_id = ?') > 0,
    },
    {
      key: 'season', page: '/seasons-admin', label: 'A season with dates',
      hint: 'A league season with a start and an end date.',
      ok: n("SELECT COUNT(*) AS n FROM seasons WHERE league_id = ? AND organisation_id IS NULL AND COALESCE(kind, 'LEAGUE') = 'LEAGUE' AND COALESCE(start_date, '') != ''") > 0,
    },
    {
      key: 'registration', page: '/seasons-admin', label: 'Registration is open',
      hint: 'A season or tournament that takes registrations, so players can sign up.',
      ok: n("SELECT COUNT(*) AS n FROM seasons WHERE league_id = ? AND organisation_id IS NULL AND registration_open = 1 AND (end_date IS NULL OR end_date = '' OR end_date >= ?)", today) > 0,
    },
    {
      key: 'rules', page: '/rules-admin', label: 'The rules (Propozície)',
      hint: 'The rules page of the city: categories, scoring, dates.',
      ok: n('SELECT COUNT(*) AS n FROM rules_sections WHERE league_id = ?') > 0,
    },
    {
      key: 'menu', page: '/header-admin', label: 'The menu',
      hint: 'The menu of the city. Backend > Menu can copy the menu of another city.',
      ok: n('SELECT COUNT(*) AS n FROM header_items WHERE league_id = ?') > 0,
    },
    {
      key: 'about', page: '/about-admin', label: 'The info window (O nás)',
      hint: 'The texts about the league, its rules and its categories.',
      ok: n("SELECT COUNT(*) AS n FROM about_sections WHERE league_id = ? AND COALESCE(html, '') != ''") > 0,
    },
    {
      key: 'carousel', page: '/carousel-admin', label: 'A picture on the home page',
      hint: 'At least one slide of the home carousel.',
      ok: n('SELECT COUNT(*) AS n FROM carousel_slides WHERE league_id = ? AND active = 1') > 0,
    },
    {
      key: 'seo', page: '/seo-admin', label: 'Search engine texts',
      hint: 'The titles and descriptions of the pages, written for the city.',
      ok: n('SELECT COUNT(*) AS n FROM seo_city_pages WHERE league_id = ?') > 0,
    },
    {
      key: 'visible', page: '/leagues-admin', label: 'The city is shown on slta.sk',
      hint: 'The status is not "Hidden".',
      ok: league.status !== 'HIDDEN',
    },
  ];
  return { done: items.filter((i) => i.ok).length, total: items.length, items };
}

module.exports = { checklistOf };
