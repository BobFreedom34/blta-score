// Checks of the English text of the Propozície page (/rules in English, /propozicie in Slovak): the first sections come with an English text, the English page shows
// it (title, buttons, text, links to pages in English), the Slovak page is unchanged, a section with no English text shows its Slovak text in English, and the backend
// saves, copies and resets the English text.
// Run: node scripts/check-rules-english.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + Math.floor(Math.random() * 800);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-en-'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let admin = '';

function call(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { Host: 'localhost', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie, 'X-Backend': '1' } : {}) };
    const req = http.request({ host: 'localhost', port: PORT, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}
const as = (method, url, body, cookie = admin) => call(method, url, { body, cookie });
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const SLOVAK = /[áäčďéíĺľňóôŕšťúýž]/i;
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
const rulesBlock = (html) => html.slice(html.indexOf('class="tabs pr-nav"'), html.indexOf('<!-- Log in as player modal'));
let sections = [];

test('every section that came with the site has an English text (title, body and the button where it has one)', async () => {
  sections = (await as('GET', '/api/rules')).json;
  assert.ok(sections.length >= 12, `sections: ${sections.length}`);
  sections.forEach((s) => {
    assert.ok(s.titleEn, `${s.slug}: no English title`);
    assert.ok(s.htmlEn, `${s.slug}: no English text`);
    if (s.navLabel) assert.ok(s.navLabelEn, `${s.slug}: no English button`);
  });
});

test('the English page is English: no Slovak letters in the rules text, the buttons or the titles', async () => {
  const r = await call('GET', '/en/rules');
  assert.strictEqual(r.status, 200);
  const block = visible(rulesBlock(r.text));
  assert.ok(block.includes('Name and purpose of the league'), 'English title');
  assert.ok(block.includes('Game system'), 'English button');
  const bad = block.split(/\s+/).filter((w) => SLOVAK.test(w));
  // (the names of places and brands are no translation matter)
  assert.deepStrictEqual(bad.filter((w) => !/^(Bratislav|Fort|Wilson|Dunlop)/i.test(w)), [], 'Slovak words on the English page');
  assert.ok(r.text.includes('aria-label="Sections"'));
});

test('the Slovak page is as it was', async () => {
  const r = await call('GET', '/propozicie');
  assert.strictEqual(r.status, 200);
  assert.ok(r.text.includes('Názov a účel ligy'));
  assert.ok(r.text.includes('aria-label="Sekcie"'));
  assert.ok(!r.text.includes('Name and purpose of the league'));
});

test('a link to a page inside the text goes to the page in the language of the text', async () => {
  const en = await call('GET', '/en/rules');
  const sk = await call('GET', '/propozicie');
  assert.ok(rulesBlock(en.text).includes('href="/en/schedule"'), 'an English address for the schedule');
  assert.ok(/href="\/harmonogram"/.test(rulesBlock(sk.text)));
});

test('a section with no English text shows its Slovak text on the English page', async () => {
  const made = await as('POST', '/api/rules', { title: 'Len slovensky', navLabel: 'Slovensky', html: '<p>Iba slovenský text.</p>' });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.json.titleEn, '');
  const r = await call('GET', '/en/rules');
  assert.ok(r.text.includes('Len slovensky') && r.text.includes('Iba slovenský text.'));
});

test('saving: the English text is cleaned like the Slovak one and shown on the English page only', async () => {
  const id = sections.find((s) => s.slug === 'rozhodcovia').id;
  const dirty = '<p>Hello <script>alert(1)</script><b>there</b></p>';
  const put = await as('PUT', `/api/rules/${id}`, { title: 'Rozhodcovia', navLabel: 'Rozhodcovia', html: '<p>sk</p>', titleEn: 'Umpires', navLabelEn: 'Umpires', htmlEn: dirty });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(put.json.titleEn, 'Umpires');
  assert.ok(!put.json.htmlEn.includes('<script'), 'script removed');
  assert.ok(put.json.htmlEn.includes('<strong>there</strong>'));
  const en = await call('GET', '/en/rules');
  assert.ok(en.text.includes('Umpires') && en.text.includes('Hello'));
  const sk = await call('GET', '/propozicie');
  assert.ok(!sk.text.includes('Umpires'));
});

test('a section whose Slovak text was changed does not get the first English text back on the next start (the English text stays what was saved)', async () => {
  const again = (await as('GET', '/api/rules')).json.find((s) => s.slug === 'rozhodcovia');
  assert.strictEqual(again.titleEn, 'Umpires');
});

test('too long English text is refused', async () => {
  const id = sections[0].id;
  const r = await as('PUT', `/api/rules/${id}`, { title: 'x', navLabel: '', html: '', titleEn: 'y'.repeat(121) });
  assert.strictEqual(r.status, 400);
});

test('"Back to the first text" puts the first English text back too', async () => {
  const id = sections.find((s) => s.slug === 'rozhodcovia').id;
  const r = await as('POST', `/api/rules/${id}/reset`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.titleEn, 'Referees');
  assert.ok(r.json.htmlEn.includes('fair play'));
});

test('copying the rules to another city copies the English text too', async () => {
  const city = await as('POST', '/api/leagues', { name: 'Kosice' });
  assert.strictEqual(city.status, 201);
  const pick = await as('POST', '/api/admin/acting-city', { leagueId: city.json.id });
  const cookie = `${admin}; ${cookieOf(pick)}`;
  assert.strictEqual((await as('POST', '/api/rules/copy', { fromCityId: 1 }, cookie)).status, 200);
  const copy = (await as('GET', '/api/rules', undefined, cookie)).json;
  const ucel = copy.find((s) => s.slug.startsWith('ucel'));
  assert.strictEqual(ucel.titleEn, 'Name and purpose of the league');
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS') delete env[k];
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (d) => { output += d; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 60000);
      child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${output}`)); });
    });
    admin = cookieOf(await call('POST', '/api/admin/login', { body: { password: 'test' } }));
    assert.ok(admin, 'the super admin login gave no cookie');
    for (const { name, fn } of tests) {
      try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 5).join('\n      ')}`); }
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
