// Adding a match to a tournament by hand (the button "+ Pridať zápas" in the Harmonogram, for the organiser): the matches of a group or a Swiss round are made by the draw, and when a
// round is wrong or a match is missing there was no way to add one — the form "Nový zápas" makes an ordinary league match. The match made here is a real match of the group and the
// round (category "Iné", the match format of the group), so it counts in the table and in the state of the round; the court planner places it (or the organiser picks a court and time).
// Groups of a doubles tournament and the knockout brackets are not handled here (their structure is fixed).
const db = require('./db');
const groups = require('./tournamentGroups');
const tournamentSchedule = require('./tournamentSchedule');

const MAX_ROUND = 99;

const groupFormatOf = (seasonId, category) => {
  const row = db.prepare('SELECT group_format FROM tournament_categories WHERE season_id = ? AND category = ?').get(seasonId, category);
  return (row && row.group_format) || 'BO3_STB';
};

// the groups of the tournament with the players of each (not the ones who withdrew) and the rounds they have: what the form needs
function matchOptions(season) {
  const rows = db.prepare("SELECT * FROM season_groups WHERE season_id = ? AND category != 'DOUBLES' ORDER BY sort_order, id").all(season.id);
  return {
    courtCount: season.court_count || 0,
    days: tournamentSchedule.settingsOf(season).days,
    groups: rows.map((g) => {
      const players = db.prepare('SELECT p.id, p.name FROM season_group_members m JOIN players p ON p.id = m.player_id WHERE m.group_id = ? AND m.withdrawn_at IS NULL ORDER BY m.sort_order, p.name').all(g.id);
      const last = db.prepare("SELECT MAX(round) AS r FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").get(g.id).r;
      return { id: g.id, name: g.name, category: g.category, players, currentRound: last || 1, format: groupFormatOf(season.id, g.category) };
    }),
  };
}

// { groupId, round, player1Id, player2Id, courtNo?, scheduledAt?, force? } -> { error, status, code? } or { token, warnings, placed }
// Made in one step: when the court or the time is refused, nothing is created.
function addMatch(season, body) {
  const groupId = Number(body.groupId);
  const group = Number.isInteger(groupId) ? db.prepare('SELECT * FROM season_groups WHERE id = ? AND season_id = ?').get(groupId, season.id) : null;
  if (!group) return { status: 404, error: 'Group not found in this tournament' };
  if (group.category === 'DOUBLES') return { status: 400, error: 'A match cannot be added to a doubles tournament by hand' };
  const round = Number(body.round);
  if (!Number.isInteger(round) || round < 1 || round > MAX_ROUND) return { status: 400, error: `The round must be a whole number from 1 to ${MAX_ROUND}` };
  const p1 = Number(body.player1Id);
  const p2 = Number(body.player2Id);
  if (!Number.isInteger(p1) || !Number.isInteger(p2)) return { status: 400, error: 'Choose both players' };
  if (p1 === p2) return { status: 400, error: 'Choose two different players' };
  const members = new Set(db.prepare('SELECT player_id FROM season_group_members WHERE group_id = ? AND withdrawn_at IS NULL').all(group.id).map((r) => r.player_id));
  if (!members.has(p1) || !members.has(p2)) return { status: 400, error: 'Both players must be players of this group' };

  const force = body.force === true;
  const inGroup = "group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'";
  if (!force && db.prepare(`SELECT 1 FROM matches WHERE ${inGroup} AND ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?)) LIMIT 1`).get(group.id, p1, p2, p2, p1)) {
    return { status: 409, code: 'REMATCH', error: 'These two players already have a match in this group (tick "even if they have played" to add it anyway)' };
  }
  if (!force && db.prepare(`SELECT 1 FROM matches WHERE ${inGroup} AND round = ? AND (player1_id IN (?, ?) OR player2_id IN (?, ?)) LIMIT 1`).get(group.id, round, p1, p2, p1, p2)) {
    return { status: 409, code: 'SAME_ROUND', error: 'One of the players already has a match in this round (tick "even if they have played" to add it anyway)' };
  }

  const hasCourt = body.courtNo !== undefined && body.courtNo !== null && body.courtNo !== '';
  const courtNo = hasCourt ? Number(body.courtNo) : null;
  if (hasCourt && !body.scheduledAt) return { status: 400, error: 'Choose the time as well as the court' };

  let token = null;
  let warnings = [];
  db.exec('BEGIN');
  try {
    token = groups.insertGroupMatch(season, group.category, group.id, round, p1, p2, groupFormatOf(season.id, group.category));
    if (hasCourt) {
      const placed = tournamentSchedule.placeMatch(season, token, courtNo, body.scheduledAt);
      if (placed.error) { db.exec('ROLLBACK'); return { status: placed.status || 400, error: placed.error }; }
      warnings = placed.warnings || [];
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // without a court the planner places it (when "Rozvrh skladá systém sám" is on and there is room)
  if (!hasCourt) require('./bracketEngine').planCourtsForSeason(season.id);
  const placedNow = db.prepare('SELECT court_no FROM matches WHERE share_token = ?').get(token);
  return { token, warnings, placed: !!(placedNow && placedNow.court_no) };
}

module.exports = { matchOptions, addMatch };
