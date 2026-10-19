// Checks of the two kinds of admin (src/auth.js, src/cityScope.js, src/routes/cityAdmins.js, src/routes/admin.js):
//  - the super admin (the ADMIN_PASSWORD of the server) works on every city, picks the one he works on, and makes the admins of the cities;
//  - the admin of a city logs in with an email and a password and runs that ONE city: what he creates goes to his city, his lists show only his
//    city, he cannot change anything of another city, and the settings of the whole site (cities, other admins, SEO, rules, backups) are closed to him.
// Run: node scripts/check-admins.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admins-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let superCookie = '';
let cityCookie = '';
let kosiceId = 0;
let bratislavaSeason = 0;

async function call(cookie, method, url, body, extra = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, headers: res.headers };
}
const asSuper = (m, u, b) => call(superCookie, m, u, b);
// the pages of the backend say so (X-Backend: 1): only then does an admin work on his city
const BACKEND = { 'X-Backend': '1' };
const asCity = (m, u, b) => call(cityCookie, m, u, b, BACKEND);
const asCityPublic = (m, u, b) => call(cityCookie, m, u, b);
const asSuperBackend = (m, u, b, cookie) => call(cookie || superCookie, m, u, b, BACKEND);
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('the super admin makes a city and its admin; the password is never given back', async () => {
  const city = await asSuper('POST', '/api/leagues', { name: 'Kosice' });
  assert.strictEqual(city.status, 201);
  kosiceId = city.data.id;
  const bad = await asSuper('POST', '/api/city-admins', { name: 'Martin K', email: 'martin@example.com', leagueId: kosiceId, password: 'short' });
  assert.strictEqual(bad.status, 400, 'a short password is refused');
  const made = await asSuper('POST', '/api/city-admins', { name: 'Martin K', email: 'Martin@Example.com', leagueId: kosiceId, password: 'long-enough-1' });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.data.email, 'martin@example.com');
  assert.strictEqual(made.data.cityName, 'Kosice');
  assert.ok(!JSON.stringify(made.data).includes('long-enough-1') && !JSON.stringify(made.data).toLowerCase().includes('hash'), 'no password in the answer');
  assert.strictEqual((await asSuper('POST', '/api/city-admins', { name: 'Twin', email: 'martin@example.com', leagueId: kosiceId, password: 'long-enough-2' })).status, 400, 'one account per email');
  assert.strictEqual((await asSuper('GET', '/api/city-admins')).data.length, 1);
});

