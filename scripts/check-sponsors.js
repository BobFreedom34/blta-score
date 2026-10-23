// Checks of the sponsors (src/routes/sponsors.js, Backend > Sponsors): an admin adds a sponsor and its logo, the public strip shows only what is
// switched on and inside its time window, a sponsor can be tied to a season or to the national page, clicks are counted, and only an admin writes.
// Run: node scripts/check-sponsors.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsors-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, url, { cookie = adminCookie, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const cookieOf = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const logoForm = () => { const f = new FormData(); f.append('image', new Blob([PNG], { type: 'image/png' }), 'logo.png'); return f; };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const names = (r) => r.json.map((s) => s.name);

let first = null;
let seasonId = null;

test('an admin adds a sponsor; the public strip shows it without dates or counters', async () => {
  const made = await call('POST', '/api/sponsors', { body: { name: 'Acme Sports', link: 'https://www.acme.example/' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  first = made.json;
  assert.strictEqual(first.active, true);
  assert.strictEqual(first.clicks, 0);
  const pub = await call('GET', '/api/sponsors', { cookie: '' });
  assert.deepStrictEqual(pub.json, [{ id: first.id, name: 'Acme Sports', logoUrl: '', link: 'https://www.acme.example/' }]);
  const all = await call('GET', '/api/sponsors/all');
  assert.strictEqual(all.json.length, 1);
});

test('what is refused: a name-less sponsor, a link that is not http(s), dates in the wrong order, a season that is not there', async () => {
  assert.strictEqual((await call('POST', '/api/sponsors', { body: { name: '  ' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/sponsors', { body: { name: 'X', link: 'javascript:alert(1)' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/sponsors/${first.id}`, { body: { startDate: '2027-05-01', endDate: '2027-04-01' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/sponsors/${first.id}`, { body: { startDate: 'tomorrow' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/sponsors/${first.id}`, { body: { seasonId: 999999 } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/sponsors/999999', { body: { name: 'Y' } })).status, 404);
});

test('switched off, not started yet, or already over: not shown', async () => {
  const off = await call('PATCH', `/api/sponsors/${first.id}`, { body: { active: false } });
  assert.strictEqual(off.json.active, false);
  assert.deepStrictEqual((await call('GET', '/api/sponsors', { cookie: '' })).json, []);
  await call('PATCH', `/api/sponsors/${first.id}`, { body: { active: true, startDate: day(5) } });
  assert.deepStrictEqual((await call('GET', '/api/sponsors', { cookie: '' })).json, [], 'not started yet');
  await call('PATCH', `/api/sponsors/${first.id}`, { body: { startDate: day(-10), endDate: day(-1) } });
  assert.deepStrictEqual((await call('GET', '/api/sponsors', { cookie: '' })).json, [], 'already over');
  await call('PATCH', `/api/sponsors/${first.id}`, { body: { startDate: day(-10), endDate: day(10) } });
  assert.strictEqual((await call('GET', '/api/sponsors', { cookie: '' })).json.length, 1, 'inside its window');
});

test('the order: sponsors come in the order set in the backend', async () => {
  const second = await call('POST', '/api/sponsors', { body: { name: 'Beta Bank' } });
  assert.ok(second.json.sortOrder > first.sortOrder);
  assert.deepStrictEqual(names(await call('GET', '/api/sponsors', { cookie: '' })), ['Acme Sports', 'Beta Bank']);
  await call('PATCH', `/api/sponsors/${second.json.id}`, { body: { sortOrder: -1 } });
  assert.deepStrictEqual(names(await call('GET', '/api/sponsors', { cookie: '' })), ['Beta Bank', 'Acme Sports']);
  assert.strictEqual((await call('DELETE', `/api/sponsors/${second.json.id}`)).status, 204);
});

test('a sponsor of a season shows on that season only, not on the home page', async () => {
  const season = await call('POST', '/api/seasons', { body: { name: 'Sponsor Test Series', startDate: '2027-01-01', endDate: '2027-04-30' } });
  seasonId = season.json.id;
  const mine = await call('POST', '/api/sponsors', { body: { name: 'Season Partner', seasonId } });
  assert.strictEqual(mine.status, 201, JSON.stringify(mine.json));
  assert.strictEqual(mine.json.seasonId, seasonId);
  assert.deepStrictEqual(names(await call('GET', `/api/sponsors?seasonId=${seasonId}`, { cookie: '' })), ['Season Partner']);
  assert.ok(!names(await call('GET', '/api/sponsors', { cookie: '' })).includes('Season Partner'));
});

test('the national page has its own sponsors (the super admin only)', async () => {
  const made = await call('POST', '/api/sponsors?scope=national', { body: { name: 'National Partner', link: 'https://national.example/' } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.json.leagueId, 0);
  assert.deepStrictEqual(names(await call('GET', '/api/sponsors?scope=national', { cookie: '' })), ['National Partner']);
  assert.ok(!names(await call('GET', '/api/sponsors', { cookie: '' })).includes('National Partner'), 'not on the city');
  assert.deepStrictEqual(names(await call('GET', '/api/sponsors/all?scope=national')), ['National Partner']);
});

test('the logo: uploaded, served, replaced (the old file goes), only a picture is accepted', async () => {
  const up = await call('POST', `/api/sponsors/${first.id}/logo`, { form: logoForm() });
  assert.strictEqual(up.status, 200, JSON.stringify(up.json));
  const url = up.json.logoUrl;
  assert.ok(/^\/sponsor-logos\/sponsor-\d+-.+\.png$/.test(url), url);
  assert.strictEqual((await fetch(base + url)).status, 200);
  const again = await call('POST', `/api/sponsors/${first.id}/logo`, { form: logoForm() });
  assert.notStrictEqual(again.json.logoUrl, url);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual((await fetch(base + url)).status, 404, 'the old file is gone');
  const bad = new FormData();
  bad.append('image', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  assert.strictEqual((await call('POST', `/api/sponsors/${first.id}/logo`, { form: bad })).status, 400);
  const pub = await call('GET', '/api/sponsors', { cookie: '' });
  assert.strictEqual(pub.json[0].logoUrl, again.json.logoUrl);
});

test('clicks are counted (once a minute per visitor), not for a sponsor that is switched off', async () => {
  assert.strictEqual((await call('POST', `/api/sponsors/${first.id}/click`, { cookie: '' })).status, 204);
  assert.strictEqual((await call('POST', `/api/sponsors/${first.id}/click`, { cookie: '' })).status, 204);
  let row = (await call('GET', '/api/sponsors/all')).json.find((s) => s.id === first.id);
  assert.strictEqual(row.clicks, 1, 'the second click within a minute is not counted again');
  await call('PATCH', `/api/sponsors/${first.id}`, { body: { active: false } });
  assert.strictEqual((await call('POST', `/api/sponsors/${first.id}/click`, { cookie: '', headers: { 'X-Forwarded-For': '10.9.9.9' } })).status, 204);
  row = (await call('GET', '/api/sponsors/all')).json.find((s) => s.id === first.id);
  assert.strictEqual(row.clicks, 1, 'a switched-off sponsor is not counted');
  await call('PATCH', `/api/sponsors/${first.id}`, { body: { active: true } });
});

test('only an admin writes or reads the whole list', async () => {
  assert.strictEqual((await call('POST', '/api/sponsors', { cookie: '', body: { name: 'Nope' } })).status, 401);
  assert.strictEqual((await call('PATCH', `/api/sponsors/${first.id}`, { cookie: '', body: { name: 'Nope' } })).status, 401);
  assert.strictEqual((await call('DELETE', `/api/sponsors/${first.id}`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('POST', `/api/sponsors/${first.id}/logo`, { cookie: '', form: logoForm() })).status, 401);
  assert.strictEqual((await call('GET', '/api/sponsors/all', { cookie: '' })).status, 401);
});

test('deleting a sponsor takes its logo file with it', async () => {
  const url = (await call('GET', '/api/sponsors/all')).json.find((s) => s.id === first.id).logoUrl;
  assert.strictEqual((await call('DELETE', `/api/sponsors/${first.id}`)).status, 204);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual((await fetch(base + url)).status, 404);
  assert.ok(!names(await call('GET', '/api/sponsors/all')).includes('Acme Sports'));
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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held for a moment on Windows; it is a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
