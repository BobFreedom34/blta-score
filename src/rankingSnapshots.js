// Tracks week-over-week rank movement for the rankings page — "moved up 2
// places" style arrows, computed by comparing today's rank against a
// snapshot taken as of the most recent Monday.
//
// blta.sk itself only republishes its standings on Mondays, so rather than
// running on a cron, this rolls the snapshot forward lazily: whenever
// /api/rankings is next requested after crossing into a new ISO week, that
// request's ranks become the new baseline for comparison going forward —
// no scheduler needed, and a quiet week with no visitors just means the
// next visit compares against however many weeks have actually passed.

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
// amount } } for rows that moved since the last weekly snapshot; rolls the
// snapshot forward to today's ranks if a new week has started since the
// last one was taken.
function getMoves(tableKey, rows) {
  const currentWeek = mondayOf();
  const existing = db.prepare('SELECT player_name, rank, snapshot_week FROM ranking_snapshots WHERE table_key = ?').all(tableKey);
  const byName = {};
  existing.forEach((row) => { byName[row.player_name] = row; });
  const storedWeek = existing.length ? existing[0].snapshot_week : null;

  const moves = {};
  // Only show arrows once there's a snapshot from a week strictly before
  // this one — a same-week revisit or the very first run ever (nothing
  // stored yet) has no real "since last week" to compare against.
  if (storedWeek && storedWeek < currentWeek) {
    rows.forEach((r) => {
      const prev = byName[r.name];
      if (!prev) return;
      const delta = prev.rank - r.rank; // positive = climbed (lower rank number is better)
      if (delta !== 0) moves[r.name] = { direction: delta > 0 ? 'up' : 'down', amount: Math.abs(delta) };
    });
  }

  if (!storedWeek || storedWeek < currentWeek) {
    rows.forEach((r) => {
      const prev = byName[r.name];
      if (prev) {
        db.prepare('UPDATE ranking_snapshots SET rank = ?, snapshot_week = ? WHERE table_key = ? AND player_name = ?')
          .run(r.rank, currentWeek, tableKey, r.name);
      } else {
        db.prepare('INSERT INTO ranking_snapshots (table_key, player_name, rank, snapshot_week) VALUES (?, ?, ?, ?)')
          .run(tableKey, r.name, r.rank, currentWeek);
      }
    });
  }

  return moves;
}

module.exports = { getMoves };
