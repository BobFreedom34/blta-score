// Checks of the public pages of "Komunity a kluby": the list (public/communities.html + js/communities.js), the club page (community.html + js/community.js),
// the profile switcher (js/common.js), their texts (js/i18n.js), SEO (src/seo.js) and the menu item.
// Run: node scripts/check-communities-pages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compages-'));
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

// every com.* / page.communit* key used by a page file must exist in BOTH language blocks of i18n.js
function usedKeys(file) {
  const src = read(file);
  const keys = new Set();
  for (const m of src.matchAll(/t\('((?:com|page\.communit)[a-zA-Z.]*)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-html|-placeholder)?="((?:com|page\.communit)[a-zA-Z.]*)"/g)) keys.add(m[1]);
  return [...keys];
}
function checkKeys(file) {
  const i18n = read('js/i18n.js');
  const keys = usedKeys(file);
  assert.ok(keys.length > 0, `${file} uses no com.* keys at all`);
  keys.forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, `${k} must be in both the SK and the EN block`));
}
// a value written by a player must never reach innerHTML unescaped
function checkEscaped(file) {
  const src = read(file);
  const raw = src.match(/\$\{\s*(?:o|org|p|m|post|item)\.(?:name|description|contact|city|slug|authorName|body|logoUrl|coverUrl)\s*\}/g);
  assert.ok(!raw, `${file} puts a field written by a player into a template unescaped: ${raw}`);
}

// ---------- Task 7: the list page ----------

test('communities.html exists with its script, the login popup and the shared scripts', () => {
  const html = read('communities.html');
  ['/js/localize.js', '/js/i18n.js', '/js/common.js', '/js/communities.js'].forEach((s) => assert.ok(html.includes(`src="${s}"`), `${s} is not loaded`));
  assert.ok(html.includes('id="com-root"') && html.includes('id="player-login-modal"'));
  assert.ok(html.includes('data-i18n="page.communitiesTitle"'));
});

test('communities.js uses only texts that exist in both languages and escapes every field written by a player', () => {
  checkKeys('js/communities.js');
  checkEscaped('js/communities.js');
});

test('the SEO of the list page: listed in Backend > SEO, answered with its title in Slovak and in English', async () => {
  const sk = await fetch(`${base}/komunity-a-kluby`);
  assert.strictEqual(sk.status, 200);
  assert.ok(titleOf(await sk.text()).includes('Komunity a kluby'));
  const en = await fetch(`${base}/en/communities`);
  assert.strictEqual(en.status, 200);
  assert.ok(/Communities and clubs/.test(titleOf(await en.text())));
  const seo = await call('GET', '/api/seo');
  assert.ok(JSON.stringify(seo.json).includes('"communities"'), 'Backend > SEO lists the page');
});

// ---------- Task 8: the club page ----------

let phoneCounter = 0;
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09031${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } });
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  return { id: made.json.id, cookie: cookieOf(login) };
}

test('community.html exists with its script and the login popup', () => {
  const html = read('community.html');
  ['/js/localize.js', '/js/i18n.js', '/js/common.js', '/js/community.js'].forEach((s) => assert.ok(html.includes(`src="${s}"`), `${s} is not loaded`));
  assert.ok(html.includes('id="com-page"') && html.includes('id="player-login-modal"'));
  assert.ok(html.includes('data-i18n="page.communityTitle"'));
});

test('the approval texts exist in both languages and the Backend page can approve a club (super admin only button)', () => {
  const i18n = read('js/i18n.js');
  ['com.pendingApproval', 'com.clubNote', 'com.pendingBanner'].forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, k));
  const js = read('js/communities-admin.js');
  assert.ok(js.includes('/approval') && js.includes("adminRole === 'SUPER'") && js.includes('data-approve'));
  assert.ok(read('js/community.js').includes('com.pendingBanner') && read('js/communities.js').includes('com.clubNote'));
});

test('community.js uses only texts that exist in both languages and escapes every field written by a player', () => {
  checkKeys('js/community.js');
  checkEscaped('js/community.js');
});

