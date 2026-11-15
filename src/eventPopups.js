// Pop-ups about an event (Backend > Popups): "Don't forget to register for the next season". A pop-up belongs to a city and to one season or tournament of
// it, is active between two dates and is shown to the logged-in players of the site who are not registered for that event yet. Per player it remembers
// what happened: closed with the cross (it comes back after `repeat_days` days, 3 by default) or "I don't want to register" (never again). A player who
// registers (through the pop-up or on the page of the event) is not asked any more. The numbers (shown / registered / declined / waiting) are counted from
// the same rows, so the organiser sees what the pop-up did.
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS event_popups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    headline_sk TEXT NOT NULL DEFAULT '',
    headline_en TEXT NOT NULL DEFAULT '',
    message_sk TEXT NOT NULL DEFAULT '',
    message_en TEXT NOT NULL DEFAULT '',
    starts_at TEXT,
    ends_at TEXT,
    repeat_days INTEGER NOT NULL DEFAULT 3,
    audience TEXT NOT NULL DEFAULT 'ALL',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_event_popups_league ON event_popups(league_id);
  CREATE TABLE IF NOT EXISTS event_popup_responses (
    popup_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    shown_count INTEGER NOT NULL DEFAULT 0,
    dismissed_count INTEGER NOT NULL DEFAULT 0,
    first_shown_at TEXT,
    last_shown_at TEXT,
    last_dismissed_at TEXT,
    declined_at TEXT,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (popup_id, player_id)
  );
`);

const DAY = 86400000;
const AUDIENCES = ['ALL', 'PAST'];
const REASONS = ['NO_TIME', 'NOT_THIS_TIME', 'OTHER'];
const MAX_REPEAT_DAYS = 60;

const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const dateOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
// today in Slovakia (the dates of a pop-up are calendar days there)
const today = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(new Date(now));

const seasonsOf = (leagueId) => db.prepare("SELECT * FROM seasons WHERE league_id = ? AND organisation_id IS NULL AND COALESCE(slug, '') != '' ORDER BY start_date DESC, id DESC").all(leagueId);

// the registration can still be made (the switch is on, the event is not over, a tournament has not started)
function registrationAvailable(season, now = Date.now()) {
  if (!season || !season.registration_open) return false;
  if (season.end_date && season.end_date < today(now)) return false;
  return !require('./tournamentSchedule').tournamentStarted(season, now);
}

// what a pop-up is in the Backend's words
function statusOf(p, season, now = Date.now()) {
  if (!p.enabled) return 'OFF';
  const t = today(now);
  if (p.starts_at && t < p.starts_at) return 'SCHEDULED';
  if (p.ends_at && t > p.ends_at) return 'ENDED';
  if (!registrationAvailable(season, now)) return 'CLOSED'; // the event takes no registration (any more): nothing to ask
  return 'ACTIVE';
}

function counts(popup) {
  const rows = db.prepare('SELECT * FROM event_popup_responses WHERE popup_id = ?').all(popup.id);
  const registered = new Set(db.prepare('SELECT player_id FROM season_registrations WHERE season_id = ? AND player_id IS NOT NULL').all(popup.season_id).map((r) => r.player_id));
  const shown = rows.filter((r) => r.shown_count > 0);
  const names = new Map(db.prepare(`SELECT id, name FROM players WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'})`).all(...rows.map((r) => r.player_id)).map((p) => [p.id, p.name]));
  const out = { declinedPlayers: [], shown: shown.length, impressions: rows.reduce((n, r) => n + r.shown_count, 0), registered: 0, declined: 0, waiting: 0, reasons: { NO_TIME: 0, NOT_THIS_TIME: 0, OTHER: 0 } };
  for (const r of shown) {
    if (registered.has(r.player_id)) out.registered += 1;
    else if (r.declined_at) { out.declined += 1; out.declinedPlayers.push({ id: r.player_id, name: names.get(r.player_id) || '(deleted player)', reason: r.reason || '', at: r.declined_at }); if (out.reasons[r.reason] !== undefined) out.reasons[r.reason] += 1; } else out.waiting += 1;
  }
  out.declinedPlayers.sort((a, b) => b.at.localeCompare(a.at)); // the latest first
  return out;
}

const serialize = (p, now = Date.now()) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(p.season_id);
  return {
    id: p.id, seasonId: p.season_id, seasonName: season ? season.name : '(deleted)', seasonKind: season && season.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE',
    enabled: !!p.enabled, headline: { sk: p.headline_sk, en: p.headline_en }, message: { sk: p.message_sk, en: p.message_en },
    startsAt: p.starts_at || '', endsAt: p.ends_at || '', repeatDays: p.repeat_days, audience: p.audience,
    status: statusOf(p, season, now), stats: counts(p), updatedAt: p.updated_at,
  };
};

