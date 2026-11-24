const db = require('../../db');
const engine = require('../../matchEngine');
const nameMatch = require('../../nameMatch');
const { sendMatchStartedEmailTo, sendMatchFinishedEmailTo, sendProposalReceivedEmail } = require('../../mailer');
const { sendPush } = require('../../push');
const { isAdmin, getPlayerId, stripPrivateFields, isReferee } = require('../../auth');
const courtKiosk = require('../../courtKiosk');
const badgeEngine = require('../../badgeEngine');
const courtIQ = require('../../courtIQEngine');
const rankingPoints = require('../../rankingPoints');
const youtube = require('../../youtube');
const drivePhotos = require('../../drivePhotos');
const changeLog = require('../../changeLog');
const clubTournaments = require('../../clubTournaments');
const playerPush = require('../../playerPush');

const MAX_HISTORY = 30;

const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE', 'FRIENDLY', 'VIP_CUP', 'ATA_TENNIS', 'OTHER'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// While a LIST of matches is built (listMemo is set around rows.map(serialize), synchronously) the lookups that every match of the list repeats (the same few players,
// the season, the group, the organisation) are read from the database once. Outside a list listMemo is null and nothing is remembered.
let listMemo = null;

function memoised(key, read) {
  if (!listMemo) return read();
  if (!listMemo.has(key)) listMemo.set(key, read());
  return listMemo.get(key);
}

function setListMemo(memo) {
  listMemo = memo;
}

function getPlayer(id) {
  return memoised(`player:${id}`, () => db.prepare('SELECT * FROM players WHERE id = ?').get(id));
}

// Doubles: every player of a match (the four of a doubles match), and a side as ONE player object whose name is "A / B" - so the cards, the
// match page, the emails and the notifications that show `player1.name` show the whole pair without each of them knowing about doubles.
function playerIdsOf(row) {
  return [row.player1_id, row.player2_id, row.player1b_id, row.player2b_id].filter(Boolean);
}

function sideOf(row, side) {
  const first = getPlayer(side === 1 ? row.player1_id : row.player2_id);
  if (!row.is_doubles || !first) return first;
  const partner = getPlayer(side === 1 ? row.player1b_id : row.player2b_id);
  return partner ? { ...first, name: `${first.name} / ${partner.name}` } : first;
}

// Which of player1/player2 is proposing a time — "who's proposing" is an
// optional field on the client (see proposeTimes.whoProposing), but that
// optionality shouldn't be what decides whether respond-proposal's own
// "can't confirm the times you proposed yourself" check (further down)
// and the opponent-only pick rule actually work: a logged-in player is
// always known server-side regardless of whether they bothered filling in
// that display field. Session identity wins outright whenever whoever's
// actually logged in is one of this match's two players — deliberately
// checked BEFORE the client's own explicit value, so a real player can't
// defeat the self-block by simply claiming (via a direct API call) to be
// the other side. The explicit 1/2 is only trusted as a fallback, which in
// practice only ever fires for admin — setting this up on a match neither
// player is logged in for. Otherwise genuinely unknown (admin/a
// non-participant creating the match without naming either side) — stays
// null, same as before.
function inferProposedBy(req, explicitValue, player1Id, player2Id) {
  const playerId = getPlayerId(req);
  if (playerId === player1Id) return 1;
  if (playerId === player2Id) return 2;
  if (explicitValue === 1 || explicitValue === 2) return explicitValue;
  return null;
}

