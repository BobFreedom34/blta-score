// The text of public/js/common.js, which is split into several scripts loaded one after another (one global scope): the checks that look for a piece of code in it read them joined.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'js');
// in the order the pages load them (common.js first)
const COMMON_FILES = ['common.js', 'common-forms.js', 'common-cards.js', 'common-nav.js', 'common-player.js', 'common-site.js'];

function commonSource() {
  return COMMON_FILES.map((f) => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
}

// the same over HTTP: getText(url) -> text
async function commonSourceFrom(getText) {
  const texts = [];
  for (const f of COMMON_FILES) texts.push(await getText(`/js/${f}`));
  return texts.join('\n');
}

module.exports = { COMMON_FILES, commonSource, commonSourceFrom };