const list = (leagueId, now) => db.prepare('SELECT * FROM event_popups WHERE league_id = ? ORDER BY id DESC').all(leagueId).map((p) => serialize(p, now));

// the events a pop-up can be about (the ones of this city), the open ones first
function eventOptions(leagueId, now = Date.now()) {
  return seasonsOf(leagueId).map((s) => ({ id: s.id, name: s.name, kind: s.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE', startDate: s.start_date || '', endDate: s.end_date || '', registrationOpen: registrationAvailable(s, now) }))
    .sort((a, b) => Number(b.registrationOpen) - Number(a.registrationOpen));
}

// -> { error } or the clean values of the editor
function clean(leagueId, body) {
  const b = body || {};
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(b.seasonId));
  if (!season || season.league_id !== leagueId || season.organisation_id) return { error: 'Choose a season or a tournament of this city' };
  const startsAt = b.startsAt ? String(b.startsAt) : '';
  const endsAt = b.endsAt ? String(b.endsAt) : '';
  if (startsAt && !dateOk(startsAt)) return { error: 'The date "from" is not valid' };
  if (endsAt && !dateOk(endsAt)) return { error: 'The date "to" is not valid' };
  if (startsAt && endsAt && endsAt < startsAt) return { error: 'The pop-up cannot end before it starts' };
  const repeat = b.repeatDays === undefined || b.repeatDays === '' ? 3 : Number(b.repeatDays);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT_DAYS) return { error: `Show it again after 1 to ${MAX_REPEAT_DAYS} days` };
  const audience = AUDIENCES.includes(b.audience) ? b.audience : 'ALL';
  const headline = b.headline || {};
  const message = b.message || {};
  return {
    values: {
      season_id: season.id, enabled: b.enabled === false ? 0 : 1,
      headline_sk: text(headline.sk, 90), headline_en: text(headline.en, 90), message_sk: text(message.sk, 400), message_en: text(message.en, 400),
      starts_at: startsAt || null, ends_at: endsAt || null, repeat_days: repeat, audience,
    },
  };
}

function create(leagueId, body) {
  const c = clean(leagueId, body);
  if (c.error) return c;
  const v = c.values;
  const id = Number(db.prepare('INSERT INTO event_popups (league_id, season_id, enabled, headline_sk, headline_en, message_sk, message_en, starts_at, ends_at, repeat_days, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(leagueId, v.season_id, v.enabled, v.headline_sk, v.headline_en, v.message_sk, v.message_en, v.starts_at, v.ends_at, v.repeat_days, v.audience).lastInsertRowid);
  return { id };
}

function update(popup, body) {
  const c = clean(popup.league_id, body);
  if (c.error) return c;
  const v = c.values;
  db.prepare("UPDATE event_popups SET season_id = ?, enabled = ?, headline_sk = ?, headline_en = ?, message_sk = ?, message_en = ?, starts_at = ?, ends_at = ?, repeat_days = ?, audience = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(v.season_id, v.enabled, v.headline_sk, v.headline_en, v.message_sk, v.message_en, v.starts_at, v.ends_at, v.repeat_days, v.audience, popup.id);
  return { id: popup.id };
}

function remove(popup) {
  db.prepare('DELETE FROM event_popup_responses WHERE popup_id = ?').run(popup.id);
  db.prepare('DELETE FROM event_popups WHERE id = ?').run(popup.id);
}

// everybody who closed it or said no is asked again (e.g. after the dates or the event changed)
function resetResponses(popup) {
  db.prepare('UPDATE event_popup_responses SET dismissed_count = 0, last_dismissed_at = NULL, declined_at = NULL, reason = \'\' WHERE popup_id = ?').run(popup.id);
}

// has this player played in this city before (a registration or a match in another season of it): for the audience "players of earlier seasons"
function playedBefore(playerId, leagueId, exceptSeasonId) {
  return !!db.prepare(`
    SELECT 1 FROM season_registrations r JOIN seasons s ON s.id = r.season_id WHERE r.player_id = ? AND s.league_id = ? AND s.id != ?
    UNION ALL
    SELECT 1 FROM matches m JOIN seasons s ON s.id = m.season_id WHERE (m.player1_id = ? OR m.player2_id = ?) AND s.league_id = ? AND s.id != ?
    LIMIT 1`).get(playerId, leagueId, exceptSeasonId, playerId, playerId, leagueId, exceptSeasonId);
}

// the pop-up to show to this player on this city's site now, or null: the active ones, not for a player who is registered, who said no, or who closed it
// less than `repeat_days` days ago; the one that ends soonest goes first
function nextFor(playerId, leagueId, now = Date.now()) {
  if (!playerId) return null;
  const t = today(now);
  const candidates = db.prepare('SELECT * FROM event_popups WHERE league_id = ? AND enabled = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?) ORDER BY COALESCE(ends_at, \'9999-12-31\'), id').all(leagueId, t, t);
  for (const p of candidates) {
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(p.season_id);
    if (!season || season.league_id !== leagueId || season.organisation_id || !season.slug || !registrationAvailable(season, now)) continue;
    if (db.prepare('SELECT 1 FROM season_registrations WHERE season_id = ? AND player_id = ?').get(p.season_id, playerId)) continue;
    const r = db.prepare('SELECT * FROM event_popup_responses WHERE popup_id = ? AND player_id = ?').get(p.id, playerId);
    if (r && r.declined_at) continue;
    if (r && r.last_dismissed_at && now - Date.parse(r.last_dismissed_at) < p.repeat_days * DAY) continue;
    if (p.audience === 'PAST' && !playedBefore(playerId, leagueId, p.season_id)) continue;
    return p;
  }
  return null;
}

// what the browser needs to draw it (the player's own data to prefill the form comes from /api/player/session)
function payloadOf(p, now = Date.now()) {
  const s = db.prepare('SELECT * FROM seasons WHERE id = ?').get(p.season_id);
  const tournament = s.kind === 'TOURNAMENT';
  const doubles = tournament && s.play_type === 'DOUBLES';
  const { categories } = require('./routes/seasons').serializeSeason(s);
  return {
    id: p.id,
    headline: { sk: p.headline_sk, en: p.headline_en },
    message: { sk: p.message_sk, en: p.message_en },
    event: {
      id: s.id, name: s.name, slug: s.slug, kind: tournament ? 'TOURNAMENT' : 'LEAGUE', playType: doubles ? 'DOUBLES' : 'SINGLES', venue: s.venue || '',
      startDate: s.start_date || '', endDate: s.end_date || '', drawDate: s.draw_date || '', heroUrl: s.hero_url || '', heroMobileUrl: s.hero_mobile_url || '',
      categories: doubles ? [] : categories, categoryChoice: !(tournament || (categories || []).includes('OPEN')),
      entryFee: s.entry_fee || '', paymentUrl: s.payment_url || '', iban: s.iban || '', payRecipient: s.pay_recipient || '', payNote: s.pay_note || '', payTitle: s.pay_title || '', codePath: `/${tournament ? 'tournament' : 'season'}/${encodeURIComponent(s.slug)}`,
    },
    asOf: now,
  };
}

// the player sees it / closes it with the cross / says no (and maybe why)
function ensureRow(popupId, playerId) {
  db.prepare('INSERT OR IGNORE INTO event_popup_responses (popup_id, player_id) VALUES (?, ?)').run(popupId, playerId);
}
const iso = (now) => new Date(now).toISOString();
function markShown(popupId, playerId, now = Date.now()) {
  ensureRow(popupId, playerId);
  db.prepare('UPDATE event_popup_responses SET shown_count = shown_count + 1, last_shown_at = ?, first_shown_at = COALESCE(first_shown_at, ?) WHERE popup_id = ? AND player_id = ?').run(iso(now), iso(now), popupId, playerId);
}
function markDismissed(popupId, playerId, now = Date.now()) {
  ensureRow(popupId, playerId);
  db.prepare('UPDATE event_popup_responses SET dismissed_count = dismissed_count + 1, last_dismissed_at = ? WHERE popup_id = ? AND player_id = ?').run(iso(now), popupId, playerId);
}
function markDeclined(popupId, playerId, reason, now = Date.now()) {
  ensureRow(popupId, playerId);
  db.prepare('UPDATE event_popup_responses SET declined_at = ?, reason = ? WHERE popup_id = ? AND player_id = ?').run(iso(now), REASONS.includes(reason) ? reason : '', popupId, playerId);
}
function setReason(popupId, playerId, reason) {
  if (!REASONS.includes(reason)) return;
  db.prepare('UPDATE event_popup_responses SET reason = ? WHERE popup_id = ? AND player_id = ? AND declined_at IS NOT NULL').run(reason, popupId, playerId);
}

module.exports = { list, eventOptions, create, update, remove, resetResponses, nextFor, payloadOf, markShown, markDismissed, markDeclined, setReason, statusOf, today, registrationAvailable, leagueOf: (id) => (db.prepare('SELECT league_id FROM event_popups WHERE id = ?').get(id) || {}).league_id, get: (id) => db.prepare('SELECT * FROM event_popups WHERE id = ?').get(id), serialize, REASONS };
