// Checks of the maximum number of players that can register for a tournament or a season, and the substitutes (náhradníci): the maximum has to be entered to open the
// registration, the ones after it are substitutes (never in the draw), and when somebody drops out - or the maximum is raised - the first substitute is in.
// Run: node scripts/check-registration-limit.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglimit-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let n = 0;

async function call(method, url, { cookie = adminCookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
// a public registration (a different address each time: the form allows only a few from one)
async function register(season, name, extra = {}) {
  n += 1;
  return call('POST', `/api/seasons/${season.id}/registrations`, {
    cookie: '', headers: { 'x-forwarded-for': `10.9.${Math.floor(n / 250)}.${n % 250}` },
    body: { name, phone: `0905${String(100000 + n)}`, email: `p${n}@example.com`, ...extra },
  });
}
const makeSeason = async (over) => {
  const r = await call('POST', '/api/seasons', { body: { name: `Limit ${(n += 1)}`, startDate: '2099-06-01', endDate: '2099-06-02', ...over } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const patch = (season, body) => call('PATCH', `/api/seasons/${season.id}`, { body });
const list = async (season) => (await call('GET', `/api/seasons/${season.id}/registrations`)).json;
const flags = (rows) => rows.map((r) => `${r.name}${r.substitute ? `:S${r.substitutePosition}` : ''}`);

let tournament = null;

test('the registration cannot be opened without the maximum number of players; with it, it opens', async () => {
  tournament = await makeSeason({ kind: 'TOURNAMENT', playType: 'SINGLES', categories: ['OPEN'] });
  const no = await patch(tournament, { registrationOpen: true });
  assert.strictEqual(no.status, 400);
  assert.strictEqual(no.json.code, 'MAX_PLAYERS_REQUIRED');
  for (const bad of ['abc', -3, 2001, 1.5]) assert.strictEqual((await patch(tournament, { maxPlayers: bad })).status, 400, `maxPlayers ${bad}`);
  const ok = await patch(tournament, { registrationOpen: true, maxPlayers: 3 });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.maxPlayers, 3);
  assert.strictEqual((await patch(tournament, { name: 'Renamed' })).status, 200, 'a save that does not touch the registration is not stopped');
  // closed registration needs none; an empty maximum with the registration open is refused again
  assert.strictEqual((await patch(tournament, { registrationOpen: false, maxPlayers: null })).status, 200);
  assert.strictEqual((await patch(tournament, { registrationOpen: true })).status, 400);
  assert.strictEqual((await patch(tournament, { registrationOpen: true, maxPlayers: 3 })).status, 200);
});

test('the first players are in, the next ones are substitutes in the order they registered (the form tells it)', async () => {
  const names = ['Ada One', 'Boris Two', 'Cyril Three', 'Dana Four', 'Egon Five'];
  const results = [];
  for (const name of names) results.push(await register(tournament, name));
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.json)));
  assert.deepStrictEqual(results.map((r) => r.json.substitute), [false, false, false, true, true]);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Boris Two', 'Cyril Three', 'Dana Four:S1', 'Egon Five:S2']);
});

test('the public page of the tournament shows who is a substitute and how full it is, without contact details', async () => {
  const page = (await call('GET', `/api/seasons/by-slug/${tournament.slug}`, { cookie: '' })).json;
  assert.deepStrictEqual(page.registrations.map((r) => [r.name, r.substitute, r.substitutePosition]), [['Ada One', false, null], ['Boris Two', false, null], ['Cyril Three', false, null], ['Dana Four', true, 1], ['Egon Five', true, 2]]);
  assert.deepStrictEqual(page.capacity[''], { limit: 3, in: 3, waiting: 2 });
  assert.strictEqual(page.maxPlayers, 3);
  assert.ok(page.registrations.every((r) => !('email' in r) && !('phone' in r)));
});

test('the substitutes are not in the draw; the CSV says who is a substitute', async () => {
  const draw = (await call('GET', `/api/seasons/${tournament.id}/draw`)).json;
  assert.strictEqual(draw.categories.find((c) => c.category === 'OPEN').players, 3);
  const csv = (await call('GET', `/api/seasons/${tournament.id}/registrations.csv`)).res;
  const text = await csv.text();
  assert.ok(text.includes('náhradník 1') && text.includes('náhradník 2') && text.includes('v turnaji'), text);
});

test('somebody drops out (the admin deletes the registration): the first substitute is in, the next one is first on the list', async () => {
  const rows = await list(tournament);
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${rows[1].id}`)).status, 200);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Cyril Three', 'Dana Four', 'Egon Five:S1']);
  const draw = (await call('GET', `/api/seasons/${tournament.id}/draw`)).json;
  assert.strictEqual(draw.categories.find((c) => c.category === 'OPEN').players, 3, 'the substitute who came in is in the draw');
  // a substitute who drops out changes nothing for the others
  const again = await list(tournament);
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${again[3].id}`)).status, 200);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Cyril Three', 'Dana Four']);
});

test('raising the maximum lets the substitutes in; lowering it sends the last ones to wait', async () => {
  for (const name of ['Fero Six', 'Gita Seven']) assert.strictEqual((await register(tournament, name)).status, 201);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Cyril Three', 'Dana Four', 'Fero Six:S1', 'Gita Seven:S2']);
  assert.strictEqual((await patch(tournament, { maxPlayers: 4 })).status, 200);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Cyril Three', 'Dana Four', 'Fero Six', 'Gita Seven:S1']);
  assert.strictEqual((await patch(tournament, { maxPlayers: 2 })).status, 200);
  assert.deepStrictEqual(flags(await list(tournament)), ['Ada One', 'Cyril Three', 'Dana Four:S1', 'Fero Six:S2', 'Gita Seven:S3']);
  assert.strictEqual((await patch(tournament, { maxPlayers: 10 })).status, 200);
  assert.ok((await list(tournament)).every((r) => !r.substitute));
});

