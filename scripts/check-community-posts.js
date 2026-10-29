// Checks of the news of a community or club (src/routes/communities.js): a picture in a post, emoji in the text, and the emoji reactions
// players put on a published post.
// Run: node scripts/check-community-posts.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-posts-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

// a 1x1 PNG
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
async function uploadImage(url, cookie, { bytes = PNG, type = 'image/png', name = 'x.png' } = {}) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), name);
  const res = await fetch(base + url, { method: 'POST', headers: { Cookie: cookie }, body: form });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09070${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
let owner;
let fan;
let fan2;
let stranger;
let org;
let other;
let post;

test('setup: a community with an owner, two members and a stranger; a second community', async () => {
  [owner, fan, fan2, stranger] = [await makePlayer('Post Majitel'), await makePlayer('Post Fanusik'), await makePlayer('Post Fanusik Dva'), await makePlayer('Post Cudzi')];
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Posty komunita', description: 'x' } })).json;
  other = (await call('POST', '/api/communities', { cookie: stranger.cookie, body: { type: 'COMMUNITY', name: 'Posty druha', description: 'x' } })).json;
  assert.ok(org.id && other.id);
  for (const p of [fan, fan2]) assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: p.cookie })).status, 200);
});

test('a picture for a post: only an admin of the community uploads one (png/jpg/webp), and the answer is the address of the stored file', async () => {
  const ok = await uploadImage(`/api/communities/${org.id}/post-image`, owner.cookie);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.ok(new RegExp(`^/community-images/${org.id}-post-[\\w.-]+\\.png$`).test(ok.json.url), ok.json.url);
  assert.ok(fs.existsSync(path.join(dir, 'community-images', path.basename(ok.json.url))), 'the file is on the disk');
  assert.strictEqual((await uploadImage(`/api/communities/${org.id}/post-image`, fan.cookie)).status, 403, 'a member is not an admin');
  assert.strictEqual((await uploadImage(`/api/communities/${org.id}/post-image`, '')).status, 401);
  assert.strictEqual((await uploadImage(`/api/communities/${org.id}/post-image`, owner.cookie, { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg' })).status, 400, 'only png, jpg, webp');
  assert.strictEqual((await uploadImage(`/api/communities/${org.id}/post-image`, adminCookie)).status, 201, 'the super admin too');
});

test('a post may have a picture, links and emoji in its text; the picture may be all it has; an empty post is refused', async () => {
  const up = (await uploadImage(`/api/communities/${org.id}/post-image`, owner.cookie)).json.url;
  const made = await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'Pozrite https://example.com/turnaj 🔥🎾', imageUrl: up } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  post = made.json;
  assert.strictEqual(post.body, 'Pozrite https://example.com/turnaj 🔥🎾');
  assert.strictEqual(post.imageUrl, up);
  assert.deepStrictEqual(post.reactions, []);
  const onlyPicture = await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: '', imageUrl: (await uploadImage(`/api/communities/${org.id}/post-image`, owner.cookie)).json.url } });
  assert.strictEqual(onlyPicture.status, 201, JSON.stringify(onlyPicture.json));
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: '  ' } })).status, 400);
  const read = (await call('GET', `/api/communities/${org.id}/posts`, { cookie: '' })).json.items;
  assert.ok(read.some((p) => p.id === post.id && p.imageUrl === up && p.body.includes('🔥')), 'the news show the picture and the emoji');
});

test("a post can only point at a picture this community uploaded: not another community's, not a link, not a path trick", async () => {
  const foreign = (await uploadImage(`/api/communities/${other.id}/post-image`, stranger.cookie)).json.url;
  for (const imageUrl of [foreign, 'https://evil.example.com/x.png', '/community-images/../../etc/passwd', `/community-images/${org.id}-logo-1.png`, 'javascript:alert(1)', 12]) {
    const r = await call('POST', `/api/communities/${org.id}/posts`, { cookie: owner.cookie, body: { body: 'x', imageUrl } });
    assert.strictEqual(r.status, 400, `${imageUrl}: ${JSON.stringify(r.json)}`);
  }
});

