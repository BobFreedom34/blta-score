// Checks of the live video of the courts of a tournament: the link helper, PATCH /api/seasons/:id (courtStreams), what the season, schedule and draw data carry,
// and the pieces on the pages (admin inputs, button in the Harmonogram, "Live video" tab).
// Run: node scripts/check-court-streams.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { parseCourtStreams, streamsOf, fitToCount } = require('../src/courtStreams');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { body, cookie = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or js */ }
  return { status: res.status, json, text };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });

const A = 'AAAAAAAAAAA';
const C = 'CCCCCCCCCCC';
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;
let tournament;

test('the helper: links become ids padded to the number of courts, bad ones are refused', () => {
  assert.deepStrictEqual(parseCourtStreams(['https://youtu.be/dQw4w9WgXcQ', ''], 3), { ids: ['dQw4w9WgXcQ', '', ''] });
  assert.deepStrictEqual(parseCourtStreams([], 2), { ids: ['', ''] });
  assert.ok(parseCourtStreams(['a', 'b'], 1).error, 'more links than courts');
  for (const bad of ['https://www.youtube.com/@bltatennis/live', 'javascript:alert(1)', 'https://vimeo.com/123', 'not a link']) {
    const r = parseCourtStreams([bad], 1);
    assert.ok(r.error && /YouTube/.test(r.error), bad);
  }
  assert.ok(parseCourtStreams('x', 2).error, 'not a list');
  assert.ok(parseCourtStreams([5], 1).error, 'not text');
});

test('streamsOf and fitToCount read the stored ids safely', () => {
  assert.deepStrictEqual(streamsOf({ court_count: 3, court_streams: '["dQw4w9WgXcQ"]' }), [{ videoId: 'dQw4w9WgXcQ', url: watch('dQw4w9WgXcQ') }, null, null]);
  assert.deepStrictEqual(streamsOf({ court_count: 2, court_streams: 'not json' }), [null, null]);
  assert.deepStrictEqual(streamsOf({ court_count: 0, court_streams: '["dQw4w9WgXcQ"]' }), []);
  assert.deepStrictEqual(streamsOf({ court_count: 1, court_streams: '["dQw4w9WgXcQ","AAAAAAAAAAA"]' }).length, 1, 'extra entries are cut');
  assert.deepStrictEqual(streamsOf({ court_count: 1, court_streams: '["not-an-id"]' }), [null], 'a stored value that is no id is ignored');
  assert.deepStrictEqual(fitToCount({ court_streams: '["AAAAAAAAAAA","","CCCCCCCCCCC"]' }, 2), [A, '']);
  assert.deepStrictEqual(fitToCount({ court_streams: '["AAAAAAAAAAA"]' }, 3), [A, '', '']);
});

