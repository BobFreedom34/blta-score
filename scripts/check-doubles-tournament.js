// Checks of the doubles (štvorhra) of a tournament (src/tournamentDraw.js, routes /api/seasons/:id/...): the registration form can name a partner, the
// organiser makes pairs (by hand or from those names) and seeds them, and the category DOUBLES is drawn with the SAME formats as the others: PRINCE
// (a bracket and a consolation bracket), groups, groups + bracket (the bracket made by itself), by hand. Its matches are doubles matches that count in
// no league; the court planner keeps a partner from being on two courts at once.
// Run: node scripts/check-doubles-tournament.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbltourn-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const P = {};
async function players(names) {
  for (const name of names) {
    const r = await call('POST', '/api/players', { body: { name } });
    P[name] = r.json.id;
  }
}
let counter = 0;
// a tournament with the given pairs ([[a, b], ...]) made by hand
async function tournament(label, pairNames) {
  counter += 1;
  const names = pairNames.flat();
  await players(names);
  const s = await call('POST', '/api/seasons', { body: { name: `${label} ${counter}`, kind: 'TOURNAMENT', playType: 'DOUBLES', startDate: '2099-06-01', endDate: '2099-06-02' } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  for (const [a, b] of pairNames) {
    const r = await call('POST', `/api/seasons/${s.json.id}/doubles/pairs`, { body: { player: a, partner: b } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  }
  return s.json;
}
const draw = (season, body) => call('POST', `/api/seasons/${season.id}/draw`, { body: { category: 'DOUBLES', mainFormat: 'BO3', consolationFormat: 'BO3', groupFormat: 'BO3', ...body } });
const overview = async (season) => (await call('GET', `/api/seasons/${season.id}/draw`)).json.categories.find((c) => c.category === 'DOUBLES');
const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`, { cookie: '' })).json;
const matchOf = async (token) => (await call('GET', `/api/matches/${token}`, { cookie: '' })).json;
const finish = (token, sets) => call('POST', `/api/matches/${token}/manual-result`, { body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
const WIN1 = [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }];
const teamNames = (m) => [m.team1.map((p) => p.name).join(' / '), m.team2.map((p) => p.name).join(' / ')];

let season = null;

test('a doubles tournament is entered as a pair: the partner is required, and the pair is made at once when both are known', async () => {
  await players(['Adam A', 'Boris B', 'Cyril C', 'Dušan D', 'Emil E', 'Fero F', 'Gita G', 'Hana H']);
  const s = await call('POST', '/api/seasons', { body: { name: 'Letný turnaj', kind: 'TOURNAMENT', playType: 'DOUBLES', startDate: '2099-06-01', endDate: '2099-06-02' } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  season = s.json;
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { body: { registrationOpen: true } })).status, 200);
  const reg = (name, partner, phone, email) => call('POST', `/api/seasons/${season.id}/registrations`, { cookie: '', body: { name, partner, phone, email } });
  assert.strictEqual((await reg('Adam A', 'Boris B', '0903000001', 'a@example.com')).status, 201);
  assert.strictEqual((await reg('Boris B', 'Adam A', '0903000002', 'b@example.com')).status, 201, 'the partner may name him back');
  assert.strictEqual((await reg('Cyril C', 'Dušan D', '0903000003', 'c@example.com')).status, 201);
  assert.strictEqual((await reg('Emil E', 'Neznámy Hráč', '0903000005', 'e@example.com')).status, 201, 'a partner who is not a player yet is only a note');
  const noPartner = await reg('Fero F', '', '0903000006', 'f@example.com');
  assert.strictEqual(noPartner.status, 400, 'a doubles tournament needs the partner');
  assert.strictEqual(noPartner.json.code, 'BAD_PARTNER');
  assert.strictEqual((await reg('Fero F', 'fero  f', '0903000006', 'f@example.com')).status, 400, 'not yourself');
  const list = (await call('GET', `/api/seasons/${season.id}/registrations`)).json;
  assert.strictEqual(list.find((r) => r.name === 'Adam A').partnerName, 'Boris B');
  assert.ok(!list.some((r) => r.name === 'Fero F'), 'the refused entry was not saved');
  // the pairs of the two entries that named known players exist already
  const made = (await call('GET', `/api/seasons/${season.id}/doubles`)).json;
  assert.deepStrictEqual(made.pairs.map((p) => `${p.player.name}+${p.partner.name}`).sort(), ['Adam A+Boris B', 'Cyril C+Dušan D']);
  // the public page lists the pairs, not people
  const pub = (await call('GET', `/api/seasons/by-slug/${season.slug}`, { cookie: '' })).json;
  assert.strictEqual(pub.playType, 'DOUBLES');
  assert.deepStrictEqual(pub.categories, ['DOUBLES']);
  assert.ok(pub.registrations.some((r) => r.name === 'Adam A / Boris B' && r.slug === null));
});

test('pairs: made by hand or from the registrations, one pair per player; seeded with the ordinary seeds route', async () => {
  const get = async () => (await call('GET', `/api/seasons/${season.id}/doubles`)).json;
  let o = await get();
  assert.strictEqual(o.pairs.length, 2, 'made when the entries came in');
  assert.strictEqual(o.registrationsWithPartner, 4);
  const a = await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { fromRegistrations: true } });
  assert.strictEqual(a.status, 201, JSON.stringify(a.json));
  assert.strictEqual(a.json.created, 0, 'nothing new: only the entry of Emil names a partner who is not a player');
  assert.deepStrictEqual(a.json.skipped.map((x) => x.partner), ['Neznámy Hráč'], 'an unknown partner is reported, not guessed');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Emil E', partner: 'Fero F' } })).status, 201);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: P['Gita G'], partner: P['Hana H'] } })).status, 201);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Gita G' } })).status, 409, 'Adam is in a pair');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Adam A' } })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Nikto Nikto', partner: 'Gita G' } })).status, 400);
  o = await get();
  assert.strictEqual(o.pairs.length, 4);
  // the category DOUBLES of the draw screen lists the pairs like players
  const c = await overview(season);
  assert.strictEqual(c.label, 'Štvorhra');
  assert.strictEqual(c.players, 4);
  assert.strictEqual(c.size, 4);
  // seeds: the pair of Gita and Hana first (the registration id of a pair is given by the draw screen)
  const gita = o.pairs.find((p) => p.player.name === 'Gita G');
  const seeded = await call('POST', `/api/seasons/${season.id}/seeds`, { body: { category: 'DOUBLES', seeds: [{ id: gita.registrationId, seed: 1 }] } });
  assert.strictEqual(seeded.status, 200, JSON.stringify(seeded.json));
  assert.strictEqual((await get()).pairs[0].player.name, 'Gita G');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/seeds`, { body: { category: 'DOUBLES', seeds: [{ id: gita.registrationId, seed: 9 }] } })).status, 400, 'a seed above the number of pairs');
  // a pair can be taken away before the draw, and put back
  const emil = o.pairs.find((p) => p.player.name === 'Emil E');
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}/doubles/pairs/${emil.id}`)).status, 200);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Emil E', partner: 'Fero F' } })).status, 201);
});

test('PRINCE: a main bracket and a consolation bracket of pairs; losers drop in with their partner; the doubles ranking counts it, no league table', async () => {
  const made = await draw(season, { format: 'PRINCE' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.ok(made.json.consolation, 'a consolation bracket');
  const main = await bracketOf(made.json.main);
  assert.strictEqual(main.isDoubles, true);
  assert.strictEqual(main.category, 'DOUBLES');
  assert.strictEqual(main.season.id, season.id);
  const r1 = main.nodes.filter((n) => n.round === 1);
  assert.ok(r1.every((n) => n.match && n.player1.team.length === 2 && n.player2.team.length === 2), 'a doubles match for each pairing');
  assert.ok(r1.some((n) => n.player1.name === 'Gita G / Hana H' && n.seed1 === 1), 'the seeded pair is seed 1');
  const m = await matchOf(r1[0].match.token);
  assert.strictEqual(m.isDoubles, true);
  assert.strictEqual(m.category, 'OTHER', 'a doubles match is in no league category');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/draw`, { body: { category: 'DOUBLES' } })).status, 409, 'one draw of the category');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Cyril C' } })).status, 409, 'no new pairs after the draw');
  // play round 1: the first pair of each match wins
  for (const n of r1) assert.strictEqual((await finish(n.match.token, WIN1)).status, 200);
  const cons = await bracketOf(made.json.consolation);
  assert.strictEqual(cons.isDoubles, true, 'the consolation bracket is a doubles draw too');
  const consFinal = cons.nodes.find((n) => n.match);
  assert.ok(consFinal, 'the two losers meet in the consolation bracket');
  assert.strictEqual(consFinal.player1.team.length, 2, 'a loser dropped in with its partner');
  const cm = await matchOf(consFinal.match.token);
  assert.strictEqual(cm.isDoubles, true);
  assert.strictEqual(cm.team1.length + cm.team2.length, 4);
  assert.strictEqual((await finish(consFinal.match.token, WIN1)).status, 200);
  const after = await bracketOf(made.json.main);
  const final = after.nodes.find((n) => n.round === 2);
  assert.ok(final.match);
  assert.strictEqual((await finish(final.match.token, WIN1)).status, 200);
  const rank = (await call('GET', '/api/doubles/ranking', { cookie: '' })).json.rows;
  assert.strictEqual(rank.length, 8, 'all eight players of the four pairs');
  const iq = await call('GET', `/api/courtiq/player/${P['Gita G']}`, { cookie: '' });
  assert.strictEqual(iq.json.gamesPlayed, 0);
  const standings = (await call('GET', `/api/seasons/${season.id}/standings`, { cookie: '' })).json;
  assert.strictEqual(standings.groups.length, 0, 'no group table');
  const listed = (await call('GET', `/api/seasons/${season.id}/brackets`, { cookie: '' })).json;
  assert.ok(listed.length >= 2 && listed.every((b) => b.isDoubles && b.category === 'DOUBLES'));
  // a draw that has been played cannot be deleted
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}/draw/DOUBLES`)).status, 409);
});

test('groups of pairs: round-robin doubles matches, tables of pairs (named "A / B", no profile link)', async () => {
  const s = await tournament('Skupiny párov', [['Iva I', 'Jan J'], ['Kuba K', 'Lea L'], ['Maro M', 'Nina N'], ['Olga O', 'Pavol P'], ['Rado R', 'Sona S']]);
  const made = await draw(s, { format: 'GROUPS', groupCount: 1, groupSize: 5 });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.matches, 10, 'everybody plays everybody once: 5 pairs, 10 matches');
  const tables = (await call('GET', `/api/seasons/${s.id}/standings`, { cookie: '' })).json;
  assert.strictEqual(tables.groups.length, 1);
  assert.strictEqual(tables.groups[0].category, 'DOUBLES');
  assert.strictEqual(tables.groups[0].rows.length, 5);
  assert.ok(tables.groups[0].rows.every((r) => r.player.name.includes(' / ') && r.player.slug === null));
  assert.ok(tables.groups[0].name.startsWith('Štvorhra'), 'the group is named after the category');
  // one match of the group
  const all = (await call('GET', `/api/matches?seasonId=${s.id}`, { cookie: '' })).json;
  const first = all[0];
  assert.strictEqual(first.isDoubles, true);
  assert.strictEqual(first.team1.length, 2);
  assert.strictEqual((await finish(first.token, WIN1)).status, 200);
  const t2 = (await call('GET', `/api/seasons/${s.id}/standings`, { cookie: '' })).json.groups[0].rows;
  assert.strictEqual(t2[0].wins, 1, 'a win of a pair shows in the table of pairs');
  assert.strictEqual(t2[0].points, 3);
  // a draw with a played match cannot be deleted
  assert.strictEqual((await call('DELETE', `/api/seasons/${s.id}/draw/DOUBLES`)).status, 409);
});

test('groups + bracket: when the last group match is played the bracket of the best pairs is made by itself, with the partners', async () => {
  const s = await tournament('Skupiny a pavúk', [['Aba A', 'Bob B'], ['Cec C', 'Dan D'], ['Eda E', 'Fil F'], ['Gus G', 'Hil H']]);
  const made = await draw(s, { format: 'GROUPS_BRACKET', groupCount: 2, qualifiers: 1, bracketType: 'ELIMINATION' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.matches, 2, 'two groups of two pairs, one match each');
  assert.strictEqual((await overview(s)).stage, 'GROUPS');
  const all = (await call('GET', `/api/matches?seasonId=${s.id}`, { cookie: '' })).json;
  assert.strictEqual(all.length, 2);
  for (const m of all) assert.strictEqual((await finish(m.token, WIN1)).status, 200);
  const c = await overview(s);
  assert.strictEqual(c.stage, 'BRACKET', 'the bracket was made after the last group match');
  const main = await bracketOf(c.main.id);
  assert.strictEqual(main.isDoubles, true);
  const final = main.nodes.find((n) => n.round === 1);
  assert.ok(final.match, 'the two group winners meet');
  const fm = await matchOf(final.match.token);
  assert.strictEqual(fm.isDoubles, true);
  assert.strictEqual(fm.team1.length + fm.team2.length, 4, 'the pairs went on with their partners');
  assert.strictEqual((await call('DELETE', `/api/seasons/${s.id}/draw/DOUBLES`)).status, 409, 'played: no deleting');
});

test('by hand (Zostaviť ručne): an empty doubles bracket whose slots are seated with a pair each; a draw nothing was played in can be deleted', async () => {
  const s = await tournament('Ručný pavúk', [['Ada AA', 'Ben BB'], ['Cyr CC', 'Dan DD']]);
  const made = await draw(s, { format: 'ELIMINATION', mode: 'MANUAL' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const b = await bracketOf(made.json.main);
  assert.strictEqual(b.isDoubles, true);
  const slot = b.nodes.find((n) => n.round === 1);
  assert.ok(!slot.match, 'nothing is seated yet');
  const seat = await call('PATCH', `/api/brackets/${b.id}/slots/${slot.id}`, { body: { player1Id: P['Ada AA'], player1PartnerId: P['Ben BB'], player2Id: P['Cyr CC'], player2PartnerId: P['Dan DD'] } });
  assert.strictEqual(seat.status, 200, JSON.stringify(seat.json));
  const seated = seat.json.nodes.find((n) => n.round === 1);
  assert.ok(seated.match);
  assert.deepStrictEqual(teamNames(await matchOf(seated.match.token)), ['Ada AA / Ben BB', 'Cyr CC / Dan DD']);
  const gone = await call('DELETE', `/api/seasons/${s.id}/draw/DOUBLES`);
  assert.strictEqual(gone.status, 200, JSON.stringify(gone.json));
  assert.strictEqual((await call('GET', `/api/brackets/${b.id}`, { cookie: '' })).status, 404);
  assert.strictEqual((await overview(s)).stage, 'NONE');
});

test('the court planner knows the partners of a doubles match; deleting the tournament takes the pairs and the draws with it', async () => {
  const s = await tournament('Plánovač', [['Iva I2', 'Jan J2'], ['Kuba K2', 'Lea L2']]);
  await call('PATCH', `/api/seasons/${s.id}`, { body: { courtCount: 2 } });
  const made = await draw(s, { format: 'ELIMINATION' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const sched = (await call('GET', `/api/seasons/${s.id}/schedule`, { cookie: '' })).json;
  const row = (sched.matches || sched.rows || []).find((m) => m.player1 && m.player2 && [m.player1.name, m.player2.name].sort().join('|') === 'Iva I2 / Jan J2|Kuba K2 / Lea L2');
  assert.ok(row, 'the schedule names the pairs: ' + JSON.stringify(sched).slice(0, 300));
  assert.deepStrictEqual([row.player1.slug, row.player2.slug], [null, null], 'a pair has no profile link');
  assert.strictEqual((await call('DELETE', `/api/seasons/${s.id}?withMatches=1`)).status, 200);
  assert.strictEqual((await call('GET', `/api/brackets/${made.json.main}`, { cookie: '' })).status, 404);
});

test('singles or doubles is chosen when a tournament is made and never mixed', async () => {
  // a singles tournament (the default): the three categories, no pairs, no doubles draw, a partner is not kept
  const single = await call('POST', '/api/seasons', { body: { name: 'Dvojhra turnaj', kind: 'TOURNAMENT', startDate: '2099-08-01', endDate: '2099-08-02' } });
  assert.strictEqual(single.status, 201, JSON.stringify(single.json));
  assert.strictEqual(single.json.playType, 'SINGLES');
  const sid = single.json.id;
  await call('PATCH', `/api/seasons/${sid}`, { body: { registrationOpen: true } });
  await players(['Solo S', 'Duo D']);
  // (the public form is limited to a few entries an hour from one address, so the organiser's route is used here)
  const reg = await call('POST', `/api/seasons/${sid}/registrations/admin`, { body: { playerId: P['Solo S'], partner: 'Duo D', category: '' } });
  assert.strictEqual(reg.status, 201, 'a singles entry needs no partner');
  assert.strictEqual((await call('GET', `/api/seasons/${sid}/registrations`)).json[0].partnerName, '', 'and a partner given is not kept');
  const draw1 = (await call('GET', `/api/seasons/${sid}/draw`)).json;
  assert.strictEqual(draw1.playType, 'SINGLES');
  assert.deepStrictEqual(draw1.categories.map((c) => c.category), ['ELITE', 'NEXT_GEN', 'NOVICE']);
  assert.strictEqual((await call('POST', `/api/seasons/${sid}/doubles/pairs`, { body: { player: 'Solo S', partner: 'Duo D' } })).status, 400, 'no pairs in a singles tournament');
  assert.strictEqual((await draw({ id: sid }, { format: 'ELIMINATION' })).status, 400, 'no doubles draw in a singles tournament');
  // a doubles tournament: the Štvorhra category only, no sorting into categories, no Elite draw
  const dbl = await tournament('Štvorhra turnaj', [['Pat P', 'Pit PP'], ['Rob R', 'Ron RR']]);
  assert.strictEqual(dbl.playType, 'DOUBLES');
  const draw2 = (await call('GET', `/api/seasons/${dbl.id}/draw`)).json;
  assert.strictEqual(draw2.playType, 'DOUBLES');
  assert.deepStrictEqual(draw2.categories.map((c) => c.category), ['DOUBLES']);
  assert.strictEqual((await call('POST', `/api/seasons/${dbl.id}/draw`, { body: { category: 'ELITE', format: 'ELIMINATION' } })).status, 400, 'no Elite draw');
  assert.strictEqual((await call('POST', `/api/seasons/${dbl.id}/registrations/categories`, { body: { assignments: [{ id: 1, category: 'ELITE' }] } })).status, 400, 'no sorting into categories');
  // the type stays
  assert.strictEqual((await call('PATCH', `/api/seasons/${dbl.id}`, { body: { playType: 'SINGLES' } })).status, 409);
  assert.strictEqual((await call('PATCH', `/api/seasons/${sid}`, { body: { playType: 'DOUBLES' } })).status, 409);
  assert.strictEqual((await call('PATCH', `/api/seasons/${dbl.id}`, { body: { playType: 'DOUBLES', name: 'Štvorhra turnaj 2' } })).status, 200, 'saying the same type is fine');
  assert.strictEqual((await call('POST', '/api/seasons', { body: { name: 'Zlý typ', kind: 'TOURNAMENT', playType: 'MIXED' } })).status, 400);
  // the schedule lists them by what they are played as
  const sch = (await call('GET', '/api/schedule', { cookie: '' })).json;
  assert.deepStrictEqual(sch.find((e) => e.name === 'Štvorhra turnaj 2').categories, ['DOUBLES']);
  assert.deepStrictEqual(sch.find((e) => e.name === 'Dvojhra turnaj').categories, ['ELITE', 'NEXT_GEN', 'NOVICE']);
  // the organiser adds an entry: the partner is required there too, and the pair is made
  await players(['Gus GG', 'Hal HH']);
  const admin = await call('POST', `/api/seasons/${dbl.id}/registrations/admin`, { body: { playerId: P['Gus GG'] } });
  assert.strictEqual(admin.status, 400, 'the partner is needed');
  const admin2 = await call('POST', `/api/seasons/${dbl.id}/registrations/admin`, { body: { playerId: P['Gus GG'], partner: 'Hal HH' } });
  assert.strictEqual(admin2.status, 201, JSON.stringify(admin2.json));
  assert.strictEqual(admin2.json.partnerName, 'Hal HH');
  assert.strictEqual(admin2.json.category, '');
  const pairsNow = (await call('GET', `/api/seasons/${dbl.id}/doubles`)).json.pairs;
  assert.ok(pairsNow.some((p) => p.player.name === 'Gus GG' && p.partner.name === 'Hal HH'));
});

test('the pages carry the pieces: the partner field of the form, the pairs of the draw screen, the Štvorhra chip of the brackets and groups tabs', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  const form = read('js/season.js');
  assert.ok(form.includes('sv-reg-partner') && form.includes('partner'), 'season.js: the partner field');
  const drawJs = read('js/season-draw.js');
  ['dbl-add', 'dbl-from-regs', 'dbl-remove', 'registrationId'].forEach((x) => assert.ok(drawJs.includes(x), 'season-draw.js: ' + x));
  // the strip of the home page lists tournaments too and says whether a card is a league or a tournament
  const home = read('js/home.js');
  assert.ok(home.includes('home-tl-kind') && !home.includes("filter((s) => s.kind !== 'TOURNAMENT').sort"), 'home.js: tournaments in the strip, each tagged');
  const admin = read('js/seasons-admin.js');
  ['season-playtype', 'data-playtype', 'Add pair'].forEach((x) => assert.ok(admin.includes(x), 'seasons-admin.js: ' + x));
  const i18n = read('js/i18n.js');
  ['season.regPartner', 'season.catDoubles', 'season.pairsTitle'].forEach((k) => assert.strictEqual(i18n.split("'" + k + "'").length, 3, k + ' in Slovak and English'));
});

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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held for a moment on Windows; it is a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
