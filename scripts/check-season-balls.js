// Checks the "Lopty" (balls) field of a tournament: set in the Backend (PATCH /api/seasons/:id), kept, cleared, limited to 100 characters, and shown as a tile on the page.
// Run: node scripts/check-season-balls.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-balls-'));
const port = 3100 + (process.pid % 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let id = null;

async function call(method, url, body) {
  const h = { Cookie: cookie };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('a new tournament has no balls; the admin sets them and the season payload carries them', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Lopty turnaj', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: day(5), endDate: day(5), venue: 'Kurt 1', categories: ['ELITE'] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  id = made.json.id;
  assert.strictEqual(made.json.balls || '', '');
  const patched = await call('PATCH', `/api/seasons/${id}`, { balls: 'Wilson US Open' });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.json));
  assert.strictEqual(patched.json.balls, 'Wilson US Open');
  const list = (await call('GET', '/api/seasons')).json.find((s) => s.id === id);
  assert.strictEqual(list.balls, 'Wilson US Open');
});

test('other changes keep the balls, an empty text clears them, more than 100 characters is refused', async () => {
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { venue: 'Kurt 2' })).json.balls, 'Wilson US Open');
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { balls: 'x'.repeat(101) })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { balls: '' })).json.balls, '');
});

test('the surface is one of clay / hard / grass / taraflex, kept by other changes, cleared with an empty text; anything else is refused', async () => {
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { surface: 'grass' })).json.surface, 'grass');
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { venue: 'Kurt 5' })).json.surface, 'grass');
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { surface: 'sand' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { surface: '' })).json.surface, '');
});

test('the page shows a Lopty tile after the format tile (season.js) and the Backend has the field', async () => {
  const season = fs.readFileSync(path.join(ROOT, 'public/js/season.js'), 'utf8');
  assert.ok(season.indexOf("season.tileFormat") < season.indexOf("season.tileBalls") && season.indexOf("season.tileBalls") < season.indexOf("season.tileFee"), 'the order of the tiles');
  const admin = fs.readFileSync(path.join(ROOT, 'public/js/seasons-admin.js'), 'utf8');
  assert.ok(/input\('balls'/.test(admin) && /balls: f\('balls'\)/.test(admin));
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
    cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'the admin login gave no cookie');
    for (const t of tests) {
      try { await t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
    }
  } finally {
    if (child) child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
