// Checks of the invitations an admin of a community or club sends to players (src/communityInvites.js, /api/communities/:id/invite-players): the admin picks
// names from a list, each player gets an invitation in his messages (and a push), and joins from that message at once, without the approval.
// Run: node scripts/check-community-player-invites.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-pinvite-'));
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
const sql = (query, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
};
async function makePlayer(name, { phone = true } = {}) {
  phoneCounter += 1;
  const number = `09090${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  if (!phone) return { id: made.json.id, name, cookie: '' };
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone: number } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: number } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const invite = (who, ids) => call('POST', `/api/communities/${org.id}/invite-players`, { cookie: who.cookie, body: { playerIds: ids } });
const inbox = async (who) => {
  const [main, requests] = [await call('GET', '/api/messages/conversations?box=main', { cookie: who.cookie }), await call('GET', '/api/messages/conversations?box=requests', { cookie: who.cookie })];
  return [...main.json.items, ...requests.json.items];
};
const messagesOf = async (who, convId) => (await call('GET', `/api/messages/conversations/${convId}/messages`, { cookie: who.cookie })).json.items;
let owner;
let anna;
let boris;
let cyril;
let nophone;
let member;
let org;

test('setup: a community that decides on every request, an owner, a member and four players to invite', async () => {
  [owner, member, anna, boris, cyril] = [await makePlayer('Pozv Majitel'), await makePlayer('Pozv Clen'), await makePlayer('Pozv Anna'), await makePlayer('Pozv Boris'), await makePlayer('Pozv Cyril')];
  nophone = await makePlayer('Pozv Bez Telefonu', { phone: false });
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Pozvanky hraci', description: 'x', joinPolicy: 'APPROVAL' } })).json;
  assert.ok(org.id);
  await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie });
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${member.id}/approve`, { cookie: owner.cookie })).status, 200);
  const sub = await call('POST', '/api/player/push/subscribe', { cookie: anna.cookie, body: { subscription: { endpoint: 'https://push.example.test/send/anna', keys: { p256dh: 'BKeyKeyKey', auth: 'authauth' } }, lang: 'sk' } });
  assert.strictEqual(sub.status, 201);
});

test('the list to pick from: players of the city with a phone, not himself, not a member; a name narrows it; only an admin sees it', async () => {
  const all = await call('GET', `/api/communities/${org.id}/invite-candidates`, { cookie: owner.cookie });
  assert.strictEqual(all.status, 200, JSON.stringify(all.json));
  const names = all.json.items.map((p) => p.name);
  assert.ok(names.includes('Pozv Anna') && names.includes('Pozv Boris'));
  assert.ok(!names.includes('Pozv Majitel'), 'not himself');
  assert.ok(!names.includes('Pozv Clen'), 'not a member already');
  assert.ok(!names.includes('Pozv Bez Telefonu'), 'a player who cannot log in cannot read the message');
  assert.ok(all.json.items.every((p) => p.playerId && p.name && !('phone' in p) && !('email' in p)), 'names and pictures only');
  const narrowed = await call('GET', `/api/communities/${org.id}/invite-candidates?q=anna`, { cookie: owner.cookie });
  assert.deepStrictEqual(narrowed.json.items.map((p) => p.name), ['Pozv Anna']);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite-candidates`, { cookie: member.cookie })).status, 403);
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/invite-candidates`, { cookie: '' })).status, 401);
});

test('an admin invites two players at once: each gets an invitation message from him, with the community in it', async () => {
  const sent = await invite(owner, [anna.id, boris.id]);
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
  assert.strictEqual(sent.json.sent, 2);
  assert.deepStrictEqual(sent.json.skipped, []);
  for (const who of [anna, boris]) {
    const convs = await inbox(who);
    assert.strictEqual(convs.length, 1, `${who.name} has the conversation`);
    assert.strictEqual(convs[0].other.name, 'Pozv Majitel');
    const msgs = await messagesOf(who, convs[0].id);
    assert.strictEqual(msgs.length, 1);
    assert.ok(msgs[0].body.includes('Pozvanky hraci'), msgs[0].body);
    assert.deepStrictEqual([msgs[0].invite.organisation.id, msgs[0].invite.organisation.name, msgs[0].invite.status], [org.id, 'Pozvanky hraci', 'INVITED']);
    assert.strictEqual(msgs[0].mine, false);
  }
  const ownerConvs = await inbox(owner);
  assert.strictEqual(ownerConvs.length, 2, 'the admin sees both conversations');
  const mineMsg = (await messagesOf(owner, ownerConvs[0].id))[0];
  assert.strictEqual(mineMsg.mine, true);
  assert.strictEqual(mineMsg.invite.status, 'SENT', 'the admin sees it as sent');
});

