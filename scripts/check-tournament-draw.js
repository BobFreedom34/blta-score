// Checks of a tournament's draw: courts, seeds, the main bracket and its consolation bracket ("útecha") — byes only where the draw
// cannot be filled, round-1 losers drop into the consolation draw, round-2 losers are out, the formats of both draws.
// Run: node scripts/check-tournament-draw.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdraw-'));
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
  return { status: res.status, json, text };
}

let tournament;
let counter = 0;
const people = {}; // category -> [{ player, reg }]

// registers `count` players in a category of the tournament
async function registerPlayers(category, count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const made = await call('POST', '/api/players', { name: `${category} Player ${counter}` });
    assert.strictEqual(made.status, 201, made.text);
    const reg = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { playerId: made.json.id, category, phone: `0903${String(100000 + counter)}`, email: `p${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    list.push({ player: made.json, reg: reg.json });
  }
  people[category] = list;
  return list;
}

const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`)).json;
const byRound = (bracket, round) => bracket.nodes.filter((n) => n.round === round).sort((a, b) => a.position - b.position);
// finishes a node by recording the winner (the match of it, if any, is finished through its own manual result)
async function decide(bracketId, node, winnerId) {
  if (node.match) {
    const sets = node.match && /4/.test(String(node.match.scoreSummary || '')) ? null : null;
    const bracket = await bracketOf(bracketId);
    const format = bracket.format;
    const p1Wins = winnerId === node.player1.id;
    const won = format === 'BO3_G4_STB' ? { p1: 4, p2: 1 } : { p1: 6, p2: 2 };
    const lost = format === 'BO3_G4_STB' ? { p1: 1, p2: 4 } : { p1: 2, p2: 6 };
    const setFor = (w) => (p1Wins === w ? won : { p1: won.p2, p2: won.p1 });
    void sets; void lost;
    const body = { sets: [setFor(true), setFor(true)], location: 'Court 1', scheduledAt: '2026-09-20T10:00:00.000Z' };
    const r = await call('POST', `/api/matches/${node.match.token}/manual-result`, body);
    assert.strictEqual(r.status, 200, r.text);
  } else {
    const r = await call('PATCH', `/api/brackets/${bracketId}/nodes/${node.id}/result`, { winnerId });
    assert.strictEqual(r.status, 200, r.text);
  }
}

test('setup: a tournament with a number of courts', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Draw Open 2026', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03' });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  assert.strictEqual(tournament.courtCount, 0);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 4 })).json.courtCount, 4);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { courtCount: -1 })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 'x' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { name: 'Draw Open 2026' })).json.courtCount, 4, 'courts stay when not sent');
});

test('seeds: only whole numbers, each once, and only for players of that category; gaps are closed', async () => {
  const elite = await registerPlayers('ELITE', 12);
  const ids = elite.map((e) => e.reg.id);
  const bad = async (seeds) => (await call('POST', `/api/seasons/${tournament.id}/seeds`, { category: 'ELITE', seeds })).status;
  assert.strictEqual(await bad([{ id: ids[0], seed: 1 }, { id: ids[1], seed: 1 }]), 400);
  assert.strictEqual(await bad([{ id: ids[0], seed: 0 }]), 400);
  assert.strictEqual(await bad([{ id: ids[0], seed: 99 }]), 400);
  assert.strictEqual(await bad([{ id: 999999, seed: 1 }]), 400);
  const r = await call('POST', `/api/seasons/${tournament.id}/seeds`, { category: 'ELITE', seeds: [{ id: ids[2], seed: 1 }, { id: ids[5], seed: 2 }, { id: ids[7], seed: 4 }, { id: ids[3], seed: 3 }] });
  assert.strictEqual(r.status, 200, r.text);
  const seeds = r.json.filter((x) => x.seed).map((x) => [x.id, x.seed]).sort((a, b) => a[1] - b[1]);
  assert.deepStrictEqual(seeds, [[ids[2], 1], [ids[5], 2], [ids[3], 3], [ids[7], 4]]);
  const gap = await call('POST', `/api/seasons/${tournament.id}/seeds`, { category: 'ELITE', seeds: [{ id: ids[2], seed: 1 }, { id: ids[5], seed: 3 }] });
  assert.deepStrictEqual(gap.json.filter((x) => x.seed).map((x) => x.seed).sort(), [1, 2]);
  await call('POST', `/api/seasons/${tournament.id}/seeds`, { category: 'ELITE', seeds: [{ id: ids[2], seed: 1 }, { id: ids[5], seed: 2 }, { id: ids[3], seed: 3 }, { id: ids[7], seed: 4 }] });
  assert.strictEqual((await call('POST', `/api/seasons/${tournament.id}/seeds`, { category: 'ELITE', seeds: [] }, { admin: false })).status, 401);
});

