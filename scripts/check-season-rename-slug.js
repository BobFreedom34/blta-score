// Checks that the address of a season follows its name: a renamed tournament gets the address of the new name, the old address sends a visitor
// there (301, the query kept) and the data is found by the old address too; renamed back, it gets its first address again.
// Run: node scripts/check-season-rename-slug.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-rename-'));
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

async function page(url) { const r = await fetch(base + url, { redirect: 'manual', headers: { Cookie: cookie } }); return { status: r.status, location: r.headers.get('location') }; }

test('a new tournament has the address of its name; renamed, it has the address of the new name', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Masters Old 2026', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: day(5), endDate: day(6), venue: 'Kurt 1', categories: ['ELITE'] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  id = made.json.id;
  assert.strictEqual(made.json.slug, 'masters-old-2026');
  const renamed = await call('PATCH', `/api/seasons/${id}`, { name: 'ATA Masters 2026' });
  assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.json));
  assert.strictEqual(renamed.json.slug, 'ata-masters-2026');
});

test('the old address sends to the new one (301, query kept), the data is found by the old address, other changes keep the address', async () => {
  const r = await page('/tournament/masters-old-2026?tab=draw');
  assert.strictEqual(r.status, 301);
  assert.ok(r.location.endsWith('/tournament/ata-masters-2026?tab=draw'), r.location);
  assert.strictEqual((await page('/tournament/ata-masters-2026')).status, 200);
  const data = await call('GET', '/api/seasons/by-slug/masters-old-2026');
  assert.strictEqual(data.status, 200);
  assert.strictEqual(data.json.slug, 'ata-masters-2026');
  assert.strictEqual((await call('PATCH', `/api/seasons/${id}`, { venue: 'Kurt 2' })).json.slug, 'ata-masters-2026');
});

test('another season cannot take an old address; renamed back, the tournament gets its first address again', async () => {
  const other = await call('POST', '/api/seasons', { name: 'Masters Old 2026', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: day(8), endDate: day(8), venue: 'Kurt 1', categories: ['ELITE'] });
  assert.strictEqual(other.json.slug, 'masters-old-2026-2', 'the old address still belongs to the renamed tournament');
  const back = await call('PATCH', `/api/seasons/${id}`, { name: 'Masters Old 2026' });
  assert.strictEqual(back.json.slug, 'masters-old-2026');
  const r = await page('/tournament/ata-masters-2026');
  assert.strictEqual(r.status, 301);
  assert.ok(r.location.endsWith('/tournament/masters-old-2026'), r.location);
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
