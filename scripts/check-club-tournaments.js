// Checks of the tournaments of communities and clubs (phase 2): src/clubTournaments.js, the routes of src/routes/communities.js, and the per-tournament
// routes of src/routes/seasons.js, brackets.js and matches.js that accept the admin of the owning club.
// Run: node scripts/check-club-tournaments.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubtourn-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = adminCookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };

// a real player who is logged in with the phone number; returns { id, name, cookie }
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09070${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let seq = 0;
const uniq = (p = 'Klub') => `${p} ${(seq += 1)} ${Math.random().toString(36).slice(2, 6)}`;
const fresh = (prefix) => makePlayer(uniq(prefix));
// a public club run by `owner` (a club must be approved by the super admin before it is public); created a few days back so the 3-a-day limit never gets in the way
async function makeClub(owner, over = {}) {
  const org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: uniq(), ...over } })).json;
  assert.ok(org && org.id, JSON.stringify(org));
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: true } })).status, 200);
  withDb((f) => f.prepare("UPDATE organisations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE id = ?").run(org.id));
  return org;
}
const future = (days = 30) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const tournamentBody = (over = {}) => ({ name: uniq('Turnaj'), playType: 'SINGLES', startDate: future(10), endDate: future(11), venue: 'TK Slovan', ...over });
const createTournament = (org, who, over) => call('POST', `/api/communities/${org.id}/tournaments`, { cookie: who ? who.cookie : '', body: tournamentBody(over) });
// a club with its owner and a tournament of it
async function clubWithTournament(over) {
  const owner = await fresh('Organizator');
  const org = await makeClub(owner);
  const made = await createTournament(org, owner, over);
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  return { owner, org, tournament: made.json };
}

// ---------- Task 1: create and list the tournaments of a club ----------

test('a club admin creates a tournament: kind TOURNAMENT, owned by the club, in the city of the club, a clean slug', async () => {
  const owner = await fresh('Organizator');
  const org = await makeClub(owner);
  const r = await createTournament(org, owner, { name: 'Jesenný turnaj TK Slovan', info: '<p>Vklad 10 €</p><script>alert(1)</script>', entryFee: '10 €' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.deepStrictEqual([r.json.kind, r.json.organisationId, r.json.slug, r.json.playType, r.json.venue, r.json.entryFee], ['TOURNAMENT', org.id, 'jesenny-turnaj-tk-slovan', 'SINGLES', 'TK Slovan', '10 €']);
  assert.ok(!/script/i.test(r.json.info), 'the description is cleaned like in the Backend: ' + r.json.info);
  const row = withDb((f) => f.prepare('SELECT s.league_id AS sl, o.league_id AS ol, s.organisation_id AS oid FROM seasons s JOIN organisations o ON o.id = s.organisation_id WHERE s.id = ?').get(r.json.id));
  assert.deepStrictEqual([row.sl, row.oid], [row.ol, org.id]);
  assert.strictEqual((await createTournament(org, owner, { playType: 'DOUBLES' })).json.playType, 'DOUBLES');
});

test('only an admin of the club creates: a plain member 403, a visitor 401, an admin of another club 403', async () => {
  const owner = await fresh('Organizator');
  const member = await fresh('Clen');
  const otherOwner = await fresh('Cudzi');
  const org = await makeClub(owner);
  await makeClub(otherOwner);
  await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie });
  assert.strictEqual((await createTournament(org, member)).status, 403);
  assert.strictEqual((await createTournament(org, null)).status, 401);
  assert.strictEqual((await createTournament(org, otherOwner)).status, 403);
});

test('a hidden club and a club that is not approved cannot have tournaments (404)', async () => {
  const owner = await fresh('Organizator');
  const org = await makeClub(owner);
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual((await createTournament(org, owner)).status, 404, 'hidden');
  const waiting = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: uniq('Cakajuci') } })).json;
  assert.strictEqual(waiting.approved, false);
  assert.strictEqual((await createTournament(waiting, owner)).status, 404, 'a club the super admin has not approved yet');
  const community = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: uniq('Komunita') } })).json;
  assert.strictEqual((await createTournament(community, owner)).status, 201, 'a community is public at once and may have tournaments');
});

test('a club has at most 5 open tournaments (an ended one does not count); the limit can be changed per club', async () => {
  const owner = await fresh('Organizator');
  const org = await makeClub(owner);
  const ids = [];
  for (let i = 0; i < 5; i += 1) { const r = await createTournament(org, owner); assert.strictEqual(r.status, 201, `tournament ${i + 1}: ${JSON.stringify(r.json)}`); ids.push(r.json.id); }
  const sixth = await createTournament(org, owner);
  assert.strictEqual(sixth.status, 409, JSON.stringify(sixth.json));
  withDb((f) => f.prepare("UPDATE seasons SET end_date = '2020-01-02', start_date = '2020-01-01' WHERE id = ?").run(ids[0]));
  assert.strictEqual((await createTournament(org, owner)).status, 201, 'one has ended, so there is room for another');
  withDb((f) => f.prepare('UPDATE organisations SET max_open_tournaments = 5 WHERE id = ?').run(org.id));
  assert.strictEqual((await createTournament(org, owner)).status, 409, 'five open again');
  const small = await makeClub(owner);
  withDb((f) => f.prepare('UPDATE organisations SET max_open_tournaments = 1 WHERE id = ?').run(small.id));
  assert.strictEqual((await createTournament(small, owner)).status, 201);
  assert.strictEqual((await createTournament(small, owner)).status, 409, 'the limit of this club is 1');
});

