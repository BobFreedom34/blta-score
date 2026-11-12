// Checks of the playing times of each day of a tournament (seasons.day_times, the Backend form, the court planner and the schedule pages) and of the closing of the public
// registration of a tournament when its first day starts.
// Run: node scripts/check-tournament-day-times.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let db = null;
let n = 0;

async function call(method, url, { body, cookie = adminCookie, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or js */ }
  return { status: res.status, json, text };
}
const patch = (season, body) => call('PATCH', `/api/seasons/${season.id}`, { body });
const schedule = async (season) => (await call('GET', `/api/seasons/${season.id}/schedule`, { cookie: '' })).json;
const localHM = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const localDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(new Date(iso));
const todayLocal = () => localDay(new Date().toISOString());
const nowHM = () => localHM(new Date().toISOString());

async function makeTournament(over = {}) {
  n += 1;
  const r = await call('POST', '/api/seasons', { body: { name: `Day Times Cup ${n}`, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02', ...over } });
  assert.strictEqual(r.status, 201, r.text);
  return r.json;
}
const NAMES = ['Adam Kovalik', 'Boris Hudec', 'Cyril Molnar', 'Dusan Pecho', 'Emil Vrabel', 'Filip Gazdik', 'Gabriel Zeman', 'Henrich Lukac', 'Igor Sedlak', 'Jakub Hornak', 'Karol Ondrus', 'Lubos Strapko', 'Marian Kucera', 'Norbert Dobos', 'Oliver Babic', 'Pavol Hlavaty'];
// a public registration (a different address each time: the form allows only a few from one)
async function register(season, extra = {}) {
  n += 1;
  return call('POST', `/api/seasons/${season.id}/registrations`, {
    cookie: '', headers: { 'x-forwarded-for': `10.7.${Math.floor(n / 250)}.${n % 250}` },
    body: { name: NAMES[n % NAMES.length], phone: `0905${String(300000 + n)}`, email: `dt${n}@example.com`, ...extra },
  });
}

// ---------------------------------------------------------------- per day times
test('the times of each day: stored with the tournament, served with the schedule (every day has its own or the general ones), wrong ones are refused and change nothing', async () => {
  const t = await makeTournament();
  assert.deepStrictEqual((await schedule(t)).settings.dayTimes, { '2099-05-01': { start: '09:00', end: '20:00' }, '2099-05-02': { start: '09:00', end: '20:00' } }, 'nothing typed: the general times');
  const ok = await patch(t, { courtCount: 2, matchMinutes: 30, dayTimes: { '2099-05-02': { start: '14:00', end: '18:30' } } });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.deepStrictEqual(ok.json.planning.dayTimes, { '2099-05-02': { start: '14:00', end: '18:30' } }, 'only the typed days');
  assert.deepStrictEqual((await schedule(t)).settings.dayTimes, { '2099-05-01': { start: '09:00', end: '20:00' }, '2099-05-02': { start: '14:00', end: '18:30' } });
  for (const bad of [
    { '2099-05-01': { start: '18:00', end: '10:00' } },
    { '2099-05-01': { start: '10:00', end: '10:00' } },
    { '2099-05-01': { start: '25:00', end: '26:00' } },
    { '2099-05-01': { start: '10:00', end: '10:20' } },
    { '2099-05-01': { start: '10:00' } },
    { 'not-a-date': { start: '10:00', end: '12:00' } },
    'x',
  ]) {
    const r = await patch(t, { dayTimes: bad });
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
  assert.deepStrictEqual((await schedule(t)).settings.dayTimes['2099-05-02'], { start: '14:00', end: '18:30' }, 'nothing changed');
  const cleared = await patch(t, { dayTimes: {} });
  assert.strictEqual(cleared.status, 200);
  assert.deepStrictEqual((await schedule(t)).settings.dayTimes['2099-05-02'], { start: '09:00', end: '20:00' }, 'cleared: the general times again');
  const general = await patch(t, { dayStart: '08:00', dayEnd: '19:00', dayTimes: { '2099-05-01': { start: '10:00', end: '12:00' } } });
  assert.strictEqual(general.status, 200, general.text);
  assert.deepStrictEqual((await schedule(t)).settings.dayTimes, { '2099-05-01': { start: '10:00', end: '12:00' }, '2099-05-02': { start: '08:00', end: '19:00' } }, 'a day without its own times follows the general ones');
});

test('the planner uses the window of each day: a short first day sends the next match to the second day, at ITS start', async () => {
  const t = await makeTournament();
  assert.strictEqual((await patch(t, { courtCount: 1, matchMinutes: 30, restMinutes: 0, dayTimes: { '2099-05-01': { start: '09:00', end: '09:30' }, '2099-05-02': { start: '14:00', end: '15:00' } } })).status, 200);
  const tokens = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (await call('POST', '/api/players', { body: { name: `Dt Hrac ${n}${i}a` } })).json;
    const b = (await call('POST', '/api/players', { body: { name: `Dt Hrac ${n}${i}b` } })).json;
    const m = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', player1Id: a.id, player2Id: b.id, format: 'BO3_STB', location: 'x', scheduledAt: '2099-05-01T08:00:00.000Z' } });
    assert.strictEqual(m.status, 201, m.text);
    db.prepare("UPDATE matches SET season_id = ?, scheduled_at = NULL, court_no = NULL, location = '' WHERE share_token = ?").run(t.id, m.json.token);
    tokens.push(m.json.token);
  }
  const planned = await call('POST', `/api/seasons/${t.id}/schedule/auto`, { body: { mode: 'fill' } });
  assert.strictEqual(planned.status, 200, planned.text);
  const placed = (await schedule(t)).matches.filter((m) => m.scheduledAt).map((m) => `${localDay(m.scheduledAt)} ${localHM(m.scheduledAt)}`).sort();
  assert.deepStrictEqual(placed, ['2099-05-01 09:00', '2099-05-02 14:00', '2099-05-02 14:30'], placed.join(' | '));
});

// ---------------------------------------------------------------- no registration after the start
test('a tournament whose first day has started takes no public registration even when the switch is on; the admin can still add a player; the switch itself is not changed', async () => {
  const past = await makeTournament({ startDate: '2020-01-01', endDate: '2099-12-31' });
  assert.strictEqual((await patch(past, { maxPlayers: 10 })).status, 200);
  const refused = await register(past);
  assert.strictEqual(refused.status, 403, refused.text);
  assert.strictEqual(refused.json.code, 'REGISTRATION_CLOSED');
  assert.ok(/started/i.test(refused.json.error), refused.json.error);
  const page = (await call('GET', `/api/seasons/by-slug/${past.slug}`, { cookie: '' })).json;
  assert.deepStrictEqual([page.registrationOpen, page.registrationAvailable], [true, false], 'the switch stays on, the registration is not available');
  const player = (await call('POST', '/api/players', { body: { name: 'Neskory Hrac' } })).json;
  const added = await call('POST', `/api/seasons/${past.id}/registrations/admin`, { body: { playerId: player.id, phone: '0905777000', email: 'neskory@example.com' } });
  assert.strictEqual(added.status, 201, added.text);
  const future = await makeTournament();
  assert.strictEqual((await patch(future, { maxPlayers: 10 })).status, 200);
  assert.strictEqual((await register(future)).status, 201, 'a tournament that has not started takes registrations');
  const fpage = (await call('GET', `/api/seasons/by-slug/${future.slug}`, { cookie: '' })).json;
  assert.deepStrictEqual([fpage.registrationOpen, fpage.registrationAvailable], [true, true]);
  const closedByHand = await makeTournament();
  assert.strictEqual((await patch(closedByHand, { maxPlayers: 10, registrationOpen: false })).status, 200);
  assert.strictEqual((await register(closedByHand)).status, 403, 'the switch off still closes it');
  const league = await call('POST', '/api/seasons', { body: { name: 'Stara Liga', startDate: '2020-01-01', endDate: '2099-12-31' } });
  assert.strictEqual((await patch(league.json, { maxPlayers: 10 })).status, 200);
  const leagueTry = await register(league.json, { category: 'ELITE' });
  assert.strictEqual(leagueTry.status, 201, `a league season is not affected: ${leagueTry.text}`);
});

test('the start is the start time of the FIRST day: its own time when it has one, else the general one', async () => {
  if (nowHM() >= '23:20') { console.log('      (skipped: too close to midnight for a test that goes by the time of day)'); return; }
  const today = todayLocal();
  const later = await makeTournament({ startDate: today, endDate: '2099-12-31' });
  assert.strictEqual((await patch(later, { maxPlayers: 10, matchMinutes: 15, dayStart: '23:30', dayEnd: '23:59' })).status, 200);
  const before = await register(later);
  assert.strictEqual(before.status, 201, `today, but the playing day starts at 23:30: not started yet: ${before.text}`);
  assert.strictEqual((await patch(later, { dayTimes: { [today]: { start: '00:00', end: '12:00' } } })).status, 200);
  const refused = await register(later);
  assert.strictEqual(refused.status, 403, 'the first day has its own start at 00:00: started');
});

test('the public lists follow it: the Harmonogram does not offer registration for a tournament that has started', async () => {
  const past = await makeTournament({ startDate: '2020-02-01', endDate: '2099-12-31' });
  const future = await makeTournament();
  const rows = (await call('GET', '/api/schedule', { cookie: '' })).json;
  const of = (t) => rows.find((r) => r.seasonId === t.id);
  assert.ok(of(past) && of(future), 'both are in the schedule');
  assert.strictEqual(of(past).registrationOpen, false, 'started: no registration');
  assert.strictEqual(of(future).registrationOpen, true, 'not started: registration');
});

test('a tournament is over once the playing window of its LAST day has ended (not only the day after): the season, the Harmonogram and the pages follow it', async () => {
  const hm = nowHM();
  if (hm < '00:40' || hm >= '23:20') { console.log('      (skipped: too close to midnight for a test that goes by the time of day)'); return; }
  const today = todayLocal();
  const over = await makeTournament({ startDate: today, endDate: today });
  assert.strictEqual((await patch(over, { maxPlayers: 10, matchMinutes: 15, dayTimes: { [today]: { start: '00:00', end: '00:30' } } })).status, 200);
  const running = await makeTournament({ startDate: today, endDate: today });
  assert.strictEqual((await patch(running, { maxPlayers: 10, matchMinutes: 15, dayTimes: { [today]: { start: '00:00', end: '23:59' } } })).status, 200);
  const later = await makeTournament({ startDate: '2099-05-01', endDate: '2099-05-02' });
  const flag = async (t) => (await call('GET', `/api/seasons/by-slug/${t.slug}`, { cookie: '' })).json.tournamentEnded;
  assert.strictEqual(await flag(over), true, 'the last window ended this morning: over');
  assert.strictEqual(await flag(running), false, 'the window runs until 23:59: not over');
  assert.strictEqual(await flag(later), false, 'a tournament in the future is not over');
  const rows = (await call('GET', '/api/schedule', { cookie: '' })).json;
  const of = (t) => rows.find((r) => r.seasonId === t.id);
  assert.deepStrictEqual([of(over).tournamentEnded, of(running).tournamentEnded], [true, false], 'the Harmonogram carries it too');
  // a tournament with its own end time on the LAST day only: the last day decides, not the first
  // (it started yesterday: a tournament of years has more days than the planner lists, and then the typed time of today would not be kept)
  const two = await makeTournament({ startDate: localDay(new Date(Date.now() - 36 * 3600 * 1000).toISOString()), endDate: today });
  assert.strictEqual((await patch(two, { maxPlayers: 10, matchMinutes: 15, dayTimes: { [today]: { start: '00:00', end: '23:59' } } })).status, 200);
  assert.strictEqual(await flag(two), false, 'its last day is still going');
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  for (const [file, piece] of [['js/community-post.js', 's.tournamentEnded'], ['js/community.js', 'comTournamentRow('], ['js/season.js', 'season.tournamentEnded'], ['js/harmonogram.js', 'e.tournamentEnded'], ['js/common.js', 's.tournamentEnded']]) assert.ok(pub(file).includes(piece), `${file} goes by tournamentEnded`);
});

// ---------------------------------------------------------------- review findings
test('a typed day that is no longer a day of the tournament is dropped and blocks nothing; a day that is too short for the match says where to change it', async () => {
  const t = await makeTournament({ startDate: '2099-05-01', endDate: '2099-05-02' });
  assert.strictEqual((await patch(t, { courtCount: 1, matchMinutes: 60, dayTimes: { '2099-05-02': { start: '14:00', end: '15:00' } } })).status, 200);
  const tooLong = await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { body: { matchMinutes: 90 } });
  assert.strictEqual(tooLong.status, 400, 'a day of the tournament that is too short for the match is refused');
  assert.ok(/2099-05-02/.test(tooLong.json.error) && /Backend/.test(tooLong.json.error), tooLong.json.error);
  // the dates move away (no times sent): the old day is no longer a day of the tournament
  const moved = await patch(t, { startDate: '2099-07-01', endDate: '2099-07-02' });
  assert.strictEqual(moved.status, 200, moved.text);
  assert.deepStrictEqual(moved.json.planning.dayTimes, {}, 'not served any more');
  const longer = await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { body: { matchMinutes: 90 } });
  assert.strictEqual(longer.status, 200, `the Harmonogram settings are not blocked by an old day: ${longer.text}`);
  // the dates and the times change in one save
  const both = await patch(t, { startDate: '2099-08-01', endDate: '2099-08-02', dayTimes: { '2099-08-02': { start: '10:00', end: '16:00' } } });
  assert.strictEqual(both.status, 200, both.text);
  assert.deepStrictEqual(both.json.planning.dayTimes, { '2099-08-02': { start: '10:00', end: '16:00' } });
});

test('the city lists do not offer a tournament that has started as the one to register to', async () => {
  const city = (await call('POST', '/api/leagues', { body: { name: 'Zilina' } })).json;
  assert.ok(city && city.id, 'city made');
  assert.strictEqual((await call('PATCH', `/api/leagues/${city.id}`, { body: { status: 'ACTIVE' } })).status, 200);
  const pick = await fetch(`${BASE}/api/admin/acting-city`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ leagueId: city.id }) });
  const cookie = `${adminCookie}; ${pick.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')}`;
  const make = async (body) => { const r = await call('POST', '/api/seasons', { cookie, headers: { 'X-Backend': '1' }, body }); assert.strictEqual(r.status, 201, r.text); return r.json; };
  const row = async () => (await call('GET', '/api/leagues', { cookie: '' })).json.find((c) => c.id === city.id);
  const started = await make({ name: 'Zilina Stary Cup', kind: 'TOURNAMENT', startDate: '2020-01-01', endDate: '2099-12-31' });
  assert.ok(started.slug);
  const only = await row();
  assert.strictEqual(only.registrationOpen, false, 'only a tournament that has started: nothing to register to');
  assert.strictEqual(only.registrationSeason, null);
  const coming = await make({ name: 'Zilina Buduci Cup', kind: 'TOURNAMENT', startDate: '2099-06-01', endDate: '2099-06-02' });
  const both = await row();
  assert.strictEqual(both.registrationOpen, true);
  assert.strictEqual(both.registrationSeason.slug, coming.slug, 'the one that has not started');
});

