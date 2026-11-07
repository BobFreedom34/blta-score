// Checks of the live screen of a match (/screen/<token>, the button "Live obrazovka" of the match page): the page is served for any token (it asks the API itself),
// says noindex, loads its own files, and the match page has the button that leads to it.
// Run: node scripts/check-match-screen.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-screen-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';

function call(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: 'localhost', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie, 'X-Backend': '1' } : {}) };
    const req = http.request({ host: 'localhost', port: PORT, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const read = (file) => fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');

test('/obrazovka/<token> (English /en/screen/<token>) is the screen page; for a search engine it says noindex', async () => {
  for (const url of ['/obrazovka/some-token', '/en/screen/some-token']) {
    const r = await call('GET', url);
    assert.strictEqual(r.status, 200, url);
    assert.ok(r.text.includes('/js/screen.js') && r.text.includes('/css/screen.css'), url);
    assert.ok(/<meta name="robots" content="[^"]*noindex/.test(r.text), `${url}: robots meta`);
  }
});

test('its script and style are served', async () => {
  assert.strictEqual((await call('GET', '/js/screen.js')).status, 200);
  assert.strictEqual((await call('GET', '/css/screen.css')).status, 200);
});

test('the screen reads a real match from the API (what the page draws it from)', async () => {
  const p1 = (await call('POST', '/api/players', { cookie: admin, body: { name: 'Prvy Hrac', phone: '0900111001' } })).json;
  const p2 = (await call('POST', '/api/players', { cookie: admin, body: { name: 'Druhy Hrac', phone: '0900111002' } })).json;
  const m = await call('POST', '/api/matches', { cookie: admin, body: { category: 'ELITE', format: 'BO3', player1Id: p1.id, player2Id: p2.id, location: 'Kurt 1', scheduledAt: '2026-12-01T17:00:00.000Z' } });
  assert.strictEqual(m.status, 201);
  const got = await call('GET', `/api/matches/${m.json.token}`);
  assert.strictEqual(got.status, 200);
  ['status', 'state', 'player1', 'player2', 'scheduledAt', 'location', 'category'].forEach((k) => assert.ok(k in got.json, `match.${k}`));
  assert.ok(got.json.state.sets && 'setsWon' in got.json.state, 'state.sets / state.setsWon');
});

test('the match page has the "Live obrazovka" button that leads to the screen', () => {
  assert.ok(read('js/match.js').includes('siteUrl(`/screen/${encodeURIComponent(m.token)}`)'));
  const i18n = read('js/i18n.js');
  assert.strictEqual((i18n.match(/'match\.screenBtn':/g) || []).length, 2, 'both languages');
});

test('the schedule of a tournament on the whole screen: /obrazovka-harmonogramu/<id> (English /en/schedule-screen/<id>) is served, noindex, with its files', async () => {
  for (const url of ['/obrazovka-harmonogramu/1', '/en/schedule-screen/1']) {
    const r = await call('GET', url);
    assert.strictEqual(r.status, 200, url);
    assert.ok(r.text.includes('/js/schedule-screen.js') && r.text.includes('/js/court-schedule.js'), url);
    assert.ok(/<meta name="robots" content="[^"]*noindex/.test(r.text), `${url}: robots meta`);
  }
  assert.strictEqual((await call('GET', '/js/schedule-screen.js')).status, 200);
});

test('the schedule API tells the name, the address and the kind of the tournament (the heading and the way back of that page)', async () => {
  const made = await call('POST', '/api/seasons', { cookie: admin, body: { name: 'Screen Open 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' } });
  assert.strictEqual(made.status, 201, made.text);
  const sch = await call('GET', `/api/seasons/${made.json.id}/schedule`);
  assert.strictEqual(sch.status, 200);
  assert.strictEqual(sch.json.seasonName, 'Screen Open 2099');
  assert.strictEqual(sch.json.seasonSlug, made.json.slug);
  assert.strictEqual(sch.json.seasonKind, 'TOURNAMENT');
});

test('the Harmonogram tab has the link "Celá obrazovka" in the timeline and in the list (it keeps the view and the day)', () => {
  const src = read('js/court-schedule.js');
  assert.ok(src.includes('/schedule-screen/${csState.season.id}?view=${csChoice.view}&day=${day}'));
  assert.ok(src.includes('${views}${settings.courtCount ? fullLink'), 'next to the switch of the two views, whichever is open');
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    admin = cookieOf(await call('POST', '/api/admin/login', { body: { password: 'test' } }));
    assert.ok(admin, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 5).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
