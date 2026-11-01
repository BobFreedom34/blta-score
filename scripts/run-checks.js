// Runs every scripts/check-*.js one after the other (each starts its own server on a temporary data folder, so they cannot disturb each other or the real data)
// and ends with one list of what passed and what failed. Exit code 1 when any failed — this is what `npm test` and the GitHub check run.
// Run: npm test            (all)
//      npm test -- seo     (only the checks whose file name contains "seo")
//      npm test -- --bail  (stop at the first failure)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const TIMEOUT_MS = 180000;
const args = process.argv.slice(2);
const bail = args.includes('--bail');
const filters = args.filter((a) => !a.startsWith('--'));

const files = fs.readdirSync(DIR)
  .filter((f) => /^check-.*\.js$/.test(f))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(DIR, file)], { cwd: path.join(DIR, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += `\n(stopped after ${TIMEOUT_MS / 1000} s)`; child.kill(); }, TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ file, ok: code === 0, out, seconds: (Date.now() - started) / 1000 }); });
  });
}

(async () => {
  const failed = [];
  const begun = Date.now();
  for (const file of files) {
    const r = await runOne(file);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${file}  (${r.seconds.toFixed(1)} s)`);
    if (!r.ok) {
      failed.push(r);
      // the lines that say what went wrong (the check's own FAIL lines, or the end of its output)
      const lines = r.out.split('\n');
      const bad = lines.filter((l) => /FAIL|Error|failed/i.test(l));
      console.log((bad.length ? bad : lines.slice(-12)).slice(0, 15).map((l) => `      ${l}`).join('\n'));
      if (bail) break;
    }
  }
  const total = ((Date.now() - begun) / 1000).toFixed(0);
  console.log(failed.length
    ? `\n${failed.length} of ${files.length} checks failed (${total} s): ${failed.map((f) => f.file).join(', ')}`
    : `\nall ${files.length} checks passed (${total} s)`);
  process.exit(failed.length ? 1 : 0);
})();
