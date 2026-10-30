// Checks the seasons of communities and clubs: an admin of the community makes a season (a league-style competition with groups and a table) on the front end,
// its members arrange their own matches in it, the table builds up from the results, and it stays apart from the league (lists, schedule, ratings, hidden clubs).
// Run: node scripts/check-club-seasons.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-seasons-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09170${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let owner;
let org;
let season;
let group;
let a;
let b;
let c;
let outsider;
let token;

test('setup: a community, five players, a season made by its admin', async () => {
  owner = await makePlayer('Sezona Majitel');
  [a, b, c, outsider] = [await makePlayer('Sezona A'), await makePlayer('Sezona B'), await makePlayer('Sezona C'), await makePlayer('Sezona Cudzi')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Sezonna komunita', description: 'x' } })).json;
  assert.ok(org.id, JSON.stringify(org));
  const made = await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: 'Jesenna liga komunity', startDate: day(-5), endDate: day(60), info: '<p>Hrame kazdy tyzden</p>' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  season = made.json;
  assert.strictEqual(season.kind, 'LEAGUE');
  assert.strictEqual(season.organisationId, org.id);
});

test('only an admin of the community makes a season: a visitor and a plain player are refused, and the dates are checked', async () => {
  const body = { name: 'Cudzia sezona', startDate: day(1), endDate: day(30) };
  assert.ok([401, 403].includes((await call('POST', `/api/communities/${org.id}/seasons`, { cookie: '', body })).status));
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/seasons`, { cookie: outsider.cookie, body })).status, 403);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: '', startDate: day(1) } })).status, 400);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: 'Zle datumy', startDate: day(9), endDate: day(2) } })).status, 400);
});

test('the admin of the community builds the season: a group and its members (the manage routes accept him, a stranger gets nothing)', async () => {
  const made = await call('POST', `/api/seasons/${season.id}/groups`, { cookie: owner.cookie, body: { name: 'Skupina A', category: 'ELITE' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  group = made.json;
  for (const p of [a, b, c]) {
    const add = await call('POST', `/api/seasons/groups/${group.id}/members`, { cookie: owner.cookie, body: { playerId: p.id } });
    assert.strictEqual(add.status, 201, JSON.stringify(add.json));
  }
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/groups`, { cookie: outsider.cookie, body: { name: 'X', category: 'ELITE' } })).status, 401);
  assert.strictEqual((await call('POST', `/api/seasons/groups/${group.id}/members`, { cookie: outsider.cookie, body: { playerId: outsider.id } })).status, 401);
});

test('a member arranges a match in the group with another member; the match carries the season and the group', async () => {
  const made = await call('POST', '/api/matches', { cookie: a.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: a.id, player2Id: b.id, groupId: group.id, location: 'Kurt 1', scheduledAt: new Date(Date.now() + 86400000).toISOString() } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  token = made.json.token;
  const match = (await call('GET', `/api/matches/${token}`, { cookie: '' })).json;
  assert.strictEqual(match.season.id, season.id);
  assert.strictEqual(match.group.id, group.id);
});

test('a member cannot misuse it: a match he does not play, a player outside the group, a new typed name, a stranger, a visitor, the stage, a league season', async () => {
  const when = new Date(Date.now() + 86400000).toISOString();
  const make = (cookie, extra) => call('POST', '/api/matches', { cookie, body: { category: 'ELITE', format: 'BO3', groupId: group.id, location: 'Kurt 1', scheduledAt: when, ...extra } });
  assert.strictEqual((await make(a.cookie, { player1Id: b.id, player2Id: c.id })).status, 403, 'a match between two others');
  assert.strictEqual((await make(a.cookie, { player1Id: a.id, player2Id: outsider.id })).status, 400, 'a player who is not in the group');
  assert.strictEqual((await make(a.cookie, { player1Id: a.id, player2Name: 'Uplne Novy Hrac' })).status, 400, 'a new player made by the request');
  assert.strictEqual((await make(outsider.cookie, { player1Id: outsider.id, player2Id: a.id })).status, 403, 'a player not in the group');
  assert.ok([401, 403].includes((await make('', { player1Id: a.id, player2Id: b.id })).status), 'a visitor');
  assert.strictEqual((await make(a.cookie, { player1Id: a.id, player2Id: b.id, stage: 'PLAYOFF' })).status, 403, 'the stage is for admins');
  assert.strictEqual((await make(a.cookie, { player1Id: a.id, player2Id: b.id, seasonId: season.id + 999 })).status, 400, 'a season that is not the group\'s');
  // the group of a league season of the Backend stays closed to a player
  const own = (await call('POST', '/api/seasons', { body: { name: 'Liga backendu', startDate: day(-1), endDate: day(40) } })).json;
  const ownGroup = (await call('POST', `/api/seasons/${own.id}/groups`, { body: { name: 'Babolat', category: 'ELITE' } })).json;
  await call('POST', `/api/seasons/groups/${ownGroup.id}/members`, { body: { playerId: a.id } });
  await call('POST', `/api/seasons/groups/${ownGroup.id}/members`, { body: { playerId: b.id } });
  assert.strictEqual((await call('POST', '/api/matches', { cookie: a.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: a.id, player2Id: b.id, groupId: ownGroup.id, scheduledAt: when } })).status, 403, 'a league season of the Backend');
});

