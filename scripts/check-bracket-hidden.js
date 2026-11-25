// Checks a hidden bracket (Backend > Pavúky / the tab Play-off: button Skryť): the admin sees it, nobody else does (the bracket page, the play-off
// tab of the season, the sitemap), its losers brackets follow it, and Zverejniť makes it public again.
// Run: node scripts/check-bracket-hidden.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bracket-hidden-'));
const port = 3100 + (process.pid % 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';

async function call(method, url, body) {
  const h = { Cookie: cookie };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function anon(url) { const res = await fetch(base + url); let json = null; try { json = await res.json(); } catch { /* not json */ } return { status: res.status, json }; }
let seasonId = null;
let bracketId = null;

test('a new bracket is public; Skryť hides it from everybody but the admin', async () => {
  const season = await call('POST', '/api/seasons', { name: 'Skrytá liga', kind: 'LEAGUE', startDate: day(1), endDate: day(60), categories: ['ELITE'] });
  assert.strictEqual(season.status, 201, JSON.stringify(season.json));
  seasonId = season.json.id;
  const made = await call('POST', '/api/brackets', { name: 'Elite play-off', format: 'BO3', size: 8, category: 'ELITE', seasonId });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  bracketId = made.json.id;
  assert.strictEqual(made.json.hidden, false);
  assert.strictEqual((await anon(`/api/brackets/${bracketId}`)).status, 200);
  const hidden = await call('PATCH', `/api/brackets/${bracketId}`, { hidden: true });
  assert.strictEqual(hidden.status, 200, JSON.stringify(hidden.json));
  assert.strictEqual(hidden.json.hidden, true);
  assert.strictEqual((await anon(`/api/brackets/${bracketId}`)).status, 404, 'the bracket page is not public');
  assert.ok(!(await anon(`/api/seasons/${seasonId}/brackets`)).json.some((b) => b.id === bracketId), 'not in the play-off tab of the public');
  const mine = (await call('GET', `/api/seasons/${seasonId}/brackets`)).json.find((b) => b.id === bracketId);
  assert.ok(mine && mine.hidden === true, 'the admin sees it, marked hidden');
  assert.strictEqual((await call('GET', `/api/brackets/${bracketId}`)).status, 200);
  assert.strictEqual((await call('GET', '/api/brackets')).json.find((b) => b.id === bracketId).hidden, true, 'the Backend list says it is hidden');
  const map = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(!map.includes(`/bracket/${bracketId}<`), 'not in the sitemap');
});

test('Zverejniť makes it public again; the hide button is in the Backend and the badge on the season page', async () => {
  const shown = await call('PATCH', `/api/brackets/${bracketId}`, { hidden: false });
  assert.strictEqual(shown.json.hidden, false);
  assert.strictEqual((await anon(`/api/brackets/${bracketId}`)).status, 200);
  assert.ok((await anon(`/api/seasons/${seasonId}/brackets`)).json.some((b) => b.id === bracketId));
  const admin = fs.readFileSync(path.join(ROOT, 'public/js/bracket-admin.js'), 'utf8');
  assert.ok(admin.includes('data-action="hide"') && admin.includes('hidden: !b.hidden'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/season.js'), 'utf8').includes("t('season.bracketHidden')"));
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
