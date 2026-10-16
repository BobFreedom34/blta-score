// Checks of the court schedule of a tournament: the planner (matches placed on courts without clashes, with rest for the players,
// later rounds after the earlier ones finished), placing a match by hand, locked matches, settings.
// Run: node scripts/check-tournament-schedule.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsched-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';

async function call(method, url, body, { admin = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && adminCookie) headers.Cookie = adminCookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

let tournament;
let players = [];
let mainId;
const MIN = 60 * 1000;
const schedule = async () => (await call('GET', `/api/seasons/${tournament.id}/schedule`, undefined, { admin: false })).json;
const bracketOf = async (id) => (await call('GET', `/api/brackets/${id}`)).json;
const localHour = (iso) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
const localDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(new Date(iso));

// no two matches on one court at once, nobody on two courts at once, and at least `rest` minutes between two matches of one player
function assertNoClashes(sch, restMinutes) {
  const placed = sch.matches.filter((m) => m.scheduledAt && m.courtNo && m.status === 'PLANNED');
  const lenOf = (m) => Date.parse(m.endsAt) - Date.parse(m.scheduledAt); // the length of this match (it can differ from the tournament's)
  placed.forEach((a) => {
    placed.filter((b) => b.token !== a.token).forEach((b) => {
      const as = Date.parse(a.scheduledAt); const bs = Date.parse(b.scheduledAt);
      if (a.courtNo === b.courtNo) assert.ok(as + lenOf(a) <= bs || bs + lenOf(b) <= as, `court ${a.courtNo}: two matches overlap`);
      const shared = [a.player1.id, a.player2.id].filter((id) => [b.player1.id, b.player2.id].includes(id));
      if (shared.length) assert.ok(as + lenOf(a) + restMinutes * MIN <= bs || bs + lenOf(b) + restMinutes * MIN <= as, 'a player has no rest between two matches');
    });
  });
}

async function finish(node, winnerId, scheduledAt) {
  const set = winnerId === node.player1.id ? { p1: 6, p2: 2 } : { p1: 2, p2: 6 };
  const r = await call('POST', `/api/matches/${node.match.token}/manual-result`, { sets: [set, set], location: 'Kurt 1', scheduledAt });
  assert.strictEqual(r.status, 200, r.text);
}

test('setup: a two-day tournament with 8 Elite players; courts and settings are validated', async () => {
  const made = await call('POST', '/api/seasons', { name: 'Schedule Open 2099', kind: 'TOURNAMENT', startDate: '2099-05-01', endDate: '2099-05-02' });
  assert.strictEqual(made.status, 201, made.text);
  tournament = made.json;
  for (let i = 0; i < 8; i += 1) {
    const p = (await call('POST', '/api/players', { name: `Sched Player ${i + 1}` })).json;
    players.push(p);
    const reg = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { playerId: p.id, category: 'ELITE', phone: `0905${String(100000 + i)}`, email: `s${i}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
  }
  const bad = async (body) => (await call('PATCH', `/api/seasons/${tournament.id}/schedule/settings`, body)).status;
  assert.strictEqual(await bad({ matchMinutes: 5 }), 400);
  assert.strictEqual(await bad({ dayStart: '25:00' }), 400);
  assert.strictEqual(await bad({ dayStart: '21:00' }), 400, 'the day must end after it starts');
  assert.strictEqual(await bad({ restMinutes: -1 }), 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}/schedule/settings`, { matchMinutes: 60 }, { admin: false })).status, 401);
  const ok = await call('PATCH', `/api/seasons/${tournament.id}/schedule/settings`, { matchMinutes: 60, dayStart: '09:00', dayEnd: '18:00', restMinutes: 30 });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.settings.matchMinutes, 60);
  assert.deepStrictEqual(ok.json.settings.days, ['2099-05-01', '2099-05-02']);
});

