// Checks of "Komunity a kluby" (communities and clubs): src/routes/communities.js, src/communities.js
// Run: node scripts/check-communities.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'communities-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = adminCookie, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

// a real player who is logged in with the phone number (the way a player logs in); returns { id, cookie, name }
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09030${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  const id = made.json.id;
  assert.strictEqual((await call('PATCH', `/api/players/${id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  // a browser drops the expired cookie that a login sends to clear the club he acted as; the helper does the same
  return { id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const club = (over = {}) => ({ type: 'CLUB', name: 'TK Slovan Bratislava', description: 'Náš klub', contact: 'info@slovan.sk', ...over });
let seq = 0;
const uniqueName = (p = 'Klub') => `${p} ${(seq += 1)} ${Math.random().toString(36).slice(2, 7)}`;
let ana;
let boris;

// ---------- Task 1: create / list / read / update ----------

test('a visitor cannot create an organisation (401)', async () => {
  const r = await call('POST', '/api/communities', { cookie: '', body: club() });
  assert.strictEqual(r.status, 401);
});

test('a player creates a club: slug from the name, creator is ADMIN and ACTIVE, one member, join policy OPEN', async () => {
  ana = await makePlayer('Ana Alfa');
  const r = await call('POST', '/api/communities', { cookie: ana.cookie, body: club() });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.slug, 'tk-slovan-bratislava');
  assert.strictEqual(r.json.type, 'CLUB');
  assert.strictEqual(r.json.joinPolicy, 'OPEN');
  assert.strictEqual(r.json.memberCount, 1);
  assert.deepStrictEqual([r.json.me.role, r.json.me.status], ['ADMIN', 'ACTIVE']);
  assert.strictEqual(r.json.hidden, false);
});

test('the checks of what is written: type, name, description and contact', async () => {
  const bad = async (body) => assert.strictEqual((await call('POST', '/api/communities', { cookie: ana.cookie, body: club(body) })).status, 400, JSON.stringify(body).slice(0, 80));
  await bad({ type: 'LEAGUE' });
  await bad({ type: undefined });
  await bad({ name: '   ' });
  await bad({ name: 'x'.repeat(121) });
  await bad({ description: 'x'.repeat(2001) });
  await bad({ contact: 'x'.repeat(201) });
  await bad({ joinPolicy: 'EVERYONE' });
  const ok = await call('POST', '/api/communities', { cookie: ana.cookie, body: club({ name: uniqueName('  Spaces   inside  '), joinPolicy: 'APPROVAL', type: 'COMMUNITY' }) });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.joinPolicy, 'APPROVAL');
  assert.ok(!/\s{2}/.test(ok.json.name) && ok.json.name === ok.json.name.trim(), 'whitespace is tidied');
});

test('a name of symbols or with diacritics still gets a clean unique slug (-2 for a twin)', async () => {
  const p = await makePlayer('Boris Beta');
  boris = p;
  const a = await call('POST', '/api/communities', { cookie: p.cookie, body: club({ name: '!!!' }) });
  assert.strictEqual(a.status, 201);
  assert.ok(/^[a-z0-9-]+$/.test(a.json.slug) && a.json.slug.length > 0, a.json.slug);
  const one = await call('POST', '/api/communities', { cookie: p.cookie, body: club({ name: 'Športový klub Čadca', type: 'COMMUNITY' }) });
  assert.strictEqual(one.json.slug, 'sportovy-klub-cadca');
  const twin = await makePlayer('Cyril Gama');
  const two = await call('POST', '/api/communities', { cookie: twin.cookie, body: club({ name: 'Športový klub Čadca', type: 'COMMUNITY' }) });
  assert.strictEqual(two.status, 201);
  assert.strictEqual(two.json.slug, 'sportovy-klub-cadca-2');
});

test('at most 3 organisations per player per day (429), another player is not affected', async () => {
  const p = await makePlayer('Dana Delta');
  for (let i = 0; i < 3; i += 1) assert.strictEqual((await call('POST', '/api/communities', { cookie: p.cookie, body: club({ name: uniqueName() }) })).status, 201);
  const fourth = await call('POST', '/api/communities', { cookie: p.cookie, body: club({ name: uniqueName() }) });
  assert.strictEqual(fourth.status, 429, JSON.stringify(fourth.json));
  const other = await makePlayer('Emil Epsilon');
  assert.strictEqual((await call('POST', '/api/communities', { cookie: other.cookie, body: club({ name: uniqueName() }) })).status, 201);
});

test('the list shows organisations, the detail answers by slug, an unknown slug is 404', async () => {
  const waiting = (await call('GET', '/api/communities/tk-slovan-bratislava')).json;
  assert.strictEqual((await call('PATCH', `/api/communities/${waiting.id}/approval`, { body: { approved: true } })).status, 200);
  const list = await call('GET', '/api/communities', { cookie: '' });
  assert.strictEqual(list.status, 200);
  assert.ok(list.json.items.length >= 3);
  assert.strictEqual(list.json.items[0].me, null, 'a visitor has no membership');
  assert.ok(list.json.items.every((o) => typeof o.memberCount === 'number'));
  const one = await call('GET', '/api/communities/tk-slovan-bratislava', { cookie: '' });
  assert.strictEqual(one.status, 200);
  assert.strictEqual(one.json.name, 'TK Slovan Bratislava');
  assert.strictEqual((await call('GET', '/api/communities/nie-je-taky', { cookie: '' })).status, 404);
  const mine = await call('GET', '/api/communities/tk-slovan-bratislava', { cookie: ana.cookie });
  assert.strictEqual(mine.json.me.role, 'ADMIN', 'the creator sees his own role');
});

test('only an organisation admin changes it; type and slug never change; join policy is OPEN or APPROVAL', async () => {
  const one = (await call('GET', '/api/communities/tk-slovan-bratislava', { cookie: '' })).json;
  assert.strictEqual((await call('PATCH', `/api/communities/${one.id}`, { cookie: '', body: { name: 'Hacked' } })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/communities/${one.id}`, { cookie: boris.cookie, body: { name: 'Hacked' } })).status, 403);
  const ok = await call('PATCH', `/api/communities/${one.id}`, { cookie: ana.cookie, body: { name: 'TK Slovan', description: 'Nový popis', contact: 'x@y.sk', joinPolicy: 'APPROVAL', type: 'COMMUNITY', slug: 'iny-slug' } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.deepStrictEqual([ok.json.name, ok.json.joinPolicy, ok.json.type, ok.json.slug], ['TK Slovan', 'APPROVAL', 'CLUB', 'tk-slovan-bratislava']);
  assert.strictEqual((await call('PATCH', `/api/communities/${one.id}`, { cookie: ana.cookie, body: { joinPolicy: 'NOBODY' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/communities/${one.id}`, { cookie: ana.cookie, body: { name: ' ' } })).status, 400);
  await call('PATCH', `/api/communities/${one.id}`, { cookie: ana.cookie, body: { joinPolicy: 'OPEN' } });
});

// ---------- Task 2: membership and the join policy ----------

// a new organisation; its creation time is moved back two days so the limit of 3 a day (tested on its own) never gets in the way of the other tests
const makeOrg = async (owner, over = {}) => {
  const org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: club({ name: uniqueName(), ...over }) })).json;
  assert.ok(org && org.id, 'the organisation was not created: ' + JSON.stringify(org));
  if (org.type === 'CLUB') assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/approval`, { body: { approved: true } })).status, 200, 'the test club is approved');
  const file = new DatabaseSync(path.join(dir, 'blta-score.db'));
  file.prepare("UPDATE organisations SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE id = ?").run(org.id);
  file.close();
  return org;
};
const join = (org, who) => call('POST', `/api/communities/${org.id}/join`, { cookie: who.cookie });
const membersOf = (org, who) => call('GET', `/api/communities/${org.id}/members`, { cookie: who ? who.cookie : '' });
let M;

test('an OPEN club: joining makes an ACTIVE member at once, counted, and joining twice changes nothing', async () => {
  M = {};
  for (const n of ['Mia Mu', 'Nino Nu', 'Olga Omikron', 'Pavol Pi']) M[n.split(' ')[0]] = await makePlayer(n);
  const org = await makeOrg(ana);
  const r = await join(org, M.Mia);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.status, 'ACTIVE');
  assert.strictEqual((await join(org, M.Mia)).json.status, 'ACTIVE', 'idempotent');
  const list = (await membersOf(org)).json;
  assert.deepStrictEqual(list.members.map((m) => m.name).sort(), ['Ana Alfa', 'Mia Mu']);
  assert.strictEqual(list.members.find((m) => m.name === 'Ana Alfa').role, 'ADMIN');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 2);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: '' })).status, 401, 'a visitor must log in');
});

