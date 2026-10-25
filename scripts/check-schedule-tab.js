// Check of the removal of the Backend > Schedule tab: its old address leads to the Tournaments tab, where the events outside the app are managed now.
// Run: node scripts/check-schedule-tab.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedtab-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

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

test('the old address of the Schedule tab leads to the Tournaments tab, and no admin page has the tab any more', async () => {
  const r = await fetch(base + '/schedule-admin', { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(new URL(r.headers.get('location'), base).pathname, '/tournaments-admin');
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  assert.ok(!pages.includes('schedule-admin.html'));
  pages.forEach((f) => assert.ok(!fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').includes('/schedule-admin'), f + ' still links to the Schedule tab'));
});

test('the Tournaments tab carries the events outside the app, and they still reach the public schedule', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/tournaments-admin.html'), 'utf8');
  assert.ok(html.includes('id="events-admin-root"') && html.includes('/js/events-admin.js'));
  const js = fs.readFileSync(path.join(ROOT, 'public/js/events-admin.js'), 'utf8');
  assert.ok(js.includes('Events outside the app') && !js.includes('League seasons'));
  const made = await call('POST', '/api/schedule/events', { body: { name: 'Cup of another club', startDate: '2027-03-06', endDate: null, venue: 'Elsewhere', link: 'https://example.com/cup', categories: ['ELITE'] } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const item = (await call('GET', '/api/schedule', { cookie: '' })).json.find((e) => e.name === 'Cup of another club');
  assert.ok(item && item.eventId && item.type === 'TOURNAMENT');
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
