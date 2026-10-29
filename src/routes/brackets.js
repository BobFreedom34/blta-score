// Playoff bracket ("Pavúk") CRUD + public read. Creation/editing is
// admin-only (see auth.requireAdmin) — this is a tournament-organizer tool,
// not something a regular player manages themselves, unlike most of this
// app's other match-creation flows. Reading a bracket (GET /:id) is public
// with no auth at all, same as a match page, since the whole point is a
// shareable/embeddable draw anyone can look at.
const express = require('express');
const clubTournaments = require('../clubTournaments');
const db = require('../db');
const leagues = require('../leagues');
const auth = require('../auth');
const engine = require('../matchEngine');
const bracketEngine = require('../bracketEngine');

const router = express.Router();

// Same list matches.js validates category against — duplicated locally
// rather than imported since matches.js doesn't export it either (each
// route file just keeps its own copy, matching the existing convention).
const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE', 'FRIENDLY', 'VIP_CUP', 'ATA_TENNIS', 'OTHER'];
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// A season is optional, but it only goes with a BLTA category (the same rule as for a match). Returns an error text
// or null.
// (a doubles draw has no league category: it can belong to a tournament only, whose matches carry the season but count in no league table)
function seasonProblem(seasonId, category, doubles = false) {
  if (seasonId === null || seasonId === undefined) return null;
  const season = db.prepare('SELECT kind FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return 'That season does not exist';
  if (doubles) return season.kind === 'TOURNAMENT' ? null : 'A doubles draw can belong to a tournament only';
  if (!BLTA_CATEGORIES.includes(category)) return 'A season needs a BLTA category (Elite, Next Gen or Novice)';
  return null;
}

function parseSeasonId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function seasonOf(seasonId) {
  if (!seasonId) return null;
  const row = db.prepare('SELECT id, name FROM seasons WHERE id = ?').get(seasonId);
  return row ? { id: row.id, name: row.name } : null;
}

function serializePlayer(player) {
  if (!player) return null;
  const stripped = auth.stripPrivateFields(player, {});
  return { id: stripped.id, name: stripped.name, slug: stripped.slug, nationality: stripped.nationality };
}

// A slot of a doubles draw holds a pair: shown as one "player" named "A / B" (the id is the first player's, which is what the tree and the
// match results use), with the two players listed for whoever wants them. No profile link: a pair has none.
function serializeSlotPlayer(bracket, playerId) {
  if (!playerId) return null;
  const first = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!first) return null;
  if (!bracket.is_doubles) return serializePlayer(first);
  const partner = db.prepare('SELECT * FROM players WHERE id = ?').get(bracketEngine.partnerOf(bracket.id, playerId));
  const team = [serializePlayer(first), partner ? serializePlayer(partner) : null].filter(Boolean);
  return {
    id: first.id, name: team.map((p) => p.name).join(' / '), slug: null, nationality: null, team,
  };
}

// Minimal match summary embedded on a bracket node — just enough for the
// draw display (status, score, a link to the real match) without pulling
// in everything matches.js's own serialize() does (proposals, chat, etc,
// none of which a bracket slot needs).
function serializeNodeMatch(matchId) {
  if (!matchId) return null;
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!row) return null;
  const state = JSON.parse(row.state);
  return {
    token: row.share_token,
    status: row.status,
    scoreSummary: engine.describeMatch(state),
    scheduledAt: row.scheduled_at,
    location: row.location,
    winnerId: row.winner_id,
  };
}

function serializeNode(node, bracket) {
  const match = serializeNodeMatch(node.match_id);
  // A node is "decided" by exactly one of two sources — a real match's own
  // winner_id (the live case), or manual_winner_id (see recordManualResult
  // in bracketEngine.js — a past/historical bracket, or a one-off manual
  // override). winnerId/scoreSummary below fold whichever applies into one
  // shape so bracket.js doesn't need to know which source it came from.
  return {
    id: node.id,
    round: node.round,
    position: node.position,
    seed1: node.seed1,
    seed2: node.seed2,
    player1: serializeSlotPlayer(bracket, node.player1_id),
    player2: serializeSlotPlayer(bracket, node.player2_id),
    isBye: !!node.is_bye,
    match,
    winnerId: match ? match.winnerId : node.manual_winner_id,
    scoreSummary: match ? match.scoreSummary : node.manual_score,
    isManualResult: !match && !!node.manual_winner_id,
    nextBracketMatchId: node.next_bracket_match_id,
    nextSlot: node.next_slot,
  };
}