// Bell notification (plus an email, if the recipient has one on file) for
// "someone proposed times for this match" — the recipient is always
// whichever of the two players didn't propose it, so this can only
// actually fire once proposedBy is known one way or the other (see
// inferProposedBy above for when that is/isn't the case; a still-null
// proposedBy — admin set it up, or nobody was logged in for an anonymous
// counter-propose — has no single "the other player" to notify).
function notifyProposalReceived(row, proposedBy) {
  if (proposedBy !== 1 && proposedBy !== 2) return;
  const recipientId = proposedBy === 1 ? row.player2_id : row.player1_id;
  const proposerId = proposedBy === 1 ? row.player1_id : row.player2_id;
  db.prepare('INSERT INTO proposal_notifications (player_id, match_id, kind, other_player_id) VALUES (?, ?, ?, ?)')
    .run(recipientId, row.id, 'RECEIVED', proposerId);

  const recipient = getPlayer(recipientId);
  const proposer = getPlayer(proposerId);
  playerPush.notifyPlayer(recipientId, 'PROPOSAL_RECEIVED', { name: proposer && proposer.name, matchToken: row.share_token });
  if (recipient && recipient.email && proposer) {
    sendProposalReceivedEmail(row, proposer, recipient).catch((err) => {
      console.error('[matches] failed to send proposal-received email:', err.message);
    });
  }
}

// Bell notification for "your proposed time was confirmed" — mirrors
// sendProposalConfirmedEmail's own recipient (matched.proposerPlayerId in
// respond-proposal below), just for the bell instead of an optional email
// address. Only fires when the proposer is actually a known player — same
// reasoning as notifyProposalReceived above.
function notifyProposalConfirmed(matchId, proposerPlayerId, confirmerPlayerId) {
  if (!proposerPlayerId) return;
  db.prepare('INSERT INTO proposal_notifications (player_id, match_id, kind, other_player_id) VALUES (?, ?, ?, ?)')
    .run(proposerPlayerId, matchId, 'CONFIRMED', confirmerPlayerId || null);
  const confirmer = confirmerPlayerId ? getPlayer(confirmerPlayerId) : null;
  const confirmedMatch = db.prepare('SELECT share_token FROM matches WHERE id = ?').get(matchId);
  playerPush.notifyPlayer(proposerPlayerId, 'PROPOSAL_CONFIRMED', { name: confirmer ? confirmer.name : 'Admin', matchToken: confirmedMatch && confirmedMatch.share_token });
}

// Emails everyone subscribed to this match/type who hasn't been notified yet.
async function notifySubscribers(matchId, type, updated) {
  const subs = db.prepare('SELECT * FROM match_notifications WHERE match_id = ? AND type = ? AND sent = 0').all(matchId, type);
  if (!subs.length) return;
  const p1 = sideOf(updated, 1);
  const p2 = sideOf(updated, 2);
  for (const sub of subs) {
    try {
      if (type === 'START') await sendMatchStartedEmailTo(updated, p1, p2, sub.email);
      else await sendMatchFinishedEmailTo(updated, p1, p2, sub.email);
      db.prepare('UPDATE match_notifications SET sent = 1 WHERE id = ?').run(sub.id);
    } catch (err) {
      console.error(`[matches] failed to send ${type} notification to ${sub.email}:`, err.message);
    }
  }
}

// Sends a push notification to everyone subscribed to this match/type who
// hasn't been notified yet. Mirrors notifySubscribers() above but for push
// instead of email — a subscription the browser has dropped (410/404)
// is deleted rather than retried forever.
async function notifyPushSubscribers(matchId, type, updated) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE match_id = ? AND type = ? AND sent = 0').all(matchId, type);
  if (!subs.length) return;
  const p1 = sideOf(updated, 1);
  const p2 = sideOf(updated, 2);
  const url = `${process.env.PUBLIC_URL || ''}/match/${updated.share_token}`;
  const payload = type === 'START'
    ? { title: `Match started: ${p1.name} vs ${p2.name}`, body: 'Watch it live now.', url }
    : { title: `Match finished: ${p1.name} vs ${p2.name}`, body: engine.describeMatch(JSON.parse(updated.state)) || 'See the result.', url };
  for (const sub of subs) {
    try {
      await sendPush(JSON.parse(sub.subscription), payload);
      db.prepare('UPDATE push_subscriptions SET sent = 1 WHERE id = ?').run(sub.id);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error(`[matches] failed to send ${type} push notification:`, err.message);
      }
    }
  }
}