test('an APPROVAL club: a request is PENDING, not counted nor listed; only its admins see it (with a level)', async () => {
  const org = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  const r = await join(org, M.Nino);
  assert.strictEqual(r.json.status, 'PENDING');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: M.Nino.cookie })).json.me.status, 'PENDING');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 1, 'a request is not a member');
  const asAdmin = (await membersOf(org, ana)).json;
  assert.deepStrictEqual(asAdmin.members.map((m) => m.name), ['Ana Alfa']);
  assert.strictEqual(asAdmin.pending.length, 1);
  assert.strictEqual(asAdmin.pending[0].name, 'Nino Nu');
  assert.ok('level' in asAdmin.pending[0], 'the level (CourtIQ) is reported, null when the player has none yet');
  assert.deepStrictEqual((await membersOf(org, M.Nino)).json.pending, [], 'a plain player sees no requests');
  assert.deepStrictEqual((await membersOf(org)).json.pending, [], 'a visitor sees no requests');
});

test('approve makes an ACTIVE member; reject keeps the player out and a new request waits 7 days', async () => {
  const org = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(org, M.Mia);
  await join(org, M.Nino);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${M.Mia.id}/approve`, { cookie: ana.cookie })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: M.Mia.cookie })).json.me.status, 'ACTIVE');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${M.Nino.id}/reject`, { cookie: ana.cookie })).status, 200);
  const me = (await call('GET', `/api/communities/${org.slug}`, { cookie: M.Nino.cookie })).json.me;
  assert.strictEqual(me.status, null);
  assert.ok(me.canRequestAgainAt, 'the day he may ask again is reported');
  assert.strictEqual((await membersOf(org, ana)).json.pending.length, 0, 'a rejected request is no longer pending');
  const again = await join(org, M.Nino);
  assert.strictEqual(again.status, 409, JSON.stringify(again.json));
  assert.ok(again.json.canRequestAgainAt);
  const file = new DatabaseSync(path.join(dir, 'blta-score.db'));
  file.prepare("UPDATE organisation_members SET decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days') WHERE organisation_id = ? AND player_id = ?").run(org.id, M.Nino.id);
  file.close();
  assert.strictEqual((await join(org, M.Nino)).json.status, 'PENDING', 'after 7 days he may ask again');
});

test('cancel-request removes a pending request; approve-all approves every request', async () => {
  const org = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(org, M.Olga);
  await join(org, M.Pavol);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/cancel-request`, { cookie: M.Olga.cookie })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: M.Olga.cookie })).json.me.status, null);
  await join(org, M.Olga);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/approve-all`, { cookie: M.Mia.cookie })).status, 403, 'not for a non-admin');
  const all = await call('POST', `/api/communities/${org.id}/approve-all`, { cookie: ana.cookie });
  assert.strictEqual(all.status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 3);
});

