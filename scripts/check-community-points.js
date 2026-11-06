// Checks of the points the events of a community or club put into ITS ranking: the section "Body do rebríčka" of the card of the event (a season has a coefficient for
// each category, a tournament the points of the places 1 to 10 for each category; only for the events of a community), and the points themselves: a finished match of
// a season pays 3 / 2 / 1 / 0 times the coefficient to both players, a tournament pays the places of its complete final standings; a corrected, deleted or re-set result
// takes back what it paid. The league's own ranking tables are never touched.
// Run: node scripts/check-community-points.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compoints-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;
let hit = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
  hit += 1;
  const h = { 'X-Forwarded-For': `10.${Math.floor(hit / 60000) % 250}.${Math.floor(hit / 250) % 250}.${hit % 250}` };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };
let seq = 0;
const uniq = (p) => `${p} ${(seq += 1)} ${Math.random().toString(36).slice(2, 6)}`;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09080${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}

let owner;
let other;
let org;
let tournament;
let season;
let leagueSeason;

test('set up: a club with its organiser, its tournament and its season, another organiser, a league season', async () => {
  owner = await makePlayer(uniq('Organizator'));
  other = await makePlayer(uniq('Iny'));
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: uniq('Klub') } })).json;
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: true } })).status, 200);
  withDb((f) => f.prepare("UPDATE organisations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE id = ?").run(org.id));
  const t = await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: uniq('Turnaj'), playType: 'SINGLES', startDate: future(10), endDate: future(11) } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  tournament = t.json;
  const s = await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: uniq('Sezona'), startDate: future(10), endDate: future(60) } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  season = s.json;
  leagueSeason = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE', startDate: future(10), endDate: future(60) } })).json;
  assert.strictEqual(tournament.communityPoints != null, true, 'an event of a community shows its settings (empty at first)');
  assert.deepStrictEqual(tournament.communityPoints, {});
  assert.strictEqual(leagueSeason.communityPoints, null, 'the league\'s own events have none');
});

test('a tournament: the points of the places 1 to 10 for each category, saved and shown; zeros at the end are not kept, an empty form clears it', async () => {
  const body = { communityPoints: { places: { ELITE: [100, 80, 60, 50, 40, 30, 20, 10, 5, 1], NEXT_GEN: [50, 30, 0, 0, 0, 0, 0, 0, 0, 0], NOVICE: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } };
  const saved = await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: owner.cookie, body });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.deepStrictEqual(saved.json.communityPoints, { places: { ELITE: [100, 80, 60, 50, 40, 30, 20, 10, 5, 1], NEXT_GEN: [50, 30] } });
  const again = await call('GET', `/api/seasons/${tournament.id}`, { cookie: owner.cookie });
  assert.deepStrictEqual(again.json.communityPoints.places.NEXT_GEN, [50, 30]);
  // a save of the other fields leaves them alone
  const other1 = await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: owner.cookie, body: { venue: 'Kurty' } });
  assert.strictEqual(other1.status, 200, JSON.stringify(other1.json));
  assert.strictEqual(other1.json.communityPoints.places.ELITE[0], 100);
  const cleared = await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: owner.cookie, body: { communityPoints: { places: {} } } });
  assert.deepStrictEqual(cleared.json.communityPoints, {});
});

test('a season: a coefficient for each category; refused: a negative or fractional number, 11 places, a category the event is not played in', async () => {
  const saved = await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: { ELITE: 10, NEXT_GEN: 7, NOVICE: 0 } } } });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.deepStrictEqual(saved.json.communityPoints, { coefficient: { ELITE: 10, NEXT_GEN: 7 } });
  const bad = async (id, communityPoints) => (await call('PATCH', `/api/seasons/${id}`, { cookie: owner.cookie, body: { communityPoints } })).status;
  assert.strictEqual(await bad(season.id, { coefficient: { ELITE: -1 } }), 400);
  assert.strictEqual(await bad(season.id, { coefficient: { ELITE: 1.5 } }), 400);
  assert.strictEqual(await bad(season.id, { coefficient: { ELITE: 'x' } }), 400);
  assert.strictEqual(await bad(season.id, { coefficient: { FRIENDLY: 3 } }), 400);
  assert.strictEqual(await bad(tournament.id, { places: { ELITE: Array(11).fill(1) } }), 400);
  assert.strictEqual(await bad(tournament.id, { places: { ELITE: [-5] } }), 400);
  assert.strictEqual(await bad(tournament.id, 'all'), 400);
  assert.deepStrictEqual((await call('GET', `/api/seasons/${season.id}`, { cookie: owner.cookie })).json.communityPoints, { coefficient: { ELITE: 10, NEXT_GEN: 7 } }, 'a refused save changed nothing');
});

