// Check of the hidden events (Backend > Základné info > "Skrytý"): a hidden tournament is a 404 for a visitor (its page, its data, the list, the schedule, the sitemap,
// the registration) and shows normally to an admin; when the admin makes it public everybody sees it. Starts its own server on a temporary data directory.
// Run: node scripts/check-hidden-event.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiddenevent-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let hit = 0;

async function call(method, url, { cookie = '', body } = {}) {
  hit += 1;
  const h = { 'X-Forwarded-For': `10.0.${Math.floor(hit / 250) % 250}.${hit % 250}` };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, res };
}
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let cup = null;
test('a tournament made as hidden is hidden', async () => {
  const made = await call('POST', '/api/seasons', { cookie: adminCookie, body: { name: 'Hidden Cup', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: future(20), endDate: future(21), hidden: true } });
  assert.strictEqual(made.status, 201, made.text);
  assert.strictEqual(made.json.hidden, true);
  cup = made.json;
});
test('a visitor does not see it: page, data, list, schedule, sitemap', async () => {
  assert.strictEqual((await call('GET', `/tournament/${cup.slug}`)).status, 404, 'the page');
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${cup.slug}`)).status, 404, 'the data');
  assert.ok(!(await call('GET', '/api/seasons')).json.some((s) => s.slug === cup.slug), 'the list');
  assert.ok(!(await call('GET', '/api/schedule')).json.some((s) => s.seasonId === cup.id), 'the schedule');
  assert.ok(!(await call('GET', '/sitemap.xml')).text.includes(cup.slug), 'the sitemap');
});
test('a visitor cannot register to it', async () => {
  const r = await call('POST', `/api/seasons/${cup.id}/registrations`, { body: { name: 'Jan Novak Test', phone: '0905123456', email: 'jan@example.com', category: 'ELITE', website: '' } });
  assert.strictEqual(r.status, 404, r.text);
});
test('an admin sees it everywhere, and the page is kept out of the search engines', async () => {
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${cup.slug}`, { cookie: adminCookie })).status, 200);
  assert.ok((await call('GET', '/api/seasons', { cookie: adminCookie })).json.some((s) => s.slug === cup.slug));
  assert.ok((await call('GET', '/api/schedule', { cookie: adminCookie })).json.some((s) => s.seasonId === cup.id));
  const page = await call('GET', `/tournament/${cup.slug}`, { cookie: adminCookie });
  assert.strictEqual(page.status, 200);
  assert.match(page.res.headers.get('x-robots-tag') || '', /noindex/);
});
test('made public, everybody sees it', async () => {
  const r = await call('PATCH', `/api/seasons/${cup.id}`, { cookie: adminCookie, body: { hidden: false } });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.hidden, false);
  assert.strictEqual((await call('GET', `/tournament/${cup.slug}`)).status, 200);
  assert.strictEqual((await call('GET', `/api/seasons/by-slug/${cup.slug}`)).status, 200);
  assert.ok((await call('GET', '/api/seasons')).json.some((s) => s.slug === cup.slug));
});
test('and hidden again with the same switch', async () => {
  assert.strictEqual((await call('PATCH', `/api/seasons/${cup.id}`, { cookie: adminCookie, body: { hidden: true } })).json.hidden, true);
  assert.strictEqual((await call('GET', `/tournament/${cup.slug}`)).status, 404);
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
    adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
