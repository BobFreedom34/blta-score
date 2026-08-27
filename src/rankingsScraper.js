// Pulls the BLTA point-standings tables from the WordPress site
// (blta.sk/rebricky/) and parses them into plain JSON.
//
// These rankings (BLTA points, per-category "Race" points, tournament
// points) are hand-maintained on WordPress via the SportsPress plugin —
// they aren't something this app computes from its own match data (a
// match win here doesn't map to a fixed point value; tournament results
// aren't tracked here at all). So "staying in sync" means re-reading the
// published page rather than recomputing anything locally.
//
// The page renders these as plain server-side HTML tables (no client-side
// fetch/AJAX involved), each with a stable numeric id
// (sp-league-table-<ID>) and a consistent 4-column structure — rank,
// player (name + link + optional photo), matches played, points. That's
// stable enough to parse with a few targeted regexes rather than pulling
// in a full HTML-parsing dependency for one page.

const SOURCE_URL = 'https://www.blta.sk/rebricky/';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — good enough to feel "live" without hammering blta.sk on every page view.

const TABLES = [
  { id: '5361', key: 'blta', label: 'BLTA', pointsClass: 'bltabody', pointsLabel: 'BLTA Points' },
  { id: '5315', key: 'elite_race', label: 'Elite Race', pointsClass: 'eliterace', pointsLabel: 'Elite Race' },
  { id: '5309', key: 'next_gen_race', label: 'Next Gen Race', pointsClass: 'nextgenrace', pointsLabel: 'Next Gen Race' },
  { id: '1549', key: 'novice_race', label: 'Novice Race', pointsClass: 'novicerace', pointsLabel: 'Novice Race' },
  { id: '2642', key: 'tournaments', label: 'Tournaments', pointsClass: 'tournaments', pointsLabel: 'Tournament Points' },
];

let cache = null; // { fetchedAt, tables }
let inFlight = null; // dedupe concurrent refreshes

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(str) {
  return decodeEntities(str.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function extractTableHtml(html, id) {
  const startRe = new RegExp(`<table class="[^"]*sp-league-table-${id}[^"]*"[^>]*>`);
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const start = startMatch.index;
  const end = html.indexOf('</table>', start);
  if (end === -1) return null;
  return html.slice(start, end + '</table>'.length);
}

function parseRows(tableHtml, pointsClass) {
  const rows = [];
  const rowRe = /<tr class="(?:odd|even)[^"]*">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    const rowHtml = m[1];
    const rankM = /<td class="data-rank"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    const nameM = /<td class="data-name[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    const matchesM = /<td class="data-zpasy"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    const pointsM = new RegExp(`<td class="data-${pointsClass}"[^>]*>([\\s\\S]*?)</td>`).exec(rowHtml);
    if (!rankM || !nameM || !matchesM || !pointsM) continue;

    const hrefM = /<a href="([^"]+)"/.exec(nameM[1]);
    const name = stripTags(nameM[1]);
    if (!name) continue;
    const rank = parseInt(stripTags(rankM[1]), 10) || rows.length + 1;
    const matches = parseInt(stripTags(matchesM[1]), 10) || 0;
    const pointsText = stripTags(pointsM[1]);
    const points = pointsText === '-' || pointsText === '' ? null : (parseInt(pointsText, 10) || 0);

    rows.push({ rank, name, matches, points, wpUrl: hrefM ? hrefM[1] : null });
  }
  return rows;
}

async function fetchAndParse() {
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'BLTA-Score-App/1.0' } });
  if (!res.ok) throw new Error(`blta.sk/rebricky/ responded ${res.status}`);
  const html = await res.text();

  const tables = TABLES.map((t) => {
    const tableHtml = extractTableHtml(html, t.id);
    const rows = tableHtml ? parseRows(tableHtml, t.pointsClass) : [];
    return { key: t.key, label: t.label, pointsLabel: t.pointsLabel, rows };
  });

  // If every table came back empty, the page markup likely changed —
  // better to keep serving the last good cache (see getRankings) than to
  // replace it with something that looks like "everyone has 0 points".
  const totalRows = tables.reduce((n, t) => n + t.rows.length, 0);
  if (totalRows === 0) throw new Error('Parsed 0 ranking rows — source page structure may have changed');

  return { fetchedAt: new Date().toISOString(), tables };
}

// Serves the in-memory cache when it's still fresh; otherwise refreshes it.
// A refresh that fails falls back to a stale cache rather than a broken
// page — the numbers just won't be quite as fresh, which beats an error.
async function getRankings() {
  const isFresh = cache && (Date.now() - new Date(cache.fetchedAt).getTime()) < CACHE_TTL_MS;
  if (isFresh) return cache;

  if (!inFlight) {
    inFlight = fetchAndParse()
      .then((fresh) => { cache = fresh; return cache; })
      .catch((err) => {
        console.error('[rankingsScraper] refresh failed:', err.message);
        if (cache) return cache; // serve stale rather than fail
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

module.exports = { getRankings, SOURCE_URL };