test('overview: 12 players make a draw of 16 with 4 byes', async () => {
  const r = await call('GET', `/api/seasons/${tournament.id}/draw`);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.courtCount, 4);
  const elite = r.json.categories.find((c) => c.category === 'ELITE');
  assert.deepStrictEqual([elite.players, elite.seeded, elite.size, elite.byes, elite.main], [12, 4, 16, 4, null]);
});

test('automatic draw: the 4 seeded players skip round 1, the others play it; losers of round 1 go to a consolation draw of 4', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'ELITE', mode: 'AUTO', mainFormat: 'BO3_STB', consolationFormat: 'BO3_G4_STB' });
  assert.strictEqual(r.status, 201, r.text);
  assert.deepStrictEqual(r.json.warnings, []);
  const main = await bracketOf(r.json.main);
  const consolation = await bracketOf(r.json.consolation);
  assert.strictEqual(main.size, 16);
  assert.strictEqual(main.kind, 'MAIN');
  assert.strictEqual(consolation.kind, 'CONSOLATION');
  assert.strictEqual(consolation.parentBracketId, main.id);
  assert.strictEqual(consolation.size, 4);
  assert.strictEqual(main.format, 'BO3_STB');
  assert.strictEqual(consolation.format, 'BO3_G4_STB');
  assert.strictEqual(main.category, 'ELITE');
  assert.strictEqual(main.season.id, tournament.id);
  const round1 = byRound(main, 1);
  const byeNodes = round1.filter((n) => n.isBye);
  assert.strictEqual(byeNodes.length, 4);
  const byePlayers = byeNodes.map((n) => (n.player1 || n.player2).id).sort((a, b) => a - b);
  const seeded = [2, 5, 3, 7].map((i) => people.ELITE[i].player.id).concat(people.ELITE[2].player.id).slice(0, 4);
  assert.deepStrictEqual(byePlayers, [people.ELITE[2], people.ELITE[5], people.ELITE[3], people.ELITE[7]].map((x) => x.player.id).sort((a, b) => a - b), 'the byes are the seeded players');
  void seeded;
  // 8 players play round 1: 4 real matches; the 4 seeds sit in round 2
  assert.strictEqual(round1.filter((n) => n.match).length, 4);
  assert.ok(main.nodes.filter((n) => n.match).every((n) => n.match.status === 'PLANNED'));
  // seeds 1 and 2 are in different halves
  const half = (id) => { const n = byRound(main, 2).findIndex((x) => [x.player1, x.player2].some((p) => p && p.id === id)); return n < 2 ? 0 : 1; };
  assert.notStrictEqual(half(people.ELITE[2].player.id), half(people.ELITE[5].player.id));
  // nobody twice
  const all = round1.flatMap((n) => [n.player1, n.player2]).filter(Boolean).map((p) => p.id);
  assert.strictEqual(new Set(all).size, 12);
  tournament.eliteMain = main.id;
  tournament.eliteCons = consolation.id;
});

test('a second draw of the same category is refused', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'ELITE', mode: 'AUTO' });
  assert.strictEqual(r.status, 409);
});

test('the loser of a round-1 match drops into the consolation draw; the winner moves on', async () => {
  const main = await bracketOf(tournament.eliteMain);
  const node = byRound(main, 1).find((n) => n.match);
  await decide(main.id, node, node.player1.id);
  const cons = await bracketOf(tournament.eliteCons);
  const placed = byRound(cons, 1).flatMap((n) => [n.player1, n.player2]).filter(Boolean).map((p) => p.id);
  assert.deepStrictEqual(placed, [node.player2.id]);
  const after = await bracketOf(main.id);
  assert.ok(byRound(after, 2).some((n) => [n.player1, n.player2].some((p) => p && p.id === node.player1.id)));
});

