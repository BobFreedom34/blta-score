// Checks of adding players to a community or club by hand (/api/communities/:id/add-candidates and /add-members): only an admin of it or the super admin; the
// players become members at once (no message, no approval, no phone needed).
// Run: node scripts/check-community-add-members.js   (starts its own server on a temporary data directory; touches nothing else)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-addmem-'));
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
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json, res };
}
const sql = (query, ...params) => {
  const d = new DatabaseSync(path.join(dir, 'blta-score.db'), { readOnly: true });
  try { return d.prepare(query).all(...params); } finally { d.close(); }
};
async function makePlayer(name, { phone = true } = {}) {
  phoneCounter += 1;
  const number = `09090${String(phoneCounter).padStart(5, '0')}`;
  const made = await call('POST', '/api/players', { body: { name } });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.json));
  if (!phone) return { id: made.json.id, name, cookie: '' };
  assert.strictEqual((await call('PATCH', `/api/players/${made.json.id}/phone`, { body: { phone: number } })).status, 200);
  const login = await call('POST', '/api/player/login', { cookie: '', body: { code: number } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  return { id: made.json.id, name, cookie: login.res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.startsWith('blta_acting_org=')).join('; ') };
}

let owner;
let member;
let anna;
let boris;
let cyril;
let nophone;
let stranger;
let org;
const add = (who, ids) => call('POST', `/api/communities/${org.id}/add-members`, { cookie: who.cookie, body: { playerIds: ids } });
const members = async () => (await call('GET', `/api/communities/${org.id}/members`, { cookie: owner.cookie })).json;

test('setup: a community that decides on every request, an owner, a member, a player with a waiting request and others', async () => {
  [owner, member, anna, boris, cyril, stranger] = [await makePlayer('Pridaj Majitel'), await makePlayer('Pridaj Clen'), await makePlayer('Pridaj Anna'), await makePlayer('Pridaj Boris'), await makePlayer('Pridaj Cyril'), await makePlayer('Pridaj Cudzi')];
  nophone = await makePlayer('Pridaj Bez Telefonu', { phone: false });
  org = (await call('POST', '/api/communities', { cookie: owner.cookie, body: { type: 'COMMUNITY', name: 'Pridavanie hraci', description: 'x', joinPolicy: 'APPROVAL' } })).json;
  assert.ok(org.id);
  await call('POST', `/api/communities/${org.id}/join`, { cookie: member.cookie });
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/members/${member.id}/approve`, { cookie: owner.cookie })).status, 200);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/join`, { cookie: boris.cookie })).json.status, 'PENDING');
});

test('the list to pick from: every player of the city who is not a member (also one without a phone, also one who is waiting), a name narrows it', async () => {
  const all = await call('GET', `/api/communities/${org.id}/add-candidates`, { cookie: owner.cookie });
  assert.strictEqual(all.status, 200, JSON.stringify(all.json));
  const names = all.json.items.map((p) => p.name);
  assert.ok(names.includes('Pridaj Anna') && names.includes('Pridaj Bez Telefonu') && names.includes('Pridaj Boris'));
  assert.ok(!names.includes('Pridaj Clen'), 'not a member already');
  assert.strictEqual(all.json.items.find((p) => p.name === 'Pridaj Boris').waiting, true);
  assert.strictEqual(all.json.items.find((p) => p.name === 'Pridaj Anna').waiting, false);
  const narrowed = await call('GET', `/api/communities/${org.id}/add-candidates?q=cyr`, { cookie: owner.cookie });
  assert.deepStrictEqual(narrowed.json.items.map((p) => p.name), ['Pridaj Cyril']);
});

test('only an admin of the community or the super admin may see the list and add: not a member, not a stranger, not a visitor', async () => {
  for (const who of [member, stranger]) {
    assert.strictEqual((await call('GET', `/api/communities/${org.id}/add-candidates`, { cookie: who.cookie })).status, 403);
    assert.strictEqual((await add(who, [anna.id])).status, 403);
  }
  assert.strictEqual((await call('GET', `/api/communities/${org.id}/add-candidates`, { cookie: '' })).status, 401);
  assert.strictEqual((await call('POST', `/api/communities/${org.id}/add-members`, { cookie: '', body: { playerIds: [anna.id] } })).status, 401);
  assert.ok(!(await members()).members.some((m) => m.name === 'Pridaj Anna'), 'nothing was added');
});

