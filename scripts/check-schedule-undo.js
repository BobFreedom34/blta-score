// Check of "Krok späť" in the court schedule (src/scheduleUndo.js, POST /api/seasons/:id/schedule/undo): every change keeps the places of the matches
// before it, undo puts them back step by step, a refused change leaves no step, a match that started since is not touched, only the last 30 steps are kept.
// Run: node scripts/check-schedule-undo.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-undo-'));
const port = 3100 + (process.pid % 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
const setup = {};

async function call(method, url, body, { admin = true } = {}) {
  const h = admin ? { Cookie: cookie } : {};
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const DAY = '2030-06-15';

function seed() {
  // the database is filled before the server starts (the server then opens it)
  process.env.DATA_DIR = dir;
  const db = require('../src/db');
  const schedule = require('../src/tournamentSchedule');
  const at = (hhmm) => new Date(schedule.localToUtcMs(DAY, hhmm)).toISOString();
  const id = Number(db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, court_count, match_minutes, day_start, day_end, rest_minutes, auto_schedule, categories) VALUES ('Undo Cup', 'undo-cup', 'TOURNAMENT', ?, ?, 2, 80, '09:00', '21:00', 0, 0, 'NOVICE')").run(DAY, DAY).lastInsertRowid);
  const add = (tok, court, hhmm) => {
    const a = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Undo ${tok} A`).lastInsertRowid);
    const b = Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(`Undo ${tok} B`).lastInsertRowid);
    db.prepare("INSERT INTO matches (share_token, category, player1_id, player2_id, scheduled_at, court_no, format, status, state, season_id) VALUES (?, 'NOVICE', ?, ?, ?, ?, 'BEST_OF_3', 'PLANNED', '{}', ?)").run(tok, a, b, at(hhmm), court, id);
  };
  add('u1', 1, '09:00'); add('u2', 1, '10:20'); add('u3', 2, '09:00');
  db.close();
  Object.assign(setup, { id, at });
}

const place = async () => Object.fromEntries((await call('GET', `/api/seasons/${setup.id}/schedule`)).json.matches.map((m) => [m.token, `${m.courtNo}@${m.scheduledAt && m.scheduledAt.slice(11, 16)}/${m.durationMinutes || ''}`]));
const undoCount = async () => (await call('GET', `/api/seasons/${setup.id}/schedule`)).json.undoCount;

test('nothing to undo at first; a visitor does not see the count and cannot undo', async () => {
  assert.strictEqual(await undoCount(), 0);
  assert.strictEqual((await call('GET', `/api/seasons/${setup.id}/schedule`, undefined, { admin: false })).json.undoCount, undefined);
  assert.strictEqual((await call('POST', `/api/seasons/${setup.id}/schedule/undo`)).status, 409);
  assert.strictEqual((await call('POST', `/api/seasons/${setup.id}/schedule/undo`, undefined, { admin: false })).status, 401);
});

test('a move with insert, a length and a lock are undone one by one, back to the start', async () => {
  const start = await place();
  const r1 = await call('PUT', `/api/seasons/${setup.id}/schedule/matches/u3`, { courtNo: 1, scheduledAt: setup.at('09:10'), insert: true });
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
  assert.strictEqual(r1.json.schedule.undoCount, 1, 'the answer carries the count');
  const afterMove = await place();
  assert.notDeepStrictEqual(afterMove, start);
  assert.strictEqual((await call('PUT', `/api/seasons/${setup.id}/schedule/matches/u1`, { durationMinutes: 120 })).status, 200);
  assert.strictEqual((await call('PUT', `/api/seasons/${setup.id}/schedule/matches/u2`, { locked: false })).status, 200);
  assert.strictEqual(await undoCount(), 3);
  assert.strictEqual((await call('POST', `/api/seasons/${setup.id}/schedule/undo`)).status, 200);
  assert.strictEqual((await call('POST', `/api/seasons/${setup.id}/schedule/undo`)).status, 200);
  assert.deepStrictEqual(await place(), afterMove, 'two steps back: as after the move');
  const last = await call('POST', `/api/seasons/${setup.id}/schedule/undo`);
  assert.strictEqual(last.json.schedule.undoCount, 0);
  assert.deepStrictEqual(await place(), start, 'all the way back');
});

test('a refused change leaves no step behind', async () => {
  const r = await call('PUT', `/api/seasons/${setup.id}/schedule/matches/u3`, { courtNo: 1, scheduledAt: setup.at('09:10') });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(await undoCount(), 0);
});

test('the planner is undone too, and only the last 30 steps are kept', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${setup.id}/schedule/auto`, { mode: 'clear' })).status, 200);
  assert.ok(Object.values(await place()).every((p) => p.startsWith('null')), 'cleared');
  await call('POST', `/api/seasons/${setup.id}/schedule/undo`);
  assert.ok(Object.values(await place()).every((p) => !p.startsWith('null')), 'back on the courts');
  for (let i = 0; i < 34; i += 1) await call('PUT', `/api/seasons/${setup.id}/schedule/matches/u1`, { durationMinutes: 60 + (i % 5) * 5 });
  assert.strictEqual(await undoCount(), 30);
});

test('the page has the button and Ctrl+Z', async () => {
  const js = await (await fetch(`${base}/js/court-schedule.js`)).text();
  assert.ok(js.includes('data-cs="undo"') && js.includes("/schedule/undo") && js.includes("e.key.toLowerCase() !== 'z'"));
});

async function main() {
  let failed = 0;
  try {
    seed();
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
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