test('the rest of round 1 fills the consolation draw: 4 players, 2 matches in the 4-games format', async () => {
  const main = await bracketOf(tournament.eliteMain);
  const open = byRound(main, 1).filter((n) => n.match && n.match.status !== 'FINISHED');
  assert.strictEqual(open.length, 3);
  for (const n of open) await decide(main.id, n, n.player2.id);
  const cons = await bracketOf(tournament.eliteCons);
  const round1 = byRound(cons, 1);
  assert.strictEqual(round1.filter((n) => n.match).length, 2);
  const losers = byRound(main, 1).filter((n) => n.match).map((n) => (n.winnerId === n.player1.id ? n.player2.id : n.player1.id)).sort((a, b) => a - b);
  const seated = round1.flatMap((n) => [n.player1.id, n.player2.id]).sort((a, b) => a - b);
  assert.deepStrictEqual(seated, losers);
  const real = await call('GET', `/api/matches/${round1[0].match.token}`);
  assert.strictEqual(real.json.format, 'BO3_G4_STB');
  assert.strictEqual(real.json.category, 'ELITE');
});

test('a consolation match is played in the 4-games format; its winner reaches the consolation final', async () => {
  const cons = await bracketOf(tournament.eliteCons);
  const first = byRound(cons, 1)[0];
  await decide(cons.id, first, first.player1.id);
  const after = await bracketOf(cons.id);
  const final = byRound(after, 2)[0];
  assert.strictEqual(final.player1.id, first.player1.id);
  assert.ok(!final.player2);
});

test('a player who loses in round 2 is out: nobody drops anywhere', async () => {
  const main = await bracketOf(tournament.eliteMain);
  const r2 = byRound(main, 2).find((n) => n.match);
  assert.ok(r2, 'a round-2 match exists');
  const before = JSON.stringify(byRound(await bracketOf(tournament.eliteCons), 1).map((n) => [n.player1 && n.player1.id, n.player2 && n.player2.id]));
  await decide(main.id, r2, r2.player1.id);
  const cons = await bracketOf(tournament.eliteCons);
  assert.strictEqual(JSON.stringify(byRound(cons, 1).map((n) => [n.player1 && n.player1.id, n.player2 && n.player2.id])), before);
  const consPlayers = cons.nodes.flatMap((n) => [n.player1, n.player2]).filter(Boolean).map((p) => p.id);
  assert.ok(!consPlayers.includes(r2.player2.id));
});

test('a small category: 6 players make a draw of 8 with 2 byes and a consolation final for the two round-1 losers; warnings say who skips round 1 unseeded', async () => {
  await registerPlayers('NOVICE', 6);
  const r = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'NOVICE', mode: 'AUTO' });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.warnings.length, 1);
  const main = await bracketOf(r.json.main);
  const cons = await bracketOf(r.json.consolation);
  assert.strictEqual(main.size, 8);
  assert.strictEqual(main.format, 'BO3_STB');
  assert.strictEqual(cons.size, 2);
  assert.strictEqual(cons.format, 'BO3_G4_STB', 'the consolation default is the 4-games format');
  assert.strictEqual(byRound(main, 1).filter((n) => n.isBye).length, 2);
});

test('a category of 3 players has no consolation draw (one round-1 match only), but still gets a main draw', async () => {
  await registerPlayers('NEXT_GEN', 3);
  const r = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'NEXT_GEN', mode: 'AUTO' });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.consolation, null);
  assert.ok(r.json.consolationNote);
});

