const db = require('../../db');
const leagues = require('../../leagues');
const standings = require('../../standings');
const nameMatch = require('../../nameMatch');
const mailer = require('../../mailer');
const tournamentDraw = require('../../tournamentDraw');
const communityPoints = require('../../communityPoints');
const capacity = require('../../registrationCapacity');
const seasonActivity = require('../../seasonActivity');
const courtStreams = require('../../courtStreams');
const courtNames = require('../../courtNames');
const tournamentSchedule = require('../../tournamentSchedule');

const { computeGroupStandings, rulesOfSeason, normalizeRules } = standings;

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'season';
}

function uniqueSlug(base, exceptId) {
  let slug = base;
  let n = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM seasons WHERE slug = ?').get(slug);
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

// The season description can be formatted in the backend editor. Only a small set of tags survives (paragraphs, line breaks,
// bold / italic / underline, lists, a heading, a quote and links to http(s)/mailto); every other tag is dropped, attributes are
// rebuilt by us, and text is escaped — so what is stored is safe to show on the public page as it is.
const HTML_TAGS = { p: 'p', div: 'p', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', ul: 'ul', ol: 'ol', li: 'li', h3: 'h3', h4: 'h3', blockquote: 'blockquote', a: 'a' };
function escapeText(text) {
  return text.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sanitizeHtml(input) {
  const html = String(input || '');
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;
  const open = [];
  let out = '';
  let last = 0;
  let m;
  while ((m = tag.exec(html))) {
    out += escapeText(html.slice(last, m.index));
    last = tag.lastIndex;
    const name = HTML_TAGS[m[2].toLowerCase()];
    if (!name) continue;
    if (name === 'br') { out += '<br>'; continue; }
    if (m[1] === '/') {
      if (open.includes(name)) {
        let top;
        do { top = open.pop(); out += `</${top}>`; } while (top !== name);
      }
      continue;
    }
    let attrs = '';
    if (name === 'a') {
      const href = m[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const url = href ? (href[1] !== undefined ? href[1] : href[2]).trim() : '';
      if (/^(https?:\/\/|mailto:)/i.test(url)) attrs = ` href="${url.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" target="_blank" rel="noopener"`;
    }
    out += `<${name}${attrs}>`;
    open.push(name);
  }
  out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Dates must look like 2026-09-07' };
  return { value };
}

// The players of a group, in the order they were added.
function groupMembers(groupId, group) {
  const pairs = group && group.category === 'DOUBLES';
  return db.prepare(`
    SELECT m.player_id AS id, p.name, p.slug, m.withdrawn_at, m.paid
    FROM season_group_members m JOIN players p ON p.id = m.player_id
    WHERE m.group_id = ? ORDER BY m.sort_order, m.id
  `).all(groupId).map((r) => {
    const who = pairs ? require('../../tournamentGroups').pairPlayer(group.season_id, r.id) : r;
    return { id: r.id, name: who.name, slug: pairs ? null : r.slug, withdrawn: !!r.withdrawn_at, paid: !!r.paid };
  });
}

function serializeGroup(g) {
  const members = groupMembers(g.id, g);
  return {
    id: g.id,
    seasonId: g.season_id,
    name: g.name,
    category: g.category,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE group_id = ?').get(g.id).n,
    members,
    activeMemberCount: members.filter((m) => !m.withdrawn).length,
  };
}

const CATEGORY_KEYS = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const KINDS = ['LEAGUE', 'TOURNAMENT'];
// the categories of a season as an array (all three when none is saved; ['OPEN'] for a tournament without categories)
function parseCategories(raw) {
  if (raw === 'OPEN') return ['OPEN'];
  const list = String(raw || '').split(',').filter((c) => CATEGORY_KEYS.includes(c));
  return list.length ? list : CATEGORY_KEYS;
}
// a request's category list as the stored comma text; null = all of them; 'OPEN' = no categories at all (it wins over the others)
function categoriesToStore(list) {
  if (Array.isArray(list) && list.includes('OPEN')) return 'OPEN';
  const picked = (Array.isArray(list) ? list : []).filter((c) => CATEGORY_KEYS.includes(c));
  return picked.length && picked.length < CATEGORY_KEYS.length ? CATEGORY_KEYS.filter((c) => picked.includes(c)).join(',') : null;
}

const PLANNED_FORMATS = ['PRINCE', 'MONRAD', 'ELIMINATION', 'GROUPS', 'GROUPS_BRACKET', 'SWISS'];

function serializeSeason(s) {
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(s.id);
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE',
    // what a tournament is played as (chosen when it was made): singles in the categories, or doubles (Štvorhra) only
    playType: s.kind === 'TOURNAMENT' && s.play_type === 'DOUBLES' ? 'DOUBLES' : 'SINGLES',
    venue: s.venue || '',
    // how the group tables are calculated (a tournament made before the rules existed shows the defaults; a season shows them once it has chosen them, else null = the league's own way)
    scoring: s.kind === 'TOURNAMENT' || s.scoring ? normalizeRules({ scoring: s.scoring, tiebreakers: s.tiebreakers }).scoring : null,
    tiebreakers: s.kind === 'TOURNAMENT' || s.scoring ? normalizeRules({ scoring: s.scoring, tiebreakers: s.tiebreakers }).tiebreakers : null,
    categories: s.kind === 'TOURNAMENT' && s.play_type === 'DOUBLES' ? ['DOUBLES'] : parseCategories(s.categories),
    // the points the event is to put into the ranking of its community (only an event of a community has it): a season { coefficient: { ELITE: 10 } }, a tournament
    // { places: { ELITE: [100, 80, ...] } }; null for the league's own events
    communityPoints: s.organisation_id ? communityPoints.settingsOf(s) : null,
    startDate: s.start_date,
    endDate: s.end_date,
    entryFee: s.entry_fee || '',
    prizeMoney: s.prize_money || '',
    drawDate: s.draw_date || null,
    // the draws made in front of the camera that are saved in this tournament (one per category): the tile "Žreb naživo" lets everybody replay them
    liveDraws: db.prepare("SELECT id, category FROM draw_records WHERE season_id = ? AND status = 'COMMITTED' ORDER BY id").all(s.id).map((r) => ({ id: Number(r.id), category: r.category })),
    // the format the organiser plans to play (chosen in Backend > Základné info before the draw; once a category is drawn its own format counts): '' = not said yet
    plannedFormat: s.planned_format || '',
    info: s.info || '',
    rules: s.rules || '', // the rules of the event: cleaned HTML, shown on its page as an expandable "+ Pravidlá"
    galleryUrl: s.gallery_url || '',
    paymentUrl: s.payment_url || '',
    payRecipient: s.pay_recipient || '',
    payNote: s.pay_note || '',
    payTitle: s.pay_title || '',
    hidden: !!s.hidden, // not public: only an admin sees it
    iban: s.iban || '', // the account of this event's entry fee ('' = the one of Backend > Contact)
    logoUrl: s.logo_url || '',
    heroUrl: s.hero_url || '',
    heroMobileUrl: s.hero_mobile_url || '',
    registrationOpen: !!s.registration_open, // the switch of the Backend
    // what a visitor can really do: the switch is on AND the event has not ended AND a tournament has not started (its first day's start time has passed)
    registrationAvailable: registrationOpen(s),
    registrationStarted: tournamentStarted(s),
    // a tournament is over once the playing window of its last day has ended (the pages show "finished" by it, not only by the date)
    tournamentEnded: tournamentSchedule.tournamentEnded(s),
    // the most players that can register (null = none set) and, for a season where the player chooses a category, the most for each category; the ones after it are
    // substitutes (src/registrationCapacity.js)
    maxPlayers: s.max_players || null,
    categoryMax: capacity.categoryMaxOf(s),
    // how many hours before the start a registered player may drop out himself (null = he may not)
    unregisterHours: s.unregister_hours === null || s.unregister_hours === undefined ? null : s.unregister_hours,
    // the community or club that runs this tournament (null for the league and for the tournaments of the Backend)
    organisationId: s.organisation_id || null,
    courtCount: s.court_count || 0,
    courtNames: courtNames.fit(s, s.court_count || 0),
    // how each category of a tournament is played (chosen in Backend > Formát turnaja): [{ category, format: PRINCE | MONRAD | ELIMINATION | GROUPS | GROUPS_BRACKET | SWISS | SIX_ROUNDS }]
    drawFormats: s.kind === 'TOURNAMENT' ? db.prepare('SELECT category, format FROM tournament_categories WHERE season_id = ? ORDER BY category').all(s.id) : [],
    // the live video of each court: [{ videoId, url } or null] for Court 1 … n (src/courtStreams.js)
    courtStreams: courtStreams.streamsOf(s),
    maxMatchesPerDay: s.max_matches_per_day || 0,
    // the settings of the court planner (a tournament only): what the edit page shows under "Plánovanie turnaja"
    planning: s.kind === 'TOURNAMENT' ? (({ matchMinutes, dayStart, dayEnd, restMinutes, autoSchedule, ownDayTimes }) => ({ matchMinutes, dayStart, dayEnd, dayTimes: ownDayTimes, restMinutes, autoSchedule }))(tournamentSchedule.settingsOf(s)) : null,
    matchCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE season_id = ?').get(s.id).n,
    groups: groups.map(serializeGroup),
  };
}

// a tournament has started when the start time of its first day has passed: from then on nobody can register on the public page (the admin still can add a player)
function tournamentStarted(season, now = Date.now()) {
  return tournamentSchedule.tournamentStarted(season, now);
}

function registrationOpen(season) {
  const today = new Date().toISOString().slice(0, 10);
  return !!season.registration_open && !(season.end_date && season.end_date < today) && !tournamentStarted(season);
}

function serializeRegistration(r) {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, category: r.category, paid: !!r.paid, note: r.note || '', partnerName: r.partner_name || '', seed: r.seed || null, createdAt: r.created_at, playerId: r.player_id, remindedAt: r.reminded_at || null };
}

// the same with who is a substitute (waits after the maximum of players): substitute + substitutePosition (1, 2, ... among the substitutes of its category)
function serializeRegistrationsOf(season, rows) {
  const state = capacity.standing(season);
  return rows.map((r) => {
    const s = state.get(r.id) || { substitute: false, position: null };
    return { ...serializeRegistration(r), substitute: s.substitute, substitutePosition: s.position };
  });
}

// What a change did to the substitutes: the ones who were waiting before (ids) and are in now come into the tournament - a pair of a doubles tournament is made for
// them - and get an e-mail (when they gave one). Never makes the change fail.
function announceNewlyIn(season, waitingBefore) {
  try {
    const waitingNow = capacity.substituteIds(season);
    const contact = require('../contact').read();
    const organiser = [contact.email, contact.phone].filter(Boolean).join(' · ');
    [...waitingBefore].filter((id) => !waitingNow.has(id)).forEach((id) => {
      const r = db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(id);
      if (!r) return; // the one who dropped out was himself a substitute
      seasonActivity.log(season.id, 'PROMOTED', r.name, r.player_id);
      if (tournamentDraw.isDoublesTournament(season) && r.player_id) { try { tournamentDraw.addPair(season, { player: r.player_id, partner: r.partner_name }); } catch { /* the organiser makes the pair */ } }
      if (r.email) {
        const pageUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/${season.kind === 'TOURNAMENT' ? 'tournament' : 'season'}/${season.slug}` : '';
        mailer.sendSubstituteInEmail({ to: r.email, name: r.name, seasonName: season.name, pageUrl, organiser }).catch((err) => console.error('[substitute] e-mail failed:', err.message));
      }
    });
  } catch (err) {
    console.error('[substitute] could not announce:', err.message);
  }
}

// The category written in a player's profile ("Next Gen", "ELITE"…) as one of ours, or null.
function profileCategory(raw) {
  const key = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return key === 'ELITE' ? 'ELITE' : key === 'NEXTGEN' ? 'NEXT_GEN' : key === 'NOVICE' ? 'NOVICE' : null;
}

// ---------------- tournament draw: seeds, main bracket + consolation bracket (admin) ----------------

function tournamentOr404(req, res) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) { res.status(404).json({ error: 'Season not found' }); return null; }
  if (season.kind !== 'TOURNAMENT') { res.status(400).json({ error: 'Only a tournament has a draw' }); return null; }
  return season;
}

// the table rules a request asks for: { error } or { scoring, tiebreakers } (a field it does not mention stays undefined)
function readRules(body) {
  const out = {};
  if (body.scoring !== undefined) {
    if (!standings.SCORING.includes(body.scoring)) return { error: 'The scoring must be BLTA, WIN2 or WIN1' };
    out.scoring = body.scoring;
  }
  if (body.tiebreakers !== undefined) {
    if (!Array.isArray(body.tiebreakers) || body.tiebreakers.some((k) => !standings.DEFAULT_TIEBREAKERS.includes(k))) {
      return { error: 'The tie-break conditions must be a list of H2H, SETS, WINS, GAMES' };
    }
    out.tiebreakers = body.tiebreakers;
  }
  return out;
}

// the checks of a new season or tournament, shared by the Backend (POST /api/seasons) and the clubs (POST /api/communities/:id/tournaments):
// { error } or { values }
function readNewSeason(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Season name is required' };
  if (name.length > 120) return { error: 'Season name is too long (max 120 characters)' };
  const start = parseDate(body.startDate);
  const end = parseDate(body.endDate);
  if (start.error || end.error) return { error: start.error || end.error };
  if (start.value && end.value && start.value > end.value) return { error: 'The end date is before the start date' };
  const kind = body.kind === undefined ? 'LEAGUE' : body.kind;
  if (!KINDS.includes(kind)) return { error: 'The type must be LEAGUE or TOURNAMENT' };
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  if (venue.length > 200) return { error: 'Venue is too long (max 200 characters)' };
  // a tournament is singles or doubles, chosen when it is made (never mixed); a league season is always singles
  const playTypeAsked = body.playType === undefined ? 'SINGLES' : body.playType;
  if (!['SINGLES', 'DOUBLES'].includes(playTypeAsked)) return { error: 'The tournament is played as singles or doubles' };
  const playType = kind === 'TOURNAMENT' ? playTypeAsked : 'SINGLES';
  const asked = readRules(body);
  if (asked.error) return { error: asked.error };
  // a tournament always starts with explicit rules (the BLTA scoring and the default order unless it chooses); a season has them only when it chooses (else the league's own way)
  const rules = kind === 'TOURNAMENT' || asked.scoring !== undefined || asked.tiebreakers !== undefined ? normalizeRules(asked) : null;
  return { values: { name, start: start.value, end: end.value, kind, venue, playType, categories: playType === 'DOUBLES' ? null : categoriesToStore(body.categories), scoring: rules ? rules.scoring : null, tiebreakers: rules ? rules.tiebreakers.join(',') : null } };
}

// inserts a checked new season and returns its row; a club tournament carries the id of its organisation
function insertSeason(values, leagueId, organisationId = null) {
  const slug = uniqueSlug(slugify(values.name));
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM seasons WHERE league_id = ?').get(leagueId).m;
  const info = db.prepare('INSERT INTO seasons (name, slug, start_date, end_date, sort_order, kind, venue, categories, league_id, play_type, organisation_id, scoring, tiebreakers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(values.name, slug, values.start, values.end, maxOrder + 1, values.kind, values.venue || null, values.categories, leagueId, values.playType, organisationId, values.scoring, values.tiebreakers);
  return db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(info.lastInsertRowid));
}

// A group of a season of a community or club may also be "without a category" (OPEN, like a tournament without categories): its matches are then
// of the category OTHER, as the matches of such a tournament are. Every other group is one of the three league categories.
const matchCategoryOf = (groupCategory) => (groupCategory === 'OPEN' ? 'OTHER' : groupCategory);

// The player a request means, for adding to a group: by id, or by typed name with the same protection as when a match
// is created (the same name written differently is the same player; a similar name asks which one is meant; a name
// nobody has needs confirmNew: true to create a new player). Returns { player } or { conflict } (HTTP 409 body).
function resolveMemberPlayer(body, leagueId = leagues.DEFAULT_LEAGUE_ID) {
  if (body.playerId !== undefined && body.playerId !== null) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(body.playerId));
    return player ? { player } : { error: 'That player does not exist' };
  }
  const typed = typeof body.name === 'string' ? body.name.trim() : '';
  if (!typed) return { error: 'Choose a player or type a name' };
  const same = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE AND league_id = ?').get(typed, leagueId);
  if (same) return { player: same };
  const { exact, similar } = nameMatch.findSimilar(typed, db.prepare('SELECT id, name FROM players WHERE league_id = ?').all(leagueId));
  if (exact) return { player: db.prepare('SELECT * FROM players WHERE id = ?').get(exact.id) };
  if (!body.confirmNew) {
    return { conflict: { code: similar.length ? 'SIMILAR_PLAYERS' : 'UNKNOWN_PLAYER', typed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) } };
  }
  const info = db.prepare('INSERT INTO players (name, created_by_anonymous, league_id) VALUES (?, 0, ?)').run(typed, leagueId);
  return { player: db.prepare('SELECT * FROM players WHERE id = ?').get(Number(info.lastInsertRowid)), created: true };
}

module.exports = {
  computeGroupStandings,
  rulesOfSeason,
  normalizeRules,
  BLTA_CATEGORIES,
  sanitizeHtml,
  parseDate,
  groupMembers,
  serializeGroup,
  KINDS,
  parseCategories,
  categoriesToStore,
  PLANNED_FORMATS,
  serializeSeason,
  tournamentStarted,
  registrationOpen,
  serializeRegistration,
  serializeRegistrationsOf,
  announceNewlyIn,
  profileCategory,
  tournamentOr404,
  readRules,
  readNewSeason,
  insertSeason,
  matchCategoryOf,
  resolveMemberPlayer,
};
