// Check of entering a bracket result from the front end (public/js/bracket-result.js): the admin button is for an admin only, the result moves the winner on.
// Run: node scripts/check-bracket-result-ui.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brres-'));
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

test('a visitor cannot enter a bracket result; an admin can, and the winner moves on', async () => {
  const ids = [];
  for (const n of ['Ana Alfa', 'Boris Beta', 'Cyril Gama', 'Dana Delta']) ids.push((await call('POST', '/api/players', { body: { name: n } })).json.id);
  const made = await call('POST', '/api/brackets', { body: { name: 'Manual path', format: 'BO3', autoCreateMatches: false, entries: ids.map((id, i) => ({ playerId: id, seed: i + 1 })) } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const bracket = (await call('GET', '/api/brackets/' + made.json.id, { cookie: '' })).json;
  const node = bracket.nodes.find((n) => n.round === 1 && n.player1 && n.player2);
  const url = '/api/brackets/' + bracket.id + '/nodes/' + node.id + '/result';
  assert.strictEqual((await call('PATCH', url, { cookie: '', body: { winnerId: node.player1.id, score: '6-2, 6-4' } })).status, 401, 'a visitor is refused');
  const done = await call('PATCH', url, { body: { winnerId: node.player1.id, score: '6-2, 6-4' } });
  assert.strictEqual(done.status, 200, JSON.stringify(done.json));
  const after = (await call('GET', '/api/brackets/' + bracket.id, { cookie: '' })).json;
  const finalNode = after.nodes.find((n) => n.round === 2);
  assert.ok([finalNode.player1, finalNode.player2].some((p) => p && p.id === node.player1.id), 'the winner is in the final');
});

test('the drawn brackets carry the hooks of the admin button, and only an admin gets it', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  const view = read('js/bracket-view.js');
  assert.ok(view.includes('BRACKET_BOARDS') && view.includes('data-bracket-id') && view.includes('data-node-id'));
  const js = read('js/bracket-result.js');
  assert.ok(js.includes('checkAdmin()') && js.includes('if (!admin) return;'), 'nothing is added for a visitor');
  assert.ok(js.includes('/nodes/') && js.includes('manual-result'), 'both ways of entering a result');
  ['season.html', 'bracket.html', 'tables.html'].forEach((f) => assert.ok(read(f).includes('/js/bracket-result.js'), f));
  assert.ok(!read('embed-bracket.html').includes('bracket-result.js'), 'not in the embed');
  const i18n = read('js/i18n.js');
  ['bracket.addResult', 'bracket.editResult', 'bracket.setsHint'].forEach((k) => assert.strictEqual(i18n.split(`'${k}'`).length, 3, `${k} in both languages`));
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
