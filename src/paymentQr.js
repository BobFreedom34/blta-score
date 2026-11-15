// The QR code of the entry-fee payment: the Slovak standard "PAY by square", which the banking apps of Slovak banks read (scanning it fills in the account, the amount and the note).
// The IBAN is the one of the tournament (seasons.iban), else the one of Backend > Contact.
const QRCode = require('qrcode');
const db = require('./db');
const contact = require('./routes/contact');

// an IBAN as it is stored: no spaces, capitals; '' when it does not look like one
function cleanIban(value) {
  const v = String(value || '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v) ? v : '';
}

// the amount of an entry fee written as text ("24€", "24,50 EUR"); 0 when there is none
function feeAmount(fee) {
  const m = String(fee || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0]) * 100) / 100 : 0;
}

// the account to pay to: { iban, orgName } (the tournament's own IBAN first)
function accountOf(season) {
  const c = contact.read();
  const iban = cleanIban(season.iban) || cleanIban(c.iban);
  return { iban, orgName: season.pay_recipient || c.orgName || '' };
}

async function svgFor(season, forName) {
  const { iban, orgName } = accountOf(season);
  if (!iban) return null;
  const { encode } = await import('bysquare/pay');
  const amount = feeAmount(season.entry_fee);
  // the note: the one the organiser wrote ({turnaj} = the name of the event, {meno} = the player), else the name of the event and the player
  const custom = String(season.pay_note || '').trim();
  const note = (custom ? custom.split('{turnaj}').join(season.name).split('{meno}').join(forName || '') : `${season.name}${forName ? ` - ${forName}` : ''}`).trim().slice(0, 140);
  const data = encode({
    payments: [{
      type: 1,
      amount: amount || undefined,
      currencyCode: 'EUR',
      paymentNote: note,
      beneficiary: { name: orgName || 'BLTA' },
      bankAccounts: [{ iban }],
    }],
  });
  return QRCode.toString(data, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

module.exports = { cleanIban, feeAmount, accountOf, svgFor };
