const db = require('../../db');
const leagues = require('../../leagues');
const { roundsOf } = require('../../bracketPlaces');
const { FROZEN } = require('../../frozenStandings');
const clubTournaments = require('../../clubTournaments');
const finalStandings = require('../../finalStandings');
const router = require('./router');
const { rulesOfSeason, computeGroupStandings } = require('./shared');

router.get('/:id/brackets', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const seesHidden = clubTournaments.canManageSeason(req, season); // (a hidden bracket: only who runs the season sees it)
  const rows = db.prepare("SELECT id, name, category, COALESCE(kind, 'MAIN') AS kind, parent_bracket_id AS parentBracketId, is_doubles AS isDoubles, feeds_round AS feedsRound, size, hidden FROM brackets WHERE season_id = ? ORDER BY id").all(season.id).filter((r) => seesHidden || !r.hidden);
  // the order the tabs show: a category after the other as they were made; inside one the main bracket first, then the losers brackets by the best place they play for
  // (3rd–4th, 5th–8th, 7th–8th …; see bracketPlaces), the ones whose place is not known (made long ago) last, each group by the order they were made
  const byId = new Map(rows.map((r) => [r.id, r]));
  const startOf = (b) => {
    if (b.kind === 'MAIN') return 1;
    const parent = byId.get(b.parentBracketId);
    if (!parent || !b.feedsRound) return 1000;
    const start = startOf(parent);
    return start >= 1000 ? 1000 : start + 2 ** (roundsOf(parent.size) - b.feedsRound);
  };
  const firstOfCategory = new Map();
  rows.forEach((r) => { if (!firstOfCategory.has(r.category)) firstOfCategory.set(r.category, r.id); });
  rows.sort((x, y) => firstOfCategory.get(x.category) - firstOfCategory.get(y.category) || startOf(x) - startOf(y) || x.id - y.id);
  res.json(rows.map(({ feedsRound, size, ...b }) => ({ ...b, isDoubles: !!b.isDoubles, hidden: !!b.hidden })));
});

// Public: the final standings of a tournament or a season (the tab "Konečné poradie"): who finished where, from the brackets and the groups (see finalStandings.js).
router.get('/:id/final-standings', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season || season.league_id !== leagues.actingIdOf(req)) return res.status(404).json({ error: 'Season not found' });
  if (clubTournaments.publicFace(season, req).hidden) return res.status(404).json({ error: 'Season not found' });
  res.json(finalStandings.compute(season, { withHidden: clubTournaments.canManageSeason(req, season) }));
});

// Public: the group tables of one season, calculated from the matches tagged with each group (see standings.js).
// Recalculated on every request, so it is always in step with the matches.
router.get('/:id/standings', (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id);
  // Finished seasons show the official final tables copied from blta.sk (src/frozenStandings.js); the current
  // season and the later ones are calculated from the matches below.
  const frozen = FROZEN[season.slug];
  if (frozen) {
    const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    const byName = new Map(db.prepare('SELECT id, name, slug FROM players').all().map((p) => [fold(p.name), p]));
    return res.json({
      id: season.id, name: season.name, slug: season.slug, startDate: season.start_date, endDate: season.end_date, frozen: true, rules: null,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        matchesCounted: null,
        matchesTotal: null,
        rows: (frozen[g.name.toLowerCase()] || []).map((r) => {
          const p = byName.get(fold(r.name));
          return { position: r.position, player: { id: p ? p.id : null, name: r.name, slug: p ? p.slug : null }, points: r.points, played: r.played, wins: r.wins, losses: r.losses, setDiff: r.setDiff };
        }),
      })),
    });
  }
  const players = new Map();
  const playerStmt = db.prepare('SELECT id, name, slug FROM players WHERE id = ?');
  const result = groups.map((g) => {
    const rows = db.prepare('SELECT player1_id, player2_id, winner_id, status, end_reason, state, COALESCE(scheduled_at, end_time, created_at) AS d FROM matches WHERE group_id = ? AND COALESCE(stage, \'GROUP\') = \'GROUP\'').all(g.id);
    // the groups of the doubles are tables of PAIRS (named "A / B", no profile); kept apart from the players of the other groups
    const pairGroup = g.category === 'DOUBLES';
    const known = pairGroup ? new Map() : players;
    const records = rows.map((r) => {
      [r.player1_id, r.player2_id].forEach((pid) => { if (!known.has(pid)) known.set(pid, pairGroup ? require('../../tournamentGroups').pairPlayer(season.id, pid) : playerStmt.get(pid)); });
      return { player1Id: r.player1_id, player2Id: r.player2_id, winnerId: r.winner_id, status: r.status, endReason: r.end_reason, date: r.d, state: JSON.parse(r.state) };
    });
    const swissOptions = pairGroup ? undefined : require('../../tournamentGroups').swissOptions(g);
    const table = computeGroupStandings(records, known, rulesOfSeason(season), swissOptions);
    const swissState = swissOptions ? require('../../swiss').state(season.id, g.category) : null;
    // a season of a community or club lists every member of the group from the start, with nothing played yet (the members arrange their matches themselves)
    if (season.organisation_id && !pairGroup) {
      const listed = new Set(table.map((x) => x.player.id));
      const last = table.length ? Math.max(...table.map((x) => x.position)) : 0;
      db.prepare('SELECT player_id FROM season_group_members WHERE group_id = ? ORDER BY sort_order, rowid').all(g.id).forEach((m) => {
        if (listed.has(m.player_id)) return;
        const player = playerStmt.get(m.player_id);
        if (player) table.push({ position: last + 1, player, points: 0, played: 0, wins: 0, losses: 0, setDiff: 0 });
      });
    }
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      matchesCounted: table.reduce((sum, x) => sum + x.played, 0) / 2,
      matchesTotal: records.length,
      swiss: swissState ? { round: swissState.round, rounds: swissState.rounds, finished: swissState.finished } : null,
      rows: table.map((x) => ({
        position: x.position,
        player: { id: x.player.id, name: x.player.name, slug: x.player.slug },
        points: x.points,
        played: x.played,
        wins: x.wins,
        losses: x.losses,
        setDiff: x.setDiff,
        ...(swissOptions ? { buchholz: x.buchholz } : {}),
      })),
    };
  });
  res.json({ id: season.id, name: season.name, slug: season.slug, startDate: season.start_date, endDate: season.end_date, frozen: false, rules: rulesOfSeason(season), groups: result });
});
