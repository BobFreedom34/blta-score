// Checks "Vymazať" of a registration in the Backend: a plain withdraw (Odhlásiť) leaves the player in the list of the withdrawn, a delete (?purge=1) leaves nothing,
// the withdrawn can be wiped out of that list too, and the first substitute still comes in when a place is freed.
// Run: node scripts/check-registration-purge.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-purge-'));
const port = 3100 + (process.pid % 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let season = null;
const players = [];

async function call(method, url, body) {
  const h = { Cookie: cookie };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const regs = async () => (await call('GET', `/api/seasons/${season.id}/registrations`)).json;
const withdrawn = async () => (await call('GET', `/api/seasons/${season.id}`)).json.withdrawn || [];

test('setup: a tournament for 2 players and three registered players (the third is a substitute)', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Vymaz turnaj', kind: 'TOURNAMENT', playType: 'SINGLES', startDate: day(6), endDate: day(6), venue: 'Kurt', categories: ['OPEN'] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  season = made.json;
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { maxPlayers: 2, registrationOpen: true })).status, 200);
  for (const name of ['Vymaz Alfa', 'Vymaz Beta', 'Vymaz Gama']) {
    const p = await call('POST', '/api/players', { name });
    assert.ok([200, 201].includes(p.status), JSON.stringify(p.json));
    players.push(p.json);
    const reg = await call('POST', `/api/seasons/${season.id}/registrations/admin`, { playerId: p.json.id });
    assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.json));
  }
  assert.strictEqual((await regs()).length, 3);
});

test('a plain withdraw leaves the player in the list of the withdrawn', async () => {
  const rows = await regs();
  const beta = rows.find((r) => r.name === 'Vymaz Beta');
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${beta.id}`)).status, 200);
  assert.ok((await withdrawn()).some((w) => w.name === 'Vymaz Beta'), 'Beta is in the withdrawn');
});

test('"Vymazať" (?purge=1) leaves no trace, and the first substitute comes in', async () => {
  const rows = await regs();
  const alfa = rows.find((r) => r.name === 'Vymaz Alfa');
  assert.strictEqual((await call('DELETE', `/api/seasons/registrations/${alfa.id}?purge=1`)).status, 200);
  assert.ok(!(await regs()).some((r) => r.name === 'Vymaz Alfa'));
  assert.ok(!(await withdrawn()).some((w) => w.name === 'Vymaz Alfa'), 'Alfa is nowhere in the withdrawn');
  const left = await regs();
  assert.deepStrictEqual(left.map((r) => r.name), ['Vymaz Gama']);
  const detail = (await call('GET', `/api/seasons/${season.id}`)).json;
  assert.ok(!(detail.capacity && detail.capacity.substituteIds && detail.capacity.substituteIds.length), 'Gama is not a substitute any more');
});

test('a withdrawn player is wiped out of the list of the withdrawn (by id), and a second try finds nobody', async () => {
  const beta = (await withdrawn()).find((w) => w.name === 'Vymaz Beta');
  assert.ok(beta && beta.playerId, 'the withdrawn carry the id of the player');
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}/withdrawn?playerId=${beta.playerId}`)).status, 200);
  assert.ok(!(await withdrawn()).some((w) => w.name === 'Vymaz Beta'));
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}/withdrawn?playerId=${beta.playerId}`)).status, 404);
});

test('only an admin of the event may do it: a visitor is refused', async () => {
  const saved = cookie;
  cookie = '';
  const rows = await (async () => { const r = await fetch(`${base}/api/seasons/${season.id}/registrations`); return r.status; })();
  assert.ok([401, 403].includes(rows));
  assert.ok([401, 403].includes((await call('DELETE', `/api/seasons/${season.id}/withdrawn?playerId=1`)).status));
  assert.ok([401, 403].includes((await call('DELETE', '/api/seasons/registrations/1?purge=1')).status));
  cookie = saved;
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
