const db = require('../../db');
const crypto = require('crypto');
const engine = require('../../matchEngine');
const roundRobin = require('../../roundRobin');
const matchPhotos = require('../matchPhotos');
const rankingPoints = require('../../rankingPoints');
const clubTournaments = require('../../clubTournaments');
const auth = require('../../auth');
const changeLog = require('../../changeLog');
const router = require('./router');
const { BLTA_CATEGORIES, serializeGroup, matchCategoryOf, resolveMemberPlayer, groupMembers } = require('./shared');

function parseGroup(body, season) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Group name is required' };
  if (name.length > 80) return { error: 'Group name is too long (max 80 characters)' };
  // (a season without categories has groups without a category only; a season of a club may have both kinds)
  const withoutCategories = !!season && season.categories === 'OPEN';
  const open = !!season && (!!season.organisation_id || withoutCategories) && body.category === 'OPEN';
  if (withoutCategories && body.category !== 'OPEN') return { error: 'A season without categories has groups without a category (Bez kategórie)' };
  if (!BLTA_CATEGORIES.includes(body.category) && !open) return { error: 'Every group needs a category: ELITE, NEXT_GEN or NOVICE' };
  return { name, category: body.category };
}

router.post('/:id/groups', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const parsed = parseGroup(req.body, season);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (db.prepare('SELECT 1 FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(season.id, parsed.name)) {
    return res.status(409).json({ error: 'This season already has a group with that name' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM season_groups WHERE season_id = ?').get(season.id).m;
  const info = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)')
    .run(season.id, parsed.name, parsed.category, maxOrder + 1);
  res.status(201).json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(info.lastInsertRowid))));
});

router.patch('/groups/:groupId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const parsed = parseGroup({ name: req.body.name !== undefined ? req.body.name : group.name, category: req.body.category !== undefined ? req.body.category : group.category }, db.prepare('SELECT * FROM seasons WHERE id = ?').get(group.season_id));
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const clash = db.prepare('SELECT id FROM season_groups WHERE season_id = ? AND name = ? COLLATE NOCASE').get(group.season_id, parsed.name);
  if (clash && clash.id !== group.id) return res.status(409).json({ error: 'This season already has a group with that name' });
  db.prepare('UPDATE season_groups SET name = ?, category = ? WHERE id = ?').run(parsed.name, parsed.category, group.id);
  // A match must stay in a group of its own category: changing the group's category un-tags the other ones.
  db.prepare('UPDATE matches SET group_id = NULL WHERE group_id = ? AND category != ?').run(group.id, matchCategoryOf(parsed.category));
  res.json(serializeGroup(db.prepare('SELECT * FROM season_groups WHERE id = ?').get(group.id)));
});

router.delete('/groups/:groupId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) return res.status(404).json({ error: 'Group not found' });
  db.prepare('DELETE FROM season_group_members WHERE group_id = ?').run(group.id);
  db.prepare('DELETE FROM season_groups WHERE id = ?').run(group.id);
  res.json({ ok: true });
});

// ---------------- season maker: players of a group, schedule, withdrawals (admin) ----------------

const MATCH_FORMAT_DEFAULT = 'BO3_STB';

function groupOr404(req, res) {
  const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.params.groupId));
  if (!group) res.status(404).json({ error: 'Group not found' });
  return group;
}

// Which group of this season the player is already in (other than `exceptGroupId`), or null.
function otherGroupOf(seasonId, playerId, exceptGroupId) {
  return db.prepare(`
    SELECT g.id, g.name FROM season_group_members m JOIN season_groups g ON g.id = m.group_id
    WHERE g.season_id = ? AND m.player_id = ? AND g.id != ?
  `).get(seasonId, playerId, exceptGroupId) || null;
}

