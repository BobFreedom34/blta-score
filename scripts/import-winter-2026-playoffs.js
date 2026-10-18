// Adds the play-off brackets of the Winter Opening Series 2026 (Elite 16, Next Gen 8, Novice 8 players), with all results, to the app. They were
// played on Rankedin and shown on the old blta.sk; the draws are kept in scripts/data/winter-opening-2026-playoffs.json.
// The brackets are historical: no `matches` rows are created, so rankings, CourtIQ and player statistics do not change — each result is a
// hand-entered result on the bracket (the same as Backend > Brackets > "past bracket").
//
// Run: node scripts/import-winter-2026-playoffs.js --base https://blta.sk            -> only looks (reads the public API, changes nothing)
//      ADMIN_PASSWORD=... node scripts/import-winter-2026-playoffs.js --base https://blta.sk --apply   -> creates the brackets
// A category that already has a bracket in the season is left alone; the whole check runs first and nothing is written when any player
// or the season cannot be found.
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'winter-opening-2026-playoffs.json'), 'utf8'));
const CATEGORY_TITLE = { ELITE: 'Elite Play-off', NEXT_GEN: 'Next Gen Play-off', NOVICE: 'Novice Play-off' };

// Rankedin shows the nicknames the players use; the app has the full first names
const ALIASES = {
  'palo piroha': 'Pavol Piroha',
  'palo blahut': 'Pavol Blahut',
  'robo sloboda': 'Róbert Sloboda',
  'peto hladky': 'Peter Hladký',
  'brano blozon': 'Branislav Bložon',
  'kubo palocny': 'Jakub Paločný',
  'jano szalay': 'Jan Szalay',
};

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const key = (s) => plain(s).replace(/[^a-z0-9]/g, '');

async function run({ base, password, apply = false, log = console.log }) {
  const url = (p) => `${base.replace(/\/$/, '')}${p}`;
  const read = async (p) => {
    const res = await fetch(url(p));
    if (!res.ok) throw new Error(`GET ${p}: ${res.status}`);
    return res.json();
  };

  const seasons = await read('/api/seasons');
  const named = seasons.filter((s) => s.name === DATA.season);
  if (named.length !== 1) throw new Error(named.length ? `Season "${DATA.season}" exists ${named.length} times — not sure which one` : `Season "${DATA.season}" not found`);
  const season = named[0];
  const players = await read('/api/players');
  const byKey = new Map(players.map((p) => [key(p.name), p]));
  const existing = await read(`/api/seasons/${season.id}/brackets`);

  // 1. every player of the draws → a player of the app
  const resolve = (rankedinName) => byKey.get(key(ALIASES[plain(rankedinName)] || rankedinName));
  const missing = new Set();
  Object.values(DATA.brackets).forEach((matches) => matches.forEach((m) => [m.p1, m.p2].forEach((n) => { if (!resolve(n)) missing.add(n); })));
  if (missing.size) throw new Error(`These players are not in the app: ${[...missing].join(', ')}`);
  log(`Season "${season.name}" (id ${season.id}); all ${new Set(Object.values(DATA.brackets).flatMap((ms) => ms.flatMap((m) => [m.p1, m.p2]))).size} players found.`);

  const plan = [];
  for (const [category, matches] of Object.entries(DATA.brackets)) {
    const seeds = new Map();
    matches.filter((m) => m.round === 1).forEach((m) => { seeds.set(m.p1, m.seed1); seeds.set(m.p2, m.seed2); });
    const have = existing.find((b) => b.category === category);
    log(`${CATEGORY_TITLE[category]}: ${seeds.size} players, ${matches.length} matches${have ? ` — already has a bracket (#${have.id}), skipped` : ''}`);
    if (!have) plan.push({ category, matches, seeds });
  }
  if (!apply) { log('Nothing changed. Add --apply (with ADMIN_PASSWORD) to create the brackets.'); return { season, planned: plan.length }; }
  if (!password) throw new Error('ADMIN_PASSWORD is needed with --apply');

  const login = await fetch(url('/api/admin/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!login.ok) throw new Error('Admin login failed');
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = async (method, p, body) => {
    const res = await fetch(url(p), { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${p}: ${json.error || res.status}`);
    return json;
  };

  const created = [];
  for (const { category, matches, seeds } of plan) {
    const entries = [...seeds.entries()].map(([name, seed]) => ({ playerId: resolve(name).id, seed }));
    let bracket = await call('POST', '/api/brackets', {
      name: CATEGORY_TITLE[category], format: 'BO3', category, seasonId: season.id, autoCreateMatches: false, entries,
    });
    try {
      for (const m of [...matches].sort((a, b) => a.round - b.round || a.order - b.order)) {
        const a = resolve(m.p1).id;
        const b = resolve(m.p2).id;
        const node = bracket.nodes.find((n) => n.round === m.round && n.player1 && n.player2 && [n.player1.id, n.player2.id].sort().join() === [a, b].sort().join());
        if (!node) throw new Error(`${category}: no slot for ${m.p1} vs ${m.p2} in round ${m.round} — the seeding differs from the original draw`);
        bracket = await call('PATCH', `/api/brackets/${bracket.id}/nodes/${node.id}/result`, { winnerId: resolve(m.winner).id, score: m.score });
      }
    } catch (err) {
      await call('DELETE', `/api/brackets/${bracket.id}`).catch(() => {});
      throw err;
    }
    created.push(bracket.id);
    log(`${CATEGORY_TITLE[category]}: bracket #${bracket.id} created with ${matches.length} results.`);
  }
  return { season, created };
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  run({ base: opt('--base') || 'http://localhost:3000', password: process.env.ADMIN_PASSWORD, apply: args.includes('--apply') })
    .catch((err) => { console.error(`Failed: ${err.message}`); process.exit(1); });
}
