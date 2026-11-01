// Checks of the "address not found" answers and the accessibility pieces that are in the files: the 404 page (Slovak and English, with the way back, noindex),
// the JSON 404 of the API, and the static parts of the accessibility work (logo size, texts of the skip link and of the code boxes).
// Run: node scripts/check-not-found.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-server-'));
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
let child = null;

const get = async (url, options = {}) => {
  const res = await fetch(BASE + url, { redirect: 'manual', ...options });
  return { status: res.status, text: await res.text(), headers: res.headers };
};

test('an unknown page address shows the 404 page, in Slovak, with the way back and noindex', async () => {
  const r = await get('/this-page-does-not-exist');
  assert.strictEqual(r.status, 404);
  assert.ok(/^text\/html/.test(r.headers.get('content-type')));
  assert.ok(/<html lang="sk">/.test(r.text));
  assert.ok(/Táto stránka neexistuje/.test(r.text));
  assert.ok(/<meta name="robots" content="noindex">/.test(r.text));
  assert.ok(/<h1>404<\/h1>/.test(r.text));
  assert.ok(/href="\/zapasy"|href="\/matches"/.test(r.text), 'no link to the matches');
  assert.ok(!/Cannot GET/.test(r.text));
});

test('under /en/ the 404 page is English and links to the English pages', async () => {
  const r = await get('/en/nothing-here');
  assert.strictEqual(r.status, 404);
  assert.ok(/<html lang="en">/.test(r.text));
  assert.ok(/This page does not exist/.test(r.text));
  assert.ok(/href="\/en\/[a-z-]+"/.test(r.text), 'no English link');
});

test('an unknown API address answers in JSON, and so does a wrong method on a page address', async () => {
  const a = await get('/api/no-such-thing');
  assert.strictEqual(a.status, 404);
  assert.deepStrictEqual(JSON.parse(a.text), { error: 'Not found' });
  const p = await get('/no-such-page', { method: 'POST' });
  assert.strictEqual(p.status, 404);
  assert.deepStrictEqual(JSON.parse(p.text), { error: 'Not found' });
});

test('real pages, files and the health check are not caught by it', async () => {
  assert.strictEqual((await get('/')).status, 200);
  assert.strictEqual((await get('/healthz')).status, 200);
  assert.strictEqual((await get('/css/style.css')).status, 200);
  assert.strictEqual((await get('/api/seasons')).status, 200);
  assert.strictEqual((await get('/embed/live')).status, 200);
  assert.strictEqual((await get('/socket.io/socket.io.min.js')).status, 200);
});

test('the top-bar logo of every page has its size in the file (no jump while it loads)', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  let seen = 0;
  pages.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    (html.match(/<img[^>]*class="brand-logo"[^>]*>/g) || []).forEach((tag) => { seen += 1; assert.ok(/width="\d+" height="\d+"/.test(tag), `${f}: ${tag}`); });
  });
  assert.ok(seen >= 40, `only ${seen} logos found`);
});

test('the skip link and the code boxes have their texts in both languages', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  ['a11y.skip', 'a11y.digit'].forEach((key) => assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} must be in both languages`));
  const common = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  assert.ok(common.includes("t('a11y.skip')") && common.includes("t('a11y.digit'"));
});

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
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
