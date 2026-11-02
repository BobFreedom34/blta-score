// The app of a community or club: the web manifest that lets a player put the club on the home screen (named after the club, opening on its page)
// and the icons for it, drawn from the club logo. A club with no usable logo gets the BLTA icons.
// Used by src/routes/communities.js (GET /api/communities/:slug/manifest.json and /icon-<192|512|maskable>.png).
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const db = require('./db');

const IMAGE_DIR = path.join(db.dataDir, 'community-images');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// the size of the icon and how much of it the logo may fill (a maskable icon is cut to a circle or a rounded square by the phone, so it keeps a wider margin)
const VARIANTS = { 192: { size: 192, fill: 0.8 }, 512: { size: 512, fill: 0.8 }, maskable: { size: 512, fill: 0.6 } };
const BLTA_ICONS = { 192: '/icon-192.png', 512: '/icon-512.png', maskable: '/icon-maskable-512.png' };
// a city under the national address (slta.sk/<city>) has the SLTA icons instead
const SLTA_ICONS = { 192: '/img/slta/icon-192.png', 512: '/img/slta/icon-512.png', maskable: '/img/slta/icon-maskable-512.png' };
const SHORT_NAME_MAX = 14;

// a logo is drawn once per picture: a new upload has a new file name, so a changed logo never meets the old drawing
const cache = new Map();

function iconPng(logoUrl, variant) {
  const spec = VARIANTS[variant];
  if (!spec || typeof logoUrl !== 'string' || !logoUrl.startsWith('/community-images/')) return null;
  const key = `${logoUrl}|${variant}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const file = path.join(IMAGE_DIR, path.basename(logoUrl));
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return null;
    const data = fs.readFileSync(file).toString('base64');
    const box = Math.round(spec.size * spec.fill);
    const offset = Math.round((spec.size - box) / 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${spec.size}" height="${spec.size}" viewBox="0 0 ${spec.size} ${spec.size}">`
      + `<rect width="${spec.size}" height="${spec.size}" fill="#ffffff"/>`
      + `<image x="${offset}" y="${offset}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" xlink:href="data:${mime};base64,${data}"/></svg>`;
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: spec.size } }).render().asPng();
    cache.set(key, png);
    return png;
  } catch {
    return null;
  }
}

// the address of the BLTA icon that stands in for a club icon
const fallbackIcon = (variant, cityBase = '') => (cityBase ? SLTA_ICONS : BLTA_ICONS)[variant] || null;

// `org` is the organisations row (name, slug, logo_url); `page` is the PUBLIC address of the club page (the code address /community/<slug> is no page, see
// seo.pageUrl), `cityBase` the prefix of a city under the national address ('/kosice') or ''. The app stays inside its city: scope and icons carry the prefix.
function manifestFor(org, { page, cityBase = '' }) {
  // the club's own icons only when its logo can really be drawn (the three icons are cached after the first drawing)
  const own = !!org.logo_url && ['192', '512', 'maskable'].every((v) => iconPng(org.logo_url, v));
  const icon = (variant, size, purpose) => ({
    src: own ? `${cityBase}/api/communities/${encodeURIComponent(org.slug)}/icon-${variant}.png` : fallbackIcon(variant, cityBase),
    sizes: `${size}x${size}`, type: 'image/png', purpose,
  });
  const name = String(org.name || '');
  return {
    id: page,
    name,
    short_name: name.length > SHORT_NAME_MAX ? `${name.slice(0, SHORT_NAME_MAX - 1).trimEnd()}…` : name,
    description: `${name} - komunita a klub na BLTA`,
    start_url: `${page}?app=1`,
    scope: `${cityBase}/`,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0a0a0a',
    orientation: 'portrait-primary',
    icons: [icon('192', 192, 'any'), icon('512', 512, 'any'), icon('maskable', 512, 'maskable')],
  };
}

module.exports = { iconPng, fallbackIcon, manifestFor };
