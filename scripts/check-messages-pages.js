// Checks of the page of the private messages (Správy): public/messages.html + public/js/messages.js, its texts (public/js/i18n.js), its SEO (src/seo.js)
// and the menu item with the unread badge.
// Run: node scripts/check-messages-pages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msgpages-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const titleOf = (html) => ((html.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || '').trim();

// every msg.* / page.messagesTitle key used by a file must exist in BOTH language blocks of i18n.js
function checkKeys(file) {
  const src = read(file);
  const i18n = read('js/i18n.js');
  const keys = new Set();
  for (const m of src.matchAll(/t\('((?:msg|page\.messages)[a-zA-Z.]*)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-html|-placeholder)?="((?:msg|page\.messages)[a-zA-Z.]*)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 0, `${file} uses no msg.* keys at all`);
  keys.forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, `${k} must be in both the SK and the EN block`));
}

// ---------- Task 4: the page ----------

test('messages.html exists with the shared scripts, the live connection, its script and the login popup', () => {
  const html = read('messages.html');
  ['/js/localize.js', '/js/i18n.js', '/js/common.js', '/socket.io/socket.io.min.js', '/js/messages.js'].forEach((s) => assert.ok(html.includes(`src="${s}"`), `${s} is not loaded`));
  assert.ok(html.includes('id="msg-root"') && html.includes('id="player-login-modal"') && html.includes('data-i18n="page.messagesTitle"'));
});

test('messages.js uses only texts that exist in both languages, escapes what players write and links only http(s) addresses', () => {
  checkKeys('js/messages.js');
  const js = read('js/messages.js');
  const raw = js.match(/\$\{\s*(?:m|msg|message|o|item|p|c|conv|other|r)\.(?:body|name|slug|photoUrl|lastMessage\.body)\s*\}/g);
  assert.ok(!raw, `a field written by a player goes into a template unescaped: ${raw}`);
  assert.ok(/https\?:/.test(js), 'links are made for http and https');
  assert.ok(!/javascript:/i.test(js.replace(/\/\/.*$/gm, '')), 'no javascript: anywhere in the code');
  assert.ok(js.includes('rel="noopener noreferrer'), 'links open safely');
  assert.ok(js.includes('requireRealPlayer') && js.includes("io(") && js.includes('dm:message') && js.includes('dm:unread') && js.includes('dm:removed'), 'login prompt and the live events');
});

test('the page is served at its Slovak and English address, also for a conversation, and is kept out of search engines', async () => {
  for (const [url, word] of [['/spravy', 'Správy'], ['/en/messages', 'Messages'], ['/konverzacia/12', 'Správy'], ['/en/chat/12', 'Messages'], ['/konverzacia/new', 'Správy']]) {
    const res = await fetch(`${base}${url}`);
    assert.strictEqual(res.status, 200, url);
    const html = await res.text();
    assert.ok(titleOf(html).includes(word), `${url}: title "${titleOf(html)}"`);
    assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(html), `${url} is noindex`);
    assert.ok(html.includes('id="msg-root"'), `${url} is the messages page`);
  }
  const seo = JSON.stringify((await call('GET', '/api/seo')).json);
  assert.ok(seo.includes('"messages"') && seo.includes('"conversation"'), 'Backend > SEO lists both');
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const found = sitemap.split(/\r?\n/).filter((l) => /<loc>[^<]*\/(spravy|konverzacia|messages|chat)(\/|<)/.test(l)).slice(0, 2).join(' | ');
  assert.ok(!found, `not in the sitemap: ${found}`);
});

// ---------- Task 5: the menu item with the unread badge ----------