function serializeBracket(bracketId) {
  const tree = bracketEngine.getBracketTree(bracketId);
  if (!tree) return null;
  return {
    id: tree.bracket.id,
    name: tree.bracket.name,
    format: tree.bracket.format,
    formatLabel: engine.FORMATS[tree.bracket.format] ? engine.FORMATS[tree.bracket.format].label : tree.bracket.format,
    category: tree.bracket.category || null,
    isDoubles: !!tree.bracket.is_doubles,
    kind: tree.bracket.kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN',
    parentBracketId: tree.bracket.parent_bracket_id || null,
    season: seasonOf(tree.bracket.season_id),
    size: tree.bracket.size,
    autoCreateMatches: !!tree.bracket.auto_create_matches,
    rounds: bracketEngine.roundCount(tree.bracket.size),
    createdAt: tree.bracket.created_at,
    // a consolation draw's seeds only say where a loser is placed, not how good the player is: nothing to show
    nodes: tree.nodes.map((n) => (tree.bracket.kind === 'CONSOLATION' ? serializeNode({ ...n, seed1: null, seed2: null }, tree.bracket) : serializeNode(n, tree.bracket))),
  };
}

// Admin list — name/size/created_at only, for the admin's own "pick a
// bracket to manage" screen. (The public read below is per-bracket, not a
// public list — there's no public "browse all draws" page in v1.)
router.get('/', auth.requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM brackets WHERE league_id = ? ORDER BY id DESC').all(leagues.actingIdOf(req));
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    format: r.format,
    category: r.category || null,
    isDoubles: !!r.is_doubles,
    kind: r.kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN',
    parentBracketId: r.parent_bracket_id || null,
    seasonId: r.season_id || null,
    seasonName: (seasonOf(r.season_id) || {}).name || null,
    seasonKind: r.season_id ? ((db.prepare('SELECT kind FROM seasons WHERE id = ?').get(r.season_id) || {}).kind || 'LEAGUE') : null,
    size: r.size,
    autoCreateMatches: !!r.auto_create_matches,
    createdAt: r.created_at,
  })));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid bracket id' });
  const payload = serializeBracket(id);
  if (!payload) return res.status(404).json({ error: 'Bracket not found' });
  // whether the viewer may enter results in it (an admin; the admin of the club that runs its tournament): the bracket page draws the buttons by it
  const season = payload.season && payload.season.id ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(payload.season.id) : null;
  res.json({ ...payload, canManage: clubTournaments.canManageSeason(req, season) });
});

// Two ways in: `entries` (auto-generate — [{playerId, seed}], size derived
// from the count) or a bare `size` (manual — an empty tree the admin fills
// in slot by slot afterwards via PATCH .../slots/:nodeId). Exactly one of
// the two is expected; entries wins if both are somehow sent.
// autoCreateMatches (default true) — false for a past/historical bracket:
// slots still fill in exactly the same way, but no `matches` row gets
// created for any of them, and results are entered directly via PATCH
// .../nodes/:nodeId/result instead of by playing/scoring a real match.
// a bracket belongs to the city of its season, else to the city the admin works on
function stampBracket(bracketId, seasonId, req) {
  const season = seasonId ? db.prepare('SELECT league_id FROM seasons WHERE id = ?').get(seasonId) : null;
  db.prepare('UPDATE brackets SET league_id = ? WHERE id = ?').run(season ? season.league_id : leagues.actingIdOf(req), bracketId);
}

