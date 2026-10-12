// Checks of the venues that are added from src/venueSeed.js (TK Pro Set, TK Dúbravka, Top Tenis, Love4Tennis): each appears once with its details, a restart does not add it again,
// an admin who deletes it keeps it deleted, a venue the admin made under another spelling gets the details instead of a twin, and both
// spellings ("Pro Set", "Proset") of a match location find it.
// Run: node scripts/check-venue-seed.js   (starts its own server twice on temporary data directories; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const dirs = [];
let child = null;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function boot(dataDir) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 40000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
}
async function stop() {
  if (!child) return;
  const exited = new Promise((r) => child.on('exit', r));
  child.kill();
  await exited;
  child = null;
  await new Promise((r) => setTimeout(r, 300));
}
const freshDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-seed-')); dirs.push(d); return d; };
const api = async (url, init) => { const r = await fetch(BASE + url, init); let json = null; try { json = await r.json(); } catch { /* none */ } return { status: r.status, json }; };
const venuesNow = async () => (await api('/api/venues')).json;
const login = async () => {
  const r = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};

test('a new database gets TK Pro Set once, with the details from the club\'s site', async () => {
  const dir = freshDir();
  await boot(dir);
  const found = (await venuesNow()).filter((v) => /pro ?set/i.test(v.name));
  assert.strictEqual(found.length, 1);
  const v = found[0];
  assert.deepStrictEqual([v.name, v.slug, v.area, v.courtsCount, v.courtType], ['TK Pro Set', 'tk-pro-set', 'Petržalka', 4, 'BOTH']);
  assert.deepStrictEqual(v.surfaces, ['CLAY']);
  assert.strictEqual(v.address, 'Vlastenecké námestie 1, 851 01 Bratislava');
  assert.strictEqual(v.bookingUrl, 'https://www.pro-set.sk/reservations');
  assert.strictEqual(v.website, 'https://www.pro-set.sk/');
  assert.ok(v.facilities.includes('LIGHTING') && v.facilities.includes('MULTISPORT'));
  assert.ok(v.lat > 48 && v.lat < 48.3 && v.lng > 17 && v.lng < 17.3, 'a point in Bratislava');
  assert.strictEqual((await api('/api/venues/tk-pro-set')).status, 200, 'its own page data');
  // a restart does not add it twice
  await stop();
  await boot(dir);
  assert.strictEqual((await venuesNow()).filter((x) => /pro ?set/i.test(x.name)).length, 1, 'still one');
  // the admin deletes it: it stays deleted after another start
  const cookie = await login();
  assert.strictEqual((await api(`/api/venues/${v.id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status, 200);
  await stop();
  await boot(dir);
  assert.strictEqual((await venuesNow()).filter((x) => /pro ?set/i.test(x.name)).length, 0, 'deleted for good');
  await stop();
});

test('a venue the admin already made under another spelling gets the details instead of a twin; edited details are never overwritten', async () => {
  const dir = freshDir();
  // the database as production has it: the app made it once, the admin added "Proset" with only a name
  await boot(dir);
  await stop();
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  db.prepare("DELETE FROM venues WHERE name = 'TK Pro Set'").run();
  db.prepare("DELETE FROM app_flags WHERE key = 'venue_added_tk_pro_set'").run();
  db.prepare("INSERT INTO venues (name, slug) VALUES ('Proset', 'proset')").run();
  db.close();
  await boot(dir);
  const found = (await venuesNow()).filter((x) => /pro ?set/i.test(x.name));
  assert.strictEqual(found.length, 1, 'no twin');
  assert.deepStrictEqual([found[0].name, found[0].slug, found[0].courtsCount, found[0].area], ['Proset', 'proset', 4, 'Petržalka'], 'the admin\'s name and slug stay, the details are filled in');
  await stop();
  // an admin's own details are not overwritten when the flag is missing but details were seeded/edited before
  const db2 = new DatabaseSync(path.join(dir, 'blta-score.db'));
  db2.prepare("DELETE FROM app_flags WHERE key = 'venue_added_tk_pro_set'").run();
  db2.prepare("UPDATE venues SET courts_count = 6 WHERE name = 'Proset'").run();
  db2.close();
  await boot(dir);
  assert.strictEqual((await venuesNow()).find((x) => x.name === 'Proset').courtsCount, 6, 'edited details stay');
  await stop();
});

test('"Pro Set" and "Proset" in the location of a match both find the venue, and nothing else does', async () => {
  const dir = freshDir();
  await boot(dir);
  const cookie = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const post = (url, body) => api(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const p1 = (await post('/api/players', { name: 'Hráč Prvý' })).json.id;
  const p2 = (await post('/api/players', { name: 'Hráč Druhý' })).json.id;
  const make = async (location) => (await post('/api/matches', { category: 'FRIENDLY', player1Id: p1, player2Id: p2, format: 'BO3_STB', location, scheduledAt: '2026-10-20T08:00:00.000Z' })).json.token;
  const tokens = [await make('Proset, kurt 2'), await make('Pro Set'), await make('TK Pro-Set kurt 4'), await make('Dudova')];
  const page = (await api('/api/venues/tk-pro-set')).json;
  const here = page.matches.upcoming.map((m) => m.token).sort();
  assert.deepStrictEqual(here, tokens.slice(0, 3).sort(), 'the three spellings, not Dudova');
  await stop();
});

test('the other venues are there too, with what their sites say (and nothing they do not say)', async () => {
  const dir = freshDir();
  await boot(dir);
  const all = await venuesNow();
  const by = (name) => all.find((v) => v.name === name);
  const d = by('TK Dúbravka - Lysákova');
  assert.deepStrictEqual([d.slug, d.area, d.courtsCount, d.courtType, d.bookingUrl], ['tk-dubravka-lysakova', 'Dúbravka', 13, 'BOTH', 'https://dubravskesportovecentrum.isportsystem.sk/']);
  assert.deepStrictEqual(d.surfaces, [], 'the site does not say the surface: not guessed');
  const t = by('Top Tenis - Budatínska');
  assert.deepStrictEqual([t.slug, t.area, t.phone, t.courtsCount, t.lat, t.lng], ['top-tenis-budatinska', 'Petržalka', '+421 905 380 001', null, 48.103412, 17.099693]);
  assert.strictEqual(t.bookingUrl, 'https://www.toptenis.sk/online-booking/');
  const l = by('Love4Tennis');
  assert.deepStrictEqual([l.slug, l.area, l.courtsCount, l.address], ['love4tennis', 'Nové Mesto', 8, 'Turbínova 1, 831 04 Bratislava']);
  assert.deepStrictEqual(l.surfaces, ['CLAY', 'HARD']);
  assert.strictEqual(l.bookingUrl, null, 'booked by phone / e-mail');
  const p = by('TK Júliusa Pántika - Senec');
  assert.deepStrictEqual([p.slug, p.area, p.address, p.phone, p.email], ['tk-juliusa-pantika-senec', 'Senec', 'Pezinská 1, 903 01 Senec', '+421 905 315 554', 'kurty.pantik@gmail.com']);
  assert.deepStrictEqual([p.courtsCount, p.surfaces, p.courtType, p.website], [null, [], null, null], 'the Facebook page says nothing about courts: nothing guessed');
  const mb = by('Matchball');
  assert.deepStrictEqual([mb.slug, mb.area, mb.address, mb.phone, mb.courtsCount, mb.courtType], ['matchball', 'Petržalka', 'Smolenická 20, 851 05 Bratislava', '+421 2 638 375 27', null, null]);
  assert.deepStrictEqual(mb.facilities, ['BAR_CAFE', 'RESTAURANT']);
  const c = by('Tenis Club 26');
  assert.deepStrictEqual([c.slug, c.area, c.phone, c.address, c.lat, c.lng, c.courtType], ['tenis-club-26', 'Vrakuňa', '+421 910 292 291', 'Stavbárska ulica, Bratislava', null, null, 'BOTH'], 'the street is known, the house number is not: no number, no pin');
  for (const v of [d, t, l, p, mb, by('TK Pro Set')]) assert.ok(v.lat > 48 && v.lat < 48.3 && v.lng > 17 && v.lng < 17.5, v.name + ' is in the Bratislava region');
  await stop();
  await boot(dir);
  assert.strictEqual((await venuesNow()).length, all.length, 'a restart adds nothing');
  await stop();
});

test('the way people write the places in a match finds each venue', async () => {
  const dir = freshDir();
  await boot(dir);
  const cookie = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const post = (url, body) => api(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const p1 = (await post('/api/players', { name: 'Hráč Prvý' })).json.id;
  const p2 = (await post('/api/players', { name: 'Hráč Druhý' })).json.id;
  const make = async (location) => (await post('/api/matches', { category: 'FRIENDLY', player1Id: p1, player2Id: p2, format: 'BO3_STB', location, scheduledAt: '2026-10-20T08:00:00.000Z' })).json.token;
  const tokens = {
    'tk-dubravka-lysakova': [await make('Dúbravka'), await make('Dubravka kurt 3'), await make('Lysákova')],
    'top-tenis-budatinska': [await make('Toptenis'), await make('Top tenis, hala'), await make('Budatínska 61')],
    love4tennis: [await make('Love 4 Tennis'), await make('Love4tennis kurt 2')],
    'tk-juliusa-pantika-senec': [await make('Senec'), await make('TK Pántika Senec')],
    'tenis-club-26': [await make('Tenis Club 26'), await make('TENISCLUB26 hala')],
    matchball: [await make('Matchball'), await make('Matchball kurt 1')],
  };
  for (const [slug, list] of Object.entries(tokens)) {
    const here = (await api('/api/venues/' + slug)).json.matches.upcoming.map((m) => m.token).sort();
    assert.deepStrictEqual(here, list.slice().sort(), slug);
  }
  await stop();
});

async function main() {
  let failed = 0;
  try {
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; await stop(); console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } finally {
    await stop();
    await new Promise((r) => setTimeout(r, 300));
    dirs.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
