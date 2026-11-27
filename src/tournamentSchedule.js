// The court schedule of a tournament: which match is played on which court ("Kurt 1" … "Kurt n") and when.
// The organiser can put a match on a court at a time by hand (placeMatch — it is then "locked": the planner never moves it); the
// planner (autoPlan) places every match that has two players but no time yet, in the order the tournament needs them (earlier rounds
// first), each at the earliest time a court is free AND both players have had their rest since their last match — so a player is
// never put on court twice at once and nobody waits longer than the courts force them to. Real finished times count: a match that
// ended late pushes the next match of its players later. Times are stored in matches.scheduled_at (ISO, UTC); the playing day
// (day_start–day_end) is Bratislava time.
const db = require('./db');
const engine = require('./matchEngine');
const courtStreams = require('./courtStreams');
const courtNames = require('./courtNames');

const TZ = 'Europe/Bratislava';
const GRID_MIN = 5; // start times are on a 5-minute grid from the start of the playing day
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

// the end of a day without a limit: the planner may use the whole day
const OPEN_END = '23:55';
const validTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// the playing times a tournament typed for single days: { "2027-05-02": { start, end } } (only valid ones; the other days use the general times)
function ownDayTimesOf(season) {
  let raw = {};
  try { raw = JSON.parse(season.day_times || '{}') || {}; } catch { raw = {}; }
  const out = {};
  Object.keys(raw).forEach((day) => {
    const t = raw[day];
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && t && validTime(t.start) && validTime(t.end) && t.start < t.end) out[day] = { start: t.start, end: t.end };
  });
  return out;
}

function settingsOf(season) {
  const dayStart = validTime(season.day_start) ? season.day_start : '09:00';
  const dayEnd = validTime(season.day_end) ? season.day_end : '20:00';
  const days = daysOf(season);
  // only the days the tournament has now: times typed for a day before the dates were moved are not served, not checked and not stored again
  const ownAll = ownDayTimesOf(season);
  const ownDayTimes = {};
  Object.keys(ownAll).forEach((day) => { if (!days.length || days.includes(day)) ownDayTimes[day] = ownAll[day]; });
  // the playing times of the tournament form (what the players see) of every day: its own times when it has some, else the general ones
  const infoTimes = {};
  days.forEach((day) => { infoTimes[day] = ownDayTimes[day] || { start: dayStart, end: dayEnd }; });
  // The window the PLANNER works in (set on the schedule page). By default it is the playing times above; the organiser can give it another start and end, or empty one of
  // them: no end = no limit (the matches are put one under the other and the schedule grows), no start = from the start of the day above.
  // plan_start / plan_end: NULL = follow the times above, '' = none, 'HH:MM' = its own
  const planStart = season.plan_start === null || season.plan_start === undefined ? null : (validTime(season.plan_start) ? season.plan_start : null);
  const planEnd = season.plan_end === null || season.plan_end === undefined ? null : (season.plan_end === '' ? '' : (validTime(season.plan_end) ? season.plan_end : null));
  const dayTimes = {};
  days.forEach((day) => {
    const own = infoTimes[day];
    dayTimes[day] = { start: planStart || own.start, end: planEnd === '' ? OPEN_END : (planEnd || own.end) };
    // an own start later than the end of that day's times would leave no room: the planner then has no limit at the end
    if (dayTimes[day].start >= dayTimes[day].end) dayTimes[day] = { start: dayTimes[day].start, end: OPEN_END };
  });
  return {
    courtCount: season.court_count || 0,
    courtNames: courtNames.namesOf(season),
    matchMinutes: season.match_minutes || 90,
    dayStart,
    dayEnd,
    dayTimes,
    ownDayTimes,
    planStart,
    planEnd,
    openEnd: planEnd === '',
    restMinutes: season.rest_minutes === null || season.rest_minutes === undefined ? 30 : season.rest_minutes,
    autoSchedule: season.auto_schedule === 0 ? false : true,
    maxPerDay: season.max_matches_per_day || 0,
    timelineView: season.timeline_compact ? 'compact' : 'wide',
    days,
    timezone: TZ,
  };
}