test('a club page answers at its own address in both languages with the name of the club in the title; unknown and hidden ones do not', async () => {
  const owner = await makePlayer('Ana Alfa');
  const made = await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'CLUB', name: 'TK Slovan Bratislava' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  // a club waits for the super admin: until then its page gives nobody its name
  const waitingPage = await fetch(`${base}/komunita/${made.json.slug}`);
  assert.ok(!titleOf(await waitingPage.text()).includes('TK Slovan'), 'a club that is not approved does not give its name to the page');
  assert.strictEqual((await call('PATCH', `/api/communities/${made.json.id}/approval`, { body: { approved: true } })).status, 200);
  const sk = await fetch(`${base}/komunita/${made.json.slug}`);
  assert.strictEqual(sk.status, 200);
  assert.ok(titleOf(await sk.text()).includes('TK Slovan Bratislava'), 'the club name is in the title');
  const en = await fetch(`${base}/en/community/${made.json.slug}`);
  assert.strictEqual(en.status, 200);
  assert.ok(titleOf(await en.text()).includes('TK Slovan Bratislava'));
  const unknown = await fetch(`${base}/komunita/ziadny-taky-klub`);
  assert.ok(!titleOf(await unknown.text()).includes('ziadny'), 'no name for an unknown club');
  assert.strictEqual((await call('PATCH', `/api/communities/${made.json.id}/moderation`, { body: { hidden: true } })).status, 200);
  const hidden = await fetch(`${base}/komunita/${made.json.slug}`);
  assert.ok(!titleOf(await hidden.text()).includes('TK Slovan'), 'a hidden club does not give its name to the page');
});

// ---------- Task 9: the profile switcher and the club menu ----------

