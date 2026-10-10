// Checks of the YouTube video of a match: the link parser, the admin-only route PATCH /api/matches/:token/video, what the match data and the pages carry.
// Run: node scripts/check-match-video.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const cookieSignature = require('cookie-signature');
const { parseVideoId, watchUrl } = require('../src/youtube');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-server-'));

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
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });

const ID = 'dQw4w9WgXcQ';
let token = '';
let player1;

test('the link parser: the usual YouTube forms are accepted, nothing else', () => {
  for (const url of [`https://www.youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&t=42s&list=x`, `https://youtu.be/${ID}`, `youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/live/${ID}?feature=share`, `https://m.youtube.com/watch?v=${ID}`, `https://youtube.com/embed/${ID}`, `https://www.youtube.com/shorts/${ID}`,
    `  https://www.youtube-nocookie.com/embed/${ID}  `]) {
    assert.strictEqual(parseVideoId(url), ID, url);
  }
  for (const bad of ['', 'hello', 'https://example.com/watch?v=' + ID, 'https://youtube.com.evil.example/watch?v=' + ID, `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}extra`, `javascript:alert(1)`, `https://www.youtube.com/playlist?list=PL1234567890`, `https://www.youtube.com/@channel`, 'https://vimeo.com/12345678901', null, undefined]) {
    assert.strictEqual(parseVideoId(bad), null, String(bad));
  }
  assert.strictEqual(watchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
});

test('a match without a video has none; the admin sets it and every form becomes one watch address', async () => {
  const p = async (name) => (await admin('POST', '/api/players', { name })).json;
  player1 = await p('Tomáš Paulen');
  const player2 = await p('Peter Laučík');
  const made = await admin('POST', '/api/matches', { category: 'FRIENDLY', player1Id: player1.id, player2Id: player2.id, format: 'BO3_STB', location: 'Inter', scheduledAt: '2026-10-11T08:30:00.000Z' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  token = made.json.token;
  assert.deepStrictEqual([made.json.videoUrl, made.json.videoId], [null, null]);
  const set = await admin('PATCH', `/api/matches/${token}/video`, { url: 'https://youtu.be/dQw4w9WgXcQ?si=share' });
  assert.strictEqual(set.status, 200, JSON.stringify(set.json));
  assert.deepStrictEqual([set.json.videoUrl, set.json.videoId], [`https://www.youtube.com/watch?v=${ID}`, ID]);
  const seen = await call('GET', `/api/matches/${token}`);
  assert.strictEqual(seen.json.videoId, ID, 'the public match data carries it');
  const list = (await call('GET', '/api/matches')).json;
  assert.strictEqual((Array.isArray(list) ? list : list.matches).find((m) => m.token === token).videoId, ID, 'and so does the list (the pill)');
});

test('only the admin can set, change or remove it', async () => {
  const body = { url: `https://youtu.be/${ID}` };
  assert.strictEqual((await call('PATCH', `/api/matches/${token}/video`, { body })).status, 401, 'a visitor');
  const playerCookie = `blta_player=${encodeURIComponent(`s:${cookieSignature.sign(String(player1.id), 'test')}`)}`;
  const asPlayer = await call('PATCH', `/api/matches/${token}/video`, { body: { url: `https://youtu.be/AAAAAAAAAAA` }, cookie: playerCookie });
  assert.ok([401, 403].includes(asPlayer.status), `a player of the match: ${asPlayer.status}`);
  assert.strictEqual((await call('PATCH', `/api/matches/${token}/video`, { body: { url: '' }, cookie: playerCookie })).status === 200, false, 'a player cannot remove it');
  assert.strictEqual((await call('GET', `/api/matches/${token}`)).json.videoId, ID, 'nothing changed');
});

test('a wrong address is refused and changes nothing; an empty one takes the video away', async () => {
  for (const url of ['https://vimeo.com/123', 'not a link', 'https://example.com/watch?v=' + ID]) {
    const r = await admin('PATCH', `/api/matches/${token}/video`, { url });
    assert.strictEqual(r.status, 400, url);
    assert.ok(/YouTube/.test(r.json.error));
  }
  assert.strictEqual((await call('GET', `/api/matches/${token}`)).json.videoId, ID);
  const changed = await admin('PATCH', `/api/matches/${token}/video`, { url: 'https://www.youtube.com/live/BBBBBBBBBBB' });
  assert.strictEqual(changed.json.videoId, 'BBBBBBBBBBB');
  const cleared = await admin('PATCH', `/api/matches/${token}/video`, { url: '' });
  assert.deepStrictEqual([cleared.status, cleared.json.videoUrl, cleared.json.videoId], [200, null, null]);
  assert.strictEqual((await admin('PATCH', '/api/matches/nope/video', { url: '' })).status, 404);
});

test('the pages carry the pieces: the embed and the admin tile on the match page, the pill on the cards, the styles', async () => {
  const js = async (f) => (await call('GET', `/js/${f}`)).text;
  const match = await js('match.js');
  assert.ok(match.includes('youtube-nocookie.com/embed/') && match.includes('video-form') && match.includes('videoBadge(m)'));
  assert.ok(match.includes('${isAdminUser ? videoItemHtml(m) :'), 'the tile is for the admin only');
  assert.ok(match.includes('if (!m.videoId) return \'\';'), 'no link, no player');
  const common = await js('common.js');
  assert.ok(common.includes('function videoBadge') && common.includes('${categoryBadge(m.category)}${videoBadge(m)}'), 'the compact cards');
  assert.ok((await js('app.js')).includes('videoBadge(m)') && (await js('player.js')).includes('videoBadge(m)'));
  assert.ok((await js('i18n.js')).includes("'match.liveVideo': 'Live video'"));
  assert.ok((await call('GET', '/css/style.css')).text.includes('.badge-video'));
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