// How many people have ever activated each notification type for this
// match — every row in match_notifications/push_subscriptions counts,
// regardless of whether its notification has already gone out.
// the numbers of "tell me" subscriptions of every match at once (while a list is built: one query each instead of two per match), as { matchId -> { START, FINISH } }
function notifyCountsOfAll() {
  const all = new Map();
  const add = (rows) => rows.forEach((r) => {
    if (!all.has(r.match_id)) all.set(r.match_id, { START: 0, FINISH: 0 });
    all.get(r.match_id)[r.type] += r.cnt;
  });
  add(db.prepare('SELECT match_id, type, COUNT(*) AS cnt FROM match_notifications GROUP BY match_id, type').all());
  add(db.prepare('SELECT match_id, type, COUNT(*) AS cnt FROM push_subscriptions GROUP BY match_id, type').all());
  return all;
}

function getNotifyCounts(matchId) {
  if (listMemo) {
    if (!listMemo.has('notify')) listMemo.set('notify', notifyCountsOfAll());
    return listMemo.get('notify').get(matchId) || { START: 0, FINISH: 0 };
  }
  const counts = { START: 0, FINISH: 0 };
  const emailRows = db.prepare('SELECT type, COUNT(*) AS cnt FROM match_notifications WHERE match_id = ? GROUP BY type').all(matchId);
  for (const row of emailRows) counts[row.type] += row.cnt;
  const pushRows = db.prepare('SELECT type, COUNT(*) AS cnt FROM push_subscriptions WHERE match_id = ? GROUP BY type').all(matchId);
  for (const row of pushRows) counts[row.type] += row.cnt;
  return counts;
}

// stripPrivateFields(player, req) normally keeps phone/email for a
// logged-in viewer (see auth.js) — but this payload doesn't have a single
// viewer: besides being the direct HTTP response to whoever called the
// API, it's also broadcast as-is to every socket in the match's room (see
// broadcast() below), an audience that includes anonymous spectators with
// no login at all. So player1/player2 here always get the same, most
// restrictive treatment (no login_pin/reset_token/etc, and no phone/email
// either) regardless of who happens to be asking — passing {} rather than
// the real req forces stripPrivateFields down that no-privileges branch.
// Nothing in the client reads phone/email off a match's embedded players
// anyway (that's what GET /api/players/:id is for).
function serializePlayer(player) {
  return stripPrivateFields(player, {});
}

const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// a group without a category (a season of a community or club) plays the category OTHER, like a tournament without categories
const matchCategoryOf = (groupCategory) => (groupCategory === 'OPEN' ? 'OTHER' : groupCategory);

const MATCH_STAGES = ['GROUP', 'PLAYOFF'];

