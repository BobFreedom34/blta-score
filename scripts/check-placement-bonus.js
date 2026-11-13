// Checks of the automatic placement bonus (src/rankingBonus.js): a decided play-off gives the bonus of the Propozície to the tables by itself, the Points log
// says it, a corrected result moves it, a deleted bracket takes it back. In-process with its own data folder.
// Run: node scripts/check-placement-bonus.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonus-'));
process.env.DATA_DIR = dir;
const db = require('../src/db');
const rankingPoints = require('../src/rankingPoints');
const bracketEngine = require('../src/bracketEngine');
const bonus = require('../src/rankingBonus');
const changeLog = require('../src/changeLog');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const player = (name) => Number(db.prepare('INSERT INTO players (name, slug) VALUES (?, ?)').run(name, name.toLowerCase().replace(/\W+/g, '-')).lastInsertRowid);
const season = (name, kind) => Number(db.prepare('INSERT INTO seasons (name, slug, kind, start_date, end_date) VALUES (?, ?, ?, ?, ?)').run(name, name.toLowerCase().replace(/\W+/g, '-'), kind, '2026-01-01', '2026-12-31').lastInsertRowid);
const pts = (tableKey, playerId) => { const e = rankingPoints.entryFor(tableKey, playerId, false); return e ? e.points : undefined; };
const nodes = (bracketId) => db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position').all(bracketId);

// a 4-player manual bracket: semi-finals (a-b, c-d), final
function bracketOf(seasonId, category, ids, name) {
  const id = bracketEngine.createBracket({ name, format: 'BO3', entries: ids.map((playerId, i) => ({ playerId, seed: i + 1 })), category, seasonId, autoCreateMatches: false });
  return id;
}
const decide = (bracketId, round, position, winnerId) => {
  const node = nodes(bracketId).find((n) => n.round === round && n.position === position);
  bracketEngine.recordManualResult(node.id, winnerId, '6-4, 6-4');
};

const S = {};

test('first run: nothing is added for a play-off that is not decided; the start only records (init) what is decided at that moment', async () => {
  S.lg = season('Bonus League', 'LEAGUE');
  S.p = ['Bo A', 'Bo B', 'Bo C', 'Bo D'].map(player);
  S.br = bracketOf(S.lg, 'ELITE', S.p, 'Elite Play-off');
  const first = bonus.sync();
  assert.strictEqual(first.first, true);
  assert.strictEqual(first.changes, 0);
  assert.strictEqual(pts('blta', S.p[0]), undefined);
});

test('a decided league play-off: winner 100, finalist 70, two semi-finalists 40 each - overall table and the race table, nothing in Tournaments, dated item behind the overall points', async () => {
  const [a, b, c, d] = S.p;
  const tree = nodes(S.br);
  const semi1 = tree.find((n) => n.round === 1 && n.position === 0);
  const semi2 = tree.find((n) => n.round === 1 && n.position === 1);
  decide(S.br, 1, 0, semi1.player1_id);
  decide(S.br, 1, 1, semi2.player1_id);
  assert.strictEqual(bonus.sync().changes, 0, 'not decided before the final');
  decide(S.br, 2, 0, semi1.player1_id);
  const done = bonus.sync();
  assert.strictEqual(done.changes, 8, '4 players x 2 tables');
  const winner = semi1.player1_id;
  const finalist = semi2.player1_id;
  assert.strictEqual(pts('blta', winner), 100);
  assert.strictEqual(pts('elite_race', winner), 100);
  assert.strictEqual(pts('blta', finalist), 70);
  const semis = [semi1.player2_id, semi2.player2_id];
  semis.forEach((id) => { assert.strictEqual(pts('blta', id), 40); assert.strictEqual(pts('elite_race', id), 40); });
  assert.strictEqual(pts('tournaments', winner), undefined);
  const items = db.prepare("SELECT kind, points FROM ranking_expiry WHERE kind = 'BONUS' ORDER BY points DESC").all();
  assert.deepStrictEqual(items.map((i) => i.points), [100, 70, 40, 40]);
  S.winner = winner; S.finalist = finalist; S.semis = semis;
  void a; void b; void c; void d;
});

test('the Points log says it (kind BONUS), once; running again changes nothing', async () => {
  const log = changeLog.list({ kind: 'BONUS' }).items;
  assert.strictEqual(log.length, 8);
  assert.ok(log.some((l) => l.ranking[0].before === 0 && l.ranking[0].after === 100 && /Víťaz/.test(l.title)));
  assert.strictEqual(bonus.sync().changes, 0);
  assert.strictEqual(changeLog.list({ kind: 'BONUS' }).items.length, 8);
  assert.strictEqual(pts('blta', S.winner), 100, 'not paid twice');
});

