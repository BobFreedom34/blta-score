// Tennis scoring engine. Pure functions operating on a plain-JSON match "state" object,
// so the same object can be stored in SQLite (JSON text) and sent straight to clients.

const FORMATS = {
  BO1: { key: 'BO1', label: 'Best of 1 set', setsToWin: 1, finalSetSuperTiebreak: false },
  BO3: { key: 'BO3', label: 'Best of 3 sets', setsToWin: 2, finalSetSuperTiebreak: false },
  BO3_STB: {
    key: 'BO3_STB',
    label: 'Best of 3 sets (deciding set: match tiebreak to 10)',
    setsToWin: 2,
    finalSetSuperTiebreak: true,
  },
  BO5: { key: 'BO5', label: 'Best of 5 sets', setsToWin: 3, finalSetSuperTiebreak: false },
  BO5_STB: {
    key: 'BO5_STB',
    label: 'Best of 5 sets (deciding set: match tiebreak to 10)',
    setsToWin: 3,
    finalSetSuperTiebreak: true,
  },
};

const SUPER_TIEBREAK_POINTS = 10;
const TIEBREAK_POINTS = 7;

function decidingSetIndex(format) {
  return format.setsToWin * 2 - 2;
}

function emptySet() {
  return { p1: 0, p2: 0, tiebreak: null, isSuperTiebreak: false, winner: null };
}

function createSetForIndex(index, format) {
  if (index === decidingSetIndex(format) && format.finalSetSuperTiebreak) {
    return { p1: 0, p2: 0, tiebreak: { p1: 0, p2: 0 }, isSuperTiebreak: true, winner: null };
  }
  return emptySet();
}

function initState(formatKey) {
  const format = FORMATS[formatKey];
  if (!format) throw new Error(`Unknown match format: ${formatKey}`);
  return {
    sets: [createSetForIndex(0, format)],
    currentSet: 0,
    status: 'IN_PROGRESS',
    winner: null,
    setsWon: { 1: 0, 2: 0 },
  };
}

function finalizeSet(state, set, winner) {
  set.winner = winner;
  if (set.tiebreak && !set.isSuperTiebreak) {
    if (winner === 1) {
      set.p1 = 7;
      set.p2 = 6;
    } else {
      set.p1 = 6;
      set.p2 = 7;
    }
  }
  state.setsWon[winner] += 1;
  return state.setsWon[winner];
}

// Returns a NEW state object (does not mutate the input).
function applyDelta(state, formatKey, player, delta) {
  const format = FORMATS[formatKey];
  if (!format) throw new Error(`Unknown match format: ${formatKey}`);
  if (state.status === 'COMPLETE') return state;
  if (player !== 1 && player !== 2) throw new Error('player must be 1 or 2');
  if (delta !== 1 && delta !== -1) throw new Error('delta must be 1 or -1');

  const next = JSON.parse(JSON.stringify(state));
  const set = next.sets[next.currentSet];
  const key = player === 1 ? 'p1' : 'p2';

  if (set.tiebreak) {
    set.tiebreak[key] = Math.max(0, set.tiebreak[key] + delta);
    if (delta > 0) {
      const target = set.isSuperTiebreak ? SUPER_TIEBREAK_POINTS : TIEBREAK_POINTS;
      const a = set.tiebreak.p1;
      const b = set.tiebreak.p2;
      if ((a >= target || b >= target) && Math.abs(a - b) >= 2) {
        const winner = a > b ? 1 : 2;
        const setsWon = finalizeSet(next, set, winner);
        advanceOrFinish(next, format, winner, setsWon);
      }
    }
  } else {
    set[key] = Math.max(0, set[key] + delta);
    if (delta > 0) {
      const a = set.p1;
      const b = set.p2;
      if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) {
        const winner = a > b ? 1 : 2;
        const setsWon = finalizeSet(next, set, winner);
        advanceOrFinish(next, format, winner, setsWon);
      } else if (a === 6 && b === 6) {
        set.tiebreak = { p1: 0, p2: 0 };
        set.isSuperTiebreak = false;
      }
    }
  }

  return next;
}

function advanceOrFinish(state, format, winner, setsWon) {
  if (setsWon >= format.setsToWin) {
    state.status = 'COMPLETE';
    state.winner = winner;
  } else {
    state.currentSet += 1;
    state.sets.push(createSetForIndex(state.currentSet, format));
  }
}

// "7-6(4)" / "6-7(4)" / "10-7" (super tiebreak, no games played) / "6-3"
function describeSet(set) {
  if (set.isSuperTiebreak) {
    return `${set.tiebreak.p1}-${set.tiebreak.p2}`;
  }
  if (set.tiebreak && set.winner) {
    const loserPoints = set.winner === 1 ? set.tiebreak.p2 : set.tiebreak.p1;
    return `${set.p1}-${set.p2}(${loserPoints})`;
  }
  return `${set.p1}-${set.p2}`;
}

function describeMatch(state) {
  return state.sets
    .filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)))
    .map(describeSet)
    .join(', ');
}

module.exports = {
  FORMATS,
  initState,
  applyDelta,
  describeSet,
  describeMatch,
  decidingSetIndex,
};
