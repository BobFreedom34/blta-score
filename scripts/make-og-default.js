// Draws the default link-preview pictures (1200 x 630) of the two sites: public/img/og-blta.png and public/img/og-slta.png.
// A page with no picture of its own (src/seo.js) points at one of them. Run: node scripts/make-og-default.js   (after changing the logo or the texts)
const fs = require('fs');
const path = require('path');
const { renderBrandPng } = require('../src/shareImage');

const OUT = path.join(__dirname, '..', 'public', 'img');
const cards = {
  'og-blta.png': { brand: 'BLTA', line1: 'Bratislavská liga', line2: 'tenisových amatérov', tagline: 'Živé skóre, tabuľky, turnaje a rebríček amatérskeho tenisu' },
  'og-slta.png': { brand: 'SLTA', line1: 'Slovenská liga', line2: 'tenisových amatérov', tagline: 'Amatérska tenisová liga v mestách Slovenska', logoFile: 'slta-logo.png', ratio: 500 / 141 },
};
for (const [file, opts] of Object.entries(cards)) {
  fs.writeFileSync(path.join(OUT, file), renderBrandPng(opts));
  console.log('wrote', file);
}