test('the admin of a city logs in with the email; a wrong password or an unknown email is refused', async () => {
  assert.strictEqual((await call('', 'POST', '/api/admin/login', { email: 'martin@example.com', password: 'nope-nope' })).status, 401);
  assert.strictEqual((await call('', 'POST', '/api/admin/login', { email: 'ghost@example.com', password: 'long-enough-1' })).status, 401);
  const ok = await call('', 'POST', '/api/admin/login', { email: 'MARTIN@example.com', password: 'long-enough-1' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.role, 'CITY');
  cityCookie = cookieOf({ headers: ok.headers });
  const me = await asCity('GET', '/api/admin/session');
  assert.strictEqual(me.data.role, 'CITY');
  assert.strictEqual(me.data.acting.id, kosiceId, 'he works on his city');
  assert.strictEqual(me.data.cities, undefined, 'and cannot pick another');
  const sup = await asSuper('GET', '/api/admin/session');
  assert.strictEqual(sup.data.role, 'SUPER');
  assert.ok(sup.data.cities.length >= 2, 'the super admin sees every city');
});

test('what a city admin creates goes to his city and shows only there', async () => {
  const season = await asCity('POST', '/api/seasons', { name: 'Kosice Jar 2027', startDate: '2027-03-01', endDate: '2027-06-30' });
  assert.strictEqual(season.status, 201);
  const venue = await asCity('POST', '/api/venues', { name: 'Kosice Court' });
  assert.strictEqual(venue.status, 201);
  const player = await asCity('POST', '/api/players', { name: 'Peter Kosicky' });
  assert.strictEqual(player.status, 201);
  const own = await asCity('GET', '/api/seasons');
  assert.deepStrictEqual(own.data.map((s) => s.name), ['Kosice Jar 2027'], 'his list shows his city only');
  assert.deepStrictEqual((await asCity('GET', '/api/players')).data.map((p) => p.name), ['Peter Kosicky']);
  assert.deepStrictEqual((await asCity('GET', '/api/venues')).data.map((v) => v.name), ['Kosice Court']);
  // the public of the first city (blta.sk) never sees them
  const publicSeasons = await call('', 'GET', '/api/seasons');
  assert.ok(!publicSeasons.data.some((s) => s.name === 'Kosice Jar 2027'), 'not on the first city');
  assert.ok(!(await call('', 'GET', '/api/players')).data.some((p) => p.name === 'Peter Kosicky'));
  assert.ok(!(await call('', 'GET', '/api/venues')).data.some((v) => v.name === 'Kosice Court'));
  bratislavaSeason = publicSeasons.data[0] && publicSeasons.data[0].id;
});

test('a city admin cannot change what belongs to another city', async () => {
  await asSuper('POST', '/api/seasons', { name: 'Bratislava Jar 2027', startDate: '2027-03-01', endDate: '2027-06-30' });
  await asSuper('POST', '/api/venues', { name: 'Bratislava Court' });
  await asSuper('POST', '/api/players', { name: 'Bratislava Hrac' });
  const seasons = (await call('', 'GET', '/api/seasons')).data;
  assert.ok(seasons.length, 'the first city has seasons');
  const other = seasons[0].id;
  assert.strictEqual((await asCity('PATCH', `/api/seasons/${other}`, { name: 'Hacked' })).status, 403);
  assert.strictEqual((await asCity('DELETE', `/api/seasons/${other}`)).status, 403);
  const venues = (await call('', 'GET', '/api/venues')).data;
  if (venues.length) assert.strictEqual((await asCity('PATCH', `/api/venues/${venues[0].id}`, { name: 'Hacked' })).status, 403);
  const players = (await call('', 'GET', '/api/players')).data;
  assert.strictEqual((await asCity('PATCH', `/api/players/${players[0].id}`, { name: 'Hacked' })).status, 403);
  assert.strictEqual((await asCity('DELETE', `/api/players/${players[0].slug}`)).status, 403, 'a slug works like an id');
  assert.strictEqual((await asCity('POST', '/api/brackets', { name: 'X', format: 'BO3_STB', size: 4, seasonId: other, category: 'ELITE' })).status, 403, 'a bracket in a season of another city');
  const matches = (await call('', 'GET', '/api/matches?limit=1')).data;
  if (matches.length) assert.strictEqual((await asCity('DELETE', `/api/matches/${matches[0].token}`)).status, 403);
  // and nothing was changed
  assert.notStrictEqual((await call('', 'GET', '/api/seasons')).data[0].name, 'Hacked');
});

test('a match of the city gets the city of its season', async () => {
  const seasonId = (await asCity('GET', '/api/seasons')).data[0].id;
  const a = await asCity('POST', '/api/players', { name: 'Jan Prvy' });
  const b = await asCity('POST', '/api/players', { name: 'Jozef Druhy' });
  const bracket = await asCity('POST', '/api/brackets', { name: 'Kosice Cup', format: 'BO3_STB', size: 4, seasonId, category: 'ELITE', autoCreateMatches: false });
  assert.strictEqual(bracket.status, 201, JSON.stringify(bracket.data));
  assert.deepStrictEqual((await asCity('GET', '/api/brackets')).data.map((x) => x.name), ['Kosice Cup'], 'his brackets only');
  assert.ok(!(await asSuper('GET', '/api/brackets')).data.some((x) => x.name === 'Kosice Cup'), 'not on the first city');
  assert.ok(a.data.id && b.data.id);
});

test('the settings of the whole site are closed to a city admin', async () => {
  assert.strictEqual((await asCity('POST', '/api/leagues', { name: 'Zilina' })).status, 403);
  assert.strictEqual((await asCity('PATCH', `/api/leagues/${kosiceId}`, { status: 'ACTIVE' })).status, 403);
  assert.strictEqual((await asCity('PUT', '/api/leagues/national-lock', { enabled: true, password: 'sesame1' })).status, 403);
  assert.strictEqual((await asCity('GET', '/api/city-admins')).status, 403);
  assert.strictEqual((await asCity('POST', '/api/city-admins', { name: 'Me', email: 'me@example.com', leagueId: kosiceId, password: 'long-enough-3' })).status, 403, 'cannot make another admin');
  // the SEO texts are the city's own; the addresses (and the national page) are the super admin's
  assert.ok((await asCity('GET', '/api/seo')).data.every((p) => p.city && !p.slugsEditable && p.key !== 'slta'));
  assert.strictEqual((await asCity('GET', '/api/seo/court-paths')).status, 403);
  // the rules and the blog are the city's own: his list is empty, the first city's rules are not his to change
  assert.deepStrictEqual((await asCity('GET', '/api/rules')).data, []);
  const firstRules = (await asSuper('GET', '/api/rules')).data;
  assert.ok(firstRules.length, 'the first city has its rules');
  assert.strictEqual((await asCity('PUT', `/api/rules/${firstRules[0].id}`, { title: 'x', html: '<p>x</p>' })).status, 403);
  assert.strictEqual((await asCity('DELETE', `/api/rules/${firstRules[0].id}`)).status, 403);
  assert.strictEqual((await asCity('GET', '/api/admin/login-events')).status, 403);
  assert.strictEqual((await asCity('POST', '/api/admin/backup-now')).status, 403);
  assert.strictEqual((await asCity('POST', '/api/admin/acting-city', { leagueId: 1 })).status, 403, 'cannot move to another city');
  assert.strictEqual((await asCity('GET', '/api/reservations/settings')).status, 403);
  assert.strictEqual((await asCity('PUT', '/api/referee/admin/code', { code: '12345' })).status, 403);
  assert.strictEqual((await call('', 'GET', '/api/city-admins')).status, 401, 'and not for a visitor');
});

test('the super admin picks the city he works on, and sees and edits any of them', async () => {
  assert.deepStrictEqual((await asSuper('GET', '/api/seasons')).data.some((s) => s.name === 'Kosice Jar 2027'), false, 'by default the first city');
  const pick = await asSuper('POST', '/api/admin/acting-city', { leagueId: kosiceId });
  assert.strictEqual(pick.status, 200);
  assert.strictEqual(pick.data.acting.id, kosiceId);
  const withCity = `${superCookie}; ${cookieOf({ headers: pick.headers })}`;
  assert.ok((await call(withCity, 'GET', '/api/seasons')).data.some((s) => s.name === 'Bratislava Jar 2027'), 'on a public page he sees the city of the address, not the one he picked');
  const list = await asSuperBackend('GET', '/api/seasons', undefined, withCity);
  assert.deepStrictEqual(list.data.map((s) => s.name), ['Kosice Jar 2027'], 'his lists follow the city he picked');
  const made = await asSuperBackend('POST', '/api/venues', { name: 'Second Kosice Court' }, withCity);
  assert.strictEqual(made.status, 201);
  assert.ok((await asCity('GET', '/api/venues')).data.some((v) => v.name === 'Second Kosice Court'), 'a thing made there goes to that city');
  assert.ok(!(await asSuper('GET', '/api/venues')).data.some((v) => v.name === 'Second Kosice Court'), 'and not to the first');
  assert.strictEqual((await asSuperBackend('PATCH', `/api/seasons/${list.data[0].id}`, { name: 'Kosice Jar 2027 (edited)' }, withCity)).status, 200, 'he may edit a city he picked');
  assert.strictEqual((await asSuper('POST', '/api/admin/acting-city', { leagueId: 99999 })).status, 404);
});

test('a changed password and a removed account stop the admin of the city at once', async () => {
  const id = (await asSuper('GET', '/api/city-admins')).data[0].id;
  assert.strictEqual((await asSuper('PATCH', `/api/city-admins/${id}`, { password: 'new-password-9' })).status, 200);
  assert.strictEqual((await call('', 'POST', '/api/admin/login', { email: 'martin@example.com', password: 'long-enough-1' })).status, 401, 'the old password is gone');
  assert.strictEqual((await call('', 'POST', '/api/admin/login', { email: 'martin@example.com', password: 'new-password-9' })).status, 200);
  assert.strictEqual((await asSuper('DELETE', `/api/city-admins/${id}`)).status, 200);
  assert.strictEqual((await asCity('GET', '/api/admin/session')).data.isAdmin, false, 'his session is over');
  assert.strictEqual((await asCity('POST', '/api/venues', { name: 'Late' })).status, 401);
});

test('too many wrong passwords from one address are stopped', async () => {
  let last = 0;
  for (let i = 0; i < 9; i += 1) last = (await call('', 'POST', '/api/admin/login', { email: 'ghost@example.com', password: `wrong-${i}` })).status;
  assert.strictEqual(last, 429);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await call('', 'POST', '/api/admin/login', { password: 'test' });
    superCookie = cookieOf({ headers: login.headers });
    assert.ok(superCookie, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