test('a corrected final moves the bonus: the old places are taken back, the new ones paid', async () => {
  const tree = nodes(S.br);
  const final = tree.find((n) => n.round === 2);
  // the other finalist now wins: reset the final and decide it again
  bracketEngine.resetManualResult(final.id, false);
  decide(S.br, 2, 0, S.finalist);
  const moved = bonus.sync();
  assert.ok(moved.changes > 0);
  assert.strictEqual(pts('blta', S.finalist), 100);
  assert.strictEqual(pts('blta', S.winner), 70);
  assert.strictEqual(pts('elite_race', S.finalist), 100);
  assert.strictEqual(pts('elite_race', S.winner), 70);
  S.semis.forEach((id) => assert.strictEqual(pts('blta', id), 40, 'the semi-finalists are not touched'));
});

test('a result that is taken back (the final is open again) takes the bonus of the places back', async () => {
  const final = nodes(S.br).find((n) => n.round === 2);
  bracketEngine.resetManualResult(final.id, false);
  bonus.sync();
  assert.strictEqual(pts('blta', S.finalist), 0);
  assert.strictEqual(pts('blta', S.winner), 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM ranking_expiry WHERE kind = 'BONUS'").get().n, 0);
});

test('a tournament: Elite winner 50 to the overall table and to Tournaments; Novice has its own numbers; doubles and clubs give nothing', async () => {
  const t = season('Bonus Cup', 'TOURNAMENT');
  const ids = ['To A', 'To B', 'To C', 'To D'].map(player);
  const br = bracketOf(t, 'NOVICE', ids, 'Novice');
  const tree = nodes(br);
  const s1 = tree.find((n) => n.round === 1 && n.position === 0);
  const s2 = tree.find((n) => n.round === 1 && n.position === 1);
  decide(br, 1, 0, s1.player1_id);
  decide(br, 1, 1, s2.player1_id);
  decide(br, 2, 0, s1.player1_id);
  bonus.sync();
  assert.strictEqual(pts('blta', s1.player1_id), 15);
  assert.strictEqual(pts('tournaments', s1.player1_id), 15);
  assert.strictEqual(pts('novice_race', s1.player1_id), undefined, 'a tournament does not feed a race table');
  assert.strictEqual(pts('blta', s2.player1_id), 10);
  assert.strictEqual(pts('blta', s1.player2_id), 5);
  assert.strictEqual(db.prepare("SELECT kind FROM ranking_expiry WHERE kind = 'TOURNAMENT'").all().length, 4);
  // a club's tournament is not the league's
  const org = Number(db.prepare("INSERT INTO organisations (name, slug, type) VALUES ('Club X', 'club-x', 'CLUB')").run().lastInsertRowid);
  const clubSeason = season('Club Cup', 'TOURNAMENT');
  db.prepare('UPDATE seasons SET organisation_id = ? WHERE id = ?').run(org, clubSeason);
  const cids = ['Cl A', 'Cl B', 'Cl C', 'Cl D'].map(player);
  const cb = bracketOf(clubSeason, 'ELITE', cids, 'Club Elite');
  const ct = nodes(cb);
  decide(cb, 1, 0, ct.find((n) => n.round === 1 && n.position === 0).player1_id);
  decide(cb, 1, 1, ct.find((n) => n.round === 1 && n.position === 1).player1_id);
  decide(cb, 2, 0, ct.find((n) => n.round === 1 && n.position === 0).player1_id);
  bonus.sync();
  cids.forEach((id) => assert.strictEqual(pts('blta', id), undefined));
});

test('a deleted bracket takes its bonus back', async () => {
  const lg2 = season('Bonus League 2', 'LEAGUE');
  const ids = ['Dl A', 'Dl B', 'Dl C', 'Dl D'].map(player);
  const br = bracketOf(lg2, 'NEXT_GEN', ids, 'Next Gen Play-off');
  const tree = nodes(br);
  const w = tree.find((n) => n.round === 1 && n.position === 0).player1_id;
  decide(br, 1, 0, w);
  decide(br, 1, 1, tree.find((n) => n.round === 1 && n.position === 1).player1_id);
  decide(br, 2, 0, w);
  bonus.sync();
  assert.strictEqual(pts('blta', w), 70);
  db.prepare('DELETE FROM bracket_matches WHERE bracket_id = ?').run(br);
  db.prepare('DELETE FROM brackets WHERE id = ?').run(br);
  bonus.sync();
  assert.strictEqual(pts('blta', w), 0);
  assert.strictEqual(pts('next_gen_race', w), 0);
});

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file is still open on Windows */ }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