test('only admins approve, reject, promote or remove', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  await join(org, M.Nino);
  const mia = M.Mia;
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${M.Nino.id}/reject`, { cookie: mia.cookie })).status, 403);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${M.Nino.id}`, { cookie: mia.cookie, body: { role: 'ADMIN' } })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${M.Nino.id}`, { cookie: mia.cookie })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${M.Nino.id}`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${M.Nino.id}`, { cookie: ana.cookie, body: { role: 'BOSS' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${M.Nino.id}`, { cookie: ana.cookie, body: { role: 'ADMIN' } })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: M.Nino.cookie })).json.me.role, 'ADMIN');
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${mia.id}`, { cookie: M.Nino.cookie })).status, 200, 'a promoted admin removes a member');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 2);
});

test('the last admin cannot leave, be demoted or be removed - until another admin exists', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/leave`, { cookie: ana.cookie })).status, 409);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${ana.id}`, { cookie: ana.cookie, body: { role: 'MEMBER' } })).status, 409);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${ana.id}`, { cookie: ana.cookie })).status, 409);
  await call('PATCH', `/api/communities/${org.id}/members/${M.Mia.id}`, { cookie: ana.cookie, body: { role: 'ADMIN' } });
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/leave`, { cookie: ana.cookie })).status, 200, 'the creator may leave when another admin stays');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/leave`, { cookie: M.Mia.cookie })).status, 409, 'and now Mia is the last one');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 1);
});

test('switching a club from APPROVAL to OPEN does not approve the requests that wait', async () => {
  const org = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(org, M.Pavol);
  await call('PATCH', `/api/communities/${org.id}`, { cookie: ana.cookie, body: { joinPolicy: 'OPEN' } });
  assert.strictEqual((await membersOf(org, ana)).json.pending.length, 1);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 1);
});

// ---------- Task 3: the news ----------

const postTo = (org, who, body) => call('POST', `/api/communities/${org.id}/posts`, { cookie: who ? who.cookie : '', body: { body } });

test('an admin posts news, everybody reads it; a member and a visitor cannot post', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  const made = await postTo(org, ana, '  Kurty 3 a 4 sú zatvorené.  ');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.body, 'Kurty 3 a 4 sú zatvorené.', 'trimmed');
  assert.strictEqual(made.json.authorName, 'Ana Alfa');
  assert.strictEqual((await postTo(org, M.Mia, 'Ahoj')).status, 403);
  assert.strictEqual((await postTo(org, null, 'Ahoj')).status, 401);
  const read = await call('GET', `/api/communities/${org.id}/posts`, { cookie: '' });
  assert.strictEqual(read.status, 200);
  assert.deepStrictEqual(read.json.items.map((p) => p.body), ['Kurty 3 a 4 sú zatvorené.']);
  assert.strictEqual(read.json.items[0].canDelete, false, 'a visitor cannot delete');
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/posts`, { cookie: ana.cookie })).json.items[0].canDelete, true);
});

test('the news text is checked and kept verbatim (the pages escape it)', async () => {
  const org = await makeOrg(ana);
  assert.strictEqual((await postTo(org, ana, '   ')).status, 400);
  assert.strictEqual((await postTo(org, ana, 'x'.repeat(2001))).status, 400);
  assert.strictEqual((await postTo(org, ana, 'x'.repeat(2000))).status, 201);
  const evil = '<img src=x onerror=alert(1)>';
  assert.strictEqual((await postTo(org, ana, evil)).json.body, evil);
});

test('a post is deleted by its author or an admin of the club, not by anybody else', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  await call('PATCH', `/api/communities/${org.id}/members/${M.Mia.id}`, { cookie: ana.cookie, body: { role: 'ADMIN' } });
  const byAna = (await postTo(org, ana, 'od Any')).json;
  const byMia = (await postTo(org, M.Mia, 'od Mie')).json;
  const stranger = await makePlayer('Quido Qu');
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${byAna.id}`, { cookie: stranger.cookie })).status, 403);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${byAna.id}`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${byMia.id}`, { cookie: ana.cookie })).status, 200, 'an admin removes another admin\'s post');
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${byAna.id}`, { cookie: M.Mia.cookie })).status, 200, 'an admin removes a post of somebody else');
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/posts`, { cookie: '' })).json.items.length, 0);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${byAna.id}`, { cookie: ana.cookie })).status, 404);
  // a post of one club cannot be reached through another club
  const other = await makeOrg(ana);
  const mine = (await postTo(org, ana, 'ďalšia')).json;
  assert.strictEqual((await call('DELETE', `/api/communities/${other.id}/posts/${mine.id}`, { cookie: ana.cookie })).status, 404);
});

test('the news come 20 at a time, newest first, with "more" and "before" to go further back', async () => {
  const org = await makeOrg(ana);
  for (let i = 1; i <= 25; i += 1) await postTo(org, ana, `Novinka ${i}`);
  const first = (await call('GET', `/api/communities/${org.id}/posts`, { cookie: '' })).json;
  assert.strictEqual(first.items.length, 20);
  assert.strictEqual(first.items[0].body, 'Novinka 25');
  assert.strictEqual(first.more, true);
  const next = (await call('GET', `/api/communities/${org.id}/posts?before=${first.items[19].id}`, { cookie: '' })).json;
  assert.deepStrictEqual(next.items.map((p) => p.body), ['Novinka 5', 'Novinka 4', 'Novinka 3', 'Novinka 2', 'Novinka 1']);
  assert.strictEqual(next.more, false);
});

// ---------- Task 4: the logo and the cover ----------

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const upload = async (org, which, who, { type = 'image/png', data = PNG, field = 'image' } = {}) => {
  const form = new FormData();
  form.append(field, new Blob([data], { type }), 'picture.bin');
  const res = await fetch(`${base}/api/communities/${org.id}/${which}`, { method: 'POST', headers: who ? { Cookie: who.cookie } : {}, body: form });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};
const fileStatus = async (url) => (await fetch(base + url)).status;

test('an admin uploads a logo and a cover; the files are served; others are refused', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  const logo = await upload(org, 'logo', ana);
  assert.strictEqual(logo.status, 200, JSON.stringify(logo.json));
  assert.ok(logo.json.logoUrl.startsWith('/community-images/'), logo.json.logoUrl);
  const served = await fetch(base + logo.json.logoUrl);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  const cover = await upload(org, 'cover', ana);
  assert.strictEqual(cover.status, 200);
  assert.ok(cover.json.coverUrl.startsWith('/community-images/') && cover.json.coverUrl !== cover.json.logoUrl);
  assert.strictEqual((await upload(org, 'logo', M.Mia)).status, 403, 'a plain member');
  assert.strictEqual((await upload(org, 'logo', null)).status, 401, 'a visitor');
});

test('only a picture is accepted (png, jpeg, webp), under 6 MB, in the field "image"', async () => {
  const org = await makeOrg(ana);
  assert.strictEqual((await upload(org, 'logo', ana, { type: 'text/plain', data: Buffer.from('hello') })).status, 400);
  assert.strictEqual((await upload(org, 'logo', ana, { type: 'image/svg+xml', data: Buffer.from('<svg/>') })).status, 400);
  assert.strictEqual((await upload(org, 'logo', ana, { data: Buffer.alloc(6 * 1024 * 1024 + 10) })).status, 400);
  assert.strictEqual((await upload(org, 'logo', ana, { field: 'photo' })).status, 400, 'no file in the expected field');
  assert.strictEqual((await upload(org, 'banner', ana)).status, 404);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.logoUrl, '', 'nothing was stored');
});

test('replacing a picture removes the old file; delete clears the address and the file', async () => {
  const org = await makeOrg(ana);
  const first = (await upload(org, 'logo', ana)).json.logoUrl;
  const second = (await upload(org, 'logo', ana)).json.logoUrl;
  assert.notStrictEqual(first, second);
  assert.strictEqual(await fileStatus(first), 404, 'the old file is gone');
  assert.strictEqual(await fileStatus(second), 200);
  const cleared = await call('DELETE', `/api/communities/${org.id}/logo`, { cookie: ana.cookie });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.json.logoUrl, '');
  assert.strictEqual(await fileStatus(second), 404);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/logo`, { cookie: M.Mia.cookie })).status, 403);
});