test('only the organiser of the event (or a site admin) saves them; the league\'s own events refuse them, and the league ranking tables are not touched', async () => {
  const body = { communityPoints: { places: { ELITE: [10] } } };
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: other.cookie, body })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { cookie: '', body })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { body })).status, 200, 'a site admin may');
  assert.strictEqual((await call('PATCH', `/api/seasons/${leagueSeason.id}`, { body: { communityPoints: { coefficient: { ELITE: 5 } } } })).status, 400, 'no ranking of a community behind a league season');
  assert.strictEqual((await call('PATCH', `/api/seasons/${leagueSeason.id}`, { body: { name: 'Liga 2' } })).json.communityPoints, null);
  const points = withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM ranking_entries WHERE points IS NOT NULL AND points <> 0').get().n);
  void points;
});

const rankingOf = (playerId) => withDb((f) => (f.prepare('SELECT points FROM organisation_ranking WHERE organisation_id = ? AND player_id = ?').get(org.id, playerId) || { points: 0 }).points);
const ledgerRows = (seasonId) => withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM organisation_ranking_awards WHERE season_id = ?').get(seasonId).n);
const leagueRows = () => withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM ranking_entries WHERE points IS NOT NULL AND points <> 0').get().n);

test('a season pays its matches: 3 / 2 / 1 / 0 times the coefficient to both players, follows a changed coefficient, and a deleted match takes its points back', async () => {
  const a = await makePlayer(uniq('Hrac A'));
  const b = await makePlayer(uniq('Hrac B'));
  const c = await makePlayer(uniq('Hrac C'));
  const league0 = leagueRows();
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: {} } } })).status, 200); // (the earlier checks left a coefficient)
  const group = (await call('POST', `/api/seasons/${season.id}/groups`, { cookie: owner.cookie, body: { name: 'Skupina A', category: 'ELITE' } })).json;
  for (const x of [a, b, c]) assert.strictEqual((await call('POST', `/api/seasons/groups/${group.id}/members`, { cookie: owner.cookie, body: { playerId: x.id } })).status, 201);
  const when = new Date(Date.now() + 86400000).toISOString();
  const make = async (x, y) => { const m = await call('POST', '/api/matches', { cookie: x.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: x.id, player2Id: y.id, groupId: group.id, location: 'Kurt 1', scheduledAt: when } }); assert.strictEqual(m.status, 201, JSON.stringify(m.json)); return m.json.token; };
  const finish = async (token, x, sets) => assert.strictEqual((await call('POST', `/api/matches/${token}/manual-result`, { cookie: x.cookie, body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } })).status, 200);
  const ab = await make(a, b);
  const ac = await make(a, c);
  // the coefficient is saved AFTER the first match is played: it is paid at once (the finished matches pay under the new settings)
  await finish(ab, a, [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }]);
  assert.strictEqual(rankingOf(a.id), 0, 'no settings, no points');
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: { ELITE: 10 } } } })).status, 200);
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(b.id)], [30, 0], 'a won 2:0: 3 x 10, b lost 0:2: 0');
  // a second match: c wins 2:1 → c 2 x 10, a (loses 1:2) 1 x 10
  await finish(ac, a, [{ p1: 6, p2: 4 }, { p1: 3, p2: 6 }, { p1: 2, p2: 6 }]);
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(b.id), rankingOf(c.id)], [40, 0, 20]);
  // a new coefficient: everything is worked out again
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: { ELITE: 5 } } } })).status, 200);
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(c.id)], [20, 10]);
  // a match of a category with no coefficient pays nothing; the points set by hand are kept (the awards are added to them)
  withDb((f) => f.prepare('UPDATE organisation_ranking SET points = points + 100 WHERE organisation_id = ? AND player_id = ?').run(org.id, a.id));
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: {} } } })).status, 200);
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(b.id), rankingOf(c.id)], [100, 0, 0], 'switched off: the awards go back, the 100 set by hand stays');
  assert.strictEqual(ledgerRows(season.id), 0);
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: { ELITE: 10 } } } })).status, 200);
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(c.id)], [140, 20]);
  // the match is deleted: its points go back with it
  assert.ok([200, 204].includes((await call('DELETE', `/api/matches/${ac}`)).status));
  assert.deepStrictEqual([rankingOf(a.id), rankingOf(c.id)], [130, 0]);
  assert.strictEqual(leagueRows(), league0, 'the league tables are not touched');
});

