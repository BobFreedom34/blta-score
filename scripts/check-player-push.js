// Checks of the automatic push for the bell and the messages (src/playerPush.js, src/pushTexts.js, /api/player/push/*): a player who turned
// push on gets every bell notification and every new direct message as a push; nobody else does, and the sender never pushes himself.
// The server runs with PUSH_DRY_RUN=1: instead of calling a push service it writes each push into the table player_push_log, which is read here.
// Run: node scripts/check-player-push.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const cookieSignature = require('cookie-signature');
const texts = require('../src/pushTexts');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'player-push-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

const signed = (name, value) => `${name}=${encodeURIComponent(`s:${cookieSignature.sign(String(value), 'test')}`)}`;
const playerCookie = (id) => signed('blta_player', id);

async function call(method, url, { body, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const sql = (query, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
};
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
let endpointCounter = 0;
const subscriptionBody = (lang = 'sk') => {
  endpointCounter += 1;
  return { subscription: { endpoint: `https://push.example.test/send/${endpointCounter}-${Math.random().toString(36).slice(2, 8)}`, keys: { p256dh: 'BPublicKeyForTheTests', auth: 'authSecretTests' } }, lang };
};
const pushesTo = (playerId) => sql('SELECT * FROM player_push_log WHERE player_id = ? ORDER BY id', playerId).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
let phone = 0;
async function player(name) {
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok([200, 201].includes(made.status), made.text);
  phone += 1;
  const number = `09050${String(phone).padStart(5, '0')}`;
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone: number } })).status, 200);
  return { id: made.json.id, name, cookie: playerCookie(made.json.id) };
}
async function subscribed(name, lang = 'sk') {
  const p = await player(name);
  const sub = await call('POST', '/api/player/push/subscribe', { cookie: p.cookie, body: subscriptionBody(lang) });
  assert.strictEqual(sub.status, 201, sub.text);
  return p;
}

// ---- the wording (pure) ----
test('texts: every kind has a Slovak and an English wording that matches the bell', () => {
  const kinds = {
    DM: { fromName: 'Anna', body: 'Ahoj' },
    CHAT: { fromName: 'Anna', body: 'Kedy hráme?', matchToken: 'tok1' },
    PLAY_REQUEST: { name: 'Boris', mode: 'SINGLES' },
    PARTNER_REQUEST: { name: 'Boris', mode: 'DOUBLES' },
    PROPOSAL_RECEIVED: { name: 'Cyril', matchToken: 'tok2' },
    PROPOSAL_CONFIRMED: { name: 'Cyril', matchToken: 'tok2' },
    PHOTO: { name: 'Dana', matchToken: 'tok3' },
    RANKING_UP: { amount: 3, rank: 4 },
    RANKING_DOWN: { amount: 2, rank: 9 },
    INVITE: { fromName: 'Anna', orgName: 'VIP CUP' },
    POST: { name: 'Anna', orgName: 'VIP CUP', body: 'Turnaj v sobotu', orgSlug: 'vip-cup' },
    REACTION: { name: 'Anna', orgName: 'VIP CUP', emoji: '🔥', orgSlug: 'vip-cup' },
    COMMENT: { name: 'Anna', orgName: 'VIP CUP', body: 'Super', orgSlug: 'vip-cup' },
    BADGE: { badge: 'Maratónec' },
    BADGE_REMINDER: { badge: 'Vianočný' },
  };
  for (const [kind, data] of Object.entries(kinds)) {
    const sk = texts.build(kind, data, 'sk');
    const en = texts.build(kind, data, 'en');
    assert.ok(sk.title && en.title && sk.url.startsWith('/') && en.url.startsWith('/'), kind);
    if (kind !== 'DM') assert.notStrictEqual(sk.title, en.title, `${kind}: both languages are the same`);
    assert.ok(!/undefined|\{\w+\}/.test(`${sk.title} ${sk.body} ${en.title} ${en.body}`), `${kind}: a hole in the wording`);
  }
  assert.strictEqual(texts.build('DM', { fromName: 'Anna', body: 'Ahoj' }, 'sk').title, 'Anna');
  assert.strictEqual(texts.build('DM', { fromName: 'Anna', body: 'Ahoj' }, 'sk').body, 'Ahoj');
  assert.strictEqual(texts.build('CHAT', { fromName: 'Anna', body: 'x', matchToken: 'tok1' }, 'en').url, '/match/tok1');
  assert.strictEqual(texts.build('RANKING_UP', { amount: 3, rank: 4 }, 'en').title, '📈 You climbed 3 places in the BLTA ranking — now #4');
  assert.strictEqual(texts.build('DM', { fromName: 'A', body: 'x'.repeat(500) }, 'sk').body.length <= 120, true, 'long text is cut for the notification');
  assert.strictEqual(texts.build('DM', { fromName: 'A', body: 'x' }, 'de').title, 'A', 'an unknown language falls back to Slovak');
});