// ---------- Task 5: hiding an organisation (moderation) ----------

const moderate = (org, who, hidden, headers = {}) => call('PATCH', `/api/communities/${org.id}/moderation`, { cookie: who, body: { hidden }, headers });

test('an admin hides a club: gone from the list, 404 for everybody but an admin, nothing can be done in it; unhiding brings it back', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  const hid = await moderate(org, adminCookie, true);
  assert.strictEqual(hid.status, 200, JSON.stringify(hid.json));
  assert.strictEqual(hid.json.hidden, true);
  const names = async (cookie, q = '') => (await call('GET', `/api/communities${q}`, { cookie })).json.items.map((o) => o.id);
  assert.ok(!(await names('')).includes(org.id), 'not in the public list');
  assert.ok(!(await names(ana.cookie)).includes(org.id), 'not even for its own admin');
  assert.ok(!(await names('', '?includeHidden=1')).includes(org.id), 'includeHidden is for an admin only');
  assert.ok((await names(adminCookie, '?includeHidden=1')).includes(org.id), 'an admin can list it');
  for (const cookie of ['', M.Mia.cookie, ana.cookie]) {
    assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie })).status, 404);
    assert.strictEqual((await call('GET', `/api/communities/${org.id}/members`, { cookie })).status, 404);
    assert.strictEqual((await call('GET', `/api/communities/${org.id}/posts`, { cookie })).status, 404);
  }
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: adminCookie })).status, 200, 'an admin can read it');
  assert.strictEqual((await join(org, M.Nino)).status, 404, 'cannot be joined');
  assert.strictEqual((await postTo(org, ana, 'ticho')).status, 404, 'cannot be posted to');
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}`, { cookie: ana.cookie, body: { name: 'Nový' } })).status, 404, 'its admin cannot run it');
  assert.strictEqual((await moderate(org, adminCookie, false)).json.hidden, false);
  assert.ok((await names('')).includes(org.id), 'back in the list');
  assert.strictEqual((await postTo(org, ana, 'zasa')).status, 201);
});

test('only an admin of the site moderates (a visitor, a club admin and a player are refused)', async () => {
  const org = await makeOrg(ana);
  assert.strictEqual((await moderate(org, '', true)).status, 401);
  assert.strictEqual((await moderate(org, ana.cookie, true)).status, 401);
  assert.strictEqual((await moderate(org, adminCookie, 'yes')).status, 400);
  assert.strictEqual((await moderate({ id: 999999 }, adminCookie, true)).status, 404);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 200, 'nothing was hidden');
});

test('a city admin hides the clubs of his own city only', async () => {
  const mk = async (name, email, leagueId) => assert.strictEqual((await call('POST', '/api/city-admins', { body: { name, email, leagueId, password: 'long-enough-1' } })).status, 201);
  const city = await call('POST', '/api/leagues', { body: { name: 'Kosice' } });
  assert.strictEqual(city.status, 201, JSON.stringify(city.json));
  assert.strictEqual((await call('PATCH', `/api/leagues/${city.json.id}`, { body: { status: 'ACTIVE' } })).status, 200);
  await mk('Bra Admin', 'bra@example.com', 1);
  await mk('Kos Admin', 'kos@example.com', city.json.id);
  const log = async (email) => {
    const r = await call('POST', '/api/admin/login', { cookie: '', body: { email, password: 'long-enough-1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    return cookieOf(r);
  };
  const bra = await log('bra@example.com');
  const kos = await log('kos@example.com');
  const org = await makeOrg(ana);
  const backend = { 'X-Backend': '1' };
  assert.strictEqual((await moderate(org, kos, true, backend)).status, 403, 'the admin of another city');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 200);
  assert.strictEqual((await moderate(org, bra, true, backend)).status, 200, 'the admin of its own city');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).status, 404);
  assert.strictEqual((await moderate(org, bra, false, backend)).status, 200);
});

// ---------- Task 6: acting as a club ----------

const actAs = (who, organisationId, extraCookie = '') => call('POST', '/api/communities/act-as', { cookie: [who && who.cookie, extraCookie].filter(Boolean).join('; '), body: { organisationId } });
const mineOf = (who, extraCookie = '') => call('GET', '/api/communities/mine', { cookie: [who && who.cookie, extraCookie].filter(Boolean).join('; ') });
const isClearing = (c) => /^blta_acting_org=/.test(c) && /Expires=Thu, 01 Jan 1970/i.test(c); // a cookie that is expired now
const actingCookieOf = (r) => (r.res.headers.getSetCookie().find((c) => c.startsWith('blta_acting_org=')) || '').split(';')[0];

test('an admin of a club switches to it: /mine reports it as acting; "mine" lists the clubs the player is an active member of', async () => {
  const org = await makeOrg(ana);
  const sw = await actAs(ana, org.id);
  assert.strictEqual(sw.status, 200, JSON.stringify(sw.json));
  assert.strictEqual(sw.json.acting.id, org.id);
  const cookie = actingCookieOf(sw);
  assert.ok(cookie.startsWith('blta_acting_org='), 'the cookie is set');
  const mine = await mineOf(ana, cookie);
  assert.strictEqual(mine.json.acting.id, org.id);
  assert.ok(mine.json.items.some((o) => o.id === org.id && o.me.role === 'ADMIN'));
  assert.strictEqual((await mineOf(ana)).json.acting, null, 'without the cookie he acts as himself');
  assert.strictEqual((await call('GET', '/api/communities/mine', { cookie: '' })).status, 401, 'a visitor has no clubs');
  const pend = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(pend, M.Olga);
  assert.ok(!(await mineOf(M.Olga)).json.items.some((o) => o.id === pend.id), 'a waiting request is not a club of his');
});

test('only an admin of that club may switch to it (a member, an outsider, a visitor, a missing id)', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  assert.strictEqual((await actAs(M.Mia, org.id)).status, 403, 'a plain member');
  assert.strictEqual((await actAs(boris, org.id)).status, 403, 'somebody else');
  assert.strictEqual((await actAs(null, org.id)).status, 401, 'a visitor');
  assert.strictEqual((await actAs(ana, 999999)).status, 404);
  assert.strictEqual((await actAs(ana, 'abc')).status, 400);
});

test('a stale or borrowed cookie acts as nothing: demoted, hidden, another player\'s cookie, an unsigned value', async () => {
  const org = await makeOrg(ana);
  await join(org, M.Mia);
  await call('PATCH', `/api/communities/${org.id}/members/${M.Mia.id}`, { cookie: ana.cookie, body: { role: 'ADMIN' } });
  const cookie = actingCookieOf(await actAs(M.Mia, org.id));
  assert.strictEqual((await mineOf(M.Mia, cookie)).json.acting.id, org.id);
  assert.strictEqual((await mineOf(boris, cookie)).json.acting, null, 'the cookie of another player');
  assert.strictEqual((await mineOf(M.Mia, `blta_acting_org=${org.id}`)).json.acting, null, 'an unsigned value');
  await call('PATCH', `/api/communities/${org.id}/members/${M.Mia.id}`, { cookie: ana.cookie, body: { role: 'MEMBER' } });
  assert.strictEqual((await mineOf(M.Mia, cookie)).json.acting, null, 'demoted after switching');
  await call('PATCH', `/api/communities/${org.id}/members/${M.Mia.id}`, { cookie: ana.cookie, body: { role: 'ADMIN' } });
  assert.strictEqual((await mineOf(M.Mia, cookie)).json.acting.id, org.id, 'an admin again');
  await moderate(org, adminCookie, true);
  assert.strictEqual((await mineOf(M.Mia, cookie)).json.acting, null, 'a hidden club');
  assert.ok(!(await mineOf(M.Mia, cookie)).json.items.some((o) => o.id === org.id), 'and it is not in the list of his clubs');
  assert.strictEqual((await actAs(M.Mia, org.id)).status, 404, 'cannot be switched to');
});

test('switching to null clears the cookie, and logging out clears it too', async () => {
  const org = await makeOrg(ana);
  const off = await actAs(ana, null);
  assert.strictEqual(off.status, 200);
  assert.strictEqual(off.json.acting, null);
  assert.ok(off.res.headers.getSetCookie().some((c) => isClearing(c)), 'cleared');
  const out = await call('POST', '/api/player/logout', { cookie: ana.cookie });
  assert.ok(out.res.headers.getSetCookie().some((c) => isClearing(c)), 'logout clears it');
  assert.ok(org.id);
});

// ---------- Change: a community is public at once, a club waits for the super admin ----------

const approval = (org, who, approved) => call('PATCH', `/api/communities/${org.id}/approval`, { cookie: who, body: { approved } });

test('a community is public at once; a club is not approved and only its own admins (and site admins) see it', async () => {
  const owner = await makePlayer('Rudo Ro');
  const stranger = await makePlayer('Sona Sigma');
  const community = (await call('POST', '/api/communities', { cookie: owner.cookie, body: club({ type: 'COMMUNITY', name: uniqueName('Komunita') }) })).json;
  assert.strictEqual(community.approved, true);
  assert.strictEqual((await call('GET', `/api/communities/${community.slug}`, { cookie: '' })).status, 200, 'a visitor sees a community');
  const made = await call('POST', '/api/communities', { cookie: owner.cookie, body: club({ type: 'CLUB', name: uniqueName('Cakajuci') }) });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const pending = made.json;
  assert.strictEqual(pending.approved, false);
  assert.strictEqual(pending.me.role, 'ADMIN', 'its creator runs it');
  const ids = async (cookie, q = '') => (await call('GET', `/api/communities${q}`, { cookie })).json.items.map((o) => o.id);
  assert.ok((await ids(owner.cookie)).includes(pending.id), 'the creator sees it in the list');
  assert.ok(!(await ids('')).includes(pending.id), 'a visitor does not');
  assert.ok(!(await ids(stranger.cookie)).includes(pending.id), 'another player does not');
  assert.ok((await ids(adminCookie, '?includeHidden=1')).includes(pending.id), 'an admin can find it');
  for (const cookie of ['', stranger.cookie]) {
    assert.strictEqual((await call('GET', `/api/communities/${pending.slug}`, { cookie })).status, 404);
    assert.strictEqual((await call('GET', `/api/communities/${pending.id}/members`, { cookie })).status, 404);
    assert.strictEqual((await call('GET', `/api/communities/${pending.id}/posts`, { cookie })).status, 404);
  }
  assert.strictEqual((await call('GET', `/api/communities/${pending.slug}`, { cookie: owner.cookie })).status, 200, 'its creator opens it');
  assert.strictEqual((await call('GET', `/api/communities/${pending.slug}`, { cookie: adminCookie })).status, 200, 'an admin opens it');
  assert.strictEqual((await join(pending, stranger)).status, 404, 'nobody can join a club that is not approved');
  assert.ok((await mineOf(owner)).json.items.some((o) => o.id === pending.id && o.approved === false), 'it is in the clubs of its creator');
});

test('the admins of a club that waits can set it up (settings, news, pictures, acting as it)', async () => {
  const owner = await makePlayer('Tibor Tau');
  const pending = (await call('POST', '/api/communities', { cookie: owner.cookie, body: club({ type: 'CLUB', name: uniqueName('Pripravovany') }) })).json;
  assert.strictEqual((await call('PATCH', `/api/communities/${pending.id}`, { cookie: owner.cookie, body: { description: 'Pripravujeme' } })).status, 200);
  assert.strictEqual((await postTo(pending, owner, 'Čoskoro otvárame')).status, 201);
  assert.strictEqual((await upload(pending, 'logo', owner)).status, 200);
  assert.strictEqual((await actAs(owner, pending.id)).status, 200);
});

test('only the super admin approves a club: not a visitor, a club admin, nor a city admin; the club then is public, and can be taken back', async () => {
  const owner = await makePlayer('Uli Ypsilon');
  const stranger = await makePlayer('Viera Vi');
  const pending = (await call('POST', '/api/communities', { cookie: owner.cookie, body: club({ type: 'CLUB', name: uniqueName('Na schvalenie') }) })).json;
  assert.strictEqual((await approval(pending, '', true)).status, 401);
  assert.strictEqual((await approval(pending, owner.cookie, true)).status, 401, 'its own admin cannot approve it');
  assert.strictEqual((await call('POST', '/api/city-admins', { body: { name: 'Pre Admin', email: 'pre@example.com', leagueId: 1, password: 'long-enough-1' } })).status, 201);
  const cityLogin = await call('POST', '/api/admin/login', { cookie: '', body: { email: 'pre@example.com', password: 'long-enough-1' } });
  assert.strictEqual((await approval(pending, cookieOf(cityLogin), true)).status, 403, 'a city admin of its own city cannot approve');
  assert.strictEqual((await approval(pending, adminCookie, 'yes')).status, 400);
  assert.strictEqual((await approval({ id: 999999 }, adminCookie, true)).status, 404);
  const ok = await approval(pending, adminCookie, true);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.approved, true);
  assert.strictEqual((await call('GET', `/api/communities/${pending.slug}`, { cookie: '' })).status, 200, 'now public');
  assert.strictEqual((await join(pending, stranger)).json.status, 'ACTIVE', 'and anyone can join');
  assert.strictEqual((await approval(pending, adminCookie, false)).json.approved, false);
  assert.strictEqual((await call('GET', `/api/communities/${pending.slug}`, { cookie: stranger.cookie })).status, 404, 'taken back: not public any more');
});

// ---------- Fixes after the final review ----------

test('a deleted player leaves his clubs: no ghost admin, the member count stays true', async () => {
  const owner = await makePlayer('Waldo Wu');
  const second = await makePlayer('Xena Xi');
  const org = await makeOrg(owner);
  await join(org, second);
  await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'ADMIN' } });
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 2);
  assert.strictEqual((await call('DELETE', `/api/players/${second.id}`)).status, 204, 'a site admin deletes a player without matches');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.memberCount, 1, 'the deleted player is not counted');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/leave`, { cookie: owner.cookie })).status, 409, 'the owner is the last real admin');
});

