// The footer of every public page: a card with the logo, the name of the league and a short description on the left, three groups of links on the right
// and a row of the other cities, then the small print. It is one piece of code for the whole site (the pages carry a plain old footer in their files; this
// replaces it on the way out, so the links are in the HTML that search engines read), and it speaks for the city of the page: its name, its language
// (/en/… is English) and its address under slta.sk/<city>.
// Not on the backend, the embeds for other websites and the login pages (they keep the plain one).
const db = require('./db');
const seo = require('./seo');
const leagues = require('./leagues');
const national = require('./national');
const contact = require('./routes/contact');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// [code address of the page, Slovak, English]; the public address of each comes from Backend > SEO (seo.pageUrl), so a changed slug follows
const GROUPS = [
  { sk: 'Liga', en: 'League', links: [['/matches', 'Zápasy', 'Matches'], ['/tables', 'Tabuľky', 'Tables'], ['/rankings', 'Rebríčky', 'Rankings'], ['/players', 'Hráči', 'Players'], ['/harmonogram', 'Harmonogram', 'Schedule'], ['/vitazi', 'Víťazi', 'Winners']] },
  { sk: 'Hrať', en: 'Play', links: [['/looking-to-play', 'Hľadám súpera', 'Find an opponent'], ['/new-match', 'Nový zápas', 'New match'], ['/reservations', 'Rezervácie kurtov', 'Court booking'], ['/courts', 'Tenisové kurty', 'Tennis courts'], ['/courtiq', 'CourtIQ', 'CourtIQ']] },
  { sk: 'Komunita', en: 'Community', links: [['/communities', 'Komunity a kluby', 'Communities and clubs'], ['/blog', 'Blog', 'Blog'], ['/propozicie', 'Propozície', 'Rules'], ['#kontakt', 'Kontakt', 'Contact']] },
];
const NATIONAL_GROUPS = [
  { sk: 'SLTA', en: 'SLTA', links: [['#mesta', 'Mestá', 'Cities'], ['/slta-rankings', 'Rebríčky miest', 'City rankings'], ['#ako', 'Ako to funguje', 'How it works'], ['#funkcie', 'Funkcie', 'Features']] },
  { sk: 'Organizátori', en: 'Organisers', links: [['#organizator', 'Staň sa organizátorom', 'Become the organiser'], ['#otazky', 'Otázky a odpovede', 'Questions and answers']] },
];

const TEXT = {
  sk: {
    nav: 'Pätička stránky', cities: 'Mestá SLTA', admin: 'Admin', sitemap: 'Mapa stránok', home: 'Domov',
    descBlta: 'Liga pre rekreačných a amatérskych tenistov v Bratislave. Živé skóre, tabuľky, rebríčky, turnaje a kurty na jednom mieste.',
    descCity: (brand) => `Liga pre rekreačných a amatérskych tenistov – ${brand}. Živé skóre, tabuľky, rebríčky a turnaje na jednom mieste.`,
    descNational: 'Slovenská liga tenisových amatérov. Vyber si svoje mesto, zaregistruj sa a hraj ligu na svojej úrovni.',
  },
  en: {
    nav: 'Site footer', cities: 'SLTA cities', admin: 'Admin', sitemap: 'Sitemap', home: 'Home',
    descBlta: 'A league for recreational and amateur tennis players in Bratislava. Live scores, tables, rankings, tournaments and courts in one place.',
    descCity: (brand) => `A league for recreational and amateur tennis players – ${brand}. Live scores, tables, rankings and tournaments in one place.`,
    descNational: 'The Slovak Amateur Tennis League. Pick your city, sign up and play a league at your level.',
  },
};

// the icons are simple outlines (no icon font on the site); the label is for screen readers
const ICON = {
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  whatsapp: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
};
const SOCIAL = [['instagramUrl', 'instagram', 'Instagram'], ['facebookUrl', 'facebook', 'Facebook'], ['youtubeUrl', 'youtube', 'YouTube'], ['whatsappUrl', 'whatsapp', 'WhatsApp']];

// the other cities, as the visitor reaches them: a city with a domain of its own there, any other under the national address (slta.sk/<slug>)
function cityPills(req, currentId, isNational) {
  const natOrigin = national.siteOrigin(req);
  const rows = db.prepare("SELECT * FROM leagues WHERE status != 'HIDDEN' ORDER BY sort_order, name").all();
  const pills = rows.filter((r) => isNational || r.id !== currentId).map((r) => ({
    label: r.brand_name || r.name,
    href: r.domain ? `https://${r.domain}` : `${natOrigin || ''}/${r.slug}`,
  }));
  if (!isNational && natOrigin) pills.unshift({ label: 'SLTA', href: natOrigin });
  return pills;
}

