// Google Tag Manager for the two websites (Backend > Tracking, super admin): one container ID for blta.sk and one for slta.sk (with all its cities).
// The snippet goes into the <head> of every public page on the server (see middleware() below); the backend, the embeds for other websites and the
// pages that are no pages (files, JSON) are left alone. With "ask for consent" on (the default) the container starts with every kind of storage denied
// (Google Consent Mode v2) and a small banner (public/js/consent.js) asks the visitor; the choice is remembered in the browser and handed to the container.
const db = require('./db');
const national = require('./national');

const SITES = ['blta', 'slta'];
const ID = /^GTM-[A-Z0-9]{4,12}$/;
const KEY = (site) => `tracking_${site}`;

const cache = new Map();
function get(site) {
  if (!SITES.includes(site)) return { gtmId: '', consent: true };
  if (!cache.has(site)) {
    const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(KEY(site));
    let saved = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
    cache.set(site, { gtmId: ID.test(saved.gtmId || '') ? saved.gtmId : '', consent: saved.consent !== false });
  }
  return cache.get(site);
}

// { error } or the saved values. An empty ID switches the site's tag off.
function set(site, body) {
  if (!SITES.includes(site)) return { error: 'Unknown site', status: 404 };
  const gtmId = String((body && body.gtmId) || '').trim().toUpperCase();
  if (gtmId && !ID.test(gtmId)) return { error: 'The Tag Manager ID looks like GTM-ABC1234 (letters and digits after GTM-)' };
  const value = { gtmId, consent: !(body && body.consent === false) };
  db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY(site), JSON.stringify(value));
  cache.delete(site);
  return value;
}

// which of the two websites a request is for: slta.sk (and its cities, slta.sk/<city>) is SLTA, every other address (blta.sk) is BLTA
const siteOf = (req) => (national.isNationalHost(req) ? 'slta' : 'blta');

const GRANTED = "{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'}";
const DENIED = "{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'}";

// the code for the <head>: the tag, and in front of it the consent defaults and the visitor's earlier choice
function snippet(settings) {
  if (!settings.gtmId) return '';
  const consent = settings.consent
    ? `function gtag(){dataLayer.push(arguments)}gtag('consent','default',Object.assign(${DENIED},{wait_for_update:500}));try{if(localStorage.getItem('blta-cookies')==='granted')gtag('consent','update',${GRANTED})}catch(e){}`
    : '';
  const tag = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','${settings.gtmId}');`;
  return `<!-- Google Tag Manager --><script>window.dataLayer=window.dataLayer||[];${consent}${tag}</script>${settings.consent ? '<script src="/js/consent.js" defer></script>' : ''}<!-- End Google Tag Manager -->`;
}

// Where the tag does not belong: the backend, the pages other websites put in a frame, the pages of the login and the history of logins.
const NO_TAG = /^\/(admin|login-history|reset-code|embed\/|compact)|-admin(\/|$)|\/(embed\/|compact)/;
const HEAD = /<head(\s[^>]*)?>/i;
// The tag is the first thing in the <head>: before the Google Analytics tag the pages already have by hand, so that the consent defaults are set before it
// starts measuring (the page's charset comes from the Content-Type header, so it does not matter that the tag is ahead of the <meta charset>).

function inject(html, req) {
  if (!HEAD.test(html) || NO_TAG.test(req.path || '') || NO_TAG.test(req.originalUrl || '')) return html;
  const code = snippet(get(siteOf(req)));
  if (!code) return html;
  return html.replace(HEAD, (open) => `${open}\n${code}`);
}

// Express middleware: every HTML page that is sent as a string gets the tag (the pages are all built as strings by the server, see src/seo.js)
function middleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const send = res.send.bind(res);
  res.send = (body) => (typeof body === 'string' && /^\s*<!doctype html|^\s*<html/i.test(body) ? send(inject(body, req)) : send(body));
  return next();
}

module.exports = { SITES, get, set, siteOf, snippet, inject, middleware };
