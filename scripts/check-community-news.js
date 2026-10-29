// Checks that a tournament of a community or club is also a piece of its news: it carries the day it was published, and its card looks like a row of the
// Harmonogram (the date, the name with the TURNAJ and club tags, the categories, the Registrácia and Viac info buttons) in the Novinky tab and in the Feed.
// Run: node scripts/check-community-news.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-news-'));
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
  const phone = `09150${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const founders = new Map();
const sqlOwner = (orgId) => founders.get(orgId);
let owner;
let member;
let org;
let tournament;

test('setup: a community with a member and a tournament with two categories', async () => {
  [owner, member] = [await makePlayer('Nov Majitel'), await makePlayer('Nov Clen')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Novinky komunita', description: 'x' } })).json;
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie })).status, 200);
  const made = await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: 'Skuska', venue: 'Tennis ONE', startDate: '2026-10-30', endDate: '2026-11-01', playType: 'SINGLES', categories: ['ELITE', 'NEXT_GEN'] } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  tournament = made.json;
});

test('the tournaments of a community say when they were made and who runs them (for the Novinky tab)', async () => {
  const list = (await call('GET', `/api/communities/${org.id}/tournaments`, { cookie: '' })).json.items;
  const item = list.find((s) => s.id === tournament.id);
  assert.ok(item, 'listed');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(item.createdAt), item.createdAt);
  assert.deepStrictEqual([item.organisation.name, item.organisation.slug, item.categories], ['Novinky komunita', org.slug, ['ELITE', 'NEXT_GEN']]);
});

test('the feed card of a tournament carries what the Harmonogram row shows: dates, venue, categories, registration', async () => {
  const item = (await call('GET', '/api/communities/feed', { cookie: member.cookie })).json.items.find((i) => i.type === 'TOURNAMENT' && i.id === tournament.id);
  assert.ok(item, 'in the feed');
  assert.deepStrictEqual([item.startDate, item.endDate, item.venue, item.categories, item.organisation.name], ['2026-10-30', '2026-11-01', 'Tennis ONE', ['ELITE', 'NEXT_GEN'], 'Novinky komunita']);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(item.createdAt));
  assert.strictEqual(typeof item.registrationOpen, 'boolean');
});

test('the Udalosti tab: the tournaments of the communities the player is a member of, the coming ones first; not those of other communities; a visitor is refused', async () => {
  const founder = await makePlayer('Nov Iny Majitel');
  const other = (await call('POST', '/api/communities', { cookie: founder.cookie, body: { type: 'COMMUNITY', name: 'Cudzia komunita', description: 'x' } })).json;
  founders.set(other.id, founder);
  const otherOwner = sqlOwner(other.id);
  assert.ok(otherOwner);
  const strangerTournament = await call('POST', `/api/communities/${other.id}/tournaments`, { cookie: otherOwner.cookie, body: { name: 'Cudzi turnaj', startDate: '2026-12-01', endDate: '2026-12-02', playType: 'SINGLES' } });
  assert.strictEqual(strangerTournament.status, 201, JSON.stringify(strangerTournament.json));
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const long = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const longEnd = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: 'Davny turnaj', startDate: long, endDate: longEnd, playType: 'SINGLES' } });
  await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: owner.cookie, body: { name: 'Blizky turnaj', startDate: soon, endDate: soon, playType: 'SINGLES' } });
  const mine = await call('GET', '/api/communities/my-events', { cookie: member.cookie });
  assert.strictEqual(mine.status, 200, JSON.stringify(mine.json));
  const names = mine.json.items.map((s) => s.name);
  assert.ok(names.includes('Skuska') && names.includes('Blizky turnaj') && names.includes('Davny turnaj'));
  assert.ok(!names.includes('Cudzi turnaj'), 'only his own communities');
  assert.ok(names.indexOf('Blizky turnaj') < names.indexOf('Davny turnaj'), 'the coming ones before the finished ones');
  const first = mine.json.items[0];
  assert.ok(first.organisation.slug && Array.isArray(first.categories) && typeof first.registrationOpen === 'boolean');
  assert.strictEqual((await call('GET', '/api/communities/my-events', { cookie: '' })).status, 401);
  const stranger = await makePlayer('Nov Bez Komunity');
  assert.deepStrictEqual((await call('GET', '/api/communities/my-events', { cookie: stranger.cookie })).json.items, []);
});

test('the page side: one card like a Harmonogram row, with the day it was posted, in the Novinky tab (merged with the posts by date) and in the Feed', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const shared = pub('js/community-post.js');
  assert.ok(shared.includes('function comTournamentRow') && shared.includes('class="sch-row link') && shared.includes('sch-date') && shared.includes('sch-reg') && shared.includes('sch-go') && shared.includes('sch-tag sch-club'), 'the same markup as the Harmonogram row');
  assert.ok(shared.includes('function comTournamentNewsHtml') && shared.includes('function comBindTournaments'));
  const club = pub('js/community.js');
  assert.ok(club.includes('comTournamentNewsHtml(') && club.includes('function newsItems') && club.includes('comBindTournaments('), 'the Novinky tab shows the tournaments among the posts');
  assert.ok(/dateText\(s\.createdAt\)|dateText\(t\.createdAt\)|dateText\(item\.createdAt\)/.test(club), 'with the day it was posted');
  const feed = pub('js/communities.js');
  assert.ok(feed.includes('comTournamentNewsHtml(') && feed.includes('comBindTournaments(') && feed.includes('dateText(p.createdAt)'), 'the Feed too');
  assert.ok(feed.includes('/communities/my-events') && feed.includes('comTournamentRow('), 'the Udalosti tab lists the events of his communities as the same cards');
  const i18n = pub('js/i18n.js');
  for (const key of ['com.eventsNone', 'com.eventsLogin']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  const css = pub('css/style.css');
  assert.ok(/.com-news-tournament .sch-row.link:hover {[^}]*background/.test(css), 'the card gets a background on hover, like a row of the schedule');
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
