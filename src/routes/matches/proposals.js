const db = require('../../db');
const { sendProposalConfirmedEmail } = require('../../mailer');
const { isAdmin, getPlayerId, requireLoggedIn } = require('../../auth');
const router = require('./router');
const { getRowOr404, nowIso, notifyProposalConfirmed, broadcast, sideOf, inferProposedBy, notifyProposalReceived, EMAIL_RE, checkMatchAccess } = require('./shared');

// "Respond to a proposed time" endpoint. Player A created this match with
// several candidate slots + venues instead of one fixed date; Player B
// picks one of each — from either calendar if B also counter-proposed
// their own (see POST /:token/counter-propose), but only from A's
// calendar, not their own — the whole point is the *other* player picking
// from what you offered, not self-confirming your own availability. That
// fills in the match's real scheduled_at/location, same as if it had been
// entered directly, and clears both proposals — the negotiation is over
// either way. Unlike viewing the card (open to anyone with the link),
// actually confirming a slot requires being logged in as one of the two
// specific players in this match, or an admin — not a different player,
// not a visitor who hasn't logged in at all.
router.post('/:token/respond-proposal', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const requestingPlayerId = getPlayerId(req);
  if (!isAdmin(req)) {
    if (!requestingPlayerId || (requestingPlayerId !== row.player1_id && requestingPlayerId !== row.player2_id)) {
      return res.status(403).json({ error: 'Log in as one of the two players in this match to pick a time' });
    }
  }
  if (!row.proposal_slots) {
    return res.status(400).json({ error: 'This match has no proposed times to respond to' });
  }
  if (row.scheduled_at) {
    return res.status(409).json({ error: 'This match has already been scheduled' });
  }
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'This match is no longer awaiting a scheduling response' });
  }
  const { slot } = req.body;
  if (typeof slot !== 'string') {
    return res.status(400).json({ error: 'Pick one of the proposed times' });
  }
  // The venue is the responder's own call, not required to be one of the
  // proposer's suggested chips — they can pick one of those (the client
  // still offers them), type somewhere else entirely, or leave it blank
  // and fill it in later, same as any other scheduled match (location is
  // only actually required at :token/start, see above). So unlike slot,
  // venue is no longer matched against the proposal's own venues list.
  const venue = typeof req.body.venue === 'string' ? req.body.venue.trim() : '';
  // Same optional-and-independent pattern as PATCH /:token below: pick a
  // value only if the responder actually set one, otherwise leave whatever
  // was already on the match (null for a "propose times" match, since
  // neither the original New Match form's balls/court fields nor the
  // propose-times modal ever run for one — see POST / and counter-propose
  // above).
  let ballsPlayer = row.balls_player;
  if (req.body.ballsPlayer !== undefined) {
    if (req.body.ballsPlayer === null) {
      ballsPlayer = null;
    } else {
      ballsPlayer = Number(req.body.ballsPlayer);
      if (![1, 2].includes(ballsPlayer)) {
        return res.status(400).json({ error: 'ballsPlayer must be 1 or 2' });
      }
    }
  }
  let courtPlayer = row.court_player;
  if (req.body.courtPlayer !== undefined) {
    if (req.body.courtPlayer === null) {
      courtPlayer = null;
    } else {
      courtPlayer = Number(req.body.courtPlayer);
      if (![1, 2].includes(courtPlayer)) {
        return res.status(400).json({ error: 'courtPlayer must be 1 or 2' });
      }
    }
  }
  // Whichever calendar (the first proposal, or the counter-proposal if
  // there is one) actually offered this slot wins — a picked slot only
  // ever comes from one card's own options, so there's no ambiguity if it
  // happens to appear in both. proposerPlayerId (mapped from the 1/2
  // proposedBy shape to an actual player id) is null when whoever proposed
  // it left "who's proposing" blank — nothing to check against then, so
  // it's left open rather than blocked.
  const proposals = [
    { slots: JSON.parse(row.proposal_slots), notifyEmail: row.proposal_notify_email, proposerPlayerId: row.proposed_by === 1 ? row.player1_id : row.proposed_by === 2 ? row.player2_id : null },
    row.counter_proposal_slots ? { slots: JSON.parse(row.counter_proposal_slots), notifyEmail: row.counter_proposal_notify_email, proposerPlayerId: row.counter_proposed_by === 1 ? row.player1_id : row.counter_proposed_by === 2 ? row.player2_id : null } : null,
  ].filter(Boolean);
  const matched = proposals.find((p) => p.slots.includes(slot));
  if (!matched) {
    return res.status(400).json({ error: 'That time is not one of the proposed options' });
  }
  // A player can only pick from the *other* player's calendar, not confirm
  // their own offer — admin is exempt, same as the login check above.
  // proposerPlayerId is reliable for this now regardless of whether "who's
  // proposing" was actually filled in (see inferProposedBy above) — it's
  // null only when genuinely nobody logged in as either player made this
  // specific proposal (admin set it up, or an anonymous counter-propose),
  // in which case there's no "self" to guard against anyway.
  if (!isAdmin(req) && matched.proposerPlayerId && matched.proposerPlayerId === requestingPlayerId) {
    return res.status(403).json({ error: "You can't confirm the times you proposed yourself — wait for the other player to pick one" });
  }
  db.prepare(`
    UPDATE matches SET scheduled_at = ?, location = ?, balls_player = ?, court_player = ?, updated_at = ?,
      proposal_slots = NULL, proposal_venues = NULL, proposed_by = NULL, proposal_notify_email = NULL,
      counter_proposal_slots = NULL, counter_proposal_venues = NULL, counter_proposed_by = NULL, counter_proposal_notify_email = NULL
    WHERE id = ?
  `).run(slot, venue, ballsPlayer, courtPlayer, nowIso(), row.id);
  notifyProposalConfirmed(row.id, matched.proposerPlayerId, isAdmin(req) ? null : requestingPlayerId);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);

  const p1 = sideOf(updated, 1);
  const p2 = sideOf(updated, 2);
  if (matched.notifyEmail) {
    sendProposalConfirmedEmail(updated, p1, p2, matched.notifyEmail).catch((err) => {
      console.error('[matches] failed to send proposal-confirmed email:', err.message);
    });
  }
  // Also email the proposer's own profile address, alongside the bell
  // notification (see notifyProposalConfirmed above) — matched.notifyEmail
  // above is a one-off address the proposer optionally typed in just for
  // this proposal, separate from (and not necessarily the same as)
  // whatever's actually on file for them, so this can't just reuse that
  // same check. Skipped if it's the exact same address already covered
  // above, so a proposer who used their own profile email for both doesn't
  // get the same email twice.
  const proposer = matched.proposerPlayerId === updated.player1_id ? p1 : matched.proposerPlayerId === updated.player2_id ? p2 : null;
  if (proposer && proposer.email && proposer.email !== matched.notifyEmail) {
    sendProposalConfirmedEmail(updated, p1, p2, proposer.email).catch((err) => {
      console.error('[matches] failed to send proposal-confirmed profile email:', err.message);
    });
  }
});

