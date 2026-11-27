const db = require('../../db');
const leagues = require('../../leagues');
const nameMatch = require('../../nameMatch');
const { sendSeasonRegistrationEmail, sendSeasonUnregistrationEmail } = require('../../mailer');
const mailer = require('../../mailer');
const auth = require('../../auth');
const playerRoutes = require('../player');
const { creditInviter } = require('../invites');
const tournamentDraw = require('../../tournamentDraw');
const clubTournaments = require('../../clubTournaments');
const capacity = require('../../registrationCapacity');
const seasonActivity = require('../../seasonActivity');
const playerPush = require('../../playerPush');
const unregister = require('../../unregister');
const router = require('./router');
const { registrationOpen, tournamentStarted, parseCategories, announceNewlyIn, serializeRegistrationsOf, serializeRegistration, BLTA_CATEGORIES } = require('./shared');

// ---------- registration to a season ----------

// Registering is public, so it is limited: a few per hour from one address, plus a hidden field a person never fills in.
const registerAttempts = new Map();
function tooManyRegistrations(ip) {
  const now = Date.now();
  const recent = (registerAttempts.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  recent.push(now);
  registerAttempts.set(ip, recent);
  return recent.length > 6;
}

router.post('/:id/registrations', async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season || clubTournaments.publicFace(season, req).hidden) return res.status(404).json({ error: 'Season not found' });
  const body = req.body || {};
  if (body.website) return res.status(201).json({ ok: true }); // the hidden field was filled in: a bot, pretend it worked
  if (!registrationOpen(season)) return res.status(403).json({ code: 'REGISTRATION_CLOSED', error: tournamentStarted(season) ? 'Registration is closed: the tournament has already started' : 'Registration for this season is closed' });
  if (tooManyRegistrations((String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.ip)) return res.status(429).json({ error: 'Too many registrations from this address — try again later' });

  const typed = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.replace(/[^\d+]/g, '') : '';
  if (typed.length < 3 || typed.length > 80) return res.status(400).json({ code: 'BAD_NAME', error: 'Enter your name and surname' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return res.status(400).json({ code: 'BAD_EMAIL', error: 'Enter a valid e-mail address' });
  if (phone.replace(/\D/g, '').length < 9 || phone.length > 20) return res.status(400).json({ code: 'BAD_PHONE', error: 'Enter a valid phone number' });
  // a tournament entry has no category: the admin sorts the players into categories afterwards
  // (a season without categories has none either: its groups are made by the organiser)
  // (the pop-up of Backend > Popups asks no category either: the organiser knows the players and sorts them; only a logged-in player, for himself)
  const sortedByOrganiser = body.popup === true && auth.getPlayerId(req) !== null && Number(body.playerId) === auth.getPlayerId(req) && !body.category;
  const noCategory = season.kind === 'TOURNAMENT' || season.categories === 'OPEN' || sortedByOrganiser;
  const entryCategory = noCategory ? '' : body.category;
  if (!noCategory && !parseCategories(season.categories).includes(body.category)) return res.status(400).json({ code: 'BAD_CATEGORY', error: 'Choose a category' });
  const note = typeof body.note === 'string' ? body.note.replace(/\r\n/g, '\n').trim() : '';
  if (note.length > 500) return res.status(400).json({ code: 'BAD_NOTE', error: 'The note is too long (max 500 characters)' });
  // a doubles tournament is entered as a pair: the partner is required (the pair is made from it); a singles tournament has no partner
  const doublesTournament = tournamentDraw.isDoublesTournament(season);
  const partner = doublesTournament && typeof body.partner === 'string' ? body.partner.replace(/\s+/g, ' ').trim() : '';
  if (doublesTournament && (partner.length < 3 || partner.length > 80)) return res.status(400).json({ code: 'BAD_PARTNER', error: 'Enter the name of your partner' });
  if (doublesTournament && nameMatch.key(partner) === nameMatch.key(typed)) return res.status(400).json({ code: 'BAD_PARTNER', error: 'Your partner has to be somebody else' });

  // who is this: a chosen existing player, a typed name that is one, or a new name
  const players = db.prepare('SELECT id, name FROM players').all();
  let player = null;
  if (body.playerId !== undefined && body.playerId !== null && body.playerId !== '') {
    player = players.find((p) => p.id === Number(body.playerId)) || null;
    if (!player) return res.status(400).json({ code: 'BAD_NAME', error: 'That player does not exist' });
  } else {
    const { exact, similar } = nameMatch.findSimilar(typed, players);
    player = exact || null;
    if (!player && similar.length && !body.confirmNew) {
      return res.status(409).json({ code: 'SIMILAR_PLAYERS', typed, suggestions: similar.map((p) => ({ id: p.id, name: p.name })) });
    }
  }
  const name = player ? player.name : typed;
  const already = db.prepare('SELECT id, player_id, name FROM season_registrations WHERE season_id = ?').all(season.id)
    .some((r) => (player && r.player_id === player.id) || nameMatch.key(r.name) === nameMatch.key(name));
  if (already) return res.status(409).json({ code: 'ALREADY_REGISTERED', error: 'This player is already registered for the season' });

  // A visitor who is not in the app yet becomes a player now: the account is made (and logged in; the page then asks for the 5-digit code),
  // like after the app's own registration. An existing roster name that has no phone yet is claimed the same way. An existing player who
  // already has a phone is never touched or logged in (anybody can type a name). A phone that already belongs to another player stops the
  // account (the entry is still saved, and the e-mail to the admin says so).
  const account = openAccount(req, res, player, { name, phone, email, leagueId: season.league_id });
  if (account.player) player = account.player;

  // the maximum of players is reached: this one is a substitute (in when somebody drops out), see registrationCapacity.js
  const substitute = capacity.wouldWait(season, entryCategory, doublesTournament ? { name, partner } : undefined);
  // (the partner of a doubles tournament was checked above, before anything is made)
  db.prepare('INSERT INTO season_registrations (season_id, player_id, name, phone, email, category, note, partner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, player ? player.id : null, name, phone, email, entryCategory, note, partner);
  // the pair is made at once when both players are known; otherwise the organiser makes it (draw tab: "Páry z registrácií"); a pair of substitutes is made when they come in
  if (doublesTournament && player && !substitute) { try { tournamentDraw.addPair(season, { player: player.id, partner }); } catch { /* the organiser makes it */ } }
  seasonActivity.log(season.id, substitute ? 'REGISTER_WAIT' : 'REGISTER', name, player ? player.id : null);
  const total = db.prepare('SELECT COUNT(*) AS n FROM season_registrations WHERE season_id = ?').get(season.id).n;
  notifyOrganisationAdmins(season, { name, substitute, playerId: player ? player.id : null }); // the bell of the admins of the club that runs it
  // the e-mail to the admin must never make the registration fail
  sendSeasonRegistrationEmail(season, { name, phone, email, category: entryCategory, note, isNew: !player, account: account.status, phoneHolder: account.holder, substitute }, total)
    .catch((err) => console.error('[season registration] admin e-mail failed:', err.message));
  res.status(201).json({ ok: true, name, category: entryCategory, substitute, paymentUrl: season.payment_url || '', account: account.status, pinSetupRequired: account.status === 'created' || account.status === 'claimed' });
});

// A registered player drops out himself (the button "Odhlásiť sa"): only while the organiser allows it (hours before the start, see src/unregister.js) and before the
// draw. The first substitute comes in, and the organisation's admins get a bell row, a push and (the owner of the site) an e-mail, like for a registration.
router.delete('/:id/registrations/mine', async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season || clubTournaments.publicFace(season, req).hidden) return res.status(404).json({ error: 'Season not found' });
  const playerId = auth.getPlayerId(req);
  if (!playerId) return res.status(401).json({ error: 'Log in as a player first' });
  const row = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? AND player_id = ? ORDER BY id LIMIT 1').get(season.id, playerId);
  if (!row) return res.status(404).json({ code: 'NOT_REGISTERED', error: 'You are not registered for this event' });
  const state = unregister.stateFor(season, playerId);
  if (!state.allowed) {
    const message = { OFF: 'The organiser does not allow dropping out on your own: write to the organiser', LATE: 'It is too late to drop out on your own: write to the organiser', DRAW: 'The draw is made already: write to the organiser' }[state.reason];
    return res.status(403).json({ code: `UNREGISTER_${state.reason}`, error: message, deadline: state.deadline });
  }
  const waitingBefore = capacity.substituteIds(season);
  const wasSubstitute = waitingBefore.has(row.id);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM season_registrations WHERE id = ?').run(row.id);
    // a doubles pair he was in is no more (no draw is made yet, see above)
    db.prepare('DELETE FROM tournament_pairs WHERE season_id = ? AND (player_id = ? OR partner_id = ?)').run(season.id, playerId, playerId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  seasonActivity.log(season.id, 'UNREGISTER', row.name, playerId);
  announceNewlyIn(season, waitingBefore); // somebody dropped out: the first substitute is in now
  notifyOrganisationAdmins(season, { name: row.name, substitute: wasSubstitute, playerId, kind: 'UNREGISTER' });
  const total = db.prepare('SELECT COUNT(*) AS n FROM season_registrations WHERE season_id = ?').get(season.id).n;
  sendSeasonUnregistrationEmail(season, { name: row.name, phone: row.phone, email: row.email, substitute: wasSubstitute }, total)
    .catch((err) => console.error('[season unregistration] admin e-mail failed:', err.message));
  res.json({ ok: true });
});

// -> { status, player?, holder? }
//   created   a new player was made from the typed name, phone and e-mail, and is logged in
//   claimed   an existing roster player without a phone got this phone and e-mail, and is logged in
//   exists    the player already has an account: nothing changes, nobody is logged in
//   phoneTaken a new name, but the phone belongs to another player: no account (holder = that player's name)
//   none      the phone is not one an account can be made with
function openAccount(req, res, player, { name, phone, email, leagueId = leagues.DEFAULT_LEAGUE_ID }) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (/^[1-9]\d{8}$/.test(digits)) digits = `0${digits}`; // 903111222 -> 0903111222
  const validPhone = /^0\d{9}$/.test(digits) || /^\+\d{8,15}$/.test(digits);
  if (player) {
    const row = db.prepare('SELECT id, name, slug, phone FROM players WHERE id = ?').get(player.id);
    if (!row || row.phone) return { status: 'exists' };
    if (!validPhone) return { status: 'none' };
    const holder = playerRoutes.findPlayerByPhone(digits);
    if (holder) return { status: 'phoneTaken', holder: holder.name };
    db.prepare('UPDATE players SET phone = ?, email = ? WHERE id = ?').run(digits, email.slice(0, 100), row.id);
    auth.logInPlayer(res, row.id);
    return { status: 'claimed', player: { id: row.id, name: row.name } };
  }
  if (!validPhone) return { status: 'none' };
  const holder = playerRoutes.findPlayerByPhone(digits);
  if (holder) return { status: 'phoneTaken', holder: holder.name };
  const slug = playerRoutes.uniqueSlugFor(name);
  const info = db.prepare('INSERT INTO players (name, slug, phone, email, league_id) VALUES (?, ?, ?, ?, ?)').run(name, slug, digits, email.slice(0, 100), leagueId);
  const created = { id: Number(info.lastInsertRowid), name };
  creditInviter(req, res, created.id); // a new player who came through somebody's invite link
  auth.logInPlayer(res, created.id);
  return { status: 'created', player: created };
}

// when the last payment reminder was sent to a registration (Backend > Registrácie > "Remind unpaid")
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'reminded_at')) {
  db.exec('ALTER TABLE season_registrations ADD COLUMN reminded_at TEXT');
}

