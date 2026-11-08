// Checks that a tournament of a community or club stays apart from the league: it is not in the league schedule (Harmonogram), its matches are not in the
// league's lists of matches, and its own page has a Zápasy tab with all its matches in the style of the league's matches.
// Run: node scripts/check-club-matches-apart.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-apart-'));
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
  const phone = `09160${String(phoneCounter).padStart(5, '0')}`;
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
let club;
let ownT;
let a;
let b;
let c;
let d;
const tokens = {};

async function playedMatch(seasonId, p1, p2) {
  const made = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Id: p1.id, player2Id: p2.id, ...(seasonId ? { seasonId } : {}), location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const done = await call('POST', `/api/matches/${made.json.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  return made.json.token;
}
async function plannedMatch(seasonId, p1, p2) {
  const made = await call('POST', '/api/matches', { body: { category: 'ELITE', format: 'BO3', player1Id: p1.id, player2Id: p2.id, ...(seasonId ? { seasonId } : {}), location: 'Kurt 2', scheduledAt: new Date(Date.now() + 86400000).toISOString() } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  return made.json.token;
}

test('setup: a community with a tournament, a tournament of the Backend, four players and matches in both and in the league', async () => {
  owner = await makePlayer('Apart Majitel');
  [a, b, c, d] = [await makePlayer('Apart A'), await makePlayer('Apart B'), await makePlayer('Apart C'), await makePlayer('Apart D')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Oddelena komunita', description: 'x' } })).json;
  club = (await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: 'Turnaj komunity', venue: 'Kurty', startDate: day(1), endDate: day(2), playType: 'SINGLES' } })).json;
  ownT = (await call('POST', '/api/seasons', { body: { name: 'Turnaj ligy', kind: 'TOURNAMENT', startDate: day(3), endDate: day(4), playType: 'SINGLES' } })).json;
  assert.ok(club.id && ownT.id);
  tokens.clubPlanned = await plannedMatch(club.id, a, b);
  tokens.clubDone = await playedMatch(club.id, c, d);
  tokens.ownPlanned = await plannedMatch(ownT.id, a, c);
  tokens.league = await plannedMatch(null, b, d);
});

test('the league lists of matches do not hold the matches of a community tournament (every status, the counts too); the tournament of the Backend and plain matches stay', async () => {
  const tokensIn = async (query) => (await call('GET', `/api/matches${query}`, { cookie: '' })).json.map((m) => m.token);
  const all = await tokensIn('');
  assert.ok(all.includes(tokens.league) && all.includes(tokens.ownPlanned), 'league and Backend tournament matches are there');
  assert.ok(!all.includes(tokens.clubPlanned) && !all.includes(tokens.clubDone), 'the community tournament matches are not');
  for (const status of ['PLANNED', 'FINISHED', 'LIVE', 'UNFINISHED']) {
    const some = await tokensIn(`?status=${status}`);
    assert.ok(!some.includes(tokens.clubPlanned) && !some.includes(tokens.clubDone), status);
  }
  const counts = (await call('GET', '/api/matches/counts', { cookie: '' })).json;
  const planned = (await tokensIn('?status=PLANNED')).length;
  assert.strictEqual(counts.SCHEDULED + counts.UNSCHEDULED, planned, 'the numbers of the tabs follow the list');
  const finished = (await tokensIn('?status=FINISHED')).length;
  assert.strictEqual(counts.FINISHED, finished);
});

test('the profile of a player lists the matches he played in a community tournament - to him only, when he is logged in; nothing else adds them', async () => {
  // asked as a player (his cookie), as a visitor (none) or as the admin
  const tokensIn = async (query, who) => (await call('GET', `/api/matches${query}`, { cookie: who === undefined ? '' : (who ? who.cookie : '') })).json.map((m) => m.token);
  // the profile of c, c logged in: the match in the community tournament is there (finished and planned ones)
  assert.ok((await tokensIn(`?playerId=${c.id}&withClub=1&status=FINISHED`, c)).includes(tokens.clubDone));
  assert.ok((await tokensIn(`?playerId=${a.id}&withClub=1&status=PLANNED`, a)).includes(tokens.clubPlanned), 'a planned one too');
  // only the matches of THAT player
  assert.ok(!(await tokensIn(`?playerId=${a.id}&withClub=1&status=FINISHED`, a)).includes(tokens.clubDone));
  // the same profile for the public, for another player and for the admin has none of them
  for (const [who, label] of [[undefined, 'a visitor'], [b, 'another player'], [{ cookie: adminCookie }, 'the admin']]) {
    assert.ok(!(await tokensIn(`?playerId=${c.id}&withClub=1&status=FINISHED`, who)).includes(tokens.clubDone), label);
    assert.ok(!(await tokensIn(`?playerId=${a.id}&withClub=1&status=PLANNED`, who)).includes(tokens.clubPlanned), label);
  }
  // a visitor cannot make himself the viewer
  assert.ok(!(await tokensIn(`?playerId=${c.id}&withClub=1&_viewer=${c.id}&status=FINISHED`)).includes(tokens.clubDone), 'the viewer is the one the server sees, not the one asked for');
  // without the switch (the matches page, "my matches") they are not there even for him, and the switch without a player (everybody's matches) adds nothing
  assert.ok(!(await tokensIn(`?playerId=${c.id}&status=FINISHED`, c)).includes(tokens.clubDone));
  assert.ok(!(await tokensIn('?withClub=1&status=FINISHED', c)).includes(tokens.clubDone));
  assert.ok(!(await tokensIn('?withClub=1', a)).includes(tokens.clubPlanned));
  // the card knows which community the match belongs to; a match of the Backend tournament has none
  const mine = (await call('GET', `/api/matches?playerId=${a.id}&withClub=1&status=PLANNED`, { cookie: a.cookie })).json;
  assert.deepStrictEqual([mine.find((m) => m.token === tokens.clubPlanned).season.organisation.name, mine.find((m) => m.token === tokens.clubPlanned).season.organisation.type], ['Oddelena komunita', 'COMMUNITY']);
  assert.strictEqual(mine.find((m) => m.token === tokens.ownPlanned).season.organisation, null);
  // a community that is hidden (moderation) is on no profile
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } })).status, 200);
  assert.ok(!(await tokensIn(`?playerId=${a.id}&withClub=1&status=PLANNED`, a)).includes(tokens.clubPlanned), 'hidden: not on the profile');
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: false } })).status, 200);
  assert.ok((await tokensIn(`?playerId=${a.id}&withClub=1&status=PLANNED`, a)).includes(tokens.clubPlanned));
});

test('the profile page asks for them, lists them with the name of the community, and keeps them out of the league statistics', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const player = pub('js/player.js');
  assert.ok(player.includes("withClub: '1'"), 'the profile asks for the matches of communities');
  assert.ok(player.includes('rawGroups = allGroups.map((list) => list.filter((m) => !(m.season && m.season.organisation)))'), 'the statistics, badges and rivals are counted from the league matches only');
  assert.ok(/allGroups\.forEach\(\(matches, i\) =>/.test(player), 'the list shows all of them');
  assert.ok(pub('js/common.js').includes("m.season && m.season.organisation ? m.season.organisation.name : ''") && pub('js/common.js').includes('function clubBadge(m)') && pub('js/player.js').includes('clubBadge(m)') && pub('js/common.js').includes('class="club-private"') && pub('js/i18n.js').split("'match.notPublic':").length === 3, 'the card says which community, has the badge Klub / Komunita and the grey crossed eye (not public), in both languages');
  for (const f of ['js/player.js', 'js/common.js']) new (require('vm').Script)(pub(f), { filename: f });
});

test('asking for the tournament itself (seasonId) gives all its matches', async () => {
  const mine = (await call('GET', `/api/matches?seasonId=${club.id}`, { cookie: '' })).json.map((m) => m.token);
  assert.deepStrictEqual(mine.sort(), [tokens.clubPlanned, tokens.clubDone].sort());
  const counts = (await call('GET', `/api/matches/counts?seasonId=${club.id}`, { cookie: '' })).json;
  assert.strictEqual(counts.FINISHED, 1);
});

test('a match itself still opens by its address (the tournament page and the players link to it)', async () => {
  assert.strictEqual((await call('GET', `/api/matches/${tokens.clubDone}`, { cookie: '' })).status, 200);
});

test('the league schedule (Harmonogram) does not list a community tournament; the tournament of the Backend is there', async () => {
  const schedule = (await call('GET', '/api/schedule', { cookie: '' })).json;
  const names = schedule.map((e) => e.name);
  assert.ok(names.includes('Turnaj ligy'));
  assert.ok(!names.includes('Turnaj komunity'), JSON.stringify(names));
});

test('the community still shows its tournament on its own pages (Events, Novinky, the list of its tournaments)', async () => {
  const list = (await call('GET', `/api/communities/${org.id}/tournaments`, { cookie: '' })).json.items;
  assert.ok(list.some((s) => s.id === club.id));
  const page = await call('GET', `/api/seasons/by-slug/${club.slug}`, { cookie: '' });
  assert.strictEqual(page.status, 200);
});

test('the page side: the tournament page has a Zápasy tab with the matches as cards of the league, in both languages', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const season = pub('js/season.js');
  assert.ok(season.includes("key: 'matches'") && season.includes('function matchesHtml') && season.includes('match-card'), 'the Zápasy tab');
  assert.ok(/\['info', 'courts', 'tables', 'playoff', 'matches', 'final', 'gallery', 'live'\]/.test(season), 'a tournament has the tab (the Live video tab is the last one)');
  assert.ok(season.includes('loadAllMatches') && season.includes('/matches?seasonId='), 'it loads the matches of the tournament');
  const i18n = pub('js/i18n.js');
  for (const key of ['season.navMatches', 'season.empty.matches']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
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
