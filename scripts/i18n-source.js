// The text of the translation files (public/js/i18n.js and its parts i18n-<part>.js) as one string, for the checks that look for a key in it.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'js');

function i18nFiles() {
  const parts = fs.readdirSync(JS).filter((f) => /^i18n-.+\.js$/.test(f)).sort();
  return [...parts, 'i18n.js'];
}

function i18nSource() {
  return i18nFiles().map((f) => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
}

// the same over HTTP: get(url) -> text, for the checks that read the files from a running server
async function i18nSourceFrom(getText) {
  const texts = [];
  for (const f of i18nFiles()) texts.push(await getText(`/js/${f}`));
  return texts.join('\n');
}

module.exports = { i18nFiles, i18nSource, i18nSourceFrom };