test('PATCH sets the links; the season, schedule and draw data serve them; a lower or higher count keeps the right courts', async () => {
  const made = await admin('POST', '/api/seasons', { name: 'Streams Open 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  assert.deepStrictEqual(tournament.courtStreams, [], 'a new tournament has no courts and no links');
  const set = await admin('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 3, courtStreams: [`https://youtu.be/${A}`, '', `https://www.youtube.com/live/${C}`] });
  assert.strictEqual(set.status, 200, set.text);
  assert.deepStrictEqual(set.json.courtStreams, [{ videoId: A, url: watch(A) }, null, { videoId: C, url: watch(C) }]);
  const pub = await call('GET', `/api/seasons/by-slug/${tournament.slug}`);
  assert.strictEqual(pub.status, 200, pub.text);
  assert.strictEqual(pub.json.courtStreams[2].videoId, C, 'the public season data');
  const sched = await call('GET', `/api/seasons/${tournament.id}/schedule`);
  assert.deepStrictEqual(sched.json.courtStreams.map((s) => s && s.videoId), [A, null, C], 'the schedule data');
  const draw = await admin('GET', `/api/seasons/${tournament.id}/draw`);
  assert.deepStrictEqual(draw.json.courtStreams.map((s) => s && s.videoId), [A, null, C], 'the draw data');

  const fewer = await admin('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 2 });
  assert.deepStrictEqual(fewer.json.courtStreams.map((s) => s && s.videoId), [A, null], 'fewer courts: the links of the removed ones go');
  const more = await admin('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 4 });
  assert.deepStrictEqual(more.json.courtStreams.map((s) => s && s.videoId), [A, null, null, null], 'more courts: the new ones have none');
  const cleared = await admin('PATCH', `/api/seasons/${tournament.id}`, { courtStreams: ['', '', '', ''] });
  assert.deepStrictEqual(cleared.json.courtStreams, [null, null, null, null], 'an empty list takes them all away');
});

test('a wrong list is refused and changes nothing', async () => {
  await admin('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 2, courtStreams: [`https://youtu.be/${A}`, ''] });
  for (const courtStreams of [['https://vimeo.com/123', ''], ['https://www.youtube.com/@bltatennis/live', ''], [`https://youtu.be/${A}`, '', `https://youtu.be/${C}`], 'x']) {
    const r = await admin('PATCH', `/api/seasons/${tournament.id}`, { courtStreams });
    assert.strictEqual(r.status, 400, JSON.stringify(courtStreams));
  }
  const now = await call('GET', `/api/seasons/${tournament.id}/schedule`);
  assert.deepStrictEqual(now.json.courtStreams.map((s) => s && s.videoId), [A, null], 'nothing changed');
});

test('only an admin can set the links', async () => {
  const r = await call('PATCH', `/api/seasons/${tournament.id}`, { body: { courtStreams: ['', ''] } });
  assert.ok([401, 403].includes(r.status), `a visitor: ${r.status}`);
  const now = await call('GET', `/api/seasons/${tournament.id}/schedule`);
  assert.strictEqual(now.json.courtStreams[0].videoId, A);
});

test('a tournament without links carries only empty ones', async () => {
  const made = await admin('POST', '/api/seasons', { name: 'No Streams Open 2099', kind: 'TOURNAMENT', startDate: '2099-06-01', endDate: '2099-06-01' });
  const set = await admin('PATCH', `/api/seasons/${made.json.id}`, { courtCount: 2 });
  assert.deepStrictEqual(set.json.courtStreams, [null, null]);
});

test('the admin pages carry the inputs: helper file, tournament form, draw page', async () => {
  const js = async (f) => (await call('GET', `/js/${f}`)).text;
  const helper = await js('court-streams.js');
  for (const fn of ['function courtStreamFieldsHtml', 'function readCourtStreams', 'function syncCourtStreamFields']) assert.ok(helper.includes(fn), fn);
  const form = await js('seasons-admin.js');
  assert.ok(form.includes('courtStreamFieldsHtml(') && form.includes('courtStreams: readCourtStreams(') && form.includes('syncCourtStreamFields('), 'the tournament form');
  const draw = await js('season-draw.js');
  assert.ok(draw.includes('courtStreamFieldsHtml(') && draw.includes('courtStreams: readCourtStreams(') && draw.includes('syncCourtStreamFields('), 'the draw page');
  for (const page of ['seasons-admin.html', 'tournaments-admin.html', 'club-tournament.html']) {
    const src = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8');
    const at = src.indexOf('/js/court-streams.js');
    assert.ok(at > -1, `${page} loads court-streams.js`);
    assert.ok(at < src.indexOf('/js/season-draw.js') && at < src.indexOf('/js/seasons-admin.js'), `${page}: court-streams.js comes before the scripts that use it`);
  }
});

test('the public pages carry the pieces: button in the Harmonogram (not on the TV screen), "Live video" tab, texts, styles', async () => {
  const get = async (url) => (await call('GET', url)).text;
  const sched = await get('/js/court-schedule.js');
  assert.ok(sched.includes('function csLiveButtonHtml('), 'the button helper');
  assert.strictEqual(sched.split('csLiveButtonHtml(').length - 1, 3, 'defined once, used in the timeline and the list');
  assert.ok(sched.includes('target="_blank" rel="noopener"'), 'it opens YouTube in a new tab');
  assert.ok(!(await get('/js/schedule-screen.js')).includes('csLiveButtonHtml'), 'no button on the TV screen');
  const season = await get('/js/season.js');
  assert.ok(season.includes("key: 'live'") && season.includes('function liveVideoHtml(') && season.includes('youtube-nocookie.com/embed/'), 'the tab');
  assert.ok(season.includes("tab === 'live' ? liveVideoHtml()"), 'the tab is drawn');
  const i18n = await get('/js/i18n.js');
  assert.strictEqual(i18n.split("'courts.liveVideo': 'Live video'").length - 1, 2, 'SK and EN');
  assert.strictEqual(i18n.split("'season.navLive': 'Live video'").length - 1, 2, 'SK and EN');
  const css = await get('/css/style.css');
  assert.ok(css.includes('.cs-live-btn') && css.includes('.sv-live-court') && css.includes('.sv-live-frame'));
});

test('review findings: the Live video tab is not redrawn on every score change; typed links survive a count edit; a saved edit form does not send stale courts', async () => {
  const get = async (url) => (await call('GET', url)).text;
  const season = await get('/js/season.js');
  assert.ok(/matches:changed[\s\S]{0,400}tab === 'live'/.test(season), "a score change must not rebuild the page (and reload the videos) while the Live video tab is open");
  const helper = await get('/js/court-streams.js');
  assert.ok(helper.includes('_kept'), 'links typed for courts that are not shown now are kept, so 3 -> "" -> 4 does not lose them');
  const i18n = await get('/js/i18n.js');
  assert.strictEqual(i18n.split("'courts.liveShort': 'Live'").length - 1, 2, 'a short label for the narrow court columns of a phone, SK and EN');
  assert.ok((await get('/js/court-schedule.js')).includes('cs-live-short') && (await get('/css/style.css')).includes('.cs-live-short'), 'the short label is what a phone shows');
  const css = await get('/css/style.css');
  assert.ok(/#sv-live \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(css), 'the Live video tab: 3 videos in a row on a desktop');
  assert.ok(/@media \(max-width: 1099px\)[^{]*\{[^}]*#sv-live \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/.test(css), '2 in a row on a tablet');
  assert.ok(/@media \(max-width: 700px\)[^{]*\{[^}]*#sv-live \{[^}]*grid-template-columns: 1fr/.test(css), '1 in a row on a phone');
  const form = await get('/js/seasons-admin.js');
  assert.ok(form.includes('courtsTouched') && /courtsTouched \? \{ courtCount/.test(form), 'the form sends the courts and their links only when they were edited in it');
});

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
