function badgeSetWonZero(m, pid) {
  const sets = (m.state && m.state.sets) || [];
  const isP1 = m.player1.id === pid;
  return sets.some((s) => (isP1 && s.p1 === 6 && s.p2 === 0) || (!isP1 && s.p2 === 6 && s.p1 === 0));
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

// One numeric (or 0/1) value per logic type a badge definition can key off
// — a badge is earned once its metric reaches its threshold (or, for the
// threshold-less pass/fail types, once the metric is truthy).
function computeBadgeMetrics(playerId, finished) {
  const pid = Number(playerId);
  // A walkover means no tennis was actually played, so it doesn't count
  // toward games played, wins, streaks, or any other badge metric — same
  // rule as the player-profile stats cards.
  const counted = finished.filter((m) => m.endReason !== 'WALKOVER');
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

// badgeDefs come from GET /api/badges — admin-managed, not hardcoded, so
// this is always computed from a player's whole career, not filtered.
function computeEarnedBadges(playerId, finished, badgeDefs) {
  const metrics = computeBadgeMetrics(playerId, finished);
  const earned = new Set();
  badgeDefs.forEach((def) => {
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

function badgeItemHtml(b, earned, detailed) {
  const classes = earned ? '' : ' locked';
  return `
    <div class="badge-item" data-badge-id="${b.id}" data-earned="${earned ? '1' : '0'}">
      <div class="badge-medal${classes}" title="${escapeHtml(b.description)}">${badgeIconInner(b.icon)}</div>
      <div class="badge-name${classes}">${escapeHtml(b.name)}</div>
      ${detailed ? `<div class="badge-condition">${escapeHtml(b.description)}</div>` : ''}
    </div>
  `;
}

// Compact grid for the profile page — icon + name only, description as a
// hover tooltip.
function badgesGridHtml(badgeDefs, earnedSet) {
  return badgeDefs.map((b) => badgeItemHtml(b, earnedSet.has(b.id), false)).join('');
}

// Full grid for the "show all badges" modal — same badges, but with the
// unlock condition written out under each one instead of hidden in a
// tooltip, so a player can see every badge that exists and what it takes.
function badgesModalGridHtml(badgeDefs, earnedSet) {
  return badgeDefs.map((b) => badgeItemHtml(b, earnedSet.has(b.id), true)).join('');
}
