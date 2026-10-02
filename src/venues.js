const db = require('./db');

const COURT_TYPES = ['INDOOR', 'OUTDOOR', 'BOTH'];
const SURFACES = ['CLAY', 'HARD', 'ARTIFICIAL_GRASS', 'CARPET', 'GRASS'];
const FACILITIES = [
  'PARKING', 'SHOWERS', 'CHANGING_ROOMS', 'BAR_CAFE', 'RESTAURANT', 'LIGHTING',
  'RACKET_RENTAL', 'COACHING', 'PRO_SHOP', 'WELLNESS', 'MULTISPORT',
];

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'venue';
}

function uniqueSlug(name, excludeId) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM venues WHERE slug = ? AND id != ?').get(slug, excludeId || 0)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

// A venue created before slugs existed has none — give each one once.
function ensureSlugs() {
  db.prepare('SELECT id, name FROM venues WHERE slug IS NULL').all().forEach((v) => {
    db.prepare('UPDATE venues SET slug = ? WHERE id = ?').run(uniqueSlug(v.name, v.id), v.id);
  });
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    area: row.area || null,
    address: row.address || null,
    phone: row.phone || null,
    email: row.email || null,
    website: row.website || null,
    bookingUrl: row.booking_url || null,
    instagram: row.instagram || null,
    facebook: row.facebook || null,
    courtType: row.court_type || null,
    courtsCount: row.courts_count == null ? null : row.courts_count,
    surfaces: parseJsonArray(row.surfaces),
    openingHours: row.opening_hours || null,
    price: row.price || null,
    facilities: parseJsonArray(row.facilities),
    description: row.description || null,
    lat: row.lat == null ? null : row.lat,
    lng: row.lng == null ? null : row.lng,
  };
}

const text = (max) => (value) => {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== 'string') return { error: 'must be text' };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `is too long (max ${max} characters)` };
  return { value: trimmed || null };
};

const url = (value) => {
  const r = text(500)(value);
  if (r.error || !r.value) return r;
  const withScheme = /^https?:\/\//i.test(r.value) ? r.value : `https://${r.value}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname.includes('.')) return { error: 'is not a valid link' };
  } catch {
    return { error: 'is not a valid link' };
  }
  return { value: withScheme };
};

const email = (value) => {
  const r = text(120)(value);
  if (r.error || !r.value) return r;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.value) ? r : { error: 'is not a valid e-mail address' };
};

// Stored as the bare handle so the page can build the link itself; accepts
// "@name", "name" or a full instagram.com URL.
const instagram = (value) => {
  const r = text(200)(value);
  if (r.error || !r.value) return r;
  const handle = r.value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? { value: handle } : { error: 'is not a valid Instagram handle' };
};

const oneOf = (allowed) => (value) => {
  if (value === null || value === undefined || value === '') return { value: null };
  return allowed.includes(value) ? { value } : { error: 'has an invalid value' };
};

const subsetOf = (allowed) => (value) => {
  if (value === null || value === undefined) return { value: JSON.stringify([]) };
  if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) return { error: 'has an invalid value' };
  return { value: JSON.stringify(allowed.filter((a) => value.includes(a))) };
};

const wholeNumber = (value) => {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 200 ? { value: n } : { error: 'must be a whole number' };
};

const coordinate = (min, max) => (value) => {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? { value: n } : { error: `must be a number between ${min} and ${max}` };
};

// body key -> [column, label, validator]
const FIELDS = {
  area: ['area', 'Area', text(80)],
  address: ['address', 'Address', text(200)],
  phone: ['phone', 'Phone', text(60)],
  email: ['email', 'E-mail', email],
  website: ['website', 'Website', url],
  bookingUrl: ['booking_url', 'Booking link', url],
  instagram: ['instagram', 'Instagram', instagram],
  facebook: ['facebook', 'Facebook', url],
  courtType: ['court_type', 'Court type', oneOf(COURT_TYPES)],
  courtsCount: ['courts_count', 'Number of courts', wholeNumber],
  surfaces: ['surfaces', 'Surfaces', subsetOf(SURFACES)],
  openingHours: ['opening_hours', 'Opening hours', text(200)],
  price: ['price', 'Price', text(120)],
  facilities: ['facilities', 'Facilities', subsetOf(FACILITIES)],
  description: ['description', 'Description', text(1000)],
  lat: ['lat', 'Latitude', coordinate(-90, 90)],
  lng: ['lng', 'Longitude', coordinate(-180, 180)],
};

