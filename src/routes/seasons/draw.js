const db = require('../../db');
const tournamentDraw = require('../../tournamentDraw');
const liveDraw = require('../../liveDraw');
const clubTournaments = require('../../clubTournaments');
const courtStreams = require('../../courtStreams');
const courtNames = require('../../courtNames');
const router = require('./router');
const { tournamentOr404, serializeRegistration } = require('./shared');

// Per category: players, seeds, draw size and byes, and the brackets already made.
router.get('/:id/draw', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json({ slug: season.slug, courtCount: season.court_count || 0, courtNames: courtNames.fit(season, season.court_count || 0), courtStreams: courtStreams.streamsOf(season), playType: tournamentDraw.isDoublesTournament(season) ? 'DOUBLES' : 'SINGLES', categories: tournamentDraw.overview(season.id) });
});

// { category, seeds: [{ id: registrationId, seed }] } — replaces the seeds of that category; players left out are not seeded.
router.post('/:id/seeds', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.setSeeds(season.id, req.body && req.body.category, req.body && req.body.seeds);
  if (done.error) return res.status(400).json({ error: done.error });
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  res.json(rows.map(serializeRegistration));
});

// Makes the draw of one category: { category, format: 'PRINCE' | 'MONRAD' | 'ELIMINATION' | 'GROUPS' | 'GROUPS_BRACKET', mode: 'AUTO' | 'MANUAL',
// mainFormat, consolationFormat, groupFormat (match formats), groupSize, groupCount, qualifiers, bracketType, autoBracket,
// groups: [{ name, registrationIds }] (the groups as the organiser put them together; left out = suggested) } — see tournamentDraw.createDraw.
router.post('/:id/draw', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const made = tournamentDraw.createDraw(season, body.category, {
    format: body.format, mode: body.mode, mainFormat: body.mainFormat, consolationFormat: body.consolationFormat, consolationMode: body.consolationMode, byeMode: body.byeMode, groupFormat: body.groupFormat,
    groupSize: body.groupSize, groupCount: body.groupCount, qualifiers: body.qualifiers, bracketType: body.bracketType, autoBracket: body.autoBracket,
    groups: body.groups, rounds: body.rounds,
  });
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// The suggested split of a category into groups (what an automatic draw would do), for the organiser to look at and change before making
// the groups: ?category=ELITE&groupSize=4&groupCount=0
// The next round of a Swiss draw (it is made by itself once a round is played, when the draw was made to go on by itself; this is the organiser's button): { category }
router.post('/:id/draw/swiss-round', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const made = require('../../swiss').nextRound(season, (req.body || {}).category);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// The draw in front of the camera (the page /draw-live, see src/liveDraw.js): "prepare" makes the key and the plan of the draw from the same settings as POST /:id/draw
// ({ category, format, … }) and writes nothing into the tournament; "commit" ({ recordId }) saves exactly the draw that was shown.
router.post('/:id/draw/live/prepare', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const made = liveDraw.prepare(season, body.category, body);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.status(201).json(made);
});

router.post('/:id/draw/live/commit', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const made = liveDraw.commit(season, (req.body || {}).recordId);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// The draw of the players of a SEASON into its groups in front of the camera (the page /draw-live?mode=groups, see src/liveDraw.js): { category }
router.post('/:id/groups/live/prepare', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const made = liveDraw.prepareGroups(season, (req.body || {}).category);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.status(201).json(made);
});

router.post('/:id/groups/live/commit', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const made = liveDraw.commit(season, (req.body || {}).recordId);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json(made);
});

router.get('/:id/groups/draw-info', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (season.kind === 'TOURNAMENT') return res.json({ categories: [] });
  res.json({ categories: liveDraw.groupsOverview(season) });
});

// Empty groups of a category in one go: { category, count }
router.post('/:id/groups/bulk', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const made = liveDraw.createGroups(season, (req.body || {}).category, (req.body || {}).count);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.status(201).json(made);
});

// The draw into the groups at once, without the show: { category }
router.post('/:id/groups/auto', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const made = liveDraw.assignNow(season, (req.body || {}).category);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.status(201).json(made);
});

// The players out of the groups of a category (to divide them again): { category }
router.post('/:id/groups/clear', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const made = liveDraw.clearGroups(season, (req.body || {}).category);
  if (made.error) return res.status(made.status || 400).json({ error: made.error });
  res.json(made);
});

// the seeding of the registered players of a category of a season: { category, seeds: [{ id: registrationId, seed }] } (the seeded players go into the groups like a snake)
router.post('/:id/groups/seeds', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (season.kind === 'TOURNAMENT') return res.status(400).json({ error: 'A tournament has its seeding in the tab Formát' });
  const done = tournamentDraw.setSeeds(season.id, (req.body || {}).category, (req.body || {}).seeds);
  if (done.error) return res.status(400).json({ error: done.error });
  res.json({ ok: true });
});

router.get('/:id/draw/groups-suggestion', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const category = req.query.category;
  if (!tournamentDraw.categoriesFor(season).includes(category)) return res.status(400).json({ error: 'Choose a category' });
  const regs = tournamentDraw.registrationsOf(season.id, category);
  const suggested = require('../../tournamentGroups').suggestGroups(regs.map((r) => ({ playerId: r.id, seed: r.seed })), {
    groupSize: Number(req.query.groupSize) || 4, groupCount: Number(req.query.groupCount) || 0,
  });
  // playerId above is the registration id (what the draw request takes back)
  res.json({ groups: suggested.map((g) => ({ name: g.name, registrationIds: g.playerIds })) });
});

// The bracket after the groups of a GROUPS_BRACKET category: { category, mode: 'AUTO' | 'MANUAL', force } — the best of every group go in
// (needs every group match played unless force).
router.post('/:id/draw/bracket', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const made = tournamentDraw.createBracketFromGroups(season, body.category, { mode: body.mode, force: !!body.force });
  if (made.error) return res.status(made.status || 400).json({ code: made.code, error: made.error });
  const io = req.app.get('io');
  if (io) io.emit('matches:changed', { seasonId: season.id, status: 'CREATED' });
  res.status(201).json({ ...made, categories: tournamentDraw.overview(season.id) });
});

// ---- the pairs of the doubles (štvorhra) of the tournament; seeds and the draw of the category DOUBLES use the ordinary draw routes ----
router.get('/:id/doubles', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  res.json(tournamentDraw.doublesOverview(season));
});

// { player, partner } (ids or names) makes a pair; { fromRegistrations: true } makes the pairs the registration forms named
router.post('/:id/doubles/pairs', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const body = req.body || {};
  const done = body.fromRegistrations
    ? tournamentDraw.addPairsFromRegistrations(season)
    : tournamentDraw.addPair(season, { player: body.player, partner: body.partner });
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.status(201).json({ ...(body.fromRegistrations ? { created: done.created, skipped: done.skipped } : {}), overview: tournamentDraw.doublesOverview(season) });
});

router.delete('/:id/doubles/pairs/:pairId', clubTournaments.requireSeasonManager(clubTournaments.byIdAndPairId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.removePair(season, Number(req.params.pairId));
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.json(tournamentDraw.doublesOverview(season));
});

router.delete('/:id/draw/:category', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = tournamentOr404(req, res);
  if (!season) return;
  const done = tournamentDraw.deleteDraw(season, req.params.category, { bracketOnly: req.query.bracketOnly === "1" });
  if (done.error) return res.status(done.status || 400).json({ error: done.error });
  res.json({ ok: true, categories: tournamentDraw.overview(season.id) });
});