test('what is written is checked: dates, name, venue, playType; a name of only symbols still gets a clean slug', async () => {
  const owner = await fresh('Organizator');
  const org = await makeClub(owner);
  const bad = async (over) => assert.strictEqual((await createTournament(org, owner, over)).status, 400, JSON.stringify(over).slice(0, 80));
  await bad({ startDate: future(10), endDate: future(5) });
  await bad({ startDate: 'zajtra' });
  await bad({ name: '   ' });
  await bad({ name: 'x'.repeat(121) });
  await bad({ venue: 'x'.repeat(201) });
  await bad({ playType: 'TRIPLES' });
  const odd = await createTournament(org, owner, { name: '!!!' });
  assert.strictEqual(odd.status, 201);
  assert.ok(/^[a-z0-9-]+$/.test(odd.json.slug), odd.json.slug);
  const twin = await createTournament(org, owner, { name: '!!!' });
  assert.notStrictEqual(twin.json.slug, odd.json.slug, 'a twin gets another address');
});

test('the tournaments of a club are listed for everybody, newest first; a hidden club answers 404', async () => {
  const { owner, org, tournament } = await clubWithTournament({ name: 'Prvý turnaj', startDate: future(10), endDate: future(11) });
  const second = (await createTournament(org, owner, { name: 'Druhý turnaj', startDate: future(40), endDate: future(41) })).json;
  const list = await call('GET', `/api/communities/${org.id}/tournaments`, { cookie: '' });
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.json.items.map((t) => t.id), [second.id, tournament.id]);
  assert.deepStrictEqual(list.json.items[0].organisation, { id: org.id, slug: org.slug, name: org.name });
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/tournaments`, { cookie: '' })).status, 404);
  assert.strictEqual((await call('GET', '/api/communities/999999/tournaments', { cookie: '' })).status, 404);
});

// ---------- Task 2: the organiser runs his tournament (the routes of seasons.js) ----------

let regCounter = 0;
// a public registration (any visitor may register) so the tournament has a registration to manage
async function register(seasonId) {
  regCounter += 1;
  const r = await call('POST', `/api/seasons/${seasonId}/registrations`, { cookie: '', headers: { 'X-Forwarded-For': `10.7.${Math.floor(regCounter / 250)}.${regCounter % 250}` }, body: { category: 'ELITE', name: `Hrac Prihlaseny${regCounter}x Test`, email: `reg${regCounter}@example.com`, phone: `090512${String(regCounter).padStart(4, '0')}`, confirmNew: true } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  const list = await call('GET', `/api/seasons/${seasonId}/registrations`);
  return list.json[list.json.length - 1].id;
}
// everything the routes of the plan need for one tournament: its id, a group of it and a registration of it
async function world(seasonId) {
  const group = await call('POST', `/api/seasons/${seasonId}/groups`, { body: { name: 'Skupina ' + uniq('S'), category: 'NOVICE' } });
  assert.ok([200, 201].includes(group.status), JSON.stringify(group.json));
  const reg = await register(seasonId);
  const groupId = withDb((f) => f.prepare('SELECT id FROM season_groups WHERE season_id = ? ORDER BY id DESC LIMIT 1').get(seasonId).id);
  return { S: seasonId, G: groupId, R: reg };
}
// the routes an organiser of the owning club may use on a tournament, as [method, path, body] with S (season), G (group), R (registration)
const MANAGER_ROUTES = (w) => [
  ['GET', `/api/seasons/${w.S}/registrations.csv`], ['POST', `/api/seasons/${w.S}/registrations/remind`, {}], ['GET', `/api/seasons/${w.S}/registrations`],
  ['POST', `/api/seasons/${w.S}/registrations/categories`, {}], ['GET', `/api/seasons/${w.S}/draw`], ['POST', `/api/seasons/${w.S}/seeds`, {}],
  ['POST', `/api/seasons/${w.S}/draw`, {}], ['GET', `/api/seasons/${w.S}/draw/groups-suggestion`], ['POST', `/api/seasons/${w.S}/draw/bracket`, {}],
  ['GET', `/api/seasons/${w.S}/doubles`], ['POST', `/api/seasons/${w.S}/doubles/pairs`, {}], ['DELETE', `/api/seasons/${w.S}/doubles/pairs/999999`],
  ['DELETE', `/api/seasons/${w.S}/draw/ELITE`], ['PATCH', `/api/seasons/${w.S}/schedule/settings`, {}], ['POST', `/api/seasons/${w.S}/schedule/auto`, {}],
  ['PUT', `/api/seasons/${w.S}/schedule/matches/nonexistenttoken`, {}], ['POST', `/api/seasons/${w.S}/registrations/admin`, {}], ['PATCH', `/api/seasons/${w.S}`, {}],
  ['POST', `/api/seasons/${w.S}/groups`, { name: 'Skupina Z' + Math.random().toString(36).slice(2, 5), category: 'ELITE' }],
  ['GET', `/api/seasons/${w.S}/schedule-preview`], ['POST', `/api/seasons/${w.S}/schedule`, {}], ['DELETE', `/api/seasons/${w.S}/hero?kind=desktop`], ['DELETE', `/api/seasons/${w.S}/logo`],
  ['PATCH', `/api/seasons/groups/${w.G}`, {}], ['POST', `/api/seasons/groups/${w.G}/members`, {}], ['PATCH', `/api/seasons/groups/${w.G}/members/999999`, {}],
  ['DELETE', `/api/seasons/groups/${w.G}/members/999999`], ['POST', `/api/seasons/groups/${w.G}/members/999999/withdraw`, {}], ['POST', `/api/seasons/groups/${w.G}/members/import`, {}],
  ['PATCH', `/api/seasons/registrations/${w.R}`, {}],
];
const asWho = (who) => (who ? who.cookie : '');
const refused = (r) => r.status === 401 || r.status === 403;
async function walk(routes, cookie) {
  const out = [];
  for (const [method, url, body] of routes) out.push({ method, url, status: (await call(method, url, { cookie, body })).status });
  return out;
}

test('the organiser of the club runs his tournament: every route of the list answers him (it is not refused)', async () => {
  const { owner, tournament } = await clubWithTournament();
  const w = await world(tournament.id);
  const results = await walk(MANAGER_ROUTES(w), owner.cookie);
  const refusedOnes = results.filter((r) => refused(r));
  assert.deepStrictEqual(refusedOnes, [], 'refused: ' + JSON.stringify(refusedOnes));
  assert.ok(results.every((r) => r.status < 500), 'no crash: ' + JSON.stringify(results.filter((r) => r.status >= 500)));
  const list = await call('GET', `/api/seasons/${w.S}/registrations`, { cookie: owner.cookie });
  assert.strictEqual(list.status, 200);
  assert.ok(list.json[0].phone && list.json[0].email, 'the organiser sees the contact details of his registrations');
  assert.strictEqual((await call('GET', `/api/seasons/${w.S}/registrations`, { cookie: '' })).status, 401, 'a visitor does not');
});

test('nobody else: an admin of another club, a plain member and a visitor are refused on every route; the admin of the site is not', async () => {
  const { owner, org, tournament } = await clubWithTournament();
  const w = await world(tournament.id);
  const otherOwner = await fresh('Cudzi');
  await makeClub(otherOwner);
  const member = await fresh('Clen');
  await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie });
  void owner;
  for (const [label, cookie] of [['organiser of another club', otherOwner.cookie], ['plain member', member.cookie], ['visitor', '']]) {
    const results = await walk(MANAGER_ROUTES(w), cookie);
    const open = results.filter((r) => !refused(r));
    assert.deepStrictEqual(open, [], `${label}: not refused: ${JSON.stringify(open)}`);
  }
  const admin = await walk(MANAGER_ROUTES(w), adminCookie);
  assert.deepStrictEqual(admin.filter((r) => refused(r)), [], 'the site admin is as before');
});

test('the ids of other things do not open anything: the tournament, group and registration of another club, a league season and an admin tournament', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const adminTournament = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT' } })).json;
  for (const target of [await world(b.tournament.id), await world(league.id), await world(adminTournament.id)]) {
    const results = await walk(MANAGER_ROUTES(target), a.owner.cookie);
    const open = results.filter((r) => !refused(r));
    assert.deepStrictEqual(open, [], `organiser A on season ${target.S}: ${JSON.stringify(open)}`);
  }
  // an own season id mixed with the group / registration / token / pair of another tournament
  const mine = await world(a.tournament.id);
  const theirs = await world(b.tournament.id);
  const mixed = [['PATCH', `/api/seasons/groups/${theirs.G}`, {}], ['PATCH', `/api/seasons/registrations/${theirs.R}`, {}], ['DELETE', `/api/seasons/registrations/${theirs.R}`], ['DELETE', `/api/seasons/groups/${theirs.G}`], ['POST', `/api/seasons/groups/${theirs.G}/members/import`, {}]];
  const open = (await walk(mixed, a.owner.cookie)).filter((r) => !refused(r));
  assert.deepStrictEqual(open, [], 'ids of club B with the cookie of club A: ' + JSON.stringify(open));
  void mine;
});

test('the organiser cannot move his tournament out of the club, change its kind or city (PATCH ignores them)', async () => {
  const { owner, org, tournament } = await clubWithTournament();
  const other = await makeClub(await fresh('Druhy'));
  const r = await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: owner.cookie, body: { name: 'Nový názov', kind: 'LEAGUE', organisationId: other.id, leagueId: 999, venue: 'Nové miesto' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual([r.json.name, r.json.venue, r.json.kind, r.json.organisationId], ['Nový názov', 'Nové miesto', 'TOURNAMENT', org.id]);
  const row = withDb((f) => f.prepare('SELECT kind, organisation_id AS o, league_id AS l FROM seasons WHERE id = ?').get(tournament.id));
  assert.deepStrictEqual([row.kind, row.o, row.l], ['TOURNAMENT', org.id, org.leagueId]);
});

test('deleting: the organiser deletes a tournament without finished matches (its matches go with it), not one with a finished match; an admin may delete either', async () => {
  const { owner, org } = await clubWithTournament();
  const empty = (await createTournament(org, owner)).json;
  assert.strictEqual((await call('DELETE', `/api/seasons/${empty.id}`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual(withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM seasons WHERE id = ?').get(empty.id).n), 0);
  const played = (await createTournament(org, owner)).json;
  const [p1, p2] = [await fresh('Hrac'), await fresh('Hrac')];
  const planned = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Name: p1.name, player2Name: p2.name, seasonId: played.id, location: 'Kurt 1' } });
  assert.strictEqual(planned.status, 201, JSON.stringify(planned.json));
  const done = await call('POST', `/api/matches/${planned.json.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const refusal = await call('DELETE', `/api/seasons/${played.id}`, { cookie: owner.cookie });
  assert.strictEqual(refusal.status, 409, JSON.stringify(refusal.json));
  assert.strictEqual((await call('DELETE', `/api/seasons/${played.id}`)).status, 200, 'the admin of the site may');
});

