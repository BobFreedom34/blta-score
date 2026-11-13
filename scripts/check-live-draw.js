// Checks of the draw in front of the camera ("Žreb naživo", src/liveDraw.js, public/draw-live.html): the plan that is shown is exactly the draw that is saved (groups, brackets, the table of
// 6, the Swiss table), the lot is made from a key whose lock is shown first and which anybody can check in the browser (public/js/draw-verify.js), nothing is saved before the organiser says so, a draw
// that no longer fits the players is refused, every start is written down, a saved draw is public and replayable.
// Run: node scripts/check-live-draw.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const DrawVerify = require('../public/js/draw-verify.js');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldraw-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

let counter = 0;
// a tournament with registered players: { tournament, regs: [{ player, reg }] } per category
async function tournamentWith(name, categories) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03' });
  assert.strictEqual(made.status, 201, made.text);
  const tournament = made.json;
  const people = {};
  for (const [category, count] of Object.entries(categories)) {
    people[category] = [];
    for (let i = 0; i < count; i += 1) {
      counter += 1;
      const p = await call('POST', '/api/players', { name: `${category} Hráč ${String(counter).padStart(2, '0')}` });
      assert.strictEqual(p.status, 201, p.text);
      const reg = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { playerId: p.json.id, category, phone: `0903${String(100000 + counter)}`, email: `p${counter}@example.com` });
      assert.strictEqual(reg.status, 201, reg.text);
      people[category].push({ player: p.json, reg: reg.json });
    }
  }
  return { tournament, people };
}
const seed = async (t, category, list, n) => {
  const items = list.map((x, i) => ({ id: x.reg.id, seed: i < n ? i + 1 : null }));
  const r = await call('POST', `/api/seasons/${t.id}/seeds`, { category, seeds: items });
  assert.strictEqual(r.status, 200, r.text);
};
const prepare = (t, category, options) => call('POST', `/api/seasons/${t.id}/draw/live/prepare`, { category, ...options });
const commit = (t, recordId) => call('POST', `/api/seasons/${t.id}/draw/live/commit`, { recordId });
const overviewOf = async (t, category) => (await call('GET', `/api/seasons/${t.id}/draw`)).json.categories.find((c) => c.category === category);

// every entrant is placed exactly once, on a seat of its own, and the seeded players come first
function assertPlanIsComplete(plan) {
  const ids = new Set(plan.entrants.map((e) => e.id));
  assert.strictEqual(plan.steps.length, plan.entrants.length);
  assert.deepStrictEqual(new Set(plan.steps.map((s) => s.e)), ids, 'every player is placed once');
  assert.strictEqual(new Set(plan.steps.map((s) => JSON.stringify(s.slot))).size, plan.steps.length, 'every seat is used once');
  const kinds = plan.steps.map((s) => s.kind);
  const lastSeed = kinds.lastIndexOf('SEED');
  assert.ok(kinds.slice(0, lastSeed + 1).every((k) => k === 'SEED'), 'the seeded players are shown first');
  assert.strictEqual(kinds.filter((k) => k === 'SEED').length, plan.entrants.filter((e) => e.seed).length);
}

let t1; let p1;

test('setup: a tournament with Elite 10 (3 seeded), Next Gen 9 (2 seeded) and Novice 6 players', async () => {
  ({ tournament: t1, people: p1 } = await tournamentWith('Live Open 2026', { ELITE: 10, NEXT_GEN: 9, NOVICE: 6 }));
  await seed(t1, 'ELITE', p1.ELITE, 3);
  await seed(t1, 'NEXT_GEN', p1.NEXT_GEN, 2);
});

test('the page is served (noindex, no sitemap entry) and the checker works in this runtime', async () => {
  const page = await call('GET', '/draw-live', undefined, { admin: false });
  assert.strictEqual(page.status, 200);
  assert.ok(/noindex/.test(page.text), 'noindex');
  assert.ok(/draw-live\.js/.test(page.text) && /draw-verify\.js/.test(page.text), 'the scripts');
  assert.ok(!/draw-live/.test((await call('GET', '/sitemap.xml', undefined, { admin: false })).text), 'not in the sitemap');
  assert.strictEqual((await call('GET', '/draw-live?record=1', undefined, { admin: false })).status, 200, 'the replay address');
  assert.ok(typeof DrawVerify.verifyRecord === 'function');
});