test('removing a member sticks for 7 days (he cannot walk straight back in), and leaving by himself does not', async () => {
  const owner = await makePlayer('Yuri Yo');
  const troll = await makePlayer('Zita Zo');
  const org = await makeOrg(owner);
  await join(org, troll);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${troll.id}`, { cookie: owner.cookie })).status, 200);
  assert.deepStrictEqual((await membersOf(org)).json.members.map((m) => m.name), [owner.name].filter(Boolean).length ? ['Yuri Yo'] : []);
  const again = await join(org, troll);
  assert.strictEqual(again.status, 409, JSON.stringify(again.json));
  assert.ok(again.json.canRequestAgainAt);
  const left = await makePlayer('Ada Ab');
  await join(org, left);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/leave`, { cookie: left.cookie })).status, 200);
  assert.strictEqual((await join(org, left)).json.status, 'ACTIVE', 'who left by himself may come back at once');
});

test('a club cannot take the address of a route: "Mine" and "Act as" get another slug and their page works', async () => {
  const p = await makePlayer('Bea Bi');
  const a = (await call('POST', '/api/communities', { cookie: p.cookie, body: club({ type: 'COMMUNITY', name: 'Mine' }) })).json;
  assert.notStrictEqual(a.slug, 'mine');
  assert.strictEqual((await call('GET', `/api/communities/${a.slug}`, { cookie: '' })).json.name, 'Mine');
  const b = (await call('POST', '/api/communities', { cookie: p.cookie, body: club({ type: 'COMMUNITY', name: 'act as' }) })).json;
  assert.notStrictEqual(b.slug, 'act-as');
});

