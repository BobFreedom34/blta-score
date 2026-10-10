const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const rankingPoints = require('../rankingPoints');
const { getMoves, getHistory } = require('../rankingSnapshots');

const router = express.Router();

const { TABLE_KEYS, normalizeName: normalize } = rankingPoints;

// Same age math as the player profile page (player.js's computeAge) —
// duplicated here rather than shared since that one runs client-side and
// this needs to run server-side to land in the API response.
function computeAge(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const hadBirthdayThisYear = today.getMonth() > b.getMonth()
    || (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Everything /api/rankings returns (and the once-a-week snapshot / bell-notification roll it does on the way). The tables are
// the app's own (src/rankingPoints.js): a finished BLTA match adds its points, an admin can correct any number. The slim
// /ranks route below goes through the same function, so asking for the small answer still keeps the weekly roll running.
function buildRankings() {
  const data = rankingPoints.getTables();

  // Slug, nationality and age live on the player's bio here; a row that is not tied to a player (a name that matched nobody)
  // simply has none of them.
  const players = db.prepare('SELECT id, name, slug, nationality, birthday FROM players').all();
  const byId = new Map(players.map((p) => [p.id, p]));
  const byName = new Map(players.map((p) => [normalize(p.name), p]));
  const playerOf = (row) => (row.playerId && byId.get(row.playerId)) || byName.get(normalize(row.name)) || null;

  const tables = data.tables.map((t) => {
    // Week-over-week movement — see src/rankingSnapshots.js. Computed (and
    // the snapshot rolled forward, once a week) from this table's actual
    // rank order.
    const {
      moves, isNewWeek, weekMoves, currentWeek,
    } = getMoves(t.key, t.rows.map((r) => ({ name: normalize(r.name), rank: r.rank })));

    // Bell notification for "you moved in the ranking" — only the main
    // overall BLTA table, and only on the one call per week that's actually
    // rolling the snapshot forward (weekMoves/isNewWeek — see getMoves' own
    // doc comment), not on every mid-week page view. Silently skipped for a
    // row that doesn't resolve to a local player: no account, nowhere to put a
    // bell notification.
    if (t.key === 'blta' && isNewWeek) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO ranking_notifications
          (player_id, table_key, direction, amount, new_rank, snapshot_week)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      Object.entries(weekMoves).forEach(([normName, move]) => {
        const row = t.rows.find((r) => normalize(r.name) === normName);
        const player = row && playerOf(row);
        if (!player) return;
        insert.run(player.id, t.key, move.direction, move.amount, row.rank, currentWeek);
      });
    }

    return {
      key: t.key,
      label: t.label,
      pointsLabel: t.pointsLabel,
      rows: t.rows.map((r) => {
        const player = playerOf(r);
        return {
          rank: r.rank,
          name: r.name,
          matches: r.matches,
          points: r.points,
          slug: player ? player.slug : null,
          nationality: player ? player.nationality || null : null,
          age: player ? computeAge(player.birthday) : null,
          move: moves[normalize(r.name)] || null,
        };
      }),
    };
  });

  return { fetchedAt: data.updatedAt || new Date().toISOString(), tables };
}

router.get('/', (req, res) => {
  try {
    res.json(buildRankings());
  } catch (err) {
    console.error('[rankings] could not build the tables:', err);
    res.status(500).json({ error: `Could not load the rankings: ${err.message}` });
  }
});

// Just "name -> overall BLTA rank" (a few kB instead of ~80 kB): every page shows a #rank next to ranked players and only
// needs this. Cached by the browser for five minutes.
router.get('/ranks', (req, res) => {
  try {
    const data = buildRankings();
    const blta = data.tables.find((t) => t.key === 'blta');
    const ranks = {};
    if (blta) blta.rows.forEach((r) => { ranks[r.name] = r.rank; });
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ranks });
  } catch (err) {
    console.error('[rankings] could not build the ranks:', err);
    res.status(500).json({ error: `Could not load the rankings: ${err.message}` });
  }
});