test('only the organiser can start or save a draw', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${t1.id}/draw/live/prepare`, { category: 'ELITE' }, { admin: false })).status, 401);
  assert.strictEqual((await call('POST', `/api/seasons/${t1.id}/draw/live/commit`, { recordId: 1 }, { admin: false })).status, 401);
});

test('starting a draw writes nothing into the tournament; the lock is the hash of the key', async () => {
  const r = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.seedHash, crypto.createHash('sha256').update(r.json.seed).digest('hex'));
  assert.strictEqual(r.json.seed.length, 64);
  assert.strictEqual(r.json.attempt, 1);
  assertPlanIsComplete(r.json.plan);
  assert.strictEqual(r.json.plan.layout.type, 'GROUPS');
  assert.strictEqual(r.json.plan.layout.groups.length, 3, '10 players, groups of 4: 3 groups');
  assert.strictEqual((await overviewOf(t1, 'ELITE')).stage, 'NONE', 'nothing saved');
  // the seeded players take the seats of the snake: seed 1 in group A, seed 2 in group B, seed 3 in group C
  const seeded = r.json.plan.steps.filter((s) => s.kind === 'SEED');
  assert.deepStrictEqual(seeded.map((s) => s.slot), [{ g: 0, i: 0 }, { g: 1, i: 0 }, { g: 2, i: 0 }]);
  // a draw that was not saved is not public
  assert.strictEqual((await call('GET', `/api/draw-records/${r.json.recordId}`, undefined, { admin: false })).status, 404);
});

test('the shuffle is repeated from the key in the browser code and agrees with the server (groups, bracket, table of 6, Swiss)', async () => {
  const cases = [
    [t1, 'ELITE', { format: 'GROUPS', groupSize: 4 }],
    [t1, 'ELITE', { format: 'GROUPS_BRACKET', groupSize: 5 }],
    [t1, 'NEXT_GEN', { format: 'ELIMINATION' }],
    [t1, 'NEXT_GEN', { format: 'PRINCE' }],
    [t1, 'NOVICE', { format: 'SIX_ROUNDS' }],
    [t1, 'NOVICE', { format: 'SWISS' }],
  ];
  for (const [t, category, options] of cases) {
    const r = await prepare(t, category, options);
    assert.strictEqual(r.status, 201, `${options.format}: ${r.text}`);
    assertPlanIsComplete(r.json.plan);
    const v = await DrawVerify.verifyRecord({ seed: r.json.seed, seedHash: r.json.seedHash, plan: r.json.plan });
    assert.ok(v.ok && v.lockOk, `${options.format}: ${v.problems.join('; ')}`);
  }
});

test('a changed key, lock or seat is caught by the check', async () => {
  const r = await prepare(t1, 'NEXT_GEN', { format: 'ELIMINATION' });
  const rec = { seed: r.json.seed, seedHash: r.json.seedHash, plan: r.json.plan };
  assert.ok((await DrawVerify.verifyRecord(rec)).ok);
  const wrongKey = { ...rec, seed: crypto.randomBytes(32).toString('hex') };
  const a = await DrawVerify.verifyRecord(wrongKey);
  assert.ok(!a.ok && !a.lockOk, 'another key does not fit the lock');
  const plan = JSON.parse(JSON.stringify(rec.plan));
  const drawn = plan.steps.filter((s) => s.kind === 'DRAW');
  [drawn[0].slot, drawn[1].slot] = [drawn[1].slot, drawn[0].slot]; // two players swap seats after the shuffle
  const b = await DrawVerify.verifyRecord({ ...rec, plan });
  assert.ok(!b.ok && b.lockOk, 'swapped seats are found');
});

test('the draws differ from start to start (a fresh key every time), the seeded seats do not', async () => {
  const a = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  const b = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  assert.notStrictEqual(a.json.seed, b.json.seed);
  assert.notStrictEqual(a.json.recordId, b.json.recordId);
  assert.strictEqual(b.json.attempt, a.json.attempt + 1, 'the attempts are counted');
  assert.deepStrictEqual(a.json.plan.steps.filter((s) => s.kind === 'SEED').map((s) => s.e), b.json.plan.steps.filter((s) => s.kind === 'SEED').map((s) => s.e));
});

test('what is saved is exactly what was shown: groups', async () => {
  const r = await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 });
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(p1.ELITE.map((x) => [x.reg.id, x.player.id]));
  r.json.plan.steps.forEach((s) => assert.strictEqual(saved.json.groups[s.slot.g].playerIds[s.slot.i], playerOf.get(s.e), 'the seat of a player'));
  assert.strictEqual(saved.json.groups.length, r.json.plan.layout.groups.length);
  assert.strictEqual((await overviewOf(t1, 'ELITE')).stage, 'GROUPS');
  assert.strictEqual((await overviewOf(t1, 'ELITE')).liveRecordId, r.json.recordId);
});

test('what is saved is exactly what was shown: a bracket with byes (9 players, 2 seeded)', async () => {
  const r = await prepare(t1, 'NEXT_GEN', { format: 'PRINCE' });
  assert.strictEqual(r.json.plan.layout.size, 16);
  assert.strictEqual(r.json.plan.layout.byes, 7);
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const bracket = (await call('GET', `/api/brackets/${saved.json.main}`)).json;
  const round1 = bracket.nodes.filter((n) => n.round === 1).sort((a, b) => a.position - b.position);
  const playerOf = new Map(p1.NEXT_GEN.map((x) => [x.reg.id, x.player.id]));
  r.json.plan.steps.forEach((s) => {
    const node = round1[Math.floor(s.slot.p / 2)];
    const seat = s.slot.p % 2 === 0 ? node.player1 : node.player2;
    assert.strictEqual(seat && seat.id, playerOf.get(s.e), 'the seat of a player');
  });
  const seats = r.json.plan.layout.seats;
  assert.strictEqual(seats.filter((x) => x.bye).length, 7);
});

test('what is saved is exactly what was shown: the table of 6', async () => {
  const r = await prepare(t1, 'NOVICE', { format: 'SIX_ROUNDS' });
  const saved = await commit(t1, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(p1.NOVICE.map((x) => [x.reg.id, x.player.id]));
  assert.deepStrictEqual(saved.json.groups[0].playerIds, r.json.plan.steps.map((s) => playerOf.get(s.e)));
});

test('a draw is saved once, a saved one is public with its key, and the starts are counted', async () => {
  const rec = (await overviewOf(t1, 'ELITE')).liveRecordId;
  const again = await commit(t1, rec);
  assert.strictEqual(again.status, 409);
  const pub = await call('GET', `/api/draw-records/${rec}`, undefined, { admin: false });
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.json.seedHash, crypto.createHash('sha256').update(pub.json.seed).digest('hex'));
  assert.strictEqual(pub.json.seasonName, 'Live Open 2026');
  assert.ok(pub.json.attempts >= 4, `the starts of the category are counted (${pub.json.attempts})`);
  assert.strictEqual(pub.json.deleted, false);
  assert.ok((await DrawVerify.verifyRecord(pub.json)).ok, 'anybody can repeat the draw from the public record');
  assert.strictEqual((await call('GET', '/api/draw-records/999999', undefined, { admin: false })).status, 404);
});

test('a draw that no longer fits the players (the seeding changed) is refused and nothing is saved', async () => {
  const { tournament: t2, people } = await tournamentWith('Changing Cup', { ELITE: 6 });
  await seed(t2, 'ELITE', people.ELITE, 2);
  const r = await prepare(t2, 'ELITE', { format: 'ELIMINATION' });
  assert.strictEqual(r.status, 201, r.text);
  await seed(t2, 'ELITE', people.ELITE, 3); // one more seeded player after the draw was shown
  const saved = await commit(t2, r.json.recordId);
  assert.strictEqual(saved.status, 409, saved.text);
  assert.strictEqual((await overviewOf(t2, 'ELITE')).stage, 'NONE');
  // a new start fits
  const fresh = await prepare(t2, 'ELITE', { format: 'ELIMINATION' });
  assert.strictEqual((await commit(t2, fresh.json.recordId)).status, 201);
});

test('what the real draw refuses, the live draw refuses before it starts', async () => {
  assert.strictEqual((await prepare(t1, 'ELITE', { format: 'GROUPS', groupSize: 4 })).status, 409, 'the draw already exists');
  const { tournament: t3, people } = await tournamentWith('Small Cup', { ELITE: 5, NOVICE: 1 });
  assert.strictEqual((await prepare(t3, 'NOVICE', { format: 'ELIMINATION' })).status, 400, 'one player');
  assert.strictEqual((await prepare(t3, 'ELITE', { format: 'SIX_ROUNDS' })).status, 400, 'exactly 6 players');
  assert.strictEqual((await prepare(t3, 'ELITE', { format: 'ELIMINATION', mode: 'MANUAL' })).status, 400, 'a draw by hand is not a lot');
  assert.strictEqual((await prepare(t3, 'NOPE', { format: 'ELIMINATION' })).status, 400, 'no such category');
  void people;
});

test('the Swiss table: the seeded players first, the others by lot, saved in the order shown', async () => {
  const { tournament: t4, people } = await tournamentWith('Swiss Live', { ELITE: 7 });
  await seed(t4, 'ELITE', people.ELITE, 2);
  const r = await prepare(t4, 'ELITE', { format: 'SWISS' });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.plan.layout.type, 'TABLE');
  assert.deepStrictEqual(r.json.plan.steps.slice(0, 2).map((s) => s.kind), ['SEED', 'SEED']);
  const saved = await commit(t4, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  const playerOf = new Map(people.ELITE.map((x) => [x.reg.id, x.player.id]));
  assert.deepStrictEqual(saved.json.groups[0].playerIds, r.json.plan.steps.map((s) => playerOf.get(s.e)));
});

test('the page of a tournament knows its saved live draws (the tile "Žreb naživo"): none before, one link per saved category after', async () => {
  const { tournament: t5, people } = await tournamentWith('Tile Cup', { ELITE: 5 });
  assert.deepStrictEqual((await call('GET', `/api/seasons/by-slug/${t5.slug}`, undefined, { admin: false })).json.liveDraws, [], 'not made yet');
  const r = await prepare(t5, 'ELITE', { format: 'ELIMINATION' });
  assert.deepStrictEqual((await call('GET', `/api/seasons/by-slug/${t5.slug}`, undefined, { admin: false })).json.liveDraws, [], 'a draw that is only started is not shown');
  assert.strictEqual((await commit(t5, r.json.recordId)).status, 201);
  const after = (await call('GET', `/api/seasons/by-slug/${t5.slug}`, undefined, { admin: false })).json.liveDraws;
  assert.deepStrictEqual(after, [{ id: r.json.recordId, category: 'ELITE' }]);
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'season.js'), 'utf8');
  assert.ok(js.includes('liveDrawTile') && js.includes('/draw-live?record='), 'the tile');
  const i18n = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
  for (const key of ['season.tileLiveDraw', 'season.liveDrawPlay', 'season.liveDrawNone']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  void people;
});

test('a draw that was deleted later stays on record, marked as deleted', async () => {
  const rec = (await overviewOf(t1, 'NOVICE')).liveRecordId;
  assert.ok(rec);
  const del = await call('DELETE', `/api/seasons/${t1.id}/draw/NOVICE`);
  assert.strictEqual(del.status, 200, del.text);
  const pub = await call('GET', `/api/draw-records/${rec}`, undefined, { admin: false });
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.json.deleted, true);
  assert.strictEqual((await overviewOf(t1, 'NOVICE')).liveRecordId, null);
});

// ---------- the draw of the players of a SEASON into its groups ----------
let league; let leagueGroups; let leaguePeople;
const groupsPrepare = (x, category) => call('POST', `/api/seasons/${x.id}/groups/live/prepare`, { category });
const groupsCommit = (x, recordId) => call('POST', `/api/seasons/${x.id}/groups/live/commit`, { recordId });
const membersOf = async () => (await call('GET', `/api/seasons/${league.id}`)).json.groups.map((g) => (g.members || g.players || []).length);

test('season setup: Elite 11 players (3 seeded), 3 empty groups; a tournament cannot use this draw', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Liga Žreb', kind: 'LEAGUE', startDate: '2099-03-01', endDate: '2099-06-01' });
  assert.strictEqual(made.status, 201, made.text);
  league = made.json;
  leaguePeople = [];
  for (let i = 0; i < 11; i += 1) {
    counter += 1;
    const p = await call('POST', '/api/players', { name: `Liga Hráč ${String(counter).padStart(2, '0')}` });
    const reg = await call('POST', `/api/seasons/${league.id}/registrations/admin`, { playerId: p.json.id, category: 'ELITE', phone: `0904${String(100000 + counter)}`, email: `l${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    leaguePeople.push({ player: p.json, reg: reg.json });
  }
  leagueGroups = [];
  for (const name of ['A', 'B', 'C']) {
    const g = await call('POST', `/api/seasons/${league.id}/groups`, { name, category: 'ELITE' });
    assert.strictEqual(g.status, 201, g.text);
    leagueGroups.push(g.json);
  }
  const seeds = await call('POST', `/api/seasons/${league.id}/groups/seeds`, { category: 'ELITE', seeds: leaguePeople.map((x, i) => ({ id: x.reg.id, seed: i < 3 ? i + 1 : null })) });
  assert.strictEqual(seeds.status, 200, seeds.text);
  assert.strictEqual((await groupsPrepare(t1, 'ELITE')).status, 400, 'a tournament has its own draw');
  const info = (await call('GET', `/api/seasons/${league.id}/groups/draw-info`)).json.categories.find((c) => c.category === 'ELITE');
  assert.strictEqual(info.groups, 3);
  assert.strictEqual(info.toDraw.length, 11);
});