router.post('/', clubTournaments.requireSeasonManager(clubTournaments.byBodySeasonId), (req, res) => {
  const name = (req.body.name || '').trim();
  const format = req.body.format;
  const autoCreateMatches = req.body.autoCreateMatches !== false;
  // Optional — a bracket stays freestanding (every generated match is
  // OTHER, see bracketEngine.js's maybeCreateMatch) unless tied to one of
  // the real BLTA categories here.
  const rawCategory = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  const category = rawCategory || null;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!engine.FORMATS[format]) return res.status(400).json({ error: 'Invalid match format' });
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  const seasonId = parseSeasonId(req.body.seasonId);
  if (Number.isNaN(seasonId)) return res.status(400).json({ error: 'Invalid season' });
  // A doubles draw (every entrant a pair). Its matches are doubles matches, which never count in the league: so no BLTA category, and its
  // season (if any) is a tournament.
  const doubles = req.body.doubles === true;
  const problem = seasonProblem(seasonId, category, doubles);
  if (problem) return res.status(400).json({ error: problem });
  if (doubles && BLTA_CATEGORIES.includes(category)) return res.status(400).json({ error: 'A doubles draw cannot be tied to a league category (Elite, Next Gen, Novice)' });

  const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : null;
  if (rawEntries) {
    if (rawEntries.length < 2) return res.status(400).json({ error: doubles ? 'Need at least 2 pairs to seed a draw' : 'Need at least 2 players to seed a draw' });
    if (rawEntries.length > 128) return res.status(400).json({ error: doubles ? 'Too many pairs (max 128)' : 'Too many players (max 128)' });
    const seeds = new Set();
    const playerIds = new Set();
    const known = (id) => Number.isInteger(id) && db.prepare('SELECT 1 FROM players WHERE id = ?').get(id);
    for (const e of rawEntries) {
      const playerId = Number(e.playerId);
      const seed = Number(e.seed);
      if (!known(playerId)) {
        return res.status(400).json({ error: `Unknown player id ${e.playerId}` });
      }
      if (!Number.isInteger(seed) || seed < 1) {
        return res.status(400).json({ error: doubles ? 'Every pair needs a whole-number seed (1, 2, 3…)' : 'Every player needs a whole-number seed (1, 2, 3…)' });
      }
      if (seeds.has(seed)) return res.status(400).json({ error: `Seed ${seed} is used more than once` });
      if (playerIds.has(playerId)) return res.status(400).json({ error: 'The same player is listed twice' });
      seeds.add(seed);
      playerIds.add(playerId);
      if (doubles) {
        const partnerId = Number(e.partnerId);
        if (!known(partnerId)) return res.status(400).json({ error: `Every pair needs a partner (unknown player id ${e.partnerId})` });
        if (playerIds.has(partnerId)) return res.status(400).json({ error: 'The same player is listed twice' });
        playerIds.add(partnerId);
      }
    }
    const entries = rawEntries.map((e) => ({ playerId: Number(e.playerId), seed: Number(e.seed), partnerId: doubles ? Number(e.partnerId) : null }));
    const bracketId = bracketEngine.createBracket({
      name, format, entries, autoCreateMatches, category, seasonId, doubles,
    });
    stampBracket(bracketId, seasonId, req);
    return res.status(201).json(serializeBracket(bracketId));
  }

  const size = Number(req.body.size);
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    return res.status(400).json({ error: 'Give either a list of seeded players, or a draw size (2-256) for a manual draw' });
  }
  const bracketId = bracketEngine.createBracket({
    name, format, entries: null, size, autoCreateMatches, category, seasonId, doubles,
  });
  stampBracket(bracketId, seasonId, req);
  res.status(201).json(serializeBracket(bracketId));
});

