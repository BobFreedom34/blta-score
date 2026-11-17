const crypto = require('crypto');
const db = require('../../db');
const leagues = require('../../leagues');
const engine = require('../../matchEngine');
const nameMatch = require('../../nameMatch');
const { isAdmin, getPlayerId, requireLoggedIn } = require('../../auth');
const clubTournaments = require('../../clubTournaments');
const router = require('./router');
const { CATEGORIES, seasonAskedBy, BLTA_CATEGORIES, inferProposedBy, notifyProposalReceived, broadcast, EMAIL_RE, getPlayer, matchCategoryOf, MATCH_STAGES } = require('./shared');

router.post('/', requireLoggedIn, (req, res) => {
  const { category, location, scheduledAt, format, notes } = req.body;
  let { player1Id, player2Id, player1Name, player2Name } = req.body;
  // Doubles (štvorhra): four players, a friendly match for now (no season, group, bracket or ranking points)
  const doubles = req.body.doubles === true || req.body.doubles === 'true';
  if (doubles) {
    if (category !== 'FRIENDLY') return res.status(400).json({ error: 'A doubles match is a friendly match for now' });
    if (Array.isArray(req.body.proposalSlots) && req.body.proposalSlots.length > 0) {
      return res.status(400).json({ error: 'Proposing times is not available for doubles yet - set the date or leave it open' });
    }
  }

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  // ELITE, NEXT GEN and NOVICE are the league's own categories: only an admin creates a match in one of them
  // (the admin of a club may create one in the tournament of his club: the draw of a tournament is played in these categories)
  const clubManaged = !isAdmin(req) && clubTournaments.canManageSeason(req, seasonAskedBy(req.body));
  // a member of a group of a season of a community or club makes the matches of that group himself (against another member; checked once the players are known)
  const memberOfGroup = !isAdmin(req) && !clubManaged && !doubles ? clubTournaments.memberGroupFor(req, req.body.groupId) : null;
  if (BLTA_CATEGORIES.includes(category) && !isAdmin(req) && !clubManaged && !memberOfGroup) {
    return res.status(403).json({ error: 'Only an admin can create a match in the ELITE, NEXT GEN or NOVICE category' });
  }
  if (!engine.FORMATS[format]) {
    return res.status(400).json({ error: 'Invalid match format' });
  }
  let ballsPlayer = null;
  if (req.body.ballsPlayer !== undefined && req.body.ballsPlayer !== null) {
    ballsPlayer = Number(req.body.ballsPlayer);
    if (![1, 2].includes(ballsPlayer)) {
      return res.status(400).json({ error: 'ballsPlayer must be 1 or 2' });
    }
  }
  let courtPlayer = null;
  if (req.body.courtPlayer !== undefined && req.body.courtPlayer !== null) {
    courtPlayer = Number(req.body.courtPlayer);
    if (![1, 2].includes(courtPlayer)) {
      return res.status(400).json({ error: 'courtPlayer must be 1 or 2' });
    }
  }

  // "Propose times" mode: several candidate slots + preferred venues
  // instead of one fixed date — the other player picks one of each later
  // via POST /:token/respond-proposal. Mutually exclusive with scheduledAt;
  // a real date isn't known yet, that's the whole point of proposing.
  let proposalSlots = null;
  let proposalVenues = null;
  if (Array.isArray(req.body.proposalSlots) && req.body.proposalSlots.length > 0) {
    if (scheduledAt) {
      return res.status(400).json({ error: "Can't set a fixed date and propose times at the same time" });
    }
    if (req.body.proposalSlots.length > 60) {
      return res.status(400).json({ error: 'Too many proposed times (max 60)' });
    }
    const parsedSlots = req.body.proposalSlots.map((s) => new Date(s));
    if (parsedSlots.some((d) => Number.isNaN(d.getTime()))) {
      return res.status(400).json({ error: 'One of the proposed times is invalid' });
    }
    // Earliest first, so the respondent (and anyone re-reading this later)
    // sees them in chronological order regardless of click order.
    proposalSlots = parsedSlots.map((d) => d.toISOString()).sort();

    const venues = Array.isArray(req.body.proposalVenues) ? req.body.proposalVenues : [];
    const trimmedVenues = venues.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (trimmedVenues.length === 0) {
      return res.status(400).json({ error: 'Add at least one preferred venue' });
    }
    if (trimmedVenues.length > 10) {
      return res.status(400).json({ error: 'Too many venues (max 10)' });
    }
    proposalVenues = trimmedVenues;
  }

  // Optional — only meaningful alongside proposalSlots. Lets the proposer
  // ask to be emailed the moment someone confirms a slot/venue, instead of
  // having to keep checking the match page (see respond-proposal below).
  let proposalNotifyEmail = null;
  if (proposalSlots && typeof req.body.proposalNotifyEmail === 'string' && req.body.proposalNotifyEmail.trim()) {
    const email = req.body.proposalNotifyEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid confirmation email address' });
    }
    proposalNotifyEmail = email;
  }

  // Optional — which of player1/player2 is doing the proposing, shown on
  // the "Pick a time" card so the other player knows who they're
  // responding to. Only meaningful alongside proposalSlots.
  let proposedBy = null;
  if (proposalSlots && req.body.proposedBy !== undefined && req.body.proposedBy !== null) {
    proposedBy = Number(req.body.proposedBy);
    if (![1, 2].includes(proposedBy)) {
      return res.status(400).json({ error: 'proposedBy must be 1 or 2' });
    }
  }

  // created_by_anonymous always writes 0 here now — the anonymous login
  // tier that once set this to 1 has been removed entirely (see
  // checkMatchAccess's comment above), but the column itself stays for
  // existing historical rows.
  // A typed name is matched to an existing player ignoring capitals, accents, spacing and word order (so "Tomas Paulen"
  // is "Tomáš Paulen"). A name that is only SIMILAR to existing players is not guessed: the request is answered with
  // 409 and the lookalikes, and the page asks which one is meant (or confirms a genuinely new player with confirmNew).
  // Nobody is created until every name is settled, so a conflict never leaves a stray player behind.
  const confirmNew = req.body.confirmNew && typeof req.body.confirmNew === 'object' ? req.body.confirmNew : {};
  let everyone = null;
  const decide = (field, id, name) => {
    if (id) return { player: getPlayer(id) };
    const trimmed = (name || '').trim();
    if (!trimmed) return { player: null };
    const leagueId = leagues.actingIdOf(req);
    const existing = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE AND league_id = ?').get(trimmed, leagueId);
    if (existing) return { player: existing };
    if (!everyone) everyone = db.prepare('SELECT id, name FROM players WHERE league_id = ?').all(leagueId);
    const { exact, similar } = nameMatch.findSimilar(trimmed, everyone);
    if (exact) return { player: getPlayer(exact.id) };
    if (similar.length && !confirmNew[field]) {
      return { conflict: { field, typed: trimmed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) } };
    }
    return { create: trimmed };
  };
  const d1 = decide('player1', player1Id, player1Name);
  const d2 = decide('player2', player2Id, player2Name);
  const d1b = doubles ? decide('player1b', req.body.player1bId, req.body.player1bName) : { player: null };
  const d2b = doubles ? decide('player2b', req.body.player2bId, req.body.player2bName) : { player: null };
  const conflicts = [d1.conflict, d2.conflict, d1b.conflict, d2b.conflict].filter(Boolean);
  if (conflicts.length) {
    return res.status(409).json({ error: 'Similar players already exist — choose who you mean', code: 'SIMILAR_PLAYERS', conflicts });
  }
  // the same name typed for two of the four players is one person (nobody is created twice)
  if (doubles) {
    const typed = [d1, d2, d1b, d2b].map((d) => (d.player ? d.player.name : d.create) || '');
    if (new Set(typed.map((n) => nameMatch.key(n))).size !== 4) return res.status(400).json({ error: 'The four players must be different' });
  }
  // in a season of a community or club a member only plays the other members of his group: nobody new is made by this request
  if (memberOfGroup && (d1.create || d2.create)) return res.status(400).json({ error: 'Choose the players from the group' });
  const make = (d) => {
    if (d.create) {
      const info = db.prepare('INSERT INTO players (name, created_by_anonymous, league_id) VALUES (?, ?, ?)').run(d.create, 0, leagues.actingIdOf(req));
      return getPlayer(info.lastInsertRowid);
    }
    return d.player;
  };

  const p1 = make(d1);
  const p2 = make(d2);
  const p1b = doubles ? make(d1b) : null;
  const p2b = doubles ? make(d2b) : null;
  if (!p1 || !p2) return res.status(400).json({ error: 'Both players are required' });
  if (doubles && (!p1b || !p2b)) return res.status(400).json({ error: 'A doubles match needs four players' });
  if (p1.id === p2.id) return res.status(400).json({ error: 'Players must be different' });
  if (doubles && new Set([p1.id, p2.id, p1b.id, p2b.id]).size !== 4) return res.status(400).json({ error: 'The four players must be different' });
  if (proposalSlots) proposedBy = inferProposedBy(req, proposedBy, p1.id, p2.id);

  // Season and group (BLTA categories only) can be set by an admin right when creating the match.
  let seasonId = null;
  let groupId = null;
  if ((req.body.seasonId !== undefined && req.body.seasonId !== null) || (req.body.groupId !== undefined && req.body.groupId !== null)) {
    if (!isAdmin(req) && !clubManaged && !memberOfGroup) return res.status(403).json({ error: 'Only an admin can set the season and group' });
    if (memberOfGroup) {
      // the match is in the group the member is in, between him and another member of it
      const me = getPlayerId(req);
      if (req.body.seasonId !== undefined && req.body.seasonId !== null && Number(req.body.seasonId) !== memberOfGroup.group.season_id) {
        return res.status(400).json({ error: 'That group does not belong to the selected season' });
      }
      if (![p1.id, p2.id].includes(me)) return res.status(403).json({ error: 'You can only make a match you play yourself' });
      if (!clubTournaments.isGroupMember(memberOfGroup.group.id, p1.id) || !clubTournaments.isGroupMember(memberOfGroup.group.id, p2.id)) {
        return res.status(400).json({ error: 'Both players must be in the group' });
      }
    }
    // (a group of a season of a community or club without a category takes the matches of the category OTHER)
    const openGroup = category === 'OTHER' && req.body.groupId !== undefined && req.body.groupId !== null
      && (db.prepare('SELECT category FROM season_groups WHERE id = ?').get(Number(req.body.groupId)) || {}).category === 'OPEN';
    if (!BLTA_CATEGORIES.includes(category) && !openGroup) {
      return res.status(400).json({ error: 'Seasons and groups only apply to BLTA league matches (Elite, Next Gen, Novice)' });
    }
    if (req.body.groupId !== undefined && req.body.groupId !== null) {
      const group = db.prepare('SELECT * FROM season_groups WHERE id = ?').get(Number(req.body.groupId));
      if (!group) return res.status(400).json({ error: 'That group does not exist' });
      if (matchCategoryOf(group.category) !== category) return res.status(400).json({ error: 'The group is in a different category than this match' });
      if (req.body.seasonId !== undefined && req.body.seasonId !== null && Number(req.body.seasonId) !== group.season_id) {
        return res.status(400).json({ error: 'That group does not belong to the selected season' });
      }
      groupId = group.id;
      seasonId = group.season_id;
    } else {
      const season = db.prepare('SELECT id FROM seasons WHERE id = ?').get(Number(req.body.seasonId));
      if (!season) return res.status(400).json({ error: 'That season does not exist' });
      seasonId = season.id;
    }
  }

  // Stage (group stage / play-off): admin only, BLTA categories only.
  let stage = 'GROUP';
  if (req.body.stage !== undefined && req.body.stage !== null && req.body.stage !== 'GROUP') {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Only an admin can set the stage' });
    if (!BLTA_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Stages only apply to BLTA league matches (Elite, Next Gen, Novice)' });
    }
    if (!MATCH_STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Stage must be GROUP or PLAYOFF' });
    stage = req.body.stage;
  }

  const state = engine.initState(format);
  const info = db.prepare(`
    INSERT INTO matches (share_token, category, season_id, group_id, stage, player1_id, player2_id, is_doubles, player1b_id, player2b_id, location, scheduled_at, format, status, state, history, created_by_admin, created_by_anonymous, created_by_player_id, notes, balls_player, court_player, proposal_slots, proposal_venues, proposal_notify_email, proposed_by)
    VALUES (@share_token, @category, @season_id, @group_id, @stage, @player1_id, @player2_id, @is_doubles, @player1b_id, @player2b_id, @location, @scheduled_at, @format, 'PLANNED', @state, '[]', @created_by_admin, @created_by_anonymous, @created_by_player_id, @notes, @balls_player, @court_player, @proposal_slots, @proposal_venues, @proposal_notify_email, @proposed_by)
  `).run({
    share_token: crypto.randomUUID(),
    category,
    season_id: seasonId,
    group_id: groupId,
    stage,
    player1_id: p1.id,
    player2_id: p2.id,
    is_doubles: doubles ? 1 : 0,
    player1b_id: p1b ? p1b.id : null,
    player2b_id: p2b ? p2b.id : null,
    location: (location || '').trim(),
    scheduled_at: scheduledAt || null,
    format,
    state: JSON.stringify(state),
    created_by_admin: isAdmin(req) ? 1 : 0,
    created_by_anonymous: 0,
    // Null for admin (admin already has full rights regardless) — set only
    // when a specific real player created this as themselves, so
    // checkMatchAccess can later recognize "a match I made" even for a
    // match they're not one of the two players in.
    created_by_player_id: isAdmin(req) ? null : getPlayerId(req),
    notes: (notes || '').trim(),
    balls_player: ballsPlayer,
    court_player: courtPlayer,
    proposal_slots: proposalSlots ? JSON.stringify(proposalSlots) : null,
    proposal_venues: proposalVenues ? JSON.stringify(proposalVenues) : null,
    proposal_notify_email: proposalNotifyEmail,
    proposed_by: proposedBy,
  });

  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(info.lastInsertRowid);
  if (proposalSlots) notifyProposalReceived(row, proposedBy);
  const payload = broadcast(req, row);
  res.status(201).json(payload);
});