test('the rights follow the club at once: a demoted admin, a hidden club and a withdrawn approval are refused on the next request', async () => {
  const { owner, org, tournament } = await clubWithTournament();
  const second = await fresh('Druhy');
  await call('POST', `/api/communities/${org.id}/join`, { cookie: second.cookie });
  await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'ADMIN' } });
  const route = ['GET', `/api/seasons/${tournament.id}/registrations`];
  const ok = async (who) => !refused((await walk([route], who.cookie))[0]);
  assert.strictEqual(await ok(second), true, 'a promoted admin may');
  await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'MEMBER' } });
  assert.strictEqual(await ok(second), false, 'demoted: no');
  assert.strictEqual(await ok(owner), true);
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual(await ok(owner), false, 'a hidden club');
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: false } });
  assert.strictEqual(await ok(owner), true);
  await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: false } });
  assert.strictEqual(await ok(owner), false, 'approval withdrawn');
});

// ---------- Task 3: brackets and matches of a club tournament ----------

// four players and a bracket of a tournament (made by whoever `cookie` is)
async function makeBracket(cookie, seasonId, over = {}) {
  const ids = [];
  for (const n of ['Alfa', 'Beta', 'Gama', 'Delta']) ids.push((await call('POST', '/api/players', { body: { name: uniq(n) } })).json.id);
  const made = await call('POST', '/api/brackets', { cookie, body: { name: uniq('Pavúk'), format: 'BO3', seasonId, ...(seasonId ? { category: 'ELITE' } : {}), autoCreateMatches: false, entries: ids.map((id, i) => ({ playerId: id, seed: i + 1 })), ...over } });
  return { made, ids };
}
const matchBody = (seasonId, p1, p2) => ({ category: 'ELITE', format: 'BO3', player1Name: p1.name, player2Name: p2.name, seasonId, location: 'Kurt 1', scheduledAt: new Date().toISOString() });

