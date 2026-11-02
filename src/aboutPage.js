// The text of the page "Info o lige" (/info-o-amaterskej-tenisovej-lige), written into the HTML on the server: it is everything the "O nás – info o lige"
// window of the home page says, one tab under the other. The window's code (public/js/about.js) and its texts (public/js/i18n.js) are browser files, so they
// are run here, once, in a sandbox with the few browser things they touch faked — the page then says exactly what the window says, in both languages, and a
// crawler reads it without running any script. What a city has written in Backend > Info (src/about.js) takes the place of the texts that came with the site.
const vm = require('vm');
const about = require('./about');
const { load } = require('./browserTexts');

// The links of the texts are code addresses (/propozicie, /harmonogram#…): they become the address of the language of the page (and of the city).
function localizeLinks(html, lang, pageUrl, base) {
  return html.replace(/href="(\/[^"#?]*)([^"]*)"/g, (whole, p, tail) => `href="${base}${pageUrl(p, lang)}${tail}"`);
}

// -> the HTML of the page body ('' when the city has written nothing); pageUrl(codeAddress, lang) -> the public address (src/seo.js)
function html({ lang = 'sk', leagueId = 1, brand = '', pageUrl, base = '' }) {
  const { context, win } = load();
  win.CITY = leagueId === 1 || !brand ? undefined : { brand };
  context.__lang = lang === 'en' ? 'en' : 'sk';
  context.__data = { useDefaults: leagueId === 1, tabs: about.forCity(leagueId) };
  const out = vm.runInContext("currentLang = __lang; aboutPageHtml(__data)", context);
  return localizeLinks(out, context.__lang, pageUrl, base);
}

// the place of the page file where the text goes
function injectInto(page, opts) {
  return page.replace('<!--ABOUT_PAGE-->', () => html(opts));
}

module.exports = { html, injectInto };