test('a request waiting in a hidden club cannot be cancelled; an approved member is dated by the approval', async () => {
  const org = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(org, M.Pavol);
  const file = new DatabaseSync(path.join(dir, 'blta-score.db'));
  file.prepare("UPDATE organisation_members SET joined_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days') WHERE organisation_id = ? AND player_id = ?").run(org.id, M.Pavol.id);
  file.close();
  await call('POST', `/api/communities/${org.id}/members/${M.Pavol.id}/approve`, { cookie: ana.cookie });
  const joined = (await membersOf(org)).json.members.find((m) => m.name === 'Pavol Pi').joinedAt;
  assert.ok(Date.now() - new Date(joined).getTime() < 60000, 'joinedAt is the day of the approval: ' + joined);
  const other = await makeOrg(ana, { joinPolicy: 'APPROVAL' });
  await join(other, M.Olga);
  await moderate(other, adminCookie, true);
  assert.strictEqual((await call('POST', `/api/communities/${other.id}/cancel-request`, { cookie: M.Olga.cookie })).status, 404);
});

test('a city admin reads a hidden club of his own city only (the super admin always)', async () => {
  const city = await call('POST', '/api/leagues', { body: { name: 'Zilina' } });
  assert.strictEqual((await call('PATCH', `/api/leagues/${city.json.id}`, { body: { status: 'ACTIVE' } })).status, 200);
  assert.strictEqual((await call('POST', '/api/city-admins', { body: { name: 'Zil Admin', email: 'zil@example.com', leagueId: city.json.id, password: 'long-enough-1' } })).status, 201);
  const zil = cookieOf(await call('POST', '/api/admin/login', { cookie: '', body: { email: 'zil@example.com', password: 'long-enough-1' } }));
  const org = await makeOrg(ana);
  await moderate(org, adminCookie, true);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/members`, { cookie: zil })).status, 404, 'the admin of another city');
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/members`, { cookie: adminCookie })).status, 200, 'the super admin');
});