test('the organiser draws a bracket for his tournament and enters a result in it: the winner moves on, a visitor sees it', async () => {
  const { owner, tournament } = await clubWithTournament();
  const { made } = await makeBracket(owner.cookie, tournament.id);
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const bracket = made.json;
  const node = bracket.nodes.find((n) => n.round === 1 && n.player1 && n.player2);
  const done = await call('PATCH', `/api/brackets/${bracket.id}/nodes/${node.id}/result`, { cookie: owner.cookie, body: { winnerId: node.player1.id, score: '6-2, 6-4' } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const seen = (await call('GET', `/api/brackets/${bracket.id}`, { cookie: '' })).json;
  const final = seen.nodes.find((n) => n.round === 2);
  assert.ok([final.player1, final.player2].some((p) => p && p.id === node.player1.id), 'the winner is in the final');
  assert.strictEqual((await call('DELETE', `/api/brackets/${bracket.id}/nodes/${node.id}/result`, { cookie: owner.cookie })).status, 200, 'and he can take it back');
  assert.strictEqual((await call('DELETE', `/api/brackets/${bracket.id}`, { cookie: owner.cookie })).status, 200, 'or remove the bracket');
});

test('the same bracket calls on another club\'s tournament, a league season, a plain bracket and with a plain member are refused', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const member = await fresh('Clen');
  await call('POST', `/api/communities/${a.org.id}/join`, { cookie: member.cookie });
  for (const target of [b.tournament.id, league.id, null]) {
    const refusedMade = (await makeBracket(a.owner.cookie, target)).made;
    assert.ok(refused(refusedMade), `organiser A creating a bracket for season ${target}: ${refusedMade.status}`);
  }
  assert.ok(refused((await makeBracket(member.cookie, a.tournament.id)).made), 'a plain member');
  assert.ok(refused((await makeBracket('', a.tournament.id)).made), 'a visitor');
  // brackets that exist: of club B, of the league and a plain one; touched with the cookie of A
  const theirs = (await makeBracket(adminCookie, b.tournament.id)).made.json;
  const leagueBracket = (await makeBracket(adminCookie, league.id)).made.json;
  const plain = (await makeBracket(adminCookie, null)).made.json;
  for (const br of [theirs, leagueBracket, plain]) {
    const node = br.nodes.find((n) => n.round === 1 && n.player1 && n.player2);
    const calls = [['PATCH', `/api/brackets/${br.id}`, { name: 'Hack' }], ['DELETE', `/api/brackets/${br.id}`], ['POST', `/api/brackets/${br.id}/consolation`, {}],
      ['PATCH', `/api/brackets/${br.id}/nodes/${node.id}/result`, { winnerId: node.player1.id, score: '6-0' }], ['DELETE', `/api/brackets/${br.id}/nodes/${node.id}/result`], ['PATCH', `/api/brackets/${br.id}/slots/${node.id}`, {}]];
    const open = (await walk(calls, a.owner.cookie)).filter((r) => !refused(r));
    assert.deepStrictEqual(open, [], `bracket ${br.id}: ${JSON.stringify(open)}`);
  }
  assert.strictEqual((await call('GET', '/api/brackets', { cookie: a.owner.cookie })).status, 401, 'the admin list of all brackets stays closed');
});

test('the organiser creates a match inside his tournament, enters one result by hand and scores one live; not in another tournament', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const [p1, p2, p3, p4] = [await fresh('Hrac'), await fresh('Hrac'), await fresh('Hrac'), await fresh('Hrac')];
  const m1 = await call('POST', '/api/matches', { cookie: a.owner.cookie, body: matchBody(a.tournament.id, p1, p2) });
  assert.strictEqual(m1.status, 201, JSON.stringify(m1.json));
  assert.strictEqual(m1.json.season && m1.json.season.id, a.tournament.id);
  const manual = await call('POST', `/api/matches/${m1.json.token}/manual-result`, { cookie: a.owner.cookie, body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(manual.status, 200, JSON.stringify(manual.json));
  const m2 = (await call('POST', '/api/matches', { cookie: a.owner.cookie, body: matchBody(a.tournament.id, p3, p4) })).json;
  const live = async (action, body = {}) => call('POST', `/api/matches/${m2.token}/${action}`, { cookie: a.owner.cookie, body });
  const started = await live('start');
  assert.strictEqual(started.status, 200, 'start: ' + JSON.stringify(started.json));
  for (let i = 0; i < 4; i += 1) assert.strictEqual((await live('score', { player: 1, delta: 1 })).status, 200, 'a point');
  // a match of the other tournament and a plain match: refused
  const theirs = (await call('POST', '/api/matches', { cookie: b.owner.cookie, body: matchBody(b.tournament.id, p1, p2) })).json;
  const plain = (await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: p1.name, player2Name: p2.name, location: 'Kurt 9' } })).json;
  for (const m of [theirs, plain]) {
    const calls = [['POST', `/api/matches/${m.token}/manual-result`, { sets: [{ p1: 6, p2: 0 }, { p1: 6, p2: 0 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() }], ['POST', `/api/matches/${m.token}/start`, {}], ['DELETE', `/api/matches/${m.token}`], ['PATCH', `/api/matches/${m.token}`, { location: 'Hack' }]];
    const results = await walk(calls, a.owner.cookie);
    assert.ok(results.every((r) => r.status === 403 || r.status === 401), `organiser A on a match of another tournament or a plain match: ${JSON.stringify(results)}`);
  }
});

test('placing a match in a season is for the manager of that season only: another club\'s, a league season and the move of a match between seasons are refused', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const [p1, p2] = [await fresh('Hrac'), await fresh('Hrac')];
  for (const target of [b.tournament.id, league.id]) {
    const r = await call('POST', '/api/matches', { cookie: a.owner.cookie, body: matchBody(target, p1, p2) });
    assert.strictEqual(r.status, 403, `season ${target}: ${JSON.stringify(r.json)}`);
  }
  const mine = (await call('POST', '/api/matches', { cookie: a.owner.cookie, body: matchBody(a.tournament.id, p1, p2) })).json;
  assert.strictEqual((await call('PATCH', `/api/matches/${mine.token}/season`, { cookie: a.owner.cookie, body: { seasonId: b.tournament.id } })).status, 401, 'moving a match between seasons stays an admin job');
  const member = await fresh('Clen');
  await call('POST', `/api/communities/${a.org.id}/join`, { cookie: member.cookie });
  assert.strictEqual((await call('POST', '/api/matches', { cookie: member.cookie, body: matchBody(a.tournament.id, p1, p2) })).status, 403, 'a plain member');
});

