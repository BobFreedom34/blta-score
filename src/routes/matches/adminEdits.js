const db = require('../../db');
const { requireAdmin } = require('../../auth');
const youtube = require('../../youtube');
const router = require('./router');
const { getRowOr404, nowIso, serialize, broadcast, MATCH_STAGES, BLTA_CATEGORIES, matchCategoryOf } = require('./shared');

// Admin-only, and deliberately its own tiny route rather than a field on
// the general PATCH /:token below — this isn't something a player ever
// sets themselves (see league in db.js), only the sync-match-league skill,
// which looks it up on the match's blta.sk event page one at a time.
router.patch('/:token/league', requireAdmin, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const league = typeof req.body.league === 'string' ? req.body.league.trim() : '';
  if (!league) return res.status(400).json({ error: 'league is required' });
  if (league.length > 200) return res.status(400).json({ error: 'league is too long' });
  db.prepare('UPDATE matches SET league = ?, updated_at = ? WHERE id = ?').run(league, nowIso(), row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  res.json(serialize(updated));
});

// Admin-only: the YouTube video of the match (a live stream or a recording). Any usual YouTube address is accepted and kept as the watch address;
// an empty value takes the video away. The match page shows it embedded and the match cards get a "Live video" pill.
router.patch('/:token/video', requireAdmin, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const raw = typeof req.body.url === 'string' ? req.body.url.trim() : '';
  let stored = null;
  if (raw) {
    const id = youtube.parseVideoId(raw);
    if (!id) return res.status(400).json({ error: 'That is not a YouTube video address (for example https://www.youtube.com/watch?v=… or https://youtu.be/…)' });
    stored = youtube.watchUrl(id);
  }
  db.prepare('UPDATE matches SET video_url = ?, updated_at = ? WHERE id = ?').run(stored, nowIso(), row.id);
  res.json(broadcast(req, db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id)));
});

// Admin-only: which season and group a BLTA-league match belongs to. A group needs its season and has to be of
// the same category as the match; null clears. (Also used by the match page's admin editor.)
router.patch('/:token/season', requireAdmin, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const { seasonId, groupId, stage } = req.body;
  if (stage !== undefined && !MATCH_STAGES.includes(stage)) {
    return res.status(400).json({ error: 'Stage must be GROUP or PLAYOFF' });
  }
  const nextStage = stage !== undefined ? stage : (row.stage === 'PLAYOFF' ? 'PLAYOFF' : 'GROUP');
  if (seasonId === null && (groupId === null || groupId === undefined)) {
    db.prepare('UPDATE matches SET season_id = NULL, group_id = NULL, stage = ?, updated_at = ? WHERE id = ?').run(nextStage, nowIso(), row.id);
    return res.json(broadcast(req, db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id)));
  }
  if (!BLTA_CATEGORIES.includes(row.category)) {
    return res.status(400).json({ error: 'Seasons, groups and stages only apply to BLTA league matches (Elite, Next Gen, Novice)' });
  }
  // Only the stage was sent: leave the season and group alone.
  if (seasonId === undefined && groupId === undefined) {
    if (stage === undefined) return res.status(400).json({ error: 'Nothing to change' });
    db.prepare('UPDATE matches SET stage = ?, updated_at = ? WHERE id = ?').run(nextStage, nowIso(), row.id);
    return res.json(broadcast(req, db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id)));
  }
  let season = null;
  let group = null;
  if (groupId !== undefined && groupId !== null) {
    group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(groupId));
    if (!group) return res.status(400).json({ error: 'That group does not exist' });
    if (matchCategoryOf(group.category) !== row.category) {
      return res.status(400).json({ error: 'The group is in a different category than this match' });
    }
    season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(group.season_id);
    if (seasonId !== undefined && seasonId !== null && Number(seasonId) !== group.season_id) {
      return res.status(400).json({ error: 'That group does not belong to the selected season' });
    }
  } else if (seasonId !== undefined && seasonId !== null) {
    season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(seasonId));
    if (!season) return res.status(400).json({ error: 'That season does not exist' });
  }
  db.prepare('UPDATE matches SET season_id = ?, group_id = ?, stage = ?, updated_at = ? WHERE id = ?')
    .run(season ? season.id : null, group ? group.id : null, nextStage, nowIso(), row.id);
  res.json(broadcast(req, db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id)));
});
