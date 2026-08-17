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

// Whether a set's raw score already meets a standard win condition, and who won it.
// Returns null if the set isn't decided yet.
function computeSetOutcome(set) {
  if (set.tiebreak) {
    const target = set.isSuperTiebreak ? SUPER_TIEBREAK_POINTS : TIEBREAK_POINTS;
    const a = set.tiebreak.p1;
    const b = set.tiebreak.p2;
    if ((a >= target || b >= target) && Math.abs(a - b) >= 2) return a > b ? 1 : 2;
    return null;
  }
  const a = set.p1;
  const b = set.p2;
  if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) return a > b ? 1 : 2;
  return null;
}

// Recomputes currentSet/status/winner/setsWon from the raw per-set scores.
// Used after an admin directly edits a specific (possibly already-decided) set,
// since that can flip the outcome of sets after it — mutates and returns state.
function recomputeFromSets(state, format) {
  const setsWon = { 1: 0, 2: 0 };
  let matchWinner = null;
  let matchStatus = 'IN_PROGRESS';
  let currentSet = 0;

  for (let i = 0; i < state.sets.length; i += 1) {
    const set = state.sets[i];
    const outcome = computeSetOutcome(set);
    currentSet = i;
    if (!outcome) {
      set.winner = null;
      // Drop any sets beyond this one — they're stale leftovers from before
      // a correction or a format change reduced how many sets are needed,
      // not sets the match has actually reached yet.
      state.sets = state.sets.slice(0, i + 1);
      break;
    }
    set.winner = outcome;
    if (set.tiebreak && !set.isSuperTiebreak) {
      set.p1 = outcome === 1 ? 7 : 6;
      set.p2 = outcome === 1 ? 6 : 7;
    }
    setsWon[outcome] += 1;
    if (setsWon[outcome] >= format.setsToWin) {
      matchWinner = outcome;
      matchStatus = 'COMPLETE';
      state.sets = state.sets.slice(0, i + 1);
      break;
    }
  }

  if (matchStatus !== 'COMPLETE') {
    const lastSet = state.sets[state.sets.length - 1];
    if (computeSetOutcome(lastSet)) {
      state.sets.push(createSetForIndex(state.sets.length, format));
      currentSet = state.sets.length - 1;
    }
  }

  state.currentSet = currentSet;
  state.status = matchStatus;
  state.winner = matchWinner;
  state.setsWon = setsWon;
  return state;
}

// Admin correction: adjust one specific set's score directly, even if that set
// (or the whole match) has already finished, then recompute the match outcome
// from scratch since fixing an earlier set can change who won later ones.
function editSetScore(state, formatKey, setIndex, player, delta) {
  const format = FORMATS[formatKey];
  if (!format) throw new Error(`Unknown match format: ${formatKey}`);
  if (player !== 1 && player !== 2) throw new Error('player must be 1 or 2');
  if (delta !== 1 && delta !== -1) throw new Error('delta must be 1 or -1');

  const next = JSON.parse(JSON.stringify(state));
  const set = next.sets[setIndex];
  if (!set) throw new Error('Invalid set index');
  const key = player === 1 ? 'p1' : 'p2';

  if (set.tiebreak) {
    // No fixed point cap (a breaker can legitimately run past 7/10 points),
    // but once it's already decided real play would have stopped — refuse
    // to pile more points onto it. Correcting it still works: decrement
    // first to un-decide it, then increment from there.
    if (delta > 0 && computeSetOutcome(set) !== null) {
      throw new Error('That tiebreak is already decided — undo a point first before adding another');
    }
    set.tiebreak[key] = Math.max(0, set.tiebreak[key] + delta);
  } else {
    // A non-tiebreak set can never reach 8 games (6-6 always converts to a
    // tiebreak) — 7 (from a 7-5 finish) is the hard ceiling.
    if (delta > 0 && set[key] + 1 > 7) {
      throw new Error('A set cannot go beyond 7 games');
    }
    set[key] = Math.max(0, set[key] + delta);
    if (set.p1 === 6 && set.p2 === 6) {
      set.tiebreak = { p1: 0, p2: 0 };
      set.isSuperTiebreak = false;
    }
  }

  return recomputeFromSets(next, format);
}