// ---------- Task 4: the rating gate and its switch ----------

// a finished ELITE match between two fresh players inside a season; returns { token, id, p1, p2 }
async function finishedMatch(seasonId) {
  const [p1, p2] = [await fresh('Hrac'), await fresh('Hrac')];
  const made = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Name: p1.name, player2Name: p2.name, seasonId, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const id = withDb((f) => f.prepare('SELECT id FROM matches WHERE share_token = ?').get(made.json.token).id);
  return { token: made.json.token, id, p1, p2 };
}
// what a finished match did to the ratings: the rows it left in CourtIQ, the ranking tables and the badges of its winner
const effects = (m) => withDb((f) => ({
  courtiq: f.prepare('SELECT COUNT(*) AS n FROM courtiq_rating_history WHERE match_id = ?').get(m.id).n,
  ranking: f.prepare('SELECT COUNT(*) AS n FROM ranking_awards WHERE match_id = ?').get(m.id).n,
  badges: f.prepare('SELECT COUNT(*) AS n FROM player_badges WHERE player_id = ?').get(m.p1.id).n,
}));
const rating = (org, who, body) => call('PATCH', `/api/communities/${org.id}/rating`, { cookie: who, body });

test('a finished match of a club tournament moves no rating by default (CourtIQ, ranking points, badges); the same match in an admin tournament does', async () => {
  const { org, tournament } = await clubWithTournament();
  const club = await finishedMatch(tournament.id);
  assert.deepStrictEqual(effects(club), { courtiq: 0, ranking: 0, badges: 0 }, 'a club match counts for nothing');
  const adminTournament = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT' } })).json;
  const control = await finishedMatch(adminTournament.id);
  const e = effects(control);
  assert.ok(e.courtiq >= 2 && e.ranking >= 2 && e.badges >= 1, 'the control match counts: ' + JSON.stringify(e));
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const leagueMatch = await finishedMatch(league.id);
  assert.ok(effects(leagueMatch).courtiq >= 2, 'a league match is unchanged');
  void org;
});

