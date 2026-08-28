// Pulls the BLTA point-standings tables from the WordPress site and
// parses them into plain JSON.
//
// These rankings (BLTA points, per-category "Race" points, tournament
// points) are hand-maintained on WordPress via the SportsPress plugin —
// they aren't something this app computes from its own match data (a
// match win here doesn't map to a fixed point value; tournament results
// aren't tracked here at all). So "staying in sync" means re-reading the
// published page(s) rather than recomputing anything locally.
//
// Two source pages are involved:
//   - blta.sk/table/blta-general/ — one combined table with all of BLTA,
//     Elite Race, Next Gen Race and Novice Race as columns on the same
//     rows. That single "Poz" column is the page's own BLTA-overall rank;
//     the other three categories don't get their own rank column here, so
//     this module derives one per category by sorting on that category's
//     points (ties collapse to a shared rank, same convention the site
//     itself uses — see buildRaceTable).
//   - blta.sk/rebricky/ — still used for Tournaments only, exactly as
//     before, via its own tab table.
//
// Both render as plain server-side HTML tables (no client-side fetch/AJAX
// involved), each with a stable-ish numeric id (sp-league-table-<ID>) and
// consistent column classes (data-rank, data-name, data-zpasy, data-<key>).
// Rather than hardcode those numeric ids (WordPress can regenerate them),
// each table is located by the set of point-column classes its header
// contains — stable enough to parse with a few targeted regexes rather
// than pulling in a full HTML-parsing dependency for two pages.

const GENERAL_URL = 'https://www.blta.sk/table/blta-general/';
const REBRICKY_URL = 'https://www.blta.sk/rebricky/';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — good enough to feel "live" without hammering blta.sk on every page view.

const RACE_TABLES = [
  { key: 'blta', label: 'BLTA', pointsLabel: 'BLTA Points', pointsClass: 'bltabody' },
  { key: 'elite_race', label: 'Elite Race', pointsLabel: 'Elite Race', pointsClass: 'eliterace' },
  { key: 'next_gen_race', label: 'Next Gen Race', pointsLabel: 'Next Gen Race', pointsClass: 'nextgenrace' },
  { key: 'novice_race', label: 'Novice Race', pointsLabel: 'Novice Race', pointsClass: 'novicerace' },
];
const TOURNAMENTS_TABLE = { key: 'tournaments', label: 'Tournaments', pointsLabel: 'Tournament Points', pointsClass: 'tournaments' };

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

// Finds the first `<table class="... sp-league-table-<id> ...">...</table>`
// block whose header row contains every one of the given `data-<class>`
// column markers — e.g. ['bltabody','eliterace','nextgenrace','novicerace']
// picks out the one combined table on the general-standings page,
// regardless of what numeric id WordPress happens to have assigned it.
function findTableWithColumns(html, requiredPointsClasses) {
  const tableRe = /<table class="[^"]*sp-league-table-\d+[^"]*"[^>]*>[\s\S]*?<\/table>/g;
  let m;
  while ((m = tableRe.exec(html))) {
    const tableHtml = m[0];
    const theadMatch = /<thead>[\s\S]*?<\/thead>/.exec(tableHtml);
    if (!theadMatch) continue;
    if (requiredPointsClasses.every((c) => theadMatch[0].includes(`data-${c}`))) return tableHtml;
  }
  return null;
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

// Same row shape as parseRows, but reads all 4 race point-columns out of
// one row in a single pass, for the combined blta-general table.
function parseCombinedRows(tableHtml) {
  const rows = [];
  const rowRe = /<tr class="(?:odd|even)[^"]*">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    const rowHtml = m[1];
    const rankM = /<td class="data-rank"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    const nameM = /<td class="data-name[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    const matchesM = /<td class="data-zpasy"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
    if (!rankM || !nameM || !matchesM) continue;

    const hrefM = /<a href="([^"]+)"/.exec(nameM[1]);
    const name = stripTags(nameM[1]);
    if (!name) continue;
    const bltaRank = parseInt(stripTags(rankM[1]), 10) || rows.length + 1;
    const matches = parseInt(stripTags(matchesM[1]), 10) || 0;

    const points = {};
    RACE_TABLES.forEach((t) => {
      const cellM = new RegExp(`<td class="data-${t.pointsClass}"[^>]*>([\\s\\S]*?)</td>`).exec(rowHtml);
      const text = cellM ? stripTags(cellM[1]) : '-';
      points[t.key] = (text === '-' || text === '') ? null : (parseInt(text, 10) || 0);
    });

    rows.push({ name, matches, wpUrl: hrefM ? hrefM[1] : null, bltaRank, points });
  }
  return rows;
}

// Builds one race-category table from the combined rows. "blta" uses the
// page's own rank/order as-is (it's already the BLTA-overall ranking).
// The other three categories don't have their own rank column on this
// page, so this sorts by that category's points (nulls sink to the
// bottom) and assigns a rank that collapses on ties — same "shared rank
// on equal points" convention the site itself uses elsewhere. A stable
// sort keeps ties in the original (BLTA-rank) order rather than shuffling
// them, which is as good a secondary tiebreak as any we have visibility
// into.
function buildRaceTable(flatRows, key) {
  if (key === 'blta') {
    return flatRows.map((r) => ({ rank: r.bltaRank, name: r.name, matches: r.matches, points: r.points.blta, wpUrl: r.wpUrl }));
  }
  const sorted = flatRows.slice().sort((a, b) => {
    const av = a.points[key] === null ? -1 : a.points[key];
    const bv = b.points[key] === null ? -1 : b.points[key];
    return bv - av;
  });
  let rank = 0;
  let lastVal;
  return sorted.map((r, i) => {
    const v = r.points[key];
    if (v !== lastVal) { rank = i + 1; lastVal = v; }
    return { rank, name: r.name, matches: r.matches, points: v, wpUrl: r.wpUrl };
  });
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'BLTA-Score-App/1.0' } });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

async function fetchAndParse() {
  const [generalHtml, rebrickyHtml] = await Promise.all([fetchHtml(GENERAL_URL), fetchHtml(REBRICKY_URL)]);

  const combinedTableHtml = findTableWithColumns(generalHtml, RACE_TABLES.map((t) => t.pointsClass));
  const flatRows = combinedTableHtml ? parseCombinedRows(combinedTableHtml) : [];
  const raceTables = RACE_TABLES.map((t) => ({
    key: t.key,
    label: t.label,
    pointsLabel: t.pointsLabel,
    rows: buildRaceTable(flatRows, t.key),
  }));

  const tournamentsTableHtml = findTableWithColumns(rebrickyHtml, [TOURNAMENTS_TABLE.pointsClass]);
  const tournamentsRows = tournamentsTableHtml ? parseRows(tournamentsTableHtml, TOURNAMENTS_TABLE.pointsClass) : [];

  const tables = [...raceTables, {
    key: TOURNAMENTS_TABLE.key,
    label: TOURNAMENTS_TABLE.label,
    pointsLabel: TOURNAMENTS_TABLE.pointsLabel,
    rows: tournamentsRows,
  }];

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

module.exports = { getRankings, SOURCE_URL: GENERAL_URL };