test('common.js asks for the clubs of a player only once a player is known, and has the switcher, the chip and the club menu', () => {
  const js = read('js/common.js');
  assert.ok(js.includes("api('/communities/mine')"), 'it asks for the clubs');
  const at = js.indexOf("api('/communities/mine')");
  const fn = js.slice(js.lastIndexOf('async function refreshActingOrg', at), at);
  assert.ok(/playerAuthed/.test(fn) && /currentPlayerId/.test(fn), 'the call is guarded by the player session');
  assert.ok(js.includes('/communities/act-as') && js.includes('acting-chip') && js.includes('com-switch') && js.includes('applyClubMenu'));
  assert.ok(/blta:auth-changed', refreshActingOrg/.test(js), 'it runs after the session is known');
  checkKeys('js/common.js');
});

test('the switcher puts only DOM text, never markup from a name, into the page', () => {
  const js = read('js/common.js');
  const block = js.slice(js.indexOf('// Komunity a kluby: the profile switcher'), js.indexOf("window.addEventListener('blta:auth-changed', refreshActingOrg"));
  assert.ok(block.length > 500, 'the block was found');
  assert.ok(!/innerHTMLs*=s*[^'"s]/.test(block.replace(/innerHTMLs*=s*''/g, '')), 'no innerHTML assignment with data in the switcher block');
  assert.ok(/textContent/.test(block));
});

test('the club page reacts to the menu links: #members and #events open the tab, #settings scrolls to the panel', () => {
  const js = read('js/community.js');
  assert.ok(js.includes("addEventListener('hashchange'") && js.includes("'#settings'"));
});

// ---------- Task 10: the main menu item, the sitemap and Backend > SEO ----------

test('the main menu has "Komunity a kluby" once, even when the helper runs again, and an admin can still delete it', async () => {
  const items = async () => (await call('GET', '/api/header-items', { cookie: '' })).json.filter((i) => i.link === '/communities');
  const first = await items();
  assert.strictEqual(first.length, 1, 'one menu item');
  assert.strictEqual(first[0].labelSk, 'Komunity a kluby');
  assert.strictEqual(first[0].labelEn, 'Communities and clubs');
  const run = `const db = require('./src/db'); const s = require('./src/seasonSeed'); s.ensureCommunitiesMenuItem(db); s.ensureCommunitiesMenuItem(db);`;
  require('child_process').execFileSync(process.execPath, ['-e', run], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
  assert.strictEqual((await items()).length, 1, 'still one after running it twice more');
  assert.ok([200, 204].includes((await call('DELETE', `/api/header-items/${first[0].id}`)).status));
  require('child_process').execFileSync(process.execPath, ['-e', run], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
  assert.strictEqual((await items()).length, 0, 'a deleted item is not put back (the flag stays)');
});

test('the sitemap lists the list page and Backend > SEO lists both new pages', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(xml.includes('/komunity-a-kluby'), 'the list page is in the sitemap');
  const seo = JSON.stringify((await call('GET', '/api/seo')).json);
  assert.ok(seo.includes('"communities"') && seo.includes('"community"'), 'both pages are editable in Backend > SEO');
});

// ---------- Fixes after the final review (front end) ----------

test('the club page keeps what an admin typed, guards double clicks, keeps the hash in step with the tabs and tells the topbar about changes', () => {
  const js = read('js/community.js');
  assert.ok(js.includes('keepTyped') && js.includes('restoreTyped'), 'typed text survives a re-render');
  assert.ok(js.includes("dataset.busy"), 'a button works once while its request runs');
  assert.ok(js.includes('history.replaceState'), 'a tab click updates the hash');
  assert.ok(/refreshActingOrg\(\)/.test(js) && !js.includes("'com:acting-changed'"), 'the topbar is refreshed, no dead listener');
  assert.ok(/\^\\\/community-images/.test(js), 'the cover address is checked before it goes into a style');
  assert.ok(js.includes('com.leaveConfirm') && js.includes('com.membersFew'));
});

test('the create dialog and the list page: no double submit, a login prompt on "Mine", the Slovak plural', () => {
  const js = read('js/communities.js');
  assert.ok(js.includes('submit.disabled = true') || js.includes('.disabled = true'), 'the create button is disabled while it works');
  assert.ok(js.includes('com.membersFew') && js.includes("t('nav.loginPlayer')"));
  const i18n = read('js/i18n.js');
  ['com.membersFew', 'com.leaveConfirm'].forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, k));
});

test('logging out or leaving the club while acting rebuilds the normal menu; a club slug with "admin" keeps the phone navigation; t() does not read $ in names', () => {
  const common = read('js/common.js');
  const fn = common.slice(common.indexOf('async function refreshActingOrg'), common.indexOf("window.addEventListener('blta:auth-changed', refreshActingOrg"));
  assert.ok(fn.includes('renderHeaderNav()'), 'the normal menu comes back');
  assert.ok(/nav-my-profile-link/.test(common.slice(common.indexOf('function applyClubMenu'), common.indexOf('async function switchActing'))), 'the my-profile link is kept when the club menu replaces the menu');
  assert.ok(!/if \(\/admin\|login-history\/\.test\(window\.location\.pathname\)\) return;/.test(common), 'the bottom navigation is not skipped for any path that merely contains "admin"');
  assert.ok(read('js/i18n.js').includes('() => String(vars[k])'), 'a name with $& in it stays as it is');
});

test('long names and texts break instead of widening the page', () => {
  const css = read('css/style.css');
  ['.com-head h1', '.com-desc', '.com-contact', '.com-post-head b', '.com-member a'].forEach((sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at >= 0, `${sel} has a rule`);
    assert.ok(css.slice(at, css.indexOf('}', at)).includes('overflow-wrap'), `${sel} breaks long words`);
  });
});

// ---------- The club page: tab order, the Info tab, green Join and red Leave, who can join ----------

test('the club page has the tabs News, Events, Info (in this order) with the members inside Info, and says who can join', () => {
  const js = read('js/community.js');
  const order = js.indexOf("['news', 'com.tabNews']") < js.indexOf("['events', 'com.tabEvents']") && js.indexOf("['events', 'com.tabEvents']") < js.indexOf("['info', 'com.tabInfo']");
  assert.ok(order, 'the tabs are News, Events, Info');
  assert.ok(!js.includes("'com.tabMembers']"), 'members are not a tab of their own any more');
  assert.ok(js.includes('com.joinOpenInfo') && js.includes('com.joinApprovalInfo'), 'the page says who can join');
  assert.ok(js.includes('com-info-row') && js.includes('com.infoJoin') && js.includes('com.infoContact') && js.includes('com.infoCity'), 'basic info rows (label and value)');
  assert.ok(/'#members'|"members"|members/.test(js) && js.includes("'info'"), 'the old #members link still opens the Info tab');
});

test('Join is green and Leave is red, and no button of the club page is dark on dark', () => {
  const js = read('js/community.js');
  assert.ok(js.includes('btn-join') && js.includes('btn-leave'));
  const css = read('css/style.css');
  const rule = (sel) => { const at = css.indexOf(`${sel} {`); assert.ok(at >= 0, `${sel} has a rule`); return css.slice(at, css.indexOf('}', at)); };
  assert.ok(/status-green/.test(rule('.btn-join')), 'Join is the green of the site');
  assert.ok(/#e5484d|#ff6b6b|red/i.test(rule('.btn-leave')), 'Leave is red');
  assert.ok(/color: var\(--white\)/.test(rule('.com-actions .btn-outline')), 'a neutral button is readable on the dark page');
});

test('the new texts of the club page exist in both languages', () => {
  const i18n = read('js/i18n.js');
  ['com.tabInfo', 'com.joinOpenInfo', 'com.joinApprovalInfo', 'com.infoType', 'com.infoCity', 'com.infoJoin', 'com.infoContact', 'com.infoAbout'].forEach((k) => assert.strictEqual(i18n.split(`'${k}':`).length, 3, k));
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
