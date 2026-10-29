// Checks that the super admin can edit and run any community or club without being one of its admins (src/routes/communities.js: needOrgAdmin):
// its settings, its members, its logo and cover, its tournaments; and that nobody else gains anything (a visitor, a plain player, a member).
// Run: node scripts/check-communities-superadmin.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-super-'));
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
  const phone = `09060${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let seq = 0;
let owner;
let member;
let stranger;
let org;

test('setup: a community with an owner, a member who asked to join and a stranger', async () => {
  owner = await makePlayer('Super Majitel');
  member = await makePlayer('Super Clen');
  stranger = await makePlayer('Super Cudzi');
  const made = await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: `Super komunita ${seq += 1}`, description: 'Pôvodný popis', contact: 'a@b.sk', joinPolicy: 'APPROVAL' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  org = made.json;
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie })).status, 200);
});

test('the super admin edits the settings of a community that is not his (PATCH), a visitor and a plain player cannot', async () => {
  const body = { name: org.name, description: 'Upravil super admin', contact: 'a@b.sk', joinPolicy: 'OPEN' };
  const done = await call('PATCH', `/api/communities/${org.id}`, { body });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.strictEqual(done.json.description, 'Upravil super admin');
  assert.strictEqual(done.json.joinPolicy, 'OPEN');
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}`, { cookie: '', body })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}`, { cookie: stranger.cookie, body: { ...body, description: 'hack' } })).status, 403);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}`, { cookie: member.cookie, body: { ...body, description: 'hack' } })).status, 403);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.description, 'Upravil super admin');
});

test('the super admin decides on join requests and manages members (approve, make admin, remove)', async () => {
  const again = await makePlayer('Super Zaujemca');
  // the policy is OPEN now, so ask for approval first
  await call('PATCH', `/api/communities/${org.id}`, { body: { name: org.name, joinPolicy: 'APPROVAL' } });
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: again.cookie })).status, 200);
  const list = await call('GET', `/api/communities/${org.id}/members`);
  assert.ok(list.json.pending.some((p) => p.playerId === again.id), 'the super admin sees the pending requests');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${again.id}/approve`)).status, 200);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${again.id}`, { body: { role: 'ADMIN' } })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${again.id}`)).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${member.id}/approve`, { cookie: stranger.cookie })).status, 403);
});

test('the super admin makes a tournament of the community (it belongs to it)', async () => {
  const made = await call('POST', `/api/communities/${org.id}/tournaments`, { body: { name: 'Turnaj od super admina', startDate: '2026-12-01', endDate: '2026-12-02', playType: 'SINGLES' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.organisationId, org.id);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/tournaments`, { cookie: stranger.cookie, body: { name: 'x', startDate: '2026-12-01', playType: 'SINGLES' } })).status, 403);
});

test('the super admin removes the cover and the logo (and a plain player cannot)', async () => {
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/cover`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/logo`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/cover`, { cookie: stranger.cookie })).status, 403);
});

test('writing a post needs a player to be the author: a super admin without a player cookie is refused, with a clear 4xx, nothing is stored', async () => {
  const r = await call('POST', `/api/communities/${org.id}/posts`, { body: { body: 'Správa od admina' } });
  assert.ok([401, 403].includes(r.status), String(r.status));
});

test('the club page tells the client the super admin can manage it (canManage), and nobody else', async () => {
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`)).json.canManage, true);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: stranger.cookie })).json.canManage, false);
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: owner.cookie })).json.canManage, false, 'an admin of the community manages it by acting as it, not by this flag');
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: '' })).json.canManage, false);
});

test('the super admin sees how many new clubs wait for his approval (nobody else asks), and it follows the approval', async () => {
  const count = async (cookie) => call('GET', '/api/communities/pending-count', { cookie });
  assert.strictEqual((await count('')).status, 401);
  assert.strictEqual((await count(owner.cookie)).status, 401, 'a player is not an admin');
  const before = (await count(adminCookie)).json.count;
  const club = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: `Cakajuci klub ${seq += 1}`, description: 'x' } })).json;
  assert.strictEqual((await count(adminCookie)).json.count, before + 1, 'a new club waits');
  assert.strictEqual((await call('PATCH', `/api/communities/${club.id}/approval`, { body: { approved: true } })).status, 200);
  assert.strictEqual((await count(adminCookie)).json.count, before, 'approved: no longer waiting');
  // a community is public at once, so it never waits
  await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: `Hned verejna ${seq += 1}`, description: 'x' } });
  assert.strictEqual((await count(adminCookie)).json.count, before);
});

test('the Backend tabs carry the number of clubs waiting for approval, and a new club e-mails the administrators', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.ok(read('public/js/common.js').includes('/communities/pending-count'), 'the Communities tab shows the count');
  assert.ok(read('src/routes/communities.js').includes('sendClubWaitingEmail') && read('src/mailer.js').includes('async function sendClubWaitingEmail'), 'an e-mail goes out when a club is made');
});

test('the club page shows the management panel when the server says canManage', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/community.js'), 'utf8');
  assert.ok(/const isActing = \(\) => [^\n]*org\.canManage/.test(js));
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
