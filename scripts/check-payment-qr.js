// Check of the IBAN of an event and the QR code of its entry fee (src/paymentQr.js): the tournament's own IBAN wins over the one of Backend > Contact, the amount is read
// from the fee text, an event with no IBAN anywhere has no QR code. Run: node scripts/check-payment-qr.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-qr-'));
const db = require('../src/db');
const pay = require('../src/paymentQr');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const league = Number(db.prepare('SELECT MIN(id) AS id FROM leagues').get().id);
const cup = (name, iban, fee) => db.prepare("SELECT * FROM seasons WHERE id = ?").get(Number(db.prepare("INSERT INTO seasons (name, slug, kind, league_id, entry_fee, iban) VALUES (?, ?, 'TOURNAMENT', ?, ?, ?)").run(name, name.toLowerCase().replace(/\W+/g, '-'), league, fee, iban).lastInsertRowid));

test('an IBAN is put right: spaces out, capitals, a bad one is empty', () => {
  assert.strictEqual(pay.cleanIban('sk31 1200 0000 1987 4263 7541'), 'SK3112000000198742637541');
  assert.strictEqual(pay.cleanIban('hello'), '');
});
test('the entry fee text gives the amount', () => {
  assert.strictEqual(pay.feeAmount('24€'), 24);
  assert.strictEqual(pay.feeAmount('24,50 EUR'), 24.5);
  assert.strictEqual(pay.feeAmount('zadarmo'), 0);
});
test('the IBAN of the tournament wins over the one of the contact page', () => {
  assert.strictEqual(pay.accountOf(cup('Own Iban', 'SK3112000000198742637541', '24€')).iban, 'SK3112000000198742637541');
  const fallback = pay.accountOf(cup('No Iban', null, '24€'));
  assert.ok(fallback.iban, 'the contact IBAN is used');
  assert.notStrictEqual(fallback.iban, 'SK3112000000198742637541');
});
test('the recipient of the tournament wins over the one of the contact page', () => {
  const c = cup('Own Recipient', 'SK3112000000198742637541', '10');
  db.prepare('UPDATE seasons SET pay_recipient = ? WHERE id = ?').run('Klub Test', c.id);
  assert.strictEqual(pay.accountOf(db.prepare('SELECT * FROM seasons WHERE id = ?').get(c.id)).orgName, 'Klub Test');
});
test('the QR code is an SVG picture', async () => {
  const svg = await pay.svgFor(cup('Qr Cup', 'SK3112000000198742637541', '24€'), 'Jan Novak');
  assert.ok(svg && svg.startsWith('<svg'), String(svg).slice(0, 40));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  ok   ${t.name}`); } catch (err) { failed += 1; console.log(`  FAIL ${t.name}\n       ${err.message}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
