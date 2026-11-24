// Checks of the editable e-mails (Backend > E-mails, src/emailTemplates.js): every built-in text fills in, the rules of a text ({?x}, {!x}, lines of empty variables left out),
// the super admin's API (list, save, unknown variables refused, preview, reset, test e-mail), and that an EDITED text is the one that really goes out (a real registration).
// Run: node scripts/check-email-templates.js   (starts its own server and a tiny SMTP server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3100 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'et-server-'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let sink = null;
let adminCookie = '';
const mails = [];
let smtpPort = 0;

function startSmtpSink() {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = '';
      let inData = false;
      let rcpts = [];
      const send = (s) => sock.write(`${s}\r\n`);
      send('220 sink ESMTP');
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          if (inData) {
            const i = buf.indexOf('\r\n.\r\n');
            if (i < 0) return;
            mails.push({ to: rcpts.slice(), raw: buf.slice(0, i) });
            buf = buf.slice(i + 5);
            inData = false;
            rcpts = [];
            send('250 queued');
            continue;
          }
          const i = buf.indexOf('\r\n');
          if (i < 0) return;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO') sock.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n');
          else if (cmd === 'AUTH') send('235 ok');
          else if (cmd === 'RCPT') { rcpts.push(line.replace(/^RCPT TO:\s*<?/i, '').replace(/>?\s*$/, '')); send('250 ok'); }
          else if (cmd === 'DATA') { inData = true; send('354 go'); }
          else if (cmd === 'QUIT') { send('221 bye'); sock.end(); }
          else send('250 ok');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => { smtpPort = server.address().port; resolve(server); });
  });
}
function readMail(m) {
  const [head, ...rest] = m.raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  const header = (name) => (new RegExp(String.raw`^${name}:\s*([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)`, 'im').exec(head) || [])[1] || '';
  const words = (v) => v.replace(/\r?\n[ \t]/g, '').replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (all, kind, data) => (kind.toUpperCase() === 'B'
    ? Buffer.from(data, 'base64').toString('utf8')
    : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')));
  const cte = header('Content-Transfer-Encoding').toLowerCase();
  let text = body;
  if (cte === 'base64') text = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  else if (cte === 'quoted-printable') text = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  return { to: m.to, subject: words(header('Subject')).trim(), text: text.replace(/\r\n/g, '\n') };
}
const waitForMails = async (count, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (mails.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return mails.length;
};

async function call(method, url, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}
const admin = (method, url, body) => call(method, url, { body, cookie: adminCookie });

test('only the super admin reads or changes the e-mails', async () => {
  assert.ok([401, 403].includes((await call('GET', '/api/email-templates')).status));
  assert.ok([401, 403].includes((await call('PUT', '/api/email-templates/matchStarted', { body: { subject: 'x', body: 'y' } })).status));
  assert.ok([401, 403].includes((await call('POST', '/api/email-templates/matchStarted/test', { body: { to: 'a@b.sk' } })).status));
});

test('the list has every e-mail in groups, each with its variables and a built-in text; none is edited yet', async () => {
  const r = await admin('GET', '/api/email-templates');
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(r.json.templates.length >= 25, `${r.json.templates.length} e-mails`);
  assert.ok(r.json.groups.length >= 5);
  const keys = r.json.templates.map((t) => t.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'keys are unique');
  for (const t of r.json.templates) {
    assert.ok(t.title && t.when && t.audience && t.subject && t.body, t.key);
    assert.ok(t.vars.length > 0 && t.vars.every((x) => x.name && x.desc), `${t.key}: variables`);
    assert.strictEqual(t.edited, false, `${t.key} not edited`);
    assert.ok(r.json.groups.includes(t.group), `${t.key}: group`);
  }
});

test('every built-in text fills in with its example values: no {variable} is left over, the subject is one line, nothing is empty', async () => {
  const list = (await admin('GET', '/api/email-templates')).json.templates;
  for (const t of list) {
    const r = await admin('POST', `/api/email-templates/${t.key}/preview`, {});
    assert.strictEqual(r.status, 200, `${t.key}: ${r.text}`);
    assert.ok(r.json.subject && !/[{}\n]/.test(r.json.subject), `${t.key} subject: ${r.json.subject}`);
    assert.ok(r.json.text && !/[{}]/.test(r.json.text), `${t.key} text: ${r.json.text}`);
    assert.ok(!/\n\n\n/.test(r.json.text), `${t.key}: no run of empty lines`);
    t.vars.filter((x) => x.sample).forEach((x) => assert.ok(r.json.text.includes(x.sample) || r.json.subject.includes(x.sample) || !(t.body + t.subject).includes(`{${x.name}}`), `${t.key}: {${x.name}} is used but its value is not in the text`));
  }
});

test('the rules of a text: a line of empty variables is left out, {?x} and {!x} lines, empty lines collapse', async () => {
  // matchStarted: location has a sample value; the text removes a line with an unknown value by editing the sample away is not possible, so the rules are tried on a custom body
  const preview = async (key, body) => (await admin('POST', `/api/email-templates/${key}/preview`, { body })).json.text;
  assert.strictEqual(await preview('courtReservationPlayer', 'A\n\n\n\nB'), 'A\n\nB', 'empty lines collapse');
  assert.strictEqual(await preview('courtReservationPlayer', '{?first}Ahoj {first},\n{!first}Ahoj,\nKurt'), 'Ahoj Mária,\nKurt', 'first has a value: the {?first} line stays, the {!first} one goes');
  assert.strictEqual(await preview('seasonRegistration', 'Poznámka: {note}\nMeno: {name}'), 'Meno: Peter Novák', 'the note is empty in the example: its line is left out');
  assert.strictEqual(await preview('seasonRegistration', '{!note}Bez poznámky\n{?note}Poznámka: {note}'), 'Bez poznámky', '{!x} for an empty variable');
});

test('saving: an unknown variable is refused and says which; a good text is kept and marked edited; an empty one is the built-in text again', async () => {
  const bad = await admin('PUT', '/api/email-templates/matchStarted', { subject: 'Zápas {player1}', body: 'Hrá {player3}' });
  assert.strictEqual(bad.status, 400);
  assert.ok(bad.json.error.includes('{player3}'), bad.json.error);
  const ok = await admin('PUT', '/api/email-templates/matchStarted', { subject: 'ŠTART: {player1} vs {player2}', body: '{player1} vs {player2} začali!\n{?location}Hrá sa: {location}\nSleduj: {link}' });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.edited, true);
  const list = (await admin('GET', '/api/email-templates')).json.templates;
  assert.strictEqual(list.find((t) => t.key === 'matchStarted').subject, 'ŠTART: {player1} vs {player2}');
  assert.strictEqual(list.filter((t) => t.edited).length, 1, 'only that one');
  const empty = await admin('PUT', '/api/email-templates/matchStarted', { subject: '', body: '' });
  assert.strictEqual(empty.json.edited, false, 'empty = the built-in text');
  assert.strictEqual((await admin('PUT', '/api/email-templates/nope', { subject: 'x', body: 'y' })).status, 400);
});

test('reset brings the built-in text back; the preview shows an unsaved text and saves nothing', async () => {
  await admin('PUT', '/api/email-templates/pinReset', { subject: 'Nový kód', body: 'Ahoj {name}: {link}' });
  assert.strictEqual((await admin('GET', '/api/email-templates')).json.templates.find((t) => t.key === 'pinReset').edited, true);
  const reset = await admin('DELETE', '/api/email-templates/pinReset');
  assert.strictEqual(reset.status, 200);
  assert.strictEqual(reset.json.edited, false);
  const p = await admin('POST', '/api/email-templates/pinReset/preview', { subject: 'Skúška {name}', body: 'Text pre {name}' });
  assert.deepStrictEqual([p.json.subject, p.json.text], ['Skúška Peter Novák', 'Text pre Peter Novák']);
  assert.strictEqual((await admin('GET', '/api/email-templates')).json.templates.find((t) => t.key === 'pinReset').edited, false, 'the preview saved nothing');
  assert.strictEqual((await admin('DELETE', '/api/email-templates/nope')).status, 404);
});

test('the test e-mail goes to the address with the example values and a [TEST] subject', async () => {
  const before = mails.length;
  assert.strictEqual((await admin('POST', '/api/email-templates/kioskBatteryLow/test', { to: 'not-an-address' })).status, 400);
  const r = await admin('POST', '/api/email-templates/kioskBatteryLow/test', { to: 'me@example.com', body: 'Batéria na {court}: {percent} %' });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(await waitForMails(before + 1), before + 1);
  const m = readMail(mails[before]);
  assert.deepStrictEqual(m.to, ['me@example.com']);
  assert.strictEqual(m.subject, '[TEST] Slabá batéria: Kurt 1 (15 %)');
  assert.strictEqual(m.text.trim(), 'Batéria na Kurt 1: 15 %', 'the text that was typed, not the saved one');
});

test('an EDITED text is what really goes out: the e-mail to the admin about a new registration', async () => {
  await admin('PUT', '/api/email-templates/newRegistration', { subject: 'NOVÁ KRVINKA: {name}', body: 'Prišiel {name} ({phone})\nÚroveň: {level}' });
  const before = mails.length;
  const reg = await call('POST', '/api/player/register', { body: { name: 'Edit Player', phone: '0900333001', email: 'edit@example.com', tennisLevel: 'ELITE' } });
  assert.strictEqual(reg.status, 201, reg.text);
  await waitForMails(before + 2); // the admin's e-mail and the welcome e-mail
  const got = mails.slice(before).map(readMail);
  const toAdmin = got.find((m) => m.subject.startsWith('NOVÁ KRVINKA'));
  assert.ok(toAdmin, JSON.stringify(got.map((m) => m.subject)));
  assert.strictEqual(toAdmin.subject, 'NOVÁ KRVINKA: Edit Player');
  assert.strictEqual(toAdmin.text.trim(), 'Prišiel Edit Player (0900333001)\nÚroveň: Elite – veľmi pokročilý');
  await admin('DELETE', '/api/email-templates/newRegistration');
});

test('the built-in text is what goes out when nothing was edited: the same lines as always (new registration)', async () => {
  const before = mails.length;
  const reg = await call('POST', '/api/player/register', { body: { name: 'Plain Player', phone: '0900333002', email: 'plain@example.com', tennisLevel: 'NOVICE' } });
  assert.strictEqual(reg.status, 201, reg.text);
  await waitForMails(before + 2);
  const toAdmin = mails.slice(before).map(readMail).find((m) => m.subject === 'Nová registrácia hráča: Plain Player');
  assert.ok(toAdmin, 'the admin e-mail');
  assert.strictEqual(toAdmin.text.trim(), ['Nový hráč sa práve zaregistroval na BLTA:', 'Meno: Plain Player', 'Telefón: 0900333002', 'E-mail: plain@example.com', 'Tenisová úroveň: Novice – začiatočník'].join('\n'));
});

test('the Backend page lists the e-mails: the script loads them and the page has the root', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/emails-admin.js'), 'utf8');
  assert.ok(js.includes('/email-templates'), 'the script talks to the API');
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/emails-admin.html'), 'utf8').includes('emails-admin-root'));
});

async function startServer() {
  sink = await startSmtpSink();
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: serverDir, PORT: String(PORT), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'x', MAIL_FROM: 'BLTA <noreply@example.com>', NOTIFY_EMAIL: 'admin@example.com', PUBLIC_URL: 'https://blta.sk' },
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
    if (sink) sink.close();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
