// Checks of the payments side of the registrations (src/routes/seasons.js, Backend > Seasons > Registrácie): the list as a CSV, the reminder
// of an unpaid entry fee (who gets it, who is skipped, only an admin) and the paid tick.
// Run: node scripts/check-payments.js   (starts its own server on a temporary data directory; no mail is sent: SMTP is not set there)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payments-'));
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

let seasonId = null;
let ids = [];

test('three players register; one pays, one has no e-mail any more', async () => {
  const made = await call('POST', '/api/seasons', { body: { name: 'Payments Test Series', startDate: '2027-01-01', endDate: '2027-04-30', entryFee: '25 €', paymentUrl: 'https://pay.example.com/x' } });
  assert.ok(made.status === 200 || made.status === 201, JSON.stringify(made.json));
  seasonId = made.json.id;
  const people = [['Anna Testova', '0903111001', 'anna@example.com'], ['Boris Testovy', '0903111002', 'boris@example.com'], ['Cyril Testovy', '0903111003', 'cyril@example.com']];
  for (const [name, phone, email] of people) {
    const r = await call('POST', `/api/seasons/${seasonId}/registrations`, { cookie: '', body: { name, phone, email, category: 'ELITE', confirmNew: true } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  }
  const list = await call('GET', `/api/seasons/${seasonId}/registrations`);
  assert.strictEqual(list.json.length, 3);
  ids = list.json.map((r) => r.id);
  assert.strictEqual((await call('PATCH', `/api/seasons/registrations/${ids[0]}`, { body: { paid: true } })).json.paid, true);
  assert.strictEqual((await call('PATCH', `/api/seasons/registrations/${ids[2]}`, { body: { email: '' } })).status, 200);
});

test('the CSV: with the byte-order mark, a header and every registration; only for an admin', async () => {
  const csv = await call('GET', `/api/seasons/${seasonId}/registrations.csv`);
  assert.strictEqual(csv.status, 200);
  assert.ok(/text\/csv/.test(csv.res.headers.get('content-type')));
  assert.ok(/attachment/.test(csv.res.headers.get('content-disposition')));
  const bytes = Buffer.from(await csv.res.arrayBuffer());
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'the byte-order mark');
  const lines = bytes.subarray(3).toString('utf8').split('\r\n');
  assert.strictEqual(lines[0], 'Meno,Kategória,Telefón,Email,Zaplatené,Poznámka,Registrovaný');
  assert.strictEqual(lines.length, 4);
  assert.ok(lines[1].startsWith('Anna Testova,ELITE,') && lines[1].includes(',áno,'), lines[1]);
  assert.ok(lines[2].includes('boris@example.com') && lines[2].includes(',nie,'), lines[2]);
  assert.strictEqual((await call('GET', `/api/seasons/${seasonId}/registrations.csv`, { cookie: '' })).status, 401);
});

test('the reminder: the paid one is not asked, the one without an e-mail is counted, the other fails here (no mail server)', async () => {
  const r = await call('POST', `/api/seasons/${seasonId}/registrations/remind`, { body: {} });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json, { sent: 0, noEmail: 1, recent: 0, failed: 1 });
  const one = await call('POST', `/api/seasons/${seasonId}/registrations/remind`, { body: { ids: [ids[1]] } });
  assert.deepStrictEqual(one.json, { sent: 0, noEmail: 0, recent: 0, failed: 1 });
  const none = await call('POST', `/api/seasons/${seasonId}/registrations/remind`, { body: { ids: [ids[0]] } });
  assert.deepStrictEqual(none.json, { sent: 0, noEmail: 0, recent: 0, failed: 0 }, 'a paid registration is never reminded');
});

test('only an admin, only a season that exists', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${seasonId}/registrations/remind`, { cookie: '', body: {} })).status, 401);
  assert.strictEqual((await call('POST', '/api/seasons/999999/registrations/remind', { body: {} })).status, 404);
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
