// Checks of a bracket that is not full played with a preliminary round ("predkolo", byeMode PRELIM): the draw is the same as with byes, the bracket says
// prelim, a PRINCE consolation takes the losers of the preliminary round AND of 1. kolo (round 2 of the tree), the losers drop in as the matches end,
// the list of the organiser (consolation picked by hand) holds both, and the names of the rounds are Predkolo, 1. kolo … The default (byes) is unchanged.
// Run: node scripts/check-prelim.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelim-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';
let db = null;
let counter = 0;

async function call(method, url, body) {
  const headers = { Cookie: cookie };
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
async function tournamentWith(name, category, count) {
  const made = await call('POST', '/api/seasons', { name, kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02', categories: [category] });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const p = await call('POST', '/api/players', { name: `Hráč ${String(counter).padStart(2, '0')}` });
    await call('POST', `/api/seasons/${made.json.id}/registrations/admin`, { playerId: p.json.id, category, phone: `0904${String(100000 + counter)}`, email: `q${counter}@example.com` });
  }
  return made.json;
}
const bracketsOf = (t) => db.prepare('SELECT * FROM brackets WHERE season_id = ? ORDER BY id').all(t.id);
const nodesOf = (bracketId, round) => db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = ? ORDER BY position').all(bracketId, round);
const tokenOf = (node) => db.prepare('SELECT share_token FROM matches WHERE id = ?').get(node.match_id).share_token;
// the first player wins, through the app (so the bracket moves on and the loser drops into the consolation)
const finish = (node) => call('POST', `/api/matches/${tokenOf(node)}/manual-result`, { sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }], location: 'Kurt 1', scheduledAt: '2099-05-01T09:00:00.000Z' });
const seatedIn = (bracketId) => nodesOf(bracketId, 1).flatMap((n) => [n.player1_id, n.player2_id]).filter(Boolean);

let t1; let main1; let cons1;

test('19 players, PRINCE with a preliminary round: the same bracket of 32 marked prelim; one consolation for 3 + 8 losers', async () => {
  t1 = await tournamentWith('Predkolo Cup 2099', 'NEXT_GEN', 19);
  const draw = await call('POST', `/api/seasons/${t1.id}/draw`, { category: 'NEXT_GEN', format: 'PRINCE', mode: 'AUTO', byeMode: 'PRELIM' });
  assert.strictEqual(draw.status, 201, JSON.stringify(draw.json));
  [main1, cons1] = bracketsOf(t1);
  assert.strictEqual(main1.size, 32);
  assert.strictEqual(main1.prelim, 1);
  assert.strictEqual(cons1.kind, 'CONSOLATION');
  assert.strictEqual(cons1.size, 16, 'a consolation for 11 losers');
  const real = nodesOf(main1.id, 1).filter((n) => n.player1_id && n.player2_id);
  assert.strictEqual(real.length, 3, 'three preliminary matches');
  assert.ok(real.every((n) => n.loser_bracket_id === cons1.id), 'the preliminary matches feed the consolation');
  assert.ok(nodesOf(main1.id, 2).every((n) => n.loser_bracket_id === cons1.id), 'every 1. kolo match feeds the consolation');
  const api = (await call('GET', `/api/brackets/${main1.id}`)).json;
  assert.strictEqual(api.prelim, true);
  const settings = (await call('GET', `/api/seasons/${t1.id}/draw`)).json.categories[0].settings;
  assert.strictEqual(settings.byeMode, 'PRELIM');
});

test('the losers of the preliminary round and of 1. kolo drop into the consolation as their matches end; the winners move on', async () => {
  const pre = nodesOf(main1.id, 1).find((n) => n.player1_id && n.player2_id);
  assert.strictEqual((await finish(pre)).status, 200);
  assert.ok(seatedIn(cons1.id).includes(pre.player2_id), 'the loser of the preliminary match is in the consolation');
  const r2 = nodesOf(main1.id, 2).find((n) => n.player1_id && n.player2_id && n.match_id);
  assert.ok(r2, 'a 1. kolo match of two players with a bye');
  assert.strictEqual((await finish(r2)).status, 200);
  assert.ok(seatedIn(cons1.id).includes(r2.player2_id), 'the loser of 1. kolo is in the consolation');
  const match = (await call('GET', `/api/matches/${tokenOf(pre)}`)).json;
  assert.strictEqual(match.bracket.prelim, true, 'a match of the bracket knows it (Predkolo on its card)');
  assert.strictEqual(match.bracket.round, 1);
});

