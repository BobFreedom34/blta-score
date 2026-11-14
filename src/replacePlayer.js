// "Nahradiť hráča": a player who is registered for a season / tournament leaves (also after the draw) and another one takes his place: the registration (paid, category and
// seed stay), the place in a group, the slot of a bracket and every match that is not played yet. Nothing that was played is touched: a player who has played
// has to be withdrawn instead (his unplayed matches become walkovers, see routes/seasons.js).
const db = require('./db');
const nameMatch = require('./nameMatch');

// -> { ok, groups, slots, matches, pairs } | { error, status, code }
function replaceInSeason(season, reg, newPlayer, { keepContact = false } = {}) {
  const oldId = reg.player_id;
  if (oldId && oldId === newPlayer.id) return { status: 400, error: 'Choose a different player' };
  const already = db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ? AND id != ?').all(season.id, reg.id)
    .some((r) => r.player_id === newPlayer.id || nameMatch.key(r.name) === nameMatch.key(newPlayer.name));
  if (already) return { status: 409, code: 'ALREADY_REGISTERED', error: `${newPlayer.name} is already registered for this tournament` };

  if (oldId) {
    const played = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND (player1_id = ? OR player2_id = ?) AND status != 'PLANNED'").get(season.id, oldId, oldId).n;
    if (played) return { status: 400, code: 'HAS_PLAYED', error: 'This player has already played (or is playing) a match — withdraw them instead (their unplayed matches become walkovers)' };
    const decided = db.prepare(`
      SELECT COUNT(*) AS n FROM bracket_matches bm JOIN brackets b ON b.id = bm.bracket_id
      WHERE b.season_id = ? AND (bm.player1_id = ? OR bm.player2_id = ?) AND bm.manual_winner_id IS NOT NULL
    `).get(season.id, oldId, oldId).n;
    if (decided) return { status: 400, code: 'HAS_PLAYED', error: 'This player already has a result in the bracket — withdraw them instead' };
    const inGroup = db.prepare('SELECT 1 FROM season_group_members m JOIN season_groups g ON g.id = m.group_id WHERE g.season_id = ? AND m.player_id = ? LIMIT 1');
    if (inGroup.get(season.id, newPlayer.id)) return { status: 409, code: 'IN_GROUP', error: `${newPlayer.name} is already in a group of this season` };
  }

  const counts = { groups: 0, slots: 0, matches: 0, pairs: 0 };
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE season_registrations SET player_id = ?, name = ?, phone = ?, email = ?, reminded_at = NULL WHERE id = ?")
      .run(newPlayer.id, newPlayer.name, keepContact ? String(newPlayer.phone || '') : '', keepContact ? String(newPlayer.email || '') : '', reg.id);
    if (oldId) {
      counts.groups = db.prepare('UPDATE season_group_members SET player_id = ? WHERE player_id = ? AND group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(newPlayer.id, oldId, season.id).changes;
      counts.matches += db.prepare("UPDATE matches SET player1_id = ? WHERE season_id = ? AND player1_id = ? AND status = 'PLANNED'").run(newPlayer.id, season.id, oldId).changes;
      counts.matches += db.prepare("UPDATE matches SET player2_id = ? WHERE season_id = ? AND player2_id = ? AND status = 'PLANNED'").run(newPlayer.id, season.id, oldId).changes;
      const brackets = db.prepare('SELECT id FROM brackets WHERE season_id = ?').all(season.id).map((b) => b.id);
      brackets.forEach((bid) => {
        counts.slots += db.prepare('UPDATE bracket_matches SET player1_id = ? WHERE bracket_id = ? AND player1_id = ?').run(newPlayer.id, bid, oldId).changes;
        counts.slots += db.prepare('UPDATE bracket_matches SET player2_id = ? WHERE bracket_id = ? AND player2_id = ?').run(newPlayer.id, bid, oldId).changes;
        db.prepare('UPDATE bracket_partners SET player_id = ? WHERE bracket_id = ? AND player_id = ?').run(newPlayer.id, bid, oldId);
        db.prepare('UPDATE bracket_partners SET partner_id = ? WHERE bracket_id = ? AND partner_id = ?').run(newPlayer.id, bid, oldId);
      });
      counts.pairs = db.prepare('UPDATE tournament_pairs SET player_id = ? WHERE season_id = ? AND player_id = ?').run(newPlayer.id, season.id, oldId).changes
        + db.prepare('UPDATE tournament_pairs SET partner_id = ? WHERE season_id = ? AND partner_id = ?').run(newPlayer.id, season.id, oldId).changes;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, ...counts };
}

module.exports = { replaceInSeason };
