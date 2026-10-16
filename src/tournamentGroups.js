// Round-robin groups of a tournament category: the players are split into groups (suggested automatically, or put together by the
// organiser), everybody in a group plays everybody once, and the tables come from the same rules as the league's group tables
// (standings.js). The group matches are ordinary matches of the tournament (stage GROUP, tagged with the group), so they count for the
// ranking like every other match of it. A group is a season_groups row of the tournament with the category of its players.
const crypto = require('crypto');
const db = require('./db');
const engine = require('./matchEngine');
const roundRobin = require('./roundRobin');
const { computeGroupStandings } = require('./standings');

const groupName = (i) => `Skupina ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`;
const CATEGORY_LABELS = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
// A group name is unique in its season, so a group of a tournament carries its category: "Elite — Skupina A" (the pages that already show the
// category leave the first part out)
const fullGroupName = (category, name) => (name.startsWith(`${CATEGORY_LABELS[category]} — `) ? name : `${CATEGORY_LABELS[category]} — ${name}`);

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// How many groups: the number asked for, else as many as needed for groups of at most `groupSize` (at least 2 players each).
function groupCountFor(playerCount, { groupSize, groupCount }) {
  const wanted = groupCount ? Number(groupCount) : Math.ceil(playerCount / Math.max(2, Number(groupSize) || 4));
  return Math.max(1, Math.min(wanted, Math.floor(playerCount / 2)));
}

// Splits the players into groups: the seeded players first (seed 1 in group A, seed 2 in group B …, then back again — a "snake"), so the
// best are spread over the groups, then the others by lot. players: [{ playerId, seed }]. -> [{ name, playerIds }]
function suggestGroups(players, options, random = Math.random) {
  const seeded = players.filter((p) => p.seed).sort((a, b) => a.seed - b.seed);
  const rest = shuffled(players.filter((p) => !p.seed), random);
  const ordered = [...seeded, ...rest];
  const count = groupCountFor(ordered.length, options);
  const groups = Array.from({ length: count }, (_, i) => ({ name: groupName(i), playerIds: [] }));
  ordered.forEach((p, i) => {
    const row = Math.floor(i / count);
    const col = i % count;
    groups[row % 2 === 0 ? col : count - 1 - col].playerIds.push(p.playerId);
  });
  return groups;
}

// Makes the groups and all their round-robin matches. assignments: [{ name, playerIds }]. Returns { groups: [{ id, name, playerIds, matches }], matches }.
function createGroups(season, category, assignments, format) {
  if (!engine.FORMATS[format] || format === 'FREE_PLAY') throw new Error('Invalid match format of the group matches');
  const insertGroup = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)');
  const insertMember = db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)');
  const insertMatch = db.prepare(`
    INSERT INTO matches (share_token, category, season_id, group_id, stage, round, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (?, ?, ?, ?, 'GROUP', ?, ?, ?, '', NULL, ?, 'PLANNED', ?, '[]', 1, '')
  `);
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_groups WHERE season_id = ?').get(season.id).n;
  const made = [];
  let total = 0;
  assignments.forEach((a, i) => {
    const name = fullGroupName(category, a.name);
    const info = insertGroup.run(season.id, name, category, order + i);
    const id = Number(info.lastInsertRowid);
    a.playerIds.forEach((pid, k) => insertMember.run(id, pid, k));
    const plan = roundRobin.planMissingMatches(a.playerIds, []);
    plan.forEach((m) => insertMatch.run(crypto.randomUUID(), category, season.id, id, m.round, m.p1, m.p2, format, JSON.stringify(engine.initState(format))));
    made.push({ id, name, playerIds: a.playerIds, matches: plan.length });
    total += plan.length;
  });
  return { groups: made, matches: total };
}

function groupsOf(seasonId, category) {
  return db.prepare('SELECT * FROM season_groups WHERE season_id = ? AND category = ? ORDER BY sort_order, id').all(seasonId, category);
}

// The table of one group (the same rows as the league's tables): [{ position, player, points, played, wins, losses, setDiff, games }]
function groupRows(group) {
  const players = new Map();
  const playerStmt = db.prepare('SELECT id, name, slug FROM players WHERE id = ?');
  const records = db.prepare("SELECT player1_id, player2_id, winner_id, status, end_reason, state, COALESCE(scheduled_at, end_time, created_at) AS d FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").all(group.id).map((r) => {
    [r.player1_id, r.player2_id].forEach((pid) => { if (!players.has(pid)) players.set(pid, playerStmt.get(pid)); });
    return { player1Id: r.player1_id, player2Id: r.player2_id, winnerId: r.winner_id, status: r.status, endReason: r.end_reason, date: r.d, state: JSON.parse(r.state) };
  });
  // a member without a match yet still has a row
  db.prepare('SELECT player_id FROM season_group_members WHERE group_id = ?').all(group.id).forEach((m) => { if (!players.has(m.player_id)) players.set(m.player_id, playerStmt.get(m.player_id)); });
  return computeGroupStandings(records, players);
}

// How far the groups of a category are: { groups: [{ id, name, players, matches, finished }], matches, finished, allFinished }; null without groups.
function groupsState(seasonId, category) {
  const groups = groupsOf(seasonId, category);
  if (!groups.length) return null;
  const rows = groups.map((g) => {
    const counts = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'FINISHED' OR (status = 'UNFINISHED') THEN 1 ELSE 0 END) AS done FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").get(g.id);
    const players = db.prepare('SELECT p.id, p.name FROM season_group_members m JOIN players p ON p.id = m.player_id WHERE m.group_id = ? ORDER BY m.sort_order').all(g.id);
    return { id: g.id, name: g.name, players, matches: counts.total, finished: counts.done || 0 };
  });
  const matches = rows.reduce((s, g) => s + g.matches, 0);
  const finished = rows.reduce((s, g) => s + g.finished, 0);
  return { groups: rows, matches, finished, allFinished: matches > 0 && finished === matches };
}

// The players that go on from the groups, best first: everybody's first place before everybody's second, and so on; within a place by
// points, set difference, wins. -> [{ playerId, groupId, place }]
function qualifiers(seasonId, category, perGroup) {
  const out = [];
  groupsOf(seasonId, category).forEach((g, gi) => {
    groupRows(g).slice(0, perGroup).forEach((r, i) => out.push({ playerId: r.player.id, groupId: g.id, place: i + 1, points: r.points, setDiff: r.setDiff, wins: r.wins, gi }));
  });
  return out.sort((a, b) => a.place - b.place || b.points - a.points || b.setDiff - a.setDiff || b.wins - a.wins || a.gi - b.gi);
}

module.exports = { groupName, groupCountFor, suggestGroups, createGroups, groupsOf, groupRows, groupsState, qualifiers };
