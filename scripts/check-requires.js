// Every relative require('./x') / require('../x') in src/ and server.js must point at a file that exists — also the lazy ones inside functions, which
// do not fail at start-up and, wrapped in a try/catch, fail silently (this is how a moved file once lost "the bracket follows the match").
// Run: node scripts/check-requires.js   (no server needed)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const files = [path.join(ROOT, 'server.js')];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'src'));

let failed = 0;
try {
  const broken = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
      try { require.resolve(path.resolve(path.dirname(file), m[2])); } catch { broken.push(`${path.relative(ROOT, file)}: ${m[2]}`); }
    }
  }
  assert.deepStrictEqual(broken, [], `a require that points nowhere:\n      ${broken.join('\n      ')}`);
  console.log(`PASS  every relative require in ${files.length} files points at a file that exists`);
} catch (err) {
  failed = 1;
  console.log(`FAIL  ${err.message}`);
}
console.log(failed ? '\n1 failed' : '\nall 1 passed');
process.exit(failed);