router.post('/groups/:groupId/members', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const groupSeason = db.prepare('SELECT league_id FROM seasons WHERE id = ?').get(group.season_id);
  const found = resolveMemberPlayer(req.body || {}, groupSeason ? groupSeason.league_id : undefined, { allowCreate: auth.isAdmin(req) });
  if (found.error) return res.status(400).json({ error: found.error });
  if (found.conflict) {
    return res.status(409).json({ error: found.conflict.code === 'SIMILAR_PLAYERS' ? 'Similar players exist — choose who you mean' : 'No such player yet — confirm to create a new one', ...found.conflict });
  }
  const { player } = found;
  if (db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, player.id)) {
    return res.status(409).json({ code: 'ALREADY_IN_GROUP', error: `${player.name} is already in this group` });
  }
  const other = otherGroupOf(group.season_id, player.id, group.id);
  if (other) return res.status(409).json({ code: 'IN_OTHER_GROUP', error: `${player.name} is already in group ${other.name} of this season` });
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_group_members WHERE group_id = ?').get(group.id).n;
  db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(group.id, player.id, next);
  res.status(201).json(serializeGroup(group));
});

// Marks whether a player of the group has paid the entry fee (shown on the season page).
router.patch('/groups/:groupId/members/:playerId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  if (!db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId)) {
    return res.status(404).json({ error: 'That player is not in this group' });
  }
  db.prepare('UPDATE season_group_members SET paid = ? WHERE group_id = ? AND player_id = ?').run(req.body && req.body.paid ? 1 : 0, group.id, playerId);
  res.json(serializeGroup(group));
});

