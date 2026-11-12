// Checks of the scoreboard overlay of a court of a tournament (for the YouTube streams): which match a court shows (GET /api/seasons/by-slug/:slug/court/:n/live),
// the overlay page itself and the overlay link in the admin pages.
// Run: node scripts/check-court-overlay.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null; // a second connection to the temporary database, to put matches into the tournament and on a court (the draw and the planner are tested elsewhere)

async function call(method, url, { body, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or js */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });
const live = (slug, court) => call('GET', `/api/seasons/by-slug/${slug}/court/${court}/live`);

const LINK = 'https://youtu.be/dQw4w9WgXcQ';
let season;
let players = [];
const matches = {};

async function makeMatch(name, p1, p2, courtNo) {
  const made = await admin('POST', '/api/matches', { category: 'FRIENDLY', player1Id: p1.id, player2Id: p2.id, format: 'BO3_STB', location: 'Kurt 1', scheduledAt: '2099-05-01T08:00:00.000Z' });
  assert.strictEqual(made.status, 201, made.text);
  db.prepare('UPDATE matches SET season_id = ?, court_no = ? WHERE share_token = ?').run(season.id, courtNo, made.json.token);
  matches[name] = made.json.token;
  return made.json.token;
}
const start = async (token) => { const r = await admin('POST', `/api/matches/${token}/start`, { firstServer: 1 }); assert.strictEqual(r.status, 200, r.text); };
const score = async (token, player, times) => { for (let i = 0; i < times; i += 1) { const r = await admin('POST', `/api/matches/${token}/score`, { player, delta: 1 }); assert.strictEqual(r.status, 200, r.text); } };

test('setup: a tournament with two courts, a YouTube link on court 1 only', async () => {
  const made = await admin('POST', '/api/seasons', { name: 'Overlay Cup 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' });
  assert.strictEqual(made.status, 201, made.text);
  const set = await admin('PATCH', `/api/seasons/${made.json.id}`, { courtCount: 2, courtStreams: [LINK, ''] });
  assert.strictEqual(set.status, 200, set.text);
  season = set.json;
  for (const name of ['Ov Player One', 'Ov Player Two', 'Ov Player Three', 'Ov Player Four']) players.push((await admin('POST', '/api/players', { name })).json);
});

test('a court without a YouTube link, a bad court number and an unknown tournament have no overlay (404)', async () => {
  assert.strictEqual((await live(season.slug, 2)).status, 404, 'court 2 has no link');
  for (const n of ['0', '3', '99', 'abc', '1.5', '-1']) assert.strictEqual((await live(season.slug, n)).status, 404, n);
  assert.strictEqual((await live('no-such-tournament', 1)).status, 404);
  const r = await live(season.slug, 2);
  assert.ok(!JSON.stringify(r.json).includes('Overlay Cup'), 'nothing leaks in the error');
});

test('a court with a link and no match yet: 200 and no match; a planned match is not shown', async () => {
  const empty = await live(season.slug, 1);
  assert.strictEqual(empty.status, 200, empty.text);
  assert.deepStrictEqual([empty.json.court, empty.json.tournament, empty.json.match], [1, 'Overlay Cup 2099', null]);
  await makeMatch('planned', players[0], players[1], 1);
  assert.strictEqual((await live(season.slug, 1)).json.match, null, 'planned is not live');
});

test('a live match on the court is shown with the names and the games; a live match with no court or on another court is not', async () => {
  await start(matches.planned);
  await score(matches.planned, 1, 3);
  await score(matches.planned, 2, 1);
  const r = await live(season.slug, 1);
  const m = r.json.match;
  assert.strictEqual(m.status, 'LIVE');
  assert.deepStrictEqual([m.player1.name, m.player2.name], ['Ov Player One', 'Ov Player Two']);
  assert.deepStrictEqual([m.state.sets[0].p1, m.state.sets[0].p2, m.state.currentSet], [3, 1, 0]);
  assert.ok(m.token && !('phone' in m.player1) && !('email' in m.player1), 'only what the scoreboard needs');
  await makeMatch('onCourt2', players[2], players[3], 2);
  await start(matches.onCourt2);
  assert.strictEqual((await live(season.slug, 1)).json.match.token, matches.planned, 'a live match on court 2 does not show on court 1');
  await makeMatch('noCourt', players[0], players[2], null);
  await start(matches.noCourt);
  assert.strictEqual((await live(season.slug, 1)).json.match.token, matches.planned, 'a live match with no court shows nowhere');
});

