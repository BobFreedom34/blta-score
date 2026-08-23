const BADGES = [
  { key: 'FIRST_SERVE', name: 'First serve', description: 'Play your 1st match', icon: '🎾' },
  { key: 'WARMUP_COMPLETE', name: 'Warm-up complete', description: 'Play 10 matches', icon: '🔟' },
  { key: 'MARATHON_PLAYER', name: 'Marathon player', description: 'Play 25 matches', icon: '🏃' },
  { key: 'CENTURY_CLUB', name: 'Century club', description: 'Play 100 matches', icon: '🏆' },
  { key: 'FIRST_WIN', name: 'First win', description: 'Win your 1st match', icon: '⭐' },
  { key: 'HOT_STREAK', name: 'Hot streak', description: 'Win 5 matches in a row', icon: '🔥' },
  { key: 'BAGEL_BAKER', name: 'Bagel baker', description: 'Win a set 6–0', icon: '🥯' },
  { key: 'COMEBACK_KID', name: 'Comeback kid', description: 'Win after losing the 1st set', icon: '🔄' },
  { key: 'STRAIGHT_SETS', name: 'Straight-sets specialist', description: '10 wins without dropping a set', icon: '⚡' },
  { key: 'ALL_ROUNDER', name: 'All-rounder', description: 'Win a match in Elite, Next Gen and Novice', icon: '👑' },
];

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

// Every badge is a pure function of a player's full finished-match history —
// computed on the fly rather than stored, so historical matches count too
// and there's nothing to backfill.
function computeEarnedBadges(playerId, finished) {
  const pid = Number(playerId);
  const wins = finished.filter((m) => m.winnerId === pid);
  const earned = new Set();

  if (finished.length >= 1) earned.add('FIRST_SERVE');
  if (finished.length >= 10) earned.add('WARMUP_COMPLETE');
  if (finished.length >= 25) earned.add('MARATHON_PLAYER');
  if (finished.length >= 100) earned.add('CENTURY_CLUB');
  if (wins.length >= 1) earned.add('FIRST_WIN');

  if (wins.some((m) => badgeSetWonZero(m, pid))) earned.add('BAGEL_BAKER');
  if (wins.some((m) => badgeWonAfterLosingFirstSet(m, pid))) earned.add('COMEBACK_KID');
  if (wins.filter((m) => badgeWonWithoutDroppingSet(m, pid)).length >= 10) earned.add('STRAIGHT_SETS');

  const chronological = finished
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
  if (maxStreak >= 5) earned.add('HOT_STREAK');

  const winCategories = new Set(wins.map((m) => m.category));
  if (BLTA_CATEGORIES.every((c) => winCategories.has(c))) earned.add('ALL_ROUNDER');

  return earned;
}

function badgesGridHtml(earnedSet) {
  return BADGES.map((b) => {
    const earned = earnedSet.has(b.key);
    return `
      <div class="badge-item">
        <div class="badge-medal${earned ? '' : ' locked'}" title="${escapeHtml(b.description)}">${b.icon}</div>
        <div class="badge-name${earned ? '' : ' locked'}">${escapeHtml(b.name)}</div>
      </div>
    `;
  }).join('');
}
