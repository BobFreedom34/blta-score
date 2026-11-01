// Checks the app of a community or club: its own web manifest (name, opens on the club page) and its icons drawn from the club logo,
// with the BLTA icons as the fallback, and no manifest for a club that is unknown or hidden.
// Run: node scripts/check-club-app.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-app-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let child = null;
let adminCookie = '';
let phoneCounter = 0;

async function call(method, url, { cookie = adminCookie, body } = {}) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
async function makePlayer(name) {
  phoneCounter += 1;
  const phone = `09170${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: phone } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}
async function makeClub(owner, name, type = 'COMMUNITY') {
  const org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type, name, description: 'x' } })).json;
  assert.ok(org && org.id && org.slug, JSON.stringify(org));
  return org;
}
// a 300 x 200 logo, deliberately not square
const logoPng = () => new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#b2fa06"/><circle cx="150" cy="100" r="70" fill="#105a1e"/></svg>').render().asPng();
async function uploadLogo(owner, org) {
  const form = new FormData();
  form.append('image', new Blob([logoPng()], { type: 'image/png' }), 'logo.png');
  const res = await fetch(`${base}/api/communities/${org.id}/logo`, { method: 'POST', headers: { Cookie: owner.cookie }, body: form });
  const text = await res.text();
  assert.strictEqual(res.status, 200, text);
  return JSON.parse(text);
}
const sizeOfPng = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const isPng = (buf) => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const getPng = async (url) => Buffer.from(await (await fetch(base + url)).arrayBuffer());

let owner;
let withLogo;
let noLogo;
let lostLogo;

test('setup: three clubs, one with a logo, one without, one whose logo file will vanish', async () => {
  owner = await makePlayer('App Majitel');
  withLogo = await makeClub(owner, 'Klub s logom');
  noLogo = await makeClub(owner, 'Tenisovy klub Slavia Bratislava Petrzalka');
  lostLogo = await makeClub(owner, 'Klub so stratenym logom');
  await uploadLogo(owner, withLogo);
  await uploadLogo(owner, lostLogo);
});

test('the manifest names the club and opens on its page', async () => {
  const r = await call('GET', `/api/communities/${withLogo.slug}/manifest.json`, { cookie: '' });
  assert.strictEqual(r.status, 200);
  assert.ok(/manifest\+json/.test(r.res.headers.get('content-type')), r.res.headers.get('content-type'));
  const m = r.json;
  assert.strictEqual(m.name, 'Klub s logom');
  assert.strictEqual(m.start_url, `/community/${withLogo.slug}?app=1`);
  assert.strictEqual(m.id, `/community/${withLogo.slug}`);
  assert.strictEqual(m.scope, '/');
  assert.strictEqual(m.display, 'standalone');
  const src = m.icons.map((i) => i.src);
  assert.deepStrictEqual(src, [`/api/communities/${withLogo.slug}/icon-192.png`, `/api/communities/${withLogo.slug}/icon-512.png`, `/api/communities/${withLogo.slug}/icon-maskable.png`]);
  assert.deepStrictEqual(m.icons.map((i) => i.purpose), ['any', 'any', 'maskable']);
});

test('a long club name gets a short name that fits under the icon', async () => {
  const m = (await call('GET', `/api/communities/${noLogo.slug}/manifest.json`, { cookie: '' })).json;
  assert.strictEqual(m.name, 'Tenisovy klub Slavia Bratislava Petrzalka');
  assert.ok(m.short_name.length <= 14 && m.short_name.endsWith('…'), m.short_name);
});

test('the icons are PNGs of 192, 512 and 512 pixels drawn from the logo', async () => {
  for (const [variant, size] of [['192', 192], ['512', 512], ['maskable', 512]]) {
    const res = await fetch(`${base}/api/communities/${withLogo.slug}/icon-${variant}.png`);
    assert.strictEqual(res.status, 200, variant);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(isPng(buf), `${variant} is a PNG`);
    assert.deepStrictEqual(sizeOfPng(buf), { w: size, h: size }, variant);
  }
});

test('a club without a logo uses the BLTA icons in its manifest and for the icon routes', async () => {
  const m = (await call('GET', `/api/communities/${noLogo.slug}/manifest.json`, { cookie: '' })).json;
  assert.deepStrictEqual(m.icons.map((i) => i.src), ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);
  const r = await call('GET', `/api/communities/${noLogo.slug}/icon-512.png`, { cookie: '' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.res.headers.get('location'), '/icon-512.png');
});

test('a logo file gone from disk gives the BLTA icon (302), not an error', async () => {
  const folder = path.join(dir, 'community-images');
  const mine = fs.readdirSync(folder).filter((f) => f.startsWith(`${lostLogo.id}-logo-`));
  assert.strictEqual(mine.length, 1, mine.join(','));
  fs.unlinkSync(path.join(folder, mine[0]));
  const r = await call('GET', `/api/communities/${lostLogo.slug}/icon-192.png`, { cookie: '' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.res.headers.get('location'), '/icon-192.png');
  const bad = await call('GET', `/api/communities/${withLogo.slug}/icon-999.png`, { cookie: '' });
  assert.strictEqual(bad.status, 404, 'an unknown icon size');
});

test('a club still waiting for approval has no manifest for visitors', async () => {
  const waiting = await makeClub(await makePlayer('App Druhy Majitel'), 'Cakajuci klub', 'CLUB');
  assert.strictEqual((await call('GET', `/api/communities/${waiting.slug}/manifest.json`, { cookie: '' })).status, 404);
});

test('an unknown club has no manifest and no icons', async () => {
  assert.strictEqual((await call('GET', '/api/communities/no-such-club/manifest.json', { cookie: '' })).status, 404);
  assert.strictEqual((await call('GET', '/api/communities/no-such-club/icon-192.png', { cookie: '' })).status, 404);
});

test('a hidden club has no manifest and no icons, and has them again when shown', async () => {
  assert.strictEqual((await call('PATCH', `/api/communities/${withLogo.id}/moderation`, { body: { hidden: true } })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${withLogo.slug}/manifest.json`, { cookie: '' })).status, 404);
  assert.strictEqual((await call('GET', `/api/communities/${withLogo.slug}/icon-192.png`, { cookie: '' })).status, 404);
  assert.strictEqual((await call('PATCH', `/api/communities/${withLogo.id}/moderation`, { body: { hidden: false } })).status, 200);
  assert.strictEqual((await call('GET', `/api/communities/${withLogo.slug}/manifest.json`, { cookie: '' })).status, 200);
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
    const res = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
    adminCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
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
