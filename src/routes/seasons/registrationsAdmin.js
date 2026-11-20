const db = require('../../db');
const nameMatch = require('../../nameMatch');
const auth = require('../../auth');
const tournamentDraw = require('../../tournamentDraw');
const clubTournaments = require('../../clubTournaments');
const capacity = require('../../registrationCapacity');
const seasonActivity = require('../../seasonActivity');
const replacePlayer = require('../../replacePlayer');
const router = require('./router');
const { resolveMemberPlayer, BLTA_CATEGORIES, profileCategory, serializeRegistrationsOf, announceNewlyIn, serializeRegistration } = require('./shared');

// The admin registers a player who is already in the app, without the registration form: the phone number and the e-mail
// come from the player's profile unless the admin types others, the category from the profile unless the admin picks one.
// It works whether or not the season's registration is open, and sends no e-mail.
router.post('/:id/registrations/admin', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const body = req.body || {};
  // a player from the list (playerId) or a name typed as text: the same name is the same player, a similar name asks who is meant, a new name needs
  // confirmNew: true and makes a new player (as when a player is added to a group)
  const typedName = typeof body.name === 'string' ? body.name.trim() : '';
  if ((body.playerId === undefined || body.playerId === null || body.playerId === '') && !typedName) return res.status(400).json({ error: 'Choose a player from the list' });
  const found = resolveMemberPlayer(body, season.league_id, { allowCreate: auth.isAdmin(req) });
  if (found.error) return res.status(400).json({ error: found.error === 'That player does not exist' ? 'Choose a player from the list' : found.error });
  if (found.conflict) {
    return res.status(409).json({ error: found.conflict.code === 'SIMILAR_PLAYERS' ? 'Similar players exist — choose who you mean' : 'No such player yet — confirm to create a new one', ...found.conflict });
  }
  const player = found.player;
  // a tournament entry may have no category (category = ''): sent as an empty category, or when the profile has none either
  const tournament = season.kind === 'TOURNAMENT';
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const partnerName = doublesTournament && typeof body.partner === 'string' ? body.partner.replace(/\s+/g, ' ').trim() : '';
  if (doublesTournament && (partnerName.length < 3 || partnerName.length > 80)) return res.status(400).json({ error: 'Enter the name of the partner' });
  let category = null;
  if (doublesTournament || season.categories === 'OPEN') category = ''; // a pair has no Elite / Next Gen / Novice category, nor has a player of a season without categories
  else if (BLTA_CATEGORIES.includes(body.category)) category = body.category;
  else if (tournament && body.category === '') category = '';
  else category = profileCategory(player.category) || (tournament ? '' : null);
  if (category === null) return res.status(400).json({ error: 'Choose a category' });

  // (the organiser of a club gets no phone number or e-mail of a player from his profile, and writes none: players who register themselves give their own)
  const siteAdmin = auth.isAdmin(req);
  const typedPhone = siteAdmin && typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone = siteAdmin ? String(typedPhone || player.phone || '').replace(/[^\d+]/g, '') : '';
  if (typedPhone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
  const typedEmail = siteAdmin && typeof body.email === 'string' ? body.email.trim() : '';
  const email = siteAdmin ? (typedEmail || String(player.email || '').trim()) : '';
  if (typedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail) || typedEmail.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });

  const already = db.prepare('SELECT player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)
    .some((r) => r.player_id === player.id || nameMatch.key(r.name) === nameMatch.key(player.name));
  if (already) return res.status(409).json({ code: 'ALREADY_REGISTERED', error: `${player.name} is already registered for this season` });

  const substitute = capacity.wouldWait(season, category, doublesTournament ? { name: player.name, partner: partnerName } : undefined); // the maximum is reached: he is a substitute (raise the maximum to let him in)
  // a player who is new (typed as text) gets the phone and the e-mail on his profile too, when the admin wrote them and nobody has that number: with it he can log in
  // (the page then asks him for a code of his own) - the profile of an existing player is never changed here
  let loginReady = false;
  if (found.created && phone) {
    const last9 = (v) => String(v || '').replace(/\D/g, '').slice(-9);
    const taken = db.prepare('SELECT phone FROM players WHERE phone IS NOT NULL AND id != ?').all(player.id).some((p) => last9(p.phone) === last9(phone));
    if (!taken) { db.prepare('UPDATE players SET phone = ?, email = COALESCE(NULLIF(?, \'\'), email) WHERE id = ?').run(phone, email, player.id); loginReady = true; }
  }
  const info = db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, paid, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player.id, player.name, phone, email, category, body.paid ? 1 : 0, partnerName);
  seasonActivity.log(season.id, substitute ? 'REGISTER_WAIT' : 'REGISTER', player.name, player.id);
  if (doublesTournament && !substitute) { try { tournamentDraw.addPair(season, { player: player.id, partner: partnerName }); } catch { /* the organiser makes the pair */ } }
  res.status(201).json({ ...serializeRegistrationsOf(season, [db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(info.lastInsertRowid)])[0], newPlayer: !!found.created, loginReady });
});

