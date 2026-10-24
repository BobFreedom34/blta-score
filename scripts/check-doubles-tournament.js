// Checks of the doubles (štvorhra) of a tournament (src/tournamentDraw.js, routes /api/seasons/:id/doubles/...): the registration form can name a
// partner, the organiser makes pairs (by hand or from those names), seeds them and makes ONE doubles bracket tied to the tournament; its matches
// are doubles matches that count in no league and carry the tournament; the court planner keeps a partner from being on two courts at once.
// Run: node scripts/check-doubles-tournament.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbltourn-'));
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

const P = {};
let season = null;
async function players(names) {
  for (const name of names) {
    const r = await call('POST', '/api/players', { body: { name } });
    P[name] = r.json.id;
  }
}
const pairs = async () => (await call('GET', `/api/seasons/${season.id}/doubles`)).json;
const finish = (token, sets) => call('POST', `/api/matches/${token}/manual-result`, { body: { sets, location: 'Kurt 1', scheduledAt: new Date().toISOString() } });

test('the registration form can name a partner for the doubles; the organiser sees it', async () => {
  await players(['Adam A', 'Boris B', 'Cyril C', 'Dušan D', 'Emil E', 'Fero F', 'Gita G', 'Hana H']);
  const s = await call('POST', '/api/seasons', { body: { name: 'Letný turnaj', kind: 'TOURNAMENT', startDate: '2099-06-01', endDate: '2099-06-02' } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  season = s.json;
  assert.strictEqual((await call('PATCH', `/api/seasons/${season.id}`, { body: { registrationOpen: true } })).status, 200);
  const reg = (name, partner, phone, email) => call('POST', `/api/seasons/${season.id}/registrations`, { cookie: '', body: { name, partner, phone, email } });
  const r1 = await reg('Adam A', 'Boris B', '0903000001', 'a@example.com');
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.json));
  assert.strictEqual((await reg('Boris B', 'Adam A', '0903000002', 'b@example.com')).status, 201, 'the partner may name him back');
  assert.strictEqual((await reg('Cyril C', 'Dušan D', '0903000003', 'c@example.com')).status, 201);
  assert.strictEqual((await reg('Emil E', 'Neznámy Hráč', '0903000005', 'e@example.com')).status, 201, 'a partner who is not a player yet is only a note');
  assert.strictEqual((await reg('Fero F', '', '0903000006', 'f@example.com')).status, 201, 'singles only');
  const list = (await call('GET', `/api/seasons/${season.id}/registrations`)).json;
  assert.strictEqual(list.find((r) => r.name === 'Adam A').partnerName, 'Boris B');
  assert.strictEqual(list.find((r) => r.name === 'Fero F').partnerName, '');
});