test('refusals: not a tournament, no category, too few players, a player without a profile', async () => {
  const league = (await call('POST', '/api/seasons', { name: 'League', kind: 'LEAGUE' })).json;
  assert.strictEqual((await call('POST', `/api/seasons/${league.id}/draw`, { category: 'ELITE' })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${tournament.id}/draw`, {})).status, 400);
  const other = (await call('POST', '/api/seasons', { name: 'Tiny Open', kind: 'TOURNAMENT' })).json;
  assert.strictEqual((await call('POST', `/api/seasons/${other.id}/draw`, { category: 'ELITE' })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'ELITE' }, { admin: false })).status, 401);
});

test('a manual draw: an empty main bracket, the organiser seats round 1, then makes the consolation draw', async () => {
  const t2 = (await call('POST', '/api/seasons', { name: 'Manual Open', kind: 'TOURNAMENT' })).json;
  const players = [];
  for (let i = 0; i < 4; i += 1) {
    counter += 1;
    const p = (await call('POST', '/api/players', { name: `Manual Player ${counter}` })).json;
    const reg = await call('POST', `/api/seasons/${t2.id}/registrations/admin`, { playerId: p.id, category: 'ELITE', phone: `0904${String(100000 + counter)}`, email: `m${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    players.push(p);
  }
  const r = await call('POST', `/api/seasons/${t2.id}/draw`, { category: 'ELITE', mode: 'MANUAL', mainFormat: 'BO3' });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.consolation, null);
  const main = await bracketOf(r.json.main);
  assert.strictEqual(main.size, 4);
  assert.ok(main.nodes.every((n) => !n.player1 && !n.player2));
  // not seated yet: the consolation draw cannot be made
  const early = await call('POST', `/api/brackets/${main.id}/consolation`, {});
  assert.strictEqual(early.status, 400);
  const [n1, n2] = byRound(main, 1);
  await call('PATCH', `/api/brackets/${main.id}/slots/${n1.id}`, { player1Id: players[0].id, player2Id: players[1].id });
  await call('PATCH', `/api/brackets/${main.id}/slots/${n2.id}`, { player1Id: players[2].id, player2Id: players[3].id });
  const overview = (await call('GET', `/api/seasons/${t2.id}/draw`)).json.categories.find((c) => c.category === 'ELITE');
  assert.strictEqual(overview.canMakeConsolation, true);
  // a round-1 match decided BEFORE the consolation draw exists: its loser is dropped in as soon as it is made
  const seated = await bracketOf(main.id);
  await decide(main.id, byRound(seated, 1)[0], players[0].id);
  const made = await call('POST', `/api/brackets/${main.id}/consolation`, { format: 'BO3_G4_STB' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.size, 2);
  assert.strictEqual(made.json.kind, 'CONSOLATION');
  assert.deepStrictEqual(byRound(made.json, 1)[0].player1 && byRound(made.json, 1)[0].player1.id, players[1].id);
  assert.strictEqual((await call('POST', `/api/brackets/${main.id}/consolation`, {})).status, 400, 'only one consolation draw');
  const finish = await bracketOf(main.id);
  await decide(main.id, byRound(finish, 1)[1], players[3].id);
  const cons = await bracketOf(made.json.id);
  const node = byRound(cons, 1)[0];
  assert.deepStrictEqual([node.player1.id, node.player2.id].sort(), [players[1].id, players[2].id].sort());
  assert.ok(node.match);
});

test('deleting a draw: allowed while every match is still planned (the planned matches go too), refused once one was played', async () => {
  const played = await call('DELETE', `/api/seasons/${tournament.id}/draw/ELITE`);
  assert.strictEqual(played.status, 409);
  const planned = await call('DELETE', `/api/seasons/${tournament.id}/draw/NOVICE`);
  assert.strictEqual(planned.status, 200, planned.text);
  const novice = planned.json.categories.find((c) => c.category === 'NOVICE');
  assert.strictEqual(novice.main, null);
  assert.strictEqual(novice.consolation, null);
  assert.strictEqual((await call('DELETE', `/api/seasons/${tournament.id}/draw/NOVICE`)).status, 404);
  const again = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'NOVICE', mode: 'AUTO' });
  assert.strictEqual(again.status, 201, again.text);
});

test('moving a player to another category drops their seed', async () => {
  const regs = (await call('GET', `/api/seasons/${tournament.id}/registrations`)).json;
  const seeded = regs.find((r) => r.category === 'ELITE' && r.seed);
  assert.ok(seeded);
  const moved = await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, { assignments: [{ id: seeded.id, category: 'NOVICE' }] });
  assert.strictEqual(moved.json.find((r) => r.id === seeded.id).seed, null);
});