test('only the super admin switches a club to "counts for rating" and sets its limit; the values are checked', async () => {
  const { owner, org } = await clubWithTournament();
  assert.strictEqual((await rating(org, '', { countsForRating: true })).status, 401);
  assert.strictEqual((await rating(org, owner.cookie, { countsForRating: true })).status, 401, 'the admin of the club cannot');
  assert.strictEqual((await call('POST', '/api/city-admins', { body: { name: 'Mesto Admin', email: 'rating@example.com', leagueId: 1, password: 'long-enough-1' } })).status, 201);
  const city = (await call('POST', '/api/admin/login', { cookie: '', body: { email: 'rating@example.com', password: 'long-enough-1' } }));
  assert.strictEqual((await rating(org, cookieOf(city), { countsForRating: true })).status, 403, 'a city admin cannot');
  assert.strictEqual((await rating(org, adminCookie, { countsForRating: 'yes' })).status, 400);
  assert.strictEqual((await rating(org, adminCookie, { maxOpenTournaments: 0 })).status, 400);
  assert.strictEqual((await rating(org, adminCookie, { maxOpenTournaments: 51 })).status, 400);
  assert.strictEqual((await rating(org, adminCookie, {})).status, 400, 'nothing to change');
  assert.strictEqual((await rating({ id: 999999 }, adminCookie, { countsForRating: true })).status, 404);
  const ok = await rating(org, adminCookie, { countsForRating: true, maxOpenTournaments: 2 });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.deepStrictEqual([ok.json.countsForRating, ok.json.maxOpenTournaments], [true, 2]);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.countsForRating, true);
});

test('switching it on makes the results already there count (the rebuild), switching it off takes them out; a new result follows the switch', async () => {
  const { org, tournament } = await clubWithTournament();
  const before = await finishedMatch(tournament.id);
  assert.deepStrictEqual(effects(before), { courtiq: 0, ranking: 0, badges: 0 });
  assert.strictEqual((await rating(org, adminCookie, { countsForRating: true })).status, 200);
  const on = effects(before);
  assert.ok(on.courtiq >= 2 && on.ranking >= 2 && on.badges >= 1, 'now it counts: ' + JSON.stringify(on));
  const later = await finishedMatch(tournament.id);
  assert.ok(effects(later).courtiq >= 2, 'a new result counts while it is on');
  assert.strictEqual((await rating(org, adminCookie, { countsForRating: false })).status, 200);
  const off = effects(before);
  assert.deepStrictEqual([off.courtiq, off.ranking], [0, 0], 'switched off: out of CourtIQ and the ranking tables');
  assert.strictEqual(effects(later).courtiq, 0);
  // the normal rebuild (the admin\'s "Run CourtIQ backfill") never pulls a club match in while it is off
  assert.strictEqual((await call('POST', '/api/admin/courtiq/backfill')).status, 200);
  assert.strictEqual(effects(before).courtiq, 0, 'the rebuild leaves it out');
  assert.strictEqual(effects(await (async () => { const c = await finishedMatch(tournament.id); return c; })()).courtiq, 0, 'and the new one does not count either');
});

test('a doubles match of a club tournament stays out of the doubles ranking, until the club counts for rating', async () => {
  const { org, tournament } = await clubWithTournament();
  const four = [await fresh('Par'), await fresh('Par'), await fresh('Par'), await fresh('Par')];
  const made = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', doubles: true, location: 'Kurt 1', player1Name: four[0].name, player1bName: four[1].name, player2Name: four[2].name, player2bName: four[3].name } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const pairNames = async () => (await call('GET', '/api/doubles/pairs', { cookie: '' })).json.rows.map((r) => r.name);
  const mine = `${four[0].name} / ${four[1].name}`;
  assert.ok((await pairNames()).includes(mine), 'a plain doubles match counts');
  withDb((f) => f.prepare('UPDATE matches SET season_id = ? WHERE share_token = ?').run(tournament.id, made.json.token));
  assert.ok(!(await pairNames()).includes(mine), 'inside a club tournament it does not');
  assert.strictEqual((await rating(org, adminCookie, { countsForRating: true })).status, 200);
  assert.ok((await pairNames()).includes(mine), 'it does once the club counts');
});

// ---------- Task 5: separation from the league, the Harmonogram, the public page ----------

const publicSeasons = async () => (await call('GET', '/api/seasons', { cookie: '' })).json;
const scheduleItems = async () => (await call('GET', '/api/schedule', { cookie: '' })).json;

test('a club tournament is not in the league: not in the public season list, not in the numbers of the city (seasons, registration, tournaments played); an admin tournament and a league season still are', async () => {
  // what the card of the city says about seasons and tournaments (players are left out: the organiser of a new club is a new player)
  const card = async () => {
    const city = (await call('GET', '/api/leagues', { cookie: '' })).json.find((l) => l.id === 1);
    return JSON.stringify({ seasons: city.seasons, registrationOpen: city.registrationOpen, registrationSeason: city.registrationSeason, currentSeason: city.currentSeason, tournamentsPlayed: city.tournamentsPlayed, lastTournament: city.lastTournament, categories: city.categories });
  };
  const adminTournament = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT', startDate: future(5), endDate: future(6) } })).json;
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE', startDate: future(5), endDate: future(60) } })).json;
  const before = await card();
  // a club tournament with registration open, and an ended one: neither may show up in the card
  const { tournament } = await clubWithTournament({ startDate: future(1), endDate: future(2) });
  await call('PATCH', `/api/seasons/${tournament.id}`, { body: { registrationOpen: true } });
  const past = await clubWithTournament({ startDate: future(-30), endDate: future(-29) });
  void past;
  assert.strictEqual(await card(), before, 'the club tournaments change nothing in the card of the city');
  const ids = (await publicSeasons()).map((x) => x.id);
  assert.ok(!ids.includes(tournament.id), 'the club tournament is not in the list of the league');
  assert.ok(ids.includes(adminTournament.id) && ids.includes(league.id), 'the others are');
});

