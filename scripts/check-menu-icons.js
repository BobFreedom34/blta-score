// Check that every item of the main menu gets an icon (desktop and phone, top level and dropdown items): public/js/common.js (navIconName, navIconUrl),
// the icons in COURT_ICON_PATHS and the CSS that draws them.
// Run: node scripts/check-menu-icons.js   (static: reads the files, starts nothing)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const common = read('js/common.js');
// the icon code is a block of its own in common.js, run here on its own with the two things it needs
function loadNavIcons() {
  const start = common.indexOf('// NAV ICONS START');
  const end = common.indexOf('// NAV ICONS END');
  assert.ok(start > 0 && end > start, 'the NAV ICONS block is in common.js');
  const paths = common.match(/const COURT_ICON_PATHS = \{[\s\S]*?\n\};/)[0];
  const sandbox = { encodeURIComponent };
  vm.createContext(sandbox);
  vm.runInContext(`${paths}\nconst isHeadingLink = (link) => link === '#';\n${common.slice(start, end)}\nthis.out = { navIconName, navIconUrl, COURT_ICON_PATHS };`, sandbox);
  return sandbox.out;
}

// the menu of the live site (blta.sk) when this was written, and what the app seeds
const ITEMS = [
  ['Domov', '/'], ['Zápasy', '/matches'], ['Hráči', '/players'], ['Rebríček', '/rankings'], ['Kurty', '/courts'], ['Tabuľky', '/tables'], ['Harmonogram', '/harmonogram'],
  ['Víťazi', '/vitazi'], ['Hľadám súpera', '/looking-to-play'], ['+ Nový zápas', '/new-match'], ['Komunity a kluby', '/communities'], ['Správy', '/messages'],
  ['Propozície', '/propozicie'], ['Blog', '/blog'], ['Rezervácie kurtov', '/reservations'], ['Kontakt', '#kontakt'], ['Autumn Finals Series 2026', '/season/autumn-finals-series-2026'],
  ['Turnaj', '/tournament/nejaky-turnaj'], ['Liga', '#'], ['Viac', '#'], ['Čokoľvek nové', '/nieco-nove'],
];

test('every item of the menu gets an icon that exists in the icon set - also an item nobody has heard of, a heading and a season', () => {
  const { navIconName, COURT_ICON_PATHS } = loadNavIcons();
  ITEMS.forEach(([label, link]) => {
    const item = { labelSk: label, labelEn: label, link, isMyProfile: false, children: link === '#' ? [{}] : [] };
    const name = navIconName(item);
    assert.ok(name && COURT_ICON_PATHS[name], `${label} (${link}) -> ${name}`);
  });
  assert.strictEqual(navIconName({ labelSk: 'Môj profil', link: '#', isMyProfile: true, children: [] }), 'user');
});

test('the main pages have their own icons (not all the same), and a heading called Liga is a trophy', () => {
  const { navIconName } = loadNavIcons();
  const of = (label, link, extra = {}) => navIconName({ labelSk: label, labelEn: label, link, isMyProfile: false, children: [], ...extra });
  const names = new Set(['/', '/matches', '/players', '/rankings', '/courts', '/tables', '/harmonogram', '/vitazi', '/looking-to-play', '/new-match', '/communities', '/messages', '#kontakt'].map((l) => of('x', l)));
  assert.ok(names.size >= 12, `the main pages share too few icons: ${[...names].join(', ')}`);
  assert.strictEqual(of('Liga', '#', { children: [{}] }), 'trophy');
  assert.strictEqual(of('Správy', '/messages'), 'send');
  assert.strictEqual(of('Komunity a kluby', '/communities'), 'group');
});

test('the icon is made from the same paths as every other icon of the site (a data: image for the mask)', () => {
  const { navIconUrl } = loadNavIcons();
  const url = navIconUrl('home');
  assert.ok(url.startsWith('url("data:image/svg+xml,') && url.includes('stroke%3D%22black') || url.includes("stroke='black'") || /stroke(%3D|=)/.test(url), url.slice(0, 80));
  assert.ok(!/<svg/.test(url), 'the svg is URL-encoded');
});

test('the menu code sets the icon on every link it makes (also the dropdown items) and on the "my profile" link', () => {
  const at = common.indexOf('async function renderHeaderNav');
  const fn = common.slice(at, common.indexOf('\nrenderHeaderNav();', at));
  assert.ok(/--nav-ico/.test(fn) && /navIconUrl\(navIconName\(/.test(fn), 'the link gets its icon');
  assert.ok(/myProfileEl/.test(fn) && /setProperty\('--nav-ico'/.test(fn.slice(fn.indexOf('myProfileEl'))), 'the "my profile" link too');
});

test('the CSS draws the icon on desktop as well, and also in the dropdown on the phone', () => {
  const css = read('css/style.css');
  const desktop = css.match(/@media \(min-width: 1025px\) \{[^@]*?\.nav-links a::before \{[^}]*mask[^}]*\}/);
  assert.ok(desktop, 'a rule for .nav-links a::before at 1025 px and up');
  assert.ok(!/\.nav-submenu a::before \{ display: none; \}/.test(css), 'the dropdown items on the phone keep their icon');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`PASS  ${t.name}`); } catch (err) { failed += 1; console.log(`FAIL  ${t.name}\n      ${err.message}`); }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