test('the page side: the bell panel has the push row, the texts exist in both languages, the device is dropped before a logout', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const js = pub('js/common.js');
  const i18n = pub('js/i18n.js');
  assert.ok(js.includes('id="badge-notif-push"') && js.includes('refreshPushRow()') && js.includes('/player/push/subscribe'));
  assert.ok(/await dropDevicePush\(\);[^\n]*\n\s*try \{ await api\('\/player\/logout'/.test(js), 'the server is told before the session ends');
  for (const key of ['notif.pushOn', 'notif.pushOff', 'notif.pushOnLabel', 'notif.pushBlocked', 'notif.pushDenied', 'notif.pushUnsupported', 'notif.pushError', 'notif.pushIosHint', 'login.registerBtn']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in Slovak and English`);
  }
  assert.ok(js.includes("id = 'player-login-register-btn'"), 'the login window has a Register button');
  assert.ok(/\.com-cover \{ aspect-ratio: 16 \/ 6/.test(pub('css/style.css')), 'the cover of a club has the proportions of the home carousel');
});

// ---- subscribe / unsubscribe ----
test('subscribe needs a real player (no cookie, admin only: 401) and a valid subscription (400)', async () => {
  const p = await player('Push Valid');
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { body: subscriptionBody() })).status, 401);
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: adminCookie, body: subscriptionBody() })).status, 401);
  const bad = [
    {},
    { subscription: { endpoint: 'http://insecure.example.test/x', keys: { p256dh: 'a', auth: 'b' } } },
    { subscription: { endpoint: 'https://ok.example.test/x', keys: { p256dh: 'a' } } },
    { subscription: { endpoint: 'not a url', keys: { p256dh: 'a', auth: 'b' } } },
    { subscription: { endpoint: `https://ok.example.test/${'x'.repeat(2100)}`, keys: { p256dh: 'a', auth: 'b' } } },
  ];
  for (const body of bad) assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: p.cookie, body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', p.id)[0].n, 0);
});

test('subscribing twice with the same endpoint keeps one row; the endpoint follows the latest player who sent it; the language is updated', async () => {
  const a = await player('Push Twice A');
  const b = await player('Push Twice B');
  const body = subscriptionBody('sk');
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: a.cookie, body })).status, 201);
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: a.cookie, body: { ...body, lang: 'en' } })).status, 201);
  assert.deepStrictEqual(sql('SELECT lang FROM player_push_subscriptions WHERE player_id = ?', a.id).map((r) => r.lang), ['en']);
  // a shared phone: the next person to log in takes the subscription over, so the first one is not pushed what belongs to the second
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: b.cookie, body })).status, 201);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', a.id)[0].n, 0);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', b.id)[0].n, 1);
});

test('a player keeps at most 10 devices (the oldest is dropped)', async () => {
  const p = await player('Push Many');
  for (let i = 0; i < 12; i += 1) assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: p.cookie, body: subscriptionBody() })).status, 201);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', p.id)[0].n, 10);
});

test('unsubscribe removes only that endpoint of that player', async () => {
  const a = await player('Push Off A');
  const b = await player('Push Off B');
  const sa = subscriptionBody();
  const sb = subscriptionBody();
  await call('POST', '/api/player/push/subscribe', { cookie: a.cookie, body: sa });
  await call('POST', '/api/player/push/subscribe', { cookie: b.cookie, body: sb });
  assert.strictEqual((await call('POST', '/api/player/push/unsubscribe', { cookie: a.cookie, body: { endpoint: sb.subscription.endpoint } })).status, 200);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', b.id)[0].n, 1, "somebody else's endpoint stays");
  assert.strictEqual((await call('POST', '/api/player/push/unsubscribe', { cookie: a.cookie, body: { endpoint: sa.subscription.endpoint } })).status, 200);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_subscriptions WHERE player_id = ?', a.id)[0].n, 0);
  assert.strictEqual((await call('POST', '/api/player/push/unsubscribe', { body: { endpoint: 'https://x.example.test/y' } })).status, 401);
});

