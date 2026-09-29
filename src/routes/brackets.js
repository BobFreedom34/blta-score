// Playoff bracket ("Pavúk") CRUD + public read. Creation/editing is
// admin-only (see auth.requireAdmin) — this is a tournament-organizer tool,
// not something a regular player manages themselves, unlike most of this
// app's other match-creation flows. Reading a bracket (GET /:id) is public
// with no auth at all, same as a match page, since the whole point is a
// shareable/embeddable draw anyone can look at.
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const engine = require('../matchEngine');
const bracketEngine = require('../bracketEngine');

const router = express.Router();

function serializePlayer(player) {
  if (!player) return null;
  const stripped = auth.stripPrivateFields(player, {});
  return { id: stripped.id, name: stripped.name, slug: stripped.slug, nationality: stripped.nationality };
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

function serializeNode(node) {
  return {
    id: node.id,
    round: node.round,
    position: node.position,
    seed1: node.seed1,
    seed2: node.seed2,
    player1: serializePlayer(node.player1_id ? db.prepare('SELECT * FROM players WHERE id = ?').get(node.player1_id) : null),
    player2: serializePlayer(node.player2_id ? db.prepare('SELECT * FROM players WHERE id = ?').get(node.player2_id) : null),
    isBye: !!node.is_bye,
    match: serializeNodeMatch(node.match_id),
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
    size: tree.bracket.size,
    rounds: bracketEngine.roundCount(tree.bracket.size),
    createdAt: tree.bracket.created_at,
    nodes: tree.nodes.map(serializeNode),
  };
}

// Admin list — name/size/created_at only, for the admin's own "pick a
// bracket to manage" screen. (The public read below is per-bracket, not a
// public list — there's no public "browse all draws" page in v1.)
router.get('/', auth.requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM brackets ORDER BY id DESC').all();
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, format: r.format, size: r.size, createdAt: r.created_at,
  })));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid bracket id' });
  const payload = serializeBracket(id);
  if (!payload) return res.status(404).json({ error: 'Bracket not found' });
  res.json(payload);
});

// Two ways in: `entries` (auto-generate — [{playerId, seed}], size derived
// from the count) or a bare `size` (manual — an empty tree the admin fills
// in slot by slot afterwards via PATCH .../slots/:nodeId). Exactly one of
// the two is expected; entries wins if both are somehow sent.
router.post('/', auth.requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  const format = req.body.format;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!engine.FORMATS[format]) return res.status(400).json({ error: 'Invalid match format' });

  const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : null;
  if (rawEntries) {
    if (rawEntries.length < 2) return res.status(400).json({ error: 'Need at least 2 players to seed a draw' });
    if (rawEntries.length > 128) return res.status(400).json({ error: 'Too many players (max 128)' });
    const seeds = new Set();
    const playerIds = new Set();
    for (const e of rawEntries) {
      const playerId = Number(e.playerId);
      const seed = Number(e.seed);
      if (!Number.isInteger(playerId) || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId)) {
        return res.status(400).json({ error: `Unknown player id ${e.playerId}` });
      }
      if (!Number.isInteger(seed) || seed < 1) {
        return res.status(400).json({ error: 'Every player needs a whole-number seed (1, 2, 3…)' });
      }
      if (seeds.has(seed)) return res.status(400).json({ error: `Seed ${seed} is used more than once` });
      if (playerIds.has(playerId)) return res.status(400).json({ error: 'The same player is listed twice' });
      seeds.add(seed);
      playerIds.add(playerId);
    }
    const entries = rawEntries.map((e) => ({ playerId: Number(e.playerId), seed: Number(e.seed) }));
    const bracketId = bracketEngine.createBracket({ name, format, entries });
    return res.status(201).json(serializeBracket(bracketId));
  }

  const size = Number(req.body.size);
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    return res.status(400).json({ error: 'Give either a list of seeded players, or a draw size (2-256) for a manual draw' });
  }
  const bracketId = bracketEngine.createBracket({
    name, format, entries: null, size,
  });
  res.status(201).json(serializeBracket(bracketId));
});

router.patch('/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(id);
  if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
  const fields = {};
  if (typeof req.body.name === 'string') {
    const name = req.body.name.trim();
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    fields.name = name;
  }
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE brackets SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id`)
    .run({ ...fields, id });
  res.json(serializeBracket(id));
});

// Deletes the bracket's own structure only — any real `matches` rows this
// bracket already created stay exactly where they are (as ordinary
// matches, still findable/playable, just no longer linked to any draw).
// Never silently deletes real score data.
router.delete('/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(id);
  if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
  db.prepare('DELETE FROM bracket_matches WHERE bracket_id = ?').run(id);
  db.prepare('DELETE FROM brackets WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Manual-mode slot assignment — only for a node that doesn't have a real
// match yet (once two players are seated and a match exists, editing the
// pairing belongs on the match itself, not here).
router.patch('/:id/slots/:nodeId', auth.requireAdmin, (req, res) => {
  const bracketId = Number(req.params.id);
  const nodeId = Number(req.params.nodeId);
  const node = db.prepare('SELECT * FROM bracket_matches WHERE id = ? AND bracket_id = ?').get(nodeId, bracketId);
  if (!node) return res.status(404).json({ error: 'Slot not found' });
  if (node.match_id) return res.status(400).json({ error: 'This slot already has a match — edit the match itself instead' });

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
  bracketEngine.setSlotPlayers(nodeId, player1Id, player2Id);
  res.json(serializeBracket(bracketId));
});

module.exports = router;
