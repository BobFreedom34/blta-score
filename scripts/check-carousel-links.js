// Check of the links of the home page carousel (src/routes/carousel.js, public/js/home-carousel.js): a slide that links to a page of the site by an
// OLD address of it (score.blta.sk, which no longer exists) is stored and shown as the plain path of the page, so the link works on blta.sk and under
// slta.sk/<city>. Slides already saved that way are corrected when the server starts; other addresses are left alone.
// Run: node scripts/check-carousel-links.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carousel-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
let child = null;

const start = () => new Promise((resolve, reject) => {
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
  for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'REDIRECT_HOSTS') delete env[k];
  const c = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => reject(new Error('the server did not start')), 60000);
  c.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(timer); resolve(c); } });
});
const stop = async () => { if (child) { child.kill(); await new Promise((r) => setTimeout(r, 1200)); child = null; } };

async function main() {
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${err.message}`); } };
  try {
    child = await start();
    await stop();
    // slides as they are on the live site: links by the old address, one by another site, one without a link
    const db = new DatabaseSync(path.join(dir, 'blta-score.db'));
    const add = db.prepare("INSERT INTO carousel_slides (image_url, caption_sk, link, sort_order, active) VALUES ('/carousel-images/x.png', ?, ?, ?, 1)");
    [['match', 'https://score.blta.sk/match/41c7ec0b-8672-4c6c-91e9-5b06b1d8e126', 1], ['season', 'https://score.blta.sk/sezona/autumn-finals-series-2026', 2],
      ['rankings', 'https://score.blta.sk/rankings', 3], ['elsewhere', 'https://example.com/page', 4], ['none', '', 5], ['query', 'https://score.blta.sk/matches?status=LIVE#top', 6]]
      .forEach(([cap, link, n]) => add.run(cap, link, n));
    db.close();

    child = await start();
    await test('slides saved with the old address get the plain path when the server starts; other addresses stay', async () => {
      const slides = await (await fetch(`${base}/api/carousel`)).json();
      const link = (cap) => slides.find((s) => s.captionSk === cap).link;
      assert.strictEqual(link('match'), '/match/41c7ec0b-8672-4c6c-91e9-5b06b1d8e126');
      assert.strictEqual(link('season'), '/sezona/autumn-finals-series-2026');
      assert.strictEqual(link('rankings'), '/rankings');
      assert.strictEqual(link('query'), '/matches?status=LIVE#top');
      assert.strictEqual(link('elsewhere'), 'https://example.com/page');
      assert.strictEqual(link('none'), '');
    });

    await test('a link typed with the old address in the Backend is saved as the path', async () => {
      const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
      const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const slides = await (await fetch(`${base}/api/carousel`)).json();
      const id = slides.find((s) => s.captionSk === 'none').id;
      const r = await fetch(`${base}/api/carousel/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ link: 'https://score.blta.sk/harmonogram' }) });
      const saved = await r.json();
      assert.strictEqual(r.status, 200, JSON.stringify(saved));
      assert.strictEqual(saved.link, '/harmonogram');
      const bad = await fetch(`${base}/api/carousel/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ link: 'javascript:alert(1)' }) });
      assert.strictEqual(bad.status, 400, 'anything but / or https:// is still refused');
    });

    await test('the page script shows the same: an old address in a slide leads to the path', async () => {
      const js = fs.readFileSync(path.join(ROOT, 'public/js/home-carousel.js'), 'utf8');
      assert.ok(js.includes('score.blta.sk') && js.includes('function linkOf') && js.includes('const link = linkOf(s.link)'));
    });
  } finally {
    await stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the database file may still be held for a moment on Windows */ }
  }
  console.log(failed ? `\n${failed} failed` : '\nall 3 passed');
  process.exit(failed ? 1 : 0);
}
main();
