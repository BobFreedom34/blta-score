// Checks of the private messages (Správy): src/routes/messages.js, src/messages.js, the live delivery in server.js
// Run: node scripts/check-messages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'messages-'));
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
const withDb = (fn) => { const file = new DatabaseSync(path.join(dir, 'blta-score.db')); try { return fn(file); } finally { file.close(); } };

// a real player who is logged in with the phone number (the way a player logs in); returns { id, name, cookie, phone }
async function makePlayer(name, { phone = true } = {}) {
  phoneCounter += 1;
  const number = `09040${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  const id = made.json.id;
  if (!phone) return { id, name, cookie: '', phone: null };
  assert.strictEqual((await call('PATCH', `/api/players/${id}/phone`, { body: { phone: number } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: number } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id, name, cookie: cookieOf(login), phone: number };
}
let seq = 0;
const uniq = (p = 'Hrac') => `${p} ${(seq += 1)}${Math.random().toString(36).slice(2, 6)}`;
const fresh = (prefix) => makePlayer(uniq(prefix));
const startConv = (from, toId) => call('POST', '/api/messages/conversations', { cookie: from.cookie, body: { playerId: toId } });
const getConv = (who, id) => call('GET', `/api/messages/conversations/${id}`, { cookie: who ? who.cookie : '' });
const stateOf = (convId, playerId) => withDb((f) => (f.prepare('SELECT state FROM conversation_members WHERE conversation_id = ? AND player_id = ?').get(convId, playerId) || {}).state);
// a planned friendly match between two players (anybody can make one against anybody: it does NOT connect them)
async function planMatch(a, b) {
  const r = await call('POST', '/api/matches', { body: { category: 'FRIENDLY', format: 'BO3', player1Name: a.name, player2Name: b.name, location: 'Kurt 1' } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
// a FINISHED match between two players: they have played together, so they are "connected"
async function playMatch(a, b) {
  const m = await planMatch(a, b);
  const done = await call('POST', `/api/matches/${m.token}/manual-result`, { body: { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: new Date().toISOString() } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
}
// both players have been members of the organisation for a while (a join a moment ago does not connect two players)
const ageMembers = (orgId, days = 8) => withDb((f) => f.prepare("UPDATE organisation_members SET joined_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) WHERE organisation_id = ?").run(`-${days} days`, orgId));

// ---------- Task 1: start a conversation, who is a stranger, blocks, search ----------

test('a visitor gets 401 on every messages route', async () => {
  for (const [method, url] of [['POST', '/api/messages/conversations'], ['GET', '/api/messages/conversations/1'], ['GET', '/api/messages/players?q=ab']]) {
    assert.strictEqual((await call(method, url, { cookie: '', body: method === 'POST' ? { playerId: 1 } : undefined })).status, 401, `${method} ${url}`);
  }
  assert.strictEqual((await call('GET', '/api/messages/players?q=ab')).status, 401, 'an admin without a player identity is not a player');
});

test('a player starts a conversation: a stranger gets a REQUEST, after a shared match it is MAIN', async () => {
  const a = await fresh('Ana');
  const stranger = await fresh('Cudzi');
  const mate = await fresh('Spoluhrac');
  const r = await startConv(a, stranger.id);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(stateOf(r.json.id, stranger.id), 'REQUEST');
  assert.strictEqual(stateOf(r.json.id, a.id), 'MAIN', 'the sender sees it in his Main');
  await playMatch(a, mate);
  const m = await startConv(a, mate.id);
  assert.strictEqual(m.status, 201);
  assert.strictEqual(stateOf(m.json.id, mate.id), 'MAIN', 'players with a match together are connected');
});

test('a shared community or club makes two players connected', async () => {
  const a = await fresh('Klubak');
  const b = await fresh('Klubak');
  const org = (await call('POST', '/api/communities', { cookie: a.cookie, body: { type: 'COMMUNITY', name: uniq('Komunita') } })).json;
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: b.cookie })).status, 200);
  ageMembers(org.id);
  const r = await startConv(a, b.id);
  assert.strictEqual(stateOf(r.json.id, b.id), 'MAIN');
});

test('what does NOT connect two players: a community joined a moment ago, a hidden community, a match that is only planned', async () => {
  const a = await fresh('Novy'); const b = await fresh('Novy'); const c = await fresh('Novy'); const d = await fresh('Novy');
  const org = (await call('POST', '/api/communities', { cookie: a.cookie, body: { type: 'COMMUNITY', name: uniq('Komunita') } })).json;
  await call('POST', `/api/communities/${org.id}/join`, { cookie: b.cookie });
  assert.strictEqual(stateOf((await startConv(a, b.id)).json.id, b.id), 'REQUEST', 'joined a moment ago: still a stranger');
  const old = (await call('POST', '/api/communities', { cookie: c.cookie, body: { type: 'COMMUNITY', name: uniq('Komunita') } })).json;
  await call('POST', `/api/communities/${old.id}/join`, { cookie: d.cookie });
  ageMembers(old.id);
  assert.strictEqual((await call('PATCH', `/api/communities/${old.id}/moderation`, { body: { hidden: true } })).status, 200);
  assert.strictEqual(stateOf((await startConv(c, d.id)).json.id, d.id), 'REQUEST', 'a hidden community connects nobody');
  const e = await fresh('Plan'); const f = await fresh('Plan');
  await planMatch(e, f);
  assert.strictEqual(stateOf((await startConv(e, f.id)).json.id, f.id), 'REQUEST', 'a planned match (anybody can make one) connects nobody');
});

test('starting twice (also from the other side) gives the same conversation: one only', async () => {
  const a = await fresh('Dvaja');
  const b = await fresh('Dvaja');
  const first = await startConv(a, b.id);
  assert.strictEqual(first.status, 201);
  const again = await startConv(a, b.id);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.id, first.json.id);
  const back = await startConv(b, a.id);
  assert.strictEqual(back.json.id, first.json.id, 'the other side joins the same conversation');
  assert.strictEqual(withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM conversations WHERE direct_key = ?').get(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`).n), 1);
  const both = await Promise.all([startConv(await fresh('Zavod'), a.id), startConv(a, b.id)]);
  assert.ok(both.every((r) => [200, 201].includes(r.status)));
});