test('with byes (the default) nothing changes: the consolation takes only the round-1 losers and the bracket is not marked', async () => {
  const t2 = await tournamentWith('Bye Cup 2099', 'ELITE', 19);
  assert.strictEqual((await call('POST', `/api/seasons/${t2.id}/draw`, { category: 'ELITE', format: 'PRINCE', mode: 'AUTO' })).status, 201);
  const [main2, cons2] = bracketsOf(t2);
  assert.strictEqual(main2.prelim, 0);
  assert.strictEqual(cons2.size, 4, 'three losers of round 1');
  assert.strictEqual((await call('GET', `/api/brackets/${main2.id}`)).json.prelim, false);
});

test('the consolation picked by hand lists the losers of the preliminary round and of 1. kolo, with where they come from', async () => {
  const t3 = await tournamentWith('Predkolo Picks 2099', 'NOVICE', 19);
  assert.strictEqual((await call('POST', `/api/seasons/${t3.id}/draw`, { category: 'NOVICE', format: 'PRINCE', mode: 'AUTO', byeMode: 'PRELIM', consolationMode: 'MANUAL' })).status, 201);
  const [main3] = bracketsOf(t3);
  assert.strictEqual(bracketsOf(t3).length, 1);
  const pre = nodesOf(main3.id, 1).find((n) => n.player1_id && n.player2_id);
  await finish(pre);
  const r2 = nodesOf(main3.id, 2).find((n) => n.player1_id && n.player2_id && n.match_id);
  await finish(r2);
  const list = (await call('GET', `/api/brackets/${main3.id}/consolation-picks`)).json;
  assert.strictEqual(list.losers.length, 2);
  assert.ok(list.losers.some((l) => /^P\d+$/.test(l.label)), 'a loser of the preliminary round: P…');
  assert.ok(list.losers.some((l) => /^1\. kolo č\. \d+$/.test(l.label)), 'a loser of 1. kolo');
  assert.strictEqual(list.open, 3 + 8 - 2, 'the matches still to be played: 3 preliminary + 8 of 1. kolo, two are done');
});

test('the names of the rounds: Predkolo, then 1. kolo; the draw panel has the setting; the bracket page is in Slovak', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  global.t = (k, v) => ({ 'bracket.prelim': 'Predkolo', 'bracket.final': 'Finále', 'bracket.semi': 'Semifinále', 'bracket.quarter': 'Štvrťfinále', 'bracket.roundN': `${v && v.n}. kolo` }[k]);
  const src = read('js/common-forms.js');
  const norm = src.replace(/\r\n/g, '\n');
  const start = norm.indexOf('function bracketRoundLabel');
  const end = norm.indexOf('\n}', start) + 2;
  const fn = new Function(`${norm.slice(start, end)}; return bracketRoundLabel;`)();
  assert.deepStrictEqual([1, 2, 3, 4, 5].map((r) => fn(r, 5, true)), ['Predkolo', '1. kolo', 'Štvrťfinále', 'Semifinále', 'Finále']);
  assert.deepStrictEqual([1, 2, 3, 4, 5].map((r) => fn(r, 5, false)), ['1. kolo', '2. kolo', 'Štvrťfinále', 'Semifinále', 'Finále']);
  const draw = read('js/season-draw.js');
  assert.ok(draw.includes('sd-bye-mode') && draw.includes('byeMode'), 'the setting');
  const view = read('js/bracket-view.js');
  assert.ok(view.includes('data.prelim') && !/>Bye</.test(view) && !/Not yet scheduled/.test(view) && !/>Winner</.test(view), 'no English words left in the drawing');
});

async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    db = new DatabaseSync(path.join(dir, 'blta-score.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (db) db.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