test('two live matches on one court: the one that started last', async () => {
  await new Promise((r) => setTimeout(r, 30));
  db.prepare('UPDATE matches SET court_no = 1 WHERE share_token = ?').run(matches.onCourt2);
  assert.strictEqual((await live(season.slug, 1)).json.match.token, matches.onCourt2);
  db.prepare('UPDATE matches SET court_no = 2 WHERE share_token = ?').run(matches.onCourt2);
});

test('after the end the final score stays 3 minutes, then the court is empty; a live match always wins over a finished one', async () => {
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  db.prepare("UPDATE matches SET court_no = NULL WHERE share_token IN (?, ?)").run(matches.noCourt, matches.onCourt2);
  db.prepare("UPDATE matches SET status = 'FINISHED', end_time = ?, winner_id = ? WHERE share_token = ?").run(ago(1), players[0].id, matches.planned);
  const shown = (await live(season.slug, 1)).json.match;
  assert.deepStrictEqual([shown.token, shown.status, shown.winnerId], [matches.planned, 'FINISHED', players[0].id]);
  db.prepare('UPDATE matches SET end_time = ? WHERE share_token = ?').run(ago(4), matches.planned);
  assert.strictEqual((await live(season.slug, 1)).json.match, null, 'four minutes after the end');
  db.prepare('UPDATE matches SET end_time = ? WHERE share_token = ?').run(ago(1), matches.planned);
  db.prepare('UPDATE matches SET court_no = 1 WHERE share_token = ?').run(matches.onCourt2);
  assert.strictEqual((await live(season.slug, 1)).json.match.token, matches.onCourt2, 'live wins over finished');
});

test('the overlay page: /overlay/<slug>/<court> is a plain noindex page with its own files (no menus of the app), and its files carry the pieces', async () => {
  const r = await call('GET', '/overlay/some-slug/1');
  assert.strictEqual(r.status, 200, 'served for any slug (the script asks the API itself)');
  assert.ok(r.text.includes('/js/overlay.js') && r.text.includes('/css/overlay.css'), 'its own files');
  assert.ok(!r.text.includes('common.js') && !r.text.includes('i18n.js'), 'no header, footer or bottom bar of the app comes with it');
  assert.ok(/<meta name="robots" content="[^"]*noindex/.test(r.text) && /noindex/.test(r.headers.get('x-robots-tag') || ''), 'noindex');
  const css = (await call('GET', '/css/overlay.css')).text;
  assert.ok(css.includes('background: transparent') && css.includes('.ov-tag') && css.includes('.ov-now') && css.includes("font-family: 'Montserrat'"), 'transparent, tab, lime column, the app font');
  const js = (await call('GET', '/js/overlay.js')).text;
  for (const piece of ['matches:changed', 'demo', 'function escapeHtml', '15000', '/court/', '/live']) assert.ok(js.includes(piece), piece);
  assert.ok(!js.includes('innerHTML = data') && !/\$\{(?!esc)[a-zA-Z.]*name/.test(js), 'names go through escapeHtml');
});

test('the admin pages show the overlay link (with a Copy button) under the link of a court that has a saved YouTube link', async () => {
  const get = async (url) => (await call('GET', url)).text;
  const helper = await get('/js/court-streams.js');
  for (const piece of ['data-copy-overlay', '/overlay/', 'data-saved', 'court-overlay-url', 'copyToClipboard']) assert.ok(helper.includes(piece), piece);
  assert.ok(/if \(saved\[i\][^)]*\)/.test(helper) || helper.includes('saved[i]'), 'the link is only for a court with a saved YouTube link');
  assert.ok((await get('/js/seasons-admin.js')).includes('courtStreamFieldsHtml(s.courtCount, s.courtStreams, s.slug'), 'the tournament form passes the slug');
  // (the draw page's own Kurty box is gone: the courts and their links are in the tournament form only)
  assert.ok((await get('/css/style.css')).includes('.court-overlay-url'));
});

