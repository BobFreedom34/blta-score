// Checks of the comments under the news of a community or club (src/routes/communities.js: /:id/posts/:postId/comments) and of who may write news:
// every admin of the community (also one made an admin later), not a plain member.
// Run: node scripts/check-community-comments.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-comments-'));
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
  const phone = `09130${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
const comments = (org, post, who, query = '') => call('GET', `/api/communities/${org.id}/posts/${post.id}/comments${query}`, { cookie: who ? who.cookie : '' });
const comment = (org, post, who, body) => call('POST', `/api/communities/${org.id}/posts/${post.id}/comments`, { cookie: who ? who.cookie : '', body: { body } });
let owner;
let second;
let member;
let member2;
let stranger;
let org;
let post;

test('setup: a community with an owner (push on), two members, a player who will become an admin, and a stranger', async () => {
  [owner, second, member, member2, stranger] = [await makePlayer('Kom Majitel'), await makePlayer('Kom Druhy Admin'), await makePlayer('Kom Clen'), await makePlayer('Kom Clen Dva'), await makePlayer('Kom Cudzi')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Komentare komunita', description: 'x' } })).json;
  assert.ok(org.id);
  for (const p of [second, member, member2]) assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: p.cookie })).status, 200);
  assert.strictEqual((await call('POST', '/api/player/push/subscribe', { cookie: owner.cookie, body: { subscription: { endpoint: 'https://push.example.test/send/owner', keys: { p256dh: 'BKeyKeyKey', auth: 'authauth' } }, lang: 'sk' } })).status, 201);
  post = (await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Prvá novinka' } })).json;
  assert.ok(post.id);
  assert.strictEqual(post.commentCount, 0);
});

test('an admin who was made an admin later can write news too; a plain member and a stranger cannot', async () => {
  const noWay = await call('POST', `/api/communities/${org.id}/posts`, { cookie: second.cookie, body: { body: 'Ešte nie som správca' } });
  assert.strictEqual(noWay.status, 403);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'ADMIN' } })).status, 200);
  const ok = await call('POST', `/api/communities/${org.id}/posts`, { cookie: second.cookie, body: { body: 'Píšem ako druhý správca' } });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.authorName, 'Kom Druhy Admin');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts`, { cookie: member.cookie, body: { body: 'x' } })).status, 403);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts`, { cookie: stranger.cookie, body: { body: 'x' } })).status, 403);
  // a demoted admin loses it again
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'MEMBER' } })).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts`, { cookie: second.cookie, body: { body: 'x' } })).status, 403);
  assert.strictEqual((await call('PATCH', `/api/communities/${org.id}/members/${second.id}`, { cookie: owner.cookie, body: { role: 'ADMIN' } })).status, 200);
});

test('a member comments on a post; the comment carries its author; the post counts it', async () => {
  const made = await comment(org, post, member, 'Skvelé, ďakujem! 🔥 https://example.com');
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.deepStrictEqual([made.json.body, made.json.authorName, made.json.canDelete], ['Skvelé, ďakujem! 🔥 https://example.com', 'Kom Clen', true]);
  const list = await comments(org, post, member2);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.items.length, 1);
  assert.strictEqual(list.json.items[0].canDelete, false, 'not his comment');
  assert.strictEqual(list.json.canComment, true);
  const posts = (await call('GET', `/api/communities/${org.id}/posts`, { cookie: member2.cookie })).json.items;
  assert.strictEqual(posts.find((p) => p.id === post.id).commentCount, 1);
});

