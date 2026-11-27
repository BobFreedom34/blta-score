// "Krok späť" in the court schedule of a tournament: before every change the organiser makes there (a match moved, put in between, taken off, made
// longer, locked or unlocked, the planner run) the places of all matches of the tournament are kept; undo puts the last kept places back.
// The last 30 steps of each tournament are kept (in the database, so a restart of the server does not lose them).
// A match that started or ended since (its status changed) is left as it is: only the places are put back, never a result.
const db = require('./db');

const KEEP = 30;

db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_undo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_undo_season ON schedule_undo(season_id, id);
`);

const COLUMNS = ['court_no', 'scheduled_at', 'slot_locked', 'duration_minutes', 'manual_block', 'location'];

// keeps the places of every match of the season now -> the id of the step (to drop it again when the change was refused)
function snapshot(seasonId, label = '') {
  const rows = db.prepare(`SELECT id, status, ${COLUMNS.join(', ')} FROM matches WHERE season_id = ?`).all(seasonId);
  const id = Number(db.prepare('INSERT INTO schedule_undo (season_id, label, data) VALUES (?, ?, ?)').run(seasonId, String(label).slice(0, 80), JSON.stringify(rows)).lastInsertRowid);
  db.prepare('DELETE FROM schedule_undo WHERE season_id = ? AND id NOT IN (SELECT id FROM schedule_undo WHERE season_id = ? ORDER BY id DESC LIMIT ?)').run(seasonId, seasonId, KEEP);
  return id;
}

// a change that was refused (or changed nothing) leaves no step behind
function drop(stepId) {
  if (stepId) db.prepare('DELETE FROM schedule_undo WHERE id = ?').run(stepId);
}

const count = (seasonId) => db.prepare('SELECT COUNT(*) AS n FROM schedule_undo WHERE season_id = ?').get(seasonId).n;

// puts the last kept places back and forgets that step -> { label } or null when there is nothing to undo
function undo(seasonId) {
  const step = db.prepare('SELECT * FROM schedule_undo WHERE season_id = ? ORDER BY id DESC LIMIT 1').get(seasonId);
  if (!step) return null;
  const rows = JSON.parse(step.data);
  const update = db.prepare(`UPDATE matches SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND season_id = ? AND status = ?`);
  db.exec('BEGIN');
  try {
    rows.forEach((r) => update.run(...COLUMNS.map((c) => r[c]), r.id, seasonId, r.status));
    db.prepare('DELETE FROM schedule_undo WHERE id = ?').run(step.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { label: step.label };
}

module.exports = { snapshot, drop, undo, count, KEEP };