test('the Harmonogram lists a club tournament with its club; a hidden club, or one whose approval is withdrawn, is not in it', async () => {
  const { org, tournament } = await clubWithTournament({ startDate: future(20), endDate: future(21) });
  const mine = (await scheduleItems()).find((e) => e.seasonId === tournament.id);
  assert.ok(mine, 'listed');
  assert.deepStrictEqual([mine.type, mine.organisation && mine.organisation.slug, mine.organisation && mine.organisation.name], ['TOURNAMENT', org.slug, org.name]);
  const adminTournament = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT', startDate: future(20), endDate: future(21) } })).json;
  assert.strictEqual((await scheduleItems()).find((e) => e.seasonId === adminTournament.id).organisation || null, null, 'the others carry no club');
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.ok(!(await scheduleItems()).some((e) => e.seasonId === tournament.id), 'hidden club');
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: false } });
  assert.ok((await scheduleItems()).some((e) => e.seasonId === tournament.id));
  await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: false } });
  assert.ok(!(await scheduleItems()).some((e) => e.seasonId === tournament.id), 'approval withdrawn');
});

test('the schedule card of a city on the national page leaves the tournaments of clubs out', async () => {
  const { tournament } = await clubWithTournament({ startDate: future(3), endDate: future(4) });
  const admin = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT', startDate: future(3), endDate: future(4) } })).json;
  const card = (await call('GET', '/api/leagues/bratislava/schedule', { cookie: '' })).json;
  assert.ok(card.items.some((e) => e.seasonId === admin.id), 'an admin tournament is on the card');
  assert.ok(!card.items.some((e) => e.seasonId === tournament.id), 'a club tournament is not');
});

test('the public page of a club tournament answers with its club; 404 while the club is hidden or not approved, and nobody can register for it then', async () => {
  const { org, tournament } = await clubWithTournament();
  const page = await call('GET', `/api/seasons/by-slug/${tournament.slug}`, { cookie: '' });
  assert.strictEqual(page.status, 200, JSON.stringify(page.json));
  assert.deepStrictEqual(page.json.organisation, { id: org.id, slug: org.slug, name: org.name });
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${league.slug}`, { cookie: '' })).json.organisation, null);
  const register = () => call('POST', `/api/seasons/${tournament.id}/registrations`, { cookie: '', headers: { 'X-Forwarded-For': `10.9.0.${Math.floor(Math.random() * 200)}` }, body: { name: 'Hrac Verejny Test', email: 'verejny@example.com', phone: '0905999888', confirmNew: true } });
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${tournament.slug}`, { cookie: '' })).status, 404, 'hidden');
  assert.strictEqual((await register()).status, 404, 'no registration for a hidden club');
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: false } });
  await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: false } });
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${tournament.slug}`, { cookie: '' })).status, 404, 'not approved');
  await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: true } });
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${tournament.slug}`, { cookie: '' })).status, 200);
  assert.strictEqual((await register()).status, 201, 'and registration works again');
});

test('the sitemap lists a club tournament while its club is public, not when it is hidden', async () => {
  const { org, tournament } = await clubWithTournament();
  const inMap = async () => (await (await fetch(`${base}/sitemap.xml`)).text()).includes(`/tournament/${tournament.slug}`);
  assert.strictEqual(await inMap(), true);
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual(await inMap(), false);
});

// ---------- Task 6 (server side of the manage page): the one-season read and the canManage flag ----------

test('GET /api/seasons/:id answers the manager of that season (the organiser of its club, an admin) with the season and its club, nobody else', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const own = await call('GET', `/api/seasons/${a.tournament.id}`, { cookie: a.owner.cookie });
  assert.strictEqual(own.status, 200, JSON.stringify(own.json));
  assert.deepStrictEqual([own.json.id, own.json.organisation.id, Array.isArray(own.json.groups), typeof own.json.matchCount], [a.tournament.id, a.org.id, true, 'number']);
  assert.strictEqual((await call('GET', `/api/seasons/${a.tournament.id}`)).status, 200, 'an admin');
  const member = await fresh('Clen');
  await call('POST', `/api/communities/${a.org.id}/join`, { cookie: member.cookie });
  for (const [who, id] of [[a.owner.cookie, b.tournament.id], [a.owner.cookie, league.id], [member.cookie, a.tournament.id], ['', a.tournament.id]]) {
    assert.ok(refused(await call('GET', `/api/seasons/${id}`, { cookie: who })), `season ${id} for ${who.slice(0, 12) || 'a visitor'}`);
  }
});

test('the public JSON of a tournament and of a bracket tells the viewer whether he manages it (canManage): the organiser and an admin yes, others no', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const bracket = (await makeBracket(a.owner.cookie, a.tournament.id)).made.json;
  const flags = async (who) => [
    (await call('GET', `/api/seasons/by-slug/${a.tournament.slug}`, { cookie: who })).json.canManage,
    (await call('GET', `/api/brackets/${bracket.id}`, { cookie: who })).json.canManage,
  ];
  assert.deepStrictEqual(await flags(a.owner.cookie), [true, true], 'organiser of the club');
  assert.deepStrictEqual(await flags(adminCookie), [true, true], 'admin');
  assert.deepStrictEqual(await flags(b.owner.cookie), [false, false], 'organiser of another club');
  assert.deepStrictEqual(await flags(''), [false, false], 'visitor');
});

// ---------- Final review: findings of the security review ----------