// Removing a player (a mistake, or somebody else takes the place): the matches he has not played yet go with him, the played ones stay untouched -
// once he has played (or is playing) a match in the group he has to be withdrawn instead. The schedule of the group is then made again with the tab Rozpis (only the missing pairs).
router.delete('/groups/:groupId/members/:playerId', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  if (!db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId)) {
    return res.status(404).json({ error: 'That player is not in this group' });
  }
  const played = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE group_id = ? AND (player1_id = ? OR player2_id = ?) AND status != 'PLANNED'").get(group.id, playerId, playerId).n;
  if (played) return res.status(400).json({ error: 'This player already has played matches in the group — withdraw them instead (their unplayed matches become walkovers)' });
  const planned = db.prepare("SELECT id FROM matches WHERE group_id = ? AND (player1_id = ? OR player2_id = ?) AND status = 'PLANNED'").all(group.id, playerId, playerId);
  db.exec('BEGIN');
  try {
    planned.forEach((m) => {
      db.prepare('DELETE FROM messages WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM match_notifications WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM push_subscriptions WHERE match_id = ?').run(m.id);
      matchPhotos.removeAllForMatch(m.id);
      db.prepare('UPDATE bracket_matches SET match_id = NULL WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
    });
    db.prepare('DELETE FROM season_group_members WHERE group_id = ? AND player_id = ?').run(group.id, playerId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (planned.length) { const io = req.app.get('io'); if (io) io.emit('matches:changed', { seasonId: group.season_id, status: 'REMOVED' }); }
  res.json({ ...serializeGroup(group), removedMatches: planned.length });
});

// The player leaves mid-season: no new matches for them, and every unplayed match of theirs becomes a walkover win for
// the opponent (3 points, as in the tables). Live matches and matches against another withdrawn player are left alone.
router.post('/groups/:groupId/members/:playerId/withdraw', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  const member = db.prepare('SELECT * FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId);
  if (!member) return res.status(404).json({ error: 'That player is not in this group' });
  if (member.withdrawn_at) return res.status(400).json({ error: 'This player has already withdrawn' });
  const now = new Date().toISOString();
  let walkovers = 0;
  let skipped = 0;
  const forfeited = []; // the ids of the matches that became walkovers (they go to the ranking points and the change log below)
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE season_group_members SET withdrawn_at = ? WHERE id = ?').run(now, member.id);
    const open = db.prepare(`
      SELECT * FROM matches
      WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' AND status = 'PLANNED' AND (player1_id = ? OR player2_id = ?)
    `).all(group.id, playerId, playerId);
    open.forEach((m) => {
      const opponent = m.player1_id === playerId ? m.player2_id : m.player1_id;
      const opponentOut = db.prepare('SELECT withdrawn_at FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, opponent);
      if (opponentOut && opponentOut.withdrawn_at) { skipped += 1; return; }
      db.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ?, end_reason = 'WALKOVER', end_time = ?, updated_at = ? WHERE id = ?")
        .run(opponent, now, now, m.id);
      forfeited.push(m);
      walkovers += 1;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // The walkovers are results like any other: they add the ranking points and show up in Backend > Points log (the group table
  // change of the player and of the opponents), one row per match.
  forfeited.forEach((before) => {
    try {
      const after = db.prepare('SELECT * FROM matches WHERE id = ?').get(before.id);
      const ranking = rankingPoints.reconcile(before, after);
      try { changeLog.logMatchChange(before, after, ranking); } catch (err) { console.error('[change log]', err.message); }
    } catch (err) {
      console.error('[seasons] failed to update ranking points for a walkover:', err.message);
    }
  });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { status: 'WALKOVER' });
  res.json({ group: serializeGroup(group), walkovers, skipped });
});

// Takes a withdrawal back (it was a mistake, or the player is playing again): the player is an active member again and the walkovers that the
// withdrawal made (the matches finished as WALKOVER at the very moment of the withdrawal) are unplayed again, so the ranking points they gave
// to the opponents are taken back and the log shows it. A walkover that was recorded by hand, at another time, is left as it is.
router.post('/groups/:groupId/members/:playerId/reinstate', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const playerId = Number(req.params.playerId);
  const member = db.prepare('SELECT * FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, playerId);
  if (!member) return res.status(404).json({ error: 'That player is not in this group' });
  if (!member.withdrawn_at) return res.status(400).json({ error: 'This player has not withdrawn' });
  const undone = [];
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE season_group_members SET withdrawn_at = NULL WHERE id = ?').run(member.id);
    const walkovers = db.prepare(`
      SELECT * FROM matches
      WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' AND status = 'FINISHED' AND end_reason = 'WALKOVER' AND end_time = ?
        AND (player1_id = ? OR player2_id = ?)
    `).all(group.id, member.withdrawn_at, playerId, playerId);
    const now = new Date().toISOString();
    walkovers.forEach((m) => {
      db.prepare("UPDATE matches SET status = 'PLANNED', winner_id = NULL, end_reason = NULL, end_time = NULL, updated_at = ? WHERE id = ?").run(now, m.id);
      undone.push(m);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  undone.forEach((before) => {
    try {
      const after = db.prepare('SELECT * FROM matches WHERE id = ?').get(before.id);
      const ranking = rankingPoints.reconcile(before, after);
      try { changeLog.logMatchChange(before, after, ranking); } catch (err) { console.error('[change log]', err.message); }
    } catch (err) {
      console.error('[seasons] failed to take back the ranking points of a walkover:', err.message);
    }
  });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { status: 'PLANNED' });
  res.json({ group: serializeGroup(group), restored: undone.length });
});

// For a group that already has matches (a season made before the maker existed): take its players from the matches.
router.post('/groups/:groupId/members/import', clubTournaments.requireSeasonManager(clubTournaments.byGroupId), (req, res) => {
  const group = groupOr404(req, res);
  if (!group) return;
  const ids = db.prepare(`
    SELECT player_id FROM (
      SELECT player1_id AS player_id, MIN(id) AS first FROM matches WHERE group_id = ? GROUP BY player1_id
      UNION SELECT player2_id AS player_id, MIN(id) AS first FROM matches WHERE group_id = ? GROUP BY player2_id
    ) GROUP BY player_id ORDER BY MIN(first)
  `).all(group.id, group.id).map((r) => r.player_id);
  let added = 0;
  let inOtherGroup = 0;
  ids.forEach((id) => {
    if (db.prepare('SELECT 1 FROM season_group_members WHERE group_id = ? AND player_id = ?').get(group.id, id)) return;
    if (otherGroupOf(group.season_id, id, group.id)) { inOtherGroup += 1; return; }
    const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_group_members WHERE group_id = ?').get(group.id).n;
    db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(group.id, id, next);
    added += 1;
  });
  res.json({ group: serializeGroup(group), added, inOtherGroup });
});

// What the schedule of a group looks like and what is still missing: the matches that exist plus the ones that would be
// created. Used by the preview and by the creation itself, so they can never disagree.
function groupSchedule(group) {
  const members = groupMembers(group.id);
  const active = members.filter((m) => !m.withdrawn);
  const name = new Map(members.map((m) => [m.id, m.name]));
  const player = (id) => ({ id, name: name.get(id) || (db.prepare('SELECT name FROM players WHERE id = ?').get(id) || {}).name || '#' + id });
  const existing = db.prepare("SELECT id, round, player1_id, player2_id, status FROM matches WHERE group_id = ? AND COALESCE(stage, 'GROUP') = 'GROUP' ORDER BY COALESCE(round, 9999), id").all(group.id);
  const plan = roundRobin.planMissingMatches(
    active.map((m) => m.id),
    existing.map((m) => ({ round: m.round, p1: m.player1_id, p2: m.player2_id })),
  );
  const byRound = new Map();
  const push = (round, entry) => { if (!byRound.has(round)) byRound.set(round, []); byRound.get(round).push(entry); };
  const unassigned = [];
  existing.forEach((m) => {
    const entry = { p1: player(m.player1_id), p2: player(m.player2_id), exists: true, status: m.status };
    if (m.round) push(m.round, entry); else unassigned.push(entry);
  });
  plan.forEach((m) => push(m.round, { p1: player(m.p1), p2: player(m.p2), exists: false, status: 'PLANNED' }));
  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((round) => {
    const playing = new Set();
    byRound.get(round).forEach((m) => { playing.add(m.p1.id); playing.add(m.p2.id); });
    return { round, matches: byRound.get(round), rest: active.filter((m) => !playing.has(m.id)).map((m) => m.name) };
  });
  return { plan, rounds, unassigned, members, activeCount: active.length, existing: existing.length };
}

router.get('/:id/schedule-preview', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id);
  res.json({
    seasonId: season.id,
    groups: groups.map((g) => {
      const sch = groupSchedule(g);
      return {
        groupId: g.id, name: g.name, category: g.category,
        members: sch.members, activeCount: sch.activeCount, existing: sch.existing, toCreate: sch.plan.length,
        rounds: sch.rounds, unassigned: sch.unassigned,
      };
    }),
  });
});

// Creates the missing matches of every group of the season (or of the listed groups): planned, no date, tagged with the
// season, the group, the category and the round. Safe to run again: only pairs without a match get one.
router.post('/:id/schedule', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const format = req.body.format || MATCH_FORMAT_DEFAULT;
  if (!engine.FORMATS[format]) return res.status(400).json({ error: 'Invalid match format' });
  const only = Array.isArray(req.body.groupIds) ? new Set(req.body.groupIds.map(Number)) : null;
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id)
    .filter((g) => !only || only.has(g.id));
  const insert = db.prepare(`
    INSERT INTO matches (share_token, category, season_id, group_id, stage, round, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (?, ?, ?, ?, 'GROUP', ?, ?, ?, '', NULL, ?, 'PLANNED', ?, '[]', 1, '')
  `);
  const result = [];
  let created = 0;
  db.exec('BEGIN');
  try {
    groups.forEach((g) => {
      const sch = groupSchedule(g);
      if (sch.activeCount < 2) { result.push({ groupId: g.id, name: g.name, created: 0, skipped: 'needs at least 2 players' }); return; }
      sch.plan.forEach((m) => {
        insert.run(crypto.randomUUID(), matchCategoryOf(g.category), season.id, g.id, m.round, m.p1, m.p2, format, JSON.stringify(engine.initState(format)));
      });
      created += sch.plan.length;
      result.push({ groupId: g.id, name: g.name, created: sch.plan.length });
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const io = req.app.get('io');
  if (io && created) io.emit('matches:changed', { status: 'CREATED' });
  res.status(201).json({ created, groups: result });
});
