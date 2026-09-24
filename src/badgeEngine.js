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

// The league runs in Slovakia — a match played just after midnight local
// time is stored as the previous day in UTC, so a CALENDAR_DATE badge
// ("played on Jan 1") has to compare the wall-clock date the players
// actually saw, not the raw UTC date. Returns the month/day as one integer
// MMDD (Jan 1 -> 101, Dec 25 -> 1225) to match how the badge stores its
// target date in `threshold`. Kept identical to badges.js's own copy.
const LEAGUE_TZ = 'Europe/Bratislava';
function localMonthDay(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: LEAGUE_TZ, month: '2-digit', day: '2-digit' }).formatToParts(d);
  const mm = Number(parts.find((p) => p.type === 'month').value);
  const dd = Number(parts.find((p) => p.type === 'day').value);
  if (!mm || !dd) return null;
  return mm * 100 + dd;
}

// The calendar year a match's date falls on, same league-timezone
// reasoning as localMonthDay — which year a CALENDAR_DATE badge was
// earned in is what makes it earnable again the following year (see
// computeEarnedBadgeInstances below).
function localYear(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: LEAGUE_TZ, year: 'numeric' }).format(d));
  return year || null;
}

// Every set THIS match had that pid won 6-0 (0, 1, or 2 for a double-
// bagel best-of-3) — a count, not a yes/no, so BAGEL below can support a
// real threshold ("win N 6-0 sets", not just "have you ever won one").
function countBagelSets(m, pid) {
  const sets = m.sets || [];
  const isP1 = m.player1Id === pid;
  return sets.filter((s) => (isP1 && s.p1 === 6 && s.p2 === 0) || (!isP1 && s.p2 === 6 && s.p1 === 0)).length;
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
    BAGEL: wins.reduce((sum, m) => sum + countBagelSets(m, pid), 0),
    // A count of matches (not sets — there's only ever one "1st set" per
    // match), same reasoning as BAGEL above needing one: a threshold can
    // now distinguish "came back once" from "makes a habit of it".
    COMEBACK: wins.filter((m) => badgeWonAfterLosingFirstSet(m, pid)).length,
    STRAIGHT_SETS: wins.filter((m) => badgeWonWithoutDroppingSet(m, pid)).length,
    // Every calendar day (as MMDD) this player has actually played on,
    // mapped to *which years* — win or lose, it just has to be a real,
    // counted match. A CALENDAR_DATE badge is earned once for every year
    // its own target day shows up in here (see computeEarnedBadgeInstances
    // below), not just once ever like every other badge type.
    PLAY_DATE_YEARS: counted.reduce((map, m) => {
      const dateStr = m.scheduledAt || m.startTime || m.createdAt;
      const mmdd = localMonthDay(dateStr);
      const year = localYear(dateStr);
      if (mmdd == null || year == null) return map;
      if (!map.has(mmdd)) map.set(mmdd, new Set());
      map.get(mmdd).add(year);
      return map;
    }, new Map()),
  };
}

