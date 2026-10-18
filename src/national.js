// The national site of SLTA (Slovenská liga tenisových amatérov): slta.sk. Its main page is the picker of the cities; every other address
// of the app belongs to a city (Bratislava is blta.sk). Requests that come in on a national host are told apart here, the app serves them
// the national page and the files the page needs, and sends everything else on to the city it belongs to (for now the first city).
//
// NATIONAL_HOSTS: a comma list of host names (default: slta.sk, www.slta.sk and slta.localhost for trying it out at home).
const db = require('./db');

const HOSTS = new Set(String(process.env.NATIONAL_HOSTS || 'slta.sk,www.slta.sk,slta.localhost').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

const hostOf = (req) => String(req.hostname || '').toLowerCase();
const isNationalHost = (req) => HOSTS.has(hostOf(req));

// the address the national site is known by: https://slta.sk (without www); a host of its own at home keeps its protocol and port
function origin(req) {
  const host = hostOf(req).replace(/^www\./, '');
  if (host.endsWith('.localhost')) return `${req.protocol}://${req.get('host')}`;
  return `https://${host}`;
}

// where an address that is not the national page goes: the first city's own domain (the same path), else nowhere
function cityOrigin() {
  const first = db.prepare('SELECT domain FROM leagues WHERE id = 1').get();
  return first && first.domain ? `https://${first.domain}` : null;
}

// the files the national page needs, and the public list of the cities it shows
const ASSET = /^\/(css|js|img|fonts)\//;
const FILE = /\.(png|jpe?g|svg|ico|webp|woff2?|json|txt|xml)$/i;
function isAsset(path) { return ASSET.test(path) || FILE.test(path); }

// the national page's addresses: / (Slovak) and /en (English)
function pageLang(path) {
  if (path === '/' || path === '') return 'sk';
  if (path === '/en' || path === '/en/') return 'en';
  return null;
}

module.exports = { isNationalHost, origin, cityOrigin, isAsset, pageLang };
