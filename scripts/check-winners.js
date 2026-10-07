// Checks of the winners page backend (Backend > Winners, /vitazi): the API, the one-time seed and the menu item.
// Run: node scripts/check-winners.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winners-server-'));
const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winners-seed-'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

let child = null;
let adminCookie = '';
let fixtureDb = null;

async function call(method, url, { body, form, cookie = adminCookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* no body (a file, for instance) */ }
  return { status: res.status, json, res };
}

const fixtures = {
  insertPlayer(name, slug, photoUrl = null) {
    return Number(fixtureDb.prepare('INSERT INTO players (name, slug, photo_url) VALUES (?, ?, ?)').run(name, slug, photoUrl).lastInsertRowid);
  },
  insertSeason(name, slug) {
    return Number(fixtureDb.prepare('INSERT INTO seasons (name, slug) VALUES (?, ?)').run(name, slug).lastInsertRowid);
  },
  run(sql, ...args) { return fixtureDb.prepare(sql).run(...args); },
  all(sql, ...args) { return fixtureDb.prepare(sql).all(...args); },
  photoFiles() {
    const dir = path.join(serverDir, 'winner-photos');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  },
};

// the smallest valid PNG (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function photoForm(buffer, type, filename = 'p.png') {
  const form = new FormData();
  form.append('photo', new Blob([buffer], { type }), filename);
  return form;
}

async function newEdition(title) {
  const r = await call('POST', '/api/winners/editions', { body: { title } });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json;
}
async function newBlock(editionId, body = { category: 'ELITE' }) {
  const r = await call('POST', `/api/winners/editions/${editionId}/blocks`, { body });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json.blocks[r.json.blocks.length - 1];
}
const publicList = async () => (await call('GET', '/api/winners', { cookie: '' })).json;

// ---------------------------------------------------------------- editions
test('admin endpoints need a login', async () => {
  assert.strictEqual((await call('GET', '/api/winners/all', { cookie: '' })).status, 401);
  assert.strictEqual((await call('POST', '/api/winners/editions', { cookie: '', body: { title: 'x' } })).status, 401);
});

test('a new edition goes first', async () => {
  const a = await newEdition('Edition A');
  const b = await newEdition('Edition B');
  assert.ok(b.sortOrder < a.sortOrder);
  const all = (await call('GET', '/api/winners/all')).json;
  const ids = all.map((e) => e.id);
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
});

test('title validation', async () => {
  assert.strictEqual((await call('POST', '/api/winners/editions', { body: { title: '  ' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/winners/editions', { body: { title: 'x'.repeat(121) } })).status, 400);
});

test('a hidden edition is not public but is in /all', async () => {
  const e = await newEdition('Hidden one');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, name: 'Someone' }] } });
  assert.ok((await publicList()).some((x) => x.id === e.id));
  const patched = await call('PATCH', `/api/winners/editions/${e.id}`, { body: { visible: false } });
  assert.strictEqual(patched.status, 200);
  assert.ok(!(await publicList()).some((x) => x.id === e.id));
  assert.ok((await call('GET', '/api/winners/all')).json.some((x) => x.id === e.id && x.visible === false));
});