test('logging in as a player clears a club the browser was still acting as', async () => {
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: '0903000001' } });
  assert.ok([200, 401].includes(login.status));
  const p = await makePlayer('Cid Ci');
  const phone = '0905550001';
  await call('PATCH', `/api/players/${p.id}/phone`, { body: { phone } });
  const again = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(again.status, 200);
  assert.ok(again.res.headers.getSetCookie().some(isClearing), 'the acting cookie is cleared by a login');
});

// (the tests of the next tasks go here)

// ---------- the feed: the news of the communities and clubs a player has joined ----------

const post = (who, org, text) => call('POST', `/api/communities/${org.id}/posts`, { cookie: who.cookie, body: { body: text } });
const feedOf = (who, query = '') => call('GET', `/api/communities/feed${query}`, { cookie: who.cookie });

test('the feed needs a logged-in player', async () => {
  assert.strictEqual((await call('GET', '/api/communities/feed', { cookie: '' })).status, 401);
});

test('the feed has the news of the public communities and clubs the player is an ACTIVE member of, newest first, each with its community; nothing else', async () => {
  const me = await makePlayer('Feed Ja');
  const other = await makePlayer('Feed Iny');
  const mk = async (who, name, over = {}) => (await call('POST', '/api/communities', { cookie: who.cookie, body: club({ type: 'COMMUNITY', name: uniqueName(name), ...over }) })).json;
  const joined = await mk(me, 'Moja komunita');
  const second = await mk(me, 'Druha komunita');
  const notJoined = await mk(other, 'Cudzia komunita');
  const waiting = await mk(other, 'Cakaren', { joinPolicy: 'APPROVAL' });
  const hidden = await mk(me, 'Skryta komunita');
  const unapprovedClub = (await call('POST', '/api/communities', { cookie: me.cookie, body: club({ name: uniqueName('Neschvaleny klub') }) })).json;
  assert.strictEqual((await call('POST', `/api/communities/${waiting.id}/join`, { cookie: me.cookie })).status, 200, 'a request to join waits for approval');
  const p1 = (await post(me, joined, 'Prva novinka')).json;
  const gone = (await post(me, joined, 'Zmazana novinka')).json;
  const p2 = (await post(me, second, 'Druha novinka')).json;
  await post(other, notJoined, 'Cudzia novinka');
  await post(other, waiting, 'Novinka cakarne');
  await post(me, hidden, 'Novinka skrytej');
  await post(me, unapprovedClub, 'Novinka neschvaleneho klubu');
  assert.strictEqual((await call('DELETE', `/api/communities/${joined.id}/posts/${gone.id}`, { cookie: me.cookie })).status, 200);
  assert.strictEqual((await call('PATCH', `/api/communities/${hidden.id}/moderation`, { body: { hidden: true } })).status, 200);
  const feed = await feedOf(me);
  assert.strictEqual(feed.status, 200, JSON.stringify(feed.json));
  assert.deepStrictEqual(feed.json.items.map((i) => i.body), ['Druha novinka', 'Prva novinka'], 'only the news of the two public communities he joined, newest first');
  assert.strictEqual(feed.json.more, false);
  const first = feed.json.items[0];
  assert.deepStrictEqual([first.organisation.id, first.organisation.slug, first.organisation.name, first.organisation.type], [second.id, second.slug, second.name, 'COMMUNITY']);
  assert.ok('logoUrl' in first.organisation && first.authorName === 'Feed Ja' && first.createdAt && first.id === p2.id);
  assert.strictEqual(feed.json.items[1].id, p1.id);
  // the other player runs the two communities that I left out above: his feed has their news (and none of mine)
  assert.deepStrictEqual((await feedOf(other)).json.items.map((i) => i.body), ['Novinka cakarne', 'Cudzia novinka']);
});

