// The addresses of the public pages in both languages. Slovak lives at the root (/rebricek), English under /en/ (/en/rankings);
// the slugs are edited in Backend > SEO. The code of the app keeps ONE stable name for every page — its "code address", the path
// it always had (/rankings, /player/<slug>…) — and this file turns it into the address of the language in use:
//
//   server  : require('../public/js/localize.js').make(routes)  (src/seo.js: routing, canonical / alternate links, sitemap)
//   browser : GET /js/localize.js adds the routes of the site and calls boot() — every link to a page of the site is rewritten
//             to the language of the page (also the ones the page scripts add later), and the language switch jumps to the
//             same page in the other language.
//
// routes = [{ key, path: '/rankings' | '/season/:slug' | '/', template: bool, sk: 'rebricek', en: 'rankings' }] — for a template
// page the slug is the first segment (/serie/<season>), for the home page it is empty.
//
// overrides = [{ code: '/courts/fit-camp', sk: 'kurty-fit-camp', en: 'fit-camp-courts' }] — a page with a name can have a whole address of
// its own per language (one segment, kept from the old website so the search engines find it where it always was); a language with
// no address there keeps the pattern (/tenisove-kurty/fit-camp).
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.BLTA_LOCALIZE = lib;
}(typeof self !== 'undefined' ? self : this, function () {
  const EN = '/en';
  const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';
  const prefix = (lang) => (lang === 'en' ? EN : '');

  function make(routes, overrides) {
    const fixed = routes.filter((r) => !r.template);
    const templates = routes.filter((r) => r.template);
    const baseOf = (r) => r.path.split('/')[1];
    const own = overrides || [];
    const ownByCode = new Map(own.map((o) => [o.code, o]));
    const ownBySlug = (lang, slug) => own.find((o) => o[lang] === slug) || null;

    // The address of a page in a language; `param` is the season / player / venue / bracket for a template page.
    function publicPath(route, lang, param) {
      if (route.template) return `${prefix(lang)}/${route[lang]}/${param}`;
      if (!route[lang]) return lang === 'en' ? EN : '/';
      return `${prefix(lang)}/${route[lang]}`;
    }

    // A code address (with a ?query / #hash, if any) -> the address in `lang`; null when it is not a page of the site.
    function toPublic(address, lang) {
      const m = /^([^?#]*)([\s\S]*)$/.exec(String(address || ''));
      const path = clean(m[1] || '/');
      const tail = m[2];
      const page = fixed.find((r) => r.path === path);
      if (page) return publicPath(page, lang) + tail;
      const custom = ownByCode.get(path);
      if (custom && custom[lang]) return `${prefix(lang)}/${custom[lang]}${tail}`;
      const tpl = templates.find((r) => path.startsWith(`/${baseOf(r)}/`) && path.length > baseOf(r).length + 2);
      if (tpl) return publicPath(tpl, lang, path.slice(baseOf(tpl).length + 2)) + tail;
      return null;
    }

    // A public address -> { route, key, lang, param, canonical } (canonical = the code address); null when it is none.
    function resolve(address) {
      const path = clean(String(address || '/').split(/[?#]/)[0] || '/');
      let lang = 'sk';
      let rest = path;
      if (path === EN || path.startsWith(`${EN}/`)) { lang = 'en'; rest = path.slice(EN.length) || '/'; }
      const segs = rest.split('/').filter(Boolean);
      let route = null;
      let param = null;
      if (!segs.length) route = fixed.find((r) => r.path === '/') || null;
      else if (segs.length === 1) {
        route = fixed.find((r) => r.path !== '/' && r[lang] === segs[0]) || null;
        const custom = route ? null : ownBySlug(lang, segs[0]);
        if (custom) {
          const tpl = templates.find((r) => custom.code.startsWith(`/${baseOf(r)}/`));
          if (tpl) return { route: tpl, key: tpl.key, lang, param: custom.code.slice(baseOf(tpl).length + 2), canonical: custom.code, custom: true };
        }
      }
      else if (segs.length === 2) { route = templates.find((r) => r[lang] === segs[0]) || null; param = segs[1]; }
      if (!route) return null;
      return { route, key: route.key, lang, param, canonical: route.template ? route.path.replace(/:[^/]+$/, () => param) : route.path };
    }

    // The address a page with a name has of its own, when it is asked for in the pattern form (which is retired then).
    function movedTo(hit) {
      if (!hit || !hit.route.template || hit.custom) return null;
      const custom = ownByCode.get(hit.canonical);
      return custom && custom[hit.lang] ? `${prefix(hit.lang)}/${custom[hit.lang]}` : null;
    }

    return { routes, overrides: own, publicPath, toPublic, resolve, movedTo };
  }

  // ---------- the browser ----------
  function boot(routes, overrides) {
    const lib = make(routes, overrides);
    const page = lib.resolve(location.pathname);
    const storedLang = () => { try { const s = localStorage.getItem('blta_lang'); return s === 'en' ? 'en' : 'sk'; } catch { return 'sk'; } };
    // the language in use: i18n.js has settled it by the time a link is looked at
    const curLang = () => (typeof currentLang !== 'undefined' ? currentLang : (page ? page.lang : storedLang()));
    const localUrl = (address) => lib.toPublic(address, curLang()) || address;

    const done = new WeakMap(); // anchor -> the href it carries after the rewrite (so it is not rewritten twice)
    function fix(a) {
      const raw = a.getAttribute('href');
      if (!raw || raw.charAt(0) === '#' || done.get(a) === raw) return;
      let url;
      try { url = new URL(raw, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      const pub = lib.toPublic(url.pathname + url.search + url.hash, curLang());
      const next = pub ? (/^https?:/i.test(raw) ? url.origin + pub : pub) : raw;
      // the code address stays on the link, so a style can find "the Players link" whatever its address is (the menu icons do)
      if (pub) a.setAttribute('data-code', url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname);
      else a.removeAttribute('data-code');
      if (next !== raw) a.setAttribute('href', next);
      done.set(a, next);
    }
    function scan(node) {
      if (node.nodeType !== 1) return;
      if (node.matches('a[href]')) fix(node);
      node.querySelectorAll('a[href]').forEach(fix);
    }
    new MutationObserver((records) => {
      records.forEach((r) => {
        if (r.type === 'attributes') fix(r.target);
        else r.addedNodes.forEach(scan);
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('a[href]').forEach(fix));

    // The same page in the other language (query and #hash kept); null on a page that has no address of its own per language.
    const switchUrl = (lang) => (page ? lib.toPublic(page.canonical + location.search + location.hash, lang) : null);

    window.BLTA_LOCALIZE = Object.assign({}, lib, { page, localUrl, switchUrl });
  }

  return { make, boot };
}));
