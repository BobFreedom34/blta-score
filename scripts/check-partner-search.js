// Checks of the doubles partner search ("Hľadám partnera") on the looking-to-play board (src/routes/availability.js, mode DOUBLES): a post says
// whether it looks for an opponent or for a partner, a partner search has no league division, accepting makes a pair (no match is created and the
// time is taken off the board), the bell tells "wants to be your partner", and the board and the new-match form carry the pieces.
// Run: node scripts/check-partner-search.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partner-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, { cookie = '', body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

// a player with a phone number who can log in (no code yet: the phone is enough)
async function makePlayer(name, phone) {
  const made = await call('POST', '/api/players', { cookie: adminCookie, body: { name } });
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.json));
  const set = await call('PATCH', `/api/players/${made.json.id}/phone`, { cookie: adminCookie, body: { phone } });
  assert.strictEqual(set.status, 200, JSON.stringify(set.json));
  const login = await call('POST', '/api/player/login', { body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: cookieOf(login) };
}

const daysAhead = (n, hour = 17) => { const d = new Date(Date.now() + n * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const SLOTS = [daysAhead(2), daysAhead(2, 17.5), daysAhead(3)];

let owner = null;
let partner = null;
let other = null;
let post = null;

test('a post is a singles search unless it says it looks for a partner; a partner search has no league division', async () => {
  owner = await makePlayer('Peter Majiteľ', '0901000001');
  partner = await makePlayer('Pavol Partner', '0901000002');
  other = await makePlayer('Oto Iný', '0901000003');
  const plain = await call('POST', '/api/availability', { cookie: other.cookie, body: { slots: SLOTS, categories: ['ELITE'] } });
  assert.strictEqual(plain.status, 201, JSON.stringify(plain.json));
  assert.strictEqual(plain.json.mode, 'SINGLES');
  assert.deepStrictEqual(plain.json.categories, ['ELITE']);
  const mine = await call('POST', '/api/availability', { cookie: owner.cookie, body: { slots: SLOTS, mode: 'DOUBLES', categories: ['ELITE'], location: 'Kurt 2', note: 'Hľadám partnera na turnaj' } });
  assert.strictEqual(mine.status, 201, JSON.stringify(mine.json));
  post = mine.json;
  assert.strictEqual(post.mode, 'DOUBLES');
  assert.deepStrictEqual(post.categories, [], 'no division for a partner search');
  assert.strictEqual((await call('POST', '/api/availability', { cookie: owner.cookie, body: { slots: SLOTS, mode: 'TRIPLES' } })).status, 400);
  // posting again is the same post, edited: back to an opponent search and the other way round
  const back = await call('POST', '/api/availability', { cookie: owner.cookie, body: { slots: SLOTS, mode: 'SINGLES', categories: ['NOVICE'] } });
  assert.deepStrictEqual([back.json.id === post.id, back.json.mode, back.json.categories], [true, 'SINGLES', ['NOVICE']]);
  const again = await call('POST', '/api/availability', { cookie: owner.cookie, body: { slots: SLOTS, mode: 'DOUBLES' } });
  assert.deepStrictEqual([again.json.mode, again.json.categories], ['DOUBLES', []]);
  const board = await call('GET', '/api/availability');
  assert.deepStrictEqual(board.json.map((p) => p.mode).sort(), ['DOUBLES', 'SINGLES']);
});

test('offering to be the partner: the owner is told "partner", the bell says so', async () => {
  const j = await call('POST', `/api/availability/${post.id}/join`, { cookie: partner.cookie, body: { slot: SLOTS[0], message: 'Rád zahrám' } });
  assert.strictEqual(j.status, 200, JSON.stringify(j.json));
  assert.strictEqual(j.json.joinedByMe, true);
  const n = await call('GET', '/api/player/notifications', { cookie: owner.cookie });
  assert.strictEqual(n.status, 200);
  const req = (n.json.notifications || n.json).find((x) => x.type === 'PLAY_REQUEST');
  assert.ok(req, 'a request notification');
  assert.strictEqual(req.playRequest.mode, 'DOUBLES');
  assert.strictEqual(req.playRequest.joinerName, 'Pavol Partner');
});

test('accepting makes a pair, not a match: the time is taken off the board and nothing is scheduled', async () => {
  const before = await call('GET', '/api/matches?status=PLANNED', { cookie: adminCookie });
  const ok = await call('POST', `/api/availability/${post.id}/joins/${partner.id}/accept`, { cookie: owner.cookie });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const mine = ok.json;
  assert.strictEqual(mine.joins[0].status, 'ACCEPTED');
  assert.ok(!mine.joins[0].matchToken, 'no match behind it');
  assert.ok(mine.blockedSlots.some((b) => b.iso === SLOTS[0] && b.opponentName === 'Pavol Partner'), 'the time is blocked, with the partner named');
  const after = await call('GET', '/api/matches?status=PLANNED', { cookie: adminCookie });
  assert.strictEqual(after.json.length, before.json.length, 'no match was created');
  // answering it a second time, or taking the same time, is refused
  assert.strictEqual((await call('POST', `/api/availability/${post.id}/joins/${partner.id}/accept`, { cookie: owner.cookie })).status, 409);
  const late = await call('POST', `/api/availability/${post.id}/join`, { cookie: other.cookie, body: { slot: SLOTS[0] } });
  assert.strictEqual(late.status, 409, 'that time is taken');
});

test('the pages carry the pieces: the choice in the post form, the badge and the create-match link on the board, the prefilled new-match form', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  const board = read('js/looking-to-play.js');
  ['mode', 'DOUBLES', 'doubles=1'].forEach((s) => assert.ok(board.includes(s), 'looking-to-play.js: ' + s));
  const form = read('js/new-match.js');
  ['doubles', 'p1b'].forEach((s) => assert.ok(form.includes(s), 'new-match.js: ' + s));
  const i18n = read('js/i18n.js');
  ['lookingToPlay.modeDoubles', 'lookingToPlay.createDoublesMatch', 'notif.partnerRequestTitle'].forEach((k) => assert.strictEqual(i18n.split("'" + k + "'").length, 3, k + ' in Slovak and English'));
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
    const login = await call('POST', '/api/admin/login', { body: { password: 'test' } });
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
