// The final standings of a tournament or a season (the tab "Konečné poradie" of its page): who finished where.
//   - a bracket: 1st the winner, 2nd the finalist, then by the round a player lost in (semi-finalists share 3rd-4th, quarter-finalists 5th-8th …); a player still in play is
//     listed first as "still playing" and the order is provisional until the final is decided; the losers brackets rank the losers they hold: MONRAD decides every place, PRINCE only the round-1 losers (the others of a round share their places);
//   - the matches for the places after two groups (see tournamentDraw.createPlacementMatches): the final gives 1st-2nd, the match for the 3rd place 3rd-4th …;
//   - groups: the players that did not go on to a bracket follow the bracket players, by their place in the group; groups without a bracket are listed one by one;
//   - a league season: one table per group (its places), and a section per play-off bracket.
// A row is { from, to, stage, round, place, player: { id, name, slug } }: from..to is the place (a range when players share it, e.g. the two semi-finalists 3-4).
// stage: WINNER | FINALIST | SEMI | QUARTER | LAST16 | ROUND (lost in round `round`) | PLACE (a match for the places) | GROUP (the `place` in its group) | TABLE (a place in a
// league table) | PLAYING.
const db = require('./db');
const bracketEngine = require('./bracketEngine');
const groups = require('./tournamentGroups');
const { FROZEN } = require('./frozenStandings');

const LABELS = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice', DOUBLES: 'Štvorhra', OPEN: 'Bez kategórie' };
const ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE', 'DOUBLES', 'OPEN'];

function playerOf(id) {
  const p = id ? db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(id) : null;
  return p ? { id: p.id, name: p.name, slug: p.slug || null } : null;
}
// a slot of a doubles draw is a pair "A / B" (no profile)
function slotPlayer(bracket, id) {
  const first = playerOf(id);
  if (!first) return null;
  if (!bracket.is_doubles) return first;
  const partner = playerOf(bracketEngine.partnerOf(bracket.id, id));
  return { id: first.id, name: partner ? `${first.name} / ${partner.name}` : first.name, slug: null };
}
const byName = (a, b) => String(a.player.name).localeCompare(String(b.player.name), 'sk');

// The tiers of one bracket, best first: [{ ids, stage, round }] — the players of a tier share its places. The winner, then the finalist, then the players who lost in each
// round, the latest round first. The losers of a round that have a bracket of their own (the losers brackets of PRINCE: the round-1 losers; of MONRAD: the losers of
// every round, each again a Monrad) are ranked by how that bracket went, so MONRAD decides every place and PRINCE only the first ones among the round-1 losers.
function bracketTiers(bracket, all) {
  const nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position').all(bracket.id);
  const rounds = bracketEngine.roundCount(bracket.size);
  const lostIn = new Map(); // player id -> the round he lost in
  const seen = new Set();
  let champion = null;
  nodes.forEach((n) => {
    [n.player1_id, n.player2_id].filter(Boolean).forEach((id) => seen.add(id));
    if (!n.player1_id || !n.player2_id) return;
    const winner = bracketEngine.nodeWinner(n);
    if (!winner || (winner !== n.player1_id && winner !== n.player2_id)) return;
    lostIn.set(winner === n.player1_id ? n.player2_id : n.player1_id, n.round);
    if (n.round === rounds) champion = winner;
  });
  const tiers = [];
  let complete = !!champion;
  if (champion) tiers.push({ ids: [champion], stage: 'WINNER' });
  else {
    const playing = [...seen].filter((id) => !lostIn.has(id));
    if (playing.length) tiers.push({ ids: playing, stage: 'PLAYING' });
  }
  for (let round = rounds; round >= 1; round -= 1) {
    const ids = [...lostIn.entries()].filter(([, r]) => r === round).map(([id]) => id);
    if (!ids.length) continue;
    const away = rounds - round; // 0: lost the final, 1: a semi-final, 2: a quarter-final …
    const stage = away === 0 ? 'FINALIST' : away === 1 ? 'SEMI' : away === 2 ? 'QUARTER' : away === 3 ? 'LAST16' : 'ROUND';
    const child = all.find((b) => b.parent_bracket_id === bracket.id && b.kind === 'CONSOLATION' && (b.feeds_round || 1) === round);
    if (child && ids.length > 1) {
      const sub = bracketTiers(child, all);
      complete = complete && sub.complete;
      const inSet = new Set(ids);
      const placed = new Set();
      sub.tiers.forEach((t) => {
        const mine = t.ids.filter((id) => inSet.has(id));
        mine.forEach((id) => placed.add(id));
        if (mine.length) tiers.push({ ids: mine, stage: t.stage === 'PLAYING' ? 'PLAYING' : 'PLACE' });
      });
      const left = ids.filter((id) => !placed.has(id));
      if (left.length) tiers.push({ ids: left, stage, round });
    } else {
      tiers.push({ ids, stage, round });
    }
  }
  return { tiers, complete, seen };
}

// The rows of one bracket (with the brackets of the losers under it). -> { rows, complete, players: Set of ids }
function bracketRows(bracket, all = []) {
  const made = bracketTiers(bracket, all);
  const rows = [];
  let offset = 0;
  made.tiers.forEach((tier) => {
    const part = tier.ids.map((id) => ({ player: slotPlayer(bracket, id), stage: tier.stage, round: tier.round })).filter((r) => r.player).sort(byName);
    part.forEach((r) => rows.push({ ...r, from: offset + 1, to: offset + part.length }));
    offset += part.length;
  });
  return { rows, complete: made.complete, players: made.seen };
}