test('without courts there is nothing to plan', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'fill' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${tournament.id}`, { courtCount: 2 })).json.courtCount, 2);
});

test('a new draw is placed on the courts by itself: 4 round-1 matches on 2 courts, inside the playing day, no clashes', async () => {
  const r = await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'ELITE', mode: 'AUTO', mainFormat: 'BO3_STB' });
  assert.strictEqual(r.status, 201, r.text);
  mainId = r.json.main;
  const sch = await schedule();
  assert.strictEqual(sch.matches.length, 4);
  assert.ok(sch.matches.every((m) => m.scheduledAt && m.courtNo >= 1 && m.courtNo <= 2), 'every match is on a court');
  assert.ok(sch.matches.every((m) => localDay(m.scheduledAt) === '2099-05-01' && localHour(m.scheduledAt) >= 9 && localHour(m.endsAt) <= 18));
  assert.deepStrictEqual(sch.matches.map((m) => m.courtNo).sort(), [1, 1, 2, 2]);
  assert.strictEqual(sch.matches.filter((m) => localHour(m.scheduledAt) === 9).length, 2, 'two courts start at 9:00');
  assert.strictEqual(sch.unscheduledCount, 0);
  assert.ok(sch.matches.every((m) => m.locked === false));
  assertNoClashes(sch, 30);
  // the match carries its court and time like any other match
  const one = (await call('GET', `/api/matches/${sch.matches[0].token}`)).json;
  assert.strictEqual(one.location, `Kurt ${sch.matches[0].courtNo}`);
  assert.strictEqual(one.scheduledAt, sch.matches[0].scheduledAt);
});

test('when round 1 is finished, round 2 is placed after it: no clashes, a rest for every player', async () => {
  let main = await bracketOf(mainId);
  const round1 = main.nodes.filter((n) => n.round === 1);
  for (const n of round1) await finish(n, n.player1.id, n.match.scheduledAt);
  main = await bracketOf(mainId);
  const round2 = main.nodes.filter((n) => n.round === 2);
  assert.ok(round2.every((n) => n.match), 'round-2 matches exist');
  const sch = await schedule();
  const r2tokens = round2.map((n) => n.match.token);
  const r2 = sch.matches.filter((m) => r2tokens.includes(m.token));
  assert.ok(r2.every((m) => m.scheduledAt && m.courtNo), 'round-2 matches are on a court');
  const latestR1End = Math.max(...sch.matches.filter((m) => m.status === 'FINISHED').map((m) => Date.parse(m.endsAt)));
  assert.ok(r2.every((m) => Date.parse(m.scheduledAt) >= latestR1End - 3 * 60 * MIN), 'round 2 comes after round 1');
  // each round-2 player's own round-1 match ended at least 30 minutes before
  r2.forEach((m) => [m.player1.id, m.player2.id].forEach((id) => {
    const own = sch.matches.find((x) => x.status === 'FINISHED' && [x.player1.id, x.player2.id].includes(id));
    assert.ok(Date.parse(m.scheduledAt) >= Date.parse(own.endsAt) + 30 * MIN, 'a player rests between rounds');
  }));
  assertNoClashes(sch, 30);
});

test('by hand: a planned match goes to a court at a time (and is locked); a taken court is refused; a clash of a player is a warning', async () => {
  const sch = await schedule();
  const planned = sch.matches.filter((m) => m.status === 'PLANNED');
  assert.strictEqual(planned.length, 4, 'two round-2 matches and two consolation matches');
  const [a, b] = planned;
  assert.strictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${a.token}`, { courtNo: 2, scheduledAt: '2099-05-02T08:00:00.000Z' }, { admin: false })).status, 401);
  const placed = await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${a.token}`, { courtNo: 2, scheduledAt: '2099-05-02T08:00:00.000Z' });
  assert.strictEqual(placed.status, 200, placed.text);
  const after = placed.json.schedule.matches.find((m) => m.token === a.token);
  assert.deepStrictEqual([after.courtNo, after.scheduledAt, after.locked], [2, '2099-05-02T08:00:00.000Z', true]);
  const taken = await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${b.token}`, { courtNo: 2, scheduledAt: '2099-05-02T08:30:00.000Z' });
  assert.strictEqual(taken.status, 409);
  assert.strictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${b.token}`, { courtNo: 3, scheduledAt: '2099-05-02T10:00:00.000Z' })).status, 400, 'no court 3');
  assert.strictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${b.token}`, { courtNo: 1, scheduledAt: 'x' })).status, 400);
  // the other round-2 match has different players, so no warning; a finished match cannot be moved
  const fine = await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${b.token}`, { courtNo: 1, scheduledAt: '2099-05-02T08:00:00.000Z' });
  assert.strictEqual(fine.status, 200, fine.text);
  // a player who is already on court at that time: placed anyway (the organiser knows best), with a warning
  const own = sch.matches.find((m) => m.status === 'FINISHED' && [m.player1.id, m.player2.id].some((id) => [a.player1.id, a.player2.id].includes(id)));
  const clashing = await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${a.token}`, { courtNo: 2, scheduledAt: own.scheduledAt });
  assert.strictEqual(clashing.status, 200, clashing.text);
  assert.ok(clashing.json.warnings.length >= 1);
  assert.deepStrictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${a.token}`, { courtNo: 2, scheduledAt: '2099-05-02T08:00:00.000Z' })).json.warnings, []);
  const finished = sch.matches.find((m) => m.status === 'FINISHED');
  assert.strictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${finished.token}`, { courtNo: 1, scheduledAt: '2099-05-02T12:00:00.000Z' })).status, 409);
});

