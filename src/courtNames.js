// The names of the courts of a tournament. The courts are 1 … n inside the app (matches.court_no); the organiser may give each one its own name as the club marks it
// (one court "Kurt 6", another "Kurt 1", or "Centrálny kurt"). Kept in seasons.court_names as a JSON list (index 0 = court 1, '' = the usual "Kurt <number>").

const MAX_NAME = 40;

function namesOf(season) {
  try {
    const list = JSON.parse((season && season.court_names) || '[]');
    return Array.isArray(list) ? list.map((v) => (typeof v === 'string' ? v : '')) : [];
  } catch { return []; }
}

// the name a court shows: its own, or "Kurt <number>"
const label = (names, n) => (names && names[n - 1]) || `Kurt ${n}`;

// the list sent by the admin page (one entry per court) -> { names } cut or padded to the number of courts, or { error }
function parse(raw, count) {
  if (!Array.isArray(raw)) return { error: 'courtNames must be a list with one name (or nothing) for each court' };
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const v = raw[i];
    if (v === undefined || v === null) { names.push(''); continue; }
    if (typeof v !== 'string') return { error: `Court ${i + 1}: the name must be text` };
    const text = v.replace(/\s+/g, ' ').trim();
    if (Array.from(text).length > MAX_NAME) return { error: `Court ${i + 1}: the name is too long (max ${MAX_NAME} characters)` };
    names.push(text);
  }
  const seen = new Set();
  for (let i = 0; i < names.length; i += 1) {
    const shown = label(names, i + 1).toLowerCase();
    if (seen.has(shown)) return { error: `Two courts have the same name (${label(names, i + 1)})` };
    seen.add(shown);
  }
  return { names };
}

// the stored list when the number of courts changes: cut or padded
const fit = (season, count) => { const list = namesOf(season).slice(0, count); while (list.length < count) list.push(''); return list; };

module.exports = { namesOf, label, parse, fit, MAX_NAME };
