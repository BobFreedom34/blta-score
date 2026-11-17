const db = require('../../db');
const { isAdmin, requireLoggedIn } = require('../../auth');
const rankingPoints = require('../../rankingPoints');
const changeLog = require('../../changeLog');
const matchPhotos = require('../matchPhotos');
const router = require('./router');
const { getRowOr404, checkMatchAccess, CATEGORIES, nowIso, notifyProposalReceived, broadcast, BLTA_CATEGORIES, matchCategoryOf, getPlayer, inferProposedBy, EMAIL_RE } = require('./shared');

router.patch('/:token', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkMatchAccess(req, res, row)) return;
  if (row.status === 'FINISHED' && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only an admin can edit a finished match' });
  }

  const fields = {};
  // Explicit null clears the pick; 1/2 sets it; anything else (including
  // omitted, which leaves it untouched) is rejected — same validation as
  // the POST / create route above.
  if (req.body.ballsPlayer !== undefined) {
    if (req.body.ballsPlayer === null) {
      fields.balls_player = null;
    } else {
      const ballsPlayer = Number(req.body.ballsPlayer);
      if (![1, 2].includes(ballsPlayer)) {
        return res.status(400).json({ error: 'ballsPlayer must be 1 or 2' });
      }
      fields.balls_player = ballsPlayer;
    }
  }
  if (req.body.courtPlayer !== undefined) {
    if (req.body.courtPlayer === null) {
      fields.court_player = null;
    } else {
      const courtPlayer = Number(req.body.courtPlayer);
      if (![1, 2].includes(courtPlayer)) {
        return res.status(400).json({ error: 'courtPlayer must be 1 or 2' });
      }
      fields.court_player = courtPlayer;
    }
  }
  if (typeof req.body.location === 'string') fields.location = req.body.location.trim();
  if (typeof req.body.scheduledAt === 'string' || req.body.scheduledAt === null) {
    fields.scheduled_at = req.body.scheduledAt;
  }
  // Only a CHANGE of the category does anything here: the edit window sends the category of the match every time, and a match of a tournament (category "Iné") must not be taken
  // out of its tournament and group just because something else of it (the place, the time, a player) was saved.
  if (req.body.category && CATEGORIES.includes(req.body.category) && req.body.category !== row.category) {
    // a match of a tournament stays in it: its category is the tournament's own (Iné) and a different one would leave it without its tournament and group
    const inTournament = row.season_id && db.prepare("SELECT 1 FROM seasons WHERE id = ? AND kind = 'TOURNAMENT'").get(row.season_id);
    if (inTournament) return res.status(400).json({ error: 'A match of a tournament keeps its tournament: its category cannot be changed' });
    if (BLTA_CATEGORIES.includes(req.body.category) && req.body.category !== row.category && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only an admin can move a match to the ELITE, NEXT GEN or NOVICE category' });
    }
    fields.category = req.body.category;
    // The season/group only exist for BLTA categories, and a group is of one category — keep that true.
    if (!BLTA_CATEGORIES.includes(req.body.category)) {
      fields.season_id = null;
      fields.group_id = null;
    } else if (row.group_id) {
      const g = db.prepare('SELECT category FROM season_groups WHERE id = ?').get(row.group_id);
      if (!g || matchCategoryOf(g.category) !== req.body.category) fields.group_id = null;
    }
  }
  if (typeof req.body.notes === 'string') {
    fields.notes = req.body.notes.trim();
  }
  // Reassigning who's actually in the match — admin-only regardless of the
  // broader checkMatchAccess check above (a regular match-managing player
  // can edit date/location/etc. on a match they don't administer, but
  // swapping out one of the two people playing it is a bigger deal). Only
  // touched if the client actually sent one; either can be omitted to leave
  // that side as-is (e.g. only correcting player2).
  if (req.body.player1Id !== undefined || req.body.player2Id !== undefined) {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only an admin can change the players in a match' });
    }
    if (row.is_doubles) return res.status(400).json({ error: 'The players of a doubles match cannot be changed here yet - delete the match and make a new one' });
    const p1Id = req.body.player1Id !== undefined ? Number(req.body.player1Id) : row.player1_id;
    const p2Id = req.body.player2Id !== undefined ? Number(req.body.player2Id) : row.player2_id;
    if (!Number.isInteger(p1Id) || !Number.isInteger(p2Id)) {
      return res.status(400).json({ error: 'Both players are required' });
    }
    if (p1Id === p2Id) {
      return res.status(400).json({ error: 'Players must be different' });
    }
    if (!getPlayer(p1Id) || !getPlayer(p2Id)) {
      return res.status(400).json({ error: 'One of the selected players does not exist' });
    }
    fields.player1_id = p1Id;
    fields.player2_id = p2Id;
    // winner_id is stored as a real player id (resolved from state.winner's
    // 1/2 position at finish time — see matchEngine.js) — if whoever was
    // recorded as the winner just got swapped out of that position, carry
    // the win over to whoever replaced them instead of leaving winner_id
    // pointing at someone no longer in this match at all. The score itself
    // (state.sets[].p1/p2) is positional and doesn't need any equivalent fix.
    if (row.winner_id === row.player1_id && p1Id !== row.player1_id) fields.winner_id = p1Id;
    else if (row.winner_id === row.player2_id && p2Id !== row.player2_id) fields.winner_id = p2Id;
  }
  // Explicit null (as opposed to omitted) cancels a pending proposal
  // outright — whoever can edit it (see canManageMatch) can also delete it,
  // putting the match back to a plain unscheduled Planned match with no
  // "Pick a time" card. Distinct from the array branch below, which sets a
  // new/updated proposal instead. If there's a counter-proposal, it's
  // promoted to take over as the primary proposal instead of being wiped
  // out with it — deleting your own offer shouldn't cost the other player
  // theirs (mirrors DELETE /:token/proposal above, kept in sync with it).
  if (req.body.proposalSlots === null) {
    if (row.counter_proposal_slots) {
      fields.proposal_slots = row.counter_proposal_slots;
      fields.proposal_venues = row.counter_proposal_venues;
      fields.proposed_by = row.counter_proposed_by;
      fields.proposal_notify_email = row.counter_proposal_notify_email;
    } else {
      fields.proposal_slots = null;
      fields.proposal_venues = null;
      fields.proposed_by = null;
      fields.proposal_notify_email = null;
    }
    fields.counter_proposal_slots = null;
    fields.counter_proposal_venues = null;
    fields.counter_proposed_by = null;
    fields.counter_proposal_notify_email = null;
  }
  // Same, but for just the counter-proposal — withdraws the second
  // calendar while leaving the first proposal (and its own "Pick a time"
  // card) in place.
  if (req.body.counterProposalSlots === null) {
    fields.counter_proposal_slots = null;
    fields.counter_proposal_venues = null;
    fields.counter_proposed_by = null;
    fields.counter_proposal_notify_email = null;
  }
  // "Propose times" from the homepage's quick-action button — turns an
  // existing undated Planned match into one awaiting a scheduling response,
  // same shape as creating one that way from the start (see POST / above).
  if (Array.isArray(req.body.proposalSlots) && req.body.proposalSlots.length > 0) {
    if (row.scheduled_at) {
      return res.status(400).json({ error: "Can't propose times for a match that's already scheduled" });
    }
    if (row.status !== 'PLANNED') {
      return res.status(400).json({ error: 'Only a planned match can have times proposed' });
    }
    if (req.body.proposalSlots.length > 60) {
      return res.status(400).json({ error: 'Too many proposed times (max 60)' });
    }
    const parsedSlots = req.body.proposalSlots.map((s) => new Date(s));
    if (parsedSlots.some((d) => Number.isNaN(d.getTime()))) {
      return res.status(400).json({ error: 'One of the proposed times is invalid' });
    }
    fields.proposal_slots = JSON.stringify(parsedSlots.map((d) => d.toISOString()).sort());

    const venues = Array.isArray(req.body.proposalVenues) ? req.body.proposalVenues : [];
    const trimmedVenues = venues.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (trimmedVenues.length === 0) {
      return res.status(400).json({ error: 'Add at least one preferred venue' });
    }
    if (trimmedVenues.length > 10) {
      return res.status(400).json({ error: 'Too many venues (max 10)' });
    }
    fields.proposal_venues = JSON.stringify(trimmedVenues);

    if (typeof req.body.proposalNotifyEmail === 'string' && req.body.proposalNotifyEmail.trim()) {
      const email = req.body.proposalNotifyEmail.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'Enter a valid confirmation email address' });
      }
      fields.proposal_notify_email = email;
    }

    let explicitProposedBy;
    if (req.body.proposedBy !== undefined && req.body.proposedBy !== null) {
      explicitProposedBy = Number(req.body.proposedBy);
      if (![1, 2].includes(explicitProposedBy)) {
        return res.status(400).json({ error: 'proposedBy must be 1 or 2' });
      }
    }
    fields.proposed_by = inferProposedBy(req, explicitProposedBy, row.player1_id, row.player2_id);
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }
  const setClause = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE matches SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...fields, updated_at: nowIso(), id: row.id });
  // Only the "propose times" branch above ever sets proposal_slots — every
  // other PATCH use (editing location/notes/balls/etc.) leaves this key
  // absent from fields entirely, so this can't misfire on an unrelated edit.
  if (fields.proposal_slots) notifyProposalReceived(row, fields.proposed_by);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  if (fields.player1_id !== undefined || fields.player2_id !== undefined) { try { require('../../bracketEngine').followMatchPlayers(updated); } catch (err) { console.error('[matches] the bracket slot did not follow the players:', err.message); } }
  const payload = broadcast(req, updated);
  res.json(payload);
});

router.delete('/:token', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!checkMatchAccess(req, res, row)) return;
  if (!isAdmin(req)) {
    if (row.status === 'FINISHED') {
      return res.status(403).json({ error: 'Only an admin can delete a finished match' });
    }
    if (row.created_by_admin) {
      return res.status(403).json({ error: 'This match was created by an admin — only an admin can delete it' });
    }
  }
  db.prepare('DELETE FROM messages WHERE match_id = ?').run(row.id);
  db.prepare('DELETE FROM match_notifications WHERE match_id = ?').run(row.id);
  // the match's photos: rows now, the files in Google Drive in the background
  matchPhotos.removeAllForMatch(row.id);
  db.prepare('DELETE FROM matches WHERE id = ?').run(row.id);
  req.app.get('io').emit('matches:changed', { token: row.share_token, status: 'DELETED' });
  res.status(204).end();

  // A deleted match takes the ranking points it added back with it (a no-op when it added none).
  try {
    const ranking = rankingPoints.reverseForMatchWithChanges(row.id);
    try { changeLog.logMatchDeleted(row, ranking); } catch (err) { console.error('[change log]', err.message); }
  } catch (err) {
    console.error('[matches] failed to reverse ranking points on delete:', err.message);
  }
});