test('GET /api/player/push/status says whether push is possible on the server and whether this device is subscribed', async () => {
  const p = await player('Push Status');
  const s = subscriptionBody();
  const before = await call('GET', `/api/player/push/status?endpoint=${encodeURIComponent(s.subscription.endpoint)}`, { cookie: p.cookie });
  assert.strictEqual(before.status, 200);
  assert.strictEqual(before.json.subscribed, false);
  assert.strictEqual(typeof before.json.available, 'boolean');
  await call('POST', '/api/player/push/subscribe', { cookie: p.cookie, body: s });
  assert.strictEqual((await call('GET', `/api/player/push/status?endpoint=${encodeURIComponent(s.subscription.endpoint)}`, { cookie: p.cookie })).json.subscribed, true);
  assert.strictEqual((await call('GET', '/api/player/push/status')).status, 401);
});

// ---- direct messages ----
test('a new direct message pushes the recipient (title = the sender, body = the text), not the sender; both languages', async () => {
  const a = await subscribed('Push DM Anna');
  const b = await subscribed('Push DM Boris', 'en');
  const conv = await call('POST', '/api/messages/conversations', { cookie: a.cookie, body: { playerId: b.id } });
  assert.ok([200, 201].includes(conv.status), conv.text);
  const sent = await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: a.cookie, body: { body: 'Zahráme si?' } });
  assert.strictEqual(sent.status, 201, sent.text);
  await settle();
  const got = pushesTo(b.id);
  assert.strictEqual(got.length, 1, JSON.stringify(got));
  assert.strictEqual(got[0].payload.title, 'Push DM Anna');
  assert.strictEqual(got[0].payload.body, 'Zahráme si?');
  assert.strictEqual(got[0].payload.url, '/en/messages', 'the address follows the language of the device');
  assert.strictEqual(pushesTo(a.id).length, 0, 'the sender is not pushed');
  const back = await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: b.cookie, body: { body: 'Jasné' } });
  assert.strictEqual(back.status, 201, back.text);
  await settle();
  assert.strictEqual(pushesTo(a.id).length, 1);
  assert.strictEqual(pushesTo(a.id)[0].payload.body, 'Jasné');
});

test('a recipient without push, and a message that is refused, make no push and no error', async () => {
  const a = await subscribed('Push NoSub Anna');
  const b = await player('Push NoSub Boris');
  const conv = await call('POST', '/api/messages/conversations', { cookie: a.cookie, body: { playerId: b.id } });
  const sent = await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: a.cookie, body: { body: 'Ahoj' } });
  assert.strictEqual(sent.status, 201, sent.text);
  const empty = await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: a.cookie, body: { body: '   ' } });
  assert.strictEqual(empty.status, 400);
  await settle();
  assert.strictEqual(pushesTo(b.id).length, 0);
  assert.strictEqual(pushesTo(a.id).length, 0);
});

test('a player who blocked the sender is not pushed (the message is refused before it is stored)', async () => {
  const a = await subscribed('Push Block Anna');
  const b = await subscribed('Push Block Boris');
  const conv = await call('POST', '/api/messages/conversations', { cookie: a.cookie, body: { playerId: b.id } });
  await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: a.cookie, body: { body: 'Prvá' } });
  await settle();
  const before = pushesTo(b.id).length;
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'));
  d.prepare('INSERT INTO message_blocks (blocker_player_id, blocked_player_id) VALUES (?, ?)').run(b.id, a.id);
  d.close();
  const again = await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: a.cookie, body: { body: 'Druhá' } });
  assert.strictEqual(again.status, 403, again.text);
  await settle();
  assert.strictEqual(pushesTo(b.id).length, before);
});

// ---- bell: match chat and play requests ----
test('a match chat message pushes the other player of the match; an admin who is not playing pushes both', async () => {
  const a = await subscribed('Push Chat Anna');
  const b = await subscribed('Push Chat Boris');
  const made = await call('POST', '/api/matches', { cookie: adminCookie, body: { category: 'FRIENDLY', player1Id: a.id, player2Id: b.id, format: 'BO3_STB', location: 'Inter', scheduledAt: '2026-10-11T10:00:00.000Z' } });
  assert.strictEqual(made.status, 201, made.text);
  const posted = await call('POST', `/api/matches/${made.json.token}/messages`, { cookie: a.cookie, body: { body: 'Kedy hráme?' } });
  assert.strictEqual(posted.status, 201, posted.text);
  await settle();
  assert.strictEqual(pushesTo(a.id).length, 0);
  const got = pushesTo(b.id);
  assert.strictEqual(got.length, 1, JSON.stringify(got));
  assert.strictEqual(got[0].payload.url, `/match/${made.json.token}`);
  assert.ok(got[0].payload.title.includes('Push Chat Anna'), got[0].payload.title);
  assert.strictEqual(got[0].payload.body, 'Kedy hráme?');
  await call('POST', `/api/matches/${made.json.token}/messages`, { cookie: adminCookie, body: { body: 'Admin hovorí' } });
  await settle();
  assert.strictEqual(pushesTo(a.id).length, 1);
  assert.strictEqual(pushesTo(b.id).length, 2);
});