// ---------------------------------------------------------------- the pages
test('the pages carry the pieces: day rows in the Backend form, the window of each day on the timeline and the whole-screen page, the registration button follows registrationAvailable', async () => {
  const get = async (url) => (await call('GET', url, { cookie: '' })).text;
  const admin = await get('/js/seasons-admin.js');
  for (const piece of ['data-day-times', 'function readDayTimes(', 'function syncDayTimes(', 'dayTimes: readDayTimes(', 'registrationStarted']) assert.ok(admin.includes(piece), piece);
  assert.ok(admin.indexOf("input.addEventListener('change', () => syncDayTimes(editForm))") > admin.indexOf('const editForm = card.querySelector'), 'the date listeners are set up AFTER editForm exists (before it the whole card would fail to start)');
  const sched = await get('/js/court-schedule.js');
  assert.ok(sched.includes('function csDayWindow('), 'the helper');
  assert.ok(!/csMinutesOf\(settings\.dayStart\)/.test(sched) && !/csMinutesOf\(csState\.data\.settings\.dayStart\)/.test(sched), 'the timeline and the drop target no longer use the one general window');
  assert.ok(sched.split('csDayWindow(').length - 1 >= 4, 'used in the timeline and the drag and drop');
  const screen = await get('/js/schedule-screen.js');
  assert.ok(screen.includes('csDayWindow(settings, day)') && !/csMinutesOf\(settings\.dayStart\)/.test(screen), 'the whole-screen page');
  const home = await get('/js/home.js');
  assert.ok(!/s\.registrationOpen|d\.season\.registrationOpen/.test(home) && home.includes('registrationAvailable'), 'the home page timeline goes by what a visitor can do');
  const season = await get('/js/season.js');
  assert.ok(season.includes('season.registrationAvailable') && !/season\.registrationOpen/.test(season), 'the public page goes by what a visitor can do');
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
