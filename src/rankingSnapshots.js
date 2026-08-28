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
// (already resolved, whatever the source). Returns { [name]: { direction,
// amount } } for rows that moved since the last weekly snapshot; appends
// this week's ranks as a new snapshot row if a new week has started since
// the last one was taken (never overwriting an older week's row).
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

  const moves = {};
  // Only show arrows once there's a snapshot from a week strictly before
  // this one — a same-week revisit or the very first run ever (nothing
  // stored yet) has no real "since last week" to compare against.
  if (storedWeek && storedWeek < currentWeek) {
    rows.forEach((r) => {
      const prev = latestByName[r.name];
      if (!prev) return;
      const delta = prev.rank - r.rank; // positive = climbed (lower rank number is better)
      if (delta !== 0) moves[r.name] = { direction: delta > 0 ? 'up' : 'down', amount: Math.abs(delta) };
    });
  }

  if (!storedWeek || storedWeek < currentWeek) {
    const insert = db.prepare('INSERT INTO ranking_snapshots (table_key, player_name, rank, snapshot_week) VALUES (?, ?, ?, ?)');
    rows.forEach((r) => insert.run(tableKey, r.name, r.rank, currentWeek));
  }

  return moves;
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
