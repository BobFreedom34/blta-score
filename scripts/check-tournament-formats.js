// Checks of the formats of a tournament category: MONRAD (a losers bracket for the losers of every round, each again a Monrad), GROUPS
// (round robin) and GROUPS_BRACKET (groups, then a bracket of the best of every group), made automatically or by hand.
// Run: node scripts/check-tournament-formats.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tformats-'));
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

let counter = 0;
async function newTournament(name) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-07-01', endDate: '2099-07-03' });
  assert.strictEqual(made.status, 201, made.text);
  return made.json;
}
async function register(season, category, count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = (await call('POST', '/api/players', { name: `${category} Fmt ${counter}` })).json;
    const reg = await call('POST', `/api/seasons/${season.id}/registrations/admin`, { playerId: p.id, category, phone: `0908${String(100000 + counter)}`, email: `f${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    list.push({ player: p, reg: reg.json });
  }
  return list;
}
const draw = (season, body) => call('POST', `/api/seasons/${season.id}/draw`, body);
const overview = async (season, category) => (await call('GET', `/api/seasons/${season.id}/draw`)).json.categories.find((c) => c.category === category);
const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`)).json;

// plays out a match with the higher player id winning (the winner as a manual result)
async function playMatch(token, winnerId, format) {
  const m = (await call('GET', `/api/matches/${token}`)).json;
  const p1Wins = m.player1.id === winnerId;
  const g4 = format === 'BO3_G4_STB';
  const win = g4 ? { p1: 4, p2: 1 } : { p1: 6, p2: 2 };
  const set = p1Wins ? win : { p1: win.p2, p2: win.p1 };
  const r = await call('POST', `/api/matches/${token}/manual-result`, { sets: [set, set], location: 'Kurt 1', scheduledAt: m.scheduledAt || '2099-07-01T10:00:00.000Z' });
  assert.strictEqual(r.status, 200, r.text);
}

// plays every open bracket match of the tournament until none is left; returns how many matches were played
async function playAllBrackets(season, mainId) {
  let played = 0;
  for (let guard = 0; guard < 60; guard += 1) {
    const ids = [mainId];
    const all = (await call('GET', `/api/seasons/${season.id}/brackets`)).json;
    all.forEach((b) => { if (b.id !== mainId) ids.push(b.id); });
    let open = 0;
    for (const id of ids) {
      const b = await bracketOf(id);
      for (const n of b.nodes) {
        if (n.match && n.match.status === 'PLANNED' && n.player1 && n.player2) {
          await playMatch(n.match.token, Math.max(n.player1.id, n.player2.id), b.format);
          played += 1; open += 1;
        }
      }
    }
    if (!open) break;
  }
  return played;
}

let t1;
let monrad;

test('MONRAD with 16 players: a main bracket of 16 and 7 losers brackets (8, 4, 2 for the rounds, and inside them again)', async () => {
  t1 = await newTournament('Format Open');
  await register(t1, 'ELITE', 16);
  const made = await draw(t1, { category: 'ELITE', format: 'MONRAD', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  const brackets = (await call('GET', `/api/seasons/${t1.id}/brackets`)).json.filter((b) => b.category === 'ELITE');
  assert.strictEqual(brackets.length, 8);
  const sizes = [];
  for (const b of brackets) sizes.push((await bracketOf(b.id)).size);
  assert.deepStrictEqual(sizes.sort((a, b) => a - b), [2, 2, 2, 2, 4, 4, 8, 16]);
  monrad = made.json.main;
  const main = await bracketOf(monrad);
  assert.strictEqual(main.kind, 'MAIN');
  const children = brackets.filter((b) => b.parentBracketId === monrad);
  assert.strictEqual(children.length, 3, 'one losers bracket for round 1, 2 and 3');
  // the losers brackets are named by the places they play for (not by the round they are fed from): the losers of round 2 fight for 5th–8th, of round 3 for 3rd–4th, of
  // round 1 for 9th–16th, and inside that one again for 13th–16th, 11th–12th, 15th–16th …
  const places = brackets.filter((b) => b.kind !== 'MAIN').map((b) => b.name.split(' — ').pop()).sort();
  assert.deepStrictEqual(places, ['O 11. miesto', 'O 13. – 16. miesto', 'O 15. miesto', 'O 3. miesto', 'O 5. – 8. miesto', 'O 7. miesto', 'O 9. – 16. miesto']);
  assert.ok(brackets.every((b) => !/Útecha po|› po/.test(b.name)), 'no name says "Útecha po 1. kole" any more');
  // the order of the list: the main bracket first, then by the best place they play for, from the highest to the lowest
  assert.strictEqual(brackets[0].kind, 'MAIN');
  assert.deepStrictEqual(brackets.slice(1).map((b) => b.name.split(' — ').pop()), ['O 3. miesto', 'O 5. – 8. miesto', 'O 7. miesto', 'O 9. – 16. miesto', 'O 11. miesto', 'O 13. – 16. miesto', 'O 15. miesto']);
  const ov = await overview(t1, 'ELITE');
  assert.strictEqual(ov.settings.format, 'MONRAD');
  assert.strictEqual(ov.brackets.length, 8);
});

test('MONRAD: losers brackets made before (named "Útecha po 1. kole", "Útecha po 1. kole › po 1. kole") are renamed by the places they play for, from the structure alone', () => {
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const rows = () => sql.prepare("SELECT id, name, parent_bracket_id AS parent, feeds_round AS round FROM brackets WHERE kind = 'CONSOLATION' AND season_id = ? ORDER BY id").all(t1.id);
  const expected = rows().map((r) => [r.id, r.name]);
  assert.strictEqual(expected.length, 7);
  // the old way of naming: by the round that feeds the bracket (and the parent's name in front for the deeper ones)
  const prefix = expected[0][1].split(' — ').slice(0, -1).join(' — ');
  const named = new Map();
  rows().forEach((r) => named.set(r.id, r.parent && named.has(r.parent) ? `${named.get(r.parent)} › po ${r.round}. kole` : `${prefix} — Útecha po ${r.round}. kole`));
  named.forEach((name, id) => sql.prepare('UPDATE brackets SET name = ? WHERE id = ?').run(name, id));
  assert.ok(rows().every((r) => /Útecha po|› po/.test(r.name)));
  process.env.DATA_DIR = dir; // (the engine opens the database of this run, not the real one)
  const renamed = require('../src/monradNames').run(sql);
  assert.strictEqual(renamed, 7);
  assert.deepStrictEqual(rows().map((r) => [r.id, r.name]), expected, 'the same names as a draw made now gives');
  assert.strictEqual(require('../src/monradNames').run(sql), 0, 'a second run changes nothing');
  sql.close();
});

test('MONRAD played through: 32 matches in all (everybody keeps playing), every bracket decided', async () => {
  const played = await playAllBrackets(t1, monrad);
  assert.strictEqual(played, 32);
  const all = (await call('GET', `/api/seasons/${t1.id}/brackets`)).json;
  for (const b of all) {
    const full = await bracketOf(b.id);
    assert.ok(full.nodes.every((n) => n.isBye || !n.player1 || !n.player2 || (n.match && n.match.status === 'FINISHED')), 'no open match left');
  }
  // the final of the main bracket has a winner
  const main = await bracketOf(monrad);
  const final = main.nodes.find((n) => n.round === 4);
  assert.ok(final.winnerId);
});

test('PRINCE still has exactly one losers bracket (round 1 only); ELIMINATION has none', async () => {
  const t = await newTournament('Prince Open');
  await register(t, 'ELITE', 8);
  await register(t, 'NOVICE', 8);
  const prince = await draw(t, { category: 'ELITE', format: 'PRINCE' });
  assert.strictEqual(prince.status, 201, prince.text);
  const elim = await draw(t, { category: 'NOVICE', format: 'ELIMINATION' });
  assert.strictEqual(elim.status, 201, elim.text);
  assert.ok(elim.json.consolation === null);
  const all = (await call('GET', `/api/seasons/${t.id}/brackets`)).json;
  assert.strictEqual(all.filter((b) => b.category === 'ELITE').length, 2);
  assert.strictEqual(all.filter((b) => b.category === 'NOVICE').length, 1);
});

let t2;
let groupsCat;

test('GROUPS: 8 players in groups of 4 → two groups, 6 matches each, the seeds in different groups; standings and the draw overview show them', async () => {
  t2 = await newTournament('Groups Open');
  const players = await register(t2, 'NEXT_GEN', 8);
  await call('POST', `/api/seasons/${t2.id}/seeds`, { category: 'NEXT_GEN', seeds: [{ id: players[0].reg.id, seed: 1 }, { id: players[1].reg.id, seed: 2 }] });
  const made = await draw(t2, { category: 'NEXT_GEN', format: 'GROUPS', groupSize: 4, groupFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.groups.length, 2);
  assert.strictEqual(made.json.matches, 12);
  assert.ok(made.json.groups.every((g) => g.playerIds.length === 4 && g.matches === 6));
  const groupOf = (p) => made.json.groups.findIndex((g) => g.playerIds.includes(p.player.id));
  assert.notStrictEqual(groupOf(players[0]), groupOf(players[1]), 'seeds 1 and 2 are in different groups');
  const ov = await overview(t2, 'NEXT_GEN');
  assert.strictEqual(ov.stage, 'GROUPS');
  assert.strictEqual(ov.groups.matches, 12);
  assert.strictEqual(ov.groups.allFinished, false);
  assert.strictEqual(ov.canMakeBracket, false);
  const st = (await call('GET', `/api/seasons/${t2.id}/standings`, undefined, { admin: false })).json;
  assert.deepStrictEqual(st.groups.map((g) => g.name), ['Next Gen — Skupina A', 'Next Gen — Skupina B']);
  assert.ok(st.groups.every((g) => g.category === 'NEXT_GEN' && g.rows.length === 4));
  groupsCat = made.json.groups;
  // the group matches are ordinary tournament matches (format of the groups, category, group)
  const ms = (await call('GET', `/api/matches?seasonId=${t2.id}`)).json;
  assert.strictEqual(ms.length, 12);
  assert.ok(ms.every((m) => m.category === 'NEXT_GEN' && m.format === 'BO3' && m.group && m.stage === 'GROUP'));
});

test('GROUPS: a second draw of the category is refused; with all matches played the groups are finished', async () => {
  assert.strictEqual((await draw(t2, { category: 'NEXT_GEN', format: 'GROUPS' })).status, 409);
  const ms = (await call('GET', `/api/matches?seasonId=${t2.id}`)).json;
  for (const m of ms) await playMatch(m.token, Math.max(m.player1.id, m.player2.id), 'BO3');
  const ov = await overview(t2, 'NEXT_GEN');
  assert.strictEqual(ov.groups.allFinished, true);
  assert.strictEqual(ov.canMakeBracket, false, 'plain groups have no bracket');
  assert.ok(groupsCat.length === 2);
});

test('two categories of one tournament can both have groups (the names carry the category)', async () => {
  await register(t2, 'ELITE', 4);
  const made = await draw(t2, { category: 'ELITE', format: 'GROUPS', groupSize: 2, groupFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  assert.deepStrictEqual(made.json.groups.map((g) => g.name), ['Elite — Skupina A', 'Elite — Skupina B']);
  const st = (await call('GET', `/api/seasons/${t2.id}/standings`, undefined, { admin: false })).json;
  assert.strictEqual(st.groups.length, 4);
});

let t3;
let gb;

test('GROUPS_BRACKET (automatic): 12 players, 3 groups of 4, the best 2 of each go on → a bracket of 8 made by itself when the last group match is played', async () => {
  t3 = await newTournament('Groups Bracket Open');
  await register(t3, 'ELITE', 12);
  const made = await draw(t3, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 4, qualifiers: 2, bracketType: 'PRINCE', groupFormat: 'BO3', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.groups.length, 3);
  let ov = await overview(t3, 'ELITE');
  assert.strictEqual(ov.canMakeBracket, true);
  assert.strictEqual(ov.main, null);
  // the bracket cannot be made before the groups are played (unless forced) …
  const early = await call('POST', `/api/seasons/${t3.id}/draw/bracket`, { category: 'ELITE', mode: 'AUTO' });
  assert.strictEqual(early.status, 409);
  assert.strictEqual(early.json.code, 'GROUPS_NOT_FINISHED');
  // … but plays itself out: every group match played, the bracket appears
  const ms = (await call('GET', `/api/matches?seasonId=${t3.id}`)).json;
  assert.strictEqual(ms.length, 18);
  for (const m of ms) await playMatch(m.token, Math.max(m.player1.id, m.player2.id), 'BO3');
  ov = await overview(t3, 'ELITE');
  assert.ok(ov.main, 'the bracket was made by itself');
  assert.strictEqual(ov.main.size, 8);
  gb = ov.main.id;
  assert.ok(ov.consolation, 'PRINCE: a consolation bracket for the round-1 losers (2 matches in round 1 of a bracket of 8 with 6 players)');
});

test('GROUPS_BRACKET: the bracket holds the 6 qualifiers, the group winners have the byes, nobody meets a player of their own group in round 1', async () => {
  const main = await bracketOf(gb);
  const round1 = main.nodes.filter((n) => n.round === 1);
  const players = round1.flatMap((n) => [n.player1, n.player2]).filter(Boolean).map((p) => p.id);
  assert.strictEqual(new Set(players).size, 6);
  const byes = round1.filter((n) => n.isBye);
  assert.strictEqual(byes.length, 2);
  // who is a group winner: the highest player id of each group (the higher id always won)
  const st = (await call('GET', `/api/seasons/${t3.id}/standings`, undefined, { admin: false })).json;
  const winners = st.groups.map((g) => g.rows[0].player.id);
  const byePlayers = byes.map((n) => (n.player1 || n.player2).id);
  byePlayers.forEach((id) => assert.ok(winners.includes(id), 'a bye goes to a group winner'));
  const groupOf = new Map();
  st.groups.forEach((g) => g.rows.forEach((r) => groupOf.set(r.player.id, g.id)));
  round1.filter((n) => n.player1 && n.player2).forEach((n) => assert.notStrictEqual(groupOf.get(n.player1.id), groupOf.get(n.player2.id), 'round-1 players are from different groups'));
});

test('GROUPS_BRACKET (by hand): groups put together by the organiser, the bracket made empty (forced before the groups are played) and filled in by hand', async () => {
  const t = await newTournament('Manual Groups Open');
  const players = await register(t, 'NOVICE', 6);
  const regs = players.map((p) => p.reg.id);
  const bad = await draw(t, { category: 'NOVICE', format: 'GROUPS_BRACKET', mode: 'MANUAL', groups: [{ name: 'Skupina A', registrationIds: regs.slice(0, 3) }] });
  assert.strictEqual(bad.status, 400, 'every player must be in a group');
  assert.strictEqual((await draw(t, { category: 'NOVICE', format: 'GROUPS_BRACKET', mode: 'MANUAL', groups: [{ name: 'A', registrationIds: regs.slice(0, 3) }, { name: 'B', registrationIds: [regs[2], ...regs.slice(3)] }] })).status, 400, 'a player in two groups');
  const made = await draw(t, { category: 'NOVICE', format: 'GROUPS_BRACKET', mode: 'MANUAL', qualifiers: 2, bracketType: 'ELIMINATION', groupFormat: 'BO3',
    groups: [{ name: 'Zelená', registrationIds: regs.slice(0, 3) }, { name: 'Modrá', registrationIds: regs.slice(3) }] });
  assert.strictEqual(made.status, 201, made.text);
  assert.deepStrictEqual(made.json.groups.map((g) => g.name), ['Novice — Zelená', 'Novice — Modrá']);
  assert.strictEqual(made.json.matches, 6);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw/bracket`, { category: 'NOVICE', mode: 'MANUAL' })).status, 409);
  const forced = await call('POST', `/api/seasons/${t.id}/draw/bracket`, { category: 'NOVICE', mode: 'MANUAL', force: true });
  assert.strictEqual(forced.status, 201, forced.text);
  const empty = await bracketOf(forced.json.main);
  assert.strictEqual(empty.size, 4);
  assert.ok(empty.nodes.every((n) => !n.player1 && !n.player2), 'the bracket is empty, the organiser seats it');
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw/bracket`, { category: 'NOVICE', mode: 'AUTO', force: true })).status, 409, 'only one bracket');
});

test('GROUPS_BRACKET with the placement matches: 6 players, 2 groups of 3 → after the groups 1st–1st (final), 2nd–2nd (3rd place), 3rd–3rd (5th place), made by itself', async () => {
  const t = await newTournament('Placement Open');
  await register(t, 'ELITE', 6);
  const made = await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 3, bracketType: 'PLACEMENT', groupFormat: 'BO3', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.groups.length, 2);
  let ov = await overview(t, 'ELITE');
  assert.strictEqual(ov.canMakeBracket, true);
  assert.strictEqual(ov.canMakeConsolation, false, 'no consolation after placement matches');
  const early = await call('POST', `/api/seasons/${t.id}/draw/bracket`, { category: 'ELITE', mode: 'AUTO' });
  assert.strictEqual(early.status, 409, 'not before the groups are played');
  // the higher player id always wins its match, so the order in each group is by id
  const ms = (await call('GET', `/api/matches?seasonId=${t.id}`)).json;
  assert.strictEqual(ms.length, 6);
  for (const m of ms) await playMatch(m.token, Math.max(m.player1.id, m.player2.id), 'BO3');
  ov = await overview(t, 'ELITE');
  assert.ok(ov.main, 'the placement matches were made by themselves');
  assert.strictEqual(ov.brackets.length, 3, 'three matches: final, 3rd place, 5th place');
  const st = (await call('GET', `/api/seasons/${t.id}/standings`, undefined, { admin: false })).json;
  const places = st.groups.map((g) => g.rows.map((r) => r.player.id));
  assert.strictEqual(places.length, 2);
  const brackets = [];
  for (const b of ov.brackets) brackets.push(await bracketOf(b.id));
  assert.deepStrictEqual(brackets.map((b) => b.name.replace(/^.* — /, '')), ['Finále', 'O 3. miesto', 'O 5. miesto']);
  brackets.forEach((b, i) => {
    assert.strictEqual(b.size, 2);
    assert.strictEqual(b.kind, 'MAIN', 'shown as an ordinary bracket, not as a consolation');
    const node = b.nodes[0];
    assert.deepStrictEqual([node.player1.id, node.player2.id].sort((x, y) => x - y), [places[0][i], places[1][i]].sort((x, y) => x - y), `place ${i + 1} plays place ${i + 1} of the other group`);
    assert.ok(node.match && node.match.status === 'PLANNED', 'its match is made');
  });
  // a result in the final is entered like any bracket match
  await playMatch(brackets[0].nodes[0].match.token, brackets[0].nodes[0].player1.id, 'BO3');
  assert.strictEqual((await bracketOf(brackets[0].id)).nodes[0].match.status, 'FINISHED');
  // deleting the draw takes all three brackets and the groups away once nothing was played... (the groups were played: refused)
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.id}/draw/ELITE`)).status, 409);
});

test('the placement matches: groups of 3 and 2 (5 players) pair the first two places, the 3rd of the big group has nobody; by hand makes empty matches', async () => {
  const t = await newTournament('Placement Five');
  await register(t, 'ELITE', 5);
  const made = await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 3, bracketType: 'PLACEMENT', groupFormat: 'BO3', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.groups.length, 2);
  const ms = (await call('GET', `/api/matches?seasonId=${t.id}`)).json;
  assert.strictEqual(ms.length, 4, '3 + 1 group matches');
  for (const m of ms) await playMatch(m.token, Math.max(m.player1.id, m.player2.id), 'BO3');
  const ov = await overview(t, 'ELITE');
  assert.ok(ov.main);
  assert.strictEqual(ov.brackets.length, 2, 'final and 3rd place; the 3rd of the group of three has nobody to play');
  // by hand: empty matches for the organiser to seat
  const u = await newTournament('Placement Hand');
  await register(u, 'ELITE', 6);
  assert.strictEqual((await draw(u, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 3, bracketType: 'PLACEMENT', groupFormat: 'BO3', mode: 'AUTO' })).status, 201);
  const forced = await call('POST', `/api/seasons/${u.id}/draw/bracket`, { category: 'ELITE', mode: 'MANUAL', force: true });
  assert.strictEqual(forced.status, 201, forced.text);
  const brackets = (await call('GET', `/api/seasons/${u.id}/brackets`)).json.filter((x) => x.category === 'ELITE');
  assert.strictEqual(brackets.length, 3);
  for (const x of brackets) assert.ok((await bracketOf(x.id)).nodes.every((n) => !n.player1 && !n.player2), 'empty');
});

test('SIX_ROUNDS: exactly 6 players drawn by lot (never by the seeding), one table, 9 matches in 3 rounds of 3 as in the template (1–6, 2–5, 3–4 | 1–4, 5–3, 6–2 | 1–2, 3–6, 4–5), everybody plays 3', async () => {
  const t = await newTournament('Six Rounds');
  const five = await register(t, 'ELITE', 5);
  const refused = await draw(t, { category: 'ELITE', format: 'SIX_ROUNDS', groupFormat: 'BO3' });
  assert.strictEqual(refused.status, 400, refused.text);
  assert.ok(/exactly 6 players/.test(refused.json.error), refused.json.error);
  await register(t, 'ELITE', 1);
  // the seeding is not used: the numbers of the template are drawn by lot, always
  const regs = (await call('GET', `/api/seasons/${t.id}/registrations`)).json.filter((r) => r.category === 'ELITE');
  assert.strictEqual(regs.length, 6);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'ELITE', seeds: regs.map((r, i) => ({ id: r.id, seed: i + 1 })) })).status, 200);
  const made = await draw(t, { category: 'ELITE', format: 'SIX_ROUNDS', groupFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.groups.length, 1);
  assert.strictEqual(made.json.matches, 9);
  const order = made.json.groups[0].playerIds; // player 1 … 6
  assert.strictEqual(order.length, 6);
  assert.strictEqual(new Set(order).size, 6);
  // …so with every player seeded in the order of the registrations, player 1 is not always the first registered (6 draws: all the same has a chance of 1 in 7776)
  const firsts = new Set([order[0] === regs[0].playerId]);
  for (let i = 0; i < 6; i += 1) {
    const u = await newTournament(`Six Random ${i}`);
    const rs = await register(u, 'ELITE', 6);
    await call('POST', `/api/seasons/${u.id}/seeds`, { category: 'ELITE', seeds: rs.map((r, k) => ({ id: r.reg.id, seed: k + 1 })) });
    const m = await draw(u, { category: 'ELITE', format: 'SIX_ROUNDS', groupFormat: 'BO3' });
    assert.strictEqual(m.status, 201, m.text);
    firsts.add(m.json.groups[0].playerIds[0] === rs[0].player.id);
  }
  assert.ok(firsts.has(false), 'the order is random, not the seeding');
  const ms = (await call('GET', `/api/matches?seasonId=${t.id}`)).json;
  assert.strictEqual(ms.length, 9);
  const number = (p) => order.indexOf(p.id) + 1;
  const byRound = [1, 2, 3].map((r) => ms.filter((m) => m.round === r).map((m) => `${number(m.player1)}-${number(m.player2)}`).sort());
  assert.deepStrictEqual(byRound, [['1-6', '2-5', '3-4'].sort(), ['1-4', '5-3', '6-2'].sort(), ['1-2', '3-6', '4-5'].sort()]);
  order.forEach((id) => assert.strictEqual(ms.filter((m) => m.player1.id === id || m.player2.id === id).length, 3, 'everybody plays 3'));
  const ov = await overview(t, 'ELITE');
  assert.strictEqual(ov.stage, 'GROUPS');
  assert.strictEqual(ov.canMakeBracket, false);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'SIX_ROUNDS', groupFormat: 'BO3' })).status, 409, 'a second draw is refused');
  void five;
});

test('the court planner fits three 40-minute rounds into a 2-hour day (no 5 minutes lost after each match): 6 players, 3 courts, rest 0 → all 9 matches placed', async () => {
  const t = await newTournament('Six Planner');
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { courtCount: 4, matchMinutes: 40, restMinutes: 0, dayStart: '10:00', dayEnd: '12:00', autoSchedule: true })).status, 200);
  await register(t, 'ELITE', 6);
  const made = await draw(t, { category: 'ELITE', format: 'SIX_ROUNDS', groupFormat: 'BO3' });
  assert.strictEqual(made.status, 201, made.text);
  const ms = (await call('GET', `/api/matches?seasonId=${t.id}`)).json;
  assert.strictEqual(ms.length, 9);
  assert.ok(ms.every((m) => m.scheduledAt), 'every match has a time: ' + ms.filter((m) => !m.scheduledAt).length + ' without');
  const starts = [...new Set(ms.map((m) => m.scheduledAt))].sort();
  assert.strictEqual(starts.length, 3, 'three rounds one after another: ' + starts.join(' '));
  assert.strictEqual((new Date(starts[1]) - new Date(starts[0])) / 60000, 40, 'the second round starts when the first ends');
  assert.strictEqual((new Date(starts[2]) - new Date(starts[1])) / 60000, 40);
});

test('seeds of a tournament without categories can be set and cleared again (empty seeds + save removes them)', async () => {
  const t = await newTournament('Open Seeds');
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { categories: ['OPEN'] })).status, 200);
  const list = [];
  for (let i = 0; i < 4; i += 1) {
    counter += 1;
    const p = (await call('POST', '/api/players', { name: `Open Seed ${counter}` })).json;
    const reg = await call('POST', `/api/seasons/${t.id}/registrations/admin`, { playerId: p.id, category: '', phone: `0908${String(200000 + counter)}`, email: `os${counter}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
    list.push(reg.json);
  }
  const seedsOf = async () => (await call('GET', `/api/seasons/${t.id}/registrations`)).json.map((r) => r.seed || null);
  const set = await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'OPEN', seeds: list.map((r, i) => ({ id: r.id, seed: i + 1 })) });
  assert.strictEqual(set.status, 200, set.text);
  assert.deepStrictEqual((await seedsOf()).sort(), [1, 2, 3, 4]);
  // clearing: every seed left empty, then saved
  const cleared = await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'OPEN', seeds: list.map((r) => ({ id: r.id, seed: null })) });
  assert.strictEqual(cleared.status, 200, cleared.text);
  assert.deepStrictEqual(await seedsOf(), [null, null, null, null], 'the seeds are gone');
  // one seed removed, the others kept (closed up)
  await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'OPEN', seeds: list.map((r, i) => ({ id: r.id, seed: i + 1 })) });
  await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'OPEN', seeds: list.map((r, i) => ({ id: r.id, seed: i === 0 ? null : i + 1 })) });
  assert.deepStrictEqual((await seedsOf()).filter(Boolean).sort(), [1, 2, 3]);
});