test('the main menu has "Správy" once, even when the helper runs again, and a deleted item does not come back', async () => {
  const items = async () => (await call('GET', '/api/header-items', { cookie: '' })).json.filter((i) => i.link === '/messages');
  const first = await items();
  assert.strictEqual(first.length, 1, 'one menu item');
  assert.strictEqual(first[0].labelSk, 'Správy');
  assert.strictEqual(first[0].labelEn, 'Messages');
  const run = "const db = require('./src/db'); const s = require('./src/seasonSeed'); s.ensureMessagesMenuItem(db); s.ensureMessagesMenuItem(db);";
  const exec = () => require('child_process').execFileSync(process.execPath, ['-e', run], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
  exec();
  assert.strictEqual((await items()).length, 1, 'still one after running it twice more');
  assert.ok([200, 204].includes((await call('DELETE', `/api/header-items/${first[0].id}`)).status));
  exec();
  assert.strictEqual((await items()).length, 0, 'a deleted item is not put back (the flag stays)');
});

test('common.js asks for the unread count only after a player session, shows the badge on the menu item and listens to the page that updates it live', () => {
  const js = read('js/common.js');
  assert.ok(js.includes("api('/messages/unread')"), 'it asks for the unread count');
  const at = js.indexOf("api('/messages/unread')");
  const fn = js.slice(js.lastIndexOf('async function refreshMessageBadge', at), at);
  assert.ok(/playerAuthed/.test(fn) && /currentPlayerId/.test(fn), 'the call is guarded by the player session');
  assert.ok(js.includes('nav-msg-badge') && js.includes('applyMessageBadge') && js.includes("'msg:unread'"));
  assert.ok(/blta:auth-changed', refreshMessageBadge/.test(js), 'it runs after the session is known');
  assert.ok(read('js/messages.js').includes("'msg:unread'"), 'the Messages page tells the menu when the count changes');
  assert.ok(read('css/style.css').includes('.nav-msg-badge'), 'the badge has a style');
});

// ---------- Fixes after the final review (front end) ----------

test('the page follows the session (a logout or another player reloads it), starts once, and catches up after a reconnect or a hidden tab', () => {
  const js = read('js/messages.js');
  assert.ok(js.includes('initializing'), 'init() does not run twice at the same time');
  assert.ok(/id === myId/.test(js) && js.includes('window.location.reload()'), 'a different (or no) player on the page reloads it');
  assert.ok(js.includes("socket.on('connect'") && js.includes('resync'), 'after a reconnect the open chat and the inbox are loaded again');
  assert.ok(/visibilitychange[\s\S]{0,200}resync/.test(js), 'a tab that comes back resyncs before it marks anything read');
});

test('sending is guarded (no double send), keeps the keyboard, the composer wakes up when the other side answers, and a draft survives a re-render', () => {
  const js = read('js/messages.js');
  assert.ok(js.includes('let sending') && /if \(sending \|\| /.test(js), 'one send at a time');
  assert.ok(!/input\.disabled = true/.test(js), 'the textarea is not disabled while sending (it would close the phone keyboard)');
  assert.ok(js.includes('keepDraft') && js.includes('restoreDraft'), 'the draft is kept');
  assert.ok(/requestAllowanceLeft !== null/.test(js), 'an answer re-reads the conversation so the composer opens again');
  assert.ok(js.includes('maxlength="2000"'), 'the box takes what the server takes');
  assert.ok(js.includes('pointer: fine') && js.includes('isComposing'), 'Enter sends on a computer only and never in the middle of an IME composition');
});

test('links are cut out of the raw text (a quote or a bracket ends the address), in upper case too', () => {
  const js = read('js/messages.js');
  assert.ok(/\[\^\\s<>"'\]/.test(js) && /gi\b/.test(js.slice(js.indexOf('function linkify'))), 'the address stops at whitespace, < > " and \'; the match is case-insensitive');
});

test('the menu badge skips heading links ("#") and the Messages page layout leaves room for the bottom navigation up to 1024 px', () => {
  assert.ok(/getAttribute\('href'\)/.test(read('js/common.js').slice(read('js/common.js').indexOf('function applyMessageBadge'))), 'the badge looks at the written href');
  const css = read('css/style.css');
  const at = css.indexOf('/* Správy / Messages');
  assert.ok(/@media \(max-width: 1024px\)[^{]*\{[^}]*\.msg-layout[^}]*safe-area-inset-bottom/.test(css.slice(at)), 'tablet and landscape: height minus the bottom navigation');
});

test('the new texts exist in both languages, and the server messages are shown in the language of the page', () => {
  const i18n = read('js/i18n.js');
  ['msg.errWait', 'msg.errFast', 'msg.errBlocked', 'msg.errInvalid'].forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, k));
  assert.ok(read('js/messages.js').includes('msg.errWait') && read('js/common.js').includes('err.status = res.status'), 'errors carry their status and are mapped to texts');
});

test('the profile of a player has a "Write a message" button beside the planned matches: it starts the chat and opens it, asks a visitor to log in first, and is not shown on your own profile', () => {
  const html = read('player.html');
  assert.ok(/class="player-stat-row"/.test(html) && html.includes('id="player-msg-btn"'), 'the button sits in a row with the planned matches tile');
  assert.ok(html.indexOf('player-upcoming-stat') > html.indexOf('player-stat-row') && html.indexOf('id="player-msg-btn"') > html.indexOf('player-upcoming-stat'), 'after the tile');
  const js = read('js/player.js');
  const at = js.indexOf('player-msg-btn');
  assert.ok(at > 0, 'the page script wires it');
  const block = js.slice(js.indexOf('function updateMessageButton'), js.indexOf('function updateMessageButton') + 1800);
  assert.ok(block.includes('playerAuthed') && block.includes('currentPlayerId') && block.includes('style.display'), 'it is hidden on the own profile');
  assert.ok(js.includes("'/messages/conversations'") && js.includes('playerId: currentPlayer.id'), 'the chat is started with this player');
  assert.ok(js.includes('requireRealPlayer(') && js.includes('siteUrl(`/messages/${') , 'a visitor logs in first, then the chat is opened');
  assert.ok(js.includes('toast(err.message)'), 'a refusal of the server (blocked, too many strangers today, no phone) is shown');
  const i18n = read('js/i18n.js');
  assert.strictEqual(i18n.split("'player.writeMessage':").length, 3, 'the label exists in both languages');
  const css = read('css/style.css');
  assert.ok(css.includes('.player-stat-row {') && css.includes('.player-msg-btn {'), 'it is styled');
  // it is a tile of the page, like the planned matches tile beside it: the same grey, corner radius and faint border (not a green block with sharp corners)
  const rule = css.slice(css.indexOf('.player-msg-btn {'), css.indexOf('}', css.indexOf('.player-msg-btn {')));
  assert.ok(rule.includes('background: var(--fill-grey)') && rule.includes('border-radius: var(--radius)') && rule.includes('rgba(255, 255, 255, 0.07)'), 'the look of the tile: ' + rule);
  assert.ok(/\.player-msg-btn \.venue-icon \{[^}]*color: var\(--status-green\)/.test(css), 'the icon is green');
  assert.ok(!/class="[^"]*btn-join/.test(html.slice(html.indexOf('id="player-msg-btn"') - 120, html.indexOf('id="player-msg-btn"'))), 'not the green Join button');
});

test('an admin without a player profile is not "logged in" for the player-only features: their login buttons open the login window (they used to do nothing)', () => {
  const common = read('js/common.js');
  const at = common.indexOf('function requireRealPlayer');
  assert.ok(at > 0, 'requireRealPlayer exists');
  const fn = common.slice(at, at + 500);
  assert.ok(fn.includes('playerAuthed') && fn.includes('currentPlayerId') && fn.includes('openPlayerLoginModal(onReady)'), 'it needs a player identity, else it opens the login window');
  // (the session of an admin says isPlayer: true with no player id, so requirePlayerAuth lets him through and the button did nothing)
  assert.ok(read('js/messages.js').includes("requireRealPlayer(init)") && !read('js/messages.js').includes('requirePlayerAuth(init)'), 'the Messages login button');
  const communities = read('js/communities.js');
  assert.ok(communities.includes('requireRealPlayer(openCreate)') && communities.includes('requireRealPlayer(() => {})') && !/requirePlayerAuth\(/.test(communities), 'the communities list');
  assert.ok(!/requirePlayerAuth\(/.test(read('js/community.js').slice(read('js/community.js').indexOf("act === 'join'"), read('js/community.js').indexOf("act === 'join'") + 120)), 'Join');
  assert.ok(read('js/player.js').includes('messageBtn.addEventListener(\'click\', () => requireRealPlayer('), 'Write a message');
});

test('cookie-signature is a declared dependency (the live connection uses it directly)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && pkg.dependencies['cookie-signature']);
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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
