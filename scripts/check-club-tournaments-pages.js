// Checks of the front end of the tournaments of clubs: the Events tab and the create dialog on the club page (public/js/community.js), the manage page
// (public/club-tournament.html) which opens the editor of a tournament (public/js/seasons-admin.js) in club mode, their texts (js/i18n.js) and SEO (src/seo.js).
// Run: node scripts/check-club-tournaments-pages.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctpages-'));
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
const i18n = read('js/i18n.js');
const inBothLanguages = (key) => assert.strictEqual(i18n.split(`'${key}':`).length, 3, `${key} must be in both the SK and the EN block`);

test('the Events tab and the create dialog: every text exists in both languages, every field written by a player is escaped, the dialog posts to the club', () => {
  const src = read('js/community.js');
  const keys = new Set([...src.matchAll(/t\('((?:com|ct)\.[a-zA-Z]+)'/g)].map((m) => m[1]));
  ['com.newTournament', 'com.tournamentTitle', 'com.eventRegister', 'com.eventView', 'com.eventManage', 'com.eventRegistered', 'com.tCreate', 'com.tFieldInfo'].forEach((k) => assert.ok(keys.has(k), `${k} is used`));
  keys.forEach(inBothLanguages);
  const raw = src.match(/\$\{\s*s\.(?:name|venue|slug)\s*\}/g);
  assert.ok(!raw, `a field of a tournament reaches a template unescaped: ${raw}`);
  assert.ok(src.includes('escapeHtml(s.name)') && src.includes('encodeURIComponent(s.slug)'), 'name and slug are escaped');
  assert.ok(src.includes('/tournaments`, { method: \'POST\'') && src.includes("data-act=\"new-tournament\""), 'the dialog posts to /communities/:id/tournaments');
  // only the admin of the club that has switched to it sees the button, and only an approved club can make one
  assert.ok(/isActing\(\) && org\.approved \?/.test(src), 'the create button is for the acting admin of an approved club');
  assert.ok(src.includes("/community-tournament/${s.id}") || src.includes('/community-tournament/'), 'the manage link');
});

test('club-tournament.html: the shell of the club page, the editor scripts, club mode', () => {
  const html = read('club-tournament.html');
  ['/js/localize.js', '/js/i18n.js', '/js/common.js', '/js/season-assign.js', '/js/season-draw.js', '/js/seasons-admin.js'].forEach((s) => assert.ok(html.includes(`src="${s}"`), `${s} is not loaded`));
  assert.ok(html.includes('id="seasons-admin-root" data-club="1"') && html.includes('id="player-login-modal"'));
  assert.ok(!html.includes('/js/community.js'), 'it does not load the club page script');
  ['page.clubTournamentTitle', 'ct.back'].forEach((k) => assert.ok(html.includes(`data-i18n="${k}"`), k));
  ['page.clubTournamentTitle', 'ct.back', 'ct.loginNeeded', 'ct.login', 'ct.notFound'].forEach(inBothLanguages);
});

test('seasons-admin.js club mode: it reads the one tournament, has no list and no add form, sends the organiser back to his club after a delete', () => {
  const js = read('js/seasons-admin.js');
  assert.ok(js.includes('const CLUB = !!(root && root.dataset.club)'));
  assert.ok(js.includes('api(`/seasons/${CLUB_SEASON_ID}`)'), 'it starts from GET /api/seasons/:id');
  assert.ok(/if \(CLUB\) \{\s*root\.innerHTML = '<div id="season-list">/.test(js), 'no add form in club mode');
  assert.ok(js.includes('if (CLUB) { window.location.href'), 'after a delete he goes back to the club');
  // a redirect to a code address (/community/..) is a 404 unless it goes through siteUrl(): only <a> links are rewritten by localize.js
  assert.ok(/window\.location\.href = siteUrl\(/.test(js) && !/window\.location\.href = [`'"]\//.test(js), 'redirects of the editor go through siteUrl()');
  const community = read('js/community.js');
  assert.ok(/window\.location\.href = siteUrl\(`\/community-tournament\//.test(community), 'the create dialog goes to the manage page through siteUrl()');
  ['ct.loginNeeded', 'ct.login', 'ct.notFound'].forEach((k) => assert.ok(js.includes(`t('${k}')`), k));
});

// Every endpoint the editor can call is either one the organiser of the club may call (the routes of Tasks 2-3 of the plan) or one that only the league
// card / the "add a tournament" form reaches (never drawn in club mode). A new call has to be put in one of the two tables on purpose.
test('the editor calls only endpoints the organiser of a club may call, or ones the club mode never reaches', async () => {
  const calls = [];
  for (const f of ['js/seasons-admin.js', 'js/season-assign.js', 'js/season-draw.js', 'js/bracket-result.js', 'js/court-schedule.js']) {
    for (const m of read(f).matchAll(/api\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g)) calls.push({ file: f, path: (m[1] || m[2] || m[3]).replace(/\$\{[^}]*\}/g, ':x').replace(/(:x)+/g, ':x').replace(/\?.*$/, '') });
  }
  assert.ok(calls.length > 25, `found ${calls.length} calls`);
  const allowed = [/^\/seasons\/:x$/, /^\/seasons\/:x\/(hero|logo|registrations|registrations\/(admin|remind|categories)|draw|seeds|draw\/groups-suggestion|draw\/bracket|doubles|doubles\/pairs|doubles\/pairs\/:x|draw\/:x|schedule|schedule\/matches\/:x\/?:x?|schedule\/settings|schedule\/auto)$/,
    /^\/seasons\/registrations\/:x$/, /^\/brackets\/:x\/(consolation|nodes\/:x\/result|slots\/:x)$/, /^\/matches\/:x\/manual-result$/, /^\/(courtiq|rankings|players)$/,
    /^:x\/pairs(\/:x)?$/, /^:x\/(settings|auto)$/, /^\/seasons\/:x\/schedule\/matches\/:x$/];
  // the league card, the add-a-tournament form and the old admin pages (the bracket admin page is not part of club mode)
  const clubModeNever = [/^\/seasons$/, /^\/seasons\/:x\/groups$/, /^\/seasons\/groups\/:x(\/members(\/:x(\/withdraw)?|\/import)?)?$/, /^\/seasons\/:x\/schedule(-preview)?$/, /^\/brackets$/, /^\/brackets\/:x$/, /^:x$/];
  const unknown = calls.filter((c) => ![...allowed, ...clubModeNever].some((re) => re.test(c.path)));
  assert.deepStrictEqual(unknown.map((c) => `${c.file}: ${c.path}`), [], 'classify the new endpoint in the tables of this test');
});

test('the manage page is served at both addresses, is noindex, and is listed in Backend > SEO', async () => {
  const sk = await fetch(`${base}/turnaj-klubu/7`);
  assert.strictEqual(sk.status, 200);
  const skHtml = await sk.text();
  assert.ok(skHtml.includes('id="seasons-admin-root"'));
  assert.ok(/<meta name="robots" content="noindex/.test(skHtml) || /noindex/i.test(sk.headers.get('x-robots-tag') || ''), 'noindex');
  const en = await fetch(`${base}/en/club-tournament/7`);
  assert.strictEqual(en.status, 200);
  assert.ok(/noindex/i.test(await en.text()) || /noindex/i.test(en.headers.get('x-robots-tag') || ''), 'noindex in English');
  const seo = await call('GET', '/api/seo');
  assert.ok(JSON.stringify(seo.json).includes('"clubtournament"'), 'Backend > SEO lists the page');
  assert.ok(!(await (await fetch(`${base}/sitemap.xml`)).text()).includes('community-tournament'), 'it is not in the sitemap');
});

test('the public pages draw the organiser\'s controls from canManage: the result buttons and the court planner', () => {
  assert.ok(read('js/bracket-result.js').includes('data.canManage'), 'result buttons');
  assert.ok(read('js/court-schedule.js').includes('season.canManage'), 'court planner');
});

test('the Harmonogram labels a club tournament with its club and every club label is escaped', () => {
  const js = read('js/harmonogram.js');
  assert.ok(js.includes('sch-club') && js.includes('e.organisation.name') && js.includes('encodeURIComponent(e.organisation.slug)'));
  assert.ok(!/\$\{\s*e\.organisation\.(?:name|slug)\s*\}/.test(js), 'unescaped club name');
  ['schedule.organiser'].forEach(inBothLanguages);
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
