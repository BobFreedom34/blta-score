// Every set THIS match had that pid won 6-0 (0, 1, or 2 for a double-
// bagel best-of-3) — a count, not a yes/no, so BAGEL below can support a
// real threshold ("win N 6-0 sets", not just "have you ever won one").
function countBagelSets(m, pid) {
  const sets = (m.state && m.state.sets) || [];
  const isP1 = m.player1.id === pid;
  return sets.filter((s) => (isP1 && s.p1 === 6 && s.p2 === 0) || (!isP1 && s.p2 === 6 && s.p1 === 0)).length;
}

function badgeWonAfterLosingFirstSet(m, pid) {
  const sets = (m.state && m.state.sets) || [];
  if (sets.length < 2 || !sets[0] || !sets[0].winner) return false;
  const playerSetNum = m.player1.id === pid ? 1 : 2;
  return sets[0].winner !== playerSetNum;
}

function badgeWonWithoutDroppingSet(m, pid) {
  const sets = (m.state && m.state.sets) || [];
  if (!sets.length) return false;
  const playerSetNum = m.player1.id === pid ? 1 : 2;
  return sets.every((s) => s.winner === playerSetNum);
}

// The league runs in Slovakia — a match played just after midnight local
// time is stored as the previous day in UTC, so a CALENDAR_DATE badge
// ("played on Jan 1") has to compare the wall-clock date the players
// actually saw. Returns the month/day as one integer MMDD (Jan 1 -> 101,
// Dec 25 -> 1225), matching how the badge stores its target in `threshold`.
// Kept identical to badgeEngine.js's own copy.
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

// One numeric (or 0/1) value per logic type a badge definition can key off
// — a badge is earned once its metric reaches its threshold (or, for the
// threshold-less pass/fail types, once the metric is truthy).
function computeBadgeMetrics(playerId, finished) {
  const pid = Number(playerId);
  // A walkover means no tennis was actually played, and a match finished
  // "as is" from Unfinished never reached a real conclusion — neither
  // counts toward games played, wins, streaks, or any other badge metric,
  // same rule as the player-profile stats cards.
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
    // Display-only — how many of the 3 *BLTA* categories specifically have
    // been won so far, for the progress bar (see badgeProgressFor). Only
    // counting BLTA_CATEGORIES, not winCategories.size, matters here: a win
    // in FRIENDLY/VIP_CUP/ATA_TENNIS adds a distinct category to
    // winCategories but does nothing toward "win in Elite, Next Gen and
    // Novice" — counting it would show progress (even a false "3/3") for
    // categories that can never actually satisfy the real earning check
    // just above, which correctly only ever tests BLTA_CATEGORIES.
    CATEGORY_SWEEP_COUNT: BLTA_CATEGORIES.filter((c) => winCategories.has(c)).length,
    BAGEL: wins.reduce((sum, m) => sum + countBagelSets(m, pid), 0),
    // A count of matches (not sets — there's only ever one "1st set" per
    // match), same reasoning as BAGEL above needing one: a threshold can
    // now distinguish "came back once" from "makes a habit of it".
    COMEBACK: wins.filter((m) => badgeWonAfterLosingFirstSet(m, pid)).length,
    STRAIGHT_SETS: wins.filter((m) => badgeWonWithoutDroppingSet(m, pid)).length,
    // Every calendar day (as MMDD) this player has actually played on —
    // win or lose, it just has to be a real, counted match.
    PLAY_DATES: new Set(counted.map((m) => localMonthDay(m.scheduledAt || m.startTime || m.createdAt)).filter((d) => d != null)),
  };
}

// badgeDefs come from GET /api/badges — admin-managed, not hardcoded, so
// this is always computed from a player's whole career, not filtered.
function computeEarnedBadges(playerId, finished, badgeDefs) {
  const metrics = computeBadgeMetrics(playerId, finished);
  const earned = new Set();
  badgeDefs.forEach((def) => {
    // Calendar-date badges are an exact match on the target day, not a
    // "reached a threshold" comparison like every other type.
    if (def.logicType === 'CALENDAR_DATE') {
      if (def.threshold != null && metrics.PLAY_DATES.has(def.threshold)) earned.add(def.id);
      return;
    }
    const value = metrics[def.logicType] || 0;
    const need = def.threshold != null ? def.threshold : 1;
    if (value >= need) earned.add(def.id);
  });
  return earned;
}