test('the overlay is not a page of the site: not in the sitemap, no bare /overlay page; Backend > SEO lists it as a noindex utility page', async () => {
  const sitemap = (await call('GET', '/sitemap.xml')).text;
  assert.ok(!/\/overlay[\/<"\s]|prenos-skore/.test(sitemap), 'not in the sitemap (the tournament called "Overlay Cup" is, as a tournament page)');
  const bare = await call('GET', '/overlay');
  assert.ok(!bare.text.includes('/js/overlay.js'), 'no page without a tournament and a court');
  const seo = (await admin('GET', '/api/seo')).json;
  const entry = seo.find((p) => p.key === 'overlay');
  assert.ok(entry, 'listed in Backend > SEO');
  assert.ok(!/\(new page\)/.test(entry.label), 'listed by hand, not picked up as a new page');
});

// ---- review findings ----
// overlay.js run on its own with a fake page: what it draws for a given answer of the endpoint
async function drawn(answer, { cityBase = '', path: pathname = '/overlay/some-slug/1', status = 200, serverDate = new Date().toUTCString() } = {}) {
  const vm = require('vm');
  const stage = { innerHTML: '', style: {} };
  const urls = [];
  const sandbox = {
    document: { getElementById: () => stage },
    window: { location: { pathname, search: '' }, innerWidth: 1920, addEventListener() {}, CITY_BASE: cityBase },
    fetch: async (url) => { urls.push(url); return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (String(k).toLowerCase() === 'date' ? serverDate : null) }, json: async () => answer }; },
    setInterval() {}, setTimeout, clearTimeout, URLSearchParams, encodeURIComponent, decodeURIComponent, String, Number, Math, JSON, Date, Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'overlay.js'), 'utf8'), sandbox);
  await new Promise((r) => setTimeout(r, 20));
  return { html: stage.innerHTML, urls };
}
const mtbMatch = (status, mtb) => ({
  court: 1,
  tournament: 'T',
  match: {
    status, winnerId: null, player1: { name: 'A' }, player2: { name: 'B' },
    state: { currentSet: 2, sets: [{ p1: 6, p2: 3, winner: 1 }, { p1: 2, p2: 6, winner: 2 }, { p1: 0, p2: 0, tiebreak: mtb, isSuperTiebreak: true, winner: status === 'FINISHED' ? 1 : null }] },
  },
});

test('a finished match tie-break shows its points (not 0 and 0); one being played shows them too', async () => {
  const done = (await drawn(mtbMatch('FINISHED', { p1: 10, p2: 3 }))).html;
  assert.ok(/<span class="ov-mtb">MTB<\/span>10<\/div>/.test(done), `the winner's 10: ${done}`);
  assert.ok(/ov-row2[^>]*>3<\/div>/.test(done), "the loser's 3");
  assert.ok(!/>0<\/div>/.test(done), 'no 0 in a finished match tie-break');
  const going = (await drawn(mtbMatch('LIVE', { p1: 4, p2: 2 }))).html;
  assert.ok(/MTB<\/span>4<\/div>/.test(going) && /ov-now[^>]*>2<\/div>/.test(going), 'in progress');
});