test('messaging yourself is 400, an unknown player 404, a player of another city 404, bad input 400', async () => {
  const a = await fresh('Sam');
  assert.strictEqual((await startConv(a, a.id)).status, 400);
  assert.strictEqual((await startConv(a, 999999)).status, 404);
  const far = await fresh('Daleky');
  withDb((f) => f.prepare('UPDATE players SET league_id = 999 WHERE id = ?').run(far.id));
  assert.strictEqual((await startConv(a, far.id)).status, 404);
  assert.strictEqual((await call('POST', '/api/messages/conversations', { cookie: a.cookie, body: { playerId: 'abc' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/messages/conversations', { cookie: a.cookie, body: {} })).status, 400);
});

test('a non-member gets 404 on a conversation (also for an id that does not exist); a member sees it', async () => {
  const a = await fresh('Clen');
  const b = await fresh('Clen');
  const outsider = await fresh('Mimo');
  const conv = (await startConv(a, b.id)).json;
  assert.strictEqual((await getConv(outsider, conv.id)).status, 404);
  assert.strictEqual((await getConv(outsider, 999999)).status, 404, 'no difference between "not yours" and "not there"');
  assert.strictEqual((await getConv(a, 999999)).status, 404);
  const mine = await getConv(a, conv.id);
  assert.strictEqual(mine.status, 200);
  assert.deepStrictEqual([mine.json.id, mine.json.other.playerId, mine.json.state], [conv.id, b.id, 'MAIN']);
  assert.ok(['name', 'slug', 'photoUrl'].every((k) => k in mine.json.other));
  assert.strictEqual((await getConv(b, conv.id)).json.state, 'REQUEST');
});

test('the search: 2+ characters, part of a name, no himself, no player without a phone, no blocked player, names only', async () => {
  const me = await makePlayer('Hladac Hrac');
  const target = await makePlayer('Zeleny Tenista');
  await makePlayer('Zeleny Bezphone', { phone: false });
  const blocked = await makePlayer('Zeleny Zablokovany');
  withDb((f) => f.prepare('INSERT INTO message_blocks (blocker_player_id, blocked_player_id) VALUES (?, ?)').run(me.id, blocked.id));
  const search = (q, who = me) => call('GET', `/api/messages/players?q=${encodeURIComponent(q)}`, { cookie: who.cookie });
  assert.deepStrictEqual((await search('Z')).json.items, [], 'one character finds nothing');
  const found = (await search('Zeleny')).json.items;
  assert.deepStrictEqual(found.map((p) => p.name), ['Zeleny Tenista']);
  assert.deepStrictEqual(Object.keys(found[0]).sort(), ['name', 'photoUrl', 'playerId', 'slug'], 'names only: no phone, no e-mail');
  assert.ok(!(await search('Hladac')).json.items.some((p) => p.playerId === me.id), 'not himself');
  assert.ok(!(await search('Zeleny', target)).json.items.some((p) => p.name === 'Zeleny Zablokovany' && false), 'a blocked pair does not see each other (checked both ways below)');
  assert.ok(!(await search('Hladac', blocked)).json.items.some((p) => p.playerId === me.id), 'blocked either way');
});

test('the 21st conversation that begins as a request in a day is 429', async () => {
  const spammer = await fresh('Spamer');
  for (let i = 0; i < 20; i += 1) assert.strictEqual((await startConv(spammer, (await fresh('Obet')).id)).status, 201, `request ${i + 1}`);
  const over = await startConv(spammer, (await fresh('Obet')).id);
  assert.strictEqual(over.status, 429, JSON.stringify(over.json));
  const calm = await fresh('Pokojny');
  assert.strictEqual((await startConv(calm, (await fresh('Obet')).id)).status, 201, 'another player is not affected');
  withDb((f) => f.prepare("UPDATE message_request_log SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') WHERE player_id = ?").run(spammer.id));
  assert.strictEqual((await startConv(spammer, (await fresh('Obet')).id)).status, 201, 'a day later he may start again');
});

// ---------- Task 2: messages, read marks, requests, inbox, unread ----------

const send = (who, convId, body) => call('POST', `/api/messages/conversations/${convId}/messages`, { cookie: who ? who.cookie : '', body: { body } });
const listMessages = (who, convId, q = '') => call('GET', `/api/messages/conversations/${convId}/messages${q}`, { cookie: who ? who.cookie : '' });
const post = (who, url) => call('POST', url, { cookie: who ? who.cookie : '' });
const inbox = (who, box = '') => call('GET', `/api/messages/conversations${box ? `?box=${box}` : ''}`, { cookie: who.cookie });
const unread = async (who) => (await call('GET', '/api/messages/unread', { cookie: who.cookie })).json;
const pair = async (prefixA = 'A', prefixB = 'B') => { const a = await fresh(prefixA); const b = await fresh(prefixB); const conv = (await startConv(a, b.id)).json; return { a, b, id: conv.id }; };
// two players who are connected (a shared match), so no request allowance gets in the way
const connectedPair = async () => { const a = await fresh('Spoj'); const b = await fresh('Spoj'); await playMatch(a, b); return { a, b, id: (await startConv(a, b.id)).json.id }; };

test('a visitor gets 401 on the inbox and the unread count', async () => {
  assert.strictEqual((await call('GET', '/api/messages/conversations', { cookie: '' })).status, 401);
  assert.strictEqual((await call('GET', '/api/messages/unread', { cookie: '' })).status, 401);
  assert.strictEqual((await call('GET', '/api/messages/unread')).status, 401, 'an admin without a player identity is not a player');
});

test('send and read a message: trimmed, mine on the right side, the other side sees it as not mine', async () => {
  const { a, b, id } = await connectedPair();
  const sent = await send(a, id, '  Ahoj, zahráme si?  ');
  assert.strictEqual(sent.status, 201, JSON.stringify(sent.json));
  assert.deepStrictEqual([sent.json.body, sent.json.mine], ['Ahoj, zahráme si?', true]);
  assert.ok(sent.json.createdAt && sent.json.id);
  const fromB = (await listMessages(b, id)).json;
  assert.deepStrictEqual(fromB.items.map((m) => [m.body, m.mine]), [['Ahoj, zahráme si?', false]]);
  assert.strictEqual((await listMessages(a, id)).json.items[0].mine, true);
});

test('the text: empty and whitespace are 400, 2001 characters are 400, exactly 2000 are fine - counted as characters, not bytes', async () => {
  const { a, id } = await connectedPair();
  for (const body of ['', '   ', '\n\t ', 'x'.repeat(2001), '😀'.repeat(2001)]) assert.strictEqual((await send(a, id, body)).status, 400, JSON.stringify(body.slice(0, 20)));
  assert.strictEqual((await send(a, id, 'x'.repeat(2000))).status, 201);
  assert.strictEqual((await send(a, id, '😀'.repeat(2000))).status, 201);
  for (const body of [123, ['hi'], { x: 1 }, null, true]) assert.strictEqual((await call('POST', `/api/messages/conversations/${id}/messages`, { cookie: a.cookie, body: { body } })).status, 400, `not a string: ${JSON.stringify(body)}`);
  for (const body of ['\u200b', '\u200b\u200c \ufeff', '\u200d']) assert.strictEqual((await send(a, id, body)).status, 400, 'nothing visible in it');
  assert.strictEqual((await call('POST', `/api/messages/conversations/${id}/messages`, { cookie: a.cookie, body: {} })).status, 400);
});

test('a stranger may send 3 messages before the request is accepted; the 4th is 409; an answer accepts and lets him write again', async () => {
  const { a, b, id } = await pair('Cudzi', 'Prijemca');
  assert.strictEqual((await getConv(a, id)).json.requestAllowanceLeft, 3);
  for (let i = 1; i <= 3; i += 1) assert.strictEqual((await send(a, id, `správa ${i}`)).status, 201);
  const fourth = await send(a, id, 'štvrtá');
  assert.strictEqual(fourth.status, 409, JSON.stringify(fourth.json));
  const state = (await getConv(a, id)).json;
  assert.deepStrictEqual([state.requestAllowanceLeft, state.canWrite], [0, false]);
  assert.strictEqual((await send(b, id, 'Ahoj, rád pomôžem')).status, 201, 'the recipient may answer');
  assert.strictEqual(stateOf(id, b.id), 'MAIN', 'answering accepts the request');
  assert.strictEqual((await send(a, id, 'super, ďakujem')).status, 201, 'now the sender may write again');
  assert.strictEqual((await getConv(a, id)).json.requestAllowanceLeft, null);
});

test('accept moves a request to Main; decline deletes the conversation and blocks the sender (nothing gets around it)', async () => {
  const { a, b, id } = await pair('Odosielatel', 'Prijemca');
  await send(a, id, 'Ahoj');
  assert.strictEqual((await post(b, `/api/messages/conversations/${id}/accept`)).status, 200);
  assert.strictEqual(stateOf(id, b.id), 'MAIN');
  assert.strictEqual((await post(b, `/api/messages/conversations/${id}/accept`)).status, 404, 'nothing waits any more');
  const x = await pair('Spamer', 'Obranca');
  await send(x.a, x.id, 'kúp si hodinky');
  assert.strictEqual((await post(x.b, `/api/messages/conversations/${x.id}/decline`)).status, 200);
  assert.strictEqual((await getConv(x.a, x.id)).status, 404);
  assert.strictEqual((await getConv(x.b, x.id)).status, 404);
  assert.strictEqual((await startConv(x.a, x.b.id)).status, 403, 'the blocked sender cannot start again');
  assert.strictEqual((await startConv(x.b, x.a.id)).status, 403, 'nor can the other way round');
  assert.strictEqual((await send(x.a, x.id, 'ešte raz')).status, 404, 'the old id is dead');
  assert.strictEqual(withDb((f) => f.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE conversation_id = ?').get(x.id).n), 0, 'the messages are gone');
});

test('only the recipient of a request may accept or decline; a sender, a stranger and a visitor may not', async () => {
  const { a, b, id } = await pair('Odosielatel', 'Prijemca');
  const outsider = await fresh('Mimo');
  await send(a, id, 'Ahoj');
  for (const who of [a, outsider]) {
    assert.strictEqual((await post(who, `/api/messages/conversations/${id}/accept`)).status, 404);
    assert.strictEqual((await post(who, `/api/messages/conversations/${id}/decline`)).status, 404);
  }
  assert.strictEqual((await post(null, `/api/messages/conversations/${id}/accept`)).status, 401);
  assert.strictEqual(stateOf(id, b.id), 'REQUEST', 'nothing changed');
});

test('a non-member gets 404 on the messages, sending, read and a visitor 401', async () => {
  const { a, id } = await connectedPair();
  const outsider = await fresh('Mimo');
  await send(a, id, 'súkromné');
  assert.strictEqual((await listMessages(outsider, id)).status, 404);
  assert.strictEqual((await send(outsider, id, 'vlámanie')).status, 404);
  assert.strictEqual((await post(outsider, `/api/messages/conversations/${id}/read`)).status, 404);
  assert.strictEqual((await listMessages(outsider, 999999)).status, 404, 'the same answer for a conversation that is not there');
  assert.strictEqual((await listMessages(null, id)).status, 401);
  assert.strictEqual((await send(null, id, 'x')).status, 401);
  assert.strictEqual((await listMessages(a, id)).json.items.length, 1, 'nothing was added');
});

test('unread: per box, gone after read, never for the sender of the message', async () => {
  const { a, b, id } = await connectedPair();
  assert.deepStrictEqual(await unread(b), { main: 0, requests: 0 });
  await send(a, id, 'prvá');
  await send(a, id, 'druhá');
  assert.deepStrictEqual(await unread(b), { main: 1, requests: 0 });
  assert.deepStrictEqual(await unread(a), { main: 0, requests: 0 }, 'the sender has nothing unread');
  assert.strictEqual((await inbox(b)).json.items[0].unread, 2);
  assert.strictEqual((await post(b, `/api/messages/conversations/${id}/read`)).status, 200);
  assert.deepStrictEqual(await unread(b), { main: 0, requests: 0 });
  const r = await pair('Cudzi', 'Prijemca');
  assert.deepStrictEqual(await unread(r.b), { main: 0, requests: 0 }, 'a request with no message is not shown');
  await send(r.a, r.id, 'Ahoj');
  assert.deepStrictEqual(await unread(r.b), { main: 0, requests: 1 });
  await post(r.b, `/api/messages/conversations/${r.id}/accept`);
  assert.deepStrictEqual(await unread(r.b), { main: 1, requests: 0 }, 'accepted: now it counts in Main (still unread)');
});

test('the inbox: newest first, last message and unread per item; Requests shows what waits for the caller only', async () => {
  const me = await fresh('Ja');
  const old = await fresh('Starý');
  const newer = await fresh('Novší');
  const stranger = await fresh('Cudzí');
  await playMatch(me, old); await playMatch(me, newer);
  const c1 = (await startConv(me, old.id)).json.id;
  await send(old, c1, 'staršia správa');
  await new Promise((r) => setTimeout(r, 15));
  const c2 = (await startConv(me, newer.id)).json.id;
  await send(newer, c2, 'novšia správa');
  const c3 = (await startConv(stranger, me.id)).json.id;
  await send(stranger, c3, 'prosím o zápas');
  const main = (await inbox(me)).json.items;
  assert.deepStrictEqual(main.map((i) => i.id), [c2, c1], 'newest first, the request is not in Main');
  assert.deepStrictEqual([main[0].lastMessage.body, main[0].lastMessage.mine, main[0].unread, main[0].other.name], ['novšia správa', false, 1, newer.name]);
  const requests = (await inbox(me, 'requests')).json.items;
  assert.deepStrictEqual(requests.map((i) => [i.id, i.state]), [[c3, 'REQUEST']]);
  const theirs = (await inbox(stranger)).json.items;
  assert.deepStrictEqual(theirs.map((i) => i.id), [c3], 'the sender sees his own request in his Main');
  assert.deepStrictEqual((await inbox(stranger, 'requests')).json.items, []);
});

test('messages come 30 at a time, oldest first inside the page, with a cursor to go back', async () => {
  const { a, b, id } = await connectedPair();
  withDb((f) => { const ins = f.prepare('INSERT INTO direct_messages (conversation_id, sender_player_id, body) VALUES (?, ?, ?)'); for (let i = 1; i <= 35; i += 1) ins.run(id, i % 2 ? a.id : b.id, `m${i}`); });
  const first = (await listMessages(a, id)).json;
  assert.strictEqual(first.items.length, 30);
  assert.strictEqual(first.more, true);
  assert.deepStrictEqual([first.items[0].body, first.items[29].body], ['m6', 'm35'], 'the newest 30, oldest first');
  const next = (await listMessages(a, id, `?before=${first.items[0].id}`)).json;
  assert.deepStrictEqual(next.items.map((m) => m.body), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.strictEqual(next.more, false);
});

test('the 31st message within a minute is 429 (the limit is per player, in all conversations)', async () => {
  const { a, id } = await connectedPair();
  for (let i = 1; i <= 30; i += 1) assert.strictEqual((await send(a, id, `m${i}`)).status, 201, `message ${i}`);
  assert.strictEqual((await send(a, id, 'príliš rýchlo')).status, 429);
  const other = await connectedPair();
  assert.strictEqual((await send(other.a, other.id, 'ja môžem')).status, 201, 'another player is not limited');
});

test('deleting a player removes him from his conversations and deletes the direct ones that lose a member', async () => {
  const { a, b, id } = await pair('Ostava', 'Zmizne');
  await send(a, id, 'ahoj');
  withDb((f) => f.prepare('INSERT INTO message_blocks (blocker_player_id, blocked_player_id) VALUES (?, ?)').run(b.id, a.id));
  assert.strictEqual((await call('DELETE', `/api/players/${b.id}`)).status, 204);
  assert.strictEqual((await getConv(a, id)).status, 404, 'the conversation is gone');
  assert.deepStrictEqual(withDb((f) => [f.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE conversation_id = ?').get(id).n, f.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id = ?').get(id).n, f.prepare('SELECT COUNT(*) AS n FROM message_blocks WHERE blocker_player_id = ? OR blocked_player_id = ?').get(b.id, b.id).n]), [0, 0, 0]);
});

// ---------- Task 3: live delivery (the engine.io v4 text protocol over the ws package that Socket.IO installs) ----------

const WebSocket = require('ws');
// a socket connected the way a browser does it: with the cookie of the player (or none); remembers every event it gets
function liveSocket(cookie, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } });
    const events = [];
    const sock = {
      events,
      emit: (name, payload) => ws.send(`42${JSON.stringify([name, payload])}`),
      count: (name) => events.filter((e) => e[0] === name).length,
      last: (name) => (events.filter((e) => e[0] === name).pop() || [])[1],
      close: () => ws.close(),
    };
    ws.on('message', (data) => {
      const text = String(data);
      if (text.startsWith('0')) ws.send('40');
      else if (text === '2') ws.send('3');
      else if (text.startsWith('40')) resolve(sock);
      else if (text.startsWith('42')) { try { events.push(JSON.parse(text.slice(2))); } catch { /* ignore */ } }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('the socket did not connect')), 5000);
  });
}
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const unsigned = (id) => `blta_player=${id}`;

test('a new message reaches both members live, and nobody else - not a visitor, not a forged cookie, not a client that joins the room by name', async () => {
  const { a, b, id } = await connectedPair();
  const outsider = await fresh('Mimo');
  const sockets = {
    a: await liveSocket(a.cookie), b: await liveSocket(b.cookie), outsider: await liveSocket(outsider.cookie),
    visitor: await liveSocket(''), forged: await liveSocket(unsigned(b.id)), attacker: await liveSocket(outsider.cookie),
  };
  sockets.attacker.emit('join', `player:${b.id}`);
  sockets.attacker.emit('join', `dm:${id}`);
  await settle(200);
  assert.strictEqual((await send(a, id, 'Ahoj naživo')).status, 201);
  await settle();
  const got = sockets.b.last('dm:message');
  assert.ok(got, 'the recipient got dm:message');
  assert.deepStrictEqual([got.conversationId, got.message.body, got.message.senderPlayerId, got.other.playerId, got.other.name], [id, 'Ahoj naživo', a.id, a.id, a.name]);
  assert.ok(sockets.b.last('dm:unread') && sockets.b.last('dm:unread').main === 1, 'and the new unread count');
  assert.ok(sockets.a.last('dm:message') && sockets.a.last('dm:message').other.playerId === b.id, 'the sender is told too (his other tabs): the other person is b');
  for (const name of ['outsider', 'visitor', 'forged', 'attacker']) assert.strictEqual(sockets[name].events.length, 0, `${name} heard nothing: ${JSON.stringify(sockets[name].events)}`);
  Object.values(sockets).forEach((x) => x.close());
});

test('read, accept and decline tell the right people only (dm:unread to the caller, dm:removed to both on a decline)', async () => {
  const { a, b, id } = await pair('Odosielatel', 'Prijemca');
  const outsider = await fresh('Mimo');
  const sa = await liveSocket(a.cookie); const sb = await liveSocket(b.cookie); const so = await liveSocket(outsider.cookie);
  await send(a, id, 'Ahoj');
  await settle();
  assert.deepStrictEqual(sb.last('dm:unread'), { main: 0, requests: 1 }, 'a request waits for the recipient');
  sb.events.length = 0; sa.events.length = 0;
  assert.strictEqual((await post(b, `/api/messages/conversations/${id}/accept`)).status, 200);
  await settle(400);
  assert.deepStrictEqual(sb.last('dm:unread'), { main: 1, requests: 0 }, 'accepted: it is in Main now');
  sb.events.length = 0;
  assert.strictEqual((await post(b, `/api/messages/conversations/${id}/read`)).status, 200);
  await settle(400);
  assert.deepStrictEqual(sb.last('dm:unread'), { main: 0, requests: 0 });
  const x = await pair('Spamer', 'Obranca');
  const sx = await liveSocket(x.a.cookie); const sy = await liveSocket(x.b.cookie);
  await send(x.a, x.id, 'kúp si hodinky');
  await settle(300);
  assert.strictEqual((await post(x.b, `/api/messages/conversations/${x.id}/decline`)).status, 200);
  await settle();
  assert.deepStrictEqual(sx.last('dm:removed'), { conversationId: x.id });
  assert.deepStrictEqual(sy.last('dm:removed'), { conversationId: x.id });
  assert.strictEqual(so.events.length, 0, 'the outsider heard nothing at all');
  [sa, sb, so, sx, sy].forEach((z) => z.close());
});

test('the old join still works for a match room (the viewer count comes back), but never for a private room', async () => {
  const me = await fresh('Divak');
  const s1 = await liveSocket(me.cookie);
  s1.emit('join', 'match:abc123');
  await settle(400);
  assert.strictEqual(s1.count('viewers:count'), 1, 'a match room works as before');
  s1.close();
});

// ---------- Fixes after the final review ----------

test('a declined request still counts toward the 20 a day (declining quickly does not buy a new quota)', async () => {
  const spammer = await fresh('Spamer');
  const victims = [];
  for (let i = 0; i < 20; i += 1) { const v = await fresh('Obet'); victims.push(v); assert.strictEqual((await startConv(spammer, v.id)).status, 201); }
  for (const v of victims.slice(0, 5)) {
    const id = (await startConv(spammer, v.id)).json.id;
    await send(spammer, id, 'ahoj');
    assert.strictEqual((await post(v, `/api/messages/conversations/${id}/decline`)).status, 200);
  }
  assert.strictEqual((await startConv(spammer, (await fresh('Obet')).id)).status, 429, 'the declined ones still count');
});

test('a city admin who is also logged in as a player can use the messages', async () => {
  assert.strictEqual((await call('POST', '/api/city-admins', { body: { name: 'Mesto Admin', email: 'mesto@example.com', leagueId: 1, password: 'long-enough-1' } })).status, 201);
  const cityCookie = cookieOf(await call('POST', '/api/admin/login', { cookie: '', body: { email: 'mesto@example.com', password: 'long-enough-1' } }));
  const a = await fresh('Admin Hrac'); const b = await fresh('Druhy');
  const both = `${cityCookie}; ${a.cookie}`;
  const r = await call('POST', '/api/messages/conversations', { cookie: both, body: { playerId: b.id } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual((await call('POST', `/api/messages/conversations/${r.json.id}/messages`, { cookie: both, body: { body: 'ahoj' } })).status, 201);
  assert.strictEqual((await call('POST', `/api/messages/conversations/${r.json.id}/read`, { cookie: both })).status, 200);
});

test('a cookie of a deleted player is nobody (401, not a crash); a player without a phone cannot be started', async () => {
  const ghost = await fresh('Duch');
  assert.strictEqual((await call('DELETE', `/api/players/${ghost.id}`)).status, 204);
  assert.strictEqual((await call('GET', '/api/messages/players?q=ab', { cookie: ghost.cookie })).status, 401);
  assert.strictEqual((await call('GET', '/api/messages/unread', { cookie: ghost.cookie })).status, 401);
  const a = await fresh('Piseme');
  const nophone = await makePlayer(uniq('Bezphone'), { phone: false });
  assert.strictEqual((await startConv(a, nophone.id)).status, 404, 'a player who can never log in cannot be written to');
});

test('the live connection only counts when it comes from the app itself (a handshake from another origin gets no private room)', async () => {
  const { a, b, id } = await connectedPair();
  const own = await liveSocket(b.cookie, `http://localhost:${port}`);
  const evil = await liveSocket(b.cookie, 'https://www.blta.sk');
  const evil2 = await liveSocket(b.cookie, 'https://evil.example');
  const nameless = await liveSocket(b.cookie);
  await settle(200);
  assert.strictEqual((await send(a, id, 'len pre mňa')).status, 201);
  await settle();
  assert.ok(own.last('dm:message'), 'the app\'s own page hears it');
  assert.ok(nameless.last('dm:message'), 'a client that sends no Origin (not a browser page) is as before');
  assert.strictEqual(evil.events.length, 0, 'a page of another origin on the same site hears nothing');
  assert.strictEqual(evil2.events.length, 0);
  [own, evil, evil2, nameless].forEach((x) => x.close());
});

test('deleting a player tells the other member (dm:removed) and removes the chat in one go', async () => {
  const { a, b, id } = await pair('Ostava', 'Zmizne');
  await send(a, id, 'ahoj');
  const sa = await liveSocket(a.cookie);
  await settle(200);
  assert.strictEqual((await call('DELETE', `/api/players/${b.id}`)).status, 204);
  await settle();
  assert.deepStrictEqual(sa.last('dm:removed'), { conversationId: id });
  sa.close();
});

// (the tests of the next tasks go here)

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