// "Nahradiť hráča": the registered player leaves and another one takes his place everywhere (registration, group, bracket slot, matches not played yet):
// { playerId } or { name (+ confirmNew) } for a player who is not in the list - a similar name asks first, as when a player is added to a group
router.post('/registrations/:rid/replace', clubTournaments.requireSeasonManager(clubTournaments.byRegistrationId), (req, res) => {
  const reg = db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(Number(req.params.rid));
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(reg.season_id);
  const body = req.body || {};
  const typed = typeof body.name === 'string' ? body.name.trim() : '';
  if ((body.playerId === undefined || body.playerId === null || body.playerId === '') && !typed) return res.status(400).json({ error: 'Choose the new player' });
  const found = resolveMemberPlayer(body, season.league_id, { allowCreate: auth.isAdmin(req) });
  if (found.error) return res.status(400).json({ error: found.error });
  if (found.conflict) {
    return res.status(409).json({ error: found.conflict.code === 'SIMILAR_PLAYERS' ? 'Similar players exist — choose who you mean' : 'No such player yet — confirm to create a new one', ...found.conflict });
  }
  const oldName = reg.name;
  const done = replacePlayer.replaceInSeason(season, reg, found.player, { keepContact: auth.isAdmin(req) });
  if (done.error) return res.status(done.status || 400).json({ error: done.error, code: done.code });
  seasonActivity.log(season.id, 'UNREGISTER', oldName, reg.player_id);
  seasonActivity.log(season.id, 'REGISTER', found.player.name, found.player.id);
  const io = req.app.get('io');
  if (io && done.matches) io.emit('matches:changed', { seasonId: season.id, status: 'REPLACED' });
  res.json({ ...done, newPlayer: !!found.created, name: found.player.name, old: oldName });
});

