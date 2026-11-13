// The defence of the points (Propozície > Obhajoba bodov): the points of the overall BLTA table are valid 52 weeks.
//   - every point that is in the BLTA table sits in the list ranking_expiry as an item with the DATE of what earned it: a league match (its own
//     date), a tournament or a placement bonus (the date of the event, added by the admin with a date, see addDated);
//   - every Monday (lazily: with the first request of the rankings that day or later) the items that are at least 52 weeks old are taken off
//     the table, BEFORE the weekly "you moved N places" message is worked out (routes/rankings.js buildRankings calls applyDue first), and
//     every player whose points went down gets a row in Backend > Points log (kind DEFENCE);
//   - a match that is corrected or deleted takes its item back; if the item was already taken off the table nothing is taken twice.
// The Race tables are not defended (they start from zero every year). The number of matches is not touched.
const fs = require('fs');
const path = require('path');
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_expiry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    match_id INTEGER,
    points INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    applied_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ranking_expiry_due ON ranking_expiry(applied_at, event_date);
  CREATE INDEX IF NOT EXISTS idx_ranking_expiry_match ON ranking_expiry(match_id);
`);

const TABLE_KEY = 'blta';
const WINDOW_DAYS = 364; // 52 weeks
const KINDS = ['MATCH', 'PLAYOFF', 'BONUS', 'TOURNAMENT', 'OTHER'];

const isoDay = (d) => d.toISOString().slice(0, 10);

// Monday (UTC) of the week of `date`
function mondayOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1) - day);
  return isoDay(d);
}

// What is at least 52 weeks old on the Monday of this week (event_date <= the returned day) is due.
function cutoffFor(now = new Date()) {
  const d = new Date(`${mondayOf(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - WINDOW_DAYS);
  return isoDay(d);
}

// The day a match counts for: the day it was played / planned, as the rest of the app reads it
function dateOfMatch(matchId) {
  const m = db.prepare('SELECT scheduled_at, end_time, created_at FROM matches WHERE id = ?').get(matchId);
  const raw = m ? (m.scheduled_at || m.end_time || m.created_at || '') : '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : isoDay(new Date());
}

// ---------------------------------------------------------------- the list
function addItem({ entryId, kind = 'OTHER', matchId = null, points, date, label = '', applied = false }) {
  if (!Number.isInteger(points) || points <= 0) return null; // nothing to take off later
  if (!KINDS.includes(kind)) throw new Error(`Unknown kind ${kind}`);
  const info = db.prepare("INSERT INTO ranking_expiry (entry_id, kind, match_id, points, event_date, label, applied_at) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END)")
    .run(entryId, kind, matchId, points, date, label, applied ? 1 : 0);
  return Number(info.lastInsertRowid);
}

// A league match earned `points` for an entry of the BLTA table (called from rankingPoints.recordAwards)
function addForMatch(matchId, entryId, points) {
  return addItem({ entryId, kind: 'MATCH', matchId, points, date: dateOfMatch(matchId), label: '' });
}

function removeForMatch(matchId) {
  db.prepare('DELETE FROM ranking_expiry WHERE match_id = ?').run(matchId);
}

// Was the points of this match already taken off this entry by the defence? (then taking the match back must not take them again)
function isApplied(matchId, entryId) {
  return !!db.prepare('SELECT 1 FROM ranking_expiry WHERE match_id = ? AND entry_id = ? AND applied_at IS NOT NULL LIMIT 1').get(matchId, entryId);
}

