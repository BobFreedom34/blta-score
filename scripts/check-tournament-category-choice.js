// Checks of the categories of a tournament: a tournament played in only some of the categories (Elite and Next Gen) has only those in the sorting screen and in
// the draw; a tournament "Bez kategórie" (no categories) needs no sorting - every registered player is in one draw.
// Run: node scripts/check-tournament-category-choice.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcats-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let counter = 0;

async function call(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const tournament = async (over = {}) => {
  counter += 1;
  const made = await call('POST', '/api/seasons', { name: `Kategorie ${counter}`, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-03', ...over });
  assert.strictEqual(made.status, 201, made.text);
  return made.json;
};
// registers `count` players (with a profile) with the given category ('' = not sorted yet)
async function register(season, count, category = '') {
  const regs = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = await call('POST', '/api/players', { name: `Hrac Kat ${counter}` });
    assert.strictEqual(p.status, 201, p.text);
    const r = await call('POST', `/api/seasons/${season.id}/registrations/admin`, { playerId: p.json.id, category, phone: `0903${String(200000 + counter)}`, email: `k${counter}@example.com` });
    assert.strictEqual(r.status, 201, r.text);
    regs.push(r.json);
  }
  return regs;
}
const overview = async (season) => (await call('GET', `/api/seasons/${season.id}/draw`)).json.categories;

test('the categories of a tournament are stored as chosen: some of them, none ("Bez kategórie", OPEN wins over the others) or all (nothing chosen)', async () => {
  const t = await tournament();
  assert.deepStrictEqual(t.categories, ['ELITE', 'NEXT_GEN', 'NOVICE'], 'all of them by default');
  const two = await call('PATCH', `/api/seasons/${t.id}`, { categories: ['ELITE', 'NEXT_GEN'] });
  assert.deepStrictEqual(two.json.categories, ['ELITE', 'NEXT_GEN']);
  const none = await call('PATCH', `/api/seasons/${t.id}`, { categories: ['OPEN'] });
  assert.strictEqual(none.status, 200, none.text);
  assert.deepStrictEqual(none.json.categories, ['OPEN']);
  const mixed = await call('PATCH', `/api/seasons/${t.id}`, { categories: ['OPEN', 'ELITE'] });
  assert.deepStrictEqual(mixed.json.categories, ['OPEN'], 'no categories wins when it is ticked');
  const reset = await call('PATCH', `/api/seasons/${t.id}`, { categories: [] });
  assert.deepStrictEqual(reset.json.categories, ['ELITE', 'NEXT_GEN', 'NOVICE'], 'none ticked = all of them, as before');
  const created = await tournament({ categories: ['OPEN'] });
  assert.deepStrictEqual(created.categories, ['OPEN'], 'a new tournament can be made without categories');
});

test('only the chosen categories are in the draw overview and can be used: sorting players into another one, seeding it and drawing it are refused', async () => {
  const t = await tournament({ categories: ['ELITE', 'NEXT_GEN'] });
  const regs = await register(t, 4);
  assert.deepStrictEqual((await overview(t)).map((c) => c.category), ['ELITE', 'NEXT_GEN']);
  const noviceAssign = await call('POST', `/api/seasons/${t.id}/registrations/categories`, { assignments: [{ id: regs[0].id, category: 'NOVICE' }] });
  assert.strictEqual(noviceAssign.status, 400, noviceAssign.text);
  const eliteAssign = await call('POST', `/api/seasons/${t.id}/registrations/categories`, { assignments: regs.map((r) => ({ id: r.id, category: 'ELITE' })) });
  assert.strictEqual(eliteAssign.status, 200, eliteAssign.text);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/seeds`, { category: 'NOVICE', seeds: [] })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw`, { category: 'NOVICE', mode: 'AUTO' })).status, 400);
  const made = await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  // a tournament that is played in all categories still offers all three
  assert.deepStrictEqual((await overview(await tournament())).map((c) => c.category), ['ELITE', 'NEXT_GEN', 'NOVICE']);
});

