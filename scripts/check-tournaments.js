// Checks of tournaments as seasons of the type TOURNAMENT: the one-off move from the schedule events, the seasons API, the
// schedule page's data and the winners link.
// Run: node scripts/check-tournaments.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-server-'));
const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-mig-'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let child = null;
let adminCookie = '';
let fixtureDb = null;

async function call(method, url, { body, cookie = adminCookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- the move from the schedule events
test('the two tournaments of the schedule became seasons of the type TOURNAMENT', async () => {
  const seasons = (await call('GET', '/api/seasons', { cookie: '' })).json;
  const slavia = seasons.find((s) => s.name === 'Slávia Filozof Cup 2025');
  const one = seasons.find((s) => s.name === 'Tenis ONE Trophy 2025');
  assert.ok(slavia && one, 'tournaments missing');
  assert.strictEqual(slavia.kind, 'TOURNAMENT');
  assert.strictEqual(slavia.slug, 'slavia-filozof-cup-2025');
  assert.strictEqual(slavia.startDate, '2025-09-27');
  assert.strictEqual(slavia.endDate, '2025-09-28');
  assert.ok(/Nevädzová/.test(slavia.venue), slavia.venue);
  assert.deepStrictEqual(one.categories, ['ELITE', 'NEXT_GEN']);
  assert.deepStrictEqual(slavia.categories, ['ELITE', 'NEXT_GEN', 'NOVICE']);
  // league seasons stay leagues
  assert.ok(seasons.filter((s) => s.kind === 'LEAGUE').length >= 2);
  assert.ok(seasons.filter((s) => s.kind === 'LEAGUE').every((s) => s.venue === ''));
});

test('the old events table is emptied and the schedule shows each tournament once, with a page', async () => {
  assert.strictEqual(fixtureDb.prepare('SELECT COUNT(*) AS n FROM schedule_events').get().n, 0);
  const schedule = (await call('GET', '/api/schedule', { cookie: '' })).json;
  const tournaments = schedule.filter((e) => e.type === 'TOURNAMENT');
  assert.deepStrictEqual(tournaments.map((e) => e.name).sort(), ['Slávia Filozof Cup 2025', 'Tenis ONE Trophy 2025']);
  const slavia = tournaments.find((e) => e.name.startsWith('Slávia'));
  assert.strictEqual(slavia.link, '/season/slavia-filozof-cup-2025');
  assert.ok(slavia.seasonId);
  assert.ok(/Nevädzová/.test(slavia.venue));
  assert.deepStrictEqual(tournaments.find((e) => e.name.startsWith('Tenis')).categories, ['ELITE', 'NEXT_GEN']);
  assert.ok(schedule.some((e) => e.type === 'LEAGUE'));
});

test('winners can be set for a tournament and show with it', async () => {
  const seasons = (await call('GET', '/api/seasons', { cookie: '' })).json;
  const slavia = seasons.find((x) => x.name === 'Slávia Filozof Cup 2025');
  const made = await call('POST', '/api/winners/editions', { body: { title: slavia.name, seasonId: slavia.id } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.seasonId, slavia.id);
  const block = await call('POST', `/api/winners/editions/${made.json.id}/blocks`, { body: { category: 'ELITE' } });
  assert.strictEqual(block.status, 201);
  const blockId = block.json.blocks[block.json.blocks.length - 1].id;
  const places = await call('PUT', `/api/winners/blocks/${blockId}/places`, { body: { places: [{ slot: 1, name: 'Víťaz Testovací' }, { slot: 2, name: 'Finalista Testovací' }] } });
  assert.strictEqual(places.status, 200, JSON.stringify(places.json));
  const list = (await call('GET', '/api/winners', { cookie: '' })).json;
  const shown = list.find((e) => e.seasonSlug === 'slavia-filozof-cup-2025');
  assert.ok(shown, 'the edition is not in the public list with the tournament slug');
});

test('the tournament has a page', async () => {
  const res = await fetch(`${BASE}/season/slavia-filozof-cup-2025`);
  assert.strictEqual(res.status, 200);
  assert.ok(/Slávia Filozof Cup 2025 - BLTA/.test(await res.text()));
  assert.strictEqual((await call('GET', '/api/seasons/by-slug/slavia-filozof-cup-2025', { cookie: '' })).json.kind, 'TOURNAMENT');
});

// ---------------------------------------------------------------- the API
test('an admin creates a tournament with a venue and categories, then edits it', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Winter Cup 2027', startDate: '2027-02-06', endDate: '2027-02-07', kind: 'TOURNAMENT', venue: 'TK Dúbravka', categories: ['ELITE', 'NOVICE'] } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.kind, 'TOURNAMENT');
  assert.strictEqual(made.json.slug, 'winter-cup-2027');
  assert.strictEqual(made.json.venue, 'TK Dúbravka');
  assert.deepStrictEqual(made.json.categories, ['ELITE', 'NOVICE']);
  const id = made.json.id;
  const edited = await call('PATCH', `/api/seasons/${id}`, { body: { venue: 'Slovan', entryFee: '25 €', prizeMoney: '300 €', drawDate: '2027-02-04', categories: ['NEXT_GEN'], info: '<p>Tournament info</p>' } });
  assert.strictEqual(edited.status, 200, JSON.stringify(edited.json));
  assert.strictEqual(edited.json.venue, 'Slovan');
  assert.strictEqual(edited.json.entryFee, '25 €');
  assert.deepStrictEqual(edited.json.categories, ['NEXT_GEN']);
  assert.strictEqual(edited.json.kind, 'TOURNAMENT', 'kind is kept when not sent');
  // all three ticked = all categories
  const all = await call('PATCH', `/api/seasons/${id}`, { body: { categories: ['ELITE', 'NEXT_GEN', 'NOVICE'] } });
  assert.deepStrictEqual(all.json.categories, ['ELITE', 'NEXT_GEN', 'NOVICE']);
  assert.strictEqual(fixtureDb.prepare('SELECT categories FROM seasons WHERE id = ?').get(id).categories, null);
  // the schedule picks it up
  const item = (await call('GET', '/api/schedule', { cookie: '' })).json.find((e) => e.name === 'Winter Cup 2027');
  assert.strictEqual(item.type, 'TOURNAMENT');
  assert.strictEqual(item.link, '/season/winter-cup-2027');
  assert.strictEqual(item.venue, 'Slovan');
  // turning it into a league season takes the venue out of the schedule
  const league = await call('PATCH', `/api/seasons/${id}`, { body: { kind: 'LEAGUE' } });
  assert.strictEqual(league.json.kind, 'LEAGUE');
  const again = (await call('GET', '/api/schedule', { cookie: '' })).json.find((e) => e.name === 'Winter Cup 2027');
  assert.strictEqual(again.type, 'LEAGUE');
  assert.strictEqual(again.venue, '');
  assert.strictEqual((await call('DELETE', `/api/seasons/${id}`)).status, 200);
});

test('bad input is refused and only an admin may change things', async () => {
  const bad = await call('POST', '/api/seasons', { body: { name: 'X', kind: 'FESTIVAL' } });
  assert.strictEqual(bad.status, 400);
  const long = await call('POST', '/api/seasons', { body: { name: 'X', kind: 'TOURNAMENT', venue: 'v'.repeat(201) } });
  assert.strictEqual(long.status, 400);
  const season = (await call('GET', '/api/seasons', { cookie: '' })).json[0];
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { body: { kind: 'FESTIVAL' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { body: { venue: 'x'.repeat(201) } })).status, 400);
  assert.strictEqual((await call('POST', '/api/seasons', { body: { name: 'Y', kind: 'TOURNAMENT' }, cookie: '' })).status, 401);
  // a plain create is still a league season
  const plain = await call('POST', '/api/seasons', { body: { name: 'Plain season' } });
  assert.strictEqual(plain.json.kind, 'LEAGUE');
  assert.deepStrictEqual(plain.json.categories, ['ELITE', 'NEXT_GEN', 'NOVICE']);
});

test('a tournament can be entered like a season', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Entry Cup', startDate: '2099-05-01', endDate: '2099-05-02', kind: 'TOURNAMENT' } });
  await call('PATCH', `/api/seasons/${made.json.id}`, { body: { registrationOpen: true } });
  const reg = await call('POST', `/api/seasons/${made.json.id}/registrations`, { cookie: '', body: { name: 'Test Hráč', phone: '0903111222', email: 'a@example.com', category: 'ELITE' } });
  assert.ok(reg.status === 200 || reg.status === 201, `${reg.status} ${JSON.stringify(reg.json)}`);
  const page = (await call('GET', '/api/seasons/by-slug/entry-cup', { cookie: '' })).json;
  assert.strictEqual(page.registrations.length, 1);
});