test('the players enter the result and the table of the group builds up from it', async () => {
  const done = await call('POST', `/api/matches/${token}/manual-result`, { cookie: a.cookie, body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const standings = (await call('GET', `/api/seasons/${season.id}/standings`, { cookie: '' })).json;
  const rows = standings.groups.find((g) => g.id === group.id).rows;
  const row = (id) => rows.find((r) => r.player.id === id);
  assert.strictEqual(row(a.id).played, 1);
  assert.strictEqual(row(a.id).wins, 1);
  assert.ok(row(a.id).points > row(b.id).points, JSON.stringify(rows));
  assert.strictEqual(row(c.id).played, 0);
});

test('the season is public on its own page and on the page of the community, and stays out of the league (lists, schedule, matches)', async () => {
  const page = await call('GET', `/api/seasons/by-slug/${season.slug}`, { cookie: '' });
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.json.organisation.slug, org.slug);
  assert.ok((await call('GET', `/api/communities/${org.id}/seasons`, { cookie: '' })).json.items.some((s) => s.id === season.id));
  assert.ok(!(await call('GET', `/api/communities/${org.id}/tournaments`, { cookie: '' })).json.items.some((s) => s.id === season.id), 'not among the tournaments');
  assert.ok(!(await call('GET', '/api/seasons', { cookie: '' })).json.some((s) => s.id === season.id), 'not in the league seasons');
  assert.ok(!(await call('GET', '/api/schedule', { cookie: '' })).json.some((e) => e.name === season.name), 'not in the Harmonogram');
  assert.ok(!(await call('GET', '/api/matches', { cookie: '' })).json.some((m) => m.token === token), 'not in the league matches');
});

test('the members see the season among their events with its kind, and a hidden club takes it out of the sitemap, its page and the new matches', async () => {
  await call('POST', `/api/communities/${org.id}/join`, { cookie: a.cookie });
  const mine = (await call('GET', '/api/communities/my-events', { cookie: a.cookie })).json.items;
  assert.ok(mine.some((e) => e.id === season.id && e.kind === 'LEAGUE'), JSON.stringify(mine));
  const sitemapOf = async () => (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok((await sitemapOf()).includes(`/season/${season.slug}`), 'in the sitemap');
  const hide = await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } });
  assert.strictEqual(hide.status, 200, JSON.stringify(hide.json));
  assert.ok(!(await sitemapOf()).includes(`/season/${season.slug}`), 'not in the sitemap of a hidden club');
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${season.slug}`, { cookie: '' })).status, 404, 'its page is gone');
  assert.strictEqual((await call('POST', '/api/matches', { cookie: a.cookie, body: { category: 'ELITE', format: 'BO3', player1Id: a.id, player2Id: c.id, groupId: group.id } })).status, 403, 'no new matches');
  await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: false } });
});

test('a group of a club season can be without a category: its members play the category OTHER, a league season of the Backend cannot have such a group', async () => {
  const open = (await call('POST', `/api/seasons/${season.id}/groups`, { cookie: owner.cookie, body: { name: 'Bez kategorie', category: 'OPEN' } }));
  assert.strictEqual(open.status, 201, JSON.stringify(open.json));
  assert.strictEqual(open.json.category, 'OPEN');
  const [d, e] = [await makePlayer('Sezona D'), await makePlayer('Sezona E')];
  for (const p of [d, e]) assert.strictEqual((await call('POST', `/api/seasons/groups/${open.json.id}/members`, { cookie: owner.cookie, body: { playerId: p.id } })).status, 201);
  const when = new Date(Date.now() + 86400000).toISOString();
  const make = (category) => call('POST', '/api/matches', { cookie: d.cookie, body: { category, format: 'BO3', player1Id: d.id, player2Id: e.id, groupId: open.json.id, location: 'Kurt 1', scheduledAt: when } });
  assert.strictEqual((await make('ELITE')).status, 400, 'a league category is not the one of the group');
  assert.strictEqual((await make('FRIENDLY')).status, 400, 'nor is a friendly match');
  const made = await make('OTHER');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const match = (await call('GET', `/api/matches/${made.json.token}`, { cookie: '' })).json;
  assert.strictEqual(match.category, 'OTHER');
  assert.strictEqual(match.group.id, open.json.id);
  const rows = (await call('GET', `/api/seasons/${season.id}/standings`, { cookie: '' })).json.groups.find((g) => g.id === open.json.id).rows;
  assert.deepStrictEqual(rows.map((r) => r.player.name).sort(), ['Sezona D', 'Sezona E']);
  // the Backend's own league season keeps its three categories
  const own = (await call('POST', '/api/seasons', { body: { name: 'Liga bez kategorie', startDate: day(-1), endDate: day(40) } })).json;
  assert.strictEqual((await call('POST', `/api/seasons/${own.id}/groups`, { body: { name: 'X', category: 'OPEN' } })).status, 400);
  // changing the group to a league category takes its matches (of the category OTHER) out of it
  assert.strictEqual((await call('PATCH', `/api/seasons/groups/${open.json.id}`, { cookie: owner.cookie, body: { category: 'ELITE' } })).status, 200);
  assert.strictEqual((await call('GET', `/api/matches/${made.json.token}`, { cookie: '' })).json.group, null);
});

test('a club season is run like a league season: public registration (listed for its admin only) and play-off brackets made by its admin', async () => {
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { cookie: owner.cookie, body: { registrationOpen: true } })).status, 200);
  const reg = await call('POST', `/api/seasons/${season.id}/registrations`, { cookie: '', body: { name: 'Novy Zaujemca', email: 'zaujemca@example.com', phone: '0905123456', category: 'ELITE' } });
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));
  const list = await call('GET', `/api/seasons/${season.id}/registrations`, { cookie: owner.cookie });
  assert.strictEqual(list.status, 200);
  assert.ok(list.json.some((r) => r.name === 'Novy Zaujemca'));
  assert.strictEqual((await call('GET', `/api/seasons/${season.id}/registrations`, { cookie: outsider.cookie })).status, 401);
  const entries = [a, b, c, outsider].map((p, i) => ({ playerId: p.id, seed: i + 1 }));
  const bracket = await call('POST', '/api/brackets', { cookie: owner.cookie, body: { name: 'Play-off klubu', format: 'BO3', seasonId: season.id, category: 'ELITE', autoCreateMatches: false, entries } });
  assert.strictEqual(bracket.status, 201, JSON.stringify(bracket.json));
  assert.strictEqual((await call('POST', '/api/brackets', { cookie: outsider.cookie, body: { name: 'Cudzi', format: 'BO3', seasonId: season.id, category: 'ELITE', autoCreateMatches: false, entries } })).status, 401);
  assert.ok((await call('GET', `/api/seasons/${season.id}/brackets`, { cookie: '' })).json.some((x) => x.name === 'Play-off klubu'));
});

test('the limit of open events counts seasons together with tournaments', async () => {
  const fresh = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Limit komunita', description: 'x' } })).json;
  for (let i = 0; i < 5; i += 1) {
    const made = await call('POST', `/api/communities/${fresh.id}/${i % 2 ? 'tournaments' : 'seasons'}`, { cookie: owner.cookie, body: { name: `Udalost ${i}`, startDate: day(1), endDate: day(20), playType: 'SINGLES' } });
    assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  }
  assert.strictEqual((await call('POST', `/api/communities/${fresh.id}/seasons`, { cookie: owner.cookie, body: { name: 'Siesta', startDate: day(1), endDate: day(20) } })).status, 409);
});

test('the admin of the community deletes an empty season of his; one with a finished match only an admin of the site', async () => {
  const empty = (await call('POST', `/api/communities/${org.id}/seasons`, { cookie: owner.cookie, body: { name: 'Prazdna sezona', startDate: day(1), endDate: day(20) } })).json;
  assert.strictEqual((await call('DELETE', `/api/seasons/${empty.id}`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}`, { cookie: owner.cookie })).status, 409);
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}`, { cookie: outsider.cookie })).status, 401);
});

test('the page side: the club page offers a new season, lists seasons and links them to /season/, in both languages', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const com = pub('js/community.js');
  assert.ok(com.includes('new-season') && com.includes('openSeasonDialog') && com.includes("'season' : 'tournament'"), 'the club page');
  const i18n = pub('js/i18n.js');
  for (const key of ['com.newSeason', 'com.seasonTitle']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
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
    const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