// the planning settings a request asks for, laid over the ones of `season` (a new tournament: {} = the defaults):
// { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule, maxPerDay } -> { error } or { next }. Nothing is stored here.
function readSettings(season, body) {
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
  // the times of single days: { "2027-05-02": { start, end } } — a day has both or none, the end is after the start (the whole object replaces the typed ones)
  if (body.dayTimes !== undefined) {
    if (!body.dayTimes || typeof body.dayTimes !== 'object' || Array.isArray(body.dayTimes)) return { error: 'dayTimes must be an object like { "2027-05-02": { "start": "14:00", "end": "18:00" } }' };
    const own = {};
    for (const [day, t] of Object.entries(body.dayTimes)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'A day must look like 2027-05-02' };
      if (!t || typeof t !== 'object' || !validTime(t.start) || !validTime(t.end)) return { error: `${day}: enter both the start and the end of the playing day, like 09:00` };
      if (t.start >= t.end) return { error: `${day}: the playing day must end after it starts` };
      own[day] = { start: t.start, end: t.end };
    }
    next.ownDayTimes = {};
    Object.keys(own).forEach((day) => { if (!s.days.length || s.days.includes(day)) next.ownDayTimes[day] = own[day]; });
  }
  // the planner's own window: null = follow the playing times of the tournament form, '' = no limit, 'HH:MM' = its own time
  const planKinds = { planStart: 'The start of the planning', planEnd: 'The end of the planning' };
  for (const key of Object.keys(planKinds)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && body[key] !== '' && !validTime(body[key])) return { error: `${planKinds[key]} must look like 09:00 (or be empty for no limit)` };
    next[key] = body[key];
  }
  if (validTime(next.planStart) && validTime(next.planEnd) && next.planStart >= next.planEnd) return { error: 'The planning must end after it starts' };
  if (body.restMinutes !== undefined) {
    next.restMinutes = Number(body.restMinutes);
    if (!Number.isInteger(next.restMinutes) || next.restMinutes < 0 || next.restMinutes > 240) return { error: 'The rest between matches must be 0 to 240 minutes' };
  }
  if (body.autoSchedule !== undefined) next.autoSchedule = !!body.autoSchedule;
  if (body.maxPerDay !== undefined) {
    next.maxPerDay = Number(body.maxPerDay);
    if (!Number.isInteger(next.maxPerDay) || next.maxPerDay < 0 || next.maxPerDay > 10) return { error: 'The most matches a player may play in a day must be 0 (no limit) to 10' };
  }
  if (body.timelineView !== undefined) {
    if (body.timelineView !== 'compact' && body.timelineView !== 'wide') return { error: 'The view of the timeline must be compact or wide' };
    next.timelineView = body.timelineView;
  }
  if ((toMinutes(next.dayEnd) - toMinutes(next.dayStart)) < next.matchMinutes) return { error: 'The playing day is shorter than one match' };
  if (validTime(next.planStart) && validTime(next.planEnd) && (toMinutes(next.planEnd) - toMinutes(next.planStart)) < next.matchMinutes) return { error: 'The planning window is shorter than one match' };
  const tooShort = Object.keys(next.ownDayTimes || {}).find((day) => (toMinutes(next.ownDayTimes[day].end) - toMinutes(next.ownDayTimes[day].start)) < next.matchMinutes);
  if (tooShort) return { error: `${tooShort}: the playing day is shorter than one match (change the playing times of that day in the tournament form in the Backend)` };
  return { next };
}

// writes checked settings (the `next` of readSettings) to a tournament
function storeSettings(seasonId, next) {
  const own = next.ownDayTimes || {};
  db.prepare('UPDATE seasons SET match_minutes = ?, day_start = ?, day_end = ?, day_times = ?, rest_minutes = ?, auto_schedule = ?, max_matches_per_day = ?, plan_start = ?, plan_end = ?, timeline_compact = ? WHERE id = ?')
    .run(next.matchMinutes, next.dayStart, next.dayEnd, Object.keys(own).length ? JSON.stringify(own) : '', next.restMinutes, next.autoSchedule ? 1 : 0, next.maxPerDay,
      next.planStart === undefined ? null : next.planStart, next.planEnd === undefined ? null : next.planEnd, next.timelineView === 'compact' ? 1 : 0, seasonId);
}

// validates and stores { matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule, maxPerDay }; returns { error } or { ok }
function saveSettings(season, body) {
  const read = readSettings(season, body);
  if (read.error) return { error: read.error };
  storeSettings(season.id, read.next);
  return { ok: true };
}

// the keys of a request that are planning settings (a new tournament may bring them)
const SETTING_KEYS = ['matchMinutes', 'dayStart', 'dayEnd', 'dayTimes', 'restMinutes', 'autoSchedule', 'maxPerDay', 'planStart', 'planEnd', 'timelineView'];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// the order the categories play in: the weakest first (a category that is none of the three - open, doubles - after them)
const CATEGORY_ORDER = ['NOVICE', 'NEXT_GEN', 'ELITE'];
const categoryRank = (category) => { const i = CATEGORY_ORDER.indexOf(category); return i === -1 ? CATEGORY_ORDER.length : i; };

// ---------- reading ----------

function loadMatches(seasonId) {
  return db.prepare(`
    SELECT m.*, bm.round AS b_round, bm.position AS b_position, b.id AS bracket_id, b.name AS bracket_name, b.kind AS bracket_kind, b.size AS bracket_size,
           (CASE WHEN b.prelim = 1 AND EXISTS (SELECT 1 FROM bracket_matches x WHERE x.bracket_id = b.id AND x.round = 1 AND x.is_bye = 1) THEN 1 ELSE 0 END) AS bracket_prelim,
           CASE WHEN m.is_doubles = 1 AND p1b.name IS NOT NULL THEN p1.name || ' / ' || p1b.name ELSE p1.name END AS p1_name, CASE WHEN m.is_doubles = 1 THEN NULL ELSE p1.slug END AS p1_slug,
           CASE WHEN m.is_doubles = 1 AND p2b.name IS NOT NULL THEN p2.name || ' / ' || p2b.name ELSE p2.name END AS p2_name, CASE WHEN m.is_doubles = 1 THEN NULL ELSE p2.slug END AS p2_slug, g.name AS group_name,
           (SELECT r.seed FROM season_registrations r WHERE r.season_id = m.season_id AND r.player_id = m.player1_id AND r.category = m.category LIMIT 1) AS p1_seed,
           (SELECT r.seed FROM season_registrations r WHERE r.season_id = m.season_id AND r.player_id = m.player2_id AND r.category = m.category LIMIT 1) AS p2_seed,
           (SELECT r.wildcard FROM season_registrations r WHERE r.season_id = m.season_id AND r.player_id = m.player1_id AND r.category = m.category LIMIT 1) AS p1_wc,
           (SELECT r.wildcard FROM season_registrations r WHERE r.season_id = m.season_id AND r.player_id = m.player2_id AND r.category = m.category LIMIT 1) AS p2_wc
    FROM matches m
    LEFT JOIN season_groups g ON g.id = m.group_id
    LEFT JOIN bracket_matches bm ON bm.match_id = m.id
    LEFT JOIN brackets b ON b.id = bm.bracket_id
    LEFT JOIN players p1 ON p1.id = m.player1_id
    LEFT JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN players p1b ON p1b.id = m.player1b_id
    LEFT JOIN players p2b ON p2b.id = m.player2b_id
    WHERE m.season_id = ?
    ORDER BY m.id
  `).all(seasonId);
}

