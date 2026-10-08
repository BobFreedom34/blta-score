// Checks of REDIRECT_HOSTS (server.js): an old address sends page requests on to PUBLIC_URL (301, same path and query); the API, the
// sockets and /healthz keep answering there; other hosts and POST requests are left alone; without the setting nothing redirects.
// Run: node scripts/check-redirect.js   (starts its own servers on temporary data directories; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const children = [];
const dirs = [];

async function start(env) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redirect-'));
  dirs.push(dir);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 30000);
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
  });
  return port;
}

// a request with a chosen Host header (fetch will not let it be set)
function request(port, { method = 'GET', url = '/', host }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null }));
    });
    req.on('error', reject);
    req.end();
  });
}

let withRedirect;
let without;

test('an old address redirects pages to PUBLIC_URL with the same path and query (301)', async () => {
  withRedirect = await start({ PUBLIC_URL: 'https://blta.sk', REDIRECT_HOSTS: 'score.blta.sk, BLTA-score.onrender.com' });
  const a = await request(withRedirect, { url: '/rebricek?x=1&y=2', host: 'score.blta.sk' });
  assert.deepStrictEqual([a.status, a.location], [301, 'https://blta.sk/rebricek?x=1&y=2']);
  const b = await request(withRedirect, { url: '/', host: 'score.blta.sk:443' });
  assert.deepStrictEqual([b.status, b.location], [301, 'https://blta.sk/']);
  const c = await request(withRedirect, { url: '/en/rankings', host: 'blta-score.onrender.com' });
  assert.deepStrictEqual([c.status, c.location], [301, 'https://blta.sk/en/rankings'], 'the list is trimmed and case does not matter');
  const d = await request(withRedirect, { url: '/css/style.css', host: 'score.blta.sk' });
  assert.strictEqual(d.status, 301);
  assert.strictEqual((await request(withRedirect, { method: 'HEAD', url: '/matches', host: 'score.blta.sk' })).status, 301);
});

test('the API, the sockets and /healthz keep answering on the old address', async () => {
  assert.strictEqual((await request(withRedirect, { url: '/api/rankings', host: 'score.blta.sk' })).status, 200);
  assert.strictEqual((await request(withRedirect, { url: '/socket.io/?EIO=4&transport=polling', host: 'score.blta.sk' })).status, 200);
  const health = await request(withRedirect, { url: '/healthz', host: 'score.blta.sk' });
  assert.strictEqual(health.status, 200);
});

test('the new address and any host that is not listed are served as usual; POST is never redirected', async () => {
  assert.strictEqual((await request(withRedirect, { url: '/', host: 'blta.sk' })).status, 200);
  assert.strictEqual((await request(withRedirect, { url: '/', host: 'localhost:3000' })).status, 200);
  assert.strictEqual((await request(withRedirect, { url: '/rankings', host: '127.0.0.1' })).status, 200);
  const post = await request(withRedirect, { method: 'POST', url: '/api/admin/login', host: 'score.blta.sk' });
  assert.notStrictEqual(post.status, 301);
});

test('without REDIRECT_HOSTS (or without PUBLIC_URL) nothing redirects', async () => {
  without = await start({ PUBLIC_URL: 'https://blta.sk', REDIRECT_HOSTS: '' });
  assert.strictEqual((await request(without, { url: '/', host: 'score.blta.sk' })).status, 200);
  const noUrl = await start({ PUBLIC_URL: '', REDIRECT_HOSTS: 'score.blta.sk' });
  assert.strictEqual((await request(noUrl, { url: '/', host: 'score.blta.sk' })).status, 200);
});

async function main() {
  let failed = 0;
  try {
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } finally {
    children.forEach((c) => c.kill());
    await new Promise((r) => setTimeout(r, 400));
    dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
