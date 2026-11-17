// Checks of who may read the API from another site (src/corsPolicy.js): own sites and local development yes, strangers no, no Origin always.
// Run: node scripts/check-cors.js   (no server needed)
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cors-'));
const policy = require('../src/corsPolicy');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const check = (origin) => new Promise((resolve) => policy.origin(origin, (err, ok) => resolve(ok)));

test('own sites and their sub-domains may read', async () => {
  for (const o of ['https://blta.sk', 'https://www.blta.sk', 'https://score.blta.sk', 'https://old.blta.sk', 'https://slta.sk', 'https://www.slta.sk']) {
    assert.strictEqual(await check(o), true, o);
  }
});
test('local development hosts may read', async () => {
  for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000']) assert.strictEqual(await check(o), true, o);
});
test('a stranger, or a look-alike of an own domain, may not', async () => {
  for (const o of ['https://example.com', 'https://evilblta.sk', 'https://blta.sk.evil.com', 'null', 'not a url']) assert.strictEqual(await check(o), false, o);
});
test('a request without an Origin is not a cross-site read', async () => {
  assert.strictEqual(await check(undefined), true);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${err.message}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
