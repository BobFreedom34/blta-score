// Round-robin schedule for one group: everyone plays everyone once, the number of rounds follows from the number of
// players (6 players = 5 rounds, 7 players = 7 rounds because one player rests each round, 8 players = 7 rounds).
// There are no dates: a round is just the round number inside the group.

// Circle method. players: array of ids (any order). Returns [{ round, pairs: [[p1, p2], ...], rest: id|null }] with
// round numbers starting at 1. With an odd number of players one of them rests in each round. Who is listed first in
// a pair ("player 1") is shared out as evenly as possible.
function circleSchedule(players) {
  const list = [...players];
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(null); // the empty seat is the rest round
  const n = list.length;
  const rounds = [];
  let ring = [...list];
  const asFirst = new Map(); // how often each player has been listed first so far
  for (let r = 0; r < n - 1; r += 1) {
    const pairs = [];
    let rest = null;
    for (let i = 0; i < n / 2; i += 1) {
      let a = ring[i];
      let b = ring[n - 1 - i];
      if (a === null) { rest = b; continue; }
      if (b === null) { rest = a; continue; }
      // the one who has been listed first less often goes first (ties: alternate with the round)
      const fa = asFirst.get(a) || 0;
      const fb = asFirst.get(b) || 0;
      if (fa > fb || (fa === fb && (i + r) % 2 === 1)) [a, b] = [b, a];
      asFirst.set(a, (asFirst.get(a) || 0) + 1);
      pairs.push([a, b]);
    }
    rounds.push({ round: r + 1, pairs, rest });
    // rotate everyone except the first seat
    ring = [ring[0], ring[n - 1], ...ring.slice(1, n - 1)];
  }
  return rounds;
}

const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// What still has to be created for a group.
//   members:  active player ids
//   existing: matches that already exist in the group: [{ round: number|null, p1, p2 }] (any status)
// Returns [{ round, p1, p2 }]: only the pairs that have no match yet.
//  - nothing exists yet: the complete circle schedule;
//  - some matches exist (a player added late, or a half-built group): every missing pair goes into the earliest round
//    where neither player is already busy (a new round is opened when there is none).
function planMissingMatches(members, existing) {
  const have = new Set(existing.map((m) => pairKey(m.p1, m.p2)));
  if (!existing.length) {
    const plan = [];
    circleSchedule(members).forEach((r) => r.pairs.forEach(([p1, p2]) => plan.push({ round: r.round, p1, p2 })));
    return plan;
  }
  const busy = new Map(); // round -> Set of player ids
  existing.forEach((m) => {
    if (!m.round) return;
    if (!busy.has(m.round)) busy.set(m.round, new Set());
    busy.get(m.round).add(m.p1);
    busy.get(m.round).add(m.p2);
  });
  const plan = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      if (have.has(pairKey(a, b))) continue;
      let round = 1;
      while (busy.has(round) && (busy.get(round).has(a) || busy.get(round).has(b))) round += 1;
      if (!busy.has(round)) busy.set(round, new Set());
      busy.get(round).add(a);
      busy.get(round).add(b);
      plan.push({ round, p1: a, p2: b });
    }
  }
  return plan.sort((x, y) => x.round - y.round);
}

module.exports = { circleSchedule, planMissingMatches, pairKey };
