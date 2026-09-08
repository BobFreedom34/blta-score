// Tracks week-over-week rank movement for the rankings page — "moved up 2
// places" style arrows, computed by comparing today's rank against the
// most recent weekly snapshot — and keeps that same data as a running
// history for the rank-trend chart on a player's profile page.
//
// blta.sk itself only republishes its standings on Mondays, so rather than
// running on a cron, this rolls forward lazily: whenever /api/rankings is
// next requested after crossing into a new ISO week, that request's ranks
// are appended as a new week's row — no scheduler needed, and a quiet week
// with no visitors just means the next visit compares against however many
// weeks have actually passed.

const db = require('./db');

// Monday (UTC) of the week containing `date` — e.g. any day Mon-Sun in a
// given week maps to that week's Monday, so a snapshot is always "for" one
// specific week regardless of which day it happened to be taken on.
function mondayOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// rows: [{ name, rank }] — the CURRENT rank for every player in one table
// (already resolved, whatever the source). Returns { moves, isNewWeek,
// weekMoves, currentWeek }:
//   - moves: { [name]: { direction, amount } } for rows that moved since
//     whatever's most recently stored — this is the live, mid-week-
//     responsive one the rankings page's own arrows are drawn from.
//   - isNewWeek/weekMoves/currentWeek: only meaningful together, for a
//     caller that wants to fire something once per actual weekly move
//     rather than on every request (see notifyRankingMoves in
//     routes/rankings.js) — isNewWeek is true on the one call that's
//     rolling this table's snapshot forward into a new week, and
//     weekMoves is that specific comparison (this week's live ranks
//     against last week's stored snapshot, i.e. the real week-over-week
//     delta) rather than moves' own mid-week-vs-latest-stored one, which
//     on this same call would otherwise just equal the full weekly delta
//     anyway (nothing's been stored for the new week yet) but reads
//     confusingly reused for a different purpose. False/empty on every
//     other call this week, so a caller gating on it fires at most once
//     per player per week.
function getMoves(tableKey, rows) {
  const currentWeek = mondayOf();
  // Ordered newest-first so the first row seen per player is their latest
  // snapshot, and existing[0].snapshot_week is the most recent week we
  // have data for at all (every player in a rollover gets the same week).
  const existing = db.prepare('SELECT player_name, rank, snapshot_week FROM ranking_snapshots WHERE table_key = ? ORDER BY snapshot_week DESC').all(tableKey);
  const latestByName = {};
  existing.forEach((row) => {
    if (!latestByName[row.player_name]) latestByName[row.player_name] = row;
  });
  const storedWeek = existing.length ? existing[0].snapshot_week : null;
  const isNewWeek = !storedWeek || storedWeek < currentWeek;

  function diff(against) {
    const result = {};
    rows.forEach((r) => {
      const prev = against[r.name];
      if (!prev) return;
      const delta = prev.rank - r.rank; // positive = climbed (lower rank number is better)
      if (delta !== 0) result[r.name] = { direction: delta > 0 ? 'up' : 'down', amount: Math.abs(delta) };
    });
    return result;
  }

  // Compares against whatever the most recent stored snapshot is — this
  // week's own (captured at that week's first visit, so effectively "your
  // rank at the start of this week") or last week's if this week has no
  // snapshot yet — rather than requiring a week to have actually turned
  // over since the last visit. blta.sk's live numbers do change mid-week
  // (not just on its own Monday republish, despite the comment above), so
  // gating this on "a new week has started" meant a real mid-week move
  // never showed an arrow at all until the following Monday. The only
  // real "nothing to compare against yet" case is the very first run ever,
  // with no snapshot stored at all.
  const moves = storedWeek ? diff(latestByName) : {};
  // Same comparison as moves above happens to be, but computed
  // independently and named for its own purpose (see the doc comment) —
  // moves keeps meaning "vs. latest stored" even after latestByName is
  // about to become stale the moment this week's snapshot is inserted
  // below, and weekMoves keeps meaning "the actual weekly delta" even if
  // moves' own comparison target ever changes for the live-arrows use case.
  const weekMoves = isNewWeek && storedWeek ? diff(latestByName) : {};

  if (isNewWeek) {
    const insert = db.prepare('INSERT INTO ranking_snapshots (table_key, player_name, rank, snapshot_week) VALUES (?, ?, ?, ?)');
    rows.forEach((r) => insert.run(tableKey, r.name, r.rank, currentWeek));
  }

  return {
    moves, isNewWeek, weekMoves, currentWeek,
  };
}

// Full weekly rank history for one player in one table, oldest to newest —
// the data behind the rank-trend chart on a player's profile page. Capped
// to the most recent `limit` weeks (16 — about a season) so the chart
// (and the query) don't grow unbounded over years of history.
function getHistory(tableKey, normalizedName, limit = 16) {
  const rows = db.prepare(`
    SELECT rank, snapshot_week FROM ranking_snapshots
    WHERE table_key = ? AND player_name = ?
    ORDER BY snapshot_week ASC
  `).all(tableKey, normalizedName);
  return rows.slice(-limit);
}

module.exports = { getMoves, getHistory };