test('only the organiser can start or save the draw into groups', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${league.id}/groups/live/prepare`, { category: 'ELITE' }, { admin: false })).status, 401);
});

test('the groups come out equal and the seeds go like a snake; the browser repeats the shuffle', async () => {
  const r = await groupsPrepare(league, 'ELITE');
  assert.strictEqual(r.status, 201, r.text);
  const plan = r.json.plan;
  assert.deepStrictEqual(plan.layout.caps, [4, 4, 3]);
  assertPlanIsComplete(plan);
  const seatOf = (n) => plan.steps.find((st) => st.e === leaguePeople[n].reg.id).slot;
  assert.deepStrictEqual([seatOf(0).g, seatOf(1).g, seatOf(2).g], [0, 1, 2], 'seeds 1, 2, 3 in the groups A, B, C');
  const verdict = await DrawVerify.verifyRecord({ seed: r.json.seed, seedHash: r.json.seedHash, plan });
  assert.deepStrictEqual(verdict, { ok: true, lockOk: true, problems: [] });
  const bad = JSON.parse(JSON.stringify(plan));
  [bad.steps[5].slot, bad.steps[6].slot] = [bad.steps[6].slot, bad.steps[5].slot];
  assert.strictEqual((await DrawVerify.verifyRecord({ seed: r.json.seed, seedHash: r.json.seedHash, plan: bad })).ok, false);
  assert.deepStrictEqual(await membersOf(), [0, 0, 0], 'starting writes nothing');
});

test('the snake: 8 seeds in 4 groups go A 1+8, B 2+7, C 3+6, D 4+5; equal sizes when it divides or one less', async () => {
  const L = require('../src/liveDraw.js');
  assert.deepStrictEqual(L.dealSnake([1, 2, 3, 4, 5, 6, 7, 8], [2, 2, 2, 2]), [[1, 8], [2, 7], [3, 6], [4, 5]]);
  assert.deepStrictEqual(L.capacitiesOf([0, 0, 0, 0], 22), [6, 6, 5, 5]);
  assert.deepStrictEqual(L.capacitiesOf([0, 0, 1], 10), [4, 4, 2]);
});

test('what is saved is what was shown: a player put into a group by hand stays and the draw fills the rest', async () => {
  const manual = leaguePeople[10];
  const add = await call('POST', `/api/seasons/groups/${leagueGroups[2].id}/members`, { playerId: manual.player.id });
  assert.ok(add.status === 201 || add.status === 200, add.text);
  const r = await groupsPrepare(league, 'ELITE');
  assert.strictEqual(r.status, 201, r.text);
  const plan = r.json.plan;
  assert.strictEqual(plan.entrants.length, 10, 'the player that is in a group is not drawn again');
  assert.deepStrictEqual(plan.layout.caps, [4, 4, 2]);
  assert.deepStrictEqual(plan.layout.groups.map((g) => g.size), [4, 4, 4 - 1]);
  assert.strictEqual((await DrawVerify.verifyRecord({ seed: r.json.seed, seedHash: r.json.seedHash, plan })).ok, true);
  const saved = await groupsCommit(league, r.json.recordId);
  assert.strictEqual(saved.status, 201, saved.text);
  assert.strictEqual(saved.json.saved, 10);
  assert.deepStrictEqual(await membersOf(), [4, 4, 3]);
  const season = (await call('GET', `/api/seasons/${league.id}`)).json;
  plan.steps.forEach((st) => {
    const group = season.groups.find((g) => g.id === leagueGroups[st.slot.g].id);
    const ids = (group.members || group.players).map((m) => m.playerId || m.player_id || m.id);
    const reg = plan.entrants.find((e) => e.id === st.e);
    const person = leaguePeople.find((x) => x.reg.id === reg.id);
    assert.ok(ids.includes(person.player.id), `${reg.name} is in the group shown`);
  });
  assert.strictEqual((await groupsCommit(league, r.json.recordId)).status, 409, 'saved once');
  assert.strictEqual((await groupsPrepare(league, 'ELITE')).status, 400, 'nobody is left to draw');
});

test('a player replaced after the draw: only that group is recomputed, its unplayed matches of the leaver go, the missing pairs come', async () => {
  const A = leagueGroups[0].id;
  const made = await call('POST', `/api/seasons/${league.id}/schedule`, { groupIds: [A] });
  assert.strictEqual(made.status, 201, made.text);
  const matchesOf = async (gid) => (await call('GET', `/api/seasons/${league.id}`)).json.groups.find((g) => g.id === gid).matchCount;
  assert.strictEqual(await matchesOf(A), 6);
  assert.strictEqual(await matchesOf(leagueGroups[1].id), 0, 'the other groups are not touched');
  const group = (await call('GET', `/api/seasons/${league.id}`)).json.groups.find((g) => g.id === A);
  const leaver = group.members[0];
  const gone = await call('DELETE', `/api/seasons/groups/${A}/members/${leaver.id}`);
  assert.strictEqual(gone.status, 200, gone.text);
  assert.strictEqual(gone.json.removedMatches, 3);
  assert.strictEqual(await matchesOf(A), 3);
  counter += 1;
  const np = await call('POST', '/api/players', { name: `Náhradník ${counter}` });
  assert.strictEqual((await call('POST', `/api/seasons/groups/${A}/members`, { playerId: np.json.id })).status, 201);
  const preview = (await call('GET', `/api/seasons/${league.id}/schedule-preview`)).json.groups.find((g) => g.groupId === A);
  assert.strictEqual(preview.toCreate, 3, 'the warning: three matches are missing');
  const again = await call('POST', `/api/seasons/${league.id}/schedule`, { groupIds: [A] });
  assert.strictEqual(again.status, 201, again.text);
  assert.strictEqual(await matchesOf(A), 6);
  const admin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'seasons-admin.js'), 'utf8');
  assert.ok(admin.includes('wireStaleSchedules') && admin.includes('sg-stale'), 'the warning under the group');
});

test('manual edits after the draw: adding to a group, a player of another group, a played match blocks removal, withdrawal keeps the pairs', async () => {
  const B = leagueGroups[1].id;
  const season = async () => (await call('GET', `/api/seasons/${league.id}`)).json;
  const preview = async (gid) => (await call('GET', `/api/seasons/${league.id}/schedule-preview`)).json.groups.find((g) => g.groupId === gid);
  const matchesOf = async (gid) => (await season()).groups.find((g) => g.id === gid).matchCount;
  // group B: the schedule is made, then a fifth player is added by hand -> only B warns, only 4 new pairs
  assert.strictEqual((await call('POST', `/api/seasons/${league.id}/schedule`, { groupIds: [B] })).status, 201);
  const before = await matchesOf(B);
  assert.strictEqual(before, 6);
  counter += 1;
  const extra = await call('POST', '/api/players', { name: `Doplnený ${counter}` });
  assert.strictEqual((await call('POST', `/api/seasons/groups/${B}/members`, { playerId: extra.json.id })).status, 201);
  assert.strictEqual((await preview(B)).toCreate, 4, 'the new player needs 4 matches');
  assert.strictEqual(await matchesOf(B), 6, 'adding alone does not touch the schedule');
  const c = await preview(leagueGroups[2].id);
  assert.strictEqual(c.existing, 0, 'the group C has no matches yet');
  // the same player twice, and a player of another group, are refused
  assert.strictEqual((await call('POST', `/api/seasons/groups/${B}/members`, { playerId: extra.json.id })).status, 409);
  const inA = (await season()).groups.find((g) => g.id === leagueGroups[0].id).members[0];
  assert.strictEqual((await call('POST', `/api/seasons/groups/${B}/members`, { playerId: inA.id })).status, 409);
  assert.strictEqual((await call('POST', `/api/seasons/${league.id}/schedule`, { groupIds: [B] })).status, 201);
  assert.strictEqual(await matchesOf(B), 10);
  assert.strictEqual((await preview(B)).toCreate, 0, 'the warning is gone');
  // a player with a played match cannot be removed, he is withdrawn: his open matches become walkovers and nothing new is planned
  const bm = (await season()).groups.find((g) => g.id === B).members;
  const played = bm[0];
  // one of his matches is played (written straight into the test database)
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const own = raw.prepare("SELECT id, player1_id, player2_id FROM matches WHERE group_id = ? AND status = 'PLANNED' AND (player1_id = ? OR player2_id = ?)").all(B, played.id, played.id);
  assert.ok(own.length >= 4, 'the player has matches');
  raw.prepare("UPDATE matches SET status = 'FINISHED', winner_id = ? WHERE id = ?").run(played.id, own[0].id);
  raw.close();
  const del = await call('DELETE', `/api/seasons/groups/${B}/members/${played.id}`);
  assert.strictEqual(del.status, 400, 'he has played: withdraw instead');
  const wd = await call('POST', `/api/seasons/groups/${B}/members/${played.id}/withdraw`);
  assert.strictEqual(wd.status, 200, wd.text);
  assert.ok(wd.json.walkovers >= 1);
  assert.strictEqual((await preview(B)).toCreate, 0, 'a withdrawn player needs no new matches');
  // a replacement for him takes the place: only his pairs are made
  counter += 1;
  const repl = await call('POST', '/api/players', { name: `Náhrada ${counter}` });
  assert.strictEqual((await call('POST', `/api/seasons/groups/${B}/members`, { playerId: repl.json.id })).status, 201);
  const p2 = await preview(B);
  assert.strictEqual(p2.toCreate, 4, 'the replacement plays the 4 active players');
  assert.strictEqual((await call('POST', `/api/seasons/${league.id}/schedule`, { groupIds: [B] })).status, 201);
  assert.strictEqual((await preview(B)).toCreate, 0);
  // reinstating works
  assert.strictEqual((await call('POST', `/api/seasons/groups/${B}/members/${played.id}/reinstate`)).status, 200);
});

test('a season: the groups are made in one go, the players are divided at once (no show, nothing for the tile), taken out again', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Liga Auto', kind: 'LEAGUE', startDate: '2099-03-01', endDate: '2099-06-01' });
  assert.strictEqual(made.status, 201, made.text);
  const lg = made.json;
  const regs = [];
  for (let i = 0; i < 9; i += 1) {
    counter += 1;
    const p = await call('POST', '/api/players', { name: `Auto Hráč ${String(counter).padStart(2, '0')}` });
    const reg = await call('POST', `/api/seasons/${lg.id}/registrations/admin`, { playerId: p.json.id, category: 'NOVICE', phone: `0905${String(100000 + counter)}`, email: `a${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    regs.push(reg.json);
  }
  assert.strictEqual((await call('POST', `/api/seasons/${lg.id}/groups/bulk`, { category: 'NOVICE', count: 0 })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${lg.id}/groups/bulk`, { category: 'NOPE', count: 2 })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${lg.id}/groups/bulk`, { category: 'NOVICE', count: 2 }, { admin: false })).status, 401);
  const groups = await call('POST', `/api/seasons/${lg.id}/groups/bulk`, { category: 'NOVICE', count: 2 });
  assert.strictEqual(groups.status, 201, groups.text);
  assert.deepStrictEqual(groups.json.created.map((g) => g.name), ['Novice A', 'Novice B']);
  const more = await call('POST', `/api/seasons/${lg.id}/groups/bulk`, { category: 'NOVICE', count: 1 });
  assert.deepStrictEqual(more.json.created.map((g) => g.name), ['Novice C'], 'the next free letter');
  // (the third is not wanted: take it away again so the 9 players go into 2 groups)
  assert.strictEqual((await call('DELETE', `/api/seasons/groups/${more.json.created[0].id}`)).status, 200);
  const auto = await call('POST', `/api/seasons/${lg.id}/groups/auto`, { category: 'NOVICE' });
  assert.strictEqual(auto.status, 201, auto.text);
  assert.strictEqual(auto.json.saved, 9);
  const sizes = (await call('GET', `/api/seasons/${lg.id}`)).json.groups.map((g) => g.members.length).sort();
  assert.deepStrictEqual(sizes, [4, 5], 'equal groups, one player less in one');
  const page = (await call('GET', `/api/seasons/by-slug/${lg.slug}`, undefined, { admin: false })).json;
  assert.deepStrictEqual(page.liveDraws, [], 'an instant division is not a draw to replay');
  assert.strictEqual((await call('POST', `/api/seasons/${lg.id}/groups/auto`, { category: 'NOVICE' })).status, 400, 'nobody left to divide');
  const cleared = await call('POST', `/api/seasons/${lg.id}/groups/clear`, { category: 'NOVICE' });
  assert.strictEqual(cleared.status, 200, cleared.text);
  assert.strictEqual(cleared.json.removed, 9);
  assert.strictEqual((await call('POST', `/api/seasons/${lg.id}/groups/auto`, { category: 'NOVICE' })).status, 201, 'and again');
  const admin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'seasons-admin.js'), 'utf8');
  assert.ok(admin.includes("['assign', tl('Zaradenie do kategórií'") && admin.includes("data-act=\"create-groups\"") && admin.includes("data-act=\"auto\""), 'the tab and the steps');
  void regs;
});