// A registration for an event of a community or club: a bell notification (and a push) to every ACTIVE admin of it, except the player who registered (when he is
// one of them). Never makes the registration fail.
function notifyOrganisationAdmins(season, { name, substitute, playerId, kind = 'REGISTER' }) {
  try {
    if (!season.organisation_id) return;
    const org = db.prepare('SELECT id, slug, name FROM organisations WHERE id = ?').get(season.organisation_id);
    if (!org) return;
    const admins = db.prepare("SELECT player_id FROM organisation_members WHERE organisation_id = ? AND role = 'ADMIN' AND status = 'ACTIVE'").all(org.id).map((r) => r.player_id).filter((id) => id !== playerId);
    const insert = db.prepare('INSERT INTO registration_notifications (player_id, season_id, name, substitute, kind) VALUES (?, ?, ?, ?, ?)');
    admins.forEach((adminId) => {
      insert.run(adminId, season.id, name, substitute ? 1 : 0, kind);
      playerPush.notifyPlayer(adminId, kind === 'UNREGISTER' ? 'UNREGISTRATION' : 'REGISTRATION', { name, seasonName: season.name, seasonId: season.id, orgName: org.name, substitute: !!substitute });
    });
  } catch (err) {
    console.error('[registration] could not notify the admins of the club:', err.message);
  }
}

