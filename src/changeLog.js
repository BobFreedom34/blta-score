// The change log (Backend > Log): what a match changed after it was finished, corrected, restarted or deleted — the league group
// table (points, played, position of the players) and the ranking points — and every manual correction of the ranking points.
// One row per event, only when something really changed (a live score changing point by point writes nothing). The numbers are
// saved as text in the row itself, so the log keeps showing what happened even after players or matches are renamed or deleted.
const db = require('./db');
const engine = require('./matchEngine');
const { computeGroupStandings } = require('./standings');
const { FROZEN } = require('./frozenStandings');

db.exec(`
  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    kind TEXT NOT NULL,
    match_id INTEGER,
    match_token TEXT,
    title TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(id DESC);
`);

const KINDS = ['FINISHED', 'CORRECTED', 'REOPENED', 'DELETED', 'MANUAL'];

function parseState(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

// a match row as the standings calculation wants it
function recordOf(m) {
  return {
    id: m.id,
    player1Id: m.player1_id,
    player2Id: m.player2_id,
    winnerId: m.winner_id,
    status: m.status,
    endReason: m.end_reason,
    date: m.scheduled_at || m.end_time || m.created_at,
    state: parseState(m.state),
  };
}

function groupRecords(groupId) {
  return db.prepare("SELECT * FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP'").all(groupId).map(recordOf);
}

function tableOf(records) {
  const players = new Map();
  records.forEach((r) => [r.player1Id, r.player2Id].forEach((id) => {
    if (!players.has(id)) players.set(id, db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(id) || { id, name: `#${id}`, slug: null });
  }));
  const rows = computeGroupStandings(records, players);
  return new Map(rows.map((r) => [r.playerId, { name: r.player.name, points: r.points, position: r.position, played: r.played, wins: r.wins, setDiff: r.setDiff }]));
}

// The group table before and after the change, for the players whose line changed. previousRow is the match as it was (null when
// there was none), updatedRow as it is now (null when it was deleted).
function groupImpact(previousRow, updatedRow) {
  const row = updatedRow || previousRow;
  if (!row || !row.group_id || (row.stage || 'GROUP') !== 'GROUP') return null;
  const group = db.prepare('SELECT g.id, g.name, g.category, s.name AS season_name, s.slug AS season_slug FROM season_groups g LEFT JOIN seasons s ON s.id = g.season_id WHERE g.id = ?').get(row.group_id);
  if (!group || (group.season_slug && FROZEN[group.season_slug])) return null; // a finished season shows its saved official tables
  const now = groupRecords(group.id);
  let before;
  if (!updatedRow) before = [...now, recordOf(previousRow)]; // the match is gone: before = with it
  else if (previousRow && previousRow.group_id === updatedRow.group_id && (previousRow.stage || 'GROUP') === 'GROUP') before = now.map((r) => (r.id === updatedRow.id ? recordOf(previousRow) : r));
  else before = now.filter((r) => r.id !== updatedRow.id);
  const a = tableOf(now);
  const b = tableOf(before);
  const inMatch = new Set([row.player1_id, row.player2_id]);
  const empty = { points: 0, position: null, played: 0, wins: 0, setDiff: 0 };
  const changed = [];
  new Set([...a.keys(), ...b.keys()]).forEach((id) => {
    const x = b.get(id) || empty;
    const y = a.get(id) || empty;
    if (x.points === y.points && x.position === y.position && x.played === y.played && x.wins === y.wins && x.setDiff === y.setDiff) return;
    changed.push({
      name: (a.get(id) || b.get(id)).name, inMatch: inMatch.has(id),
      pointsBefore: x.points, pointsAfter: y.points, positionBefore: x.position, positionAfter: y.position,
      playedBefore: x.played, playedAfter: y.played, winsBefore: x.wins, winsAfter: y.wins,
    });
  });
  if (!changed.length) return null;
  changed.sort((p, q) => (Number(q.inMatch) - Number(p.inMatch)) || String(p.name).localeCompare(String(q.name), 'sk'));
  return { groupName: group.name, category: group.category, seasonName: group.season_name || '', rows: changed };
}

function matchTitle(row) {
  const name = (id) => (db.prepare('SELECT name FROM players WHERE id = ?').get(id) || {}).name || `#${id}`;
  const score = row.status === 'FINISHED' ? engine.describeMatch(parseState(row.state)) : '';
  return { title: `${name(row.player1_id)} vs ${name(row.player2_id)}`, score: score || '' };
}

function write(kind, row, token, title, details) {
  db.prepare('INSERT INTO change_log (kind, match_id, match_token, title, details) VALUES (?, ?, ?, ?, ?)')
    .run(kind, row ? row.id : null, token || null, title, JSON.stringify(details));
}

// After a match was written (a score, a finish, a correction, a restart): ranking = what the ranking tables changed (the return
// of rankingPoints.reconcile). Writes a row only when the ranking points or the group table really changed.
function logMatchChange(previousRow, updatedRow, ranking) {
  const was = !!previousRow && previousRow.status === 'FINISHED';
  const is = updatedRow.status === 'FINISHED';
  const kind = !was && is ? 'FINISHED' : was && is ? 'CORRECTED' : was && !is ? 'REOPENED' : null;
  if (!kind) return false;
  const group = groupImpact(previousRow, updatedRow);
  const rankingChanges = ranking || [];
  if (!group && !rankingChanges.length) return false;
  const { title, score } = matchTitle(updatedRow);
  write(kind, updatedRow, updatedRow.share_token, title, { score, category: updatedRow.category || '', ranking: rankingChanges, group });
  return true;
}

// After a match was deleted (previousRow = the row as it was).
function logMatchDeleted(previousRow, ranking) {
  if (previousRow.status !== 'FINISHED') return false;
  const group = groupImpact(previousRow, null);
  const rankingChanges = ranking || [];
  if (!group && !rankingChanges.length) return false;
  const { title, score } = matchTitle(previousRow);
  write('DELETED', previousRow, previousRow.share_token, title, { score, category: previousRow.category || '', ranking: rankingChanges, group });
  return true;
}

// An admin set a player's ranking points by hand: change = { tableKey, tableLabel, name, before, after }.
function logManualPoints(change) {
  if (!change || change.before === change.after) return false;
  write('MANUAL', null, null, change.name, { ranking: [{ ...change, delta: change.after - change.before }], group: null });
  return true;
}

// The newest first. opts: { limit (1-200, default 50), before (an id: older than it), kind, q (a word in the title or a player name) }.
function list(opts = {}) {
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const where = [];
  const args = [];
  if (Number.isInteger(Number(opts.before)) && Number(opts.before) > 0) { where.push('id < ?'); args.push(Number(opts.before)); }
  if (KINDS.includes(opts.kind)) { where.push('kind = ?'); args.push(opts.kind); }
  if (opts.q && String(opts.q).trim()) {
    where.push('(title LIKE ? OR details LIKE ?)');
    const like = `%${String(opts.q).trim().replace(/[%_]/g, '')}%`;
    args.push(like, like);
  }
  const rows = db.prepare(`SELECT * FROM change_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id, createdAt: r.created_at, kind: r.kind, matchToken: r.match_token || null, title: r.title, ...parseState(r.details),
  }));
  return { items, hasMore: rows.length > limit };
}

module.exports = { KINDS, logMatchChange, logMatchDeleted, logManualPoints, list };
