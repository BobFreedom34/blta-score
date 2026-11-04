// Checks that the tournament / season manage page speaks ONE language: every text its scripts show is written in both languages with tl('Slovak', 'English')
// (public/js/i18n.js), so the Slovak page has nothing in English and the English page nothing in Slovak. It scans the scripts of the page for a text that is
// not wrapped: a text between tags, a placeholder / title / aria-label, and the text of a toast, a confirm, a prompt or an Error.
// Run: node scripts/check-manage-page-language.js   (reads files only)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['seasons-admin.js', 'season-assign.js', 'season-draw.js', 'bracket-admin.js', 'court-schedule.js'];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
// what is the same in both languages: a symbol written as an entity (&times;), a brand (CourtIQ, BLTA), and a piece of code that sits between a > and a <
const NEUTRAL = /^(text >&\w+;<|title="(CourtIQ|BLTA)"|text >[^<]*(=>|\|\||&&|\(|\)|\?)[^<]*<)$/;
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

// the text of a line without its comment, and without what is inside tl(...) / nounFor(...) calls (those are the two languages themselves)
function plainTextsOf(line) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
  // blank out every tl('…', '…') call (both languages inside it), also with template strings in it, by walking its brackets
  let out = '';
  for (let i = 0; i < line.length;) {
    const m = /^(tl|nounFor)\(/.exec(line.slice(i));
    if (!m || (i > 0 && /[A-Za-z0-9_$]/.test(line[i - 1]))) { out += line[i]; i += 1; continue; }
    let depth = 0; let j = i + m[0].length - 1; let quote = null;
    for (; j < line.length; j += 1) {
      const ch = line[j];
      if (quote) { if (ch === '\\') j += 1; else if (ch === quote) quote = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) break; }
    }
    out += '§';
    i = j + 1;
  }
  const hits = [];
  for (const m of out.matchAll(/>([^<>${}`§]*[A-Za-zÀ-ž]{3,}[^<>${}`§]*)</g)) { const t = m[1].trim(); if (t && !/^(sa-|data-)/.test(t)) hits.push(`text >${t}<`); }
  for (const m of out.matchAll(/(placeholder|title|aria-label)="([^"${}§]*[A-Za-zÀ-ž]{3,}[^"${}§]*)"/g)) hits.push(`${m[1]}="${m[2]}"`);
  for (const m of out.matchAll(/\b(toast|confirm|alert|prompt)\(\s*['"]([^'"§]*[A-Za-zÀ-ž]{3,}[^'"§]*)['"]/g)) hits.push(`${m[1]}('${m[2]}')`);
  for (const m of out.matchAll(/new Error\(\s*['"]([^'"§]*[A-Za-zÀ-ž]{3,}[^'"§]*)['"]/g)) hits.push(`Error('${m[1]}')`);
  return hits;
}

test('the scripts of the manage page have no text outside tl(): nothing is left in one language only', () => {
  const found = [];
  for (const file of FILES) {
    read(`js/${file}`).split('\n').forEach((line, i) => {
      // a URL or an address that is the same in both languages (a placeholder like https://…) is not a text
      plainTextsOf(line).filter((h) => !/https?:\/\//.test(h) && !NEUTRAL.test(h)).forEach((h) => found.push(`${file}:${i + 1}  ${h}`));
    });
  }
  assert.deepStrictEqual(found, [], `texts written in one language only:\n  ${found.join('\n  ')}`);
});

test('every tl() has both languages, and the plural helper and tl() are defined once, in i18n.js, before the scripts that use them', () => {
  const i18n = read('js/i18n.js');
  assert.ok(/function tl\(sk, en\) \{\s*return currentLang === 'en' \? en : sk;\s*\}/.test(i18n), 'tl() picks by the language of the page');
  assert.ok(i18n.includes('function nounFor(n, sk1, sk2to4, sk5, en1, en2)'), 'nounFor() is in i18n.js');
  for (const file of FILES) assert.ok(!/function (tl|nounFor)\(/.test(read(`js/${file}`)), `${file} does not define its own tl / nounFor`);
  // two arguments, none empty: tl('', 'x') or tl('x', '') would leave one language blank
  for (const file of FILES) {
    const src = read(`js/${file}`);
    assert.ok(!/\btl\(\s*(''|""|``)\s*,/.test(src) && !/\btl\([^()]*,\s*(''|""|``)\s*\)/.test(src), `${file}: a tl() with an empty language`);
  }
  for (const page of ['seasons-admin.html', 'tournaments-admin.html', 'club-tournament.html', 'bracket-admin.html', 'season.html']) {
    const html = read(page);
    const at = (name) => html.indexOf(`/js/${name}`);
    assert.ok(at('i18n.js') >= 0, `${page} loads i18n.js`);
    for (const file of FILES) if (at(file) >= 0) assert.ok(at('i18n.js') < at(file), `${page}: i18n.js before ${file}`);
  }
});

test('the English page has the English texts and the Slovak page the Slovak ones: run the pieces with each language', () => {
  const vm = require('vm');
  const src = read('js/i18n.js');
  const pick = (name) => { const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(src); assert.ok(m, name); return m[0]; };
  const run = (lang) => {
    const ctx = vm.createContext({ currentLang: lang });
    vm.runInContext(`${pick('tl')}\n${pick('nounFor')}`, ctx);
    return (code) => vm.runInContext(code, ctx);
  };
  const sk = run('sk');
  const en = run('en');
  assert.strictEqual(sk("tl('Uložiť', 'Save')"), 'Uložiť');
  assert.strictEqual(en("tl('Uložiť', 'Save')"), 'Save');
  const plural = (n) => `nounFor(${n}, 'zápas', 'zápasy', 'zápasov', 'match', 'matches')`;
  assert.deepStrictEqual([0, 1, 2, 4, 5, 11].map((n) => sk(plural(n))), ['zápasov', 'zápas', 'zápasy', 'zápasy', 'zápasov', 'zápasov']);
  assert.deepStrictEqual([0, 1, 2, 5].map((n) => en(plural(n))), ['matches', 'match', 'matches', 'matches']);
});

(() => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { fn(); console.log(`PASS  ${name}`); } catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${String(err && err.message).split('\n').slice(0, 14).join('\n      ')}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
