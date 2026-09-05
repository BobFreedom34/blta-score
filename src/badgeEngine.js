// Server-side mirror of public/js/badges.js's computeBadgeMetrics/
// computeEarnedBadges — this project has no build step to share code
// between browser and server, so the two are deliberately kept logically
// identical (flat player1Id/player2Id fields here instead of the client's
// nested player1.id, since there's no need to carry a full player object
// server-side). Keep both in sync when a badge logic type is added.
//
// The client only ever needs "which badges does this player currently
// hold" (recomputed fresh from full match history every time a profile
// loads). The server additionally needs to know the moment a badge is
// *newly* earned — that's what makes the notification bell in common.js
// possible at all — so this module also owns the player_badges table
// (see src/db.js) that records each of those moments once, permanently.
const db = require('./db');

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function badgeSetWonZero(m, pid) {
  const sets = m.sets || [];
  const isP1 = m.player1Id === pid;
  return sets.some((s) => (isP1 && s.p1 === 6 && s.p2 === 0) || (!isP1 && s.p2 === 6 && s.p1 === 0));
}

function badgeWonAfterLosingFirstSet(m, pid) {
  const sets = m.sets || [];
  if (sets.length < 2 || !sets[0] || !sets[0].winner) return false;
  const playerSetNum = m.player1Id === pid ? 1 : 2;
  return sets[0].winner !== playerSetNum;
}

function badgeWonWithoutDroppingSet(m, pid) {
  const sets = m.sets || [];
  if (!sets.length) return false;
  const playerSetNum = m.player1Id === pid ? 1 : 2;
  return sets.every((s) => s.winner === playerSetNum);
}

function computeBadgeMetrics(playerId, finished) {
  const pid = Number(playerId);
  // A walkover means no tennis was actually played, and a match finished
  // "as is" from Unfinished never reached a real conclusion — neither
  // counts toward games played, wins, streaks, or any other badge metric,
  // same rule as the player-profile stats cards (and the client's own
  // computeBadgeMetrics).
  const counted = finished.filter((m) => m.endReason !== 'WALKOVER' && m.endReason !== 'UNFINISHED');
  const wins = counted.filter((m) => m.winnerId === pid);
  const chronological = counted
    .filter((m) => m.winnerId)
    .sort((a, b) => new Date(a.scheduledAt || a.startTime || a.createdAt) - new Date(b.scheduledAt || b.startTime || b.createdAt));
  let streak = 0;
  let maxStreak = 0;
  chronological.forEach((m) => {
    if (m.winnerId === pid) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  });
  const winCategories = new Set(wins.map((m) => m.category));
  return {
    GAMES_PLAYED: counted.length,
    WINS: wins.length,
    WIN_STREAK: maxStreak,
    CATEGORY_SWEEP: BLTA_CATEGORIES.every((c) => winCategories.has(c)) ? 1 : 0,
    BAGEL: wins.some((m) => badgeSetWonZero(m, pid)) ? 1 : 0,
    COMEBACK: wins.some((m) => badgeWonAfterLosingFirstSet(m, pid)) ? 1 : 0,
    STRAIGHT_SETS: wins.filter((m) => badgeWonWithoutDroppingSet(m, pid)).length,
  };
}

function computeEarnedBadgeIds(playerId, finished, badgeDefs) {
  const metrics = computeBadgeMetrics(playerId, finished);
  const earned = new Set();
  badgeDefs.forEach((def) => {
    const value = metrics[def.logic_type] || 0;
    const need = def.threshold != null ? def.threshold : 1;
    if (value >= need) earned.add(def.id);
  });
  return earned;
}

// Flat shape mirroring what the client's badges.js expects off a serialized
// match (see routes/matches.js's serialize()), built straight from the raw
// matches row instead — no need for the full player-stripping/formatting
// serialize() does, since none of that feeds into badge metrics.
function loadFinishedMatchesForBadges(playerId) {
  const rows = db.prepare(
    "SELECT * FROM matches WHERE status = 'FINISHED' AND (player1_id = ? OR player2_id = ?)"
  ).all(playerId, playerId);
  return rows.map((row) => {
    const state = JSON.parse(row.state);
    return {
      player1Id: row.player1_id,
      player2Id: row.player2_id,
      winnerId: row.winner_id,
      category: row.category,
      endReason: row.end_reason,
      scheduledAt: row.scheduled_at,
      startTime: row.start_time,
      createdAt: row.created_at,
      sets: state.sets || [],
    };
  });
}

// Computes which badges `playerId` currently qualifies for and inserts a
// player_badges row (seen=0, i.e. an unread notification) for any not
// already recorded. Idempotent — a badge already accounted for (earned
// previously, or backfilled as already-held) is left untouched. Call this
// after any write that can finish, re-finish, or score-correct a match
// (see routes/matches.js) for both players in it.
function syncPlayerBadges(playerId) {
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const badgeDefs = db.prepare('SELECT * FROM badge_definitions').all();
  if (!badgeDefs.length) return [];
  const finished = loadFinishedMatchesForBadges(pid);
  const earnedIds = computeEarnedBadgeIds(pid, finished, badgeDefs);
  const already = new Set(
    db.prepare('SELECT badge_id FROM player_badges WHERE player_id = ?').all(pid).map((r) => r.badge_id)
  );
  const newlyEarned = [...earnedIds].filter((id) => !already.has(id));
  if (!newlyEarned.length) return [];
  // node:sqlite's DatabaseSync has no .transaction() helper (that's a
  // better-sqlite3-ism) — a handful of inserts at most per call, so a
  // plain loop is fine without one.
  const insert = db.prepare('INSERT INTO player_badges (player_id, badge_id, seen) VALUES (?, ?, 0)');
  newlyEarned.forEach((id) => insert.run(pid, id));
  return badgeDefs.filter((b) => newlyEarned.includes(b.id));
}

// One-time bootstrap, called once from server.js at startup — marks every
// badge a player has *already* earned (from match history that predates
// this notification feature entirely) as seen, so shipping this doesn't
// suddenly flood the whole league with "congratulations" for badges
// they've quietly held for months. Guarded by the table being empty, same
// pattern as badge_definitions' own one-time seed above this in db.js —
// never runs again once a single row exists.
function backfillIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM player_badges').get().c;
  if (count > 0) return;
  const badgeDefs = db.prepare('SELECT * FROM badge_definitions').all();
  if (!badgeDefs.length) return;
  const players = db.prepare('SELECT id FROM players').all();
  const insert = db.prepare('INSERT INTO player_badges (player_id, badge_id, seen) VALUES (?, ?, 1)');
  players.forEach(({ id }) => {
    const finished = loadFinishedMatchesForBadges(id);
    const earnedIds = computeEarnedBadgeIds(id, finished, badgeDefs);
    earnedIds.forEach((badgeId) => insert.run(id, badgeId));
  });
}

module.exports = { syncPlayerBadges, backfillIfNeeded };