// every player of a match: the four of a doubles match (a partner is busy on court like the first player)
const playersOf = (r) => [r.player1_id, r.player2_id, r.player1b_id, r.player2b_id].filter(Boolean);

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
    // moved / resized by the organiser after the match: the block is where he put it
    if (row.manual_block && scheduled !== null) return [scheduled, scheduled + duration];
    const start = realStart ?? scheduled;
    if (start === null) return null;
    const end = ms(row.end_time);
    if (end !== null && end > start) return [start, end];
    // a result entered by hand: the match ended at the moment the result was entered (at the latest when its length is up); a length
    // set by the organiser for this match wins
    const entered = ms(row.result_at);
    if (!row.duration_minutes && entered !== null && entered > start) return [start, Math.min(entered, start + duration)];
    return [start, start + duration];
  }
  const start = scheduled ?? realStart;
  if (start === null) return null;
  if (row.status === 'LIVE') return [start, Math.max(start + duration, now + 15 * MIN)];
  return [start, start + duration];
}

function serializeMatch(row, settings, now) {
  const interval = intervalOf(row, settings, now);
  let scoreSummary = null;
  let state = null; // the sets of a match that has been played or is being played (for the schedule on the whole screen: a column per set)
  if (row.status === 'FINISHED' || row.status === 'LIVE' || row.status === 'UNFINISHED') {
    try {
      const full = JSON.parse(row.state);
      if (row.status !== 'UNFINISHED') scoreSummary = engine.describeMatch(full);
      state = {
        currentSet: full.currentSet,
        sets: (full.sets || []).map((x) => ({ p1: x.p1, p2: x.p2, tiebreak: x.tiebreak || null, isSuperTiebreak: !!x.isSuperTiebreak, winner: x.winner || null })),
        // the points of the game in play (15-30-40-Ad) of a match scored point by point: the court overlay (/overlay/kurt-1) shows them as its last column
        status: full.status || null,
        game: full.game || null,
        pointByPoint: !!(full.log && full.log.length),
      };
    } catch { scoreSummary = null; state = null; }
  }
  return {
    token: row.share_token,
    status: row.status,
    category: row.category,
    bracket: row.bracket_id ? { id: row.bracket_id, name: row.bracket_name, kind: row.bracket_kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN', prelim: !!row.bracket_prelim } : null,
    round: row.b_round || null,
    group: row.group_id ? { id: row.group_id, name: row.group_name } : null,
    groupRound: row.round || null,
    rounds: row.bracket_size ? Math.log2(row.bracket_size) : null,
    player1: { id: row.player1_id, name: row.p1_name, slug: row.p1_slug, seed: row.p1_seed || null, wildcard: !!row.p1_wc },
    player2: { id: row.player2_id, name: row.p2_name, slug: row.p2_slug, seed: row.p2_seed || null, wildcard: !!row.p2_wc },
    winnerId: row.winner_id || null,
    endReason: row.end_reason || null, // WALKOVER / RETIREMENT: the schedule says W.O. / Skreč next to Skončený
    scoreSummary,
    state,
    scheduledAt: row.scheduled_at || null,
    // where the block of the match is drawn: a finished match from its real start to its real end
    blockStart: interval ? new Date(interval[0]).toISOString() : null,
    endsAt: interval ? new Date(interval[1]).toISOString() : null,
    durationMinutes: row.duration_minutes || null,
    // a finished match whose real end is known cannot be given another length
    manual: !!row.manual_block,
    endKnown: row.status === 'FINISHED' && !row.manual_block && ms(row.end_time) !== null && ms(row.end_time) > (ms(row.start_time) ?? ms(row.scheduled_at) ?? Infinity),
    courtNo: row.court_no || null,
    locked: !!row.slot_locked,
  };
}

// The scoreboard overlay of a court (the page /overlay/<slug>/<court>, drawn over the YouTube stream of the court): the match that is LIVE on the court
// (two of them by mistake: the one that started last), else the one that finished on it in the last FINISHED_SHOW_MS (its final score stays on screen for a
// while), else none. Only what the scoreboard needs: no contact details, no ids of players.
const FINISHED_SHOW_MS = 3 * MIN;
// the name of a court on the schedule (its own name, or "Kurt <number>")
const courtLabel = (settings, n) => courtNames.label(settings.courtNames, n);

function getCourtLive(season, court, now = Date.now()) {
  const settings = settingsOf(season);
  const rows = loadMatches(season.id).filter((r) => r.player1_id && r.player2_id && r.court_no === court);
  const startOf = (r) => ms(r.start_time) ?? ms(r.scheduled_at) ?? 0;
  const endOf = (r) => ms(r.end_time) ?? ms(r.result_at) ?? 0;
  const liveRow = rows.filter((r) => r.status === 'LIVE').sort((a, b) => startOf(b) - startOf(a))[0];
  const finishedRow = rows.filter((r) => r.status === 'FINISHED' && endOf(r) > 0 && now - endOf(r) <= FINISHED_SHOW_MS).sort((a, b) => endOf(b) - endOf(a))[0];
  const row = liveRow || finishedRow;
  let match = null;
  if (row) {
    const m = serializeMatch(row, settings, now);
    match = { token: m.token, status: m.status, player1: { name: m.player1.name }, player2: { name: m.player2.name }, winnerId: m.winnerId, firstServer: row.first_server || null, state: m.state };
  }
  return { court, label: courtLabel(settings, court), tournament: season.name, match };
}

// The moment a tournament starts: the start of its first day's playing window (that day's own start time, else the general one, 09:00 unless set) — UTC ms, or null
// without a start date. After it the public registration is closed (routes/seasons.js) and a player can no longer drop out by the deadline (unregister.js).
function tournamentStartMs(season) {
  if (!season || !season.start_date) return null;
  const own = ownDayTimesOf(season)[season.start_date];
  const time = own ? own.start : (validTime(season.day_start) ? season.day_start : '09:00');
  return localToUtcMs(season.start_date, time);
}

// has this tournament started (the start of its first day has passed)? Anything else (a league season, no start date) never counts as started.
function tournamentStarted(season, now = Date.now()) {
  if (!season || season.kind !== 'TOURNAMENT') return false;
  const start = tournamentStartMs(season);
  return start !== null && now >= start;
}

// The moment a tournament ends: the end of the playing window of its LAST day (that day's own end time, else the general one, 20:00 unless set) — UTC ms, or null
// without a start date. After it the tournament counts as finished on the public pages (the date alone only says so the day after).
function tournamentEndMs(season) {
  if (!season || !season.start_date) return null;
  const last = season.end_date && season.end_date >= season.start_date ? season.end_date : season.start_date;
  const own = ownDayTimesOf(season)[last];
  const time = own ? own.end : (validTime(season.day_end) ? season.day_end : '20:00');
  return localToUtcMs(last, time);
}

// has this tournament ended (the end of the playing window of its last day has passed)? Anything else (a league season, no start date) never counts as ended.
function tournamentEnded(season, now = Date.now()) {
  if (!season || season.kind !== 'TOURNAMENT') return false;
  const end = tournamentEndMs(season);
  return end !== null && now >= end;
}

// everything the schedule tab shows
// Why a planned match has no time yet: { code, from?, end?, max? } — 'DAY_END' (it would start after the last moment a match fits into the day: from = the earliest start,
// end = the end of the last day), 'DAY_LIMIT' (a player would play more than the limit a day), 'NO_ROOM' (every court is taken until the end), 'WAIT' (a place exists:
// it waits for the planner / the button "Poskladať rozvrh"), 'NO_COURTS'. Used for the tray of unscheduled matches.
function whyUnscheduled(row, rows, settings, now) {
  if (!settings.courtCount) return { code: 'NO_COURTS' };
  if (!settings.days.length) return { code: 'NO_DAYS' };
  const entries = planningEntries(rows, settings, now);
  const windows = settings.days.map((day) => [localToUtcMs(day, settings.dayTimes[day].start), localToUtcMs(day, settings.dayTimes[day].end)]);
  const notBefore = Math.ceil(now / (GRID_MIN * MIN)) * GRID_MIN * MIN;
  const length = durationOf(row, settings);
  const players = playersOf(row);
  if (findSlot(entries, settings, windows, players, length, notBefore, row.id)) return { code: 'WAIT' };
  const lastEnd = Math.max(...windows.map((w) => w[1]));
  const hhmm = (t) => new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  if (settings.maxPerDay) {
    const mine = entries.filter((e) => e.id !== row.id && e.players.some((p) => players.includes(p)));
    const full = windows.every(([ws]) => players.some((p) => mine.filter((e) => e.players.includes(p) && dayOf(e.interval[0]) === dayOf(ws)).length >= settings.maxPerDay));
    if (full) return { code: 'DAY_LIMIT', max: settings.maxPerDay };
  }
  const rest = settings.restMinutes * MIN;
  const free = Math.max(notBefore, ...entries.filter((e) => e.id !== row.id && e.players.some((p) => players.includes(p))).map((e) => e.interval[1] + rest));
  if (free + length > lastEnd) return { code: 'DAY_END', from: hhmm(free), end: hhmm(lastEnd) };
  return { code: 'NO_ROOM', end: hhmm(lastEnd) };
}

function getSchedule(season, now = Date.now()) {
  const settings = settingsOf(season);
  const rows = loadMatches(season.id).filter((r) => r.player1_id && r.player2_id);
  const matches = rows.map((r) => {
    const m = serializeMatch(r, settings, now);
    if (r.status === 'PLANNED' && !r.scheduled_at) m.why = whyUnscheduled(r, rows, settings, now);
    return m;
  });
  // the window the page DRAWS for each day: the planner's window; a day without an end shows the hours up to the end of its last match (rounded up to the hour, at least
  // three hours from the start), so the schedule grows as matches are added
  const dayView = {};
  settings.days.forEach((day) => {
    const w = settings.dayTimes[day];
    if (!settings.openEnd) { dayView[day] = w; return; }
    let last = 0;
    rows.forEach((r) => {
      const i = intervalOf(r, settings, now);
      if (i && r.court_no && dayOf(i[0]) === day) last = Math.max(last, i[1]);
    });
    const [h, m] = (last ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(last)) : '00:00').split(':').map(Number);
    const endMin = Math.min(23 * 60 + 55, Math.max(toMinutes(w.start) + 180, last ? (h + (m > 0 ? 1 : 0)) * 60 : 0));
    dayView[day] = { start: w.start, end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}` };
  });
  return {
    seasonId: season.id,
    // (for the page of the schedule on the whole screen: its heading and the way back)
    seasonName: season.name,
    seasonSlug: season.slug,
    seasonKind: season.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE',
    settings: { ...settings, dayView },
    // the live video of each court: [{ videoId, url } or null] for Court 1 … n
    courtStreams: courtStreams.streamsOf(season),
    matches,
    // planned matches with no time yet: waiting for the planner or for the organiser to drag them onto a court
    unscheduledCount: matches.filter((m) => m.status === 'PLANNED' && !m.scheduledAt).length,
  };
}

// ---------- placing by hand ----------

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

// Puts a planned match on a court at a time (court null = take it off the schedule). Returns { error, status } or { warnings, pushed }.
// insert: a time taken by a match that has not started is no error: the match goes in front of it (dropped on its first half) or right after it
// (its second half), and the planned matches after it on that court that day move later as far as needed (see pushAfter).
function placeMatch(season, token, courtNo, scheduledAt, now = Date.now(), { insert = false } = {}) {
  const settings = settingsOf(season);
  const match = db.prepare('SELECT * FROM matches WHERE share_token = ? AND season_id = ?').get(token, season.id);
  if (!match) return { status: 404, error: 'Match not found in this tournament' };
  // a finished match is locked on the schedule by itself; the organiser unlocks it in the page and may then move it (it keeps its length)
  const finished = match.status === 'FINISHED';
  if (match.status !== 'PLANNED' && !finished) return { status: 409, error: 'Only a match that is not being played can be moved' };
  if (finished && courtNo === null) return { status: 409, error: 'A finished match stays on the schedule' };
  if (courtNo === null) {
    db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, slot_locked = 0, location = CASE WHEN court_no IS NOT NULL THEN '' ELSE location END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(match.id);
    return { warnings: [] };
  }
  if (!Number.isInteger(courtNo) || courtNo < 1 || courtNo > settings.courtCount) return { status: 400, error: `Choose a court from 1 to ${settings.courtCount || 0}` };
  const start = ms(scheduledAt);
  if (start === null) return { status: 400, error: 'Invalid time' };
  // a finished match keeps the length its block has now (rounded up to 5 minutes) unless the organiser has set one
  let length = durationOf(match, settings);
  if (finished && !match.duration_minutes) {
    const current = intervalOf(match, settings, now);
    if (current) length = Math.max(15 * MIN, Math.ceil((current[1] - current[0]) / (5 * MIN)) * 5 * MIN);
  }
  let slot = [start, start + length];
  const others = loadMatches(season.id).filter((r) => r.id !== match.id);
  const busy = (r, sl) => r.court_no === courtNo && r.status !== 'FINISHED' && (() => { const i = intervalOf(r, settings, now); return i && overlaps(i, sl); })();
  let pushed = 0;
  if (insert && !finished) {
    const hit = others.filter((r) => busy(r, slot)).sort((a, b) => intervalOf(a, settings, now)[0] - intervalOf(b, settings, now)[0])[0];
    if (hit) {
      const i = intervalOf(hit, settings, now);
      // the first half of a planned match: in front of it; its second half, or a match being played: right after it
      const at = hit.status === 'PLANNED' && start < (i[0] + i[1]) / 2 ? i[0] : i[1];
      slot = [at, at + length];
      pushed = pushAfter(season, settings, others, courtNo, slot, now);
      if (pushed < 0) return { status: 409, error: `Kurt ${courtNo}: the matches after it cannot move (a match that is being played is in the way)` };
    }
  }
  const clash = others.find((r) => busy(r, slot));
  if (clash) return { status: 409, error: `Kurt ${courtNo} is taken at that time (${clash.p1_name} – ${clash.p2_name})` };
  const warnings = [];
  const rest = settings.restMinutes * MIN;
  // (a finished match that is moved over another finished one is only a warning: that is history, the organiser is tidying it)
  if (finished) {
    const over = others.find((r) => r.court_no === courtNo && r.status === 'FINISHED' && (() => { const i = intervalOf(r, settings, now); return i && overlaps(i, slot); })());
    if (over) warnings.push(`It overlaps another finished match on Kurt ${courtNo} (${over.p1_name} – ${over.p2_name})`);
  }
  others.forEach((r) => {
    const sharesPlayer = playersOf(r).some((id) => id && playersOf(match).includes(id));
    const i = intervalOf(r, settings, now);
    if (!sharesPlayer || !i) return;
    if (overlaps(i, slot)) warnings.push(`A player of this match is already on court at that time (${r.p1_name} – ${r.p2_name})`);
    else if (i[0] - rest < slot[1] && slot[0] < i[1] + rest) warnings.push(`A player has less than ${settings.restMinutes} minutes of rest around that time (${r.p1_name} – ${r.p2_name})`);
  });
  if (settings.maxPerDay) {
    const day = dayOf(start);
    playersOf(match).forEach((id) => {
      const same = others.filter((r) => playersOf(r).includes(id) && r.status !== 'FINISHED' && r.scheduled_at && dayOf(ms(r.scheduled_at)) === day).length
        + others.filter((r) => playersOf(r).includes(id) && r.status === 'FINISHED' && (r.start_time || r.scheduled_at) && dayOf(ms(r.start_time || r.scheduled_at)) === day).length;
      if (same >= settings.maxPerDay) warnings.push(`A player would play more than ${settings.maxPerDay} ${settings.maxPerDay === 1 ? 'match' : 'matches'} that day`);
    });
  }
  if (finished) {
    db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, duration_minutes = ?, manual_block = 1, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(new Date(start).toISOString(), courtNo, length / MIN, courtLabel(settings, courtNo), match.id);
    autoPlanIfEnabled(season.id);
    return { warnings };
  }
  db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = 1, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(new Date(slot[0]).toISOString(), courtNo, courtLabel(settings, courtNo), match.id);
  if (pushed > 0) warnings.unshift(`${pushed} ${pushed === 1 ? 'match' : 'matches'} after it moved later`);
  return { warnings, pushed };
}

// Makes room for an inserted block on a court: every planned match on that court that day which starts at or after the block (or overlaps it) moves later,
// one after another, so that none overlaps the one before it (a gap that was there stays when it is big enough). Matches that are being played or are
// finished do not move: a pushed match that would meet one goes after it. Changes `others` in place (their new times) and the database.
// -> how many matches moved, or -1 when nothing could be done
function pushAfter(season, settings, others, courtNo, slot, now) {
  const day = dayOf(slot[0]);
  const onCourt = others.filter((r) => r.court_no === courtNo && intervalOf(r, settings, now) && dayOf(intervalOf(r, settings, now)[0]) === day);
  const fixed = onCourt.filter((r) => r.status !== 'PLANNED').map((r) => intervalOf(r, settings, now));
  const movable = onCourt.filter((r) => r.status === 'PLANNED' && intervalOf(r, settings, now)[1] > slot[0])
    .sort((a, b) => intervalOf(a, settings, now)[0] - intervalOf(b, settings, now)[0]);
  if (fixed.some((i) => overlaps(i, slot))) return -1;
  let end = slot[1];
  let moved = 0;
  const update = db.prepare("UPDATE matches SET scheduled_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  for (const r of movable) {
    const len = durationOf(r, settings);
    let at = Math.max(intervalOf(r, settings, now)[0], end);
    for (let guard = 0; guard < 50; guard += 1) { // past a match that does not move
      const block = fixed.find((i) => overlaps(i, [at, at + len]));
      if (!block) break;
      at = block[1];
    }
    if (at !== ms(r.scheduled_at)) { update.run(new Date(at).toISOString(), r.id); r.scheduled_at = new Date(at).toISOString(); moved += 1; }
    end = at + len;
  }
  return moved;
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
// a planned match on a court whose start is already past (but not by more than half a day: an old one that was never played does not hold a court)
function overdue(row, interval, now) {
  return row.status === 'PLANNED' && !!row.court_no && interval[0] <= now && now - interval[0] < 12 * 60 * MIN;
}

function planningEntries(rows, settings, now) {
  const entries = [];
  rows.forEach((r) => {
    let interval = intervalOf(r, settings, now);
    if (!interval) return;
    // a match whose time has come but that was neither started nor finished is most likely being played: it keeps its court until the next planning
    // (as a running one does), else the court would look free to the planner while the players are still on it
    if (overdue(r, interval, now)) interval = [interval[0], Math.max(interval[1], now + 15 * MIN)];
    entries.push({ id: r.id, players: playersOf(r), court: r.court_no && r.court_no <= settings.courtCount ? r.court_no : null, interval });
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

// the earliest slot (on the 5-minute grid, inside a playing day, not before `notBefore`, and — when `before` is given — starting
// before it) where some court is free and both players are free with their rest; { court, slot } or null
function findSlot(entries, settings, windows, players, duration, notBefore, ignoreId, before) {
  for (let w = 0; w < windows.length; w += 1) {
    const [ws, we] = windows[w];
    if (we <= notBefore) continue;
    const first = Math.max(ws, notBefore);
    // the starts to try: the 5-minute grid, and the moments something ends (a court is free, a player is free after his rest), so a match can follow another at once
    // (matches of 40 minutes fit three into 2 hours instead of leaving 5 minutes after each)
    const rest = settings.restMinutes * MIN;
    const starts = new Set();
    for (let t = ws + Math.ceil((first - ws) / (GRID_MIN * MIN)) * GRID_MIN * MIN; t + duration <= we; t += GRID_MIN * MIN) starts.add(t);
    entries.forEach((e) => [e.interval[1], e.interval[1] + rest].forEach((t) => { if (t >= first && t + duration <= we) starts.add(t); }));
    for (const t of [...starts].sort((a, b) => a - b)) {
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
// match off, locked ones too; 'unlock': unlock every planned match. keep: ids of matches 'compact' does not move (they stay, the others make way).
// -> { placed, skipped (matches that found no free time before the end of the tournament), moved, error }
function autoPlan(seasonId, { mode = 'fill', now = Date.now(), keep = [] } = {}) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.kind !== 'TOURNAMENT') return { error: 'Only a tournament has a court schedule' };
  const settings = settingsOf(season);
  if (mode === 'unlock') {
    const unlocked = db.prepare("UPDATE matches SET slot_locked = 0 WHERE season_id = ? AND status = 'PLANNED' AND slot_locked = 1").run(seasonId);
    return { placed: 0, skipped: 0, unlocked: Number(unlocked.changes) };
  }
  if (mode === 'clear') {
    const cleared = db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, slot_locked = 0, location = CASE WHEN court_no IS NOT NULL THEN '' ELSE location END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE season_id = ? AND status = 'PLANNED' AND court_no IS NOT NULL").run(seasonId);
    return { placed: 0, skipped: 0, cleared: Number(cleared.changes) };
  }
  if (!settings.courtCount) return { error: 'Set the number of courts first' };
  if (!settings.days.length) return { error: 'Set the dates of the tournament first' };
  if (mode === 'rebuild') {
    db.prepare("UPDATE matches SET scheduled_at = NULL, court_no = NULL, location = CASE WHEN court_no IS NOT NULL THEN '' ELSE location END WHERE season_id = ? AND status = 'PLANNED' AND court_no IS NOT NULL AND slot_locked = 0").run(seasonId);
  }

  const rows = loadMatches(seasonId).filter((r) => r.player1_id && r.player2_id);
  const windows = settings.days.map((day) => [localToUtcMs(day, settings.dayTimes[day].start), localToUtcMs(day, settings.dayTimes[day].end)]);
  // backfill ("build it backwards"): the matches without a time are laid out from the START of the first playing day, whatever time it is now - for a tournament
  // whose matches were played before anybody put them on the courts. They are locked, so the planner does not move them afterwards.
  const backfill = mode === 'backfill';
  if (backfill) now = Math.min(now, Math.min(...windows.map((w) => w[0])));
  const entries = planningEntries(rows, settings, now);
  const notBefore = Math.ceil(now / (GRID_MIN * MIN)) * GRID_MIN * MIN;
  const lengthOf = (r) => durationOf(r, settings);
  const update = db.prepare("UPDATE matches SET scheduled_at = ?, court_no = ?, slot_locked = ?, location = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  let placed = 0;
  let skipped = 0;
  let moved = 0;

  if (mode === 'compact') {
    // (a match that is overdue is taken as being played: it stays - unless another match is LIVE on its court: then it is waiting for that one and moves behind it)
    const liveCourts = new Set(rows.filter((r) => r.status === 'LIVE' && r.court_no).map((r) => r.court_no));
    const candidates = rows.filter((r) => r.status === 'PLANNED' && r.court_no && r.scheduled_at && !r.slot_locked && !keep.includes(r.id) && !(Date.parse(r.scheduled_at) <= now && now - Date.parse(r.scheduled_at) < 12 * 60 * MIN && !liveCourts.has(r.court_no)))
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.id - b.id);
    candidates.forEach((r) => {
      const entry = entries.find((e) => e.id === r.id);
      if (!entry) return;
      const players = playersOf(r);
      const current = entry.interval;
      const clash = slotProblem(entries, settings, players, entry.court, current, r.id);
      const found = findSlot(entries, settings, windows, players, lengthOf(r), notBefore, r.id);
      if (!found) return;
      if (!(found.slot[0] < current[0] || (clash && found.slot[0] !== current[0]))) return;
      entry.court = found.court;
      entry.interval = found.slot;
      update.run(new Date(found.slot[0]).toISOString(), found.court, 0, courtLabel(settings, found.court), r.id);
      moved += 1;
    });
    return { placed: 0, skipped: 0, moved };
  }

  const availableAt = (r) => Math.max(0, ...entries.filter((e) => e.players.some((p) => playersOf(r).includes(p))).map((e) => e.interval[1]));
  const todo = rows.filter((r) => r.status === 'PLANNED' && !r.scheduled_at);
  // round by round: the 1st round of every category (the weakest first: Novice, then Next Gen, then Elite), then the 2nd round of every category in the same order, and so on;
  // within a round of a category the pair whose players have been resting longest first
  todo.sort((a, b) => ((a.b_round || a.round || 0) - (b.b_round || b.round || 0)) || (categoryRank(a.category) - categoryRank(b.category)) || (availableAt(a) - availableAt(b)) || (a.id - b.id));
  todo.forEach((r) => {
    const players = playersOf(r);
    const found = findSlot(entries, settings, windows, players, lengthOf(r), notBefore, r.id);
    if (!found) { skipped += 1; return; }
    entries.push({ id: r.id, players, court: found.court, interval: found.slot });
    update.run(new Date(found.slot[0]).toISOString(), found.court, backfill ? 1 : 0, courtLabel(settings, found.court), r.id);
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
    // before the first match is played the whole automatic schedule is laid out again (the matches placed by hand stay), so the order of the categories
    // does not depend on the order in which the draws were made; later only the new matches are added
    const started = db.prepare("SELECT 1 FROM matches WHERE season_id = ? AND status IN ('LIVE', 'FINISHED') LIMIT 1").get(seasonId);
    autoPlan(seasonId, { mode: started ? 'fill' : 'rebuild' });
    autoPlan(seasonId, { mode: 'compact' });
  } catch (err) {
    console.error('[tournament schedule]', err.message);
  }
}

// A match was restarted (PLANNED again at its time): a match that had moved forward onto that time while it was finished would stand at the same time on the
// same court. The restarted match keeps its time and the planner moves the others back behind it (only with automatic scheduling on). Never throws.
function afterRestart(seasonId, matchId, now = Date.now()) {
  try {
    if (!seasonId) return;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
    if (!season || season.kind !== 'TOURNAMENT' || !season.court_count || season.auto_schedule === 0) return;
    autoPlan(seasonId, { mode: 'compact', now, keep: [matchId] });
  } catch (err) {
    console.error('[tournament schedule]', err.message);
  }
}

// A match that is being played longer than its planned length keeps its court busy, but nothing is saved when time just passes, so the matches after it would stay
// where they were. This is run by a timer (server.js): for every tournament with automatic scheduling and a LIVE match past its planned end it runs the compact
// planner (the matches behind move later, in steps of the time grid). -> the ids of the tournaments whose schedule changed
function replanOverrunning(now = Date.now()) {
  const changed = [];
  try {
    const live = db.prepare(`
      SELECT m.* FROM matches m JOIN seasons s ON s.id = m.season_id
      WHERE m.status = 'LIVE' AND m.court_no IS NOT NULL AND s.kind = 'TOURNAMENT' AND s.court_count > 0 AND s.auto_schedule != 0`).all();
    const bySeason = new Map();
    live.forEach((m) => {
      const season = bySeason.get(m.season_id) || db.prepare('SELECT * FROM seasons WHERE id = ?').get(m.season_id);
      bySeason.set(m.season_id, season);
      const start = ms(m.scheduled_at) ?? ms(m.start_time);
      if (start !== null && now > start + durationOf(m, settingsOf(season))) bySeason.get(m.season_id).overrun = true;
    });
    bySeason.forEach((season, seasonId) => {
      if (!season.overrun) return;
      const result = autoPlan(seasonId, { mode: 'compact', now });
      if (result && result.moved > 0) changed.push(seasonId);
    });
  } catch (err) {
    console.error('[tournament schedule]', err.message);
  }
  return changed;
}

// The length of one match in minutes, set by the organiser (15–300, a multiple of 5); null = the length of the tournament's matches again.
// A match whose real end is not known (a result entered by hand) occupies its court for this long. After a change the planner moves the
// following matches forward (or back) when "automatic schedule" is on. -> { error, status } or { ok }
function setDuration(season, token, minutes) {
  const match = db.prepare('SELECT * FROM matches WHERE share_token = ? AND season_id = ?').get(token, season.id);
  if (!match) return { status: 404, error: 'Match not found in this tournament' };
  if (match.status === 'LIVE') return { status: 409, error: 'A match that is being played cannot be given another length' };
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 15 || minutes > 300 || minutes % 5 !== 0)) return { status: 400, error: 'The length of a match must be 15 to 300 minutes, a multiple of 5' };
  if (match.status === 'FINISHED') {
    // a finished match is drawn from its real start to its real end; once the organiser sets a length (or moves it) it is drawn from scheduled_at + length instead
    // (the real times stay in the match). null = back to the real times.
    if (minutes === null) {
      db.prepare("UPDATE matches SET duration_minutes = NULL, manual_block = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(match.id);
    } else {
      let scheduledAt = match.scheduled_at;
      if (!match.manual_block) {
        const current = intervalOf(match, settingsOf(season), Date.now());
        if (current) scheduledAt = new Date(current[0]).toISOString();
      }
      db.prepare("UPDATE matches SET duration_minutes = ?, manual_block = 1, scheduled_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(minutes, scheduledAt, match.id);
    }
    autoPlanIfEnabled(season.id);
    return { ok: true };
  }
  db.prepare("UPDATE matches SET duration_minutes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(minutes, match.id);
  autoPlanIfEnabled(season.id);
  return { ok: true };
}

module.exports = {
  settingsOf,
  readSettings,
  storeSettings,
  saveSettings,
  SETTING_KEYS,
  courtLabel,
  getSchedule,
  getCourtLive,
  tournamentStartMs,
  tournamentStarted,
  tournamentEndMs,
  tournamentEnded,
  placeMatch,
  setLocked,
  setDuration,
  autoPlan,
  autoPlanIfEnabled,
  afterRestart,
  replanOverrunning,
  localToUtcMs,
};