// Validates only the keys present in `body` (so PATCH can be partial) and
// returns { columns } to write, or { error }.
function parseDetails(body) {
  const columns = {};
  for (const [key, [column, label, validate]] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const result = validate(body[key]);
    if (result.error) return { error: `${label} ${result.error}` };
    columns[column] = result.value;
  }
  const hasLat = Object.prototype.hasOwnProperty.call(columns, 'lat');
  const hasLng = Object.prototype.hasOwnProperty.call(columns, 'lng');
  if (hasLat !== hasLng || (hasLat && (columns.lat === null) !== (columns.lng === null))) {
    return { error: 'Latitude and longitude must be set together' };
  }
  return { columns };
}

// ---------- Matching a match's free-text location to a venue ----------
// People type "Dudova", "Tennis One", "Eci", "Inter"… rather than the exact
// venue name, so each venue gets a few derived aliases: its full name, the
// name without generic words (TK, TKP, Kurty…) or a trailing "Bratislava",
// and each side of a "Club - Place" name. An alias that two venues share
// (e.g. "Zlaté Piesky") is dropped — better to match nothing than the
// wrong venue.
const GENERIC_WORDS = new Set(['tk', 'tkp', 'tc', 'kurty', 'kurt', 'tenisovy', 'klub', 'tenis']);

function words(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripGeneric(phrase) {
  let tokens = phrase.split(' ').filter(Boolean);
  while (tokens.length > 1 && GENERIC_WORDS.has(tokens[0])) tokens = tokens.slice(1);
  if (tokens.length > 1 && tokens[tokens.length - 1] === 'bratislava') tokens = tokens.slice(0, -1);
  return tokens.join(' ');
}

function venueAliases(name) {
  const aliases = new Set();
  // "Tennis" is routinely typed the Slovak way ("Tenis one"), so both spellings count.
  const add = (phrase) => {
    if (phrase.replace(/ /g, '').length < 3) return;
    aliases.add(phrase);
    aliases.add(phrase.replace(/\btennis\b/g, 'tenis'));
  };
  add(words(name));
  add(stripGeneric(words(name)));
  if (/\s[-–—]\s/.test(name)) name.split(/\s[-–—]\s/).forEach((part) => add(stripGeneric(words(part))));
  return aliases;
}

// Returns a function: free-text location -> venue id (or null when it
// matches no venue or is ambiguous between two).
function buildLocationMatcher(venueRows) {
  const byAlias = new Map();
  venueRows.forEach((v) => {
    venueAliases(v.name).forEach((alias) => {
      if (!byAlias.has(alias)) byAlias.set(alias, new Set());
      byAlias.get(alias).add(v.id);
    });
  });
  const usable = [...byAlias.entries()].filter(([, ids]) => ids.size === 1).map(([alias, ids]) => [alias, [...ids][0]]);

  return (location) => {
    const loc = words(location);
    if (!loc) return null;
    const padded = ` ${loc} `;
    const compact = loc.replace(/ /g, '');
    let best = null;
    let bestLen = 0;
    let tie = false;
    usable.forEach(([alias, id]) => {
      const compactAlias = alias.replace(/ /g, '');
      // Whole-word match; or, for longer aliases, ignoring spaces ("Fitcamp" = "Fit Camp").
      const hit = padded.includes(` ${alias} `) || (compactAlias.length >= 7 && compact.includes(compactAlias));
      if (!hit) return;
      if (compactAlias.length > bestLen) { best = id; bestLen = compactAlias.length; tie = false; } else if (compactAlias.length === bestLen && id !== best) tie = true;
    });
    return tie ? null : best;
  };
}

module.exports = {
  COURT_TYPES, SURFACES, FACILITIES, slugify, uniqueSlug, ensureSlugs, serialize, parseDetails, buildLocationMatcher,
};