test('who may comment: members and admins of the community; not a stranger, not a visitor; the text must be 1 to 1000 characters', async () => {
  assert.strictEqual((await comment(org, post, owner, 'Ďakujem aj ja')).status, 201, 'an admin');
  assert.strictEqual((await comment(org, post, stranger, 'Ja nie som člen')).status, 403);
  assert.strictEqual((await comment(org, post, null, 'Neprihlásený')).status, 401);
  assert.strictEqual((await comment(org, post, member, '   ')).status, 400);
  assert.strictEqual((await comment(org, post, member, 'a'.repeat(1001))).status, 400);
  assert.strictEqual((await comment(org, post, member, 'a'.repeat(1000))).status, 201);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts/${post.id}/comments`, { cookie: member.cookie, body: { body: 12 } })).status, 400);
});

test('everybody can read the comments of an open community; the stranger sees that he cannot write', async () => {
  const seen = await comments(org, post, null);
  assert.strictEqual(seen.status, 200);
  assert.strictEqual(seen.json.items.length, 3);
  assert.strictEqual(seen.json.canComment, false);
  assert.strictEqual((await comments(org, post, stranger)).json.canComment, false);
  assert.deepStrictEqual(seen.json.items.map((c) => c.authorName), ['Kom Clen', 'Kom Majitel', 'Kom Clen'], 'oldest first');
});

test('older comments are paged: the newest 20 come first, ?before= gives the ones before', async () => {
  const busy = (await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Rušná novinka' } })).json;
  for (let i = 1; i <= 25; i += 1) assert.strictEqual((await comment(org, busy, i % 2 ? member : member2, `Komentár ${i}`)).status, 201); // two writers: one may write 20 a minute at most
  const page = (await comments(org, busy, member)).json;
  assert.strictEqual(page.items.length, 20);
  assert.strictEqual(page.more, true);
  assert.strictEqual(page.items[page.items.length - 1].body, 'Komentár 25');
  const older = (await comments(org, busy, member, `?before=${page.items[0].id}`)).json;
  assert.strictEqual(older.items.length, 5);
  assert.strictEqual(older.more, false);
  assert.strictEqual(older.items[0].body, 'Komentár 1');
});

test('the author of a post is pushed about a comment (not about his own); the push names the commenter', async () => {
  const rows = sql('SELECT payload FROM player_push_log WHERE player_id = ?', owner.id).map((r) => JSON.parse(r.payload));
  assert.ok(rows.some((p) => p.title.includes('Kom Clen') && (p.title + p.body).includes('Skvelé')), JSON.stringify(rows.slice(0, 3)));
  const before = sql('SELECT COUNT(*) AS n FROM player_push_log WHERE player_id = ?', owner.id)[0].n;
  await comment(org, post, owner, 'Odpoveď sebe samému');
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM player_push_log WHERE player_id = ?', owner.id)[0].n, before, 'no push to himself');
});

test('the author of a post also gets it in the bell (with the unread count); his own comment makes none; it is cleared by reading it', async () => {
  const bell = async (who) => (await call('GET', '/api/player/notifications', { cookie: who.cookie })).json.filter((n) => n.type === 'COMMENT');
  const unread = async (who) => (await call('GET', '/api/player/session', { cookie: who.cookie })).json.unreadNotificationCount;
  const items = await bell(owner);
  assert.ok(items.length >= 2, JSON.stringify(items));
  const first = items.find((n) => n.comment.body.includes('Skvelé'));
  assert.ok(first, 'the comment of the member is in the bell');
  assert.deepStrictEqual([first.comment.authorName, first.comment.orgName, first.comment.orgSlug, first.seen], ['Kom Clen', 'Komentare komunita', org.slug, false]);
  assert.ok(await unread(owner) >= items.length);
  assert.strictEqual((await bell(member)).length, 0, 'the commenter gets nothing about his own comment');
  assert.ok(!items.some((n) => n.comment.body.includes('sebe samému')), 'a comment of the author on his own post makes no bell');
  const before = await unread(owner);
  assert.strictEqual((await call('POST', `/api/player/notifications/comment/${first.id}/read`, { cookie: member.cookie })).status, 404, 'not his notification');
  const read = await call('POST', `/api/player/notifications/comment/${first.id}/read`, { cookie: owner.cookie });
  assert.strictEqual(read.status, 200, JSON.stringify(read.json));
  assert.strictEqual(read.json.unreadNotificationCount, before - 1);
  assert.strictEqual((await bell(owner)).find((n) => n.id === first.id).seen, true);
});

test('deleting a comment: the author, an admin of the community and the super admin; not another member', async () => {
  const mine = (await comment(org, post, member, 'Zmažem ho')).json;
  const url = `/api/communities/${org.id}/posts/${post.id}/comments/${mine.id}`;
  assert.strictEqual((await call('DELETE', url, { cookie: member2.cookie })).status, 403);
  assert.strictEqual((await call('DELETE', url, { cookie: '' })).status, 401);
  assert.strictEqual((await call('DELETE', url, { cookie: member.cookie })).status, 200);
  const another = (await comment(org, post, member2, 'Správca ma zmaže')).json;
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${post.id}/comments/${another.id}`, { cookie: second.cookie })).status, 200, 'a later admin');
  const third = (await comment(org, post, member2, 'Super admin ma zmaže')).json;
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${post.id}/comments/${third.id}`)).status, 200);
  assert.strictEqual((await call('DELETE', url, { cookie: member.cookie })).status, 404, 'already gone');
});

test('the feed carries the number of comments of a news item', async () => {
  const item = (await call('GET', '/api/communities/feed', { cookie: member.cookie })).json.items.find((i) => i.type === 'POST' && i.id === post.id);
  assert.ok(item && item.commentCount >= 3, JSON.stringify(item));
});

test('a community that decides on every request keeps its comments to its members (403 for the others)', async () => {
  const locked = (await call('POST', '/api/communities', { cookie: (await makePlayer('Kom Zamk Majitel')).cookie, body: { type: 'COMMUNITY', name: 'Zamknuta kom', description: 'x', joinPolicy: 'APPROVAL' } })).json;
  const lockedOwner = sql('SELECT player_id FROM organisation_members WHERE organisation_id = ?', locked.id)[0].player_id;
  assert.ok(lockedOwner);
  assert.strictEqual((await call('GET', `/api/communities/${locked.id}/posts/1/comments`, { cookie: stranger.cookie })).status, 403);
});

test('deleting the news (or the community) takes its comments with it', async () => {
  const doomed = (await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Zmizne' } })).json;
  await comment(org, doomed, member, 'Zmizne tiež');
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM organisation_post_comments WHERE post_id = ?', doomed.id)[0].n, 1);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${doomed.id}`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual(sql('SELECT COUNT(*) AS n FROM organisation_post_comments WHERE post_id = ?', doomed.id)[0].n, 0);
  const keep = sql('SELECT id FROM organisation_posts WHERE organisation_id = ?', org.id).map((r) => r.id);
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual(sql(`SELECT COUNT(*) AS n FROM organisation_post_comments WHERE post_id IN (${keep.map(() => '?').join(',')})`, ...keep)[0].n, 0, 'the community went, its comments too');
});