// ---------------------------------------------------------------- upgrading a database that has events
test('events of an existing database move once; later events stay plain events', () => {
  const dbFile = path.join(migDir, 'blta-score.db');
  const script = `
    const db = require('./src/db');
    db.prepare("INSERT INTO schedule_events (name, start_date, end_date, venue, categories) VALUES ('Cup X 2026', '2026-06-06', '2026-06-07', 'Club X', 'ELITE')").run();
    db.prepare("INSERT INTO winner_editions (title) VALUES ('cup x 2026')").run();
    db.prepare("INSERT INTO seasons (name, slug, start_date, end_date) VALUES ('Old league', 'cup-x-2026', '2026-01-01', '2026-04-30')").run();
    const { migrateTournaments } = require('./src/tournamentsSeed');
    const first = migrateTournaments(db);
    db.prepare("INSERT INTO schedule_events (name, start_date) VALUES ('Later event', '2026-08-01')").run();
    const second = migrateTournaments(db);
    const s = db.prepare("SELECT id, slug, kind, venue, categories FROM seasons WHERE name = 'Cup X 2026'").get();
    const e = db.prepare("SELECT season_id FROM winner_editions").get();
    console.log(JSON.stringify({ first, second, s, linked: e.season_id === s.id, left: db.prepare('SELECT COUNT(*) AS n FROM schedule_events').get().n }));`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, DATA_DIR: migDir }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.first, { moved: 1 });
  assert.deepStrictEqual(out.second, { skipped: true });
  assert.strictEqual(out.s.slug, 'cup-x-2026-2', 'a taken slug gets a number');
  assert.strictEqual(out.s.kind, 'TOURNAMENT');
  assert.strictEqual(out.s.venue, 'Club X');
  assert.strictEqual(out.s.categories, 'ELITE');
  assert.strictEqual(out.linked, true);
  assert.strictEqual(out.left, 1, 'the event added later stays an event');
  void dbFile;
});

// ---------------------------------------------------------------- run
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
  fixtureDb = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  fixtureDb.exec('PRAGMA busy_timeout = 5000');
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
    if (child) child.kill();
    try { if (fixtureDb) fixtureDb.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
    fs.rmSync(migDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