test('the planner never moves a locked match; "rebuild" re-places the others; "clear" takes everything planned off the courts', async () => {
  const before = await schedule();
  const lockedBefore = before.matches.filter((m) => m.locked).map((m) => [m.token, m.courtNo, m.scheduledAt]);
  assert.strictEqual(lockedBefore.length, 2);
  const rebuilt = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'rebuild' });
  assert.strictEqual(rebuilt.status, 200, rebuilt.text);
  const lockedAfter = rebuilt.json.schedule.matches.filter((m) => m.locked).map((m) => [m.token, m.courtNo, m.scheduledAt]);
  assert.deepStrictEqual(lockedAfter, lockedBefore);
  const cleared = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'clear' });
  assert.strictEqual(cleared.json.cleared, 4);
  const sch = cleared.json.schedule;
  assert.strictEqual(sch.unscheduledCount, 4);
  assert.ok(sch.matches.filter((m) => m.status === 'PLANNED').every((m) => !m.scheduledAt && !m.courtNo && !m.locked));
  const filled = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'fill' });
  assert.strictEqual(filled.json.placed, 4);
  assertNoClashes(filled.json.schedule, 30);
});

test('locking and unlocking: one match by itself (it stays where it is), all at once; a match that is not on a court cannot be locked', async () => {
  const sch = await schedule();
  const [one, two] = sch.matches.filter((m) => m.status === 'PLANNED' && m.courtNo);
  const put = (token, body, admin = true) => call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${token}`, body, { admin });
  assert.strictEqual((await put(one.token, { locked: true }, false)).status, 401);
  const locked = await put(one.token, { locked: true });
  assert.strictEqual(locked.status, 200, locked.text);
  assert.strictEqual(locked.json.schedule.matches.find((m) => m.token === one.token).locked, true);
  await put(two.token, { locked: true });
  const unlocked = await put(one.token, { locked: false });
  const after = unlocked.json.schedule.matches.find((m) => m.token === one.token);
  assert.deepStrictEqual([after.locked, after.courtNo, after.scheduledAt], [false, one.courtNo, one.scheduledAt], 'unlocking leaves the match where it is');
  assert.strictEqual(unlocked.json.schedule.matches.find((m) => m.token === two.token).locked, true);
  const all = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'unlock' });
  assert.strictEqual(all.json.unlocked, 1);
  assert.ok(all.json.schedule.matches.every((m) => !m.locked));
  const cleared = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'clear' });
  const free = cleared.json.schedule.matches.find((m) => m.status === 'PLANNED');
  assert.strictEqual((await put(free.token, { locked: true })).status, 400, 'not on a court yet');
  await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'fill' });
});

test('the length of one match: set by the organiser (15–300, steps of 5), the following match moves forward, reset with null; a match that ended early frees its court', async () => {
  const put = (token, body) => call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${token}`, body);
  const sch = await schedule();
  const planned = sch.matches.filter((m) => m.status === 'PLANNED' && m.courtNo && m.scheduledAt).sort((x, y) => Date.parse(x.scheduledAt) - Date.parse(y.scheduledAt));
  // two matches one after the other on one court
  let first; let second;
  for (const m of planned) {
    const next = planned.find((o) => o.courtNo === m.courtNo && Date.parse(o.scheduledAt) >= Date.parse(m.endsAt) - 1);
    if (next) { first = m; second = next; break; }
  }
  assert.ok(first && second, 'two matches follow each other on a court');
  assert.strictEqual((await put(first.token, { durationMinutes: 10 })).status, 400);
  assert.strictEqual((await put(first.token, { durationMinutes: 47 })).status, 400);
  assert.strictEqual((await put(first.token, { durationMinutes: 400 })).status, 400);
  assert.strictEqual((await call('PUT', `/api/seasons/${tournament.id}/schedule/matches/${first.token}`, { durationMinutes: 30 }, { admin: false })).status, 401);
  const short = await put(first.token, { durationMinutes: 30 });
  assert.strictEqual(short.status, 200, short.text);
  const a2 = short.json.schedule.matches.find((m) => m.token === first.token);
  assert.strictEqual(Date.parse(a2.endsAt) - Date.parse(a2.scheduledAt), 30 * MIN);
  assert.strictEqual(a2.durationMinutes, 30);
  const b2 = short.json.schedule.matches.find((m) => m.token === second.token);
  assert.ok(Date.parse(b2.scheduledAt) < Date.parse(second.scheduledAt), 'the following match moved forward into the freed time');
  assertNoClashes(short.json.schedule, 30);
  const reset = await put(first.token, { durationMinutes: null });
  assert.strictEqual(reset.json.schedule.matches.find((m) => m.token === first.token).durationMinutes, null);
  assertNoClashes(reset.json.schedule, 30);
  // a finished match with a real start and end: the court is free from its real end
  const finished = (await schedule()).matches.find((m) => m.status === 'FINISHED' && m.courtNo);
  assert.ok(finished);
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const realStart = Date.parse(finished.scheduledAt);
  db.prepare('UPDATE matches SET start_time = ?, end_time = ? WHERE share_token = ?').run(new Date(realStart).toISOString(), new Date(realStart + 40 * MIN).toISOString(), finished.token);
  db.close();
  const after = (await schedule()).matches.find((m) => m.token === finished.token);
  assert.strictEqual(Date.parse(after.endsAt) - Date.parse(after.blockStart), 40 * MIN, 'the block is the real 40 minutes');
  assert.strictEqual(after.endKnown, true);
  assert.strictEqual((await put(finished.token, { durationMinutes: 60 })).status, 200, 'a length can be set, but the real end wins');
  assert.strictEqual(Date.parse((await schedule()).matches.find((m) => m.token === finished.token).endsAt), realStart + 40 * MIN);
  // a result entered by hand: the match ended when the result was entered (but not later than its length allows)
  const byHand = (await schedule()).matches.filter((m) => m.status === 'FINISHED' && m.courtNo && m.token !== finished.token);
  assert.ok(byHand.length >= 2);
  const sql = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const enter = (m, afterMin) => sql.prepare('UPDATE matches SET end_time = NULL, result_at = ? WHERE share_token = ?').run(new Date(Date.parse(m.blockStart) + afterMin * MIN).toISOString(), m.token);
  enter(byHand[0], 25);
  enter(byHand[1], 600);
  sql.close();
  const [h0, h1] = [byHand[0], byHand[1]].map((m) => ({ ...m, now: null }));
  const after2 = (await schedule()).matches;
  const e0 = after2.find((m) => m.token === h0.token);
  const e1 = after2.find((m) => m.token === h1.token);
  assert.strictEqual(Date.parse(e0.endsAt) - Date.parse(e0.blockStart), 25 * MIN, 'ended when the result was entered');
  assert.strictEqual(Date.parse(e1.endsAt) - Date.parse(e1.blockStart), 60 * MIN, 'a result entered much later: ended at the latest when its length was up');
  assert.strictEqual((await put(byHand[0].token, { durationMinutes: 45 })).status, 200);
  const e0b = (await schedule()).matches.find((m) => m.token === h0.token);
  assert.strictEqual(Date.parse(e0b.endsAt) - Date.parse(e0b.blockStart), 45 * MIN, 'a length set by the organiser wins');
  const compacted = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'compact' });
  assert.strictEqual(compacted.status, 200, compacted.text);
  assertNoClashes(compacted.json.schedule, 30);
});