function render(req) {
  const lang = /^\/en(\/|$)/.test(req.path || '') ? 'en' : 'sk';
  const T = TEXT[lang];
  const isNational = national.isNationalHost(req) && !req.cityBase;
  const league = req.league || leagues.byId(1);
  const first = !isNational && league && league.id === leagues.DEFAULT_LEAGUE_ID;
  const base = req.cityBase || '';
  const brand = isNational ? 'SLTA' : (league.brand_name || league.name);
  // a #… link stays on the page (the contact window, the parts of the national page); the others go to the page of the city, in the language of the page
  const url = (code) => (code.startsWith('#') ? code : `${base}${seo.pageUrl(code, lang)}`);
  const groups = (isNational ? NATIONAL_GROUPS : GROUPS).map((g) => `
        <div class="sf-group">
          <h2 class="sf-h">${esc(g[lang])}</h2>
          <ul>${g.links.map(([code, sk, en]) => `<li><a href="${esc(url(code))}">${esc(lang === 'en' ? en : sk)}</a></li>`).join('')}</ul>
        </div>`).join('');

  const info = first ? contact.read() : null;
  const social = info ? SOCIAL.filter(([key]) => /^https?:\/\//.test(info[key] || '')).map(([key, icon, label]) => `<li><a href="${esc(info[key])}" target="_blank" rel="noopener me" aria-label="${label}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[icon]}</svg></a></li>`).join('') : '';
  const address = info && info.address ? `<address class="sf-address">${esc(info.address).replace(/\r?\n/g, '<br>')}${info.email ? `<br><a href="mailto:${esc(info.email)}">${esc(info.email)}</a>` : ''}</address>` : '';
  const logo = first
    ? '<img src="/img/blta-logo-sm.png" alt="" width="136" height="102">'
    : '<img src="/img/slta-logo.png" alt="" width="500" height="141" class="sf-logo-wide">';
  // the logo of SLTA already says SLTA: next to it only the name of the city
  const shownName = first ? brand : isNational ? '' : league.name;
  const nameHtml = shownName ? `<span class="sf-name">${esc(shownName)}</span>` : '';
  const desc = isNational ? T.descNational : first ? T.descBlta : T.descCity(brand);
  const pills = cityPills(req, league && league.id, isNational);
  const legal = first && info && info.orgName ? ` · ${esc(info.orgName)}${info.ico ? ` · IČO ${esc(info.ico)}` : ''}` : '';
  const homeHref = isNational ? (lang === 'en' ? '/en' : '/') : `${base}${seo.pageUrl('/', lang)}` || '/';

  return `<footer class="site-footer sf">
  <div class="sf-wrap">
    <div class="sf-main">
      <div class="sf-brand">
        <a class="sf-logo" href="${esc(homeHref)}" aria-label="${esc(brand)} – ${esc(T.home)}">${logo}${nameHtml}</a>
        <p class="sf-desc">${esc(desc)}</p>
        ${address}
        ${social ? `<ul class="sf-social">${social}</ul>` : ''}
      </div>
      <nav class="sf-nav" aria-label="${esc(T.nav)}">${groups}
      </nav>
    </div>
    ${pills.length ? `<div class="sf-cities"><span>${esc(T.cities)}:</span>${pills.map((p) => `<a class="sf-pill" href="${esc(p.href)}" data-nobase>${esc(p.label)}</a>`).join('')}</div>` : ''}
    <div class="sf-bottom"><span>© ${new Date().getFullYear()} ${esc(brand)}${legal}</span><div class="sf-legal"><a href="/sitemap.xml">${esc(T.sitemap)}</a><a href="${esc(`${base}/admin`)}">${esc(T.admin)}</a></div></div>
  </div>
</footer>`;
}

// Where the footer must not go: the backend, the embeds for other websites, the helper pages
const NO_FOOTER = /^\/(admin|login-history|reset-code|embed\/|compact)|-admin(\/|$)|\/(embed\/|compact)/;
const OLD_FOOTER = /<footer class="(?:site-footer|sl-foot)">[\s\S]*?<\/footer>/;
const LOCALIZE = '<script src="/js/localize.js"></script>';

function inject(html, req) {
  if (NO_FOOTER.test(req.path || '') || NO_FOOTER.test(req.originalUrl || '')) return html;
  if (OLD_FOOTER.test(html)) return html.replace(OLD_FOOTER, () => render(req));
  // a page that has only a credit line (the bracket page): the footer goes in front of the scripts
  return html.includes(LOCALIZE) && /<footer/.test(html) ? html.replace(LOCALIZE, () => `${render(req)}\n${LOCALIZE}`) : html;
}

// Express middleware: every HTML page that is sent as a string gets the footer (the pages are all built as strings by the server, see src/seo.js)
function middleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const send = res.send.bind(res);
  res.send = (body) => (typeof body === 'string' && /^\s*<!doctype html|^\s*<html/i.test(body) && res.statusCode < 400 ? send(inject(body, req)) : send(body));
  return next();
}

module.exports = { render, inject, middleware };
