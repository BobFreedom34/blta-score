// A player who registered can drop out himself, up to a number of hours before the event starts (the organiser sets the number in the Backend, in the section Štartovné a
// registrácia: seasons.unregister_hours; empty = the player cannot drop out alone). The start of a tournament is its first day at the start of its playing day
// (the planning setting, 09:00 unless set), the start of a league season is midnight of its first day (Bratislava time). Once the draw is made (the player is in a
// group or a bracket, or has matches) he can no longer drop out alone: the organiser does it.
const db = require('./db');
const tournamentSchedule = require('./tournamentSchedule');

const HOUR = 3600 * 1000;

function startMs(season) {
  if (!season || !season.start_date) return null;
  if (season.kind === 'TOURNAMENT') return tournamentSchedule.tournamentStartMs(season); // the first day's playing window: its own start time, else the general one
  return tournamentSchedule.localToUtcMs(season.start_date, '00:00');
}

// the moment after which he cannot drop out any more (UTC milliseconds), or null when the player cannot drop out at all
function deadlineMs(season) {
  if (!season || season.unregister_hours === null || season.unregister_hours === undefined) return null;
  const start = startMs(season);
  return start === null ? null : start - season.unregister_hours * HOUR;
}

// is the player already in the draw of the event (a group, a bracket, a match)?
function inDraw(season, playerId) {
  if (!playerId) return false;
  const matches = db.prepare('SELECT 1 FROM matches WHERE season_id = ? AND (player1_id = ? OR player2_id = ? OR player1b_id = ? OR player2b_id = ?) LIMIT 1').get(season.id, playerId, playerId, playerId, playerId);
  if (matches) return true;
  return !!db.prepare('SELECT 1 FROM season_group_members m JOIN season_groups g ON g.id = m.group_id WHERE g.season_id = ? AND m.player_id = ? LIMIT 1').get(season.id, playerId);
}

// -> { allowed, reason: null | 'OFF' | 'LATE' | 'DRAW', deadline: ISO string | null, hours }
function stateFor(season, playerId, now = Date.now()) {
  const deadline = deadlineMs(season);
  const out = { allowed: false, reason: null, deadline: deadline === null ? null : new Date(deadline).toISOString(), hours: season.unregister_hours === undefined ? null : season.unregister_hours };
  if (deadline === null) { out.reason = 'OFF'; return out; }
  if (now > deadline) { out.reason = 'LATE'; return out; }
  if (inDraw(season, playerId)) { out.reason = 'DRAW'; return out; }
  out.allowed = true;
  return out;
}

module.exports = { startMs, deadlineMs, stateFor, inDraw };
