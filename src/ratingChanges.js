// What one finished match did to the level of its players, for the card "Zmeny úrovne" of the match page. A singles match moved the CourtIQ
// of both players (the rating AFTER the match is stored per match in courtiq_rating_history, the one before it is the previous row of the same
// player); a doubles match moved the doubles rating of all four (worked out by replaying the matches, see src/doubles.js). The change is shown
// on the 1.0-7.0 level scale of the site, two decimals.
const db = require('./db');
const courtIQ = require('./courtIQEngine');
const doubles = require('./doubles');

const levelChange = (before, after) => Math.round((courtIQ.ratingToBand(after) - courtIQ.ratingToBand(before)) * 100) / 100;

function playerOf(id) {
  return db.prepare('SELECT id, name, slug FROM players WHERE id = ?').get(id) || null;
}

// { kind: 'COURTIQ' | 'DOUBLES', players: [{ id, name, slug, side, change, level }] } - players empty when the match moved nobody's level
function forMatch(row) {
  if (row.status !== 'FINISHED') return { kind: row.is_doubles ? 'DOUBLES' : 'COURTIQ', players: [] };

  if (row.is_doubles) {
    const sideOf = (id) => (id === row.player1_id || id === row.player1b_id ? 1 : 2);
    const players = doubles.matchRatingChanges(row).map((c) => {
      const p = playerOf(c.id);
      return p && { id: p.id, name: p.name, slug: p.slug, side: sideOf(c.id), change: levelChange(c.before, c.after), level: Number(courtIQ.ratingToBand(c.after).toFixed(1)) };
    }).filter(Boolean);
    players.sort((a, b) => a.side - b.side);
    return { kind: 'DOUBLES', players };
  }

  const players = [row.player1_id, row.player2_id].map((id, i) => {
    const now = db.prepare('SELECT id, rating FROM courtiq_rating_history WHERE player_id = ? AND match_id = ?').get(id, row.id);
    const p = playerOf(id);
    if (!now || !p) return null;
    const was = db.prepare('SELECT rating FROM courtiq_rating_history WHERE player_id = ? AND id < ? ORDER BY id DESC LIMIT 1').get(id, now.id);
    const before = was ? was.rating : courtIQ.DEFAULT_RATING;
    return { id: p.id, name: p.name, slug: p.slug, side: i + 1, change: levelChange(before, now.rating), level: Number(courtIQ.ratingToBand(now.rating).toFixed(1)) };
  }).filter(Boolean);
  return { kind: 'COURTIQ', players };
}

module.exports = { forMatch };
