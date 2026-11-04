// Checks of sorting a tournament's registered players into categories: POST /api/seasons/:id/registrations/categories (admin only,
// all-or-nothing) and that a tournament registration has no category until then.
// Run: node scripts/check-tournament-categories.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcat-'));
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

let tournament; let league; let regs = [];

test('setup: an open tournament with four public registrations, which have no category', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Test Open 2026', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03' });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { registrationOpen: true, maxPlayers: 50 })).status, 200);
  const names = ['Alan Tester', 'Boris Tester', 'Cyril Tester', 'Dušan Tester'];
  for (let i = 0; i < names.length; i += 1) {
    const r = await call('POST', `/api/seasons/${tournament.id}/registrations`, { name: names[i], email: `p${i}@example.com`, phone: `09031122${10 + i}` }, { admin: false });
    assert.strictEqual(r.status, 201, r.text);
    assert.strictEqual(r.json.category, '');
  }
  regs = (await call('GET', `/api/seasons/${tournament.id}/registrations`)).json;
  assert.strictEqual(regs.length, 4);
  assert.ok(regs.every((r) => r.category === ''));
});

test('only an admin can sort the players', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, { assignments: [{ id: regs[0].id, category: 'ELITE' }] }, { admin: false });
  assert.strictEqual(r.status, 401);
});

test('the admin sorts several players at once; the answer is the whole list; some can be put back to "not sorted"', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, {
    assignments: [{ id: regs[0].id, category: 'ELITE' }, { id: regs[1].id, category: 'NEXT_GEN' }, { id: regs[2].id, category: 'NOVICE' }],
  });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(r.json.map((x) => x.category), ['ELITE', 'NEXT_GEN', 'NOVICE', '']);
  const back = await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, { assignments: [{ id: regs[2].id, category: '' }] });
  assert.deepStrictEqual(back.json.map((x) => x.category), ['ELITE', 'NEXT_GEN', '', '']);
});

