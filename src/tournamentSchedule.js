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

const validTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function settingsOf(season) {
  return {
    courtCount: season.court_count || 0,
    matchMinutes: season.match_minutes || 90,
    dayStart: validTime(season.day_start) ? season.day_start : '09:00',
    dayEnd: validTime(season.day_end) ? season.day_end : '20:00',
    restMinutes: season.rest_minutes === null || season.rest_minutes === undefined ? 30 : season.rest_minutes,
    autoSchedule: season.auto_schedule === 0 ? false : true,
    days: daysOf(season),
    timezone: TZ,
  };
}

// validates and stores { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule }; returns { error } or { ok }
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
  if ((toMinutes(next.dayEnd) - toMinutes(next.dayStart)) < next.matchMinutes) return { error: 'The playing day is shorter than one match' };
  db.prepare('UPDATE seasons SET match_minutes = ?, day_start = ?, day_end = ?, rest_minutes = ?, auto_schedule = ? WHERE id = ?')
    .run(next.matchMinutes, next.dayStart, next.dayEnd, next.restMinutes, next.autoSchedule ? 1 : 0, season.id);
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

// [start, end] in ms a match takes on its court (and its players): planned = start + the match length, live = until it ends
// (at least now + a quarter of an hour), finished = its real end; null when it has no time at all
function intervalOf(row, settings, now) {
  const duration = settings.matchMinutes * MIN;
  const start = ms(row.scheduled_at) ?? ms(row.start_time);
  if (start === null) return null;
  if (row.status === 'FINISHED') {
    const realStart = ms(row.start_time) ?? start;
    const end = ms(row.end_time);
    return [Math.min(start, realStart), end !== null && end > Math.min(start, realStart) ? end : start + duration];
  }
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
    endsAt: interval ? new Date(interval[1]).toISOString() : null,
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
  const slot = [start, start + settings.matchMinutes * MIN];
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
  db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = 1, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(new Date(start).toISOString(), courtNo, `Kurt ${courtNo}`, match.id);
  return { warnings };
}

// ---------- planning ----------

// mode 'fill': place the planned matches that have no time yet; 'rebuild': first take every planned match the planner placed (not the
// locked ones) off the schedule, then fill; 'clear': take every planned match off, locked ones too.
// -> { placed, skipped (matches that found no free time before the end of the tournament), error }
function autoPlan(seasonId, { mode = 'fill', now = Date.now() } = {}) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.kind !== 'TOURNAMENT') return { error: 'Only a tournament has a court schedule' };
  const settings = settingsOf(season);
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
  const duration = settings.matchMinutes * MIN;
  const rest = settings.restMinutes * MIN;
  const courts = Array.from({ length: settings.courtCount }, () => []);
  const busy = new Map(); // player id -> [[start, end]]
  const addBusy = (id, interval) => { if (!busy.has(id)) busy.set(id, []); busy.get(id).push(interval); };
  rows.forEach((r) => {
    const i = intervalOf(r, settings, now);
    if (!i) return;
    if (r.court_no && r.court_no <= settings.courtCount) courts[r.court_no - 1].push(i);
    addBusy(r.player1_id, i);
    addBusy(r.player2_id, i);
  });

  const windows = settings.days.map((day) => [localToUtcMs(day, settings.dayStart), localToUtcMs(day, settings.dayEnd)]);
  const notBefore = Math.ceil(now / (GRID_MIN * MIN)) * GRID_MIN * MIN;
  const availableAt = (r) => Math.max(0, ...[r.player1_id, r.player2_id].flatMap((id) => (busy.get(id) || []).map((i) => i[1])));
  const todo = rows.filter((r) => r.status === 'PLANNED' && !r.scheduled_at);
  // the earlier round first; within a round the pair whose players have been resting longest goes first
  todo.sort((a, b) => ((a.b_round || 0) - (b.b_round || 0)) || (availableAt(a) - availableAt(b)) || (a.id - b.id));

  const playersFree = (r, slot) => [r.player1_id, r.player2_id].every((id) => (busy.get(id) || []).every((i) => !(i[0] - rest < slot[1] && slot[0] < i[1] + rest)));
  const update = db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = 0, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  let placed = 0;
  let skipped = 0;
  todo.forEach((r) => {
    let found = null;
    for (const [ws, we] of windows) {
      if (found) break;
      if (we <= notBefore) continue;
      const first = Math.max(ws, notBefore);
      let t = ws + Math.ceil((first - ws) / (GRID_MIN * MIN)) * GRID_MIN * MIN;
      for (; t + duration <= we && !found; t += GRID_MIN * MIN) {
        const slot = [t, t + duration];
        if (!playersFree(r, slot)) continue;
        const court = courts.findIndex((list) => list.every((i) => !overlaps(i, slot)));
        if (court >= 0) found = { court, slot };
      }
    }
    if (!found) { skipped += 1; return; }
    courts[found.court].push(found.slot);
    addBusy(r.player1_id, found.slot);
    addBusy(r.player2_id, found.slot);
    update.run(new Date(found.slot[0]).toISOString(), found.court + 1, `Kurt ${found.court + 1}`, r.id);
    placed += 1;
  });
  return { placed, skipped };
}

// called after a bracket changed (a match finished, a draw was made …): places the new matches by itself when the tournament has
// courts and "automatic schedule" is on. Never throws — a failing planner must not break a result being saved.
function autoPlanIfEnabled(seasonId) {
  try {
    if (!seasonId) return;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
    if (!season || season.kind !== 'TOURNAMENT' || !season.court_count || season.auto_schedule === 0) return;
    autoPlan(seasonId, { mode: 'fill' });
  } catch (err) {
    console.error('[tournament schedule]', err.message);
  }
}

module.exports = {
  settingsOf,
  saveSettings,
  getSchedule,
  placeMatch,
  autoPlan,
  autoPlanIfEnabled,
  localToUtcMs,
};
