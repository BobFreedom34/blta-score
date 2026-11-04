// The most players that can register for a tournament or a season, and the substitutes (náhradníci) after them. Nothing about "who is a substitute" is stored:
// the order of the registrations decides (who registered first is in), so the moment somebody drops out - or the maximum is raised - the first substitute is in,
// whatever way it came about.
//
//   - a tournament, or a season played without categories: one maximum for everybody (max_players; for a doubles tournament it counts PAIRS: both partners may
//     register the same pair, that is one place)
//   - a season where the player chooses a category when registering: a maximum for each category (category_max, JSON { ELITE: 16, ... })
//   - no maximum (NULL / not set): everybody is in (events made before the maximum existed)
const db = require('./db');
const nameMatch = require('./nameMatch');

const CATEGORY_KEYS = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// a season where the registration form asks for the category (a tournament never does: the organiser sorts the players afterwards)
const choosesCategory = (season) => season.kind !== 'TOURNAMENT' && season.categories !== 'OPEN';
const isDoubles = (season) => season.kind === 'TOURNAMENT' && season.play_type === 'DOUBLES';

// the maximums of a season's categories as { ELITE: 16, ... } (only the set ones)
function categoryMaxOf(season) {
  let raw = {};
  try { raw = JSON.parse(season.category_max || '{}') || {}; } catch { raw = {}; }
  const out = {};
  CATEGORY_KEYS.forEach((k) => { const n = Number(raw[k]); if (Number.isInteger(n) && n > 0) out[k] = n; });
  return out;
}

// the maximum for a registration in this category (null = none set)
function limitFor(season, category) {
  if (choosesCategory(season)) return categoryMaxOf(season)[category] || null;
  return season.max_players || null;
}

// is a maximum set for everything the season is played in (what "always enter it" asks for)? A season with categories needs one for each of its categories.
function limitsComplete(season, categoryList) {
  if (choosesCategory(season)) {
    const max = categoryMaxOf(season);
    return (categoryList || []).length > 0 && categoryList.every((c) => max[c] > 0);
  }
  return !!season.max_players;
}

const pairKeyOf = (name, partner) => [nameMatch.key(name), nameMatch.key(partner)].sort().join('|');

// The places in the order they were taken: one per registration, except in a doubles tournament where the registrations of the same pair are one place.
function slotsOf(season) {
  const rows = db.prepare('SELECT id, category, name, partner_name FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(season.id);
  if (!isDoubles(season)) return rows.map((r) => ({ ids: [r.id], category: r.category, pair: null }));
  const slots = [];
  const byPair = new Map();
  rows.forEach((r) => {
    const pair = r.partner_name ? pairKeyOf(r.name, r.partner_name) : `solo:${r.id}`;
    if (byPair.has(pair)) { byPair.get(pair).ids.push(r.id); return; }
    const slot = { ids: [r.id], category: r.category, pair };
    byPair.set(pair, slot);
    slots.push(slot);
  });
  return slots;
}

const groupOf = (season, category) => (choosesCategory(season) ? category : '');

// every registration of the season -> { substitute, position }: position 1, 2, 3 ... among the substitutes of its group (null for a player who is in)
function standing(season) {
  const taken = new Map();
  const waiting = new Map();
  const out = new Map();
  slotsOf(season).forEach((slot) => {
    const key = groupOf(season, slot.category);
    const limit = limitFor(season, key);
    const n = (taken.get(key) || 0) + 1;
    taken.set(key, n);
    let state;
    if (limit && n > limit) {
      const w = (waiting.get(key) || 0) + 1;
      waiting.set(key, w);
      state = { substitute: true, position: w };
    } else state = { substitute: false, position: null };
    slot.ids.forEach((id) => out.set(id, state));
  });
  return out;
}

// the ids that are substitutes now
const substituteIds = (season) => new Set([...standing(season)].filter(([, s]) => s.substitute).map(([id]) => id));

// Would a new registration (in this category; for a doubles tournament: this player and partner) be a substitute right now?
function wouldWait(season, category, pair) {
  const key = groupOf(season, category);
  const limit = limitFor(season, key);
  if (!limit) return false;
  const slots = slotsOf(season);
  if (isDoubles(season) && pair && pair.name && pair.partner) {
    const wanted = pairKeyOf(pair.name, pair.partner);
    const same = slots.find((s) => s.pair === wanted);
    if (same) return !!standing(season).get(same.ids[0]).substitute; // the partner already registered the pair: the same place
  }
  return slots.filter((s) => groupOf(season, s.category) === key).length >= limit;
}

// how many are in and how many wait, per group: { '': { limit, in, waiting } } or { ELITE: {...}, ... } - for the pages
function counts(season) {
  const state = standing(season);
  const slots = slotsOf(season);
  const out = {};
  const keys = choosesCategory(season) ? CATEGORY_KEYS : [''];
  keys.forEach((k) => {
    const mine = slots.filter((s) => groupOf(season, s.category) === k);
    const waiting = mine.filter((s) => state.get(s.ids[0]).substitute).length;
    out[k] = { limit: limitFor(season, k), in: mine.length - waiting, waiting };
  });
  return out;
}

module.exports = { CATEGORY_KEYS, choosesCategory, isDoubles, categoryMaxOf, limitFor, limitsComplete, standing, substituteIds, wouldWait, counts };