test('a city site: the overlay finds its tournament under the city address (slta.sk/<city>/overlay/<slug>/<court>) and the link shown in the admin has the city in it', async () => {
  const http = require('http');
  const as = (host, url, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: 'localhost', port: PORT, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = ''; res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject); req.end(data || undefined);
  });
  const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const city = await as('localhost', '/api/leagues', { method: 'POST', body: { name: 'Kosice' }, headers: { Cookie: adminCookie } });
  assert.strictEqual(city.status, 201, city.text);
  assert.strictEqual((await as('localhost', `/api/leagues/${city.json.id}`, { method: 'PATCH', body: { status: 'ACTIVE' }, headers: { Cookie: adminCookie } })).status, 200);
  const pick = await as('localhost', '/api/admin/acting-city', { method: 'POST', body: { leagueId: city.json.id }, headers: { Cookie: adminCookie } });
  const cookie = `${adminCookie}; ${cookieOf(pick)}`;
  const made = await as('localhost', '/api/seasons', { method: 'POST', body: { name: 'Kosice Cup 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' }, headers: { Cookie: cookie, 'X-Backend': '1' } });
  assert.strictEqual(made.status, 201, made.text);
  const set = await as('localhost', `/api/seasons/${made.json.id}`, { method: 'PATCH', body: { courtCount: 1, courtStreams: [LINK] }, headers: { Cookie: cookie, 'X-Backend': '1' } });
  assert.strictEqual(set.status, 200, set.text);
  const page = await as('slta.localhost', `/kosice/overlay/${made.json.slug}/1`);
  assert.strictEqual(page.status, 200);
  assert.ok(page.text.includes('window.CITY_BASE="/kosice"'), 'the page learns the city');
  const api = await as('slta.localhost', `/kosice/api/seasons/by-slug/${made.json.slug}/court/1/live`);
  assert.strictEqual(api.status, 200, api.text);
  // the script, run with that city address, asks the city's API
  const run = await drawn({ court: 1, tournament: 'K', match: null }, { cityBase: '/kosice', path: `/kosice/overlay/${made.json.slug}/1` });
  assert.deepStrictEqual(run.urls, [`/kosice/api/seasons/by-slug/${made.json.slug}/court/1/live`]);
  const plain = await drawn({ court: 1, tournament: 'K', match: null });
  assert.deepStrictEqual(plain.urls, ['/api/seasons/by-slug/some-slug/court/1/live']);
  const helper = fs.readFileSync(path.join(ROOT, 'public', 'js', 'court-streams.js'), 'utf8');
  assert.ok(helper.includes("window.CITY_BASE || ''}/overlay/"), 'the link of the admin page has the city in it');
  assert.ok(/NO_TAG = [^\n]*overlay/.test(fs.readFileSync(path.join(ROOT, 'src', 'tracking.js'), 'utf8')), 'no analytics or consent banner on the overlay');
});

// ---- league matches: the overlay of ONE match (/overlay/match/<token>), for a match that has a YouTube link ----
const leagueMatch = (over = {}) => ({
  token: 'tok-1', videoId: 'dQw4w9WgXcQ', status: 'LIVE', endTime: null, winnerId: null, location: 'Tennis ONE', category: 'ELITE', league: null,
  season: { name: 'Autumn Finals Series 2026' }, player1: { name: 'Anna Alpha' }, player2: { name: 'Berta Beta' },
  state: { currentSet: 0, sets: [{ p1: 3, p2: 1, winner: null }] }, ...over,
});
const MATCH_PATH = '/overlay/match/tok-1';

test('league match overlay: a live match with a YouTube link is drawn (place + competition in the tab); no link or not started: nothing', async () => {
  const live = await drawn(leagueMatch(), { path: MATCH_PATH });
  assert.deepStrictEqual(live.urls, ['/api/matches/tok-1']);
  assert.ok(live.html.includes('Tennis ONE') && live.html.includes('Autumn Finals Series 2026') && live.html.includes('Anna Alpha') && live.html.includes('Berta Beta'), live.html);
  assert.ok(live.html.includes('ov-now'), 'the set in progress');
  assert.strictEqual((await drawn(leagueMatch({ videoId: null }), { path: MATCH_PATH })).html, '', 'no YouTube link, no overlay');
  assert.strictEqual((await drawn(leagueMatch({ status: 'PLANNED' }), { path: MATCH_PATH })).html, '', 'not started');
  const noSeason = await drawn(leagueMatch({ season: null, league: 'Winter Cup' }), { path: MATCH_PATH });
  assert.ok(noSeason.html.includes('Winter Cup'), 'the league text when there is no season');
  const bare = await drawn(leagueMatch({ season: null, league: null, location: '' }), { path: MATCH_PATH });
  assert.ok(bare.html.includes('>BLTA<') && bare.html.includes('Elite'), 'no place: BLTA; the category when there is nothing else');
});

