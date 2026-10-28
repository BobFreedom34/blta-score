// Check that the signed cookies of the app cannot be swapped for each other: a signature covers the VALUE only, so a value taken from one cookie must be
// useless in another (the club "acting as" cookie must never log anybody in as a player, the referee cookie must never be an admin).
// Run: node scripts/check-cookie-binding.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookiebind-'));
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
const setCookies = (r) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]);
const cookieOf = (r) => setCookies(r).join('; ');
const valueOf = (r, name) => (setCookies(r).find((c) => c.startsWith(`${name}=`)) || '').slice(name.length + 1);

test('the "acting as a club" cookie cannot be used as a player cookie (it would be somebody else\'s inbox)', async () => {
  const mk = async (name, n) => {
    const made = await call('POST', '/api/players', { body: { name } });
    const phone = `0906000${n}`;
    await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } });
    const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
    return { id: made.json.id, cookie: setCookies(login).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
  };
  const victim = await mk('Obet Jeden', '001');
  const attacker = await mk('Utocnik Dva', '002');
  // an organisation whose id equals the victim's player id, run by the attacker
  const file = new DatabaseSync(path.join(dir, 'blta-score.db'));
  file.prepare("INSERT INTO organisations (id, league_id, type, name, slug, created_by_player_id) VALUES (?, 1, 'COMMUNITY', 'Pasca', 'pasca', ?)").run(victim.id, attacker.id);
  file.prepare("INSERT INTO organisation_members (organisation_id, player_id, role, status) VALUES (?, ?, 'ADMIN', 'ACTIVE')").run(victim.id, attacker.id);
  file.close();
  const acting = await call('POST', '/api/communities/act-as', { cookie: attacker.cookie, body: { organisationId: victim.id } });
  assert.strictEqual(acting.status, 200, JSON.stringify(acting.json));
  const stolen = valueOf(acting, 'blta_acting_org');
  assert.ok(stolen.startsWith('s%3A'), 'the cookie is signed: ' + stolen);
  const session = await call('GET', '/api/player/session', { cookie: `blta_player=${stolen}` });
  assert.strictEqual(session.json.isPlayer, false, 'the club cookie logs nobody in');
  assert.strictEqual((await call('GET', '/api/messages/unread', { cookie: `blta_player=${stolen}` })).status, 401);
  assert.strictEqual((await call('GET', '/api/messages/unread', { cookie: victim.cookie })).status, 200, 'the real player is fine');
  const own = await call('GET', '/api/communities/mine', { cookie: `${attacker.cookie}; blta_acting_org=${stolen}` });
  assert.strictEqual(own.json.acting && own.json.acting.id, victim.id, 'the cookie still works as the club cookie');
});

test('the referee cookie cannot be used as an admin cookie, and still works as a referee cookie', async () => {
  assert.strictEqual((await call('PUT', '/api/referee/admin/code', { body: { code: '12345' } })).status, 200);
  const login = await call('POST', '/api/referee/login', { cookie: '', body: { code: '12345' } });
  assert.strictEqual(login.status, 200);
  const value = valueOf(login, 'blta_referee');
  assert.ok(value, 'a referee cookie was set');
  const asAdmin = await call('GET', '/api/admin/session', { cookie: `blta_admin=${value}` });
  assert.ok(!asAdmin.json || !asAdmin.json.isAdmin, 'the referee value is no admin: ' + JSON.stringify(asAdmin.json));
  assert.strictEqual((await call('GET', '/api/leagues-admin-check-nothing', { cookie: `blta_admin=${value}` })).status !== 200, true);
  const own = await call('GET', '/api/player/session', { cookie: `blta_referee=${value}` });
  assert.strictEqual(own.json.isReferee, true, 'as a referee cookie it works');
  const real = await call('GET', '/api/admin/session', { cookie: adminCookie });
  assert.strictEqual(real.json.isAdmin, true, 'the real admin cookie is untouched');
});

test('a player cookie is no admin or referee, and an admin cookie is no player', async () => {
  const made = await call('POST', '/api/players', { body: { name: 'Hrac Tri' } });
  await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone: '0906000003' } });
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: '0906000003' } });
  const playerValue = valueOf(login, 'blta_player');
  assert.strictEqual((await call('GET', '/api/admin/session', { cookie: `blta_admin=${playerValue}` })).json.isAdmin, false);
  assert.strictEqual((await call('GET', '/api/player/session', { cookie: `blta_referee=${playerValue}` })).json.isReferee, false);
  const adminValue = adminCookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('blta_admin=')).slice('blta_admin='.length);
  assert.strictEqual((await call('GET', '/api/player/session', { cookie: `blta_player=${adminValue}` })).json.isPlayer, false);
  assert.strictEqual((await call('GET', '/api/player/session', { cookie: `blta_referee=${adminValue}` })).json.isReferee, false);
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
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temporary folder */ }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
