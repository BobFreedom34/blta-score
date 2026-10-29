// Checks of the invitation link of a community or club (src/routes/communities.js): an admin (or the super admin) gets a private link; whoever follows it
// joins at once even when the community decides on every request; a new link makes the old one useless; the link never leaks.
// Run: node scripts/check-community-invites.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-invite-'));
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
  const phone = `09080${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let owner;
let guest;
let guest2;
let member;
let org;
let token;

test('setup: a community that decides on every request, an owner, a member and two guests', async () => {
  [owner, member, guest, guest2] = [await makePlayer('Pozv Majitel'), await makePlayer('Pozv Clen'), await makePlayer('Pozv Host'), await makePlayer('Pozv Host Dva')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Pozvanky komunita', description: 'x', joinPolicy: 'APPROVAL' } })).json;
  assert.ok(org.id);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie })).json.status, 'PENDING');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${member.id}/approve`, { cookie: owner.cookie })).status, 200);
});

test('an admin gets the invitation link (the same one every time); a member, a visitor and a stranger do not', async () => {
  const first = await call('GET', `/api/communities/${org.id}/invite`, { cookie: owner.cookie });
  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  token = first.json.token;
  assert.ok(/^[\w-]{16,}$/.test(token), token);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`, { cookie: owner.cookie })).json.token, token);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`, { cookie: member.cookie })).status, 403);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`, { cookie: guest.cookie })).status, 403);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`)).json.token, token, 'the super admin sees the same link');
});

test('the link is private: no answer about the community carries it', async () => {
  for (const cookie of [owner.cookie, '', guest.cookie, adminCookie]) {
    const text = JSON.stringify((await call('GET', `/api/communities/${org.slug}`, { cookie })).json) + JSON.stringify((await call('GET', '/api/communities', { cookie })).json);
    assert.ok(!text.includes(token), 'the token leaked');
  }
});

test('joining with the link: a community that decides on every request lets the guest in at once; without it the guest waits (PENDING)', async () => {
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: guest.cookie, body: { inviteToken: token } })).json.status, 'ACTIVE');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: guest2.cookie })).json.status, 'PENDING');
  const list = (await call('GET', `/api/communities/${org.id}/members`, { cookie: owner.cookie })).json;
  assert.ok(list.members.some((m) => m.playerId === guest.id && m.role === 'MEMBER'), 'a plain member, not an admin');
});

test('a link that is wrong is refused (400) and nothing is joined; a visitor cannot use it either (401)', async () => {
  const third = await makePlayer('Pozv Host Tri');
  const bad = await call('POST', `/api/communities/${org.id}/join`, { cookie: third.cookie, body: { inviteToken: 'not-the-token-at-all-0000' } });
  assert.strictEqual(bad.status, 400, JSON.stringify(bad.json));
  assert.strictEqual((await call('GET', `/api/communities/${org.slug}`, { cookie: third.cookie })).json.me.status, null);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: '', body: { inviteToken: token } })).status, 401);
});

test('an invitation is welcome even after a declined request: the link overrides the waiting time', async () => {
  const late = await makePlayer('Pozv Host Styri');
  await call('POST', `/api/communities/${org.id}/join`, { cookie: late.cookie });
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${late.id}/reject`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: late.cookie })).status, 409, 'without the link he has to wait');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: late.cookie, body: { inviteToken: token } })).json.status, 'ACTIVE');
});

test('a new link: only an admin makes one, and the old one stops working', async () => {
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/invite/reset`, { cookie: member.cookie })).status, 403);
  const fresh = await call('POST', `/api/communities/${org.id}/invite/reset`, { cookie: owner.cookie });
  assert.strictEqual(fresh.status, 200, JSON.stringify(fresh.json));
  assert.notStrictEqual(fresh.json.token, token);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite`, { cookie: owner.cookie })).json.token, fresh.json.token);
  const guest5 = await makePlayer('Pozv Host Pat');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: guest5.cookie, body: { inviteToken: token } })).status, 400, 'the old link is dead');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: guest5.cookie, body: { inviteToken: fresh.json.token } })).json.status, 'ACTIVE');
});

test('the page side: the settings dialog shows the link with Copy and a new link, and a page opened with ?invite= joins with it', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const club = pub('js/community.js');
  assert.ok(club.includes('/invite') && club.includes('inviteToken') && club.includes("get('invite')"), 'the page reads ?invite= and sends it');
  assert.ok(club.includes('id="com-invite-link"') && club.includes('id="com-invite-copy"') && club.includes('id="com-invite-new"'));
  const i18n = pub('js/i18n.js');
  for (const key of ['com.inviteTitle', 'com.inviteHint', 'com.inviteCopy', 'com.inviteCopied', 'com.inviteNew', 'com.inviteNewConfirm', 'com.invitedBanner']) {
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