test('a player the admin adds when the maximum is reached is a substitute too', async () => {
  assert.strictEqual((await patch(tournament, { maxPlayers: 5 })).status, 200);
  const made = await call('POST', '/api/players', { body: { name: 'Hugo Admin' } });
  const added = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { body: { playerId: made.json.id, category: '' } });
  assert.strictEqual(added.status, 201, JSON.stringify(added.json));
  assert.strictEqual(added.json.substitute, true, 'five are in already');
  assert.strictEqual(added.json.substitutePosition, 1);
});

test('a season where the player chooses the category: a maximum for each category, all needed to open; the categories do not use each other\'s places', async () => {
  const season = await makeSeason({ kind: 'LEAGUE', categories: ['ELITE', 'NOVICE'] });
  assert.strictEqual((await patch(season, { registrationOpen: true })).status, 400);
  assert.strictEqual((await patch(season, { registrationOpen: true, categoryMax: { ELITE: 1 } })).status, 400, 'Novice has none yet');
  const ok = await patch(season, { registrationOpen: true, categoryMax: { ELITE: 1, NOVICE: 2 } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.deepStrictEqual(ok.json.categoryMax, { ELITE: 1, NOVICE: 2 });
  const r = [];
  for (const [name, category] of [['Zdenko Elitny', 'ELITE'], ['Marek Silny', 'ELITE'], ['Pavol Novak', 'NOVICE'], ['Juraj Mlady', 'NOVICE'], ['Karol Stary', 'NOVICE']]) { const made = await register(season, name, { category }); assert.strictEqual(made.status, 201, JSON.stringify(made.json)); r.push(made.json.substitute); }
  assert.deepStrictEqual(r, [false, true, false, false, true]);
  assert.deepStrictEqual(flags(await list(season)), ['Zdenko Elitny', 'Marek Silny:S1', 'Pavol Novak', 'Juraj Mlady', 'Karol Stary:S1']);
  const page = (await call('GET', `/api/seasons/by-slug/${season.slug}`, { cookie: '' })).json;
  assert.deepStrictEqual([page.capacity.ELITE, page.capacity.NOVICE], [{ limit: 1, in: 1, waiting: 1 }, { limit: 2, in: 2, waiting: 1 }]);
  // an Elite player drops out: the Elite substitute is in, Novice is untouched
  const rows = await list(season);
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${rows[0].id}`)).status, 200);
  assert.deepStrictEqual(flags(await list(season)), ['Marek Silny', 'Pavol Novak', 'Juraj Mlady', 'Karol Stary:S1']);
});

test('a doubles tournament counts pairs: both partners registering the same pair is one place; a pair of substitutes gets its pair when it comes in', async () => {
  const names = ['Pa Alfa', 'Pa Beta', 'Pa Gama', 'Pa Delta'];
  const ids = [];
  for (const name of names) ids.push((await call('POST', '/api/players', { body: { name } })).json.id);
  const season = await makeSeason({ kind: 'TOURNAMENT', playType: 'DOUBLES' });
  assert.strictEqual((await patch(season, { registrationOpen: true, maxPlayers: 1 })).status, 200);
  assert.strictEqual((await register(season, 'Pa Alfa', { partner: 'Pa Beta', playerId: ids[0] })).json.substitute, false);
  assert.strictEqual((await register(season, 'Pa Beta', { partner: 'Pa Alfa', playerId: ids[1] })).json.substitute, false, 'the partner names the same pair back: the same place');
  const third = await register(season, 'Pa Gama', { partner: 'Pa Delta', playerId: ids[2] });
  assert.strictEqual(third.json.substitute, true, 'a second pair waits');
  const pairs = async () => (await call('GET', `/api/seasons/${season.id}/doubles`)).json.pairs.map((p) => `${p.player.name}/${p.partner.name}`);
  assert.deepStrictEqual(await pairs(), ['Pa Alfa/Pa Beta'], 'no pair is made for the substitutes');
  const rows = await list(season);
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${rows[0].id}`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${rows[1].id}`)).status, 200);
  assert.deepStrictEqual(flags(await list(season)), ['Pa Gama']);
  assert.ok((await pairs()).includes('Pa Gama/Pa Delta'), 'the pair is made when it comes in: ' + JSON.stringify(await pairs()));
});

test('the pages: the maximum field is in the form, the registration list shows the substitutes, the public page lists them apart and says it on the form', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const admin = read('js/seasons-admin.js');
  assert.ok(admin.includes("input('maxPlayers'") && admin.includes('data-catmax="${k}"'), 'the fields of the maximum');
  assert.ok(admin.includes('MAX_MISSING_TEXT()') && admin.includes('...maxBody(e.target)'), 'the form asks for it and sends it');
  assert.ok(admin.includes("Náhradník č.") && admin.includes("chip('sub'"), 'the list shows the substitutes');
  const pub = read('js/season.js');
  assert.ok(pub.includes("t('season.substitutes')") && pub.includes('id="sv-reg-full"') && pub.includes("'season.regDoneSub'"), 'the public page');
  const i18n = read('js/i18n.js');
  for (const key of ['substitutes', 'substitutesNote', 'regFull', 'regSendSub', 'regDoneSub']) assert.strictEqual((i18n.match(new RegExp(`'season\\.${key}':`, 'g')) || []).length, 2, `season.${key} in both languages`);
  for (const f of ['js/seasons-admin.js', 'js/season.js', 'js/season-assign.js', 'js/season-draw.js']) new (require('vm').Script)(read(f), { filename: f });
});

// ---------------------------------------------------------------- run
async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