test('the invited player gets a push with the name of the community', async () => {
  const rows = sql("SELECT payload FROM player_push_log WHERE player_id = ?", anna.id).map((r) => JSON.parse(r.payload));
  assert.strictEqual(rows.length, 1, JSON.stringify(rows));
  assert.ok(rows[0].title.includes('Pozv Majitel') && (rows[0].title + rows[0].body).includes('Pozvanky hraci'), JSON.stringify(rows[0]));
});

test('joining from the invitation needs no approval: the player is ACTIVE at once, the message then says so; a player who was not invited still waits', async () => {
  const join = await call('POST', `/api/communities/${org.id}/join`, { cookie: anna.cookie });
  assert.strictEqual(join.json.status, 'ACTIVE', JSON.stringify(join.json));
  const convs = await inbox(anna);
  assert.strictEqual((await messagesOf(anna, convs[0].id))[0].invite.status, 'MEMBER');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: cyril.cookie })).json.status, 'PENDING', 'no invitation, no shortcut');
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM organisation_invites WHERE player_id = ?', anna.id)[0].n, 0, 'a used invitation is gone');
});

test('inviting again: a member, himself and a player without a phone are skipped with a reason; one already invited is not sent twice', async () => {
  const again = await invite(owner, [anna.id, boris.id, owner.id, nophone.id, 999999]);
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.strictEqual(again.json.sent, 0);
  const reasons = Object.fromEntries(again.json.skipped.map((s) => [s.playerId, s.reason]));
  assert.strictEqual(reasons[anna.id], 'MEMBER');
  assert.strictEqual(reasons[boris.id], 'ALREADY_INVITED');
  assert.strictEqual(reasons[owner.id], 'SELF');
  assert.strictEqual(reasons[nophone.id], 'NOT_FOUND');
  assert.strictEqual(reasons[999999], 'NOT_FOUND');
  assert.strictEqual((await messagesOf(boris, (await inbox(boris))[0].id)).length, 1, 'no second message');
});

test('a player who blocked the admin gets nothing', async () => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'));
  d.prepare('INSERT INTO message_blocks (blocker_player_id, blocked_player_id) VALUES (?, ?)').run(cyril.id, owner.id);
  d.close();
  const r = await invite(owner, [cyril.id]);
  assert.strictEqual(r.json.sent, 0);
  assert.strictEqual(r.json.skipped[0].reason, 'BLOCKED');
});

test('who may send: only an admin of the community (not a member, not a stranger, not a visitor); the super admin needs a player to write as', async () => {
  const stranger = await makePlayer('Pozv Cudzi');
  assert.strictEqual((await invite(member, [stranger.id])).status, 403);
  assert.strictEqual((await invite(stranger, [stranger.id])).status, 403);
  assert.strictEqual((await invite({ cookie: '' }, [stranger.id])).status, 401);
  const asSuper = await call('POST', `/api/communities/${org.id}/invite-players`, { body: { playerIds: [stranger.id] } });
  assert.strictEqual(asSuper.status, 401, 'a message needs a sender who is a player');
});

test('bad requests: no list, not numbers, more than 50 at once', async () => {
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/invite-players`, { cookie: owner.cookie, body: {} })).status, 400);
  assert.strictEqual((await invite(owner, [])).status, 400);
  assert.strictEqual((await invite(owner, ['a', null])).status, 400);
  assert.strictEqual((await invite(owner, Array.from({ length: 51 }, (_, i) => i + 1))).status, 400);
});

test('the page side: the invite dialog picks players from a list, the chat shows the invitation with a Join button', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const club = pub('js/community.js');
  assert.ok(club.includes('invite-candidates') && club.includes('invite-players') && club.includes('id="com-invite-send"') && club.includes('id="com-invite-search"'));
  const chat = pub('js/messages.js');
  assert.ok(chat.includes('m.invite') && chat.includes('data-invite-join') && chat.includes('/join'));
  const i18n = pub('js/i18n.js');
  for (const key of ['com.invitePlayers', 'com.inviteSearch', 'com.inviteSend', 'com.inviteSent', 'com.inviteNobody', 'msg.inviteJoin', 'msg.inviteMember', 'msg.inviteSent', 'msg.inviteGone', 'msg.inviteText']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  }
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', PUSH_DRY_RUN: '1' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k.startsWith('SMTP_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS' || k.startsWith('VAPID_')) delete env[k];
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