test('a season pays by the scoring it chose (Bodovanie a podmienky): BLTA 3 / 2 / 1 / 0, 2 points for a win, 1 point for a win - times the coefficient; changing the scoring works the points out again', async () => {
  const sz = (await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: uniq('Sezona bodovanie'), startDate: future(10), endDate: future(60) } })).json;
  const a = await makePlayer(uniq('Hrac P'));
  const b = await makePlayer(uniq('Hrac Q'));
  const c = await makePlayer(uniq('Hrac R'));
  const group = (await call('POST', `/api/seasons/${sz.id}/groups`, { cookie: owner.cookie, body: { name: 'Skupina', category: 'ELITE' } })).json;
  for (const x of [a, b, c]) assert.strictEqual((await call('POST', `/api/seasons/groups/${group.id}/members`, { cookie: owner.cookie, body: { playerId: x.id } })).status, 201);
  const when = new Date(Date.now() + 86400000).toISOString();
  const play = async (x, y, sets) => {
    const m = await call('POST', '/api/matches', { cookie: x.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: x.id, player2Id: y.id, groupId: group.id, location: 'Kurt 1', scheduledAt: when } });
    assert.strictEqual(m.status, 201, JSON.stringify(m.json));
    assert.strictEqual((await call('POST', `/api/matches/${m.json.token}/manual-result`, { cookie: x.cookie, body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } })).status, 200);
  };
  assert.strictEqual((await call('PATCH', `/api/seasons/${sz.id}`, { cookie: owner.cookie, body: { communityPoints: { coefficient: { ELITE: 10 } } } })).status, 200);
  await play(a, b, [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }]); // a wins 2:0
  await play(a, c, [{ p1: 6, p2: 4 }, { p1: 3, p2: 6 }, { p1: 2, p2: 6 }]); // c wins 2:1
  const now = () => [rankingOf(a.id), rankingOf(b.id), rankingOf(c.id)];
  assert.deepStrictEqual(now(), [40, 0, 20], 'no scoring chosen = the BLTA scoring of the league: 3, 0 | 1, 2');
  const scoring = async (value) => assert.strictEqual((await call('PATCH', `/api/seasons/${sz.id}`, { cookie: owner.cookie, body: { scoring: value } })).status, 200);
  await scoring('BLTA');
  assert.deepStrictEqual(now(), [40, 0, 20], 'BLTA chosen explicitly: the same');
  await scoring('WIN2');
  assert.deepStrictEqual(now(), [20, 0, 20], '2 points for a win, 0 for a loss, times 10');
  await scoring('WIN1');
  assert.deepStrictEqual(now(), [10, 0, 10], '1 point for a win, times 10');
  await scoring('BLTA');
  assert.deepStrictEqual(now(), [40, 0, 20], 'and back');
});