// Changes the match format mid-game. Sets already decided keep their score
// under the same per-set rules (win condition doesn't depend on format); only
// the *current* set is reshaped to the new format's rules, and only if it
// has no progress yet (0-0) — a set already in progress keeps its current
// shape rather than trying to convert partial games into an equivalent super
// tiebreak or vice versa. Future sets are created under the new format
// automatically as the match reaches them. Throws if the new format's rules
// mean the sets already played would immediately decide the match — the
// caller should reject the change rather than silently finishing it.
function applyFormatChange(state, newFormatKey) {
  const newFormat = FORMATS[newFormatKey];
  if (!newFormat) throw new Error(`Unknown match format: ${newFormatKey}`);

  const next = JSON.parse(JSON.stringify(state));
  const cur = next.sets[next.currentSet];
  const hasProgress = cur.p1 > 0 || cur.p2 > 0 || (cur.tiebreak && (cur.tiebreak.p1 > 0 || cur.tiebreak.p2 > 0));
  if (!hasProgress) {
    next.sets[next.currentSet] = createSetForIndex(next.currentSet, newFormat);
  }

  const recomputed = recomputeFromSets(next, newFormat);
  if (recomputed.status === 'COMPLETE') {
    throw new Error('Switching to this format would immediately decide the match from the sets already played — correct the score first, or pick a different format.');
  }
  return recomputed;
}

function isValidSetScore(p1, p2) {
  if ((p1 === 7 && p2 === 6) || (p1 === 6 && p2 === 7)) return true;
  return (p1 >= 6 || p2 >= 6) && Math.abs(p1 - p2) >= 2;
}

// Builds a finished match state directly from a list of already-known set
// scores (e.g. "6-4, 3-6, 10-7"), for recording a result that was played
// outside the app instead of scored live.
//
// Without explicitWinner, every entered set must be a valid, decisive score
// and together they must add up to a completed match — throws a user-facing
// message otherwise. With explicitWinner (1 or 2), this is a walkover or
// retirement instead: only the LAST entered set may be a partial/in-progress
// score (or there may be no sets at all), and the given player is recorded
// as the winner regardless of what the raw scores add up to.
function buildResultFromSets(formatKey, rawSets, explicitWinner) {
  const format = FORMATS[formatKey];
  if (!format) throw new Error(`Unknown match format: ${formatKey}`);
  if (!explicitWinner && (!Array.isArray(rawSets) || rawSets.length === 0)) {
    throw new Error('Enter at least one set score');
  }
  if (explicitWinner && ![1, 2].includes(explicitWinner)) {
    throw new Error('Pick who won');
  }

  const sets = [];
  const setsWon = { 1: 0, 2: 0 };
  let winner = null;
  const entered = rawSets || [];

  entered.forEach((raw, i) => {
    if (winner) throw new Error('Too many sets entered — the match was already decided');

    const p1 = Number(raw.p1);
    const p2 = Number(raw.p2);
    if (!Number.isInteger(p1) || !Number.isInteger(p2) || p1 < 0 || p2 < 0) {
      throw new Error(`Invalid score for set ${i + 1}`);
    }
    const canBePartial = explicitWinner && i === entered.length - 1;

    const isDeciderTiebreak = i === decidingSetIndex(format) && format.finalSetSuperTiebreak;
    let set;
    if (isDeciderTiebreak) {
      const decided = (p1 >= SUPER_TIEBREAK_POINTS || p2 >= SUPER_TIEBREAK_POINTS) && Math.abs(p1 - p2) >= 2;
      if (!decided && !canBePartial) {
        throw new Error(`Set ${i + 1} (match tiebreak) doesn't have a valid winner`);
      }
      set = { p1, p2, tiebreak: { p1, p2 }, isSuperTiebreak: true, winner: decided ? (p1 > p2 ? 1 : 2) : null };
    } else {
      const decided = isValidSetScore(p1, p2);
      if (!decided && !canBePartial) {
        throw new Error(`Set ${i + 1} doesn't have a valid winner`);
      }
      const setWinner = decided ? (p1 > p2 ? 1 : 2) : null;
      // No placeholder tiebreak object for a 7-6 set — the real point score
      // wasn't entered, and a fake "(0)" sub-score would be misleading.
      set = { p1, p2, tiebreak: null, isSuperTiebreak: false, winner: setWinner };
    }

    sets.push(set);
    if (set.winner) {
      setsWon[set.winner] += 1;
      if (setsWon[set.winner] >= format.setsToWin) winner = set.winner;
    }
  });

  if (sets.length === 0) sets.push(createSetForIndex(0, format));

  if (explicitWinner) {
    winner = explicitWinner;
  } else if (!winner) {
    throw new Error("These set scores don't add up to a completed match");
  }

  return { sets, currentSet: sets.length - 1, status: 'COMPLETE', winner, setsWon };
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
  editSetScore,
  applyFormatChange,
  buildResultFromSets,
  describeSet,
  describeMatch,
  decidingSetIndex,
};