test('deleting a tournament with its matches: the matches (played and planned), brackets and registrations all go; a league season cannot be deleted this way', async () => {
  const league = (await call('POST', '/api/seasons', { name: 'League Keep', kind: 'LEAGUE' })).json;
  assert.strictEqual((await call('DELETE', `/api/seasons/${league.id}?withMatches=1`)).status, 400);
  assert.strictEqual((await call('GET', `/api/seasons/${league.id}/brackets`)).status, 200, 'the league season is still there');
  const brackets = (await call('GET', `/api/seasons/${tournament.id}/brackets`)).json;
  assert.ok(brackets.length >= 3);
  const tokens = [];
  for (const b of brackets) {
    const full = await bracketOf(b.id);
    full.nodes.filter((n) => n.match).forEach((n) => tokens.push(n.match.token));
  }
  assert.ok(tokens.length >= 5, 'planned and finished matches exist');
  assert.strictEqual((await call('DELETE', `/api/seasons/${tournament.id}?withMatches=1`, undefined, { admin: false })).status, 401);
  const gone = await call('DELETE', `/api/seasons/${tournament.id}?withMatches=1`);
  assert.strictEqual(gone.status, 200, gone.text);
  assert.ok(gone.json.deletedMatches >= tokens.length);
  for (const token of tokens) assert.strictEqual((await call('GET', `/api/matches/${token}`)).status, 404, 'the match is gone');
  for (const b of brackets) assert.strictEqual((await call('GET', `/api/brackets/${b.id}`)).status, 404, 'the bracket is gone');
  assert.strictEqual((await call('GET', `/api/seasons/${tournament.id}/registrations`)).json.length, 0);
  assert.strictEqual((await call('GET', `/api/seasons/${tournament.id}/draw`)).status, 404);
});

test('a result entered by hand can be reset: the winner leaves the next round; results that depend on it need a cascade; the loser leaves the consolation bracket', async () => {
  const ps = [];
  for (let i = 0; i < 4; i += 1) ps.push((await call('POST', '/api/players', { name: `Reset Player ${i + 1}` })).json);
  const made = await call('POST', '/api/brackets', { name: 'Old Cup', format: 'BO3', autoCreateMatches: false, entries: ps.map((p, i) => ({ playerId: p.id, seed: i + 1 })) });
  assert.strictEqual(made.status, 201, made.text);
  const id = made.json.id;
  const node = async (round, position) => (await bracketOf(id)).nodes.find((n) => n.round === round && n.position === position);
  const record = async (n, winnerId) => assert.strictEqual((await call('PATCH', `/api/brackets/${id}/nodes/${n.id}/result`, { winnerId, score: '6-0, 6-0' })).status, 200);
  await record(await node(1, 0), ps[0].id); // seed 1 beats seed 4
  await record(await node(1, 1), ps[1].id); // seed 2 beats seed 3
  await record(await node(2, 0), ps[0].id); // the final
  const reset = (n, cascade) => call('DELETE', `/api/brackets/${id}/nodes/${n.id}/result${cascade ? '?cascade=1' : ''}`);
  assert.strictEqual((await reset(await node(1, 0))).status, 409, 'the winner already played on');
  assert.strictEqual((await reset(await node(1, 0))).json.dependents, 1);
  assert.strictEqual((await node(2, 0)).winnerId, ps[0].id, 'a refused reset changes nothing');
  // the final: just its own result
  const finalReset = await reset(await node(2, 0));
  assert.strictEqual(finalReset.status, 200, finalReset.text);
  assert.ok(!(await node(2, 0)).winnerId);
  assert.ok((await node(2, 0)).player1 && (await node(2, 0)).player2, 'both finalists are still there');
  // a semifinal: its winner leaves the final
  const semi = await reset(await node(1, 0));
  assert.strictEqual(semi.status, 200, semi.text);
  assert.ok(!(await node(1, 0)).winnerId);
  assert.ok(!(await node(2, 0)).player1, 'the winner is out of the final again');
  assert.ok((await node(2, 0)).player2, 'the other finalist stays');
  // the result can be entered again, and a result that does not exist cannot be reset
  await record(await node(1, 0), ps[3].id);
  assert.strictEqual((await node(2, 0)).player1.id, ps[3].id);
  assert.strictEqual((await reset(await node(2, 0))).status, 400, 'no result there');
  assert.strictEqual((await call('DELETE', `/api/brackets/${id}/nodes/${(await node(1, 0)).id}/result`, undefined, { admin: false })).status, 401);
  // cascade: the semifinal and the final both go
  await record(await node(2, 0), ps[3].id);
  const all = await reset(await node(1, 0), true);
  assert.strictEqual(all.status, 200, all.text);
  assert.ok(!(await node(1, 0)).winnerId && !(await node(2, 0)).winnerId && !(await node(2, 0)).player1);
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