test('the admin adds players: they are members at once (also one without a phone); a waiting request becomes a membership', async () => {
  const r = await add(owner, [anna.id, nophone.id, boris.id]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual([r.json.added, r.json.skipped.length], [3, 0]);
  const list = await members();
  const names = list.members.map((m) => m.name);
  assert.ok(names.includes('Pridaj Anna') && names.includes('Pridaj Bez Telefonu') && names.includes('Pridaj Boris'));
  assert.ok(list.members.filter((m) => ['Pridaj Anna', 'Pridaj Boris'].includes(m.name)).every((m) => m.role === 'MEMBER'));
  assert.strictEqual(list.pending.length, 0, 'the waiting request of Boris is no more');
  const rows = sql('SELECT status FROM organisation_members WHERE organisation_id = ? AND player_id = ?', org.id, boris.id);
  assert.deepStrictEqual(rows.map((x) => x.status), ['ACTIVE']);
});

test('adding again or adding nobody real: a member and an unknown player are skipped with a reason', async () => {
  const r = await add(owner, [anna.id, 999999, cyril.id]);
  assert.strictEqual(r.json.added, 1);
  assert.deepStrictEqual(r.json.skipped.map((x) => x.reason).sort(), ['MEMBER', 'NOT_FOUND']);
  const again = await call('GET', `/api/communities/${org.id}/add-candidates?q=anna`, { cookie: owner.cookie });
  assert.deepStrictEqual(again.json.items, [], 'a member is no longer offered');
});

test('a member who was removed can be added again as a plain member', async () => {
  assert.strictEqual((await call('DELETE', `/api/communities/${org.id}/members/${cyril.id}`, { cookie: owner.cookie })).status, 200);
  assert.deepStrictEqual(sql('SELECT status FROM organisation_members WHERE organisation_id = ? AND player_id = ?', org.id, cyril.id).map((x) => x.status), ['REJECTED']);
  const r = await add(owner, [cyril.id]);
  assert.strictEqual(r.json.added, 1);
  assert.deepStrictEqual(sql('SELECT status, role FROM organisation_members WHERE organisation_id = ? AND player_id = ?', org.id, cyril.id).map((x) => `${x.status}/${x.role}`), ['ACTIVE/MEMBER']);
});

test('the super admin may add too (no player needed); bad requests are refused', async () => {
  const fresh = await makePlayer('Pridaj Superom');
  const asSuper = await call('POST', `/api/communities/${org.id}/add-members`, { body: { playerIds: [fresh.id] } });
  assert.strictEqual(asSuper.status, 200, JSON.stringify(asSuper.json));
  assert.strictEqual(asSuper.json.added, 1);
  assert.strictEqual((await add(owner, [])).status, 400);
  assert.strictEqual((await add(owner, ['x'])).status, 400);
  assert.strictEqual((await add(owner, Array.from({ length: 51 }, (_, i) => i + 1))).status, 400);
});

test('the page side: the button and the dialog of the community page, in both languages', () => {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const club = pub('js/community.js');
  assert.ok(club.includes('data-act="add-members"') && club.includes('add-candidates') && club.includes('add-members') && club.includes('id="com-add-send"'));
  const i18n = pub('js/i18n.js');
  for (const key of ['com.addMembers', 'com.addTitle', 'com.addHint', 'com.addSend', 'com.addDone', 'com.addWaiting']) {
    assert.strictEqual(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
  }
});

async function main() {
  let failed = 0;
  try {
    const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test', PUSH_DRY_RUN: '1' };
    for (const k of Object.keys(env)) if (k.startsWith('GOOGLE_') || k.startsWith('SMTP_') || k === 'PUBLIC_URL' || k === 'NATIONAL_HOSTS' || k.startsWith('VAPID_')) delete env[k];
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