test('the admin registers a player that is not in the list, typed as text: asks first, makes the profile with the phone, the player can log in; a repeat is refused', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Liga Text', kind: 'LEAGUE', startDate: '2099-03-01', endDate: '2099-06-01' });
  const lg = made.json;
  const url = `/api/seasons/${lg.id}/registrations/admin`;
  assert.strictEqual((await call('POST', url, { category: 'ELITE' })).status, 400, 'nothing chosen, nothing typed');
  const ask = await call('POST', url, { name: 'Zbyňo Nováčik', category: 'ELITE' });
  assert.strictEqual(ask.status, 409, ask.text);
  assert.strictEqual(ask.json.code, 'UNKNOWN_PLAYER');
  const phone = '0907123987';
  const ok = await call('POST', url, { name: 'Zbyňo Nováčik', confirmNew: true, category: 'ELITE', phone, email: 'zbyno@example.com' });
  assert.strictEqual(ok.status, 201, ok.text);
  assert.strictEqual(ok.json.newPlayer, true);
  assert.strictEqual(ok.json.loginReady, true);
  const players = (await call('GET', '/api/players')).json;
  const mine = players.find((p) => p.name === 'Zbyňo Nováčik');
  assert.ok(mine, 'the profile was made');
  assert.strictEqual((await call('POST', url, { name: 'Zbyňo Nováčik', category: 'ELITE' })).status, 409, 'the same player twice');
  const login = await call('POST', '/api/player/login', { code: phone }, { admin: false });
  assert.ok(login.status === 200 || login.json.pinSetupRequired || login.json.pinRequired, `the phone finds the player: ${login.status} ${login.text}`);
  // a number somebody has already is not given to the new profile (the registration is made, the profile has no phone)
  const other = await call('POST', url, { name: 'Ďalší Nováčik', confirmNew: true, category: 'ELITE', phone });
  assert.strictEqual(other.status, 201, other.text);
  assert.strictEqual(other.json.loginReady, false);
});