// Instead of picking one of the offered slots, the other player submits
// their own times/venues as a second, independent proposal. Writes to the
// counter_proposal_* columns rather than overwriting proposal_slots — both
// calendars then show up on the match page side by side (see
// proposalCardHtml in match.js), and either one can still be confirmed via
// POST /:token/respond-proposal. Calling this again just re-submits the
// counter-proposal (its own "Edit" reaches this same route). Falls back to
// writing the first proposal instead if there somehow isn't one yet.
//
// Requires being logged in as one of this match's two players (or admin) —
// same gate as respond-proposal below, and for the same reason: this used
// to be fully public (link-only access, no login), but that let a player
// submit a proposal anonymously with nobody recorded as its proposer, which
// silently defeated the "can't confirm your own proposed times" rule (see
// inferProposedBy above) — an unattributed proposal has no "self" to block.
// Since actually confirming a time already requires this same login, there
// was never a genuinely anonymous end-to-end flow to preserve here.
router.post('/:token/counter-propose', (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  const requestingPlayerId = getPlayerId(req);
  if (!isAdmin(req)) {
    if (!requestingPlayerId || (requestingPlayerId !== row.player1_id && requestingPlayerId !== row.player2_id)) {
      return res.status(403).json({ error: 'Log in as one of the two players in this match to propose times' });
    }
  }
  if (row.scheduled_at) {
    return res.status(409).json({ error: 'This match has already been scheduled' });
  }
  if (row.status !== 'PLANNED') {
    return res.status(400).json({ error: 'This match is no longer awaiting a scheduling response' });
  }
  if (!Array.isArray(req.body.proposalSlots) || req.body.proposalSlots.length === 0) {
    return res.status(400).json({ error: 'Mark at least one time you can play' });
  }
  if (req.body.proposalSlots.length > 60) {
    return res.status(400).json({ error: 'Too many proposed times (max 60)' });
  }
  const parsedSlots = req.body.proposalSlots.map((s) => new Date(s));
  if (parsedSlots.some((d) => Number.isNaN(d.getTime()))) {
    return res.status(400).json({ error: 'One of the proposed times is invalid' });
  }
  const proposalSlots = parsedSlots.map((d) => d.toISOString()).sort();

  const venues = Array.isArray(req.body.proposalVenues) ? req.body.proposalVenues : [];
  const trimmedVenues = venues.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  if (trimmedVenues.length === 0) {
    return res.status(400).json({ error: 'Add at least one preferred venue' });
  }
  if (trimmedVenues.length > 10) {
    return res.status(400).json({ error: 'Too many venues (max 10)' });
  }

  let proposedBy;
  if (req.body.proposedBy !== undefined && req.body.proposedBy !== null) {
    proposedBy = Number(req.body.proposedBy);
    if (![1, 2].includes(proposedBy)) {
      return res.status(400).json({ error: 'proposedBy must be 1 or 2' });
    }
  }
  // This route takes no login at all (the share link is the only access
  // control — see its own comment above), but if whoever's submitting the
  // counter-proposal DOES happen to have a player session, and it's one of
  // this match's own two players, that's worth using — same reasoning as
  // inferProposedBy's own doc comment.
  proposedBy = inferProposedBy(req, proposedBy, row.player1_id, row.player2_id);
  let proposalNotifyEmail = null;
  if (typeof req.body.proposalNotifyEmail === 'string' && req.body.proposalNotifyEmail.trim()) {
    const email = req.body.proposalNotifyEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid confirmation email address' });
    }
    proposalNotifyEmail = email;
  }

  if (row.proposal_slots) {
    db.prepare('UPDATE matches SET counter_proposal_slots = ?, counter_proposal_venues = ?, counter_proposed_by = ?, counter_proposal_notify_email = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(proposalSlots), JSON.stringify(trimmedVenues), proposedBy, proposalNotifyEmail, nowIso(), row.id);
  } else {
    db.prepare('UPDATE matches SET proposal_slots = ?, proposal_venues = ?, proposed_by = ?, proposal_notify_email = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(proposalSlots), JSON.stringify(trimmedVenues), proposedBy, proposalNotifyEmail, nowIso(), row.id);
  }
  notifyProposalReceived(row, proposedBy);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Shared by the routes below that touch an existing proposal card. Each
// card belongs to whichever specific player it names in its optional
// proposedBy/counterProposedBy field — that field being set is what draws
// the "who's proposing" name on the card in the first place, and player 1
// editing or deleting player 2's card (or vice versa) would be a real
// surprise. Admin can always. If nobody was named (the field was left
// blank), there's no specific owner to check against, so it falls back to
// the same match-management access as everything else on the match
// (checkMatchAccess) rather than leaving it permanently unmanageable by
// anyone.
function authorizeProposalOwner(req, res, row, proposedByValue) {
  if (isAdmin(req)) return true;
  if (proposedByValue === 1 || proposedByValue === 2) {
    const ownerPlayerId = proposedByValue === 1 ? row.player1_id : row.player2_id;
    const playerId = getPlayerId(req);
    if (playerId && playerId === ownerPlayerId) return true;
    res.status(403).json({ error: 'Log in as the player who made this proposal' });
    return false;
  }
  return checkMatchAccess(req, res, row);
}

// Edits the primary proposal's slots/venues/who's-proposing/notify-email
// after it's already been created — the "Edit" link on the "Pick a time"
// card, not the original creation flow (POST / or PATCH /:token's
// proposalSlots array branch, which stay gated by the broader
// checkMatchAccess — injecting a brand-new proposal into a match is
// different from updating a proposal you already made). Same validation as
// those two.
router.patch('/:token/proposal', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!row.proposal_slots) {
    return res.status(400).json({ error: 'This match has no proposal to edit' });
  }
  if (!authorizeProposalOwner(req, res, row, row.proposed_by)) return;
  if (row.scheduled_at) {
    return res.status(409).json({ error: 'This match has already been scheduled' });
  }
  if (!Array.isArray(req.body.proposalSlots) || req.body.proposalSlots.length === 0) {
    return res.status(400).json({ error: 'Mark at least one time you can play' });
  }
  if (req.body.proposalSlots.length > 60) {
    return res.status(400).json({ error: 'Too many proposed times (max 60)' });
  }
  const parsedSlots = req.body.proposalSlots.map((s) => new Date(s));
  if (parsedSlots.some((d) => Number.isNaN(d.getTime()))) {
    return res.status(400).json({ error: 'One of the proposed times is invalid' });
  }
  const proposalSlots = parsedSlots.map((d) => d.toISOString()).sort();

  const venues = Array.isArray(req.body.proposalVenues) ? req.body.proposalVenues : [];
  const trimmedVenues = venues.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  if (trimmedVenues.length === 0) {
    return res.status(400).json({ error: 'Add at least one preferred venue' });
  }
  if (trimmedVenues.length > 10) {
    return res.status(400).json({ error: 'Too many venues (max 10)' });
  }

  let proposedBy;
  if (req.body.proposedBy !== undefined && req.body.proposedBy !== null) {
    proposedBy = Number(req.body.proposedBy);
    if (![1, 2].includes(proposedBy)) {
      return res.status(400).json({ error: 'proposedBy must be 1 or 2' });
    }
  }
  proposedBy = inferProposedBy(req, proposedBy, row.player1_id, row.player2_id);
  let proposalNotifyEmail = null;
  if (typeof req.body.proposalNotifyEmail === 'string' && req.body.proposalNotifyEmail.trim()) {
    const email = req.body.proposalNotifyEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter a valid confirmation email address' });
    }
    proposalNotifyEmail = email;
  }

  db.prepare('UPDATE matches SET proposal_slots = ?, proposal_venues = ?, proposed_by = ?, proposal_notify_email = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(proposalSlots), JSON.stringify(trimmedVenues), proposedBy, proposalNotifyEmail, nowIso(), row.id);

  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Deletes the primary proposal — unlike PATCH /:token (which also handles
// this via proposalSlots: null, gated by the broader ownership-based
// checkMatchAccess), this route is gated by authorizeProposalOwner above so
// the specific player named as proposer can delete their own card even on
// a match they don't otherwise "manage" (e.g. one the other player, not
// them, created). If there's a counter-proposal, it's promoted to take
// over as the primary proposal instead of being wiped out with it —
// deleting your own offer shouldn't cost the other player theirs (kept in
// sync with PATCH /:token's proposalSlots: null branch above).
router.delete('/:token/proposal', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!row.proposal_slots) {
    return res.status(400).json({ error: 'This match has no proposal to delete' });
  }
  if (!authorizeProposalOwner(req, res, row, row.proposed_by)) return;
  if (row.counter_proposal_slots) {
    db.prepare(`
      UPDATE matches SET
        proposal_slots = counter_proposal_slots, proposal_venues = counter_proposal_venues,
        proposed_by = counter_proposed_by, proposal_notify_email = counter_proposal_notify_email,
        counter_proposal_slots = NULL, counter_proposal_venues = NULL, counter_proposed_by = NULL, counter_proposal_notify_email = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(nowIso(), row.id);
  } else {
    db.prepare(`
      UPDATE matches SET proposal_slots = NULL, proposal_venues = NULL, proposed_by = NULL, proposal_notify_email = NULL, updated_at = ?
      WHERE id = ?
    `).run(nowIso(), row.id);
  }
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});

// Deletes an existing counter-proposal — same trust model as
// counter-propose above extended one step: submitting/editing one is fully
// public (no login at all, see the route above), but deleting is more
// consequential, so this does require being logged in, and specifically as
// the player named as counter-proposer (see authorizeProposalOwner).
router.delete('/:token/counter-proposal', requireLoggedIn, (req, res) => {
  const row = getRowOr404(req, res);
  if (!row) return;
  if (!row.counter_proposal_slots) {
    return res.status(400).json({ error: 'This match has no counter-proposal to delete' });
  }
  if (!authorizeProposalOwner(req, res, row, row.counter_proposed_by)) return;
  db.prepare(`
    UPDATE matches SET counter_proposal_slots = NULL, counter_proposal_venues = NULL, counter_proposed_by = NULL, counter_proposal_notify_email = NULL, updated_at = ?
    WHERE id = ?
  `).run(nowIso(), row.id);
  const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
  const payload = broadcast(req, updated);
  res.json(payload);
});
