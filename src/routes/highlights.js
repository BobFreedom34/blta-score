// "Hráč mesiaca" on the home page: GET /api/highlights/month — the player of the LAST FULL month and the player with the biggest courtIQ
// progress in it. Worked out from what the app already has (finished BLTA matches, the BLTA points ledger, the courtIQ history); nothing is
// entered by hand. HIGHLIGHTS_NOW ('YYYY-MM-DD') fixes the date for the checks.
const express = require('express');
const db = require('../db');
const { ratingToBand } = require('../courtIQEngine');

const router = express.Router();

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const MIN_MATCHES = 2; // a month of one lucky match is not a month

function today() {
  const fixed = process.env.HIGHLIGHTS_NOW;
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // YYYY-MM-DD
}

// the last full calendar month before `day`: { month: '2026-09', from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }
function lastMonth(day) {
  let y = Number(day.slice(0, 4));
  let m = Number(day.slice(5, 7)) - 1; // the month before
  if (m === 0) { m = 12; y -= 1; }
  const pad = (n) => String(n).padStart(2, '0');
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { month: `${y}-${pad(m)}`, from: `${y}-${pad(m)}-01T00:00:00.000Z`, to: `${ny}-${pad(nm)}-01T00:00:00.000Z` };
}

router.get('/month', (req, res) => {
  const range = lastMonth(today());
  const matches = db.prepare(`
    SELECT id, player1_id, player2_id, winner_id, COALESCE(scheduled_at, start_time, created_at) AS d
    FROM matches
    WHERE status = 'FINISHED' AND winner_id IS NOT NULL AND category IN (${BLTA_CATEGORIES.map(() => '?').join(',')})
      AND COALESCE(scheduled_at, start_time, created_at) >= ? AND COALESCE(scheduled_at, start_time, created_at) < ?
    ORDER BY d, id
  `).all(...BLTA_CATEGORIES, range.from, range.to);

  // wins, matches and the longest run of wins of every player in the month
  const stats = new Map();
  const of = (id) => { if (!stats.has(id)) stats.set(id, { id, played: 0, wins: 0, run: 0, streak: 0, points: 0 }); return stats.get(id); };
  matches.forEach((m) => {
    [m.player1_id, m.player2_id].forEach((id) => {
      const s = of(id);
      s.played += 1;
      if (m.winner_id === id) { s.wins += 1; s.run += 1; s.streak = Math.max(s.streak, s.run); } else s.run = 0;
    });
  });
  if (matches.length) {
    const ids = matches.map((m) => m.id);
    db.prepare(`
      SELECT e.player_id AS pid, SUM(a.points) AS pts
      FROM ranking_awards a JOIN ranking_entries e ON e.id = a.entry_id
      WHERE e.table_key = 'blta' AND e.player_id IS NOT NULL AND a.match_id IN (${ids.map(() => '?').join(',')})
      GROUP BY e.player_id
    `).all(...ids).forEach((r) => { if (stats.has(r.pid)) stats.get(r.pid).points = r.pts || 0; });
  }

  const info = db.prepare('SELECT id, name, slug, category, photo_url FROM players WHERE id = ? AND hidden = 0');
  const ready = [...stats.values()].filter((s) => s.played >= MIN_MATCHES && s.wins >= 1 && info.get(s.id));
  ready.sort((a, b) => b.points - a.points || b.wins - a.wins || (b.wins / b.played) - (a.wins / a.played) || b.played - a.played || a.id - b.id);
  const best = ready[0] || null;
  if (!best) return res.json({ month: range.month, player: null, improved: null });
  const bestInfo = info.get(best.id);

  // the biggest courtIQ progress: the band at the end of the month against the band just before it (needs a rating from before)
  const ratingAt = db.prepare(`
    SELECT h.rating FROM courtiq_rating_history h JOIN matches m ON m.id = h.match_id
    WHERE h.player_id = ? AND COALESCE(m.scheduled_at, m.start_time, m.created_at) < ?
    ORDER BY COALESCE(m.scheduled_at, m.start_time, m.created_at) DESC, h.id DESC LIMIT 1
  `);
  const progress = [];
  stats.forEach((s) => {
    if (s.played < MIN_MATCHES || !info.get(s.id)) return;
    const before = ratingAt.get(s.id, range.from);
    const after = ratingAt.get(s.id, range.to);
    if (!before || !after) return;
    const from = Number(ratingToBand(before.rating).toFixed(1));
    const to = Number(ratingToBand(after.rating).toFixed(1));
    const delta = Number((to - from).toFixed(1));
    if (delta > 0) progress.push({ id: s.id, from, to, delta, played: s.played });
  });
  progress.sort((a, b) => b.delta - a.delta || b.played - a.played || a.id - b.id);
  const pick = progress.find((p) => p.id !== best.id) || null; // somebody other than the player of the month, when there is one
  const improvedInfo = pick ? info.get(pick.id) : null;

  res.json({
    month: range.month,
    player: { id: bestInfo.id, name: bestInfo.name, slug: bestInfo.slug, category: bestInfo.category, photoUrl: bestInfo.photo_url || '', wins: best.wins, played: best.played, points: best.points, streak: best.streak },
    improved: pick ? { id: improvedInfo.id, name: improvedInfo.name, slug: improvedInfo.slug, from: pick.from, to: pick.to, delta: pick.delta, played: pick.played } : null,
  });
});

module.exports = router;
module.exports.lastMonth = lastMonth;