test('pairs: made by hand or from the registrations, one pair per player, seeded', async () => {
  let o = await pairs();
  assert.strictEqual(o.pairs.length, 0);
  assert.strictEqual(o.registrationsWithPartner, 4);
  const a = await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { fromRegistrations: true } });
  assert.strictEqual(a.status, 201, JSON.stringify(a.json));
  assert.strictEqual(a.json.created, 2, 'Adam+Boris (once, though both wrote it) and Cyril+Dušan');
  assert.deepStrictEqual(a.json.skipped.map((x) => x.partner), ['Neznámy Hráč'], 'an unknown partner is reported, not guessed');
  // by hand: names or ids; nobody twice
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Emil E', partner: 'Fero F' } })).status, 201);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: P['Gita G'], partner: P['Hana H'] } })).status, 201);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Gita G' } })).status, 409, 'Adam is in a pair');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Adam A' } })).status, 400);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Nikto Nikto', partner: 'Gita G' } })).status, 400);
  o = await pairs();
  assert.strictEqual(o.pairs.length, 4);
  assert.strictEqual(o.size, 4);
  // seeds: the pair of Gita and Hana first
  const seeds = o.pairs.map((p) => ({ id: p.id, seed: p.player.name === 'Gita G' ? 1 : null }));
  const s = await call('POST', `/api/seasons/${season.id}/doubles/seeds`, { body: { seeds } });
  assert.strictEqual(s.status, 200, JSON.stringify(s.json));
  assert.strictEqual(s.json.pairs[0].player.name, 'Gita G');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/seeds`, { body: { seeds: [{ id: o.pairs[0].id, seed: 9 }] } })).status, 400, 'a seed above the number of pairs');
  // a pair can be taken away before the draw
  const emil = o.pairs.find((p) => p.player.name === 'Emil E');
  const extra = await call('DELETE', `/api/seasons/${season.id}/doubles/pairs/${emil.id}`);
  assert.strictEqual(extra.status, 200);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Emil E', partner: 'Fero F' } })).status, 201, 'and put back');
});

test('the doubles draw: one bracket tied to the tournament, no league category, matches are doubles matches', async () => {
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/draw`, { cookie: '' })).status, 401, 'organiser only');
  const made = await call('POST', `/api/seasons/${season.id}/doubles/draw`, { body: { mainFormat: 'BO3' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const id = made.json.main;
  const b = (await call('GET', `/api/brackets/${id}`, { cookie: '' })).json;
  assert.strictEqual(b.isDoubles, true);
  assert.strictEqual(b.category, null);
  assert.strictEqual(b.season.id, season.id);
  assert.strictEqual(b.size, 4);
  const r1 = b.nodes.filter((n) => n.round === 1);
  assert.strictEqual(r1.length, 2);
  assert.ok(r1.every((n) => n.match && n.player1.team.length === 2 && n.player2.team.length === 2), 'a doubles match for each pairing');
  assert.ok(r1.some((n) => n.player1.name === 'Gita G / Hana H' && n.seed1 === 1), 'the seeded pair is seed 1');
  const m = (await call('GET', `/api/matches/${r1[0].match.token}`, { cookie: '' })).json;
  assert.strictEqual(m.isDoubles, true);
  assert.strictEqual(m.seasonId || (m.season && m.season.id), season.id);
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/draw`, { body: {} })).status, 409, 'one doubles draw');
  assert.strictEqual((await call('POST', `/api/seasons/${season.id}/doubles/pairs`, { body: { player: 'Adam A', partner: 'Cyril C' } })).status, 409, 'no new pairs after the draw');
  const listed = (await call('GET', `/api/seasons/${season.id}/brackets`, { cookie: '' })).json;
  assert.deepStrictEqual(listed.map((x) => [x.id, x.isDoubles]), [[id, true]]);
  const o = await pairs();
  assert.ok(o.draw && o.draw.id === id && o.draw.matches === 2);
});

test('playing the draw: the winning pair goes on, the doubles ranking counts it, and no league table or CourtIQ does', async () => {
  const o = await pairs();
  let b = (await call('GET', `/api/brackets/${o.draw.id}`, { cookie: '' })).json;
  for (const n of b.nodes.filter((x) => x.round === 1)) assert.strictEqual((await finish(n.match.token, [{ p1: 6, p2: 2 }, { p1: 6, p2: 3 }])).status, 200);
  b = (await call('GET', `/api/brackets/${o.draw.id}`, { cookie: '' })).json;
  const final = b.nodes.find((x) => x.round === 2);
  assert.ok(final.match, 'the final was made with the winners');
  assert.strictEqual(final.player1.team.length, 2);
  assert.strictEqual((await finish(final.match.token, [{ p1: 7, p2: 6 }, { p1: 6, p2: 4 }])).status, 200);
  const rank = (await call('GET', '/api/doubles/ranking', { cookie: '' })).json.rows;
  assert.strictEqual(rank.length, 8, 'all eight players of the four pairs');
  assert.strictEqual(rank[0].wins, 2);
  const iq = await call('GET', `/api/courtiq/player/${P['Gita G']}`, { cookie: '' });
  assert.strictEqual(iq.json.gamesPlayed, 0);
  const standings = (await call('GET', `/api/seasons/${season.id}/standings`, { cookie: '' })).json;
  assert.ok(!standings.groups || standings.groups.length === 0, 'no group table');
  // a draw that has been played cannot be deleted
  assert.strictEqual((await call('DELETE', `/api/seasons/${season.id}/doubles/draw`)).status, 409);
});

test('the court planner knows the partners of a doubles match', async () => {
  const s = await call('POST', '/api/seasons', { body: { name: 'Plánovač', kind: 'TOURNAMENT', startDate: '2099-07-01', endDate: '2099-07-02' } });
  const sid = s.json.id;
  await call('PATCH', `/api/seasons/${sid}`, { body: { courtCount: 2 } });
  await players(['Iva I', 'Jan J', 'Kuba K', 'Lea L']);
  for (const [a, b] of [['Iva I', 'Jan J'], ['Kuba K', 'Lea L']]) {
    assert.strictEqual((await call('POST', `/api/seasons/${sid}/doubles/pairs`, { body: { player: a, partner: b } })).status, 201);
  }
  const made = await call('POST', `/api/seasons/${sid}/doubles/draw`, { body: { mainFormat: 'BO3' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const sched = (await call('GET', `/api/seasons/${sid}/schedule`, { cookie: '' })).json;
  const row = (sched.matches || sched.rows || []).find((m) => m.player1 && m.player2 && [m.player1.name, m.player2.name].sort().join('|') === 'Iva I / Jan J|Kuba K / Lea L');
  assert.ok(row, 'the schedule names the pairs: ' + JSON.stringify(sched).slice(0, 300));
  assert.deepStrictEqual([row.player1.slug, row.player2.slug], [null, null], 'a pair has no profile link');
  // deleting the tournament takes the pairs and the draw with it
  assert.strictEqual((await call('DELETE', `/api/seasons/${sid}?withMatches=1`)).status, 200);
  assert.strictEqual((await call('GET', `/api/brackets/${made.json.main}`, { cookie: '' })).status, 404);
});

test('the pages carry the pieces: the partner field of the form, the doubles part of the draw panel, the chip of the brackets tab', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  assert.ok(read('js/season.js').includes('sv-reg-partner') && read('js/season.js').includes('partner'), 'season.js: the partner field');
  const draw = read('js/season-draw.js');
  ['/doubles`', '/pairs`', '/draw`', '/seeds`', 'dbl-draw'].forEach((s) => assert.ok(draw.includes(s), 'season-draw.js: ' + s));
  const i18n = read('js/i18n.js');
  ['season.regPartner', 'season.catDoubles'].forEach((k) => assert.strictEqual(i18n.split("'" + k + "'").length, 3, k + ' in Slovak and English'));
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
