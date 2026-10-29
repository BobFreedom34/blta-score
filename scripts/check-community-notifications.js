// Checks of the notifications of a community or club (bell and push): a new post goes to every member except its author, and an emoji reaction on a
// post goes to its author (src/routes/communities.js, src/routes/player.js, src/pushTexts.js).
// Run: node scripts/check-community-notifications.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-notif-'));
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
  const phone = `09140${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const subscribe = async (who, n) => assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: who.cookie, body: { subscription: { endpoint: `https://push.example.test/send/${n}`, keys: { p256dh: 'BKeyKeyKey', auth: 'authauth' } }, lang: 'sk' } })).status, 201);
const bell = async (who, type) => (await call('GET', '/api/player/notifications', { cookie: who.cookie })).json.filter((n) => n.type === type);
const unread = async (who) => (await call('GET', '/api/player/session', { cookie: who.cookie })).json.unreadNotificationCount;
const pushes = (who) => sql('SELECT payload FROM player_push_log WHERE player_id = ?', who.id).map((r) => JSON.parse(r.payload));
let owner;
let anna;
let boris;
let waiting;
let stranger;
let org;
let post;

test('setup: an approval-only community with an owner, two members (with push), a player waiting for approval and a stranger', async () => {
  [owner, anna, boris, waiting, stranger] = [await makePlayer('Not Majitel'), await makePlayer('Not Anna'), await makePlayer('Not Boris'), await makePlayer('Not Caka'), await makePlayer('Not Cudzi')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Notifikacie komunita', description: 'x', joinPolicy: 'APPROVAL' } })).json;
  assert.ok(org.id);
  for (const p of [anna, boris]) {
    await call('POST', `/api/communities/${org.id}/join`, { cookie: p.cookie });
    assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${p.id}/approve`, { cookie: owner.cookie })).status, 200);
  }
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: waiting.cookie })).json.status, 'PENDING');
  await subscribe(owner, 'owner');
  await subscribe(anna, 'anna');
  await subscribe(waiting, 'waiting');
});

test('a new post: every member gets it in the bell and as a push, except its author; a waiting player and a stranger get nothing', async () => {
  const made = await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Turnaj v sobotu! Prihláste sa.' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  post = made.json;
  for (const who of [anna, boris]) {
    const items = await bell(who, 'POST');
    assert.strictEqual(items.length, 1, who.name);
    assert.deepStrictEqual([items[0].post.authorName, items[0].post.orgName, items[0].post.orgSlug, items[0].post.body, items[0].seen], ['Not Majitel', 'Notifikacie komunita', org.slug, 'Turnaj v sobotu! Prihláste sa.', false]);
    assert.ok(await unread(who) >= 1);
  }
  assert.strictEqual((await bell(owner, 'POST')).length, 0, 'not the author');
  assert.strictEqual((await bell(waiting, 'POST')).length, 0, 'not a member yet');
  assert.strictEqual((await bell(stranger, 'POST')).length, 0);
  const annaPush = pushes(anna);
  assert.ok(annaPush.some((p) => (p.title + p.body).includes('Notifikacie komunita') && (p.title + p.body).includes('Turnaj v sobotu')), JSON.stringify(annaPush));
  assert.strictEqual(pushes(owner).length, 0);
  assert.strictEqual(pushes(waiting).length, 0);
});

test('a post with only a picture still notifies (the text is empty)', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const up = await (await fetch(`${base}/api/communities/${org.id}/post-image`, { method: 'POST', headers: { Cookie: owner.cookie }, body: form })).json();
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: '', imageUrl: up.url } })).status, 201);
  assert.strictEqual((await bell(boris, 'POST')).length, 2);
});

test('a reaction on a post: its author gets it in the bell and as a push (who, which emoji); removing it and putting it again makes no second one; reacting to your own post makes none', async () => {
  const react = (who, emoji) => call('POST', `/api/communities/${org.id}/posts/${post.id}/reactions`, { cookie: who.cookie, body: { emoji } });
  assert.strictEqual((await react(anna, '🔥')).status, 200);
  const items = await bell(owner, 'REACTION');
  assert.strictEqual(items.length, 1, JSON.stringify(items));
  assert.deepStrictEqual([items[0].reaction.actorName, items[0].reaction.emoji, items[0].reaction.orgSlug, items[0].seen], ['Not Anna', '🔥', org.slug, false]);
  assert.ok(await unread(owner) >= 1);
  assert.ok(pushes(owner).some((p) => (p.title + p.body).includes('Not Anna') && (p.title + p.body).includes('🔥')), JSON.stringify(pushes(owner)));
  await react(anna, '🔥'); // taken back
  await react(anna, '🔥'); // put again
  assert.strictEqual((await bell(owner, 'REACTION')).length, 1, 'the same reaction does not notify twice');
  assert.strictEqual((await react(boris, '💪')).status, 200);
  assert.strictEqual((await bell(owner, 'REACTION')).length, 2, 'another person or emoji does');
  await react(owner, '👏');
  assert.strictEqual((await bell(owner, 'REACTION')).length, 2, 'his own reaction makes none');
  assert.strictEqual((await bell(anna, 'REACTION')).length, 0);
});

test('reading them: post and reaction notifications are cleared one by one; somebody else cannot clear them', async () => {
  const [first] = await bell(anna, 'POST');
  assert.strictEqual((await call('POST', `/api/player/notifications/post/${first.id}/read`, { cookie: boris.cookie })).status, 404);
  const before = await unread(anna);
  const done = await call('POST', `/api/player/notifications/post/${first.id}/read`, { cookie: anna.cookie });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  assert.strictEqual(done.json.unreadNotificationCount, before - 1);
  const [r] = await bell(owner, 'REACTION');
  const beforeOwner = await unread(owner);
  assert.strictEqual((await call('POST', `/api/player/notifications/reaction/${r.id}/read`, { cookie: owner.cookie })).json.unreadNotificationCount, beforeOwner - 1);
});

test('a deleted post takes its notifications out of the bell and the count', async () => {
  const doomed = (await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Zmizne' } })).json;
  const before = await unread(boris);
  assert.ok((await bell(boris, 'POST')).some((n) => n.post.postId === doomed.id));
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${doomed.id}`, { cookie: owner.cookie })).status, 200);
  assert.ok(!(await bell(boris, 'POST')).some((n) => n.post.postId === doomed.id));
  assert.strictEqual(await unread(boris), before - 1);
});

test('the page side: the bell shows a new post and a reaction and takes the player to the community, in both languages', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const js = pub('js/common.js');
  assert.ok(js.includes("n.type === 'POST'") && js.includes("n.type === 'REACTION'") && js.includes("notif.type === 'POST' ? 'post'") && js.includes("notif.type === 'REACTION' ? 'reaction'"));
  const i18n = pub('js/i18n.js');
  for (const key of ['notif.postTitle', 'notif.reactionTitle']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
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