test('one bad entry changes nothing: unknown category, a registration of another season, an empty list', async () => {
  const before = (await call('GET', `/api/seasons/${tournament.id}/registrations`)).json.map((x) => x.category);
  const bad = await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, { assignments: [{ id: regs[3].id, category: 'NOVICE' }, { id: regs[0].id, category: 'PRO' }] });
  assert.strictEqual(bad.status, 400);
  const other = await call('POST', '/api/seasons', { name: 'Other Open', kind: 'TOURNAMENT' });
  const foreign = await call('POST', `/api/seasons/${other.json.id}/registrations/categories`, { assignments: [{ id: regs[3].id, category: 'NOVICE' }] });
  assert.strictEqual(foreign.status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${tournament.id}/registrations/categories`, { assignments: [] })).status, 400);
  assert.deepStrictEqual((await call('GET', `/api/seasons/${tournament.id}/registrations`)).json.map((x) => x.category), before);
});

test('a league season needs a real category: "not sorted" is refused there', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Test League', kind: 'LEAGUE' });
  league = made.json;
  await call('PATCH', `/api/seasons/${league.id}`, { registrationOpen: true, categoryMax: { ELITE: 50, NEXT_GEN: 50, NOVICE: 50 } });
  const r = await call('POST', `/api/seasons/${league.id}/registrations`, { name: 'Ľuboš Liga', email: 'l@example.com', phone: '0903112299', category: 'NOVICE' }, { admin: false });
  assert.strictEqual(r.status, 201, r.text);
  const leagueRegs = (await call('GET', `/api/seasons/${league.id}/registrations`)).json;
  const refused = await call('POST', `/api/seasons/${league.id}/registrations/categories`, { assignments: [{ id: leagueRegs[0].id, category: '' }] });
  assert.strictEqual(refused.status, 400);
  const ok = await call('POST', `/api/seasons/${league.id}/registrations/categories`, { assignments: [{ id: leagueRegs[0].id, category: 'ELITE' }] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json[0].category, 'ELITE');
});

test('a league season is played in the categories the admin ticks: the season, the Harmonogram and the registration follow; every category until then', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Test League 2099', startDate: '2099-01-01', endDate: '2099-03-31' });
  assert.strictEqual(made.status, 201, made.text);
  const slug = made.json.slug;
  assert.deepStrictEqual(made.json.categories, ['ELITE', 'NEXT_GEN', 'NOVICE'], 'every category at first');
  const chips = async () => ((await call('GET', '/api/schedule')).json.find((e) => e.seasonId === made.json.id) || {}).categories;
  assert.deepStrictEqual(await chips(), ['ELITE', 'NEXT_GEN', 'NOVICE']);
  const two = await call('PATCH', `/api/seasons/${made.json.id}`, { categories: ['ELITE', 'NEXT_GEN'] });
  assert.strictEqual(two.status, 200, two.text);
  assert.deepStrictEqual((await call('GET', `/api/seasons/by-slug/${slug}`)).json.categories, ['ELITE', 'NEXT_GEN']);
  assert.deepStrictEqual(await chips(), ['ELITE', 'NEXT_GEN'], 'the Harmonogram shows the categories of the season');
  // a request that does not name the categories leaves them alone
  assert.strictEqual((await call('PATCH', `/api/seasons/${made.json.id}`, { info: 'x' })).status, 200);
  assert.deepStrictEqual((await call('GET', `/api/seasons/by-slug/${slug}`)).json.categories, ['ELITE', 'NEXT_GEN']);
  assert.strictEqual((await call('PATCH', `/api/seasons/${made.json.id}`, { categories: ['ELITE', 'NEXT_GEN', 'NOVICE'] })).status, 200);
  assert.deepStrictEqual(await chips(), ['ELITE', 'NEXT_GEN', 'NOVICE']);
});

let fakeAddress = 0;
async function publicRegistration(id, body) {
  fakeAddress += 1;
  const res = await fetch(`${base}/api/seasons/${id}/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.8.${fakeAddress}` }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

test('a season can be played without categories ("Bez kategórie"): groups without a category, registration without one, no category chips; the rules return with the categories', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Open League 2099', startDate: '2099-04-01', endDate: '2099-06-30' });
  assert.strictEqual(made.status, 201, made.text);
  const id = made.json.id;
  const chips = async () => ((await call('GET', '/api/schedule')).json.find((e) => e.seasonId === id) || {}).categories;
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { registrationOpen: true, maxPlayers: 50, categories: ['OPEN'] })).status, 200);
  assert.deepStrictEqual((await call('GET', `/api/seasons/by-slug/${made.json.slug}`)).json.categories, ['OPEN']);
  assert.deepStrictEqual(await chips(), [], 'a season without categories has no category chips');
  // its groups are without a category too
  const bad = await call('POST', `/api/seasons/${id}/groups`, { name: 'Group A', category: 'ELITE' });
  assert.strictEqual(bad.status, 400, bad.text);
  const group = await call('POST', `/api/seasons/${id}/groups`, { name: 'Group A', category: 'OPEN' });
  assert.strictEqual(group.status, 201, group.text);
  assert.strictEqual(group.json.category, 'OPEN');
  // a public registration needs no category (and a category sent is ignored)
  const reg = await publicRegistration(id, { name: 'Open Player', email: 'open1@example.com', phone: '0903112233' });
  assert.strictEqual(reg.status, 201, reg.text);
  assert.strictEqual(reg.json.category, '');
  const sent = await publicRegistration(id, { name: 'Karol Bednar', email: 'open2@example.com', phone: '0903112244', category: 'ELITE' });
  assert.strictEqual(sent.status, 201, sent.text);
  assert.strictEqual(sent.json.category, '');
  // the admin can leave a registration without a category in a season like this, but not in a season with categories
  const regs = (await call('GET', `/api/seasons/${id}/registrations`)).json;
  assert.strictEqual((await call('PATCH', `/api/seasons/registrations/${regs[0].id}`, { category: '' })).status, 200);
  // back to categories: a category is needed again, and only one of the season's own
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { categories: ['ELITE', 'NEXT_GEN'] })).status, 200);
  assert.deepStrictEqual(await chips(), ['ELITE', 'NEXT_GEN']);
  const none = await publicRegistration(id, { name: 'Marek Zeman', email: 'open3@example.com', phone: '0903112255' });
  assert.strictEqual(none.status, 400);
  assert.strictEqual(none.json.code, 'BAD_CATEGORY');
  const outside = await publicRegistration(id, { name: 'Marek Zeman', email: 'open3@example.com', phone: '0903112255', category: 'NOVICE' });
  assert.strictEqual(outside.status, 400, 'Novice is not played in this season');
  assert.strictEqual((await publicRegistration(id, { name: 'Marek Zeman', email: 'open3@example.com', phone: '0903112255', category: 'ELITE' })).status, 201);
  assert.strictEqual((await call('PATCH', `/api/seasons/registrations/${regs[0].id}`, { category: '' })).status, 400, 'no "no category" in a season with categories');
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
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
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