test('doubles: a side called "A / B" shows the surnames so that it fits the row (a court overlay and a match overlay); a long place name cannot stretch the tab', async () => {
  const names = { player1: { name: 'Róbert Sloboda / Peter Pálenek' }, player2: { name: 'Anna Alpha-Beta / Katarína Nováková' } };
  const league = (await drawn(leagueMatch(names), { path: MATCH_PATH })).html;
  assert.ok(league.includes('Sloboda / Pálenek') && league.includes('Alpha-Beta / Nováková'), league);
  assert.ok(!league.includes('Róbert') && !league.includes('Katarína'), 'first names are left out of a doubles side');
  const court = (await drawn({ court: 1, tournament: 'T', match: { status: 'LIVE', winnerId: null, ...names, state: { currentSet: 0, sets: [{ p1: 1, p2: 0, winner: null }] } } })).html;
  assert.ok(court.includes('Sloboda / Pálenek') && !court.includes('Róbert'), 'a court overlay too');
  const single = (await drawn(leagueMatch(), { path: MATCH_PATH })).html;
  assert.ok(single.includes('Anna Alpha') && single.includes('Berta Beta'), 'a single player keeps the full name');
  const css = (await call('GET', '/css/overlay.css')).text;
  assert.ok(/\.ov-tag b \{[^}]*max-width: \d+px[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/.test(css) || /\.ov-tag b \{[^}]*text-overflow: ellipsis[^}]*max-width/.test(css), 'the orange tab is cut with an ellipsis, not stretched');
});

test('league match overlay: a finished match stays 3 minutes by the SERVER clock, a not-answering server keeps the picture, a missing match clears it', async () => {
  const serverNow = Date.now() + 3600000; // this computer is an hour behind the server: the overlay must go by the server
  const at = (minAgo) => new Date(serverNow - minAgo * 60000).toISOString();
  const done = (minAgo) => leagueMatch({ status: 'FINISHED', winnerId: 1, endTime: at(minAgo), state: { currentSet: 1, sets: [{ p1: 6, p2: 3, winner: 1 }, { p1: 6, p2: 4, winner: 1 }] } });
  assert.ok((await drawn(done(1), { path: MATCH_PATH, serverDate: new Date(serverNow).toUTCString() })).html.includes('Anna Alpha'), 'one minute after the end');
  assert.strictEqual((await drawn(done(4), { path: MATCH_PATH, serverDate: new Date(serverNow).toUTCString() })).html, '', 'four minutes after the end');
  assert.strictEqual((await drawn({ error: 'Match not found' }, { path: MATCH_PATH, status: 404 })).html, '', 'no such match');
});

test('league match overlay: on a city site the API of the city is used; a tournament called "match" still has its court overlay', async () => {
  const city = await drawn(leagueMatch(), { path: '/kosice/overlay/match/tok-1', cityBase: '/kosice' });
  assert.deepStrictEqual(city.urls, ['/kosice/api/matches/tok-1']);
  const court = await drawn({ court: 1, tournament: 'M', match: null }, { path: '/overlay/match/1' });
  assert.deepStrictEqual(court.urls, ['/api/seasons/by-slug/match/court/1/live']);
  assert.strictEqual((await call('GET', '/overlay/match/some-token')).status, 200, 'the page for a match');
  assert.ok((await call('GET', '/overlay/match/some-token')).text.includes('/js/overlay.js'));
  assert.ok((await call('GET', '/overlay/match/some-token')).headers.get('x-robots-tag').includes('noindex'));
});

test('league match overlay: the admin tile of the match page shows the overlay link with a Copy button, only for a match with a YouTube link', async () => {
  const js = (await call('GET', '/js/match.js')).text;
  for (const piece of ['/overlay/match/', 'window.CITY_BASE', 'data-copy-overlay', 'match.overlayLink']) assert.ok(js.includes(piece), piece);
  assert.ok(js.includes('${m.videoId ? overlayLinkHtml(m) :'), 'the link is only shown for a match that has a YouTube link');
  const i18n = (await call('GET', '/js/i18n.js')).text;
  assert.strictEqual(i18n.split("'match.overlayLink'").length - 1, 2, 'SK and EN');
  assert.ok(/\.info-item \.court-overlay-url > div \{[^}]*flex-direction: column/.test((await call('GET', '/css/style.css')).text), 'in the narrow info tile the link and the button are stacked, not side by side');
});

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
  db = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (db) db.close();
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
