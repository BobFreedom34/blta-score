// The national site of SLTA (Slovenská liga tenisových amatérov): slta.sk. Its main page is the picker of the cities; every other address
// of the app belongs to a city (Bratislava is blta.sk). Requests that come in on a national host are told apart here, the app serves them
// the national page and the files the page needs, and sends everything else on to the city it belongs to (for now the first city).
//
// The national site can be locked with a password while it is being prepared (Backend > Cities): the page and the list of the cities then
// ask for it (a visitor who knows it gets a cookie for 30 days) and search engines are told to stay away. The password is kept as a hash.
//
// NATIONAL_HOSTS: a comma list of host names (default: slta.sk, www.slta.sk and slta.localhost for trying it out at home).
const crypto = require('crypto');
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

// ---------- the password ----------

const COOKIE = 'slta_access';
const DAYS = 30;
const getSetting = (key) => (db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key) || {}).value || '';
const putSetting = (key, value) => db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

const isLocked = () => getSetting('national_lock_on') === '1' && !!getSetting('national_lock_hash');
const hasPassword = () => !!getSetting('national_lock_hash');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function checkPassword(password) {
  const [salt, hash] = getSetting('national_lock_hash').split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(String(password || ''), salt, 32);
  const wanted = Buffer.from(hash, 'hex');
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

// Turns the lock on or off. Turning it on needs a password (6 characters at least) unless one is already kept; a new one replaces the old
// one, and every cookie given for the old one stops working. -> { error } | { locked }
function setLock({ enabled, password }) {
  if (!enabled) { putSetting('national_lock_on', '0'); return { locked: false }; }
  const given = typeof password === 'string' ? password : '';
  if (given) {
    if (given.length < 6) return { error: 'The password needs at least 6 characters' };
    if (given.length > 100) return { error: 'The password is too long' };
    putSetting('national_lock_hash', hashPassword(given));
  } else if (!hasPassword()) {
    return { error: 'Set a password to lock the site' };
  }
  putSetting('national_lock_on', '1');
  return { locked: true };
}

// the cookie of a visitor who knew the password: expiry + a signature that stops being right when the password changes
const secretKey = () => `${process.env.SESSION_SECRET || 'dev-only-insecure-secret'}:${getSetting('national_lock_hash')}`;
const sign = (exp) => crypto.createHmac('sha256', secretKey()).update(String(exp)).digest('hex');
function hasAccess(req) {
  const [exp, sig] = String((req.cookies && req.cookies[COOKIE]) || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const right = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return right.length === got.length && crypto.timingSafeEqual(right, got);
}

// at most 8 wrong passwords in 10 minutes from one address
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) return false;
  return a.count >= 8;
}
function failed(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + 10 * 60 * 1000 });
  else a.count += 1;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WORDS = {
  sk: { title: 'SLTA - Slovenská liga tenisových amatérov', h: 'Stránka sa pripravuje', p: 'Prístup majú zatiaľ len pozvaní. Zadaj heslo.', label: 'Heslo', go: 'Vstúpiť', wrong: 'Nesprávne heslo.', many: 'Príliš veľa pokusov. Skús to o niekoľko minút.' },
  en: { title: 'SLTA - Slovak Amateur Tennis League', h: 'This site is being prepared', p: 'For the moment only invited people have access. Enter the password.', label: 'Password', go: 'Enter', wrong: 'Wrong password.', many: 'Too many attempts. Try again in a few minutes.' },
};
// the page that asks for the password: self-contained, never indexed
function loginPage(lang, message = '') {
  const w = WORDS[lang] || WORDS.sk;
  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex, nofollow"><title>${esc(w.title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.c{width:min(380px,calc(100% - 40px));text-align:center}.l{font-size:34px;font-weight:800;letter-spacing:.08em;margin-bottom:22px}.l b{color:#ff5500}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#c3c7cf;font-size:15px;line-height:1.5}
input{width:100%;box-sizing:border-box;height:48px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#37373e;color:#fff;font-size:16px;margin-bottom:12px}
input:focus{outline:0;border-color:#ff5500}button{width:100%;height:48px;border:0;border-radius:8px;background:#b2fa06;color:#0a0a0a;font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.e{color:#ff6b6b;font-weight:700;margin-bottom:12px;font-size:14px}</style></head>
<body><form class="c" method="post" action="/unlock"><div class="l">S<b>L</b>TA</div><h1>${esc(w.h)}</h1><p>${esc(w.p)}</p>
${message ? `<div class="e">${esc(message)}</div>` : ''}<input type="hidden" name="lang" value="${lang}"><input type="password" name="password" placeholder="${esc(w.label)}" autocomplete="current-password" autofocus required><button type="submit">${esc(w.go)}</button></form></body></html>`;
}

// POST /unlock: the right password gives the cookie and the page, a wrong one the page again
function unlock(req, res) {
  const lang = req.body && req.body.lang === 'en' ? 'en' : 'sk';
  const w = WORDS[lang];
  const ip = req.ip || '';
  if (!isLocked()) return res.redirect(302, lang === 'en' ? '/en' : '/');
  if (tooMany(ip)) return res.status(429).type('html').send(loginPage(lang, w.many));
  if (!checkPassword(req.body && req.body.password)) {
    failed(ip);
    return res.status(401).type('html').send(loginPage(lang, w.wrong));
  }
  const exp = Date.now() + DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE, `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.get('x-forwarded-proto') === 'https', maxAge: DAYS * 24 * 60 * 60 * 1000, path: '/' });
  return res.redirect(302, lang === 'en' ? '/en' : '/');
}

module.exports = { isNationalHost, origin, cityOrigin, isAsset, pageLang, isLocked, hasPassword, setLock, hasAccess, loginPage, unlock };