// The matches for the places: each bracket of two is a place pair (the first one the 1st-2nd, the next the 3rd-4th …).
function placementRows(list) {
  const rows = [];
  let complete = true;
  const players = new Set();
  list.forEach((bracket, i) => {
    const node = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position LIMIT 1').get(bracket.id);
    if (!node) return;
    const ids = [node.player1_id, node.player2_id].filter(Boolean);
    ids.forEach((id) => players.add(id));
    const winner = bracketEngine.nodeWinner(node);
    const first = 2 * i + 1;
    if (winner && ids.length === 2) {
      const loser = winner === node.player1_id ? node.player2_id : node.player1_id;
      [[winner, first], [loser, first + 1]].forEach(([id, place]) => { const player = slotPlayer(bracket, id); if (player) rows.push({ player, from: place, to: place, stage: 'PLACE' }); });
    } else {
      complete = false;
      ids.forEach((id) => { const player = slotPlayer(bracket, id); if (player) rows.push({ player, from: first, to: first + 1, stage: 'PLAYING' }); });
    }
  });
  return { rows, complete, players };
}

// The players of the groups of a category that are not in the brackets: by their place in the group, those with the same place share the places.
function groupRemainder(seasonId, category, taken, offset) {
  const out = [];
  groups.groupsOf(seasonId, category).forEach((g) => {
    groups.groupRows(g).forEach((r) => { if (r.player && !taken.has(r.player.id)) out.push({ player: { id: r.player.id, name: r.player.name, slug: r.player.slug || null }, place: r.position, group: g.name, points: r.points }); });
  });
  const rows = [];
  let next = offset;
  [...new Set(out.map((x) => x.place))].sort((a, b) => a - b).forEach((place) => {
    const same = out.filter((x) => x.place === place).sort((a, b) => String(a.player.name).localeCompare(String(b.player.name), 'sk'));
    same.forEach((x) => rows.push({ player: x.player, from: next + 1, to: next + same.length, stage: 'GROUP', place, group: x.group }));
    next += same.length;
  });
  return rows;
}

function groupsFinished(seasonId, category) {
  const state = groups.groupsState(seasonId, category);
  return !state || state.allFinished;
}

// A table of one group as final standings (a group without a bracket; a group of a league season).
function tableSection(season, group, frozen) {
  let rows;
  if (frozen && frozen[group.name.toLowerCase()]) {
    const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const known = new Map(db.prepare('SELECT id, name, slug FROM players').all().map((p) => [fold(p.name), p]));
    rows = frozen[group.name.toLowerCase()].map((r) => { const p = known.get(fold(r.name)); return { player: { id: p ? p.id : null, name: r.name, slug: p ? p.slug || null : null }, from: r.position, to: r.position, stage: 'TABLE', place: r.position }; });
  } else {
    rows = groups.groupRows(group).filter((r) => r.player).map((r) => ({ player: { id: r.player.id, name: r.player.name, slug: r.player.slug || null }, from: r.position, to: r.position, stage: 'TABLE', place: r.position }));
  }
  const counts = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('FINISHED', 'UNFINISHED') THEN 1 ELSE 0 END) AS done FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").get(group.id);
  return { key: `group-${group.id}`, title: group.name, category: group.category, complete: !counts.total || counts.total === (counts.done || 0), rows };
}

function compute(season) {
  const brackets = db.prepare('SELECT * FROM brackets WHERE season_id = ? ORDER BY id').all(season.id);
  const allGroups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, id').all(season.id);
  const frozen = FROZEN[season.slug] || null;
  const sections = [];
  const catOf = (x) => x.category || 'OPEN';
  const categories = [...new Set([...brackets.map(catOf), ...allGroups.map(catOf)])].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  if (season.kind !== 'TOURNAMENT') {
    // a league season: a table per group, then its play-off brackets
    allGroups.forEach((g) => sections.push(tableSection(season, g, frozen)));
    brackets.filter((b) => (b.kind || 'MAIN') === 'MAIN').forEach((b) => {
      const made = bracketRows(b, brackets);
      if (made.rows.length) sections.push({ key: `bracket-${b.id}`, title: b.name, category: catOf(b), complete: made.complete, rows: made.rows });
    });
  } else {
    categories.forEach((category) => {
      const own = brackets.filter((b) => catOf(b) === category);
      const placement = own.filter((b) => b.kind === 'PLACEMENT');
      const mains = own.filter((b) => (b.kind || 'MAIN') === 'MAIN');
      const categoryGroups = allGroups.filter((g) => catOf(g) === category);
      const title = LABELS[category] || category;
      if (placement.length) {
        const made = placementRows([...mains.slice(0, 1), ...placement]);
        const rest = groupRemainder(season.id, category, made.players, made.players.size);
        sections.push({ key: `category-${category}`, title, category, complete: made.complete && groupsFinished(season.id, category), rows: [...made.rows, ...rest] });
      } else if (mains.length) {
        const made = bracketRows(mains[0], brackets);
        const rest = groupRemainder(season.id, category, made.players, made.players.size);
        sections.push({ key: `category-${category}`, title, category, complete: made.complete && groupsFinished(season.id, category), rows: [...made.rows, ...rest] });
      } else if (categoryGroups.length === 1) {
        const section = { ...tableSection(season, categoryGroups[0], null), key: `category-${category}`, title };
        // a Swiss draw is decided only after its last round (the matches of the rounds made so far being played is not enough)
        const swissState = require('./swiss').state(season.id, category);
        if (swissState) section.complete = section.complete && swissState.finished;
        sections.push(section);
      } else {
        categoryGroups.forEach((g) => sections.push({ ...tableSection(season, g, null), title: `${title} — ${g.name}` }));
      }
    });
  }
  const filled = sections.filter((s) => s.rows.length);
  return { sections: filled, complete: filled.length > 0 && filled.every((s) => s.complete) };
}

module.exports = { compute };
