const db = require('../../db');
const leagues = require('../../leagues');
const { requireAdmin } = require('../../auth');
const auth = require('../../auth');
const tournamentDraw = require('../../tournamentDraw');
const matchPhotos = require('../matchPhotos');
const rankingPoints = require('../../rankingPoints');
const communityPoints = require('../../communityPoints');
const clubTournaments = require('../../clubTournaments');
const changeLog = require('../../changeLog');
const capacity = require('../../registrationCapacity');
const courtStreams = require('../../courtStreams');
const courtNames = require('../../courtNames');
const paymentQr = require('../../paymentQr');
const tournamentSchedule = require('../../tournamentSchedule');
const router = require('./router');
const { readNewSeason, insertSeason, serializeSeason, renameSlug, parseDate, KINDS, categoriesToStore, readRules, parseCategories, PLANNED_FORMATS, announceNewlyIn, sanitizeHtml, normalizeRules } = require('./shared');

router.post('/', requireAdmin, (req, res) => {
  const read = readNewSeason(req.body);
  if (read.error) return res.status(400).json({ error: read.error });
  const made = insertSeason(read.values, leagues.actingIdOf(req));
  if (req.body.hidden === true) { db.prepare('UPDATE seasons SET hidden = 1 WHERE id = ?').run(made.id); made.hidden = 1; }
  res.status(201).json(serializeSeason(made));
});