// One entry per badge *instance* a player has earned — {badgeId, year}.
// year is null for every logic type except CALENDAR_DATE, which gets one
// entry per year its target day was actually played on (see
// PLAY_DATE_YEARS above) instead of the single pass/fail every other type
// gets.
function computeEarnedBadgeInstances(playerId, finished, badgeDefs) {
  const metrics = computeBadgeMetrics(playerId, finished);
  const instances = [];
  badgeDefs.forEach((def) => {
    if (def.logic_type === 'CALENDAR_DATE') {
      if (def.threshold == null) return;
      const years = metrics.PLAY_DATE_YEARS.get(def.threshold);
      if (years) years.forEach((year) => instances.push({ badgeId: def.id, year }));
      return;
    }
    const value = metrics[def.logic_type] || 0;
    const need = def.threshold != null ? def.threshold : 1;
    if (value >= need) instances.push({ badgeId: def.id, year: null });
  });
  return instances;
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
// Same "already recorded?" key for both a DB row and a freshly-computed
// instance — a plain badge_id for a NULL year, "badgeId:year" for a
// CALENDAR_DATE one, so a repeat earn in a new year doesn't collide with
// (or get blocked by) the row from a previous year.
function instanceKey(badgeId, year) {
  return year == null ? String(badgeId) : `${badgeId}:${year}`;
}

function syncPlayerBadges(playerId) {
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const badgeDefs = db.prepare('SELECT * FROM badge_definitions').all();
  if (!badgeDefs.length) return [];
  const finished = loadFinishedMatchesForBadges(pid);
  const instances = computeEarnedBadgeInstances(pid, finished, badgeDefs);
  const already = new Set(
    db.prepare('SELECT badge_id, earned_year FROM player_badges WHERE player_id = ?').all(pid)
      .map((r) => instanceKey(r.badge_id, r.earned_year))
  );
  const newlyEarned = instances.filter((inst) => !already.has(instanceKey(inst.badgeId, inst.year)));
  if (!newlyEarned.length) return [];
  // node:sqlite's DatabaseSync has no .transaction() helper (that's a
  // better-sqlite3-ism) — a handful of inserts at most per call, so a
  // plain loop is fine without one.
  const insert = db.prepare('INSERT INTO player_badges (player_id, badge_id, earned_year, seen) VALUES (?, ?, ?, 0)');
  newlyEarned.forEach((inst) => insert.run(pid, inst.badgeId, inst.year));
  return newlyEarned.map((inst) => badgeDefs.find((b) => b.id === inst.badgeId));
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
  const insert = db.prepare('INSERT INTO player_badges (player_id, badge_id, earned_year, seen) VALUES (?, ?, ?, 1)');
  players.forEach(({ id }) => {
    const finished = loadFinishedMatchesForBadges(id);
    const instances = computeEarnedBadgeInstances(id, finished, badgeDefs);
    instances.forEach((inst) => insert.run(id, inst.badgeId, inst.year));
  });
}

// The month/day (as MMDD, same encoding badge_definitions.threshold uses
// for a CALENDAR_DATE badge) and calendar year `daysAhead` days from now,
// in the league's own timezone — see localMonthDay above for why that
// matters (a match just after local midnight shouldn't read as the wrong
// day; same reasoning applies to "which day is 3 days from today"). year
// is what lets sendCalendarDateReminders scope "already reminded" per
// year (see badge_reminder_notifications' own unique index in db.js) — a
// bare MMDD repeats every year, so the reminder has to too.
function mmddInDays(daysAhead) {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_TZ, month: '2-digit', day: '2-digit', year: 'numeric',
  }).formatToParts(target);
  const mm = Number(parts.find((p) => p.type === 'month').value);
  const dd = Number(parts.find((p) => p.type === 'day').value);
  const year = Number(parts.find((p) => p.type === 'year').value);
  return { mmdd: mm * 100 + dd, year };
}

// Checked once a day (see startScheduledReminders below): for every
// CALENDAR_DATE badge whose target day falls exactly 3 days from today,
// give every player who doesn't already hold it *for that target year* a
// bell notification ("a special day is coming up, play on it and it's
// yours" — see openBadgeReminderModal in common.js for the actual
// wording). CALENDAR_DATE badges are earnable again every year (see
// computeEarnedBadgeInstances), so unlike every other badge type this
// exclusion is scoped to earned_year, not "ever earned" — otherwise a
// player who earned it once would stop getting reminded in later years
// they haven't replayed it in. In practice this WHERE clause never
// excludes anyone (the target day is always still 3 days in the future,
// so nobody could have a finished match on it yet this year) — it's kept
// year-scoped anyway so the logic stays correct if that ever changes.
// INSERT OR IGNORE relies on badge_reminder_notifications' own unique
// index (player_id, badge_id, target_year) to silently no-op anyone
// already reminded this year, including anyone this runs twice for on the
// same day for any reason (a restart, a clock change) — never a duplicate
// notification either way.
function sendCalendarDateReminders() {
  const { mmdd, year } = mmddInDays(3);
  const badgeDefs = db.prepare("SELECT * FROM badge_definitions WHERE logic_type = 'CALENDAR_DATE' AND threshold = ?").all(mmdd);
  if (!badgeDefs.length) return;
  const players = db.prepare('SELECT id FROM players').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO badge_reminder_notifications (player_id, badge_id, target_year)
    VALUES (?, ?, ?)
  `);
  badgeDefs.forEach((badge) => {
    const alreadyEarnedThisYear = new Set(
      db.prepare('SELECT player_id FROM player_badges WHERE badge_id = ? AND earned_year = ?').all(badge.id, year).map((r) => r.player_id)
    );
    players.forEach(({ id }) => {
      if (alreadyEarnedThisYear.has(id)) return;
      insert.run(id, badge.id, year);
    });
  });
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// A few minutes after boot (not instantly — let the rest of startup settle
// first), then every 24h for as long as the process stays up — same
// pattern as src/backup.js's own daily schedule.
function startScheduledReminders() {
  setTimeout(() => { sendCalendarDateReminders(); }, 2 * 60 * 1000);
  setInterval(() => { sendCalendarDateReminders(); }, ONE_DAY_MS);
}

module.exports = {
  syncPlayerBadges, backfillIfNeeded, sendCalendarDateReminders, startScheduledReminders,
};
