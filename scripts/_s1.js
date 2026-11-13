const fs = require('fs');
const text = require('../src/rulesDefenceText');
function patch(file, getBody, mark, fresh) {
  let raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n'); raw = raw.replace(/\r\n/g, '\n');
  const old = getBody();
  const i = old.indexOf(mark);
  if (i < 0) throw new Error('mark ' + file);
  const next = old.slice(0, i) + fresh;
  const a = JSON.stringify(old).slice(1, -1);
  const b = JSON.stringify(next).slice(1, -1);
  if (!raw.includes(a)) throw new Error('body not found raw ' + file);
  raw = raw.replace(a, () => b);
  fs.writeFileSync(file, crlf ? raw.replace(/\n/g, '\r\n') : raw);
}
patch('src/rulesSeed.js', () => require('../src/rulesSeed').find((s) => s.slug === 'bodovanie').body, text.MARK_SK, text.SK);
patch('src/rulesSeedEn.js', () => require('../src/rulesSeedEn').bodovanie.body, text.MARK_EN, text.EN);
console.log('ok');
