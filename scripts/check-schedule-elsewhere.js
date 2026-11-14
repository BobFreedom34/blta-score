// Checks of the tournaments of the other cities on the Harmonogram (GET /api/schedule/elsewhere): only the tournaments that are still to be played, of the cities that are not
// hidden, never the ones of this city and never the ones of a club; each with its city and a real address; the page draws them under the ones of this city.
// Run: node scripts/check-schedule-elsewhere.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
let child = null;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const get = async (url) => { const r = await fetch(base + url); return { status: r.status, json: await r.json().catch(() => null) }; };

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test('setup: Košice (with a tournament to come, a finished one and a tournament of a club), Trnava hidden, a tournament of Bratislava', async () => {
  const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
  const city = db.prepare("INSERT INTO leagues (slug, name, brand_name, domain, status, name_locative, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const kosice = Number(city.run('kosice', 'Košice', 'SLTA Košice', '', 'ACTIVE', 'v Košiciach', 2).lastInsertRowid);
  const trnava = Number(city.run('trnava', 'Trnava', 'SLTA Trnava', '', 'HIDDEN', 'v Trnave', 3).lastInsertRowid);
  const nitra = Number(city.run('nitra', 'Nitra', 'SLTA Nitra', 'nitra.example', 'PREPARING', 'v Nitre', 4).lastInsertRowid);
  const season = db.prepare("INSERT INTO seasons (name, slug, kind, start_date, end_date, league_id, categories, organisation_id) VALUES (?, ?, 'TOURNAMENT', ?, ?, ?, 'ELITE,NEXT_GEN', ?)");
  season.run('Košice Cup', 'kosice-cup', day(10), day(11), kosice, null);
  season.run('Staré Košice', 'stare-kosice', day(-60), day(-59), kosice, null);
  season.run('Trnava Cup', 'trnava-cup', day(12), day(13), trnava, null);
  season.run('Nitra Open', 'nitra-open', day(40), day(41), nitra, null);
  season.run('Bratislava Cup', 'bratislava-cup', day(5), day(6), 1, null);
  const org = Number(db.prepare("INSERT INTO organisations (name, slug, type) VALUES ('Club K', 'club-k', 'CLUB')").run().lastInsertRowid);
  season.run('Klubový turnaj', 'klubovy', day(20), day(21), kosice, org);
  db.prepare("INSERT INTO schedule_events (name, start_date, end_date, venue, link, categories, league_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run('Letný turnaj Košice', day(30), day(31), 'Kurty', 'https://example.com/letny', 'ELITE', kosice);
  db.close();
});

test('only the tournaments of the other cities that are still to be played, soonest first, each with its city', async () => {
  const r = await get('/api/schedule/elsewhere');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.items.map((e) => e.name), ['Košice Cup', 'Letný turnaj Košice', 'Nitra Open']);
  assert.deepStrictEqual(r.json.items.map((e) => e.city.slug), ['kosice', 'kosice', 'nitra']);
  assert.strictEqual(r.json.items[0].city.brandName, 'SLTA Košice');
  assert.deepStrictEqual(r.json.city, { name: 'Bratislava', nameLocative: 'v Bratislave' });
});

test('the addresses are real: the city\'s own domain, else the national site; an outside link stays; English has its own address', async () => {
  const sk = (await get('/api/schedule/elsewhere')).json.items;
  const nitra = sk.find((e) => e.name === 'Nitra Open');
  assert.ok(nitra.link.startsWith('https://nitra.example/'), nitra.link);
  assert.ok(/tournament\/nitra-open|turnaj\/nitra-open/.test(nitra.link), nitra.link);
  assert.strictEqual(sk.find((e) => e.name === 'Letný turnaj Košice').link, 'https://example.com/letny');
  const koSk = sk.find((e) => e.name === 'Košice Cup').link;
  assert.ok(/kosice/.test(koSk), koSk);
  const en = (await get('/api/schedule/elsewhere?lang=en')).json.items.find((e) => e.name === 'Nitra Open').link;
  assert.notStrictEqual(en, nitra.link, 'the English page has its own address');
});

test('the page draws the section under the tournaments of this city, with the city tag and the words in both languages', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'harmonogram.js'), 'utf8');
  for (const piece of ['/schedule/elsewhere', 'schedule.elsewhereTitle', 'schedule.hereTitle', 'cityName', 'data-city', "type === 'LEAGUE' ? []"]) assert.ok(js.includes(piece), piece);
  const row = fs.readFileSync(path.join(ROOT, 'public', 'js', 'schedule-row.js'), 'utf8');
  assert.ok(row.includes('sch-city'));
  const i18n = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8');
  for (const key of ['schedule.allCities', 'schedule.hereTitle', 'schedule.hereTitleNoCity', 'schedule.emptyHere', 'schedule.elsewhereTitle', 'schedule.elsewhereHint']) assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
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
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.stack).split('\n').slice(0, 6).join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open on Windows */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