test('a player cannot flood a post: 20 comments a minute, then 429', async () => {
  const flooder = await makePlayer('Kom Spamer');
  const own = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Spam komunita', description: 'x' } })).json;
  assert.strictEqual((await call('POST', `/api/communities/${own.id}/join`, { cookie: flooder.cookie })).status, 200);
  const target = (await call('POST', `/api/communities/${own.id}/posts`, { cookie: owner.cookie, body: { body: 'Cieľ' } })).json;
  let last = 0;
  for (let i = 0; i < 21; i += 1) last = (await comment(own, target, flooder, `spam ${i}`)).status;
  assert.strictEqual(last, 429);
});

test('the page side: comments under every post (club page and feed), the composer for every admin, in both languages', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const post = pub('js/community-post.js');
  assert.ok(post.includes('function comCommentsHtml') && post.includes('function comBindComments') && post.includes('/comments'), 'the shared comments');
  const club = pub('js/community.js');
  assert.ok(club.includes('comCommentsHtml(p)') && club.includes('comBindComments('), 'the club page has them');
  assert.ok(/const isActing = \(\) => [^\n]*isAdminOfOrg\(\)/.test(club), 'every admin sees the composer without switching to the club profile');
  assert.ok(pub('js/common.js').includes("n.type === 'COMMENT'") && pub('js/common.js').includes("notif.type === 'COMMENT' ? 'comment'"), 'the bell shows a comment and marks it read');
  const feed = pub('js/communities.js');
  assert.ok(feed.includes('comCommentsHtml(p)') && feed.includes('comBindComments('), 'the feed has them');
  const i18n = pub('js/i18n.js');
  for (const key of ['com.commentsOne', 'com.commentsFew', 'com.commentsMany', 'com.commentWrite', 'com.commentSend', 'com.commentsOlder', 'com.commentMembersOnly', 'com.commentDelete', 'com.commentFirst', 'notif.commentTitle']) {
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