test('a tournament made by a joined community or club is in the feed too, in time order with the news; the ones of other communities, hidden ones and admin tournaments are not', async () => {
  const me = await makePlayer('Feed Turnaje');
  const other = await makePlayer('Feed Cudzi Turnaje');
  const org = (await call('POST', '/api/communities', { cookie: me.cookie, body: club({ type: 'COMMUNITY', name: uniqueName('Turnajova komunita') }) })).json;
  const foreign = (await call('POST', '/api/communities', { cookie: other.cookie, body: club({ type: 'COMMUNITY', name: uniqueName('Cudzia turnajova') }) })).json;
  const tournament = (who, o, name) => call('POST', `/api/communities/${o.id}/tournaments`, { cookie: who.cookie, body: { name, playType: 'SINGLES', startDate: '2027-05-01', endDate: '2027-05-02', venue: 'Kurty Slovan', entryFee: '10 €' } });
  await post(me, org, 'Pred turnajom');
  const made = await tournament(me, org, 'Jarny pohar');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  await post(me, org, 'Po turnaji');
  await tournament(other, foreign, 'Cudzi pohar');
  await call('POST', '/api/seasons', { body: { name: uniqueName('Admin turnaj'), kind: 'TOURNAMENT' } });
  const feed = (await feedOf(me)).json;
  assert.deepStrictEqual(feed.items.map((i) => i.type), ['POST', 'TOURNAMENT', 'POST'], 'news, tournament, news - newest first');
  const t = feed.items[1];
  assert.deepStrictEqual([t.id, t.name, t.slug, t.startDate, t.endDate, t.venue, t.playType, t.registrationOpen, t.organisation.slug], [made.json.id, 'Jarny pohar', made.json.slug, '2027-05-01', '2027-05-02', 'Kurty Slovan', 'SINGLES', true, org.slug]);
  assert.ok(t.createdAt, 'it has the time it was made');
  // hidden community: its tournament goes with it
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/moderation`, { body: { hidden: true } })).status, 200);
  assert.deepStrictEqual((await feedOf(me)).json.items, []);
});

test('the feed comes in pages of 20 (news and tournaments together), older ones with ?before= the time the last item was made', async () => {
  const me = await makePlayer('Feed Strankovac');
  const org = (await call('POST', '/api/communities', { cookie: me.cookie, body: club({ type: 'COMMUNITY', name: uniqueName('Plna komunita') }) })).json;
  for (let i = 1; i <= 23; i += 1) {
    assert.strictEqual((await post(me, org, `Novinka ${i}`)).status, 201);
    if (i === 10) assert.strictEqual((await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: me.cookie, body: { name: 'Turnaj v strede', playType: 'SINGLES', startDate: '2027-06-01', endDate: '2027-06-02' } })).status, 201);
  }
  const page1 = (await feedOf(me)).json;
  assert.strictEqual(page1.items.length, 20);
  assert.strictEqual(page1.more, true);
  assert.strictEqual(page1.items[0].body, 'Novinka 23');
  assert.ok(page1.items.some((i) => i.type === 'TOURNAMENT'), 'the tournament is among the 20 newest');
  assert.ok(page1.next, 'the answer says where the next page starts');
  const page2 = (await feedOf(me, `?before=${encodeURIComponent(page1.next)}`)).json;
  assert.deepStrictEqual(page2.items.map((i) => i.body), ['Novinka 4', 'Novinka 3', 'Novinka 2', 'Novinka 1']);
  assert.strictEqual(page2.more, false);
  assert.strictEqual((await feedOf(me, '?before=nonsense')).json.items.length, 20, 'a cursor that is not a time is ignored');
});

test('a club or community cannot take the address "feed" (it is a route)', async () => {
  const p = await makePlayer('Feed Adresa');
  const a = (await call('POST', '/api/communities', { cookie: p.cookie, body: club({ type: 'COMMUNITY', name: 'Feed' }) })).json;
  assert.notStrictEqual(a.slug, 'feed');
  assert.strictEqual((await call('GET', `/api/communities/${a.slug}`, { cookie: '' })).json.name, 'Feed');
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
    adminCookie = cookieOf(login);
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