// ---------------------------------------------------------------- the Monday step
// Takes off every item that is due and not yet taken off; writes the Points log. Safe to call any number of times: it does the work once.
function applyDue(now = new Date()) {
  const cutoff = cutoffFor(now);
  if (!db.prepare('SELECT 1 FROM ranking_expiry WHERE applied_at IS NULL AND event_date <= ? LIMIT 1').get(cutoff)) return { items: 0, players: 0 };
  const items = db.prepare('SELECT * FROM ranking_expiry WHERE applied_at IS NULL AND event_date <= ? ORDER BY event_date, id').all(cutoff);
  const byEntry = new Map();
  items.forEach((i) => byEntry.set(i.entry_id, [...(byEntry.get(i.entry_id) || []), i]));
  const changes = [];
  db.exec('BEGIN');
  try {
    byEntry.forEach((list, entryId) => {
      const entry = db.prepare('SELECT * FROM ranking_entries WHERE id = ?').get(entryId);
      const take = list.reduce((sum, i) => sum + i.points, 0);
      if (entry) {
        const before = entry.points === null ? 0 : entry.points;
        const after = Math.max(0, before - take);
        db.prepare("UPDATE ranking_entries SET points = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(after, entryId);
        changes.push({ entry, before, after, list });
      }
      list.forEach((i) => db.prepare("UPDATE ranking_expiry SET applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(i.id));
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  try {
    const changeLog = require('./changeLog');
    changes.forEach((c) => {
      const named = c.list.map((i) => {
        const m = i.match_id ? db.prepare('SELECT p1.name AS a, p2.name AS b FROM matches m JOIN players p1 ON p1.id = m.player1_id JOIN players p2 ON p2.id = m.player2_id WHERE m.id = ?').get(i.match_id) : null;
        return { date: i.event_date, points: i.points, what: i.label || (m ? `${m.a} – ${m.b}` : i.kind) };
      });
      changeLog.logDefence({ tableKey: TABLE_KEY, tableLabel: 'BLTA', name: c.entry.name, before: c.before, after: c.after, expired: named });
    });
  } catch (err) { console.error('[defence] points log:', err.message); }
  return { items: items.length, players: changes.length };
}

// ---------------------------------------------------------------- the admin's dated points (a tournament, a bonus)
// Adds `points` to the BLTA table for a player and remembers the date, so that they leave the table 52 weeks later. Returns { ok, ... } | { error }.
// alreadyCounted: the points are in the table already (a match counted before the defence existed): only the item is made, the points are not added again.
function addDated({ name, points, date, kind, label, alreadyCounted = false, now = new Date() }) {
  if (!Number.isInteger(points) || points <= 0) return { error: 'Points must be a whole number above 0' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { error: 'The date of the event is required (2026-11-15)' };
  if (!['BONUS', 'TOURNAMENT', 'OTHER'].includes(kind)) return { error: 'Kind must be BONUS, TOURNAMENT or OTHER' };
  const rankingPoints = require('./rankingPoints');
  const players = db.prepare('SELECT id, name FROM players').all();
  const key = rankingPoints.normalizeName(name);
  const player = players.find((p) => rankingPoints.normalizeName(p.name) === key);
  if (!player) return { error: 'No player with that name — add the player first' };
  return rankingPoints.inTransaction(() => {
    const entry = rankingPoints.entryFor(TABLE_KEY, player.id, true);
    const before = entry.points === null ? 0 : entry.points;
    const already = date <= cutoffFor(now); // older than 52 weeks: it would go off at once, so it is not added at all
    if (already) return { error: 'That event is already older than 52 weeks: its points would be taken off at once' };
    if (!alreadyCounted) db.prepare("UPDATE ranking_entries SET points = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(before + points, entry.id);
    addItem({ entryId: entry.id, kind, points, date, label: String(label || '').trim().slice(0, 120) });
    return { ok: true, name: player.name, before, after: alreadyCounted ? before : before + points, expiresAfter: date };
  });
}

// ---------------------------------------------------------------- what is coming off
// The next Mondays with the points that will leave the table: [{ monday, items, points, players: [{ name, points }] }]
function upcoming(weeks = 8, now = new Date()) {
  const out = [];
  const start = new Date(`${mondayOf(now)}T00:00:00Z`);
  for (let w = 0; w < weeks; w += 1) {
    const monday = new Date(start);
    monday.setUTCDate(monday.getUTCDate() + 7 * w);
    const cutoff = new Date(monday);
    cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
    const prev = new Date(cutoff);
    prev.setUTCDate(prev.getUTCDate() - 7);
    const rows = db.prepare(`
      SELECT e.name AS name, SUM(x.points) AS points, COUNT(*) AS items
      FROM ranking_expiry x JOIN ranking_entries e ON e.id = x.entry_id
      WHERE x.applied_at IS NULL AND x.event_date <= ? ${w === 0 ? '' : 'AND x.event_date > ?'}
      GROUP BY x.entry_id ORDER BY points DESC
    `).all(...(w === 0 ? [isoDay(cutoff)] : [isoDay(cutoff), isoDay(prev)]));
    out.push({ monday: isoDay(monday), items: rows.reduce((a, r) => a + r.items, 0), points: rows.reduce((a, r) => a + r.points, 0), players: rows.map((r) => ({ name: r.name, points: r.points })) });
  }
  return out;
}

// A check: the points in the table that no dated item stands behind (they would never go off), and the items that are more than the points.
// [{ name, points, items, difference }] for the players where they differ
function unaccounted() {
  return db.prepare(`
    SELECT e.name AS name, COALESCE(e.points, 0) AS pts, COALESCE(SUM(CASE WHEN x.applied_at IS NULL THEN x.points END), 0) AS item_sum
    FROM ranking_entries e LEFT JOIN ranking_expiry x ON x.entry_id = e.id
    WHERE e.table_key = ? GROUP BY e.id HAVING pts != item_sum ORDER BY ABS(pts - item_sum) DESC
  `).all(TABLE_KEY).map((r) => ({ name: r.name, points: r.pts, items: r.item_sum, difference: r.pts - r.item_sum }));
}

// What one player is going to lose and when: [{ date, expires, points, kind, label }]
function forPlayer(playerId) {
  const rows = db.prepare(`
    SELECT x.event_date, x.points, x.kind, x.label, x.match_id
    FROM ranking_expiry x JOIN ranking_entries e ON e.id = x.entry_id
    WHERE e.table_key = ? AND e.player_id = ? AND x.applied_at IS NULL ORDER BY x.event_date, x.id
  `).all(TABLE_KEY, playerId);
  return rows.map((r) => {
    const d = new Date(`${r.event_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + WINDOW_DAYS);
    return { date: r.event_date, expires: mondayOnOrAfter(isoDay(d)), points: r.points, kind: r.kind, label: r.label };
  });
}
function mondayOnOrAfter(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow !== 1) d.setUTCDate(d.getUTCDate() + ((8 - dow) % 7));
  return isoDay(d);
}

// ---------------------------------------------------------------- the first start: the items of the points that are in the table today
// src/rankingExpirySeed.json: [kind, ref, name, points, date, label] - ref is the token of a match (kind MATCH). Runs once (app_flags).
function seed() {
  if (db.prepare("SELECT 1 FROM app_flags WHERE key = 'ranking_expiry_seed'").get()) return { skipped: true };
  const file = path.join(__dirname, 'rankingExpirySeed.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const norm = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['‘’]/g, '').replace(/\s+/g, ' ').trim();
  const entries = new Map(db.prepare("SELECT id, name_key FROM ranking_entries WHERE table_key = ?").all(TABLE_KEY).map((e) => [e.name_key, e.id]));
  let added = 0; let skipped = 0;
  db.exec('BEGIN');
  try {
    list.forEach(([kind, ref, name, points, date, label]) => {
      const entryId = entries.get(norm(name)) || (db.prepare('SELECT e.id FROM ranking_entries e JOIN players p ON p.id = e.player_id WHERE e.table_key = ? AND lower(p.name) = lower(?)').get(TABLE_KEY, name) || {}).id;
      if (!entryId) { skipped += 1; return; }
      let matchId = null;
      if (kind === 'MATCH') {
        const m = db.prepare('SELECT id FROM matches WHERE share_token = ?').get(ref);
        if (!m) { skipped += 1; return; }
        matchId = m.id;
      }
      if (addItem({ entryId, kind, matchId, points, date, label })) added += 1;
    });
    db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('ranking_expiry_seed')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[defence] ${added} dated items of the BLTA points (${skipped} left out: no row or no match here)`);
  return { added, skipped };
}

module.exports = { WINDOW_DAYS, TABLE_KEY, mondayOf, cutoffFor, addItem, addForMatch, removeForMatch, isApplied, applyDue, addDated, upcoming, unaccounted, forPlayer, seed };
