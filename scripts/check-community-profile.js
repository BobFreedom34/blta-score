// Checks of the profile of a community or club: its web page, Facebook and Instagram links (src/routes/communities.js: readFields), deleting it from the
// settings, and the join information on the card of the list.
// Run: node scripts/check-community-profile.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-profile-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const sql = (query, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
};
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09120${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let seq = 0;
const make = async (_unused, extra = {}) => {
  const founder = await makePlayer(`Zakladatel ${seq += 1}`);
  const org = (await call('POST', '/api/communities', { cookie: founder.cookie, body: { type: 'COMMUNITY', name: `Profil ${seq}`, description: 'x', ...extra } })).json;
  assert.ok(org.id, JSON.stringify(org));
  org.admin = founder;
  return org;
};
const patch = (org, who, body) => call('PATCH', `/api/communities/${org.id}`, { cookie: who.cookie, body: { name: org.name, ...body } });
let owner;
let member;
let stranger;

test('setup: an owner, a member and a stranger', async () => {
  [owner, member, stranger] = [await makePlayer('Prof Majitel'), await makePlayer('Prof Clen'), await makePlayer('Prof Cudzi')];
});

test('a community has a web page, a Facebook page and an Instagram page: saved, shown to everybody, cleared with an empty text', async () => {
  const org = await make(owner);
  const links = { website: 'https://www.mojklub.sk/', facebook: 'https://www.facebook.com/mojklub', instagram: 'https://www.instagram.com/mojklub/' };
  const done = await patch(org, org.admin, links);
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.deepStrictEqual([done.json.website, done.json.facebook, done.json.instagram], [links.website, links.facebook, links.instagram]);
  const seen = (await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json;
  assert.deepStrictEqual([seen.website, seen.facebook, seen.instagram], [links.website, links.facebook, links.instagram]);
  const part = await patch(org, org.admin, { description: 'Nový popis' });
  assert.strictEqual(part.json.website, links.website, 'a change that does not mention the links keeps them');
  const cleared = await patch(org, org.admin, { website: '', facebook: '  ' });
  assert.deepStrictEqual([cleared.json.website, cleared.json.facebook, cleared.json.instagram], ['', '', links.instagram]);
  const created = await make(owner, { website: 'https://novy.example.sk', instagram: 'https://instagram.com/novy' });
  assert.deepStrictEqual([created.website, created.instagram, created.facebook], ['https://novy.example.sk', 'https://instagram.com/novy', '']);
});

test('only web links are taken: http(s), the right site for Facebook and Instagram, not too long', async () => {
  const org = await make(owner);
  const bad = [
    { website: 'javascript:alert(1)' }, { website: 'ftp://example.com' }, { website: 'not a link' }, { website: `https://example.com/${'a'.repeat(300)}` },
    { facebook: 'https://evil.example.com/facebook.com' }, { facebook: 'https://notfacebook.com/x' }, { instagram: 'https://facebook.com/x' }, { instagram: 'http://' }, { website: 12 },
  ];
  for (const body of bad) assert.strictEqual((await patch(org, org.admin, body)).status, 400, JSON.stringify(body).slice(0, 70));
  for (const body of [{ facebook: 'https://m.facebook.com/klub' }, { facebook: 'https://fb.me/klub' }, { instagram: 'https://instagr.am/klub' }, { website: 'http://example.sk' }]) {
    assert.strictEqual((await patch(org, org.admin, body)).status, 200, JSON.stringify(body));
  }
});

test('only an admin of the community changes the links', async () => {
  const org = await make(owner);
  assert.strictEqual((await patch(org, stranger, { website: 'https://x.example.sk' })).status, 403);
  assert.strictEqual((await patch(org, { cookie: '' }, { website: 'https://x.example.sk' })).status, 401);
});

test('a community that decides on every request shows no links to those who are not members', async () => {
  const org = await make(owner, { joinPolicy: 'APPROVAL' });
  await patch(org, org.admin, { website: 'https://tajne.example.sk' });
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: stranger.cookie })).json.website, '');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: org.admin.cookie })).json.website, 'https://tajne.example.sk');
});