test('with "automatic schedule" off, a new match stays unscheduled until the planner is run', async () => {
  const off = await call('PATCH', `/api/seasons/${tournament.id}/schedule/settings`, { autoSchedule: false });
  assert.strictEqual(off.json.settings.autoSchedule, false);
  // a second tournament category made while it is off
  for (let i = 0; i < 4; i += 1) {
    const p = (await call('POST', '/api/players', { name: `Sched Novice ${i + 1}` })).json;
    const reg = await call('POST', `/api/seasons/${tournament.id}/registrations/admin`, { playerId: p.id, category: 'NOVICE', phone: `0906${String(100000 + i)}`, email: `n${i}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
  }
  assert.strictEqual((await call('POST', `/api/seasons/${tournament.id}/draw`, { category: 'NOVICE', mode: 'AUTO' })).status, 201);
  let sch = await schedule();
  assert.strictEqual(sch.unscheduledCount, 2, 'the two Novice round-1 matches are waiting');
  const run = await call('POST', `/api/seasons/${tournament.id}/schedule/auto`, { mode: 'fill' });
  assert.strictEqual(run.json.placed, 2);
  sch = run.json.schedule;
  assert.strictEqual(sch.unscheduledCount, 0);
  assertNoClashes(sch, 30);
});

test('most matches per player per day: with a limit of 1 the next match of a player goes to the next day; 0 = no limit; the tournament form and the schedule settings both set it', async () => {
  const t = (await call('POST', '/api/seasons', { name: 'Limit Open 2099', kind: 'TOURNAMENT', startDate: '2099-06-01', endDate: '2099-06-02' })).json;
  assert.strictEqual(t.maxMatchesPerDay, 0);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { maxMatchesPerDay: 11 })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}`, { courtCount: 2, maxMatchesPerDay: 1 })).json.maxMatchesPerDay, 1);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { maxPerDay: 11 })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { restMinutes: 0 })).json.settings.maxPerDay, 1);
  for (let i = 0; i < 4; i += 1) {
    const p = (await call('POST', '/api/players', { name: `Limit Player ${i + 1}` })).json;
    const reg = await call('POST', `/api/seasons/${t.id}/registrations/admin`, { playerId: p.id, category: 'ELITE', phone: `0907${String(100000 + i)}`, email: `l${i}@example.com` });
    assert.strictEqual(reg.status, 201, reg.text);
  }
  const drawn = await call('POST', `/api/seasons/${t.id}/draw`, { category: 'ELITE', mode: 'AUTO' });
  assert.strictEqual(drawn.status, 201, drawn.text);
  let sch = (await call('GET', `/api/seasons/${t.id}/schedule`)).json;
  assert.ok(sch.matches.every((m) => localDay(m.scheduledAt) === '2099-06-01'), 'round 1 is on day 1');
  const main = await bracketOf(drawn.json.main);
  for (const n of main.nodes.filter((x) => x.round === 1)) await finish(n, n.player1.id, n.match.scheduledAt);
  sch = (await call('GET', `/api/seasons/${t.id}/schedule`)).json;
  const planned = sch.matches.filter((m) => m.status === 'PLANNED');
  assert.ok(planned.length >= 2, 'the final and the consolation match exist');
  assert.ok(planned.every((m) => m.scheduledAt && localDay(m.scheduledAt) === '2099-06-02'), 'everybody has played once on day 1, so the next matches are on day 2');
  // without a limit the same matches would go to day 1 (as long as the rest allows)
  await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { maxPerDay: 0 });
  const again = await call('POST', `/api/seasons/${t.id}/schedule/auto`, { mode: 'rebuild' });
  assert.ok(again.json.schedule.matches.filter((m) => m.status === 'PLANNED').every((m) => localDay(m.scheduledAt) === '2099-06-01'), 'no limit: the next matches follow on day 1');
  // by hand, over the limit: allowed with a warning
  await call('PATCH', `/api/seasons/${t.id}/schedule/settings`, { maxPerDay: 1 });
  const one = again.json.schedule.matches.find((m) => m.status === 'PLANNED');
  const warned = await call('PUT', `/api/seasons/${t.id}/schedule/matches/${one.token}`, { courtNo: 1, scheduledAt: '2099-06-01T17:00:00.000Z' });
  assert.strictEqual(warned.status, 200, warned.text);
  assert.ok(warned.json.warnings.some((w) => /more than 1 match/.test(w)));
});

test('a league season has no court schedule', async () => {
  const league = (await call('POST', '/api/seasons', { name: 'League X', kind: 'LEAGUE' })).json;
  assert.strictEqual((await call('GET', `/api/seasons/${league.id}/schedule`)).status, 400);
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
    adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(adminCookie, 'admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
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