test('a tournament without categories: one draw "Bez kategórie" with every registered player, no sorting needed, matches carry no league category', async () => {
  const t = await tournament({ categories: ['OPEN'] });
  await register(t, 3, '');
  await register(t, 1, 'ELITE'); // an entry that was sorted before the tournament lost its categories is in the draw as well
  const cats = await overview(t);
  assert.deepStrictEqual(cats.map((c) => [c.category, c.label, c.players]), [['OPEN', 'Bez kategórie', 4]]);
  const sort = await call('POST', `/api/seasons/${t.id}/registrations/categories`, { assignments: [] });
  assert.strictEqual(sort.status, 400, 'there is nothing to sort');
  const made = await call('POST', `/api/seasons/${t.id}/draw`, { category: 'OPEN', mode: 'AUTO' });
  assert.strictEqual(made.status, 201, made.text);
  const main = (await call('GET', `/api/brackets/${made.json.main}`)).json;
  assert.deepStrictEqual([main.size, main.category, main.season.id], [4, 'OPEN', t.id]);
  const first = main.nodes.find((n) => n.round === 1 && n.match);
  assert.ok(first, 'the round has real matches');
  const match = (await call('GET', `/api/matches/${first.match.token}`)).json;
  assert.strictEqual(match.category, 'OTHER', 'a match of a tournament without categories counts in no league table');
  assert.strictEqual(match.season && match.season.id, t.id);
  const second = await call('POST', `/api/seasons/${t.id}/draw`, { category: 'OPEN', mode: 'AUTO' });
  assert.strictEqual(second.status, 409, 'one draw only');
  assert.strictEqual((await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', mode: 'AUTO' })).status, 400, 'there is no Elite in it');
  const brackets = (await call('GET', `/api/seasons/${t.id}/brackets`)).json;
  assert.ok(brackets.some((b) => b.category === 'OPEN'), 'the public list of the brackets of the tournament has it');
});

test('a tournament without categories can be played in groups with a bracket too: the groups carry no league category', async () => {
  const t = await tournament({ categories: ['OPEN'] });
  await register(t, 6, '');
  const made = await call('POST', `/api/seasons/${t.id}/draw`, { category: 'OPEN', mode: 'AUTO', format: 'GROUPS_BRACKET', groupSize: 3, qualifiers: 2 });
  assert.strictEqual(made.status, 201, made.text);
  const open = (await overview(t)).find((c) => c.category === 'OPEN');
  assert.strictEqual(open.stage, 'GROUPS');
  assert.strictEqual(open.groups.groups.length, 2, JSON.stringify(open.groups).slice(0, 200));
  assert.ok(open.groups.groups.every((g) => g.name.startsWith('Bez kategórie — ')), 'the groups are named after the draw: ' + open.groups.groups.map((g) => g.name));
  const matches = (await call('GET', `/api/matches?season=${t.id}`)).json;
  const list = (Array.isArray(matches) ? matches : (matches.items || matches.matches || [])).filter((m) => m.season && m.season.id === t.id);
  assert.ok(list.length >= 6, 'the group matches exist');
  assert.ok(list.every((m) => m.category === 'OTHER'), 'none of them is a league match: ' + JSON.stringify(list.map((m) => [m.category, m.stage, m.season && m.season.id])));
});

test('a doubles tournament is not touched: only Štvorhra; and a league season has no categories to choose', async () => {
  const d = await tournament({ playType: 'DOUBLES' });
  assert.deepStrictEqual((await overview(d)).map((c) => c.category), ['DOUBLES']);
  assert.strictEqual((await call('PATCH', `/api/seasons/${d.id}`, { categories: ['OPEN'] })).json.categories[0], 'DOUBLES');
});

const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

test('the editor of a tournament offers "Bez kategórie" (it switches the three categories off), hides the sorting tab for it, and the sorting tab and the draw follow the categories of the tournament', () => {
  const editor = read('js/seasons-admin.js');
  assert.ok(editor.includes('data-cat="OPEN"') && editor.includes('Bez kategórie'), 'the checkbox is in the editor');
  assert.ok(/data-cat="OPEN"[^>]*>/.test(editor) && editor.includes("[data-cat]:not([data-cat=\"OPEN\"])"), 'ticking it switches the others off');
  assert.ok(editor.includes("s.categories.includes('OPEN') && key === 'assign'"), 'no "Zaradenie do kategórií" tab without categories');
  assert.ok(editor.includes('openAssignPanel(assignHost, id, () => {}, season.categories)'), 'the sorting tab gets the categories of the tournament');
  const assign = read('js/season-assign.js');
  assert.ok(assign.includes('async function openAssignPanel(host, seasonId, onSaved, categories)') && assign.includes('cats.map('), 'the sorting tab shows only those');
  assert.ok(assign.includes('function assignSuggestByStrength(todo, all, keys'), 'the automatic suggestion splits into as many parts as there are categories');
  const dialog = read('js/community.js');
  assert.ok(dialog.includes('id="com-t-open"') && dialog.includes("noCategory.checked ? ['OPEN']") && dialog.includes("t('com.tNoCategory')"), 'the create dialog of a club has Bez kategórie too');
  const publicPage = read('js/season.js');
  assert.ok(publicPage.includes("CATEGORY_ORDER_ALL = [...CATEGORY_ORDER, 'DOUBLES', 'OPEN']") && publicPage.includes('get OPEN()'), 'the public page shows the draw without categories');
  const i18n = read('js/i18n.js');
  ['season.catOpen', 'com.tNoCategory'].forEach((k) => assert.strictEqual(i18n.split("'" + k + "':").length, 3, k + ' in both languages'));
  const draw = read('js/season-draw.js');
  assert.ok(draw.includes("const rowsOf = (category) => (category === 'OPEN' ? regs"), 'the draw of a tournament without categories takes everybody who registered');
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
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