test('placement matches need exactly two groups', async () => {
  const t = await newTournament('Placement Three Groups');
  await register(t, 'ELITE', 9);
  const refused = await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', groupSize: 3, bracketType: 'PLACEMENT', groupFormat: 'BO3' });
  assert.strictEqual(refused.status, 400, refused.text);
  assert.ok(/exactly 2 groups/.test(refused.json.error), refused.json.error);
  assert.strictEqual((await call('GET', `/api/seasons/${t.id}/draw`)).json.categories.find((c) => c.category === 'ELITE').groups, null, 'nothing was made');
});

test('the groups suggestion for the organiser, and deleting a draw with groups (planned matches go; once one was played it stays)', async () => {
  const t = await newTournament('Suggest Open');
  const players = await register(t, 'ELITE', 9);
  const s = await call('GET', `/api/seasons/${t.id}/draw/groups-suggestion?category=ELITE&groupSize=3`);
  assert.strictEqual(s.status, 200, s.text);
  assert.strictEqual(s.json.groups.length, 3);
  assert.deepStrictEqual(s.json.groups.flatMap((g) => g.registrationIds).sort((a, b) => a - b), players.map((p) => p.reg.id).sort((a, b) => a - b));
  const made = await draw(t, { category: 'ELITE', format: 'GROUPS', groupSize: 3, groupFormat: 'BO3' });
  assert.strictEqual(made.json.matches, 9);
  const gone = await call('DELETE', `/api/seasons/${t.id}/draw/ELITE`);
  assert.strictEqual(gone.status, 200, gone.text);
  assert.strictEqual((await call('GET', `/api/matches?seasonId=${t.id}`)).json.length, 0);
  const again = await draw(t, { category: 'ELITE', format: 'GROUPS', groupSize: 3, groupFormat: 'BO3' });
  assert.strictEqual(again.status, 201, again.text);
  const first = (await call('GET', `/api/matches?seasonId=${t.id}`)).json[0];
  await playMatch(first.token, first.player1.id, 'BO3');
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.id}/draw/ELITE`)).status, 409);
});

test('invalid settings are refused', async () => {
  const t = await newTournament('Bad Settings Open');
  await register(t, 'ELITE', 6);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'LADDER' })).status, 400);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS', groupSize: 1 })).status, 400);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', bracketType: 'ROUND' })).status, 400);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'GROUPS_BRACKET', qualifiers: 0 })).status, 400);
  assert.strictEqual((await draw(t, { category: 'ELITE', format: 'PRINCE', mainFormat: 'XX' })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', format: 'GROUPS' }, { admin: false })).status, 401);
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