test('a tournament pays the places of its complete final standings (a corrected result moves them), and a deleted tournament takes them back', async () => {
  const t = (await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: uniq('Turnaj dvoch'), playType: 'SINGLES', startDate: future(10), endDate: future(11) } })).json;
  const x = await makePlayer(uniq('Hrac X'));
  const y = await makePlayer(uniq('Hrac Y'));
  const league0 = leagueRows();
  for (const z of [x, y]) assert.strictEqual((await call('POST', `/api/seasons/${t.id}/registrations/admin`, { cookie: owner.cookie, body: { playerId: z.id, category: 'ELITE', phone: '0908777000', email: 'z@example.com' } })).status, 201);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { cookie: owner.cookie, body: { communityPoints: { places: { ELITE: [100, 80, 60] } } } })).status, 200);
  const drawn = await call('POST', `/api/seasons/${t.id}/draw`, { cookie: owner.cookie, body: { category: 'ELITE', format: 'ELIMINATION', mode: 'AUTO' } });
  assert.strictEqual(drawn.status, 201, JSON.stringify(drawn.json));
  assert.deepStrictEqual([rankingOf(x.id), rankingOf(y.id)], [0, 0], 'nothing before the final is played');
  const matches = (await call('GET', `/api/matches?seasonId=${t.id}`)).json;
  assert.strictEqual(matches.length, 1);
  const win = async (m, winner) => {
    const first = m.player1.id === winner.id;
    const sets = first ? [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }] : [{ p1: 2, p2: 6 }, { p1: 3, p2: 6 }];
    const r = await call('POST', `/api/matches/${m.token}/manual-result`, { cookie: owner.cookie, body: { sets, location: 'Kurt 1', scheduledAt: m.scheduledAt || new Date().toISOString() } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  };
  await win(matches[0], x);
  assert.deepStrictEqual([rankingOf(x.id), rankingOf(y.id)], [100, 80], 'the winner 100, the finalist 80');
  assert.ok(ledgerRows(t.id) === 2);
  // the settings change: worked out again
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { cookie: owner.cookie, body: { communityPoints: { places: { ELITE: [10, 5] } } } })).status, 200);
  assert.deepStrictEqual([rankingOf(x.id), rankingOf(y.id)], [10, 5]);
  assert.strictEqual(leagueRows(), league0, 'the league tables are not touched');
  // the tournament is deleted (no finished match is a condition for the organiser, so an admin does it)
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.id}?withMatches=1`)).status, 200);
  assert.deepStrictEqual([rankingOf(x.id), rankingOf(y.id)], [0, 0]);
  assert.strictEqual(ledgerRows(t.id), 0);
});

test('a result typed into a bracket of the tournament pays the places too, and a corrected winner moves the points', async () => {
  const t = (await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: uniq('Turnaj rucny'), playType: 'SINGLES', startDate: future(10), endDate: future(11) } })).json;
  const x = await makePlayer(uniq('Hrac M'));
  const y = await makePlayer(uniq('Hrac N'));
  for (const z of [x, y]) assert.strictEqual((await call('POST', `/api/seasons/${t.id}/registrations/admin`, { cookie: owner.cookie, body: { playerId: z.id, category: 'ELITE', phone: '0908777001', email: 'm@example.com' } })).status, 201);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { cookie: owner.cookie, body: { communityPoints: { places: { ELITE: [100, 80] } } } })).status, 200);
  // a bracket without real matches: its results are typed in (the result route of the bracket)
  const made = await call('POST', '/api/brackets', { cookie: owner.cookie, body: { name: uniq('Pavuk'), format: 'BO3', seasonId: t.id, category: 'ELITE', autoCreateMatches: false, entries: [{ playerId: x.id, seed: 1 }, { playerId: y.id, seed: 2 }] } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const bracket = made.json;
  const node = bracket.nodes[0];
  const rankOf = (z) => withDb((f) => (f.prepare('SELECT points FROM organisation_ranking WHERE organisation_id = ? AND player_id = ?').get(org.id, z.id) || { points: 0 }).points);
  const typed = await call('PATCH', `/api/brackets/${bracket.id}/nodes/${node.id}/result`, { cookie: owner.cookie, body: { winnerId: x.id } });
  assert.strictEqual(typed.status, 200, JSON.stringify(typed.json));
  await new Promise((r) => setTimeout(r, 300)); // (paid once the answer is out)
  assert.deepStrictEqual([rankOf(x), rankOf(y)], [100, 80]);
  assert.strictEqual((await call('PATCH', `/api/brackets/${bracket.id}/nodes/${node.id}/result`, { cookie: owner.cookie, body: { winnerId: y.id } })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepStrictEqual([rankOf(x), rankOf(y)], [80, 100], 'the corrected winner gets the first place');
});

test('the page: the section sits under "Bodovanie a podmienky" in the Základné info tab of the card of a community', () => {
  const js = read('public/js/seasons-admin.js');
  const rules = js.indexOf("data-rules-section");
  const section = js.indexOf('${CLUB ? communityPointsSection(s) : \'\'}');
  assert.ok(rules > 0 && section > rules, 'after the scoring section');
  assert.ok(section < js.indexOf("tl('Vzhľad stránky', 'Look of the page')"), 'before the look of the page');
  assert.ok(js.includes('communityPoints: readCommunityPoints(e.target)') && js.includes('data-cp-place') && js.includes('data-cp-coef'), 'read with the form');
  assert.ok(js.includes('const CP_PLACES = 10;'), 'ten places');
  assert.ok(read('src/rankingPoints.js').includes('communityAfter((c) => c.afterMatch(updatedRow.id))'), 'the points follow every write of a match');
  assert.ok(js.includes('Body sa pripíšu samé'), 'the section says the points are added by themselves');
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
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
