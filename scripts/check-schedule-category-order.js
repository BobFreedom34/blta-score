// Checks of the ORDER of the categories in the court schedule of a tournament (src/tournamentSchedule.js): the weakest category plays first
// (Novice, then Next Gen, then Elite), whatever the order in which the draws were made, as long as the tournament has not started.
// Run: node scripts/check-schedule-category-order.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scatorder-'));
const port = 3100 + (process.pid % 800);
const base = `http://localhost:${port}`;
let child = null;
let cookie = '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function tournamentWith(name, cats, perCat) {
  const t = (await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' })).json;
  await call('PATCH', `/api/seasons/${t.id}`, { courtCount: 1 });
  await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { matchMinutes: 60, dayStart: '09:00', dayEnd: '20:00', restMinutes: 30 });
  for (const cat of cats) {
    for (let i = 0; i < perCat; i += 1) {
      const p = (await call('POST', '/api/players', { name: `${name} ${cat} ${i}` })).json;
      const r = await call('POST', `/api/seasons/${t.id}/registrations/admin`, { playerId: p.id, category: cat, phone: `09${cats.indexOf(cat)}${String(200000 + i)}${name.length}`, email: `${name.length}${cat}${i}@example.com` });
      assert.strictEqual(r.status, 201, r.text);
    }
  }
  return t;
}
const draw = (t, cat) => call('POST', `/api/seasons/${t.id}/draw`, { category: cat, mode: 'AUTO', format: 'ELIMINATION', mainFormat: 'BO3_STB' });
const order = async (t) => (await call('GET', `/api/seasons/${t.id}/schedule`)).json.matches.filter((m) => m.scheduledAt).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)).map((m) => m.category);

test('Elite drawn first, Novice later: Novice still plays first, then Elite', async () => {
  const t = await tournamentWith('Order A', ['ELITE', 'NOVICE'], 4);
  assert.strictEqual((await draw(t, 'ELITE')).status, 201);
  assert.strictEqual((await draw(t, 'NOVICE')).status, 201);
  assert.deepStrictEqual(await order(t), ['NOVICE', 'NOVICE', 'ELITE', 'ELITE']);
});

test('three categories drawn from the strongest to the weakest: Novice, Next Gen, Elite', async () => {
  const t = await tournamentWith('Order B', ['ELITE', 'NEXT_GEN', 'NOVICE'], 4);
  for (const cat of ['ELITE', 'NEXT_GEN', 'NOVICE']) assert.strictEqual((await draw(t, cat)).status, 201);
  assert.deepStrictEqual(await order(t), ['NOVICE', 'NOVICE', 'NEXT_GEN', 'NEXT_GEN', 'ELITE', 'ELITE']);
});

test('a match that is already locked by hand keeps its time when another category is drawn', async () => {
  const t = await tournamentWith('Order C', ['ELITE', 'NOVICE'], 4);
  await draw(t, 'ELITE');
  const first = (await call('GET', `/api/seasons/${t.id}/schedule`)).json.matches[0];
  const put = await call('PUT', `/api/seasons/${t.id}/schedule/matches/${first.token}`, { courtNo: 1, scheduledAt: '2099-05-02T10:00:00.000Z' });
  assert.strictEqual(put.status, 200, put.text);
  await draw(t, 'NOVICE');
  const after = (await call('GET', `/api/seasons/${t.id}/schedule`)).json.matches.find((m) => m.token === first.token);
  assert.strictEqual(after.scheduledAt, '2099-05-02T10:00:00.000Z');
  assert.strictEqual(after.locked, true);
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_')) delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 5).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
