// Checks of the winners of a tournament of a community or club: its organiser (and nobody else but a site admin) edits the list linked to the tournament, the list
// shows on the page of the tournament and on the page of the community, and it never shows on the winners page of the league (/vitazi).
// Run: node scripts/check-club-winners.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubwinners-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;
let hit = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
  hit += 1;
  const h = { 'X-Forwarded-For': `10.${Math.floor(hit / 60000) % 250}.${Math.floor(hit / 250) % 250}.${hit % 250}` };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };
let seq = 0;
const uniq = (p) => `${p} ${(seq += 1)} ${Math.random().toString(36).slice(2, 6)}`;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09080${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}

// a club (approved) with its organiser and a tournament of it
async function club() {
  const owner = await makePlayer(uniq('Organizator'));
  const org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: uniq('Klub') } })).json;
  assert.ok(org && org.id, JSON.stringify(org));
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: true } })).status, 200);
  withDb((f) => f.prepare("UPDATE organisations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE id = ?").run(org.id));
  const made = await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: uniq('Turnaj'), playType: 'SINGLES', startDate: future(10), endDate: future(11) } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  return { owner, org, slug: withDb((f) => f.prepare('SELECT slug FROM organisations WHERE id = ?').get(org.id).slug), seasonId: made.json.id, seasonSlug: made.json.slug, seasonName: made.json.name };
}

let a;
let b;
let member;
let leagueSeasonId;
let edition;
let player;

test('set up: club A with its organiser and a plain member, club B, a league season', async () => {
  a = await club();
  b = await club();
  member = await makePlayer(uniq('Clen'));
  assert.strictEqual((await call('POST', `/api/communities/${a.org.id}/join`, { cookie: member.cookie })).status, 200);
  leagueSeasonId = (await call('POST', '/api/seasons', { body: { name: uniq('Liga'), kind: 'LEAGUE', startDate: future(10), endDate: future(60) } })).json.id;
  player = (await call('POST', '/api/players', { body: { name: uniq('Vitaz') } })).json;
});

test('the organiser makes the list of his tournament once; another club, a member, a visitor and a league season are refused', async () => {
  for (const [who, cookie] of [['organiser B', b.owner.cookie], ['member', member.cookie], ['visitor', '']]) {
    const r = await call('POST', '/api/winners/editions', { cookie, body: { title: 'x', seasonId: a.seasonId } });
    assert.strictEqual(r.status, 401, `${who}: ${r.status}`);
  }
  assert.strictEqual((await call('POST', '/api/winners/editions', { cookie: a.owner.cookie, body: { title: 'x', seasonId: b.seasonId } })).status, 401, 'the tournament of another club');
  assert.strictEqual((await call('POST', '/api/winners/editions', { cookie: a.owner.cookie, body: { title: 'x', seasonId: leagueSeasonId } })).status, 401, 'a league season');
  assert.strictEqual((await call('POST', '/api/winners/editions', { cookie: a.owner.cookie, body: { title: 'x' } })).status, 401, 'a list with no season is the site\'s');
  const made = await call('POST', '/api/winners/editions', { cookie: a.owner.cookie, body: { title: a.seasonName, seasonId: a.seasonId } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  edition = made.json;
  assert.strictEqual(edition.seasonId, a.seasonId);
  assert.strictEqual((await call('POST', '/api/winners/editions', { cookie: a.owner.cookie, body: { title: 'again', seasonId: a.seasonId } })).status, 409, 'one list per tournament');
});

test('the organiser fills it in (blocks, places); the others cannot change, delete or read it in the backend', async () => {
  const block = await call('POST', `/api/winners/editions/${edition.id}/blocks`, { cookie: a.owner.cookie, body: { category: 'ELITE' } });
  assert.strictEqual(block.status, 201, JSON.stringify(block.json));
  const blockId = block.json.blocks[0].id;
  const saved = await call('PUT', `/api/winners/blocks/${blockId}/places`, { cookie: a.owner.cookie, body: { places: [{ slot: 1, playerId: player.id }, { slot: 2, name: 'Typed Finalist' }] } });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.deepStrictEqual(saved.json.blocks[0].places.map((p) => p.name), [player.name, 'Typed Finalist']);
  const placeId = saved.json.blocks[0].places[0].placeId;
  assert.strictEqual((await call('PATCH', `/api/winners/blocks/${blockId}`, { cookie: a.owner.cookie, body: { category: 'NOVICE' } })).status, 200);
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { cookie: a.owner.cookie, body: { title: 'Nové meno', visible: true } })).status, 200);
  // not to another season, not reordered
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { cookie: a.owner.cookie, body: { seasonId: b.seasonId } })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { cookie: a.owner.cookie, body: { sortOrder: -5 } })).status, 401);
  for (const [who, cookie] of [['organiser B', b.owner.cookie], ['member', member.cookie], ['visitor', '']]) {
    const tries = [
      ['PATCH', `/api/winners/editions/${edition.id}`, { title: 'hack' }],
      ['DELETE', `/api/winners/editions/${edition.id}`],
      ['POST', `/api/winners/editions/${edition.id}/blocks`, { category: 'ELITE' }],
      ['PATCH', `/api/winners/blocks/${blockId}`, { category: 'ELITE' }],
      ['PUT', `/api/winners/blocks/${blockId}/places`, { places: [] }],
      ['DELETE', `/api/winners/blocks/${blockId}`],
      ['POST', `/api/winners/places/${placeId}/photo`],
      ['DELETE', `/api/winners/places/${placeId}/photo`],
      ['GET', `/api/winners/all?seasonId=${a.seasonId}`],
      ['GET', '/api/winners/all'],
    ];
    for (const [method, url, body] of tries) {
      const r = await call(method, url, { cookie, body });
      assert.strictEqual(r.status, 401, `${who} ${method} ${url} -> ${r.status}`);
    }
  }
  const mine = await call('GET', `/api/winners/all?seasonId=${a.seasonId}`, { cookie: a.owner.cookie });
  assert.strictEqual(mine.status, 200);
  assert.strictEqual(mine.json.length, 1);
  assert.strictEqual(mine.json[0].title, 'Nové meno');
  assert.strictEqual((await call('GET', '/api/winners/all', { cookie: a.owner.cookie })).status, 401, 'the whole list of the league is the site admin\'s');
  assert.strictEqual((await call('GET', `/api/winners/all?seasonId=${leagueSeasonId}`, { cookie: a.owner.cookie })).status, 401);
  assert.strictEqual((await call('GET', `/api/winners/all?seasonId=${a.seasonId}`)).status, 200, 'the site admin sees it too');
});