test('deleting: an admin of the community deletes it with its members, news, reactions, pictures and invitations; a member, a stranger and a visitor cannot', async () => {
  const org = await make(owner);
  await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie });
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const up = await (await fetch(`${base}/api/communities/${org.id}/post-image`, { method: 'POST', headers: { Cookie: org.admin.cookie }, body: form })).json();
  const post = (await call('POST', `/api/communities/${org.id}/posts`, { cookie: org.admin.cookie, body: { body: 'Sprava', imageUrl: up.url } })).json;
  await call('POST', `/api/communities/${org.id}/posts/${post.id}/reactions`, { cookie: member.cookie, body: { emoji: '🔥' } });
  await call('POST', `/api/communities/${org.id}/invite-players`, { cookie: org.admin.cookie, body: { playerIds: [stranger.id] } });
  const file = path.join(dir, 'community-images', path.basename(up.url));
  assert.ok(fs.existsSync(file));
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: member.cookie })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: stranger.cookie })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 200, 'still there');
  const gone = await call('DELETE', `/api/communities/${org.id}`, { cookie: org.admin.cookie });
  assert.strictEqual(gone.status, 200, JSON.stringify(gone.json));
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 404);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: org.admin.cookie })).status, 404);
  for (const table of ['organisation_members', 'organisation_posts', 'organisation_invites']) assert.strictEqual(sql(`SELECT COUNT(*) AS n FROM ${table} WHERE organisation_id = ?`, org.id)[0].n, 0, table);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM organisation_post_reactions WHERE post_id = ?', post.id)[0].n, 0, 'reactions');
  assert.ok(!fs.existsSync(file), 'the picture file is gone');
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: org.admin.cookie })).status, 404, 'a second time: not found');
});

test('the super admin deletes any community, and the player who was invited sees the invitation is no longer valid', async () => {
  const org = await make(owner);
  await call('POST', `/api/communities/${org.id}/invite-players`, { cookie: org.admin.cookie, body: { playerIds: [stranger.id] } });
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`)).status, 200);
  const convs = (await call('GET', '/api/messages/conversations?box=requests', { cookie: stranger.cookie })).json.items;
  const msgs = (await call('GET', `/api/messages/conversations/${convs[0].id}/messages`, { cookie: stranger.cookie })).json.items;
  assert.strictEqual(msgs[msgs.length - 1].invite.status, 'GONE');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: stranger.cookie })).status, 404);
});

test('a community that has tournaments is not deleted (409) until they are gone', async () => {
  const org = await make(owner);
  const t = await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: org.admin.cookie, body: { name: 'Turnaj klubu', startDate: '2026-12-01', endDate: '2026-12-02', playType: 'SINGLES' } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.json));
  const refused = await call('DELETE', `/api/communities/${org.id}`, { cookie: org.admin.cookie });
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/seasons/${t.json.id}`, { cookie: org.admin.cookie })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: org.admin.cookie })).status, 200);
});

test('the list can ask for every city (the Discover filters pick one): each item says its city, the answer says which city this page is', async () => {
  const org = await make(owner);
  const all = (await call('GET', '/api/communities?scope=all', { cookie: '' })).json;
  assert.ok(Number.isInteger(all.currentLeagueId));
  const item = all.items.find((o) => o.id === org.id);
  assert.ok(item && item.city && Number.isInteger(item.leagueId));
  const plain = (await call('GET', '/api/communities', { cookie: '' })).json;
  assert.ok(plain.items.every((o) => o.leagueId === plain.currentLeagueId), 'without scope only the city of the address');
});

test('the page side: links in the settings dialog and on the Info tab, a delete button with a confirmation, the join information on the card', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const club = pub('js/community.js');
  assert.ok(club.includes('id="com-s-website"') && club.includes('id="com-s-facebook"') && club.includes('id="com-s-instagram"'), 'the settings have the three links');
  assert.ok(club.includes('org.website') && club.includes('org.facebook') && club.includes('org.instagram'), 'the Info tab shows them');
  assert.ok(club.includes('id="com-s-delete"') && club.includes("method: 'DELETE'") && club.includes('com.deleteConfirm'), 'a delete button that asks first');
  const list = pub('js/communities.js');
  assert.ok(list.includes('com.cardOpen') && list.includes('com.cardApproval') && list.includes('joinPolicy'), 'the card says who can join');
  assert.ok(list.includes('id="com-f-search"') && list.includes('id="com-f-type"') && list.includes('id="com-f-city"') && list.includes('scope=all'), 'Discover has a search bar, a kind filter and a city filter');
  const i18n = pub('js/i18n.js');
  for (const key of ['com.filterSearch', 'com.filterAllTypes', 'com.filterAllCities', 'com.filterNone', 'com.fieldWebsite', 'com.fieldFacebook', 'com.fieldInstagram', 'com.deleteBtn', 'com.deleteConfirm', 'com.deleted', 'com.cardOpen', 'com.cardApproval', 'com.infoLinks']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  }
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