// The registrations as a spreadsheet (CSV with a byte-order mark so Excel reads the letters right).
router.get('/:id/registrations.csv', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  const cell = (v) => {
    const text = String(v == null ? '' : v);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const state = capacity.standing(season);
  const lines = [['Meno', 'Kategória', 'Telefón', 'Email', 'Zaplatené', 'Poznámka', 'Registrovaný', 'Stav'].join(',')];
  rows.forEach((r) => { const s = state.get(r.id) || {}; lines.push([r.name, r.category || '', r.phone || '', r.email || '', r.paid ? 'áno' : 'nie', r.note || '', String(r.created_at || '').slice(0, 10), s.substitute ? `náhradník ${s.position}` : 'v turnaji'].map(cell).join(',')); });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="registracie-${(season.slug || 'sezona').replace(/[^a-z0-9-]/gi, '')}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

// A reminder e-mail to the players who have not paid: { ids: [..] } (all the unpaid ones with an e-mail when left out). A registration
// that was reminded in the last 24 hours is skipped (so a double click does not write twice). -> { sent, noEmail, recent, failed }
router.post('/:id/registrations/remind', clubTournaments.requireSeasonManager(clubTournaments.byParamId), async (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const wanted = Array.isArray(req.body && req.body.ids) ? new Set(req.body.ids.map(Number)) : null;
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? AND paid = 0 ORDER BY created_at, id').all(season.id)
    .filter((r) => !wanted || wanted.has(r.id));
  const out = { sent: 0, noEmail: 0, recent: 0, failed: 0 };
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const contact = require('../contact').read();
  const organiser = [contact.email, contact.phone].filter(Boolean).join(' · ');
  const stamp = db.prepare('UPDATE season_registrations SET reminded_at = ? WHERE id = ?');
  const siteAdmin = auth.isAdmin(req); // (the admin of the site also reaches the e-mail of the profile when the registration has none, as the list shows it)
  const profileEmail = db.prepare('SELECT email FROM players WHERE id = ?');
  for (const r0 of rows) {
    const r = { ...r0, email: r0.email || (siteAdmin && r0.player_id ? String((profileEmail.get(r0.player_id) || {}).email || '').trim() : '') };
    if (!r.email) { out.noEmail += 1; continue; }
    if (r.reminded_at && new Date(r.reminded_at).getTime() > dayAgo) { out.recent += 1; continue; }
    try {
      const ok = await mailer.sendPaymentReminderEmail({ to: r.email, name: r.name, seasonName: season.name, fee: season.entry_fee || '', paymentUrl: season.payment_url || '', organiser });
      if (ok) { stamp.run(new Date().toISOString(), r.id); out.sent += 1; } else out.failed += 1;
    } catch (err) {
      console.error('[payment reminder] failed:', err.message);
      out.failed += 1;
    }
  }
  res.json(out);
});

// The admin's list: with the contact details (never sent to the public page).
router.get('/:id/registrations', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(Number(req.params.id));
  const list = season ? serializeRegistrationsOf(season, rows) : rows.map(serializeRegistration);
  // the admin of the site sees the contact of the profile where the registration itself has none (a registration keeps the copy it got when it was made;
  // a phone or an e-mail that came to the profile later was missing there). The organiser of a club never gets them.
  if (auth.isAdmin(req)) {
    const profile = db.prepare('SELECT phone, email FROM players WHERE id = ?');
    list.forEach((r) => {
      if (!r.playerId || (r.phone && r.email)) return;
      const p = profile.get(r.playerId);
      if (!p) return;
      if (!r.phone && p.phone) r.phone = p.phone;
      if (!r.email && p.email) r.email = p.email;
    });
  }
  res.json(list);
});

// The admin sorts many players into categories at once (the "Zaradenie do kategórií" screen): { assignments: [{ id, category }] }, category
// ELITE / NEXT_GEN / NOVICE or '' for "not sorted yet". All or nothing: one bad entry changes nothing.
router.post('/:id/registrations/categories', clubTournaments.requireSeasonManager(clubTournaments.byParamId), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(req.params.id));
  if (!season) return res.status(404).json({ error: 'Season not found' });
  if (tournamentDraw.isDoublesTournament(season)) return res.status(400).json({ error: 'A doubles tournament has no categories' });
  if (tournamentDraw.isOpenTournament(season)) return res.status(400).json({ error: 'A tournament without categories needs no sorting' });
  const list = req.body && req.body.assignments;
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Nothing to save' });
  const own = new Set(db.prepare('SELECT id FROM season_registrations WHERE season_id = ?').all(season.id).map((r) => r.id));
  for (const item of list) {
    if (!item || !own.has(Number(item.id))) return res.status(400).json({ error: 'A registration does not belong to this season' });
    const allowed = season.kind === 'TOURNAMENT' ? tournamentDraw.categoriesFor(season) : BLTA_CATEGORIES; // (a tournament played in Elite and Next Gen has no Novice to sort into)
    const ok = allowed.includes(item.category) || item.category === ''; // '' = back to "not sorted yet" (a league has such players too: a registration through the pop-up asks no category)
    if (!ok) return res.status(400).json({ error: 'Choose a category' });
  }
  const update = db.prepare('UPDATE season_registrations SET category = ?, seed = CASE WHEN category = ? THEN seed ELSE NULL END WHERE id = ?');
  db.exec('BEGIN');
  try {
    list.forEach((item) => update.run(item.category, item.category, Number(item.id)));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const rows = db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  res.json(rows.map(serializeRegistration));
});
