// Season page (/season/<slug>): one page per season that gathers what already lives elsewhere in the app — the numbers of the
// season (from its dates, groups and players), the group tables, the latest results and next matches, the round schedule, the
// players, the play-off bracket — as tabs: only the chosen tab is shown, and a tab loads its data when it is first opened. Only the entry fee, prize money, draw
// date, description, gallery link and the "paid" ticks are entered for this page (backend > Seasons).
// Data: GET /api/seasons/by-slug/:slug, /api/seasons/:id/standings, /api/seasons/:id/brackets, /api/matches?seasonId=…

const rootEl = document.getElementById('sv-root');
const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
const playerCatName = (c) => (c === 'NONE' ? t('season.noCategory') : CATEGORY_NAMES[c]);

let season = null;
let standings = null;
let winnersEdition = null; // the winners list (Backend > Winners) linked to this season, if there is one
let brackets = [];
let results = [];
let upcoming = [];
let roundMatches = [];
let category = null;
let schedCat = null; // the Rozpis tab's category and group choice (always one of each)
let schedGroup = null;
let playersCat = 'ALL'; // the Hráči tab's category filter
let playoffCat = 'ALL'; // the Play-off tab's category filter
const bracketData = new Map(); // bracket id -> full bracket, cleared whenever the data is refreshed
let tab = null; // the open tab: info, tables, results, schedule, players, playoff or gallery
const loaded = new Set(); // tabs whose data is loaded and still current

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayWord(n) {
  if (n === 1) return t('schedule.dayOne');
  if (currentLang === 'en') return t('schedule.dayMany');
  return n >= 2 && n <= 4 ? t('schedule.dayFew') : t('schedule.dayMany');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

// "Sep – Dec 2026" / "Dec 2025 – Apr 2026"; a tournament shows its exact days: "27. – 28. 9. 2025"
function termText() {
  if (!season.startDate) return '';
  if (season.kind === 'TOURNAMENT') {
    const [y1, m1, d1] = season.startDate.split('-').map(Number);
    if (!season.endDate || season.endDate === season.startDate) return `${d1}. ${m1}. ${y1}`;
    const [y2, m2, d2] = season.endDate.split('-').map(Number);
    if (y1 === y2 && m1 === m2) return `${d1}. – ${d2}. ${m2}. ${y2}`;
    return `${d1}. ${m1}.${y1 === y2 ? '' : ` ${y1}`} – ${d2}. ${m2}. ${y2}`;
  }
  if (!season.endDate) return '';
  const a = new Date(`${season.startDate}T12:00:00`);
  const b = new Date(`${season.endDate}T12:00:00`);
  const loc = currentLang === 'en' ? 'en-GB' : 'sk-SK';
  const month = (d) => d.toLocaleDateString(loc, { month: 'short' }).replace('.', '');
  const first = a.getFullYear() === b.getFullYear() ? month(a) : `${month(a)} ${a.getFullYear()}`;
  return `${first} – ${month(b)} ${b.getFullYear()}`;
}

// ---------- data ----------

async function loadStandings() {
  bracketData.clear();
  try { standings = await api(`/seasons/${season.id}/standings`); } catch { standings = null; }
  try { brackets = await api(`/seasons/${season.id}/brackets`); } catch { brackets = []; }
  try { winnersEdition = (await api('/winners')).find((e) => e.seasonSlug === season.slug) || null; } catch { winnersEdition = null; }
}

async function loadBlocks() {
  const base = `seasonId=${season.id}`;
  const soft = (p) => p.catch(() => []);
  const [finished, live, planned] = await Promise.all([
    soft(api(`/matches?${base}&status=FINISHED&limit=5`)),
    soft(api(`/matches?${base}&status=LIVE`)),
    soft(api(`/matches?${base}&status=PLANNED&limit=5`)),
  ]);
  results = finished;
  upcoming = [...live, ...planned].slice(0, 5);
}

// The matches of every round — the group-stage matches that have a round.
async function loadRound() {
  roundMatches = (await api(`/matches?seasonId=${season.id}`).catch(() => [])).filter((m) => m.round);
}

// ---------- pieces ----------

function statusOf() {
  const today = todayIso();
  if (standings && standings.frozen) return 'past';
  if (season.endDate && season.endDate < today) return 'past';
  if (season.startDate && season.startDate > today) return 'future';
  return 'now';
}

// The players of the season by category (the group is not shown): a group's members (backend), else the names in the group
// tables of a finished season, plus everyone who registered. `paid` is true/false when known (a registration or a group
// member), null when it is not tracked.
function playersModel() {
  const regs = new Map((season.registrations || []).map((r) => [nameKey(r.name), r]));
  const tables = new Map((standings ? standings.groups : []).map((g) => [g.id, g]));
  const people = new Map();
  const add = (name, slug, category, paid) => {
    const key = nameKey(name);
    const known = people.get(key);
    if (known) { if (paid === true) known.paid = true; return; }
    people.set(key, { name, slug, category, paid });
  };
  (season.groups || []).forEach((g) => {
    const members = g.members.filter((m) => !m.withdrawn);
    if (members.length) members.forEach((m) => add(m.name, m.slug, g.category, !!(m.paid || (regs.get(nameKey(m.name)) || {}).paid)));
    else ((tables.get(g.id) || { rows: [] }).rows).forEach((r) => add(r.player.name, r.player.slug, g.category, regs.has(nameKey(r.player.name)) ? regs.get(nameKey(r.player.name)).paid : null));
  });
  // a tournament entry may have no category: those players are listed last, under "Bez kategórie"
  (season.registrations || []).forEach((r) => add(r.name, r.slug, r.category || 'NONE', r.paid));
  const loc = currentLang === 'en' ? 'en' : 'sk';
  const cats = [...CATEGORY_ORDER, 'NONE'].map((category) => ({
    category,
    players: [...people.values()].filter((p) => p.category === category).sort((a, b) => a.name.localeCompare(b.name, loc)),
  })).filter((c) => c.players.length);
  return { cats, total: people.size };
}


function secHead(id, title, linkHref, linkText) {
  if (!title && !linkHref) return '';
  return `<div class="sv-sec-h">${title ? `<h2>${escapeHtml(title)}</h2>` : '<span></span>'}${linkHref ? `<a href="${linkHref}">${escapeHtml(linkText)} ›</a>` : ''}</div>`;
}

// "Registrácia" (opens the form) and "Úhrada štartovného online" (the Stripe payment link set in the backend).
function actionsHtml(status) {
  const buttons = [];
  if (status !== 'past') {
    buttons.push(season.registrationOpen
      ? `<button type="button" class="sv-btn primary" id="sv-register">${escapeHtml(t('season.register'))}</button>`
      : `<span class="sv-btn off">${escapeHtml(t('season.registerClosed'))}</span>`);
  }
  if (season.paymentUrl) buttons.push(`<a class="sv-btn pay" href="${escapeHtml(season.paymentUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.payOnline'))}</a>`);
  return buttons.length ? `<span class="sv-actions">${buttons.join('')}</span>` : '';
}

// A finished series shows its winners under the numbers of the season: per category the winner and the finalist (slots 1 and 2 of
// the winners list linked to this season in Backend > Winners). Nothing entered there yet → no section.
function seriesWinnersHtml() {
  if (statusOf() !== 'past' || !winnersEdition) return '';
  const cards = winnersEdition.blocks
    // a series shows its winner and finalist; a tournament all four places (winner, finalist, two semifinalists)
    .map((b) => ({ b, places: b.places.filter((p) => p.slot === 1 || p.slot === 2 || (isTournament() && (p.slot === 3 || p.slot === 4))) }))
    .filter((x) => x.places.length)
    .map(({ b, places }) => {
      const tiles = places.map((p) => {
        const [tone, labelKey] = p.slot === 1 ? ['win-gold', 'winners.winner'] : p.slot === 2 ? ['win-silver', 'winners.finalist'] : ['win-bronze', 'winners.semifinalist'];
        const photo = p.photoUrl
          ? `<img class="sw-img" src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`
          : `<div class="sw-av">${escapeHtml(initials(p.name))}</div>`;
        const inner = `<div class="sw-ph">${photo}</div><div class="sw-l"><small>${escapeHtml(t(labelKey))}</small><b>${escapeHtml(p.name)}</b></div>`;
        return p.playerId
          ? `<a class="sw-tile ${tone}" href="/player/${encodeURIComponent(p.playerSlug || p.playerId)}">${inner}</a>`
          : `<div class="sw-tile ${tone}">${inner}</div>`;
      }).join('');
      return `<div class="sw-card"><h3 class="sw-cat">${escapeHtml(b.category ? categoryLabel(b.category) : b.title)}</h3><div class="sw-pair${isTournament() ? ' sw-quad' : ''}">${tiles}</div></div>`;
    }).join('');
  if (!cards) return '';
  return `<section class="sw-sec">${secHead('', t(isTournament() ? 'season.winnersTitleTournament' : 'season.winnersTitle'), '/vitazi', t('season.winnersAll'))}<div class="sw-row${isTournament() ? ' sw-row-quad' : ''}">${cards}</div></section>`;
}

// a tournament is a season of its own kind: same page, with a "Turnaj" chip, a venue and its own categories
const isTournament = () => season.kind === 'TOURNAMENT';

function headerHtml() {
  const status = statusOf();
  const today = todayIso();
  let note = '';
  if (status === 'now' && season.endDate) {
    const left = Math.max(0, Math.round((new Date(`${season.endDate}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5));
    note = `<span class="sv-chip w">${escapeHtml(t('schedule.daysLeft', { n: left, d: dayWord(left) }))}</span>`;
  } else if (status === 'future' && season.startDate) {
    const n = Math.round((new Date(`${season.startDate}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
    note = `<span class="sv-chip w">${escapeHtml(t('schedule.startsIn', { n, d: dayWord(n) }))}</span>`;
  }
  const state = status === 'now' ? `<span class="sv-chip now">${escapeHtml(t('schedule.running'))}</span>`
    : status === 'past' ? `<span class="sv-chip w">${escapeHtml(t('season.over'))}</span>`
      : `<span class="sv-chip w">${escapeHtml(t('season.upcomingChip'))}</span>`;
  const logo = season.logoUrl ? `<img class="sv-logo" src="${escapeHtml(season.logoUrl)}" alt="">` : '';
  return `
    <div class="sv-head${logo ? ' with-logo' : ''}">
      ${logo}
      <div class="sv-head-main">
        <div class="sv-crumb"><a href="/harmonogram">${escapeHtml(t('schedule.heading'))}</a> › ${escapeHtml(termText())}</div>
        <h1 class="sv-title">${escapeHtml(season.name)}</h1>
        <div class="sv-chips"><span class="sv-chip ${isTournament() ? 't' : 'l'}">${escapeHtml(t(isTournament() ? 'schedule.tournament' : 'schedule.league'))}</span>${state}${note}${actionsHtml(status)}</div>
      </div>
    </div>
    ${isTournament() ? '' : `<div class="sv-progress">${seasonProgressHtml(season, standings)}</div>`}`;
}

function tilesHtml() {
  const players = playersModel().total;
  const groupCount = (season.groups || []).length || (standings ? standings.groups.length : 0);
  const tile = (key, value, sub) => `<div class="sv-tile"><div class="k">${escapeHtml(t(key))}</div><div class="v">${value}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div></div>`;
  const cats = CATEGORY_ORDER.filter((c) => (isTournament() && (season.categories || []).includes(c)) || (season.groups || []).some((g) => g.category === c) || (standings && standings.groups.some((g) => g.category === c)));
  const tiles = [
    cats.length ? tile('season.tileCats', String(cats.length), cats.map((c) => CATEGORY_NAMES[c]).join(' · ')) : '',
    season.venue ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileVenue'))}</div><div class="v sm">${escapeHtml(season.venue)}</div></div>` : '',
    termText() ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileTerm'))}</div><div class="v sm">${escapeHtml(termText())}</div></div>` : '',
    players ? tile('season.tilePlayers', String(players), groupCount ? t('season.groupsN', { n: groupCount }) : '') : '',
    season.entryFee ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileFee'))}</div><div class="v">${escapeHtml(season.entryFee)}</div></div>` : '',
    season.drawDate ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileDraw'))}</div><div class="v sm">${escapeHtml(formatDate(season.drawDate))}</div></div>` : '',
    season.prizeMoney ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tilePrize'))}</div><div class="v sm">${escapeHtml(season.prizeMoney)}</div></div>` : '',
  ].join('');
  return `<div class="sv-tiles">${tiles}</div>`;
}

// The description: "Label: value" lines become fact tiles (shown first), the rest is the text card. Rich text from the backend
// editor is already cleaned on the server; an older plain-text description works too.
function infoHtml() {
  if (!season.info) return '';
  const raw = season.info;
  const html = /<[a-z][\s\S]*>/i.test(raw)
    ? raw
    : raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('');
  const box = document.createElement('div');
  box.innerHTML = html;
  const nodes = [...box.childNodes].map((n) => (n.nodeType === 3 ? (n.textContent.trim() ? Object.assign(document.createElement('p'), { textContent: n.textContent.trim() }) : null) : n)).filter(Boolean);
  const lead = [];
  const facts = [];
  const KV = /^([^:]{2,40}):\s*(.+)$/;
  nodes.forEach((n) => {
    if (n.tagName === 'P') {
      const lines = n.innerHTML.split(/<br\s*\/?>/i).map((l) => { const d = document.createElement('div'); d.innerHTML = l; return d.textContent.trim(); }).filter(Boolean);
      const pairs = lines.map((l) => l.match(KV));
      if (lines.length && pairs.every(Boolean) && lines.every((l) => l.length <= 90)) { pairs.forEach((m) => facts.push([m[1], m[2]])); return; }
    }
    lead.push(n.outerHTML);
  });
  return `
    <div class="sv-about">
      ${facts.length ? `<div class="sv-facts">${facts.map(([k, v]) => `<div class="sv-fact"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>` : ''}
      ${lead.length ? `<div class="sv-about-lead">${lead.join('')}</div>` : ''}
    </div>`;
}

// The same two cards as the home page (rows from match-rows.js): the latest results and the next matches.
function resultsHtml() {
  const col = (title, href, rows, empty) => `
    <div class="home-col">
      ${secTitle(title, '', href, t('home.all'))}
      <div class="home-card">${rows.length ? rows.join('') : `<div class="home-empty">${escapeHtml(empty)}</div>`}</div>
    </div>`;
  return `<div class="home-cols">
    ${col(t('home.results'), `/matches?season=${season.id}&tab=FINISHED`, results.map(resultRow), t('home.noResults'))}
    ${col(t('home.upcoming'), `/matches?season=${season.id}`, upcoming.map(upcomingRow), t('home.noUpcoming'))}
  </div>`;
}

function tablesHtml() {
  const groups = standings ? standings.groups : [];
  if (!groups.length) return '';
  const cats = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c));
  if (!cats.includes(category)) category = cats[0];
  const pills = cats.map((c) => `<button type="button" class="tab${c === category ? ' active' : ''}" data-cat="${c}">${escapeHtml(CATEGORY_NAMES[c])}<small>${groups.filter((g) => g.category === c).length}</small></button>`).join('');
  const frozen = standings.frozen ? `<p class="sv-note">${escapeHtml(t('tables.frozen'))}</p>` : '';
  return `
    <section class="sv-sec" id="sv-tables">
      <div class="tabs" id="sv-cats">${pills}<a class="sv-more" href="/tables?season=${season.id}">${escapeHtml(t('season.fullTables'))} ›</a></div>
      <div class="sv-gl">${groups.filter((g) => g.category === category).map(groupTableHtml).join('')}</div>
      ${frozen}
    </section>`;
}

// One match of the round on a single line: name · result / date · name.
function scheduleRow(m) {
  const done = m.status === 'FINISHED';
  const sets = (m.state && m.state.setsWon) || { 1: 0, 2: 0 };
  const mid = done ? `<span class="rs">${sets[1]} : ${sets[2]}</span>`
    : m.status === 'LIVE' ? `<span class="rs live">${escapeHtml(t('home.live'))}</span>`
      : m.scheduledAt ? `<span class="rs date">${escapeHtml(chipDate(m.scheduledAt))}</span>`
        : '<span class="rs tbd">—</span>';
  return `<a class="sv-rl-m" href="/match/${m.token}"><span class="a${done && m.winnerId === m.player1.id ? ' w' : ''}">${escapeHtml(m.player1.name)}</span>${mid}<span class="b${done && m.winnerId === m.player2.id ? ' w' : ''}">${escapeHtml(m.player2.name)}</span></a>`;
}

// The Rozpis tab: the category and the group to choose, then every round as a block with a card per group and a line per match.
function scheduleHtml() {
  const rounds = season.rounds || [];
  if (!rounds.length) return '';
  const groups = season.groups || [];
  const cats = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c));
  if (!cats.includes(schedCat)) schedCat = cats[0] || null;
  const inCat = groups.filter((g) => g.category === schedCat);
  if (!inCat.some((g) => g.id === schedGroup)) schedGroup = inCat.length ? inCat[0].id : null;
  const tab = (attr, value, label, active) => `<button type="button" class="tab${active ? ' active' : ''}" ${attr}="${value}">${escapeHtml(label)}</button>`;
  const catRow = cats.map((c) => tab('data-sc', c, CATEGORY_NAMES[c], schedCat === c)).join('');
  const groupRow = inCat.map((g) => tab('data-sg', g.id, g.name, schedGroup === g.id)).join('');
  const shown = roundMatches.filter((m) => m.group && m.group.id === schedGroup);
  const order = new Map(groups.map((g, i) => [g.id, i]));
  // the matches of one round: a small block per group (laid out side by side), a line per match
  const groupBlocks = (matches) => {
    const map = new Map();
    matches.forEach((m) => {
      const id = m.group ? m.group.id : 0;
      if (!map.has(id)) map.set(id, { group: m.group, list: [] });
      map.get(id).list.push(m);
    });
    return [...map.entries()].sort((x, y) => (order.get(x[0]) ?? 99) - (order.get(y[0]) ?? 99)).map(([, { group, list }]) => `
      <div class="sv-rl-g">
        <div class="sv-rl-h">${group ? `${escapeHtml(CATEGORY_NAMES[group.category] || '')} · <b>${escapeHtml(group.name)}</b>` : ''}</div>
        ${list.map(scheduleRow).join('')}
      </div>`).join('');
  };
  // every round is a block of its own (a heading bar flush with the top, then its groups)
  const roundBlock = (heading, matches) => `<div class="sv-rl-block">${heading ? `<div class="sv-rl-round"><b>${escapeHtml(heading.label)}</b><small>${escapeHtml(heading.progress)}</small></div>` : ''}<div class="sv-rl-groups">${groupBlocks(matches)}</div></div>`;
  const body = rounds.map((r) => {
    const ms = shown.filter((m) => m.round === r.round);
    return ms.length ? roundBlock({ label: t('season.roundN', { n: r.round }), progress: `${r.finished}/${r.total}` }, ms) : '';
  }).join('');
  return `
    <section class="sv-sec" id="sv-schedule">
      <div class="sv-filters">
        <div class="tabs sv-line" id="sv-sched-cats">${catRow}<a class="sv-more" href="/matches?season=${season.id}">${escapeHtml(t('season.allMatches'))} ›</a></div>
        <div class="tabs sv-line" id="sv-sched-groups">${groupRow}</div>
      </div>
      <div class="sv-rl">${body || `<div class="sv-empty">${escapeHtml(t('season.noSchedule'))}</div>`}</div>
    </section>`;
}

// The Hráči tab: one numbered table per category — # | Meno | Štartovné (when the season has an entry fee).
function playersHtml() {
  const model = playersModel();
  if (!model.total) return '';
  const showPaid = !!(season.entryFee || season.paymentUrl || (season.registrations || []).some((r) => r.paid));
  if (playersCat !== 'ALL' && !model.cats.some((c) => c.category === playersCat)) playersCat = 'ALL';
  const filter = `<div class="tabs sv-line" id="sv-pcats"><button type="button" class="tab${playersCat === 'ALL' ? ' active' : ''}" data-pc="ALL">${escapeHtml(t('season.schedAll'))}<small>${model.total}</small></button>${model.cats.map((c) => `<button type="button" class="tab${playersCat === c.category ? ' active' : ''}" data-pc="${c.category}">${escapeHtml(playerCatName(c.category))}<small>${c.players.length}</small></button>`).join('')}</div>`;
  const tables = model.cats.filter((c) => playersCat === 'ALL' || c.category === playersCat).map((c) => {
    const rows = c.players.map((p, i) => {
      const name = p.slug ? `<a href="/player/${encodeURIComponent(p.slug)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
      const paid = p.paid === null || p.paid === undefined ? '<span class="no">–</span>' : (p.paid ? `<span class="ok">✓ ${escapeHtml(t('season.paid'))}</span>` : `<span class="no">${escapeHtml(t('season.unpaid'))}</span>`);
      return `<div class="sv-pr"><span class="n">${i + 1}</span><span class="nm">${name}</span>${showPaid ? `<span class="fee">${paid}</span>` : ''}</div>`;
    }).join('');
    return `
      <div class="sv-ptable">
        <div class="sv-ptable-t">${escapeHtml(playerCatName(c.category))}<em>${c.players.length}</em></div>
        <div class="sv-pr head"><span class="n">#</span><span class="nm">${escapeHtml(t('season.colName'))}</span>${showPaid ? `<span class="fee">${escapeHtml(t('season.colFee'))}</span>` : ''}</div>
        ${rows}
      </div>`;
  }).join('');
  return `<section class="sv-sec" id="sv-players">${filter}<div class="sv-pt">${tables}</div></section>`;
}

// The Play-off tab: a category filter, then the brackets of the season (a bracket whose name already says the category is
// not given the category twice).
function playoffHtml() {
  const hasGroups = standings && standings.groups.length;
  if (!brackets.length && (statusOf() === 'past' || !hasGroups)) return '';
  if (!brackets.length) return `<section class="sv-sec" id="sv-playoff"><div class="sv-empty">${escapeHtml(t('season.playoffSoon'))}</div></section>`;
  const cats = CATEGORY_ORDER.filter((c) => brackets.some((b) => b.category === c));
  if (playoffCat !== 'ALL' && !cats.includes(playoffCat)) playoffCat = 'ALL';
  const btn = (value, label, count) => `<button type="button" class="tab${playoffCat === value ? ' active' : ''}" data-oc="${value}">${escapeHtml(label)}<small>${count}</small></button>`;
  const filter = `<div class="tabs sv-line" id="sv-pcats">${btn('ALL', t('season.schedAll'), brackets.length)}${cats.map((c) => btn(c, CATEGORY_NAMES[c], brackets.filter((b) => b.category === c).length)).join('')}</div>`;
  const title = (b) => {
    const cat = CATEGORY_NAMES[b.category] || '';
    return cat && !b.name.toLowerCase().includes(cat.toLowerCase()) ? `${cat} · ${b.name}` : b.name;
  };
  const body = brackets.filter((b) => playoffCat === 'ALL' || b.category === playoffCat)
    .map((b) => `<div class="sv-bracket" data-bracket="${b.id}"><h3 class="grp-title">${escapeHtml(title(b))}</h3><div class="sv-bracket-body">${escapeHtml(t('common.loading'))}</div></div>`).join('');
  return `<section class="sv-sec" id="sv-playoff">${filter}${body}</section>`;
}

async function fillBrackets() {
  const holders = [...rootEl.querySelectorAll('[data-bracket]')];
  await Promise.all(holders.map(async (el) => {
    const id = Number(el.dataset.bracket);
    if (!bracketData.has(id)) {
      try { bracketData.set(id, await api(`/brackets/${id}`)); } catch { /* shown as missing below */ }
    }
    const body = el.querySelector('.sv-bracket-body');
    if (body) body.innerHTML = bracketData.has(id) ? bracketBoardHtml(bracketData.get(id)) : escapeHtml(t('tables.noBracket'));
  }));
}

function galleryHtml() {
  if (!season.galleryUrl) return '';
  return `<section class="sv-sec" id="sv-gallery">${secHead('gallery', '')}<a class="sv-gallery-btn" href="${escapeHtml(season.galleryUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.galleryOpen'))}</a></section>`;
}

// ---------- registration ----------

// The form: one name field that suggests the existing players (a new name can just be typed), phone, e-mail and category.
// A name close to an existing player asks "did you mean …?" before it is taken as a new one.
async function openRegisterModal() {
  await loadPlayers();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal sv-reg" role="dialog" aria-modal="true">
      <button type="button" class="close" data-close aria-label="${escapeHtml(t('season.regClose'))}">&times;</button>
      <h3>${escapeHtml(t(isTournament() ? 'season.regTitleTournament' : 'season.regTitle'))}</h3>
      <div class="sv-reg-season">${escapeHtml(season.name)}</div>
      <form id="sv-reg-form" novalidate>
        <div class="field">
          <label for="sv-reg-name">${escapeHtml(t('season.regName'))}</label>
          <div class="autocomplete"><input type="text" id="sv-reg-name" autocomplete="off" maxlength="80"><div class="autocomplete-list" id="sv-reg-name-list"></div></div>
          <small>${escapeHtml(t('season.regNameHint'))}</small>
        </div>
        <div class="field"><label for="sv-reg-phone">${escapeHtml(t('season.regPhone'))}</label><input type="tel" id="sv-reg-phone" autocomplete="tel" maxlength="20" placeholder="0903 111 222"></div>
        <div class="field"><label for="sv-reg-email">${escapeHtml(t('season.regEmail'))}</label><input type="email" id="sv-reg-email" autocomplete="email" maxlength="120"></div>
        ${isTournament() ? '' : `<div class="field"><label for="sv-reg-cat">${escapeHtml(t('season.regCategory'))}</label>
          <select id="sv-reg-cat"><option value="">${escapeHtml(t('season.regChoose'))}</option>${CATEGORY_ORDER.filter((c) => !isTournament() || (season.categories || []).includes(c)).map((c) => `<option value="${c}">${escapeHtml(CATEGORY_NAMES[c])}</option>`).join('')}</select>
        </div>`}
        <div class="field"><label for="sv-reg-notetext">${escapeHtml(t('season.regNoteLabel'))}</label><textarea id="sv-reg-notetext" rows="3" maxlength="500" placeholder="${escapeHtml(t('season.regNotePlaceholder'))}"></textarea></div>
        <input type="text" id="sv-reg-website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
        <div class="sv-reg-similar" id="sv-reg-similar"></div>
        <div class="sv-reg-error" id="sv-reg-error"></div>
        <p class="sv-reg-note">${escapeHtml(t('season.regNote'))}</p>
        <button type="submit" class="btn btn-primary btn-block" id="sv-reg-send">${escapeHtml(t('season.regSend'))}</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector(`#sv-reg-${id}`);
  let askForCode = false; // the registration made an account: closing this window leads to the page that asks for the 5-digit code
  const close = () => { wrap.remove(); if (askForCode) refreshPlayerAuth(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  setupAutocomplete('sv-reg-name', 'sv-reg-name-list');
  if (playerAuthed && currentPlayerName) $('name').value = currentPlayerName;
  if (typeof currentPlayerEmail === 'string' && currentPlayerEmail) $('email').value = currentPlayerEmail;
  $('name').focus();

  let chosenId = null; // a player picked from the "did you mean" list
  const fail = (msg) => { $('error').textContent = msg; $('similar').innerHTML = ''; };

  async function send(confirmNew) {
    $('error').textContent = '';
    const typed = $('name').value.replace(/\s+/g, ' ').trim();
    const phone = $('phone').value.trim();
    const email = $('email').value.trim();
    const category = isTournament() ? '' : $('cat').value; // a tournament has no category choice: the admin sorts the players
    if (typed.length < 3) return fail(t('season.regErrName'));
    if (phone.replace(/\D/g, '').length < 9) return fail(t('season.regErrPhone'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('season.regErrEmail'));
    if (!category && !isTournament()) return fail(t('season.regErrCategory'));
    const known = chosenId ? { id: chosenId } : findPlayerByTypedName(typed);
    const button = $('send');
    button.disabled = true;
    button.textContent = t('season.regSending');
    try {
      const res = await api(`/seasons/${season.id}/registrations`, {
        method: 'POST',
        body: { name: typed, phone, email, category, note: $('notetext').value.trim(), website: $('website').value, ...(known ? { playerId: known.id } : {}), ...(confirmNew ? { confirmNew: true } : {}) },
      });
      const pay = res && res.paymentUrl
        ? `<p>${escapeHtml(t('season.regPayHint'))}</p><a class="btn btn-primary btn-block" href="${escapeHtml(res.paymentUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.payOnline'))}</a>`
        : '';
      wrap.querySelector('.modal').innerHTML = `
        <button type="button" class="close" data-close aria-label="${escapeHtml(t('season.regClose'))}">&times;</button>
        <h3>${escapeHtml(t('season.regThanks', { name: (res && res.name) || typed }))}</h3>
        <p>${escapeHtml(t('season.regDone'))}</p>${res && res.pinSetupRequired ? `<p><b>${escapeHtml(t('season.regAccount'))}</b></p>` : ''}${pay}
        <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">${escapeHtml(t('season.regClose'))}</button>`;
      if (res && res.pinSetupRequired) askForCode = true;
      refresh(); // the new name appears in the players tab
    } catch (err) {
      button.disabled = false;
      button.textContent = t('season.regSend');
      const d = err.data || {};
      if (d.code === 'SIMILAR_PLAYERS') {
        $('similar').innerHTML = `<div class="sv-reg-similar-title">${escapeHtml(t('season.regSimilar'))}</div>`
          + d.suggestions.map((p) => `<button type="button" class="sv-reg-opt" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join('')
          + `<button type="button" class="sv-reg-opt new" data-new>${escapeHtml(t('season.regNewName'))}</button>`;
        return;
      }
      $('similar').innerHTML = '';
      const msg = { ALREADY_REGISTERED: isTournament() ? 'season.regAlreadyTournament' : 'season.regAlready', REGISTRATION_CLOSED: isTournament() ? 'season.regClosedErrTournament' : 'season.regClosedErr', BAD_NAME: 'season.regErrName', BAD_EMAIL: 'season.regErrEmail', BAD_PHONE: 'season.regErrPhone', BAD_CATEGORY: 'season.regErrCategory' }[d.code];
      $('error').textContent = t(msg || 'season.regError');
    }
  }

  $('similar').addEventListener('click', (e) => {
    const opt = e.target.closest('.sv-reg-opt');
    if (!opt) return;
    if (opt.dataset.id) {
      chosenId = Number(opt.dataset.id);
      $('name').value = opt.textContent;
      send(false);
    } else {
      send(true);
    }
  });
  $('name').addEventListener('input', () => { chosenId = null; $('similar').innerHTML = ''; });
  wrap.querySelector('#sv-reg-form').addEventListener('submit', (e) => { e.preventDefault(); send(false); });
}

// ---------- tabs ----------

// The tabs, always all of them in the same order; `has` says whether the season has anything for that tab yet (an empty tab
// shows a short note instead).
function availableTabs() {
  const hasGroups = !!(standings && standings.groups.length);
  const players = playersModel().total;
  const tabs = [
    { key: 'info', label: t('season.navInfo'), has: !!season.info },
    { key: 'tables', label: t('season.navTables'), has: hasGroups },
    { key: 'results', label: t('season.navResults'), has: season.matchCount > 0 },
    { key: 'schedule', label: t('season.navSchedule'), has: (season.rounds || []).length > 0 },
    { key: 'players', label: t('season.navPlayers'), has: players > 0, count: players },
    { key: 'playoff', label: t('season.navPlayoff'), has: brackets.length > 0 || (hasGroups && statusOf() !== 'past') },
    { key: 'gallery', label: t('season.navGallery'), has: !!season.galleryUrl },
  ];
  // a tournament has only the tabs Základné info, Výsledky, Rozpis and Galéria; its players are shown all the time, below the tab content (see fixedPlayersHtml)
  return isTournament() ? tabs.filter((x) => ['info', 'results', 'schedule', 'gallery'].includes(x.key)) : tabs;
}

function fixedPlayersHtml() {
  if (!isTournament()) return '';
  const list = playersHtml() || `<div class="sv-empty">${escapeHtml(t('season.empty.playersTournament'))}</div>`;
  return `<div class="sv-fixed-players"><div class="sv-sec-h"><h2>${escapeHtml(t('season.navPlayers'))}</h2></div>${list}</div>`;
}

function renderFixedPlayers() {
  const el = document.getElementById('sv-players-fixed');
  if (el) el.innerHTML = fixedPlayersHtml();
}

function panelHtml() {
  const html = tab === 'tables' ? tablesHtml()
    : tab === 'results' ? resultsHtml()
      : tab === 'schedule' ? scheduleHtml()
        : tab === 'players' ? playersHtml()
          : tab === 'playoff' ? playoffHtml()
            : tab === 'gallery' ? galleryHtml()
              : infoHtml();
  return html || `<div class="sv-empty">${escapeHtml(t(`season.empty.${tab}`))}</div>`;
}

// Loads what the open tab needs the first time it is opened (the header and the tables are loaded with the page).
async function ensureLoaded() {
  if (loaded.has(tab)) return;
  if (tab === 'results') await loadBlocks();
  if (tab === 'schedule') await loadRound();
  loaded.add(tab);
}

// ---------- page ----------

function renderTabs() {
  const tabs = availableTabs();
  if (!tabs.some((x) => x.key === tab)) tab = (tabs.find((x) => x.has) || tabs[0]).key;
  const el = document.getElementById('sv-tabs');
  el.innerHTML = tabs.map((x) => `<button type="button" class="tab${x.key === tab ? ' active' : ''}" data-tab="${x.key}">${escapeHtml(x.label)}${x.count ? `<small>${x.count}</small>` : ''}</button>`).join('');
}

async function renderPanel() {
  renderTabs();
  const panel = document.getElementById('sv-panel');
  const key = tab;
  if (!loaded.has(key)) {
    panel.innerHTML = `<div class="sv-empty">${escapeHtml(t('common.loading'))}</div>`;
    await ensureLoaded();
    if (key !== tab) return; // another tab was opened meanwhile
  }
  panel.innerHTML = panelHtml();
  if (key === 'playoff') fillBrackets();
}

function render() {
  rootEl.innerHTML = `${headerHtml()}${tilesHtml()}${seriesWinnersHtml()}<div class="tabs" id="sv-tabs" role="tablist"></div><div id="sv-panel" class="sv-panel"></div><div id="sv-players-fixed"></div>`;
  renderFixedPlayers();
  return renderPanel();
}

function openTab(key) {
  tab = key;
  try { history.replaceState(null, '', `#${key}`); } catch { /* the address just stays as it is */ }
  renderPanel();
}

rootEl.addEventListener('click', async (e) => {
  if (e.target.closest('#sv-register')) { openRegisterModal(); return; }
  const tabBtn = e.target.closest('#sv-tabs [data-tab]');
  if (tabBtn) { openTab(tabBtn.dataset.tab); return; }
  const cat = e.target.closest('#sv-panel [data-cat]');
  if (cat) { category = cat.dataset.cat; renderPanel(); return; }
  const oc = e.target.closest('#sv-panel [data-oc]');
  if (oc) { playoffCat = oc.dataset.oc; renderPanel(); return; }
  const pc = e.target.closest('#sv-panel [data-pc], #sv-players-fixed [data-pc]');
  if (pc) { playersCat = pc.dataset.pc; renderFixedPlayers(); renderPanel(); return; }
  const sc = e.target.closest('#sv-panel [data-sc]');
  if (sc) { schedCat = sc.dataset.sc; schedGroup = null; renderPanel(); return; }
  const sg = e.target.closest('#sv-panel [data-sg]');
  if (sg) { schedGroup = Number(sg.dataset.sg); renderPanel(); }
});

window.addEventListener('hashchange', () => {
  const key = window.location.hash.slice(1);
  if (key && availableTabs().some((x) => x.key === key) && key !== tab) openTab(key);
});

// A match changed somewhere: the numbers, tables and the open tab are loaded again (the other tabs when they are opened).
let refreshTimer = null;
async function refresh() {
  try {
    season = await api(`/seasons/by-slug/${encodeURIComponent(slug)}`);
    await loadStandings();
  } catch { return; }
  loaded.clear();
  const y = window.scrollY;
  await render();
  window.scrollTo(0, y);
}

(async () => {
  try {
    season = await api(`/seasons/by-slug/${encodeURIComponent(slug)}`);
  } catch {
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('season.notFound'))}</div>`;
    return;
  }
  if (!document.title.includes(season.name)) document.title = `${season.name} — BLTA`; // the server already put the title from Backend > SEO
  await loadStandings();
  tab = window.location.hash.slice(1) || null; // renderTabs picks the first tab with content when there is none
  await render();
  if (typeof io === 'function') {
    io().on('matches:changed', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 1500);
    });
  }
})();
