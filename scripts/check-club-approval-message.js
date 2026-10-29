// Checks that the request to approve a new club arrives in the messages (Správy) of the player the super admin chose
// (src/routes/communities.js: approval-inbox, the message with a card), with a push, and that this player can approve from it.
// Run: node scripts/check-club-approval-message.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-appr-'));
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
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09110${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const inbox = async (who) => [...(await call('GET', '/api/messages/conversations?box=main', { cookie: who.cookie })).json.items, ...(await call('GET', '/api/messages/conversations?box=requests', { cookie: who.cookie })).json.items];
const messagesOf = async (who, id) => (await call('GET', `/api/messages/conversations/${id}/messages`, { cookie: who.cookie })).json.items;
const mkClub = (who, name, type = 'CLUB') => call('POST', '/api/communities', { cookie: who.cookie, body: { type, name, description: 'x' } });
let boss;
let maker;
let other;
let club;

test('setup: the player who will receive the requests (with push on), a player who makes clubs and another one', async () => {
  [boss, maker, other] = [await makePlayer('Sef Schvalovatel'), await makePlayer('Zakladatel Klubov'), await makePlayer('Iny Hrac')];
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: boss.cookie, body: { subscription: { endpoint: 'https://push.example.test/send/boss', keys: { p256dh: 'BKeyKeyKey', auth: 'authauth' } }, lang: 'sk' } })).status, 201);
});

test('before anybody is chosen, a new club makes no message (the e-mail and the Backend tab are the only signs)', async () => {
  const made = await mkClub(maker, 'Klub bez schvalovatela');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual((await inbox(boss)).length, 0);
});

test('only the super admin chooses who receives the requests (a player or a visitor cannot); an unknown player is refused; it can be cleared', async () => {
  const put = (cookie, playerId) => call('PUT', '/api/communities/approval-inbox', { cookie, body: { playerId } });
  assert.strictEqual((await put('', boss.id)).status, 401);
  assert.strictEqual((await put(maker.cookie, maker.id)).status, 401, 'a player is not an admin');
  assert.strictEqual((await put(adminCookie, 999999)).status, 404);
  assert.strictEqual((await put(adminCookie, 'x')).status, 400);
  const ok = await put(adminCookie, boss.id);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.deepStrictEqual([ok.json.playerId, ok.json.name], [boss.id, 'Sef Schvalovatel']);
  assert.strictEqual((await call('GET', '/api/communities/approval-inbox')).json.playerId, boss.id);
  assert.strictEqual((await call('GET', '/api/communities/approval-inbox', { cookie: maker.cookie })).status, 401);
  const cleared = await put(adminCookie, null);
  assert.strictEqual(cleared.json.playerId, null);
  assert.strictEqual((await put(adminCookie, boss.id)).status, 200);
});

test('a new club sends the request to the chosen player: a message from the founder with the club on a card, in the main box, and a push', async () => {
  const made = await mkClub(maker, 'Padel KTMS');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  club = made.json;
  const convs = await inbox(boss);
  assert.strictEqual(convs.length, 1);
  assert.strictEqual(convs[0].state, 'MAIN', 'it is not hidden among message requests');
  assert.strictEqual(convs[0].other.name, 'Zakladatel Klubov');
  const msg = (await messagesOf(boss, convs[0].id))[0];
  assert.ok(msg.body.includes('Padel KTMS'), msg.body);
  assert.deepStrictEqual([msg.approval.organisation.id, msg.approval.organisation.name, msg.approval.status], [club.id, 'Padel KTMS', 'WAITING']);
  const mine = (await messagesOf(maker, convs[0].id))[0];
  assert.strictEqual(mine.approval.status, 'SENT', 'the founder sees it as sent');
  const pushes = sql('SELECT payload FROM player_push_log WHERE player_id = ?', boss.id).map((r) => JSON.parse(r.payload));
  assert.ok(pushes.some((p) => (p.title + p.body).includes('Padel KTMS')), JSON.stringify(pushes));
});

test('a community is public at once, so it sends nothing; the chosen player founding a club sends nothing to himself', async () => {
  const before = (await messagesOf(boss, (await inbox(boss))[0].id)).length;
  assert.strictEqual((await mkClub(maker, 'Verejna komunita', 'COMMUNITY')).status, 201);
  assert.strictEqual((await mkClub(boss, 'Klub od schvalovatela')).status, 201);
  const convs = await inbox(boss);
  assert.strictEqual(convs.length, 1);
  assert.strictEqual((await messagesOf(boss, convs[0].id)).length, before);
});

test('the chosen player approves from the message (no Backend login needed); another player cannot; the card then says approved', async () => {
  assert.strictEqual((await call('PATCH', `/api/communities/${club.id}/approval`, { cookie: other.cookie, body: { approved: true } })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/communities/${club.id}/approval`, { cookie: maker.cookie, body: { approved: true } })).status, 401, 'not even the founder');
  assert.strictEqual((await call('PATCH', `/api/communities/${club.id}/approval`, { cookie: '', body: { approved: true } })).status, 401);
  const ok = await call('PATCH', `/api/communities/${club.id}/approval`, { cookie: boss.cookie, body: { approved: true } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.approved, true);
  const msg = (await messagesOf(boss, (await inbox(boss))[0].id))[0];
  assert.strictEqual(msg.approval.status, 'APPROVED');
  // and the Backend still works for the super admin
  assert.strictEqual((await call('PATCH', `/api/communities/${club.id}/approval`, { body: { approved: false } })).status, 200);
});

test('the page side: the chat shows the request with an Approve button, the Backend lets the super admin choose who receives them', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const chat = pub('js/messages.js');
  assert.ok(chat.includes('m.approval') && chat.includes('data-approval-approve') && chat.includes('/approval'));
  const admin = pub('js/communities-admin.js');
  assert.ok(admin.includes('approval-inbox') && admin.includes('id="approval-inbox-select"'));
  const i18n = pub('js/i18n.js');
  for (const key of ['msg.approvalText', 'msg.approvalApprove', 'msg.approvalApproved', 'msg.approvalSent', 'msg.approvalGone']) {
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