test('the page of the season has the saved draw (tile) and the record can be replayed', async () => {
  const page = (await call('GET', `/api/seasons/by-slug/${league.slug}`, undefined, { admin: false })).json;
  assert.strictEqual(page.liveDraws.length, 1);
  const rec = await call('GET', `/api/draw-records/${page.liveDraws[0].id}`, undefined, { admin: false });
  assert.strictEqual(rec.status, 200);
  assert.strictEqual(rec.json.format, 'SEASON_GROUPS');
  assert.strictEqual((await DrawVerify.verifyRecord(rec.json)).ok, true);
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'draw-live.js'), 'utf8');
  assert.ok(js.includes('GROUPS_MODE') && js.includes('/groups/live/'), 'the page knows the draw into groups');
  const admin = fs.readFileSync(path.join(ROOT, 'public', 'js', 'seasons-admin.js'), 'utf8');
  assert.ok(admin.includes('wireLiveGroups') && admin.includes('mode=groups'), 'the button in the tab Skupiny');
});

test('the draw panel of the organiser has the button and the record link; the page scripts exist', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'season-draw.js'), 'utf8');
  assert.ok(js.includes('data-act="live"') && js.includes("act === 'live'") && js.includes('/draw-live?season='), 'the button');
  assert.ok(js.includes('/draw-live?record='), 'the record link');
  const page = fs.readFileSync(path.join(ROOT, 'public', 'js', 'draw-live.js'), 'utf8');
  for (const piece of ['/draw/live/', 'drawPath', '/draw-records/', 'DrawVerify.verifyRecord', 'requestFullscreen', 'countdown', 'dl-hot', 'dl-fly', 'buildTree', 'drawTree', 'advanceIfBye']) assert.ok(page.includes(piece), piece);
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'draw-live.css'), 'utf8');
  for (const piece of ['.dl-pool-item', '.dl-slot', '.dl-count-num', '.dl-final', '.dl-tree', '.dl-mbox', '.dl-tree-svg']) assert.ok(css.includes(piece), piece);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
