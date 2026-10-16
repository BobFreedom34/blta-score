// The court schedule of a tournament: which match is played on which court ("Kurt 1" … "Kurt n") and when.
// The organiser can put a match on a court at a time by hand (placeMatch — it is then "locked": the planner never moves it); the
// planner (autoPlan) places every match that has two players but no time yet, in the order the tournament needs them (earlier rounds
// first), each at the earliest time a court is free AND both players have had their rest since their last match — so a player is
// never put on court twice at once and nobody waits longer than the courts force them to. Real finished times count: a match that
// ended late pushes the next match of its players later. Times are stored in matches.scheduled_at (ISO, UTC); the playing day
// (day_start–day_end) is Bratislava time.
const db = require('./db');
const engine = require('./matchEngine');

const TZ = 'Europe/Bratislava';
const GRID_MIN = 15; // start times are on a 15-minute grid from the start of the playing day
const MAX_DAYS = 14;
const MIN = 60 * 1000;

// ---------- time ----------

function tzOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs) / MIN);
}

// "2026-05-01" + "09:00" in Bratislava -> UTC milliseconds
function localToUtcMs(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMinutes(guess) * MIN;
  return guess - tzOffsetMinutes(first) * MIN;
}

function daysOf(season) {
  if (!season.start_date) return [];
  const out = [];
  const end = season.end_date && season.end_date >= season.start_date ? season.end_date : season.start_date;
  const cur = new Date(`${season.start_date}T12:00:00Z`);
  while (out.length < MAX_DAYS) {
    const day = cur.toISOString().slice(0, 10);
    if (day > end) break;
    out.push(day);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// the day (Bratislava) an instant falls on, "2026-05-01"
function dayOf(utcMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(utcMs));
}

const validTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function settingsOf(season) {
  return {
    courtCount: season.court_count || 0,
    matchMinutes: season.match_minutes || 90,
    dayStart: validTime(season.day_start) ? season.day_start : '09:00',
    dayEnd: validTime(season.day_end) ? season.day_end : '20:00',
    restMinutes: season.rest_minutes === null || season.rest_minutes === undefined ? 30 : season.rest_minutes,
    autoSchedule: season.auto_schedule === 0 ? false : true,
    maxPerDay: season.max_matches_per_day || 0,
    days: daysOf(season),
    timezone: TZ,
  };
}

// validates and stores { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule, maxPerDay }; returns { error } or { ok }
function saveSettings(season, body) {
  const s = settingsOf(season);
  const next = { ...s };
  if (body.matchMinutes !== undefined) {
    next.matchMinutes = Number(body.matchMinutes);
    if (!Number.isInteger(next.matchMinutes) || next.matchMinutes < 15 || next.matchMinutes > 300) return { error: 'The length of a match must be 15 to 300 minutes' };
  }
  if (body.dayStart !== undefined) {
    if (!validTime(body.dayStart)) return { error: 'The start of the playing day must look like 09:00' };
    next.dayStart = body.dayStart;
  }
  if (body.dayEnd !== undefined) {
    if (!validTime(body.dayEnd)) return { error: 'The end of the playing day must look like 20:00' };
    next.dayEnd = body.dayEnd;
  }
  if (next.dayStart >= next.dayEnd) return { error: 'The playing day must end after it starts' };
  if (body.restMinutes !== undefined) {
    next.restMinutes = Number(body.restMinutes);
    if (!Number.isInteger(next.restMinutes) || next.restMinutes < 0 || next.restMinutes > 240) return { error: 'The rest between matches must be 0 to 240 minutes' };
  }
  if (body.autoSchedule !== undefined) next.autoSchedule = !!body.autoSchedule;
  if (body.maxPerDay !== undefined) {
    next.maxPerDay = Number(body.maxPerDay);
    if (!Number.isInteger(next.maxPerDay) || next.maxPerDay < 0 || next.maxPerDay > 10) return { error: 'The most matches a player may play in a day must be 0 (no limit) to 10' };
  }
  if ((toMinutes(next.dayEnd) - toMinutes(next.dayStart)) < next.matchMinutes) return { error: 'The playing day is shorter than one match' };
  db.prepare('UPDATE seasons SET match_minutes = ?, day_start = ?, day_end = ?, rest_minutes = ?, auto_schedule = ?, max_matches_per_day = ? WHERE id = ?')
    .run(next.matchMinutes, next.dayStart, next.dayEnd, next.restMinutes, next.autoSchedule ? 1 : 0, next.maxPerDay, season.id);
  return { ok: true };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------- reading ----------

function loadMatches(seasonId) {
  return db.prepare(`
    SELECT m.*, bm.round AS b_round, bm.position AS b_position, b.id AS bracket_id, b.name AS bracket_name, b.kind AS bracket_kind, b.size AS bracket_size,
           p1.name AS p1_name, p1.slug AS p1_slug, p2.name AS p2_name, p2.slug AS p2_slug
    FROM matches m
    LEFT JOIN bracket_matches bm ON bm.match_id = m.id
    LEFT JOIN brackets b ON b.id = bm.bracket_id
    LEFT JOIN players p1 ON p1.id = m.player1_id
    LEFT JOIN players p2 ON p2.id = m.player2_id
    WHERE m.season_id = ?
    ORDER BY m.id
  `).all(seasonId);
}

const ms = (iso) => {
  const n = Date.parse(iso || '');
  return Number.isNaN(n) ? null : n;
};

// the length of a match in ms: the organiser's own length for this match, else the tournament's
function durationOf(row, settings) {
  return (row.duration_minutes || settings.matchMinutes) * MIN;
}

// [start, end] in ms a match takes on its court (and its players): planned = start + its length, live = until it ends (at least now +
// a quarter of an hour), finished = from its real start to its real end — a match that ended early frees the court from then on (when
// the real end is not known, e.g. a result entered by hand, start + its length); null when it has no time at all
function intervalOf(row, settings, now) {
  const duration = durationOf(row, settings);
  const scheduled = ms(row.scheduled_at);
  const realStart = ms(row.start_time);
  if (row.status === 'FINISHED') {
    const start = realStart ?? scheduled;
    if (start === null) return null;
    const end = ms(row.end_time);
    return [start, end !== null && end > start ? end : start + duration];
  }
  const start = scheduled ?? realStart;
  if (start === null) return null;
  if (row.status === 'LIVE') return [start, Math.max(start + duration, now + 15 * MIN)];
  return [start, start + duration];
}

function serializeMatch(row, settings, now) {
  const interval = intervalOf(row, settings, now);
  let scoreSummary = null;
  if (row.status === 'FINISHED' || row.status === 'LIVE') {
    try { scoreSummary = engine.describeMatch(JSON.parse(row.state)); } catch { scoreSummary = null; }
  }
  return {
    token: row.share_token,
    status: row.status,
    category: row.category,
    bracket: row.bracket_id ? { id: row.bracket_id, name: row.bracket_name, kind: row.bracket_kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN' } : null,
    round: row.b_round || null,
    rounds: row.bracket_size ? Math.log2(row.bracket_size) : null,
    player1: { id: row.player1_id, name: row.p1_name, slug: row.p1_slug },
    player2: { id: row.player2_id, name: row.p2_name, slug: row.p2_slug },
    winnerId: row.winner_id || null,
    scoreSummary,
    scheduledAt: row.scheduled_at || null,
    // where the block of the match is drawn: a finished match from its real start to its real end
    blockStart: interval ? new Date(interval[0]).toISOString() : null,
    endsAt: interval ? new Date(interval[1]).toISOString() : null,
    durationMinutes: row.duration_minutes || null,
    // a finished match whose real end is known cannot be given another length
    endKnown: row.status === 'FINISHED' && ms(row.end_time) !== null && ms(row.end_time) > (ms(row.start_time) ?? ms(row.scheduled_at) ?? Infinity),
    courtNo: row.court_no || null,
    locked: !!row.slot_locked,
  };
}

// everything the schedule tab shows
function getSchedule(season, now = Date.now()) {
  const settings = settingsOf(season);
  const rows = loadMatches(season.id).filter((r) => r.player1_id && r.player2_id);
  const matches = rows.map((r) => serializeMatch(r, settings, now));
  return {
    seasonId: season.id,
    settings,
    matches,
    // planned matches with no time yet: waiting for the planner or for the organiser to drag them onto a court
    unscheduledCount: matches.filter((m) => m.status === 'PLANNED' && !m.scheduledAt).length,
  };
}

// ---------- placing by hand ----------

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

// Puts a planned match on a court at a time (court null = take it off the schedule). Returns { error, status } or { warnings }.
function placeMatch(season, token, courtNo, scheduledAt, now = Date.now()) {
  const settings = settingsOf(season);
  const match = db.prepare('SELECT * FROM matches WHERE share_token = ? AND season_id = ?').get(token, season.id);
  if (!match) return { status: 404, error: 'Match not found in this tournament' };
  if (match.status !== 'PLANNED') return { status: 409, error: 'Only a match that has not started can be moved' };
  if (courtNo === null) {
    db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, slot_locked = 0, location = CASE WHEN location LIKE 'Kurt %' THEN '' ELSE location END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(match.id);
    return { warnings: [] };
  }
  if (!Number.isInteger(courtNo) || courtNo < 1 || courtNo > settings.courtCount) return { status: 400, error: `Choose a court from 1 to ${settings.courtCount || 0}` };
  const start = ms(scheduledAt);
  if (start === null) return { status: 400, error: 'Invalid time' };
  const slot = [start, start + durationOf(match, settings)];
  const others = loadMatches(season.id).filter((r) => r.id !== match.id);
  const clash = others.find((r) => r.court_no === courtNo && r.status !== 'FINISHED' && (() => { const i = intervalOf(r, settings, now); return i && overlaps(i, slot); })());
  if (clash) return { status: 409, error: `Kurt ${courtNo} is taken at that time (${clash.p1_name} – ${clash.p2_name})` };
  const warnings = [];
  const rest = settings.restMinutes * MIN;
  others.forEach((r) => {
    const sharesPlayer = [r.player1_id, r.player2_id].some((id) => id && [match.player1_id, match.player2_id].includes(id));
    const i = intervalOf(r, settings, now);
    if (!sharesPlayer || !i) return;
    if (overlaps(i, slot)) warnings.push(`A player of this match is already on court at that time (${r.p1_name} – ${r.p2_name})`);
    else if (i[0] - rest < slot[1] && slot[0] < i[1] + rest) warnings.push(`A player has less than ${settings.restMinutes} minutes of rest around that time (${r.p1_name} – ${r.p2_name})`);
  });
  if (settings.maxPerDay) {
    const day = dayOf(start);
    [match.player1_id, match.player2_id].forEach((id) => {
      const same = others.filter((r) => [r.player1_id, r.player2_id].includes(id) && r.status !== 'FINISHED' && r.scheduled_at && dayOf(ms(r.scheduled_at)) === day).length
        + others.filter((r) => [r.player1_id, r.player2_id].includes(id) && r.status === 'FINISHED' && (r.start_time || r.scheduled_at) && dayOf(ms(r.start_time || r.scheduled_at)) === day).length;
      if (same >= settings.maxPerDay) warnings.push(`A player would play more than ${settings.maxPerDay} ${settings.maxPerDay === 1 ? 'match' : 'matches'} that day`);
    });
  }
  db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = 1, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(new Date(start).toISOString(), courtNo, `Kurt ${courtNo}`, match.id);
  return { warnings };
}

// Locks or unlocks a planned match that is on the schedule: a locked one is never moved by the planner, an unlocked one stays where it is
// until the planner ("rebuild") moves it. -> { error, status } or { ok }
function setLocked(season, token, locked) {
  const match = db.prepare('SELECT * FROM matches WHERE share_token = ? AND season_id = ?').get(token, season.id);
  if (!match) return { status: 404, error: 'Match not found in this tournament' };
  if (match.status !== 'PLANNED') return { status: 409, error: 'Only a match that has not started can be locked or unlocked' };
  if (locked && !match.court_no) return { status: 400, error: 'Put the match on a court first' };
  db.prepare("UPDATE matches SET slot_locked = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(locked ? 1 : 0, match.id);
  return { ok: true };
}

// ---------- planning ----------

// the courts and the players as they are now: one entry per match that has a time — { id, players, court (1-based or null), interval }
function planningEntries(rows, settings, now) {
  const entries = [];
  rows.forEach((r) => {
    const interval = intervalOf(r, settings, now);
    if (!interval) return;
    entries.push({ id: r.id, players: [r.player1_id, r.player2_id], court: r.court_no && r.court_no <= settings.courtCount ? r.court_no : null, interval });
  });
  return entries;
}

// does a match of these players on this court in this slot clash with anything (ignoring the entry `ignoreId`)? Returns the reason or ''.
function slotProblem(entries, settings, players, court, slot, ignoreId) {
  const rest = settings.restMinutes * MIN;
  const others = entries.filter((e) => e.id !== ignoreId);
  if (court && others.some((e) => e.court === court && overlaps(e.interval, slot))) return 'court';
  const mine = others.filter((e) => e.players.some((p) => players.includes(p)));
  if (mine.some((e) => e.interval[0] - rest < slot[1] && slot[0] < e.interval[1] + rest)) return 'player';
  if (settings.maxPerDay) {
    const day = dayOf(slot[0]);
    const tooMany = players.some((p) => mine.filter((e) => e.players.includes(p) && dayOf(e.interval[0]) === day).length >= settings.maxPerDay);
    if (tooMany) return 'day';
  }
  return '';
}

// the earliest slot (on the 15-minute grid, inside a playing day, not before `notBefore`, and — when `before` is given — starting
// before it) where some court is free and both players are free with their rest; { court, slot } or null
function findSlot(entries, settings, windows, players, duration, notBefore, ignoreId, before) {
  for (let w = 0; w < windows.length; w += 1) {
    const [ws, we] = windows[w];
    if (we <= notBefore) continue;
    const first = Math.max(ws, notBefore);
    for (let t = ws + Math.ceil((first - ws) / (GRID_MIN * MIN)) * GRID_MIN * MIN; t + duration <= we; t += GRID_MIN * MIN) {
      if (before !== undefined && t >= before) return null;
      const slot = [t, t + duration];
      if (slotProblem(entries, settings, players, null, slot, ignoreId)) continue;
      for (let court = 1; court <= settings.courtCount; court += 1) {
        if (!slotProblem(entries, settings, players, court, slot, ignoreId)) return { court, slot };
      }
    }
  }
  return null;
}

// mode 'fill': place the planned matches that have no time yet; 'rebuild': first take every planned match the planner placed (not the
// locked ones) off the schedule, then fill; 'compact': move the planned matches that are not locked EARLIER where time was freed (a
// match that ended early, a shortened match) and later where a running match overran their court; 'clear': take every planned
// match off, locked ones too; 'unlock': unlock every planned match.
// -> { placed, skipped (matches that found no free time before the end of the tournament), moved, error }
function autoPlan(seasonId, { mode = 'fill', now = Date.now() } = {}) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.kind !== 'TOURNAMENT') return { error: 'Only a tournament has a court schedule' };
  const settings = settingsOf(season);
  if (mode === 'unlock') {
    const unlocked = db.prepare("UPDATE matches SET slot_locked = 0 WHERE season_id = ? AND status = 'PLANNED' AND slot_locked = 1").run(seasonId);
    return { placed: 0, skipped: 0, unlocked: Number(unlocked.changes) };
  }
  if (mode === 'clear') {
    const cleared = db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, slot_locked = 0, location = CASE WHEN location LIKE 'Kurt %' THEN '' ELSE location END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE season_id = ? AND status = 'PLANNED' AND court_no IS NOT NULL").run(seasonId);
    return { placed: 0, skipped: 0, cleared: Number(cleared.changes) };
  }
  if (!settings.courtCount) return { error: 'Set the number of courts first' };
  if (!settings.days.length) return { error: 'Set the dates of the tournament first' };
  if (mode === 'rebuild') {
    db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, location = CASE WHEN location LIKE 'Kurt %' THEN '' ELSE location END WHERE season_id = ? AND status = 'PLANNED' AND court_no IS NOT NULL AND slot_locked = 0").run(seasonId);
  }

  const rows = loadMatches(seasonId).filter((r) => r.player1_id && r.player2_id);
  const entries = planningEntries(rows, settings, now);
  const windows = settings.days.map((day) => [localToUtcMs(day, settings.dayStart), localToUtcMs(day, settings.dayEnd)]);
  const notBefore = Math.ceil(now / (GRID_MIN * MIN)) * GRID_MIN * MIN;
  const lengthOf = (r) => durationOf(r, settings);
  const update = db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = ?, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  let placed = 0;
  let skipped = 0;
  let moved = 0;

  if (mode === 'compact') {
    const candidates = rows.filter((r) => r.status === 'PLANNED' && r.court_no && r.scheduled_at && !r.slot_locked)
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.id - b.id);
    candidates.forEach((r) => {
      const entry = entries.find((e) => e.id === r.id);
      if (!entry) return;
      const players = [r.player1_id, r.player2_id];
      const current = entry.interval;
      const clash = slotProblem(entries, settings, players, entry.court, current, r.id);
      const found = findSlot(entries, settings, windows, players, lengthOf(r), notBefore, r.id);
      if (!found) return;
      if (!(found.slot[0] < current[0] || (clash && found.slot[0] !== current[0]))) return;
      entry.court = found.court;
      entry.interval = found.slot;
      update.run(new Date(found.slot[0]).toISOString(), found.court, 0, `Kurt ${found.court}`, r.id);
      moved += 1;
    });
    return { placed: 0, skipped: 0, moved };
  }

  const availableAt = (r) => Math.max(0, ...entries.filter((e) => e.players.some((p) => [r.player1_id, r.player2_id].includes(p))).map((e) => e.interval[1]));
  const todo = rows.filter((r) => r.status === 'PLANNED' && !r.scheduled_at);
  // the earlier round first; within a round the pair whose players have been resting longest first
  todo.sort((a, b) => ((a.b_round || 0) - (b.b_round || 0)) || (availableAt(a) - availableAt(b)) || (a.id - b.id));
  todo.forEach((r) => {
    const players = [r.player1_id, r.player2_id];
    const found = findSlot(entries, settings, windows, players, lengthOf(r), notBefore, r.id);
    if (!found) { skipped += 1; return; }
    entries.push({ id: r.id, players, court: found.court, interval: found.slot });
    update.run(new Date(found.slot[0]).toISOString(), found.court, 0, `Kurt ${found.court}`, r.id);
    placed += 1;
  });
  return { placed, skipped, moved };
}

// called after a bracket changed (a match finished, a draw was made …): places the new matches by itself and moves the others forward
// where time was freed, when the tournament has courts and "automatic schedule" is on. Never throws — a failing planner must not
// break a result being saved.
function autoPlanIfEnabled(seasonId) {
  try {
    if (!seasonId) return;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
    if (!season || season.kind !== 'TOURNAMENT' || !season.court_count || season.auto_schedule === 0) return;
    autoPlan(seasonId, { mode: 'fill' });
    autoPlan(seasonId, { mode: 'compact' });
  } catch (err) {
    console.error('[tournament schedule]', err.message);
  }
}

// The length of one match in minutes, set by the organiser (15–300, a multiple of 5); null = the length of the tournament's matches again.
// A match whose real end is not known (a result entered by hand) occupies its court for this long. After a change the planner moves the
// following matches forward (or back) when "automatic schedule" is on. -> { error, status } or { ok }
function setDuration(season, token, minutes) {
  const match = db.prepare('SELECT * FROM matches WHERE share_token = ? AND season_id = ?').get(token, season.id);
  if (!match) return { status: 404, error: 'Match not found in this tournament' };
  if (match.status === 'LIVE') return { status: 409, error: 'A match that is being played cannot be given another length' };
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 15 || minutes > 300 || minutes % 5 !== 0)) return { status: 400, error: 'The length of a match must be 15 to 300 minutes, a multiple of 5' };
  db.prepare("UPDATE matches SET duration_minutes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(minutes, match.id);
  autoPlanIfEnabled(season.id);
  return { ok: true };
}

module.exports = {
  settingsOf,
  saveSettings,
  getSchedule,
  placeMatch,
  setLocked,
  setDuration,
  autoPlan,
  autoPlanIfEnabled,
  localToUtcMs,
};