test('reactions: a logged-in player puts an emoji on a post and takes it back; a visitor cannot; only the offered emoji count', async () => {
  const url = `/api/communities/${org.id}/posts/${post.id}/reactions`;
  assert.strictEqual((await call('POST', url, { cookie: '', body: { emoji: '🔥' } })).status, 401);
  assert.strictEqual((await call('POST', url, { cookie: fan.cookie, body: { emoji: 'x' } })).status, 400);
  assert.strictEqual((await call('POST', url, { cookie: fan.cookie, body: {} })).status, 400);
  const first = await call('POST', url, { cookie: fan.cookie, body: { emoji: '🔥' } });
  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  assert.deepStrictEqual(first.json.reactions, [{ emoji: '🔥', count: 1, mine: true }]);
  const second = await call('POST', url, { cookie: fan2.cookie, body: { emoji: '🔥' } });
  assert.deepStrictEqual(second.json.reactions, [{ emoji: '🔥', count: 2, mine: true }]);
  await call('POST', url, { cookie: fan2.cookie, body: { emoji: '💪' } });
  const mixed = (await call('GET', `/api/communities/${org.id}/posts`, { cookie: fan.cookie })).json.items.find((p) => p.id === post.id);
  assert.deepStrictEqual(mixed.reactions.map((r) => [r.emoji, r.count, r.mine]).sort(), [['🔥', 2, true], ['💪', 1, false]].sort());
  const visitor = (await call('GET', `/api/communities/${org.id}/posts`, { cookie: '' })).json.items.find((p) => p.id === post.id);
  assert.ok(visitor.reactions.every((r) => r.mine === false), 'a visitor has put nothing');
  const off = await call('POST', url, { cookie: fan.cookie, body: { emoji: '🔥' } });
  assert.deepStrictEqual(off.json.reactions.map((r) => [r.emoji, r.count, r.mine]).sort(), [['🔥', 1, false], ['💪', 1, false]].sort());
});

test("a reaction goes to a post of that community only (404 for another community's post and for a hidden one)", async () => {
  assert.strictEqual((await call('POST', `/api/communities/${other.id}/posts/${post.id}/reactions`, { cookie: fan.cookie, body: { emoji: '🔥' } })).status, 404);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts/999999/reactions`, { cookie: fan.cookie, body: { emoji: '🔥' } })).status, 404);
});

test('the feed carries the picture and the reactions of a news item for a member', async () => {
  const feed = (await call('GET', '/api/communities/feed', { cookie: fan.cookie })).json.items.find((i) => i.type === 'POST' && i.id === post.id);
  assert.ok(feed, 'the post is in the feed');
  assert.strictEqual(feed.imageUrl, post.imageUrl);
  assert.ok(feed.reactions.some((r) => r.emoji === '💪' && r.count === 1));
});

test('deleting a post takes its picture file and its reactions with it', async () => {
  const file = path.join(dir, 'community-images', path.basename(post.imageUrl));
  assert.ok(fs.existsSync(file));
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/posts/${post.id}`, { cookie: owner.cookie })).status, 200);
  assert.ok(!fs.existsSync(file), 'the file is gone');
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/posts/${post.id}/reactions`, { cookie: fan.cookie, body: { emoji: '🔥' } })).status, 404);
});

test('the page side: the gear opens the settings dialog, the composer has the emoji panel and the picture, links are clickable and escaped, the feed has the reactions', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const club = pub('js/community.js');
  assert.ok(club.includes('class="com-gear"') && club.includes("act === 'settings'") && club.includes('function openSettingsDialog'), 'the gear beside the name opens the settings dialog');
  assert.ok(!/<form id="com-settings">[^`]*<\/form>\s*<div class="com-pictures">\s*<label/.test(club.slice(0, club.indexOf('function openSettingsDialog'))), 'the settings are no longer on the page itself');
  assert.ok(club.includes('id="com-post-emoji"') && club.includes('id="com-post-file"') && club.includes('imageUrl: draftImage') && club.includes('comPostText(p.body)') && club.includes('comReactionsHtml(p)'));
  const post = pub('js/community-post.js');
  assert.ok(post.includes('escapeHtml(text)') && post.includes('noopener') && post.includes('nofollow'), 'text is escaped first, links are safe');
  const feed = pub('js/communities.js');
  assert.ok(feed.includes('comPostText(p.body)') && feed.includes('comReactionsHtml(p)') && feed.includes('comBindReactions('));
  for (const page of ['community.html', 'communities.html']) assert.ok(pub(page).includes('/js/community-post.js'), page);
  const i18n = pub('js/i18n.js');
  for (const key of ['com.emoji', 'com.addImage', 'com.react']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, key);
  // the emoji the page offers are the ones the server accepts
  const offered = [...post.match(/COM_REACTIONS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const server = fs.readFileSync(path.join(ROOT, 'src/routes/communities.js'), 'utf8');
  const accepted = [...server.match(/REACTION_EMOJI = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(offered, accepted);
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