// An uploaded icon's value is the path it was saved under (/badge-icons/...);
// anything else is treated as literal emoji/text.
function badgeIconInner(icon) {
  return icon.startsWith('/badge-icons/') ? `<img src="${escapeHtml(icon)}" alt="">` : icon;
}

// {value, need} for the progress bar under a badge in the detailed views
// (the "show all badges" modal and the zoomed single-badge view) — null
// for CALENDAR_DATE, which isn't a "how far along" metric (you either
// played on that calendar day or you didn't, there's no partial credit).
// CATEGORY_SWEEP uses the richer CATEGORY_SWEEP_COUNT (0-3 categories won)
// instead of its own plain 0/1 earning field, so its bar can show real
// progress toward "win in all three divisions" instead of jumping straight
// from empty to full. value is clamped to need so an already-earned badge
// reads as a clean, full bar (e.g. "10/10") rather than overshooting past
// its own threshold once someone keeps playing.
function badgeProgressFor(def, metrics) {
  if (def.logicType === 'CALENDAR_DATE') return null;
  if (def.logicType === 'CATEGORY_SWEEP') {
    const need = BLTA_CATEGORIES.length;
    return { value: Math.min(metrics.CATEGORY_SWEEP_COUNT || 0, need), need };
  }
  const need = def.threshold != null ? def.threshold : 1;
  const value = Math.min(metrics[def.logicType] || 0, need);
  return { value, need };
}

function badgeProgressHtml(progress) {
  if (!progress) return '';
  const pct = progress.need > 0 ? Math.round((progress.value / progress.need) * 100) : 100;
  return `
    <div class="badge-progress">
      <div class="badge-progress-bar"><div class="badge-progress-fill" style="width:${pct}%"></div></div>
      <div class="badge-progress-label">${progress.value}/${progress.need}</div>
    </div>
  `;
}

// metrics is only ever passed (and only ever rendered) alongside
// detailed:true — the compact profile grid stays icon+name only, same as
// before.
function badgeItemHtml(b, earned, detailed, metrics) {
  const classes = earned ? '' : ' locked';
  return `
    <div class="badge-item" data-badge-id="${b.id}" data-earned="${earned ? '1' : '0'}">
      <div class="badge-medal${classes}" title="${escapeHtml(b.description)}">${badgeIconInner(b.icon)}</div>
      <div class="badge-name${classes}">${escapeHtml(b.name)}</div>
      ${detailed ? `<div class="badge-condition">${escapeHtml(b.description)}</div>` : ''}
      ${detailed && metrics ? badgeProgressHtml(badgeProgressFor(b, metrics)) : ''}
    </div>
  `;
}

// Compact grid for the profile page — icon + name only, description as a
// hover tooltip.
function badgesGridHtml(badgeDefs, earnedSet) {
  return badgeDefs.map((b) => badgeItemHtml(b, earnedSet.has(b.id), false)).join('');
}

// Same order as LOGIC_TYPES in src/routes/badges.js — fixed rather than
// derived from whatever badges happen to exist, so the section order in
// the modal stays stable even as badges are added/removed/reordered
// within a type.
const BADGE_GROUP_ORDER = ['GAMES_PLAYED', 'WINS', 'WIN_STREAK', 'CATEGORY_SWEEP', 'BAGEL', 'COMEBACK', 'STRAIGHT_SETS', 'CALENDAR_DATE'];

// Full grid for the "show all badges" modal — same badges, but with the
// unlock condition written out under each one instead of hidden in a
// tooltip, so a player can see every badge that exists and what it takes.
// Grouped by that unlock condition (logic type), each under its own
// heading, so badges that work the same way sit together instead of one
// undifferentiated grid — a type with no badges yet just contributes no
// section, rather than an empty heading.
function badgesModalGridHtml(badgeDefs, earnedSet, metrics) {
  const parts = [];
  BADGE_GROUP_ORDER.forEach((logicType) => {
    const group = badgeDefs.filter((b) => b.logicType === logicType);
    if (!group.length) return;
    parts.push(`<div class="badge-group-heading">${escapeHtml(t(`badge.group.${logicType}`))}</div>`);
    parts.push(...group.map((b) => badgeItemHtml(b, earnedSet.has(b.id), true, metrics)));
  });
  return parts.join('');
}