test('the organiser of a club cannot read the contact data of the players he adds: the profile phone and e-mail are not copied, and typed ones are ignored; an admin still gets both', async () => {
  const a = await clubWithTournament();
  const target = await fresh('Cudzi');
  withDb((f) => f.prepare("UPDATE players SET email = 'cudzi@example.com' WHERE id = ?").run(target.id));
  const added = await call('POST', `/api/seasons/${a.tournament.id}/registrations/admin`, { cookie: a.owner.cookie, body: { playerId: target.id, category: 'ELITE', phone: '0905111222', email: 'victim@example.com' } });
  assert.strictEqual(added.status, 201, JSON.stringify(added.json));
  assert.deepStrictEqual([added.json.phone || '', added.json.email || ''], ['', ''], 'no contact data for the organiser');
  const rid = added.json.id;
  const patched = await call('PATCH', `/api/seasons/registrations/${rid}`, { cookie: a.owner.cookie, body: { phone: '0905333444', email: 'other@example.com', paid: true } });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.json));
  assert.deepStrictEqual([patched.json.phone || '', patched.json.email || '', patched.json.paid], ['', '', true], 'he cannot write contact data, but can mark it paid');
  const second = await fresh('Cudzi');
  withDb((f) => f.prepare("UPDATE players SET email = 'druhy@example.com' WHERE id = ?").run(second.id));
  const byAdmin = await call('POST', `/api/seasons/${a.tournament.id}/registrations/admin`, { body: { playerId: second.id, category: 'ELITE' } });
  assert.strictEqual(byAdmin.status, 201, JSON.stringify(byAdmin.json));
  assert.strictEqual(byAdmin.json.email, 'druhy@example.com', 'an admin of the site gets the profile e-mail as before');
});

test('the organiser cannot move his bracket into another season or out of any season, nor change its category so that it leaves; an admin can, and the organiser can still rename it', async () => {
  const a = await clubWithTournament();
  const b = await clubWithTournament();
  const league = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE' } })).json;
  const bracket = (await makeBracket(a.owner.cookie, a.tournament.id)).made.json;
  const patch = (body, cookie = a.owner.cookie) => call('PATCH', `/api/brackets/${bracket.id}`, { cookie, body });
  const seasonOf = () => withDb((f) => f.prepare('SELECT season_id FROM brackets WHERE id = ?').get(bracket.id).season_id);
  for (const body of [{ seasonId: league.id, category: 'ELITE' }, { seasonId: b.tournament.id }, { seasonId: null }, { category: 'OTHER' }]) {
    const r = await patch(body);
    assert.ok([401, 403].includes(r.status), `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.json)}`);
    assert.strictEqual(seasonOf(), a.tournament.id, `still in his tournament after ${JSON.stringify(body)}`);
  }
  assert.strictEqual((await patch({ name: uniq('Nove meno') })).status, 200, 'he can rename it');
  assert.strictEqual((await patch({ seasonId: a.tournament.id, category: 'NOVICE' })).status, 200, 'and keep it in his tournament');
  assert.strictEqual((await patch({ seasonId: league.id, category: 'ELITE' }, adminCookie)).status, 200, 'an admin may move it');
});

test('the logo of a club tournament: an organiser may set an https link or keep the current one, not a local file of the site or a protocol-relative address', async () => {
  const a = await clubWithTournament();
  const set = (logoUrl, cookie = a.owner.cookie) => call('PATCH', `/api/seasons/${a.tournament.id}`, { cookie, body: { logoUrl } });
  for (const bad of ['/season-heroes/somebody-elses.png', '//evil.example/x.png', 'http://example.com/x.png', '../x']) {
    assert.strictEqual((await set(bad)).status, 400, bad);
  }
  assert.strictEqual((await set('https://example.com/logo.png')).status, 200);
  assert.strictEqual((await set('https://example.com/logo.png')).status, 200, 'the editor sends the current value again on every save');
  assert.strictEqual((await set('/img/seasons/autumn.png', adminCookie)).status, 200, 'an admin may still use a local path');
  assert.strictEqual((await set('/img/seasons/autumn.png')).status, 200, 'and the organiser may leave it as it is');
});

test('"Hráč mesiaca" on the home page ignores the matches of a club that does not count for rating; the same wins in an admin tournament count', async () => {
  const now = new Date();
  const lastMonthDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12)).toISOString();
  const month = async () => (await call('GET', '/api/highlights/month', { cookie: '' })).json;
  // one player beats two others in a season, last month
  async function winsTwice(seasonId) {
    const [winner, x, y] = [await fresh('Vitaz'), await fresh('Sok'), await fresh('Sok')];
    for (const loser of [x, y]) {
      const made = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Name: winner.name, player2Name: loser.name, seasonId, location: 'Kurt 1', scheduledAt: lastMonthDay } });
      assert.strictEqual(made.status, 201, JSON.stringify(made.json));
      const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 0 }, { p1: 6, p2: 0 }], location: 'Kurt 1', scheduledAt: lastMonthDay } });
      assert.strictEqual(done.status, 200, JSON.stringify(done.json));
    }
    return winner;
  }
  const { tournament } = await clubWithTournament();
  const clubWinner = await winsTwice(tournament.id);
  const before = await month();
  assert.ok(!before.player || before.player.id !== clubWinner.id, 'a player who only won club matches is not the player of the month');
  const adminTournament = (await call('POST', '/api/seasons', { body: { name: uniq('Admin turnaj'), kind: 'TOURNAMENT' } })).json;
  const adminWinner = await winsTwice(adminTournament.id);
  const after = await month();
  assert.ok(after.player && after.player.id === adminWinner.id, 'the same wins in an admin tournament make a player of the month');
});

// (the tests of the next tasks go here)

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k.startsWith('SMTP_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
      if (i === 99) throw new Error(`the server did not start: ${output}`);
    }
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = cookieOf(login);
    assert.ok(adminCookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
