// One-off: the walkovers that a withdrawal made in the Slazenger group (Miroslav Špaček) before the withdrawal wrote the ranking points and the
// Points log. Runs once (flag in app_flags), at the first start after this change: every finished walkover of that group whose loser has withdrawn and
// which has no ranking points yet gets them now (a walkover is a clean 2:0: 3 base points x the level, so 21 in Next Gen), and a row in Backend >
// Points log. Matches that already have points are not touched, so running it again would change nothing. When no such group exists yet (the name
// is different, or the data is not there) no flag is written and the next start tries again.
const FLAG = 'withdraw_walkover_points_slazenger';

function catchUp(db) {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(FLAG)) return { skipped: true };
  const rankingPoints = require('./rankingPoints');
  const changeLog = require('./changeLog');
  const groups = db.prepare("SELECT id, name FROM season_groups WHERE lower(name) LIKE '%slazenger%'").all();
  if (!groups.length) return { groups: 0, fixed: 0 };
  let fixed = 0;
  groups.forEach((g) => {
    const rows = db.prepare(`
      SELECT m.* FROM matches m
      WHERE m.group_id = ? AND COALESCE(m.stage, 'GROUP') = 'GROUP' AND m.status = 'FINISHED' AND m.end_reason = 'WALKOVER' AND m.winner_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ranking_awards a WHERE a.match_id = m.id)
        AND EXISTS (
          SELECT 1 FROM season_group_members s
          WHERE s.group_id = m.group_id AND s.withdrawn_at IS NOT NULL AND s.player_id = (CASE WHEN m.winner_id = m.player1_id THEN m.player2_id ELSE m.player1_id END)
        )
    `).all(g.id);
    rows.forEach((row) => {
      try {
        const before = { ...row, status: 'PLANNED', winner_id: null, end_reason: null };
        const ranking = rankingPoints.reconcile(before, row);
        try { changeLog.logMatchChange(before, row, ranking); } catch (err) { console.error('[withdraw catch-up] change log:', err.message); }
        fixed += 1;
      } catch (err) {
        console.error('[withdraw catch-up] match', row.id, err.message);
      }
    });
  });
  db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(FLAG);
  return { groups: groups.length, fixed };
}

module.exports = { catchUp, FLAG };