test('the list shows for the tournament and for the community, never on the winners page of the league; hidden → nowhere', async () => {
  const league = await call('GET', '/api/winners', { cookie: '' });
  assert.strictEqual(league.status, 200);
  assert.ok(!league.json.some((e) => e.seasonSlug === a.seasonSlug), '/vitazi does not list a tournament of a community');
  const ofSeason = await call('GET', `/api/winners?seasonId=${a.seasonId}`, { cookie: '' });
  assert.strictEqual(ofSeason.json.length, 1);
  assert.strictEqual(ofSeason.json[0].seasonSlug, a.seasonSlug);
  const ofClub = await call('GET', `/api/winners?organisation=${encodeURIComponent(a.slug)}`, { cookie: '' });
  assert.strictEqual(ofClub.json.length, 1);
  assert.strictEqual(ofClub.json[0].seasonName, a.seasonName);
  assert.strictEqual(ofClub.json[0].blocks[0].places[0].name, player.name);
  assert.deepStrictEqual((await call('GET', `/api/winners?organisation=${encodeURIComponent(b.slug)}`, { cookie: '' })).json, [], 'club B has none');
  // not visible → nowhere (but its organiser still sees it)
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { cookie: a.owner.cookie, body: { visible: false } })).status, 200);
  assert.deepStrictEqual((await call('GET', `/api/winners?seasonId=${a.seasonId}`, { cookie: '' })).json, []);
  assert.deepStrictEqual((await call('GET', `/api/winners?organisation=${encodeURIComponent(a.slug)}`, { cookie: '' })).json, []);
  assert.strictEqual((await call('GET', `/api/winners/all?seasonId=${a.seasonId}`, { cookie: a.owner.cookie })).json.length, 1);
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { cookie: a.owner.cookie, body: { visible: true } })).status, 200);
  // a hidden community shows nothing
  withDb((f) => f.prepare('UPDATE organisations SET hidden = 1 WHERE id = ?').run(a.org.id));
  assert.deepStrictEqual((await call('GET', `/api/winners?organisation=${encodeURIComponent(a.slug)}`, { cookie: '' })).json, []);
  assert.deepStrictEqual((await call('GET', `/api/winners?seasonId=${a.seasonId}`, { cookie: '' })).json, []);
  withDb((f) => f.prepare('UPDATE organisations SET hidden = 0 WHERE id = ?').run(a.org.id));
  assert.strictEqual((await call('GET', `/api/winners?seasonId=${a.seasonId}`, { cookie: '' })).json.length, 1);
});

test('the site admin still has the lists of the league as before; a site admin can edit the list of a community too', async () => {
  const made = await call('POST', '/api/winners/editions', { body: { title: 'Liga 2025', seasonId: leagueSeasonId } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual((await call('POST', `/api/winners/editions/${made.json.id}/blocks`, { body: { category: 'ELITE' } })).status, 201);
  const all = await call('GET', '/api/winners/all');
  assert.ok(all.json.some((e) => e.id === made.json.id));
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${edition.id}`, { body: { title: 'Admin edit' } })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/winners/editions/${made.json.id}`)).status, 200);
});

test('the pages: the tab in the card of a community tournament, the end of the page of the tournament, the Events tab of the community', () => {
  const admin = read('js/seasons-admin.js');
  assert.ok(admin.includes(".concat([['winners', tl('Víťazi', 'Winners')]])"), 'the tab is in every card, also of a community');
  assert.ok(admin.includes("window.mountWinnersPanel(winnersHost, { id, name: season.name, club: CLUB })"));
  assert.ok(read('club-tournament.html').includes('/js/winners-panel.js'), 'the page of the organiser loads the panel');
  assert.ok(read('js/winners-panel.js').includes('/winners/all?seasonId=${season.id}'), 'the panel asks for the lists of its season');
  assert.ok(read('js/season.js').includes('`/winners?seasonId=${season.id}`'), 'the page of the tournament asks for the list of its season');
  const community = read('js/community.js');
  assert.ok(!community.includes('winnersHtml()'), 'the community page has no winners block under its events any more (the winners are shared as a news post, comBindWinners)');
  const i18n = read('js/i18n.js');
  assert.strictEqual(i18n.split("'com.winners':").length - 1, 2, 'the heading in both languages');
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
    const login = await call('POST', '/api/admin/login', { cookie: '', body: { password: 'test' } });
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