// The admin changes a registration: what is sent is changed, the rest stays — paid, category ('' = no category, tournaments only),
// phone, e-mail and note.
router.patch('/registrations/:rid', clubTournaments.requireSeasonManager(clubTournaments.byRegistrationId), (req, res) => {
  const row = db.prepare('SELECT r.*, s.kind AS season_kind, s.play_type AS season_play_type, s.categories AS season_categories FROM season_registrations r LEFT JOIN seasons s ON s.id = r.season_id WHERE r.id = ?').get(Number(req.params.rid));
  if (!row) return res.status(404).json({ error: 'Registration not found' });
  const body = req.body || {};
  const doublesEntry = row.season_kind === 'TOURNAMENT' && row.season_play_type === 'DOUBLES';
  if (doublesEntry && body.category !== undefined && body.category !== '') return res.status(400).json({ error: 'A doubles tournament has no categories' });
  const next = { paid: row.paid, category: row.category, phone: row.phone, email: row.email, note: row.note || '' };
  if (body.paid !== undefined) next.paid = body.paid ? 1 : 0;
  if (body.category !== undefined) {
    if (BLTA_CATEGORIES.includes(body.category)) next.category = body.category;
    else if (body.category === '' && (row.season_kind === 'TOURNAMENT' || row.season_categories === 'OPEN')) next.category = '';
    else return res.status(400).json({ error: 'Choose a category' });
  }
  const siteAdmin = auth.isAdmin(req); // the organiser of a club cannot write the phone or e-mail of a registration
  if (body.phone !== undefined && siteAdmin) {
    const phone = String(body.phone || '').trim().replace(/[^\d+]/g, '');
    if (phone && (phone.replace(/\D/g, '').length < 9 || phone.length > 20)) return res.status(400).json({ error: 'Enter a valid phone number' });
    next.phone = phone;
  }
  if (body.email !== undefined && siteAdmin) {
    const email = String(body.email || '').trim();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
    next.email = email;
  }
  if (body.note !== undefined) {
    const note = String(body.note || '').trim();
    if (note.length > 500) return res.status(400).json({ error: 'The note is too long (max 500 characters)' });
    next.note = note;
  }
  if (doublesEntry && body.partner !== undefined) {
    const partner = String(body.partner || '').replace(/\s+/g, ' ').trim();
    if (partner.length < 3 || partner.length > 80) return res.status(400).json({ error: 'Enter the name of the partner' });
    next.partner = partner;
  }
  const regSeason = db.prepare('SELECT * FROM seasons WHERE id = ?').get(row.season_id);
  const waitingBefore = regSeason ? capacity.substituteIds(regSeason) : new Set();
  db.prepare('UPDATE season_registrations SET paid = ?, category = ?, phone = ?, email = ?, note = ?, partner_name = ? WHERE id = ?')
    .run(next.paid, next.category, next.phone, next.email, next.note, next.partner !== undefined ? next.partner : (row.partner_name || ''), row.id);
  // the phone and the e-mail the admin wrote are put on the profile of the player too, but only where the profile has none (a value that is there is never overwritten,
  // and a phone that another player already has is not taken: with it somebody could log in as somebody else)
  if (siteAdmin && row.player_id) {
    const prof = db.prepare('SELECT phone, email FROM players WHERE id = ?').get(row.player_id);
    if (prof) {
      const last9 = (v) => String(v || '').replace(/D/g, '').slice(-9);
      const phoneFree = next.phone && !String(prof.phone || '').trim()
        && !db.prepare('SELECT phone FROM players WHERE phone IS NOT NULL AND id != ?').all(row.player_id).some((p) => last9(p.phone) === last9(next.phone));
      const emailFree = next.email && !String(prof.email || '').trim();
      if (phoneFree) db.prepare('UPDATE players SET phone = ? WHERE id = ?').run(next.phone, row.player_id);
      if (emailFree) db.prepare('UPDATE players SET email = ? WHERE id = ?').run(next.email, row.player_id);
    }
  }
  if (regSeason) announceNewlyIn(regSeason, waitingBefore); // (a category change can free a place in another category)
  const savedRow = db.prepare('SELECT * FROM season_registrations WHERE id = ?').get(row.id);
  res.json({ ok: true, ...(regSeason ? serializeRegistrationsOf(regSeason, [savedRow])[0] : serializeRegistration(savedRow)) });
});

// a withdrawn player is wiped out of the list of the withdrawn too (?playerId=<id> or ?name=<name> for one who had no profile)
router.delete('/:id/withdrawn', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const changes = seasonActivity.purge(Number(req.params.id), req.query.playerId, req.query.name);
  if (!changes) return res.status(404).json({ error: 'Nobody to delete' });
  res.json({ ok: true });
});

router.delete('/registrations/:rid', clubTournaments.requireSeasonManager(clubTournaments.byRegistrationId), (req, res) => {
  const row = db.prepare('SELECT season_id, name, player_id FROM season_registrations WHERE id = ?').get(Number(req.params.rid));
  const regSeason = row ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(row.season_id) : null;
  const waitingBefore = regSeason ? capacity.substituteIds(regSeason) : new Set();
  const info = db.prepare('DELETE FROM season_registrations WHERE id = ?').run(Number(req.params.rid));
  if (!info.changes) return res.status(404).json({ error: 'Registration not found' });
  // ?purge=1 ("Vymazať"): the player is wiped out of the event, not only withdrawn: no line is left in the lists of the withdrawn and under the comments
  if (row && req.query.purge === '1') seasonActivity.purge(row.season_id, row.player_id, row.name);
  else if (row) seasonActivity.log(row.season_id, 'UNREGISTER', row.name, row.player_id);
  // somebody dropped out: the first substitute of that category (or of the tournament) is in now
  if (regSeason) announceNewlyIn(regSeason, waitingBefore);
  res.json({ ok: true });
});