// Weekly rank history for one player in one table — the data behind the
// rank-trend chart on a player's profile page. Public, like the rest of
// the rankings data; matched by name, same as the snapshot itself.
router.get('/history/:tableKey/:name', (req, res) => {
  const { tableKey } = req.params;
  if (!TABLE_KEYS.includes(tableKey)) {
    return res.status(400).json({ error: 'Unknown ranking table' });
  }
  const name = decodeURIComponent(req.params.name);
  const normName = normalize(name);
  const history = getHistory(tableKey, normName);

  // The last *stored* weekly snapshot can lag the actual live rank by up
  // to a week — rankingSnapshots.js only rolls forward once a week on
  // purpose, so the earlier points stay a stable weekly cadence instead of
  // thrashing on every visit (see its own comment). But showing that
  // stale number as "now" is actively misleading right next to this same
  // player's live rank shown elsewhere (e.g. the main rankings page) — so
  // the chart's very last point is always today's real live rank, appended
  // on top of (never replacing) the actual weekly history underneath it.
  try {
    const table = rankingPoints.getTables().tables.find((t) => t.key === tableKey);
    const liveRow = table && table.rows.find((r) => normalize(r.name) === normName);
    if (liveRow) {
      const today = new Date().toISOString().slice(0, 10);
      const last = history[history.length - 1];
      if (!last || last.snapshot_week !== today || last.rank !== liveRow.rank) {
        history.push({ rank: liveRow.rank, snapshot_week: today });
      }
    }
  } catch (err) {
    console.error('[rankings] could not read the live rank for the history chart:', err.message);
  }

  res.json({ history: history.map((h) => ({ week: h.snapshot_week, rank: h.rank })) });
});

// Admin-only check of the points record: for the finished BLTA matches of a month (?month=2026-09, default: the last full month; ?player=<id> to
// look at one player) it compares what the league rules say a match is worth with what the points record (ranking_awards, BLTA table) holds.
// `status`: OK = the record has exactly the rules' points for both players, MISSING = nothing recorded for the match, DIFFERENT = something else.
// `?problems=1` lists only the matches that are not OK. Read-only: nothing is changed.
router.get('/audit', requireAdmin, (req, res) => {
  const now = new Date();
  const monthArg = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : null;
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = monthArg || `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01T00:00:00.000Z`;
  const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00.000Z`;
  const playerId = Number(req.query.player) || null;
  const categories = Object.keys(rankingPoints.CATEGORY_RULES);
  const matches = db.prepare(`
    SELECT m.*, COALESCE(m.scheduled_at, m.start_time, m.created_at) AS d, p1.name AS name1, p2.name AS name2
    FROM matches m JOIN players p1 ON p1.id = m.player1_id JOIN players p2 ON p2.id = m.player2_id
    WHERE m.status = 'FINISHED' AND m.category IN (${categories.map(() => '?').join(',')})
      AND COALESCE(m.scheduled_at, m.start_time, m.created_at) >= ? AND COALESCE(m.scheduled_at, m.start_time, m.created_at) < ?
      ${playerId ? 'AND (m.player1_id = ? OR m.player2_id = ?)' : ''}
    ORDER BY d, m.id
  `).all(...categories, from, to, ...(playerId ? [playerId, playerId] : []));
  const ledger = db.prepare(`
    SELECT e.player_id AS playerId, e.name, a.points FROM ranking_awards a JOIN ranking_entries e ON e.id = a.entry_id
    WHERE a.match_id = ? AND e.table_key = 'blta'
  `);
  const names = new Map(db.prepare('SELECT id, name FROM players').all().map((p) => [p.id, p.name]));
  const rows = matches.map((match) => {
    const worth = rankingPoints.computeAwards(match);
    const expected = worth ? worth.awards.map((a) => ({ playerId: a.playerId, name: names.get(a.playerId), points: a.points })) : [];
    const recorded = ledger.all(match.id).map((r) => ({ playerId: r.playerId, name: r.name, points: r.points }));
    const sum = (list) => list.reduce((t, r) => t + r.points, 0);
    let status = 'OK';
    if (expected.length && !recorded.length) status = 'MISSING';
    else if (sum(expected) !== sum(recorded) || expected.some((e) => (recorded.find((r) => r.playerId === e.playerId) || { points: -1 }).points !== e.points)) status = 'DIFFERENT';
    return { matchId: match.id, token: match.share_token, date: match.d, category: match.category, players: `${match.name1} vs ${match.name2}`, expected, recorded, status, endTime: match.end_time };
  });
  const problems = rows.filter((r) => r.status !== 'OK');
  res.json({ month, matches: rows.length, problems: problems.length, rows: req.query.problems ? problems : rows });
});

// Admin-only: set one player's points in one table (the row is created when the player is not in that table yet — this is how
// bonus points and tournament points are entered). An empty value puts the player back to "no points yet".
router.put('/points/:tableKey/:name', requireAdmin, (req, res) => {
  const { tableKey } = req.params;
  const name = decodeURIComponent(req.params.name);

  let points = null;
  if (req.body.points !== null && req.body.points !== undefined && req.body.points !== '') {
    points = Number(req.body.points);
    if (!Number.isInteger(points)) {
      return res.status(400).json({ error: 'Points must be a whole number' });
    }
  }

  const result = rankingPoints.setPoints(tableKey, name, points);
  if (result.error) return res.status(400).json({ error: result.error });
  try { require('../changeLog').logManualPoints(result.change); } catch (err) { console.error('[change log]', err.message); }
  res.json({ ok: true, points });
});

module.exports = router;
