// Checks of the welcome e-mail (Backend > Menu > "Welcome e-mail", /api/welcome-email, src/welcomeEmail.js): built-in texts, editing, the placeholders,
// who may edit, and that registering a player does not fail whether or not the mail server is set up.
// Run: node scripts/check-welcome-email.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-check-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let cookie = '';

async function call(method, url, body, withCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

test('only the super admin can read or change it', async () => {
  assert.strictEqual((await call('GET', '/api/welcome-email', undefined, false)).status, 401);
  assert.strictEqual((await call('PUT', '/api/welcome-email', {}, false)).status, 401);
  assert.strictEqual((await call('POST', '/api/welcome-email/test', { to: 'a@b.sk' }, false)).status, 401);
});

test('nothing saved: the built-in texts in both languages, switched on', async () => {
  const r = await call('GET', '/api/welcome-email');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.enabled, true);
  assert.ok(r.json.sk.subject.includes('{name}') && r.json.sk.body.includes('{link}'));
  assert.ok(r.json.en.body.includes('Register') && r.json.sk.body.includes('Registrácia'));
});

test('an edited text is kept, an emptied one goes back to the built-in one, a too long one is refused', async () => {
  const saved = await call('PUT', '/api/welcome-email', { enabled: true, sk: { subject: 'Ahoj {name}', body: 'Vitaj\r\n{name}\n{link}' }, en: { subject: '', body: '' } });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.json.sk.subject, 'Ahoj {name}');
  assert.strictEqual(saved.json.sk.body, 'Vitaj\n{name}\n{link}');
  assert.strictEqual(saved.json.en.subject, saved.json.defaults.en.subject);
  assert.strictEqual((await call('PUT', '/api/welcome-email', { sk: { subject: 'x'.repeat(151), body: '' } })).status, 400);
  assert.strictEqual((await call('PUT', '/api/welcome-email', { sk: { subject: '', body: 'x'.repeat(6001) } })).status, 400);
});

test('the placeholders are filled in and the HTML version is escaped', () => {
  const welcome = require('../src/welcomeEmail');
  const mail = welcome.render('en', { name: '<b>Jo</b>', link: 'https://x.sk/player/jo' });
  assert.ok(mail.text.includes('<b>Jo</b>') && mail.text.includes('https://x.sk/player/jo'));
  assert.ok(!mail.html.includes('<b>Jo</b>') && mail.html.includes('&lt;b&gt;Jo&lt;/b&gt;'));
  assert.ok(mail.html.includes('<a href="https://x.sk/player/jo"'));
  assert.ok(!/\{(name|link)\}/.test(mail.text), 'no placeholder is left');
});

test('a link typed as [text](address) works inside a numbered step and a plain line, with or without a space after ]', () => {
  const welcome = require('../src/welcomeEmail');
  const body = 'Hi {name}\n\n5. The next season starts 7.1.2027 - [Winter Opening Series] (https://blta.sk/sezona/winter-opening-series-2027)\nAlso [here](https://blta.sk/x?a=1&b=2) and https://blta.sk/y now\n\nBye';
  const html = welcome.render('en', { name: 'Jo', link: 'https://x.sk/player/jo' }, body).html;
  assert.ok(html.includes('<a href="https://blta.sk/sezona/winter-opening-series-2027" style="color:#b2fa06;font-weight:700">Winter Opening Series</a>'), 'the link of the step');
  assert.ok(html.includes('<a href="https://blta.sk/x?a=1&amp;b=2"') && html.includes('>here</a>'), 'the link of a plain line (the & is escaped)');
  assert.ok(html.includes('<a href="https://blta.sk/y"'), 'a bare address is still a link');
  assert.ok(!html.includes('](') && !html.includes('[Winter'), 'no raw markup is left');
});

test('registering a new player works with the welcome e-mail on and off (no mail server here)', async () => {
  const reg = (n, phone) => call('POST', '/api/player/register', { name: n, phone, email: `${phone}@example.com`, tennisLevel: 'NOVICE', lang: 'en' }, false);
  assert.strictEqual((await reg('Welcome One', '0903000001')).status, 201);
  await call('PUT', '/api/welcome-email', { enabled: false });
  assert.strictEqual((await call('GET', '/api/welcome-email')).json.enabled, false);
  assert.strictEqual((await reg('Welcome Two', '0903000002')).status, 201);
});

test('the test button needs a valid address and says so when there is no mail server', async () => {
  assert.strictEqual((await call('POST', '/api/welcome-email/test', { to: 'nope' })).status, 400);
  assert.strictEqual((await call('POST', '/api/welcome-email/test', { to: 'me@example.com' })).status, 503);
});

test('the editor card is on the E-mails page (Backend > E-mails)', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'emails-admin.js'), 'utf8');
  assert.ok(js.includes('welcome-card') && js.includes("'/welcome-email'"));
});

async function main() {
  let failed = 0;
  try {
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
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
    cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    process.env.DATA_DIR = dataDir; // the render test reads the same data folder as the server
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').join('\n      ')}`); }
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  setup\n      ${err.message}`);
  } finally {
    if (child) child.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* the check itself holds the database file open */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