// A BLTA-league match's season ("Autumn Finals Series 2026") and group ("Babolat") — see seasons/season_groups in
// db.js. Null for non-league categories and for league matches nobody has tagged yet.
// Where a bracket match sits in its draw (for "Semifinále" on the card): its round, how many rounds the draw has, main or consolation draw; null for a match outside any bracket.
function bracketInfo(row) {
  if (row.stage !== 'PLAYOFF') return null;
  const b = db.prepare('SELECT bm.round AS round, br.size AS size, br.kind AS kind, br.id AS bracket_id, br.prelim AS prelim FROM bracket_matches bm JOIN brackets br ON br.id = bm.bracket_id WHERE bm.match_id = ?').get(row.id);
  if (!b) return null;
  // played with a preliminary round: round 1 is "Predkolo" (only when the draw really has byes)
  const prelim = !!b.prelim && !!db.prepare('SELECT 1 FROM bracket_matches WHERE bracket_id = ? AND round = 1 AND is_bye = 1').get(b.bracket_id);
  return { round: b.round, rounds: Math.log2(b.size), kind: b.kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN', prelim };
}

function seasonAndGroup(row) {
  const season = row.season_id ? memoised(`season:${row.season_id}`, () => db.prepare('SELECT id, name, slug, kind, organisation_id FROM seasons WHERE id = ?').get(row.season_id)) : null;
  const group = row.group_id ? memoised(`group:${row.group_id}`, () => db.prepare('SELECT id, name, category FROM season_groups WHERE id = ?').get(row.group_id)) : null;
  // the community or club that runs the tournament (null for the league's own): the profile of a player marks its matches with it
  const org = season && season.organisation_id ? memoised(`org:${season.organisation_id}`, () => db.prepare('SELECT id, slug, name, type FROM organisations WHERE id = ?').get(season.organisation_id)) : null;
  return {
    season: season ? { id: season.id, name: season.name, slug: season.slug, kind: season.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE', organisation: org ? { id: org.id, slug: org.slug, name: org.name, type: org.type === 'CLUB' ? 'CLUB' : 'COMMUNITY' } : null } : null,
    bracket: bracketInfo(row),
    group: group ? { id: group.id, name: group.name, category: group.category } : null,
  };
}

function serialize(row) {
  const p1 = sideOf(row, 1);
  const p2 = sideOf(row, 2);
  const state = JSON.parse(row.state);
  const hasHistory = typeof row.history === 'string' ? row.history.length > 2 : JSON.parse(row.history).length > 0; // ('[]' = nothing to undo; no need to parse every point of every match)
  const notifyCounts = getNotifyCounts(row.id);
  return {
    token: row.share_token,
    category: row.category,
    league: row.league || null,
    videoUrl: row.video_url || null,
    videoId: row.video_url ? youtube.parseVideoId(row.video_url) : null,
    // How many photos the match has (for the "Photo" pill on its card); 0 while the photo feature is off, since the page hides them then.
    photoCount: drivePhotos.isConfigured() ? db.prepare('SELECT COUNT(*) AS c FROM match_photos WHERE match_id = ?').get(row.id).c : 0,
    ...seasonAndGroup(row),
    stage: row.stage === 'PLAYOFF' ? 'PLAYOFF' : 'GROUP',
    round: row.round || null,
    location: row.location,
    notes: row.notes || '',
    scheduledAt: row.scheduled_at,
    format: row.format,
    formatLabel: engine.FORMATS[row.format] ? engine.FORMATS[row.format].label : row.format,
    status: row.status,
    state,
    scoreSummary: engine.describeMatch(state),
    canUndo: hasHistory,
    createdByAdmin: !!row.created_by_admin,
    createdByAnonymous: !!row.created_by_anonymous,
    createdByPlayerId: row.created_by_player_id || null,
    winnerId: row.winner_id,
    startTime: row.start_time,
    endTime: row.end_time,
    pausedAt: row.paused_at,
    pausedSeconds: row.paused_seconds || 0,
    firstServer: row.first_server || null,
    ballsPlayer: row.balls_player || null,
    courtNo: row.court_no || null,
    courtPlayer: row.court_player || null,
    endReason: row.end_reason || null,
    proposalSlots: row.proposal_slots ? JSON.parse(row.proposal_slots) : null,
    proposalVenues: row.proposal_venues ? JSON.parse(row.proposal_venues) : null,
    proposedBy: row.proposed_by || null,
    counterProposalSlots: row.counter_proposal_slots ? JSON.parse(row.counter_proposal_slots) : null,
    counterProposalVenues: row.counter_proposal_venues ? JSON.parse(row.counter_proposal_venues) : null,
    counterProposedBy: row.counter_proposed_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifyStartCount: notifyCounts.START,
    notifyFinishCount: notifyCounts.FINISH,
    player1: serializePlayer(p1),
    player2: serializePlayer(p2),
    // a doubles match: both players of each side (player1 / player2 above are the sides, named "A / B")
    isDoubles: !!row.is_doubles,
    team1: row.is_doubles ? [serializePlayer(getPlayer(row.player1_id)), serializePlayer(getPlayer(row.player1b_id))] : null,
    team2: row.is_doubles ? [serializePlayer(getPlayer(row.player2_id)), serializePlayer(getPlayer(row.player2b_id))] : null,
  };
}

function getRowOr404(req, res) {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return row;
}

// A real player/admin can manage any match — checked once the row is
// loaded, since requireLoggedIn alone can't know which match this is yet.
// Returns a response (and false) if access is denied, so callers can just
// `if (!checkMatchAccess(req, res, row)) return;`.
// Admin: always. A specific logged-in player: matches they play in that an
// admin created, or any match they created themselves (regardless of
// whether they're one of the two players in it). See getPlayerId/
// created_by_player_id for how "this specific player" is known at all.
//
// The anonymous login tier this used to also cover has been removed
// entirely (no new session can ever be created_by_anonymous again) — a
// match that already carries that flag from before removal is simply no
// longer manageable by anyone but an admin, same as it would be for any
// other creator who's no longer around to log back in as themselves.
// the admin of a club who runs the tournament this match belongs to (checked on every request); false for a match of no tournament
function managesMatchSeason(req, row) {
  if (!row || !row.season_id) return false;
  return clubTournaments.canManageSeason(req, db.prepare('SELECT * FROM seasons WHERE id = ?').get(row.season_id));
}

// the season a new match asks for in its body (through its group, or by id), or null
function seasonAskedBy(body) {
  if (body.groupId !== undefined && body.groupId !== null) {
    const group = db.prepare('SELECT season_id FROM season_groups WHERE id = ?').get(Number(body.groupId));
    return group ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(group.season_id) : null;
  }
  if (body.seasonId !== undefined && body.seasonId !== null) return db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(body.seasonId)) || null;
  return null;
}

// A match of a community or club (of a season or tournament it runs): both players of it can also enter its result by hand, whoever set the match up (the live
// score is theirs already, see checkLiveScoreAccess). The match of another player in the league is not covered: there only its creator may.
function playsInClubMatch(req, row) {
  const playerId = getPlayerId(req);
  if (!playerId || !row || !row.season_id || !playerIdsOf(row).includes(playerId)) return false;
  const season = db.prepare('SELECT organisation_id FROM seasons WHERE id = ?').get(row.season_id);
  return !!(season && season.organisation_id);
}

function checkMatchAccess(req, res, row) {
  if (isAdmin(req) || managesMatchSeason(req, row)) return true;
  const playerId = getPlayerId(req);
  if (playerId) {
    const playsInMatch = playerIdsOf(row).includes(playerId);
    if (row.created_by_admin && playsInMatch) return true;
    if (row.created_by_player_id === playerId) return true;
    // Grandfather clause: a match with no creator attribution at all
    // predates per-player tracking — it was created under the old shared
    // PLAYER_CODE login (before individual players were identified), so
    // there's no real creator to check against and no way to know which
    // side made it. Treat it like an admin-created match instead of
    // leaving it permanently unmanageable by either player still in it.
    if (!row.created_by_admin && !row.created_by_anonymous && !row.created_by_player_id && playsInMatch) return true;
  }
  res.status(403).json({ error: 'You can only manage matches you play in (if an admin created them) or matches you created yourself' });
  return false;
}

// Deliberately narrower than checkMatchAccess above, not just "that plus a
// referee" — used ONLY on the live-scoring routes below (start/pause/
// resume/score/undo/finish/restart/unfinished/resume-later/finish-as-is,
// each paired with requireLoggedInOrReferee instead of plain
// requireLoggedIn), never on the broader match-management ones (editing
// location/date, deleting the match, format/set-style setup).
// checkMatchAccess's created_by_player_id allowance — "the player who set
// this match up can manage it, even if they're not one of the two people
// playing" — is the right call for logistics like location/date or
// deleting a match you organized, but running the live score is a
// different permission: only an admin, a referee (anyone with the shared
// code — by design, that's the whole point of a courtside referee who
// isn't one of the two players and doesn't have a BLTA account), or one of
// the two actual players may start/stop/score it. Without this narrower
// check, any logged-in player could create a match naming two other
// people as player1/player2 and then start/control its live score purely
// by virtue of being its creator.
// Who may correct or restart a FINISHED match: an admin of the site, or the admin of the club that runs its tournament (the players of it and a referee may not).
function mayCorrectFinished(req, row) {
  return isAdmin(req) || managesMatchSeason(req, row);
}

// The kiosk of a court (src/courtKiosk.js) may run the live score of the matches of its own court, and only that: not a finished match, and with { noKiosk: true } not the two
// moves that throw a match away (restart, finish as it is) - a phone that lies on a court is in reach of everybody.
function checkLiveScoreAccess(req, res, row, { noKiosk = false } = {}) {
  if (isAdmin(req) || isReferee(req) || managesMatchSeason(req, row)) return true;
  if (!noKiosk && courtKiosk.mayScore(courtKiosk.fromRequest(req), row)) return true;
  const playerId = getPlayerId(req);
  if (playerId && playerIdsOf(row).includes(playerId)) return true;
  res.status(403).json({ error: 'Only the players in this match, an admin, or a referee can control the live score' });
  return false;
}

function nowIso() {
  return new Date().toISOString();
}

function deriveWinnerId(state, row) {
  return state.winner === 1 ? row.player1_id : state.winner === 2 ? row.player2_id : null;
}

// Called after any write that can leave a match FINISHED (a normal finish,
// a manually-entered result, or a set correction that completes an
// already-live match) — see badgeEngine.syncPlayerBadges for what actually
// counts. A no-op for anything else (UNFINISHED/LIVE/PLANNED), so callers
// can just always call this on the post-write row rather than tracking
// which branch they're in.
function syncBadgesIfFinished(row) {
  if (row.status !== 'FINISHED' || !clubTournaments.matchCountsForRating(row)) return;
  // a doubles match counts for the doubles badges of all four players (and for no singles badge: see computeBadgeMetrics)
  [row.player1_id, row.player2_id, ...(row.is_doubles ? [row.player1b_id, row.player2b_id] : [])].filter(Boolean)
    .forEach((id) => badgeEngine.syncPlayerBadges(id));
}

// Same trigger as syncBadgesIfFinished above, but CourtIQ (see
// src/courtIQEngine.js) only ever runs this ONCE per match — a WALKOVER or
// UNFINISHED match never counts (no tennis was actually decided), and a
// match whose match_id already has a courtiq_rating_history row (the
// unique index in db.js) is a correction to an already-rated result, which
// this deliberately leaves alone: Glicko-2 is path-dependent, so patching
// just this one match's numbers in place would leave every match rated
// after it subtly wrong. Re-run scripts/backfillCourtIQ.js to pick up a
// correction like that instead.
function syncCourtIQIfFinished(row) {
  if (row.status !== 'FINISHED' || !row.winner_id || row.is_doubles || !clubTournaments.matchCountsForRating(row)) return;
  if (row.end_reason === 'WALKOVER' || row.end_reason === 'UNFINISHED') return;
  const alreadyRated = db.prepare('SELECT 1 FROM courtiq_rating_history WHERE match_id = ?').get(row.id);
  if (alreadyRated) return;

  const winner = row.winner_id === row.player1_id ? 1 : row.winner_id === row.player2_id ? 2 : null;
  const matchDate = row.scheduled_at || row.start_time || row.created_at;
  if (!winner || !matchDate) return;

  let state;
  try {
    state = JSON.parse(row.state);
  } catch {
    return;
  }

  const loadCourtIQ = (playerId) => {
    const stored = db.prepare('SELECT * FROM courtiq_ratings WHERE player_id = ?').get(playerId);
    return stored
      ? { rating: stored.rating, deviation: stored.deviation, volatility: stored.volatility, lastMatchAt: stored.last_match_at, gamesPlayed: stored.games_played }
      : { ...courtIQ.defaultRatingState(), lastMatchAt: null, gamesPlayed: 0 };
  };
  const p1Before = loadCourtIQ(row.player1_id);
  const p2Before = loadCourtIQ(row.player2_id);

  const { player1, player2 } = courtIQ.processMatch({
    player1: p1Before, player2: p2Before, winner, sets: state.sets || [], matchDate,
  });

  const upsert = db.prepare(`
    INSERT INTO courtiq_ratings (player_id, rating, deviation, volatility, games_played, last_match_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(player_id) DO UPDATE SET
      rating = excluded.rating, deviation = excluded.deviation, volatility = excluded.volatility,
      games_played = excluded.games_played, last_match_at = excluded.last_match_at, updated_at = excluded.updated_at
  `);
  upsert.run(row.player1_id, player1.rating, player1.deviation, player1.volatility, p1Before.gamesPlayed + 1, matchDate);
  upsert.run(row.player2_id, player2.rating, player2.deviation, player2.volatility, p2Before.gamesPlayed + 1, matchDate);

  const insertHistory = db.prepare(`
    INSERT INTO courtiq_rating_history (player_id, match_id, rating, deviation, volatility)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertHistory.run(row.player1_id, row.id, player1.rating, player1.deviation, player1.volatility);
  insertHistory.run(row.player2_id, row.id, player2.rating, player2.deviation, player2.volatility);
}

// Keeps the ranking tables (src/rankingPoints.js) in line with a match: whatever points the match added before are taken back, then
// — if `updatedRow` is now FINISHED and is a BLTA match (Elite, Next Gen or Novice) — what its result is worth is added. That
// covers a first-time finish, a score correction, an un-finish (restart) and a match that is not a ranked one at all (nothing
// to take back, nothing to add), so callers can just always call this on the post-write row. It is all local and runs in
// one database transaction. Never blocks or fails the caller's own response (a failure is only logged).
async function reconcileRankingPoints(previousRow, updatedRow) {
  const ranking = rankingPoints.reconcile(previousRow, updatedRow);
  // Backend > Log: what this change did to the ranking points and the group table (a row only when something changed)
  try { changeLog.logMatchChange(previousRow, updatedRow, ranking); } catch (err) { console.error('[change log]', err.message); }
}

function broadcast(req, row) {
  const io = req.app.get('io');
  const payload = serialize(row);
  io.to(`match:${row.share_token}`).emit('match:update', payload);
  io.emit('matches:changed', { token: row.share_token, status: row.status });
  return payload;
}

// The filters of the matches list (also used by the counts below), applied to a query-string-like object.
// Returns the WHERE clause and its bound params.
function matchFilters(query) {
  const { status, category, from, to, noDate, hasDate, playerId } = query;
  const seasonId = parseInt(query.seasonId, 10);
  const round = parseInt(query.round, 10);
  const clauses = [];
  const params = {};
  // the matches of one city (set by the route, never by the visitor)
  if (query._league) {
    clauses.push('m.league_id = @_league');
    params._league = Number(query._league);
  }
  if (status) {
    clauses.push('m.status = @status');
    params.status = status;
  }
  if (category) {
    // Plain "category=ELITE" still works exactly as before (a single bound
    // param); a comma-separated list (e.g. for /compactblta, which only
    // ever wants ELITE/NEXT_GEN/NOVICE) becomes an IN (...) instead, one
    // bound param per value rather than interpolating the raw list into
    // the query string.
    const cats = category.split(',').map((c) => c.trim()).filter(Boolean);
    if (cats.length <= 1) {
      clauses.push('m.category = @category');
      params.category = cats[0] || category;
    } else {
      clauses.push(`m.category IN (${cats.map((_, i) => `@category${i}`).join(', ')})`);
      cats.forEach((c, i) => { params[`category${i}`] = c; });
    }
  }
  // one season (the season page and the matches page's ?season=) and, inside it, one round of the schedule
  if (Number.isInteger(seasonId)) {
    clauses.push('m.season_id = @seasonId');
    params.seasonId = seasonId;
  } else if (query.withClub === '1' && playerId && String(query._viewer || '') === String(playerId)) {
    // The profile of a player (player.js) also lists the matches this player played in the tournaments of communities and clubs - to this player only, when he is
    // logged in (the route sets _viewer): for everybody else, the public, the profile has the league's matches alone. Nothing else lists them (see leagueOnlySql).
    clauses.push(clubTournaments.leagueAndPublicClubSql('m'));
  } else {
    // the league's lists do not hold the matches of the tournaments of communities and clubs: those are on the page of their tournament (and on the profile of the players)
    clauses.push(clubTournaments.leagueOnlySql('m'));
  }
  if (Number.isInteger(round)) {
    clauses.push('m.round = @round');
    params.round = round;
  }
  if (playerId) {
    clauses.push(query.withDoubles === '1'
      ? '(m.player1_id = @playerId OR m.player2_id = @playerId OR m.player1b_id = @playerId OR m.player2b_id = @playerId)'
      : '(m.is_doubles = 0 AND (m.player1_id = @playerId OR m.player2_id = @playerId))');
    params.playerId = playerId;
  }
  if (noDate === '1') {
    clauses.push('m.scheduled_at IS NULL');
  } else {
    // hasDate and a from/to range can combine (e.g. "Scheduled" tab +
    // "Tomorrow" time filter) — BETWEEN already implies NOT NULL, so listing
    // both is redundant but harmless when a caller sends just one of them.
    if (hasDate === '1') {
      clauses.push('m.scheduled_at IS NOT NULL');
    }
    if (from && to) {
      clauses.push('m.scheduled_at BETWEEN @from AND @to');
      params.from = from;
      params.to = to;
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

// The matching rows (with both player names), in the list's order. Used by the list route.
function selectMatchRows(query) {
  const { status, q } = query;
  const { where, params } = matchFilters(query);
  // Planned matches: soonest-scheduled first, undated ones grouped at the end
  // (the frontend divides the two groups with a visual line). Finished
  // matches: most recently finished first.
  const orderBy = status === 'PLANNED'
    ? 'ORDER BY (m.scheduled_at IS NULL) ASC, m.scheduled_at ASC, m.created_at DESC'
    : (status === 'FINISHED' || status === 'UNFINISHED')
      // Sort by when the match was actually played, not by database
      // bookkeeping — a manually-entered or bulk-imported result has no
      // real end_time (and its updated_at is just whenever it was typed
      // in), so both would otherwise bury genuinely old matches under
      // whatever was most recently recorded, regardless of when it was
      // actually played.
      ? 'ORDER BY COALESCE(m.scheduled_at, m.end_time, m.updated_at) DESC'
      : `ORDER BY
          CASE m.status WHEN 'LIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
          COALESCE(m.scheduled_at, m.created_at) DESC`;
  let rows = db.prepare(`
    SELECT m.*, p1.name AS p1_name, p2.name AS p2_name, p1b.name AS p1b_name, p2b.name AS p2b_name FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN players p1b ON p1b.id = m.player1b_id
    LEFT JOIN players p2b ON p2b.id = m.player2b_id
    ${where}
    ${orderBy}
  `).all(params);
  // Filtered in JS rather than SQL LIKE — SQLite's LIKE only case-folds
  // ASCII, so a query like "šar" would never match a stored "Šarudy".
  // String.prototype.toLowerCase() handles this correctly for all of
  // Slovak's diacritics.
  if (q) {
    rows = rows.filter((r) => nameMatch.matchesQuery(`${r.p1_name} ${r.p1b_name || ''} ${r.p2_name} ${r.p2b_name || ''}`, q));
  }
  return rows;
}

// How many matches match — same filters as the list, without building a single match payload (the list builds ~6
// queries per match; a count needs one). With a name search the names are still needed, so that path reads the rows.
function countMatchRows(query) {
  if (query.q) return selectMatchRows(query).length;
  const { where, params } = matchFilters(query);
  return db.prepare(`SELECT COUNT(*) AS n FROM matches m ${where}`).get(params).n;
}

module.exports = {
  MAX_HISTORY,
  CATEGORIES,
  EMAIL_RE,
  setListMemo,
  getPlayer,
  playerIdsOf,
  sideOf,
  inferProposedBy,
  notifyProposalReceived,
  notifyProposalConfirmed,
  notifySubscribers,
  notifyPushSubscribers,
  BLTA_CATEGORIES,
  matchCategoryOf,
  MATCH_STAGES,
  serialize,
  getRowOr404,
  managesMatchSeason,
  seasonAskedBy,
  playsInClubMatch,
  checkMatchAccess,
  mayCorrectFinished,
  checkLiveScoreAccess,
  nowIso,
  deriveWinnerId,
  syncBadgesIfFinished,
  syncCourtIQIfFinished,
  reconcileRankingPoints,
  broadcast,
  selectMatchRows,
  countMatchRows,
};