router.patch('/:id', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : season.name;
  if (!name) return res.status(400).json({ error: 'Season name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Season name is too long (max 120 characters)' });
  // singles or doubles is chosen when the tournament is made and stays (a tournament is never mixed)
  if (req.body.playType !== undefined && req.body.playType !== (season.play_type || 'SINGLES')) return res.status(409).json({ error: 'A tournament stays singles or doubles — make a new tournament for the other type' });
  const start = req.body.startDate !== undefined ? parseDate(req.body.startDate) : { value: season.start_date };
  const end = req.body.endDate !== undefined ? parseDate(req.body.endDate) : { value: season.end_date };
  if (start.error || end.error) return res.status(400).json({ error: start.error || end.error });
  if (start.value && end.value && start.value > end.value) return res.status(400).json({ error: 'The end date is before the start date' });
  // the season page's optional texts: left as they are when not sent, cleared with an empty string
  const text = (key, current, max) => {
    if (req.body[key] === undefined) return { value: current };
    const v = String(req.body[key] || '').trim();
    if (v.length > max) return { error: `${key} is too long (max ${max} characters)` };
    return { value: v || null };
  };
  const fee = text('entryFee', season.entry_fee, 40);
  const prize = text('prizeMoney', season.prize_money, 120);
  // the description: cleaned HTML; nothing left but empty tags/spaces means "no description"
  let info = { value: season.info };
  if (req.body.info !== undefined) {
    const clean = sanitizeHtml(req.body.info).trim();
    const empty = !clean.replace(/<[^>]*>|&nbsp;|\s/g, '');
    info = clean.length > 8000 ? { error: 'The description is too long' } : { value: empty ? null : clean };
  }
  // the rules: cleaned HTML like the description (nothing left but empty tags = none)
  let rules = { value: season.rules };
  if (req.body.rules !== undefined) {
    const clean = sanitizeHtml(req.body.rules).trim();
    const empty = !clean.replace(/<[^>]*>|&nbsp;|\s/g, '');
    rules = clean.length > 20000 ? { error: 'The rules are too long' } : { value: empty ? null : clean };
  }
  const gallery = text('galleryUrl', season.gallery_url, 500);
  const payment = text('paymentUrl', season.payment_url, 500);
  const logo = text('logoUrl', season.logo_url, 300);
  // the IBAN of the entry fee of this event: spaces and capitals are put right; empty = the IBAN of Backend > Contact
  const ibanText = text('iban', season.iban, 60);
  if (!ibanText.error && req.body.iban !== undefined && ibanText.value && !paymentQr.cleanIban(ibanText.value)) return res.status(400).json({ error: 'The IBAN does not look right (e.g. SK31 1200 0000 1987 4263 7541)' });
  const payRecipient = text('payRecipient', season.pay_recipient, 120);
  const payNote = text('payNote', season.pay_note, 140);
  const payTitle = text('payTitle', season.pay_title, 120);
  if (payRecipient.error || payNote.error || payTitle.error) return res.status(400).json({ error: payRecipient.error || payNote.error || payTitle.error });
  const iban = { value: ibanText.value ? paymentQr.cleanIban(ibanText.value) : ibanText.value };
  const draw = req.body.drawDate !== undefined ? parseDate(req.body.drawDate) : { value: season.draw_date };
  const venue = text('venue', season.venue, 200);
  const balls = text('balls', season.balls, 100); // the balls the tournament is played with (a tile of the page)
  // the court surfaces (a tile of the page, before the balls): one or more of these, kept as "clay,hard" in this order; '' = not said
  const SURFACES = ['clay', 'hard', 'grass', 'taraflex'];
  let surface = { value: season.surface || '' };
  if (req.body.surface !== undefined) {
    const picked = (Array.isArray(req.body.surface) ? req.body.surface : String(req.body.surface || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    if (picked.some((x) => !SURFACES.includes(x))) return res.status(400).json({ error: 'The surface must be clay, hard, grass or taraflex' });
    surface = { value: SURFACES.filter((x) => picked.includes(x)).join(',') };
  }
  // the organiser of a club cannot change what a club tournament is (only an admin of the site may)
  const kind = req.body.kind === undefined || !auth.isAdmin(req) ? (season.kind || 'LEAGUE') : req.body.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'The type must be LEAGUE or TOURNAMENT' });
  const categories = req.body.categories === undefined || tournamentDraw.isDoublesTournament(season) ? season.categories : categoriesToStore(req.body.categories);
  const askedRules = readRules(req.body);
  if (askedRules.error) return res.status(400).json({ error: askedRules.error });
  // the points the event is to put into the ranking of its community (undefined = not named, null = none)
  let communityPts;
  if (req.body.communityPoints !== undefined) {
    if (!season.organisation_id) return res.status(400).json({ error: 'Only an event of a community or club has ranking points' });
    const read = communityPoints.readSettings(req.body.communityPoints, { ...season, categories });
    if (read.error) return res.status(400).json({ error: read.error });
    communityPts = read.value;
  }
  // unchanged unless the request names them
  let scoring = season.scoring;
  let tiebreakers = season.tiebreakers;
  if (askedRules.scoring !== undefined || askedRules.tiebreakers !== undefined) {
    const now = normalizeRules({ scoring: season.scoring, tiebreakers: season.tiebreakers });
    const next = normalizeRules({ scoring: askedRules.scoring !== undefined ? askedRules.scoring : now.scoring, tiebreakers: askedRules.tiebreakers !== undefined ? askedRules.tiebreakers : now.tiebreakers });
    scoring = next.scoring;
    tiebreakers = next.tiebreakers.join(',');
  }
  const bad = fee.error || prize.error || info.error || rules.error || gallery.error || payment.error || logo.error || draw.error || venue.error || balls.error;
  if (bad) return res.status(400).json({ error: bad });
  if (gallery.value && !/^https?:\/\//i.test(gallery.value)) return res.status(400).json({ error: 'The gallery link must start with http:// or https://' });
  if (payment.value && !/^https?:\/\//i.test(payment.value)) return res.status(400).json({ error: 'The payment link must start with http:// or https://' });
  if (logo.value && !/^(https?:\/\/|\/)/i.test(logo.value)) return res.status(400).json({ error: 'The logo must be a link starting with http://, https:// or /' });
  if (logo.value && logo.value !== season.logo_url && !auth.isAdmin(req) && !/^https:\/\//i.test(logo.value)) return res.status(400).json({ error: 'The logo must be a link starting with https:// (or uploaded)' });
  const open = req.body.registrationOpen === undefined ? season.registration_open : (req.body.registrationOpen ? 1 : 0);
  // the most players that can register: one for the event, or one for each category when the player chooses a category (see registrationCapacity.js)
  const readMax = (value) => {
    if (value === null || value === '' || Number(value) === 0) return { value: null };
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 2000 ? { value: n } : { error: 'The maximum number of players is a whole number from 1 to 2000' };
  };
  let maxPlayers = season.max_players || null;
  if (req.body.maxPlayers !== undefined) {
    const m = readMax(req.body.maxPlayers);
    if (m.error) return res.status(400).json({ error: m.error });
    maxPlayers = m.value;
  }
  const categoryMax = capacity.categoryMaxOf(season);
  if (req.body.categoryMax !== undefined) {
    if (!req.body.categoryMax || typeof req.body.categoryMax !== 'object' || Array.isArray(req.body.categoryMax)) return res.status(400).json({ error: 'categoryMax must be an object like { "ELITE": 16 }' });
    for (const key of capacity.CATEGORY_KEYS) {
      if (req.body.categoryMax[key] === undefined) continue;
      const m = readMax(req.body.categoryMax[key]);
      if (m.error) return res.status(400).json({ error: m.error });
      if (m.value === null) delete categoryMax[key]; else categoryMax[key] = m.value;
    }
  }
  // one maximum for the whole season replaces the maximums of the categories a season made before it may still have
  if (req.body.maxPlayers !== undefined && maxPlayers) Object.keys(categoryMax).forEach((k) => delete categoryMax[k]);
  const nextSeason = { ...season, kind, categories, max_players: maxPlayers, category_max: JSON.stringify(categoryMax) };
  // "always enter the maximum": a save that touches the registration (or opens it) is refused while the maximum is missing (for every category of a season with categories)
  const touchesRegistration = ['registrationOpen', 'maxPlayers', 'categoryMax'].some((k) => req.body[k] !== undefined);
  if (open && touchesRegistration && !capacity.limitsComplete(nextSeason, parseCategories(categories))) {
    return res.status(400).json({ code: 'MAX_PLAYERS_REQUIRED', error: capacity.perCategory(nextSeason) ? 'Enter the maximum number of players for every category' : 'Enter the maximum number of players' });
  }
  const waitingBefore = capacity.substituteIds(season);
  // how many hours before the start a registered player may drop out himself (empty = he may not; 0 = until the start)
  let unregisterHours = season.unregister_hours === undefined ? null : season.unregister_hours;
  if (req.body.unregisterHours !== undefined) {
    if (req.body.unregisterHours === null || req.body.unregisterHours === '') unregisterHours = null;
    else {
      unregisterHours = Number(req.body.unregisterHours);
      if (!Number.isInteger(unregisterHours) || unregisterHours < 0 || unregisterHours > 720) return res.status(400).json({ error: 'The hours before the start must be a whole number from 0 to 720 (empty: the player cannot drop out alone)' });
    }
  }
  let courts = season.court_count || 0;
  if (req.body.courtCount !== undefined) {
    courts = Number(req.body.courtCount);
    if (!Number.isInteger(courts) || courts < 0 || courts > 50) return res.status(400).json({ error: 'The number of courts must be a whole number from 0 to 50' });
  }
  // the live video of each court: the list sent by the admin page (one link or '' per court), else the saved ones cut or padded to the number of courts
  let streamIds = courtStreams.fitToCount(season, courts);
  if (req.body.courtStreams !== undefined) {
    const parsed = courtStreams.parseCourtStreams(req.body.courtStreams, courts);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    streamIds = parsed.ids;
  }
  // the names of the courts (one per court, '' = "Kurt <number>"): the list sent by the admin page, else the saved ones cut or padded to the number of courts
  let namesList = courtNames.fit(season, courts);
  if (req.body.courtNames !== undefined) {
    const parsedNames = courtNames.parse(req.body.courtNames, courts);
    if (parsedNames.error) return res.status(400).json({ error: parsedNames.error });
    namesList = parsedNames.names;
  }
  let maxPerDay = season.max_matches_per_day || 0;
  if (req.body.maxMatchesPerDay !== undefined) {
    maxPerDay = Number(req.body.maxMatchesPerDay);
    if (!Number.isInteger(maxPerDay) || maxPerDay < 0 || maxPerDay > 10) return res.status(400).json({ error: 'The most matches a player may play in a day must be 0 (no limit) to 10' });
  }
  // the planning of a tournament (match length, playing day, rest, automatic schedule) saved with the rest of its page; checked like in the court schedule before anything is written
  // (the most matches a day is the field above, so the value just checked goes along and is not written over)
  let planning = null;
  if (season.kind === 'TOURNAMENT' && tournamentSchedule.SETTING_KEYS.some((k) => k !== 'maxPerDay' && req.body[k] !== undefined)) {
    const planned = tournamentSchedule.readSettings({ ...season, start_date: start.value, end_date: end.value }, { ...req.body, maxPerDay }); // (with the dates of THIS save: the days of the tournament may change with it)
    if (planned.error) return res.status(400).json({ error: planned.error });
    planning = planned.next;
  }
  db.prepare('UPDATE seasons SET name = ?, start_date = ?, end_date = ?, entry_fee = ?, prize_money = ?, draw_date = ?, info = ?, gallery_url = ?, payment_url = ?, iban = ?, pay_recipient = ?, pay_note = ?, pay_title = ?, logo_url = ?, registration_open = ?, kind = ?, venue = ?, balls = ?, surface = ?, categories = ?, court_count = ?, max_matches_per_day = ?, scoring = ?, tiebreakers = ?, max_players = ?, category_max = ? WHERE id = ?')
    .run(name, start.value, end.value, fee.value, prize.value, draw.value, info.value, gallery.value, payment.value, iban.value, payRecipient.value, payNote.value, payTitle.value, logo.value, open, kind, venue.value, balls.value, surface.value, categories, courts, maxPerDay, scoring, tiebreakers, maxPlayers, nextSeason.category_max, season.id);
  if (planning) tournamentSchedule.storeSettings(season.id, planning);
  if (typeof req.body.hidden === 'boolean') db.prepare('UPDATE seasons SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, season.id);
  db.prepare('UPDATE seasons SET unregister_hours = ? WHERE id = ?').run(unregisterHours, season.id);
  if (req.body.rules !== undefined) db.prepare('UPDATE seasons SET rules = ? WHERE id = ?').run(rules.value, season.id);
  if (req.body.plannedFormat !== undefined) db.prepare('UPDATE seasons SET planned_format = ? WHERE id = ?').run(PLANNED_FORMATS.includes(req.body.plannedFormat) ? req.body.plannedFormat : null, season.id);
  db.prepare('UPDATE seasons SET court_streams = ? WHERE id = ?').run(JSON.stringify(streamIds), season.id);
  // a court that got another name: the matches already placed on it show the new one
  const oldNames = courtNames.namesOf(season);
  const renameCourt = db.prepare('UPDATE matches SET location = ? WHERE season_id = ? AND court_no = ? AND location = ?');
  for (let n = 1; n <= Math.max(oldNames.length, namesList.length, season.court_count || 0); n += 1) {
    const before = courtNames.label(oldNames, n);
    const after = courtNames.label(namesList, n);
    if (before !== after) renameCourt.run(after, season.id, n, before);
  }
  db.prepare('UPDATE seasons SET court_names = ? WHERE id = ?').run(JSON.stringify(namesList), season.id);
  // the points of a community follow the new settings, and the scoring of the season (what a match is worth in its table)
  const pointsChanged = communityPts !== undefined && communityPts !== (season.community_points || null);
  if (pointsChanged) db.prepare('UPDATE seasons SET community_points = ? WHERE id = ?').run(communityPts, season.id);
  if (season.organisation_id && (pointsChanged || scoring !== season.scoring)) {
    try { communityPoints.resync(season.id); } catch (err) { console.error('[community points]', err.message); }
  }
  // the address follows the name: a new name (or a name saved again whose address is still an older one) gives the season the address of that
  // name; nothing changes when the address already fits; the old address keeps leading to it
  if (req.body.name !== undefined) renameSlug(season, name);
  const saved = db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id);
  announceNewlyIn(saved, waitingBefore); // a raised maximum lets the first substitutes in
  res.json(serializeSeason(saved));
});

// Deleting a season deletes its groups and clears the season/group on the matches that had them
// (the matches themselves are untouched).
// ?withMatches=1 (tournaments only): the tournament goes together with ALL its matches, its brackets, registrations and groups. A deleted
// match takes the ranking points it added back with it, like deleting one match does (the CourtIQ rating of the players is not recalculated).
function deleteTournamentWithMatches(req, res, season) {
  if (season.kind !== 'TOURNAMENT' && !season.organisation_id) return res.status(400).json({ error: 'Only a tournament or a season of a community or club can be deleted together with its matches' });
  const matches = db.prepare('SELECT * FROM matches WHERE season_id = ?').all(season.id);
  const brackets = db.prepare('SELECT id FROM brackets WHERE season_id = ?').all(season.id).map((b) => b.id);
  db.exec('BEGIN');
  try {
    matches.forEach((m) => {
      db.prepare('DELETE FROM messages WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM match_notifications WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM push_subscriptions WHERE match_id = ?').run(m.id);
      matchPhotos.removeAllForMatch(m.id);
      db.prepare('UPDATE bracket_matches SET match_id = NULL WHERE match_id = ?').run(m.id);
      db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
    });
    brackets.forEach((id) => {
      db.prepare('DELETE FROM bracket_partners WHERE bracket_id = ?').run(id);
      db.prepare('DELETE FROM bracket_matches WHERE bracket_id = ?').run(id);
      db.prepare('DELETE FROM brackets WHERE id = ?').run(id);
    });
    db.prepare('DELETE FROM season_group_members WHERE group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(season.id);
    db.prepare('DELETE FROM season_groups WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM season_registrations WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM tournament_pairs WHERE season_id = ?').run(season.id);
    db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
    communityPoints.removeSeason(season.id); // what it paid into the ranking of its community goes back
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  require('../seasonPhotos').removeAllForSeason(season.id); // the gallery goes too (the files leave Drive in the background)
  db.prepare('DELETE FROM registration_notifications WHERE season_id = ?').run(season.id);
  matches.forEach((m) => {
    try {
      const ranking = rankingPoints.reverseForMatchWithChanges(m.id);
      try { changeLog.logMatchDeleted(m, ranking); } catch (err) { console.error('[change log]', err.message); }
    } catch (err) {
      console.error('[seasons] failed to reverse ranking points on delete:', err.message);
    }
  });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'DELETED' });
  return res.json({ ok: true, deletedMatches: matches.length });
}

router.delete('/:id', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  // the organiser of a club deletes his tournament together with its matches, and only while none of them is finished (an admin of the site may always)
  if (!auth.isAdmin(req)) {
    if (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE season_id = ? AND status = 'FINISHED'").get(season.id).n > 0) {
      return res.status(409).json({ error: 'A tournament or season with finished matches can only be deleted by an admin of the site' });
    }
    return deleteTournamentWithMatches(req, res, season);
  }
  if (req.query.withMatches === '1') return deleteTournamentWithMatches(req, res, season);
  db.prepare('UPDATE matches SET group_id = NULL WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM season_group_members WHERE group_id IN (SELECT id FROM season_groups WHERE season_id = ?)').run(season.id);
  db.prepare('DELETE FROM season_registrations WHERE season_id = ?').run(season.id);
  db.prepare('DELETE FROM tournament_pairs WHERE season_id = ?').run(season.id);
  communityPoints.removeSeason(season.id); // what it paid into the ranking of its community goes back
  db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
  require('../seasonPhotos').removeAllForSeason(season.id); // the gallery goes too (the files leave Drive in the background)
  db.prepare('DELETE FROM registration_notifications WHERE season_id = ?').run(season.id);
  res.json({ ok: true });
});