test('season link, and a deleted season reads as not linked', async () => {
  const seasonId = fixtures.insertSeason('Linked Season', 'linked-season');
  const e = await newEdition('With season');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, name: 'X' }] } });
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${e.id}`, { body: { seasonId } })).status, 200);
  assert.strictEqual((await publicList()).find((x) => x.id === e.id).seasonSlug, 'linked-season');
  fixtures.run('DELETE FROM seasons WHERE id = ?', seasonId);
  assert.strictEqual((await publicList()).find((x) => x.id === e.id).seasonSlug, null);
  assert.strictEqual((await call('PATCH', `/api/winners/editions/${e.id}`, { body: { seasonId: 999999 } })).status, 400);
});

test('deleting an edition deletes its blocks and places', async () => {
  const e = await newEdition('To delete');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, name: 'Gone' }] } });
  const del = await call('DELETE', `/api/winners/editions/${e.id}`);
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(del.json, { ok: true });
  assert.strictEqual((await call('DELETE', `/api/winners/editions/${e.id}`)).status, 404);
  assert.strictEqual(fixtures.all('SELECT id FROM winner_blocks WHERE edition_id = ?', e.id).length, 0);
  assert.strictEqual(fixtures.all('SELECT id FROM winner_places WHERE block_id = ?', b.id).length, 0);
});

// ---------------------------------------------------------------- blocks and places
test('a block without a category needs a title', async () => {
  const e = await newEdition('Blocks');
  const bad = await call('POST', `/api/winners/editions/${e.id}/blocks`, { body: { category: null, title: '' } });
  assert.strictEqual(bad.status, 400);
  const ok = await call('POST', `/api/winners/editions/${e.id}/blocks`, { body: { title: 'Konečné poradie' } });
  assert.strictEqual(ok.status, 201);
  const badCat = await call('POST', `/api/winners/editions/${e.id}/blocks`, { body: { category: 'PRO' } });
  assert.strictEqual(badCat.status, 400);
});

test('put places: four slots, resolved from the players, sorted by slot', async () => {
  const p1 = fixtures.insertPlayer('Róbert Sloboda', 'sloboda');
  const p2 = fixtures.insertPlayer('Pavol Piroha', 'piroha');
  const e = await newEdition('Places');
  const b = await newBlock(e.id);
  const r = await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [
    { slot: 2, playerId: p2 }, { slot: 1, playerId: p1 }, { slot: 3, name: 'Typed Semi' }, { slot: 4, name: 'Other Semi' },
  ] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const pub = (await publicList()).find((x) => x.id === e.id);
  const places = pub.blocks[0].places;
  assert.deepStrictEqual(places.map((p) => p.slot), [1, 2, 3, 4]);
  assert.strictEqual(places[0].name, 'Róbert Sloboda');
  assert.strictEqual(places[0].playerId, p1);
  assert.strictEqual(places[0].playerSlug, 'sloboda');
  assert.strictEqual(places[2].name, 'Typed Semi');
  assert.strictEqual(places[2].playerId, null);
  assert.strictEqual(places[2].playerSlug, null);
});

test('put places replaces: slots not listed are removed', async () => {
  const e = await newEdition('Replace');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [
    { slot: 1, name: 'A' }, { slot: 2, name: 'B' }, { slot: 3, name: 'C' }, { slot: 4, name: 'D' },
  ] } });
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, name: 'A2' }, { slot: 2, name: '' }] } });
  const places = (await publicList()).find((x) => x.id === e.id).blocks[0].places;
  assert.deepStrictEqual(places.map((p) => [p.slot, p.name]), [[1, 'A2']]);
});

test('put places validation', async () => {
  const e = await newEdition('Validation');
  const b = await newBlock(e.id);
  const put = (places) => call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places } });
  assert.strictEqual((await put([{ slot: 5, name: 'x' }])).status, 400);
  assert.strictEqual((await put([{ slot: 1, name: 'x' }, { slot: 1, name: 'y' }])).status, 400);
  assert.strictEqual((await put([{ slot: 1, playerId: 999999 }])).status, 400);
  assert.strictEqual((await put([{ slot: 1, name: 'x'.repeat(121) }])).status, 400);
  assert.strictEqual((await call('PUT', '/api/winners/blocks/999999/places', { body: { places: [] } })).status, 404);
});

test('dangling player: the stored name is shown, no crash', async () => {
  const pid = fixtures.insertPlayer('Soon Deleted', 'soon-deleted');
  const e = await newEdition('Dangling');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, playerId: pid }] } });
  fixtures.run('DELETE FROM players WHERE id = ?', pid);
  const r = await call('GET', '/api/winners', { cookie: '' });
  assert.strictEqual(r.status, 200);
  const place = r.json.find((x) => x.id === e.id).blocks[0].places[0];
  assert.strictEqual(place.name, 'Soon Deleted');
  assert.strictEqual(place.playerId, null);
});

test('a block with no places is hidden publicly but kept for the admin', async () => {
  const e = await newEdition('Empty block');
  const b = await newBlock(e.id);
  assert.ok(!(await publicList()).some((x) => x.id === e.id)); // nothing to show at all
  const all = (await call('GET', '/api/winners/all')).json.find((x) => x.id === e.id);
  assert.strictEqual(all.blocks.length, 1);
  assert.strictEqual(all.blocks[0].id, b.id);
  const full = await newBlock(e.id, { category: 'NOVICE' });
  await call('PUT', `/api/winners/blocks/${full.id}/places`, { body: { places: [{ slot: 1, name: 'W' }] } });
  const pub = (await publicList()).find((x) => x.id === e.id);
  assert.deepStrictEqual(pub.blocks.map((x) => x.id), [full.id]);
});

test('photo fallback order: own photo, then profile photo, then none', async () => {
  const pid = fixtures.insertPlayer('Has Photo', 'has-photo', '/player-photos/profile.jpg');
  const e = await newEdition('Photo order');
  const b = await newBlock(e.id);
  await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, playerId: pid }, { slot: 2, name: 'No Photo' }] } });
  let places = (await publicList()).find((x) => x.id === e.id).blocks[0].places;
  assert.strictEqual(places[0].photoUrl, '/player-photos/profile.jpg');
  assert.strictEqual(places[1].photoUrl, null);
  fixtures.run("UPDATE winner_places SET photo_url = '/winner-photos/own.jpg' WHERE block_id = ? AND slot = 1", b.id);
  places = (await publicList()).find((x) => x.id === e.id).blocks[0].places;
  assert.strictEqual(places[0].photoUrl, '/winner-photos/own.jpg');
});

test('block order, patch and delete', async () => {
  const e = await newEdition('Block ops');
  const first = await newBlock(e.id, { category: 'ELITE' });
  const second = await newBlock(e.id, { category: 'NEXT_GEN' });
  assert.ok(second.sortOrder > first.sortOrder);
  const patched = await call('PATCH', `/api/winners/blocks/${first.id}`, { body: { category: 'NOVICE' } });
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.json.blocks.find((x) => x.id === first.id).category, 'NOVICE');
  await call('PUT', `/api/winners/blocks/${first.id}/places`, { body: { places: [{ slot: 1, name: 'Z' }] } });
  assert.strictEqual((await call('DELETE', `/api/winners/blocks/${first.id}`)).status, 200);
  assert.strictEqual(fixtures.all('SELECT id FROM winner_places WHERE block_id = ?', first.id).length, 0);
  assert.strictEqual((await call('DELETE', `/api/winners/blocks/${first.id}`)).status, 404);
});

// ---------------------------------------------------------------- photos
async function placeWithRow(label) {
  const e = await newEdition(label);
  const b = await newBlock(e.id);
  const r = await call('PUT', `/api/winners/blocks/${b.id}/places`, { body: { places: [{ slot: 1, name: 'Photo Person' }] } });
  return { edition: e, block: b, place: r.json.blocks.find((x) => x.id === b.id).places[0] };
}

test('upload sets the photo and the file is served', async () => {
  const { place } = await placeWithRow('Upload');
  const r = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const url = r.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  assert.ok(url.startsWith('/winner-photos/'));
  assert.ok(fixtures.photoFiles().includes(path.basename(url)));
  const served = await fetch(BASE + url);
  assert.strictEqual(served.status, 200);
});

test('a second upload replaces the first and deletes the old file', async () => {
  const { place } = await placeWithRow('Replace photo');
  const first = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  const oldUrl = first.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  const second = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  const newUrl = second.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  assert.notStrictEqual(oldUrl, newUrl);
  assert.ok(!fixtures.photoFiles().includes(path.basename(oldUrl)));
  assert.ok(fixtures.photoFiles().includes(path.basename(newUrl)));
});

test('a wrong file type is refused and nothing is written', async () => {
  const { place } = await placeWithRow('Wrong type');
  const before = fixtures.photoFiles().length;
  const r = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(Buffer.from('hello'), 'text/plain', 'a.txt') });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(fixtures.photoFiles().length, before);
});

test('a file over 6 MB is refused and nothing is written', async () => {
  const { place } = await placeWithRow('Too big');
  const before = fixtures.photoFiles().length;
  const r = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(Buffer.alloc(6 * 1024 * 1024 + 1), 'image/png') });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(fixtures.photoFiles().length, before);
});

test('removing the photo deletes the file', async () => {
  const { place } = await placeWithRow('Remove photo');
  const up = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  const url = up.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  const del = await call('DELETE', `/api/winners/places/${place.placeId}/photo`);
  assert.strictEqual(del.status, 200);
  assert.ok(!fixtures.photoFiles().includes(path.basename(url)));
  assert.strictEqual(del.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl, null);
});

test('removing a slot through PUT deletes its photo file', async () => {
  const { block, place } = await placeWithRow('Slot photo');
  const up = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  const url = up.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  await call('PUT', `/api/winners/blocks/${block.id}/places`, { body: { places: [] } });
  assert.ok(!fixtures.photoFiles().includes(path.basename(url)));
});

test('deleting an edition deletes its photo files', async () => {
  const { edition, place } = await placeWithRow('Edition photo');
  const up = await call('POST', `/api/winners/places/${place.placeId}/photo`, { form: photoForm(PNG, 'image/png') });
  const url = up.json.blocks.flatMap((b) => b.places).find((p) => p.placeId === place.placeId).own.photoUrl;
  assert.ok(fixtures.photoFiles().includes(path.basename(url)));
  await call('DELETE', `/api/winners/editions/${edition.id}`);
  assert.ok(!fixtures.photoFiles().includes(path.basename(url)));
});

test('uploading needs an admin login', async () => {
  const { place } = await placeWithRow('Photo auth');
  const r = await call('POST', `/api/winners/places/${place.placeId}/photo`, { cookie: '', form: photoForm(PNG, 'image/png') });
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------- seed and menu item (in this process, its own data dir)
let seedDb = null;
let seed = null;
let seasonSeed = null;
function loadSeedModules() {
  if (seedDb) return;
  process.env.DATA_DIR = seedDir;
  seedDb = require('../src/db');
  seed = require('../src/winnersSeed');
  seasonSeed = require('../src/seasonSeed');
}
const seedCount = (table) => seedDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function resetSeed() {
  loadSeedModules();
  seedDb.exec('DELETE FROM winner_places; DELETE FROM winner_blocks; DELETE FROM winner_editions; DELETE FROM players; DELETE FROM seasons');
  seedDb.prepare("DELETE FROM app_flags WHERE key = 'winners_seeded'").run();
}

test('seed inserts 2 editions, 4 blocks and 16 places', async () => {
  resetSeed();
  assert.deepStrictEqual(seed.seedWinners(seedDb), { editions: 2 });
  assert.strictEqual(seedCount('winner_editions'), 2);
  assert.strictEqual(seedCount('winner_blocks'), 4);
  assert.strictEqual(seedCount('winner_places'), 16);
  const order = seedDb.prepare('SELECT title FROM winner_editions ORDER BY sort_order').all().map((r) => r.title);
  assert.deepStrictEqual(order, ['BLTA Winter Series 2026', 'BLTA nultý ročník 2025']);
});

test('seed matches players regardless of case and diacritics, keeps unmatched names as typed', async () => {
  resetSeed();
  const id = Number(seedDb.prepare("INSERT INTO players (name, slug) VALUES ('RÓBERT SLOBODA', 'sloboda')").run().lastInsertRowid);
  seed.seedWinners(seedDb);
  const elite = seedDb.prepare("SELECT p.player_id, p.name FROM winner_places p JOIN winner_blocks b ON b.id = p.block_id JOIN winner_editions e ON e.id = b.edition_id WHERE e.title = 'BLTA Winter Series 2026' AND b.category = 'ELITE' AND p.slot = 1").get();
  assert.strictEqual(elite.player_id, id);
  const beno = seedDb.prepare("SELECT player_id, name FROM winner_places WHERE name = 'Ján Beňo'").get();
  assert.strictEqual(beno.player_id, null);
});

test('seed runs only once, even after the data was deleted', async () => {
  resetSeed();
  seed.seedWinners(seedDb);
  assert.deepStrictEqual(seed.seedWinners(seedDb), { skipped: true });
  seedDb.exec('DELETE FROM winner_places; DELETE FROM winner_blocks; DELETE FROM winner_editions');
  assert.deepStrictEqual(seed.seedWinners(seedDb), { skipped: true });
  assert.strictEqual(seedCount('winner_editions'), 0);
});

test('seed links a season only on an exact name', async () => {
  resetSeed();
  const sid = Number(seedDb.prepare("INSERT INTO seasons (name, slug) VALUES ('BLTA Winter Series 2026', 'winter-series-2026')").run().lastInsertRowid);
  seedDb.prepare("INSERT INTO seasons (name, slug) VALUES ('Winter Opening Series 2026', 'winter-opening-2026')").run();
  seed.seedWinners(seedDb);
  const rows = seedDb.prepare('SELECT title, season_id FROM winner_editions').all();
  assert.strictEqual(rows.find((r) => r.title === 'BLTA Winter Series 2026').season_id, sid);
  assert.strictEqual(rows.find((r) => r.title === 'BLTA nultý ročník 2025').season_id, null);
});

test('the menu item goes right after Harmonogram, once', async () => {
  loadSeedModules();
  seedDb.exec('DELETE FROM header_items');
  seedDb.prepare("DELETE FROM app_flags WHERE key = 'menu_winners_added'").run();
  const add = (label, link, sort) => seedDb.prepare('INSERT INTO header_items (parent_id, label_sk, label_en, link, sort_order) VALUES (NULL, ?, ?, ?, ?)').run(label, label, link, sort);
  add('Tabuľky', '/tables', 0); add('Harmonogram', '/harmonogram', 1); add('Propozície', '/propozicie', 2);
  seasonSeed.ensureWinnersMenuItem(seedDb);
  seasonSeed.ensureWinnersMenuItem(seedDb);
  const links = seedDb.prepare('SELECT link FROM header_items WHERE parent_id IS NULL ORDER BY sort_order').all().map((r) => r.link);
  assert.deepStrictEqual(links, ['/tables', '/harmonogram', '/vitazi', '/propozicie']);
});

// ---------------------------------------------------------------- run
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(adminCookie, 'admin login gave no cookie');
  fixtureDb = new DatabaseSync(path.join(serverDir, 'blta-score.db'));
  fixtureDb.exec('PRAGMA busy_timeout = 5000');
}

async function main() {
  let failed = 0;
  try {
    await startServer();
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    try { if (fixtureDb) fixtureDb.close(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
    try { if (seedDb) seedDb.close(); } catch { /* ignore */ }
    fs.rmSync(seedDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