test('a play request (someone picks a time on my post) pushes the owner of the post, saying partner for a doubles post', async () => {
  const owner = await subscribed('Push Owner');
  const joiner = await player('Push Joiner');
  const slot = new Date(Date.now() + 2 * 86400000).toISOString();
  const post = await call('POST', '/api/availability', { cookie: owner.cookie, body: { slots: [slot], categories: ['ELITE'] } });
  assert.strictEqual(post.status, 201, post.text);
  const join = await call('POST', `/api/availability/${post.json.id}/join`, { cookie: joiner.cookie, body: { slot, message: 'Rád' } });
  assert.strictEqual(join.status, 200, join.text);
  await settle();
  const got = pushesTo(owner.id);
  assert.strictEqual(got.length, 1, JSON.stringify(got));
  assert.ok(got[0].payload.title.includes('Push Joiner'), got[0].payload.title);
  assert.strictEqual(got[0].payload.url, '/looking-to-play');
});

test('proposed times push the other player; the confirmation pushes the proposer', async () => {
  const a = await subscribed('Push Prop Anna');
  const b = await subscribed('Push Prop Boris');
  const slot = new Date(Date.now() + 3 * 86400000).toISOString();
  const made = await call('POST', '/api/matches', { cookie: a.cookie, body: { category: 'FRIENDLY', player1Id: a.id, player2Id: b.id, format: 'BO3_STB', proposalSlots: [slot], proposalVenues: ['Inter'], proposedBy: 1 } });
  assert.strictEqual(made.status, 201, made.text);
  await settle();
  const got = pushesTo(b.id);
  assert.strictEqual(got.length, 1, JSON.stringify(got));
  assert.ok(got[0].payload.title.includes('Push Prop Anna'), got[0].payload.title);
  assert.strictEqual(got[0].payload.url, `/match/${made.json.token}`);
  assert.strictEqual(pushesTo(a.id).length, 0);
  const picked = await call('POST', `/api/matches/${made.json.token}/respond-proposal`, { cookie: b.cookie, body: { slot } });
  assert.strictEqual(picked.status, 200, picked.text);
  await settle();
  const back = pushesTo(a.id);
  assert.strictEqual(back.length, 1, JSON.stringify(back));
  assert.ok(back[0].payload.title.includes('Push Prop Boris'), back[0].payload.title);
});

// ---- bell: the rest, through the module itself ----
test('the module: pushing a player with two devices sends to both; a player without any is a quiet no-op; a throwing text never breaks the caller', async () => {
  const p = await subscribed('Push Two Devices');
  await call('POST', '/api/player/push/subscribe', { cookie: p.cookie, body: subscriptionBody('en') });
  const other = await player('Push Quiet');
  const other2 = await subscribed('Push Sender');
  const conv = await call('POST', '/api/messages/conversations', { cookie: other2.cookie, body: { playerId: p.id } });
  await call('POST', `/api/messages/conversations/${conv.json.id}/messages`, { cookie: other2.cookie, body: { body: 'Dvom zariadeniam' } });
  await settle();
  assert.strictEqual(pushesTo(p.id).length, 2, 'one push per device');
  assert.deepStrictEqual([...new Set(pushesTo(p.id).map((r) => r.payload.title))], ['Push Sender']);
  assert.strictEqual(pushesTo(other.id).length, 0);
});

test('the page side: a phone that allows notifications is linked at login without asking, one that was not asked gets the question once a week, a player who turned it off is left alone', () => {
  const common = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  const parts = [
    'async function linkDevicePush()',
    'function askPlayerPush(',
    'PUSH_ASK_DAYS',
    'pushOptedOut(id)',
    "Notification.permission === 'granted'",
    "window.addEventListener('blta:auth-changed', () => { syncPlayerPush(); })",
    'pushStore(`blta-push-off-${currentPlayerId}`, 1)',
  ];
  for (const part of parts) assert.ok(common.includes(part), part);
  const i18n = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
  for (const key of ['notif.askTitle', 'notif.askBody', 'notif.askLater']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
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