router.patch('/:id', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const id = Number(req.params.id);
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(id);
  if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
  const fields = {};
  if (typeof req.body.name === 'string') {
    const name = req.body.name.trim();
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    fields.name = name;
  }
  // the organiser of a club keeps his bracket in his tournament: moving it to another season (or out of any) is for an admin of the site, and so is a category that drops the season
  const siteAdmin = auth.isAdmin(req);
  if (!siteAdmin && Object.prototype.hasOwnProperty.call(req.body, 'seasonId') && parseSeasonId(req.body.seasonId) !== bracket.season_id) {
    return res.status(403).json({ error: 'Only an admin can move a bracket to another season' });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'category')) {
    const rawCategory = typeof req.body.category === 'string' ? req.body.category.trim() : '';
    if (rawCategory && !CATEGORIES.includes(rawCategory)) return res.status(400).json({ error: 'Invalid category' });
    if (!siteAdmin && bracket.season_id && !bracket.is_doubles && !BLTA_CATEGORIES.includes(rawCategory)) return res.status(403).json({ error: 'Only an admin can take a bracket out of its season' });
    if (bracket.is_doubles && BLTA_CATEGORIES.includes(rawCategory)) return res.status(400).json({ error: 'A doubles draw cannot be tied to a league category (Elite, Next Gen, Novice)' });
    fields.category = rawCategory || null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'seasonId')) {
    const seasonId = parseSeasonId(req.body.seasonId);
    if (Number.isNaN(seasonId)) return res.status(400).json({ error: 'Invalid season' });
    fields.season_id = seasonId;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'category') || Object.prototype.hasOwnProperty.call(fields, 'season_id')) {
    const finalCategory = Object.prototype.hasOwnProperty.call(fields, 'category') ? fields.category : bracket.category;
    let finalSeason = Object.prototype.hasOwnProperty.call(fields, 'season_id') ? fields.season_id : bracket.season_id;
    // Changing a bracket to a non-BLTA category drops its season (the two only go together).
    if (finalSeason && !bracket.is_doubles && !BLTA_CATEGORIES.includes(finalCategory) && !Object.prototype.hasOwnProperty.call(fields, 'season_id')) {
      finalSeason = null;
      fields.season_id = null;
    }
    const problem = seasonProblem(finalSeason || null, finalCategory, !!bracket.is_doubles);
    if (problem) return res.status(400).json({ error: problem });
  }
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE brackets SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id`)
    .run({ ...fields, id });
  // The matches this bracket already created follow its new category / season.
  if (Object.prototype.hasOwnProperty.call(fields, 'category') || Object.prototype.hasOwnProperty.call(fields, 'season_id')) {
    bracketEngine.syncBracketMatches(id);
  }
  res.json(serializeBracket(id));
});

// Deletes the bracket's own structure only — any real `matches` rows this
// bracket already created stay exactly where they are (as ordinary
// matches, still findable/playable, just no longer linked to any draw).
// Never silently deletes real score data.
router.delete('/:id', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const id = Number(req.params.id);
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(id);
  if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
  // a main bracket takes all its losers brackets with it
  const ids = [id, ...bracketEngine.descendants(id)];
  ids.forEach((bid) => {
    db.prepare('DELETE FROM bracket_partners WHERE bracket_id = ?').run(bid);
    db.prepare('DELETE FROM bracket_matches WHERE bracket_id = ?').run(bid);
    db.prepare('DELETE FROM brackets WHERE id = ?').run(bid);
  });
  res.json({ ok: true });
});

// Makes the consolation draw of a main bracket once every round-1 match is seated (a draw made automatically has it already).
// { format } — the match format of the consolation draw (default: best of 3 to 4 games with a super tie-break).
router.post('/:id/consolation', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const id = Number(req.params.id);
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(id);
  if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
  const format = (req.body && req.body.format) || 'BO3_G4_STB';
  if (!engine.FORMATS[format] || format === 'FREE_PLAY') return res.status(400).json({ error: 'Invalid match format' });
  const base = bracket.name.replace(/\s*—\s*Hlavný pavúk\s*$/, '');
  // PRINCE (one consolation bracket) or Monrad (a losers bracket for every round) — what the format of the category says
  const type = bracket.season_id && bracket.category ? require('../tournamentDraw').losersTypeFor(bracket.season_id, bracket.category) : 'PRINCE';
  const made = bracketEngine.buildConsolation(id, { name: `${base} — Útecha`, format, type });
  if (made.error) return res.status(400).json({ error: made.error });
  res.status(201).json(serializeBracket(made.bracketId));
});

// Takes back a result entered by hand: the winner leaves the next round. With ?cascade=1 later results that depend on it are cleared too;
// without it a result that others depend on is refused (409, code HAS_DEPENDENTS, how many).
router.delete('/:id/nodes/:nodeId/result', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const bracketId = Number(req.params.id);
  const nodeId = Number(req.params.nodeId);
  const node = db.prepare('SELECT * FROM bracket_matches WHERE id = ? AND bracket_id = ?').get(nodeId, bracketId);
  if (!node) return res.status(404).json({ error: 'Slot not found' });
  const done = bracketEngine.resetManualResult(nodeId, req.query.cascade === '1');
  if (done.error) return res.status(done.status || 400).json({ error: done.error, code: done.code, dependents: done.dependents });
  res.json(serializeBracket(bracketId));
});

// Manual-mode slot assignment — only for a node that doesn't have a real
// match yet (once two players are seated and a match exists, editing the
// pairing belongs on the match itself, not here).
router.patch('/:id/slots/:nodeId', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const bracketId = Number(req.params.id);
  const nodeId = Number(req.params.nodeId);
  const node = db.prepare('SELECT * FROM bracket_matches WHERE id = ? AND bracket_id = ?').get(nodeId, bracketId);
  if (!node) return res.status(404).json({ error: 'Slot not found' });
  if (node.match_id) return res.status(400).json({ error: 'This slot already has a match — edit the match itself instead' });
  if (node.manual_winner_id) return res.status(400).json({ error: 'This slot already has a result recorded' });

  const resolve = (raw) => {
    if (raw === null || raw === undefined) return null;
    const playerId = Number(raw);
    if (!Number.isInteger(playerId) || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) return undefined;
    return playerId;
  };
  const player1Id = resolve(req.body.player1Id);
  const player2Id = resolve(req.body.player2Id);
  if (player1Id === undefined || player2Id === undefined) {
    return res.status(400).json({ error: 'Unknown player id' });
  }
  if (player1Id && player2Id && player1Id === player2Id) {
    return res.status(400).json({ error: 'Both slots have the same player' });
  }
  // a doubles draw: every player seated needs a partner (sent now, or set before), and nobody may be in the draw twice
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(bracketId);
  let partners = {};
  if (bracket.is_doubles) {
    const p1Partner = player1Id ? (resolve(req.body.player1PartnerId) || bracketEngine.partnerOf(bracketId, player1Id)) : null;
    const p2Partner = player2Id ? (resolve(req.body.player2PartnerId) || bracketEngine.partnerOf(bracketId, player2Id)) : null;
    if ((player1Id && !p1Partner) || (player2Id && !p2Partner)) return res.status(400).json({ error: 'Every pair needs a partner' });
    const seated = [player1Id, p1Partner, player2Id, p2Partner].filter(Boolean);
    if (new Set(seated).size !== seated.length) return res.status(400).json({ error: 'The four players must be different' });
    // nobody who is already in another slot of this draw (as a player or as a partner)
    const others = db.prepare('SELECT player1_id, player2_id FROM bracket_matches WHERE bracket_id = ? AND id != ?').all(bracketId, nodeId);
    const taken = new Set();
    others.forEach((o) => [o.player1_id, o.player2_id].filter(Boolean).forEach((id) => { taken.add(id); const pp = bracketEngine.partnerOf(bracketId, id); if (pp) taken.add(pp); }));
    if (seated.some((id) => taken.has(id))) return res.status(400).json({ error: 'A player is already in this draw' });
    partners = { player1PartnerId: p1Partner, player2PartnerId: p2Partner };
  }
  bracketEngine.setSlotPlayers(nodeId, player1Id, player2Id, partners);
  res.json(serializeBracket(bracketId));
});

// Records — or edits — a node's result directly, no real match involved.
// For a past/historical bracket (autoCreateMatches off at creation), or to
// patch a one-off node on a live bracket that never got a match. Only
// valid once both players are seated and only before any real match
// exists for this node (if one does, the result belongs on the match
// itself, via the normal finish/manual-result endpoints — which will
// advance the bracket through the usual live hook instead).
//
// Editing an already-recorded result is always allowed when the winner
// stays the same (a score correction/typo fix) — nothing downstream
// depends on which player won, only on WHO won, so there's nothing to
// re-propagate. It's only blocked when the winner itself is CHANGING and
// the next round's node is already decided (its own match, or its own
// manual result): the old winner here may already have gone on to win
// THAT node too, and silently swapping this result out from under it
// would leave a decided later round pointing at a player who's no longer
// even in it. Clear the next round's result first in that case.
router.patch('/:id/nodes/:nodeId/result', clubTournaments.requireSeasonManager(clubTournaments.byBracketId), (req, res) => {
  const bracketId = Number(req.params.id);
  const nodeId = Number(req.params.nodeId);
  const node = db.prepare('SELECT * FROM bracket_matches WHERE id = ? AND bracket_id = ?').get(nodeId, bracketId);
  if (!node) return res.status(404).json({ error: 'Slot not found' });
  if (node.match_id) return res.status(400).json({ error: 'This slot has a real match — enter the result on the match itself' });
  if (!node.player1_id || !node.player2_id) return res.status(400).json({ error: 'Both players need to be set before a result can be recorded' });

  const winnerId = Number(req.body.winnerId);
  if (![node.player1_id, node.player2_id].includes(winnerId)) {
    return res.status(400).json({ error: 'winnerId must be one of this slot\'s two players' });
  }
  const winnerChanging = node.manual_winner_id && node.manual_winner_id !== winnerId;
  if (winnerChanging && node.next_bracket_match_id) {
    const nextNode = db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(node.next_bracket_match_id);
    if (nextNode.match_id || nextNode.manual_winner_id) {
      return res.status(400).json({ error: "Clear the next round's result first before changing the winner" });
    }
  }

  const score = typeof req.body.score === 'string' ? req.body.score.trim().slice(0, 100) : null;
  bracketEngine.recordManualResult(nodeId, winnerId, score || null);
  res.json(serializeBracket(bracketId));
});

module.exports = router;
