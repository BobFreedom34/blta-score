// Season page (/season/<slug>): one page per season that gathers what already lives elsewhere in the app — the numbers of the
// season (from its dates, groups and players), the group tables, the latest results and next matches, the round schedule, the
// players, the play-off bracket — as tabs: only the chosen tab is shown, and a tab loads its data when it is first opened. Only the entry fee, prize money, draw
// date, description, gallery link and the "paid" ticks are entered for this page (backend > Seasons).
// Data: GET /api/seasons/by-slug/:slug, /api/seasons/:id/standings, /api/seasons/:id/brackets, /api/matches?seasonId=…

const rootEl = document.getElementById('sv-root');
const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
// no category to choose when registering: a tournament (the admin sorts the players) and a season played without categories
const noCategoryChoice = () => isTournament() || (season.categories || []).includes('OPEN');
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice', get DOUBLES() { return t('season.catDoubles'); }, get OPEN() { return t('season.catOpen'); } };
// the doubles (štvorhra) of a tournament is a category of its own in the groups, the schedule and the brackets (not in the registration form)
const CATEGORY_ORDER_ALL = [...CATEGORY_ORDER, 'DOUBLES', 'OPEN']; // (OPEN = a tournament played without categories: one draw for everybody)
const playerCatName = (c) => (c === 'NONE' ? t(isDoublesTournament() ? 'season.pairsTitle' : 'season.noCategory') : CATEGORY_NAMES[c]);

let season = null;
let standings = null;
let winnersEdition = null; // the winners list (Backend > Winners) linked to this season, if there is one
let brackets = [];
let results = [];
let upcoming = [];
let roundMatches = [];
let allMatches = []; // every match of a tournament (its Zápasy tab)
let category = null;
let schedCat = null; // the Rozpis tab's category and group choice (always one of each)
let schedGroup = null;
let playersCat = 'ALL'; // the Hráči tab's category filter
let playoffCat = 'ALL'; // the Play-off tab's category filter
const bracketData = new Map(); // bracket id -> full bracket, cleared whenever the data is refreshed
// a result entered in a drawn bracket (bracket-result.js) comes back as the new bracket
document.addEventListener('bracket:changed', (e) => { if (e.detail && bracketData.has(e.detail.id)) bracketData.set(e.detail.id, e.detail); });
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
  try { winnersEdition = (await api(`/winners?seasonId=${season.id}`)).find((e) => e.seasonSlug === season.slug) || null; } catch { winnersEdition = null; }
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

// Every match of the tournament, whatever its status (the Zápasy tab); the league's own lists do not hold the matches of a community's tournament.
async function loadAllMatches() {
  allMatches = await api(`/matches?seasonId=${season.id}`).catch(() => []);
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
    if (members.length) members.forEach((m) => add(m.name, m.slug, g.category === 'OPEN' ? 'NONE' : g.category, !!(m.paid || (regs.get(nameKey(m.name)) || {}).paid)));
    else ((tables.get(g.id) || { rows: [] }).rows).forEach((r) => add(r.player.name, r.player.slug, g.category === 'OPEN' ? 'NONE' : g.category, regs.has(nameKey(r.player.name)) ? regs.get(nameKey(r.player.name)).paid : null));
  });
  // a tournament entry may have no category: those players are listed last, under "Bez kategórie"
  // the substitutes (after the maximum of players) are listed apart: they are not in until somebody drops out
  (season.registrations || []).filter((r) => !r.substitute).forEach((r) => add(r.name, r.slug, r.category || 'NONE', r.paid));
  const substitutes = (season.registrations || []).filter((r) => r.substitute).sort((a, b) => (a.substitutePosition || 0) - (b.substitutePosition || 0));
  const loc = currentLang === 'en' ? 'en' : 'sk';
  const cats = [...CATEGORY_ORDER, 'NONE'].map((category) => ({
    category,
    players: [...people.values()].filter((p) => p.category === category).sort((a, b) => a.name.localeCompare(b.name, loc)),
  })).filter((c) => c.players.length);
  return { cats, total: people.size, substitutes };
}


function secHead(id, title, linkHref, linkText) {
  if (!title && !linkHref) return '';
  return `<div class="sv-sec-h">${title ? `<h2>${escapeHtml(title)}</h2>` : '<span></span>'}${linkHref ? `<a href="${linkHref}">${escapeHtml(linkText)} ›</a>` : ''}</div>`;
}

// "Registrácia" (opens the form) and "Úhrada štartovného online" (the Stripe payment link set in the backend).
function actionsHtml(status) {
  const buttons = [];
  // a member of a group of a club season can arrange a match in it (the registration below is the same as for the league)
  if (isClubSeason() && myGroup && status !== 'past') buttons.push(`<a class="sv-btn primary" href="/new-match?season=${encodeURIComponent(season.slug)}&group=${myGroup.id}">${escapeHtml(t('season.arrangeMatch'))}</a>`);
  const mine = season.myRegistration; // the viewer is registered here (the server knows who is logged in)
  if (status !== 'past') {
    if (mine) {
      // a registered player has a green button instead of the registration, with an "i" that explains (like the "i" of the home page): "Odhlásiť sa" while the organiser
      // allows it (the "i" says until when), later a button that does nothing ("Si prihlásený") and the "i" says why
      const when = mine.deadline ? new Date(mine.deadline).toLocaleString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const tip = mine.allowed ? t('season.unregisterUntil', { date: when }) : t('season.unregisterNote' + (mine.reason || 'OFF'), { date: when });
      const main = mine.allowed
        ? `<button type="button" class="sv-btn reg-on" id="sv-unregister">${escapeHtml(t('season.unregister'))}</button>`
        : `<span class="sv-btn reg-on static">${escapeHtml(t(mine.substitute ? 'season.registeredSub' : 'season.registeredNote'))}</span>`;
      buttons.push(`<span class="home-reg-wrap sv-reg-wrap" id="sv-reg-wrap">${main}<button type="button" class="sv-btn reg-on reg-info" id="sv-info" aria-label="${escapeHtml(t('home.infoLabel'))}" aria-describedby="sv-tip" aria-expanded="false"><i>i</i></button><span class="home-tip" id="sv-tip" role="tooltip">${escapeHtml(tip)}</span></span>`);
    } else {
      buttons.push(season.registrationOpen
        ? `<button type="button" class="sv-btn primary" id="sv-register">${escapeHtml(t('season.register'))}</button>`
        : `<span class="sv-btn off">${escapeHtml(t('season.registerClosed'))}</span>`);
    }
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
  return `<section class="sw-sec">${season.organisation ? secHead('', t(isTournament() ? 'season.winnersTitleTournament' : 'season.winnersTitle')) : secHead('', t(isTournament() ? 'season.winnersTitleTournament' : 'season.winnersTitle'), '/vitazi', t('season.winnersAll'))}<div class="sw-row${isTournament() ? ' sw-row-quad' : ''}">${cards}</div></section>`;
}

// a tournament is a season of its own kind: same page, with a "Turnaj" chip, a venue and its own categories
const isTournament = () => season.kind === 'TOURNAMENT';
// a tournament is played as singles or as doubles (chosen when it was made, never mixed): a doubles one is entered as a pair
const isDoublesTournament = () => season.kind === 'TOURNAMENT' && season.playType === 'DOUBLES';
// a season of a community or club: the same page as a league season, with the club in the crumb and, for a member of a group, a button to arrange a match
const isClubSeason = () => !isTournament() && !!season.organisation;
// the group of this club season the logged-in player plays in (he can arrange a match in it), else null; set when the page is loaded
let myGroup = null;
async function findMyGroup() {
  myGroup = null;
  if (!isClubSeason()) return;
  try {
    const me = (await loadSession()).playerId;
    const group = me ? (season.groups || []).find((g) => (g.members || []).some((m) => m.id === me && !m.withdrawn)) : null;
    myGroup = group || null;
  } catch { /* a visitor: no button */ }
}

// Does the event ask for money? An entry fee that is more than 0 (the words "zadarmo" / "free" or a 0 mean none); with nothing written, only when there is an online payment link.
function hasEntryFee() {
  const fee = String(season.entryFee || '').trim();
  if (!fee) return !!season.paymentUrl;
  const n = fee.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return n ? Number(n[0]) > 0 : !/^(zadarmo|free)\b/i.test(fee);
}

// "Payment by transfer" in the window after a tournament registration. contact = GET /api/contact (the IBAN is edited in Backend > Contact).
function bankTransferHtml(contact, alongsideOnline) {
  if (!contact || !contact.iban) return '';
  const row = (label, value, copy) => `<div class="sv-pay-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${copy ? `<button type="button" class="sv-pay-copy" data-copy="${escapeHtml(copy)}">${escapeHtml(t('season.copy'))}</button>` : ''}</div>`;
  return `
    <div class="sv-pay-bank">
      <h4>${escapeHtml(t(alongsideOnline ? 'season.payTransferOr' : 'season.payTransferTitle'))}</h4>
      ${row('IBAN', contact.iban, contact.iban.replace(/\s+/g, ''))}
      ${contact.orgName ? row(t('season.payTransferRecipient'), contact.orgName) : ''}
      ${season.entryFee ? row(t('season.payTransferAmount'), season.entryFee) : ''}
      <p class="sv-pay-note">${escapeHtml(t('season.payTransferNote', { name: season.name }))}</p>
    </div>`;
}

// The gear next to the title, only for who manages this event (the server says so: season.canManage = an admin of the site, or an admin of the club that
// owns it). A club event opens its manage page; an event of the league itself opens its card in the Backend.
function settingsLinkHtml() {
  if (!season.canManage) return '';
  const href = season.organisation ? `/community-tournament/${season.id}` : `${isTournament() ? '/tournaments-admin' : '/seasons-admin'}#season-${season.id}`;
  const label = escapeHtml(t('season.settings'));
  return `<a class="sv-gear" href="${href}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></a>`;
}

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
  // the hero photo: one for wide screens and one for phones, each standing in for the other when it is missing
  const heroWide = season.heroUrl || season.heroMobileUrl;
  const heroPhone = season.heroMobileUrl || season.heroUrl;
  const hero = heroWide ? `<picture class="sv-hero-pic"><source media="(max-width: 700px)" srcset="${escapeHtml(heroPhone)}"><img src="${escapeHtml(heroWide)}" alt="${escapeHtml(season.name)}"></picture><span class="sv-hero-shade"></span>` : '';
  return `
    <div class="sv-head${logo ? ' with-logo' : ''}${hero ? ' has-hero' : ''}">
      ${hero}
      ${logo}
      <div class="sv-head-main">
        <div class="sv-head-text">
          <div class="sv-crumb">${isClubSeason() ? `<a href="/community/${encodeURIComponent(season.organisation.slug)}#events">${escapeHtml(season.organisation.name)}</a>` : `<a href="/harmonogram">${escapeHtml(t('schedule.heading'))}</a>`} › ${escapeHtml(termText())}</div>
          <h1 class="sv-title">${escapeHtml(season.name)}${settingsLinkHtml()}</h1>
        </div>
        <div class="sv-chips"><span class="sv-chip ${isTournament() ? 't' : 'l'}">${escapeHtml(isClubSeason() ? t('com.seasonTag') : t(isTournament() ? 'schedule.tournament' : 'schedule.league'))}</span>${state}${note}${actionsHtml(status)}</div>
      </div>
    </div>
    ${clubActionsHtml()}
    ${isTournament() ? '' : `<div class="sv-progress">${seasonProgressHtml(season, standings)}</div>`}`;
}

// A season or tournament of a community or club: "Install as app" (installs the club) and "Share" in a row under the hero, on the right.
function clubActionsHtml() {
  if (!season.organisation) return '';
  return `<div class="sv-club-actions">${clubAppButtonsHtml('sv-btn', season.name)}</div>`;
}

// The club view (bottom bar and top menu of the club, see getClubContext in common.js) starts here, with this event as the one the bar points to; a league
// season or tournament has no club view. The page's app is the club's (see clubApp.js).
function publishClubView() {
  const org = season.organisation;
  if (!org) { clearClubContext(); return; }
  const tournament = isTournament();
  setClubContext({
    orgSlug: org.slug, orgName: org.name, logoUrl: org.logoUrl || '', path: `/community/${org.slug}`,
    event: { slug: season.slug, name: season.name, kind: tournament ? 'TOURNAMENT' : 'SEASON', path: `${tournament ? '/tournament/' : '/season/'}${season.slug}` },
  });
  setClubManifest(org.slug);
}

function tilesHtml() {
  const model = playersModel();
  const players = model.total;
  // registered / maximum (the one limit of the event, or the limits of its categories added up); the ones over it are substitutes
  const maxPlayers = season.maxPlayers || Object.values(season.categoryMax || {}).reduce((a, b) => a + b, 0) || 0;
  const groupCount = (season.groups || []).length || (standings ? standings.groups.length : 0);
  const tile = (key, value, sub) => `<div class="sv-tile"><div class="k">${escapeHtml(t(key))}</div><div class="v">${value}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div></div>`;
  const cats = CATEGORY_ORDER_ALL.filter((c) => (isTournament() && (season.categories || []).includes(c)) || (season.groups || []).some((g) => g.category === c) || (standings && standings.groups.some((g) => g.category === c)));
  const tiles = [
    cats.length ? tile('season.tileCats', cats.map((c) => CATEGORY_NAMES[c]).join(' · ')) : '',
    season.venue ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileVenue'))}</div><div class="v sm">${escapeHtml(season.venue)}</div></div>` : '',
    termText() ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileTerm'))}</div><div class="v sm">${escapeHtml(termText())}</div></div>` : '',
    players || maxPlayers ? tile('season.tilePlayers', maxPlayers ? `${players}/${maxPlayers}` : String(players), groupCount && !isTournament() ? t('season.groupsN', { n: groupCount }) : (model.substitutes.length ? `+${model.substitutes.length} ${t('season.substitutes').toLowerCase()}` : '')) : '',
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

// A match as a card of the league's matches page (the same markup and styles), without the buttons that need that page's own scripts
function leagueMatchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  const scoreboard = cardScoreboardHtml(m);
  return `
    <a class="match-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}" href="/match/${m.token}">
      <div class="match-card-top">
        ${categoryBadge(m.category)}
        ${statusBadge(m, { splitTime: true })}${videoBadge(m)}${photoBadge(m)}
        <div class="match-card-meta" style="margin-left:auto">
          ${m.location ? `<span>${courtIcon('pin')}${escapeHtml(m.location)}</span>` : ''}
          ${m.status === 'PLANNED' && m.scheduledAt ? '' : `<span>${courtIcon('calendar')}${fmtDateShort(m.scheduledAt)}</span>`}
        </div>
        ${matchRoundHtml(m)}
      </div>
      ${scoreboard || `
        <div class="match-players-box">
          <div class="match-players">
            <div class="match-players-names">
              <div class="name ${winnerP1 ? 'winner' : ''}">${playerNameLink(m.player1, { rank: m.status !== 'FINISHED' })}${ballsIconHtml(m, 1)}${courtIconHtml(m, 1)}</div>
              <div class="vs">vs</div>
              <div class="name ${winnerP2 ? 'winner' : ''}">${playerNameLink(m.player2, { rank: m.status !== 'FINISHED' })}${ballsIconHtml(m, 2)}${courtIconHtml(m, 2)}</div>
            </div>
            <div class="match-score${m.status === 'PLANNED' ? ' match-score-format' : ''}">${matchScoreHtml(m)}</div>
          </div>
        </div>
      `}
    </a>`;
}

// The Zápasy tab of a tournament: all its matches in the groups of the league's matches page - live, scheduled, not yet scheduled, finished, unfinished
function matchesHtml() {
  if (!allMatches.length) return '';
  const when = (m) => m.scheduledAt || m.endTime || '';
  const groups = [
    ['liveHeading', allMatches.filter((m) => m.status === 'LIVE')],
    ['scheduledHeading', allMatches.filter((m) => m.status === 'PLANNED' && m.scheduledAt).sort((a, b) => when(a).localeCompare(when(b)))],
    ['plannedHeading', allMatches.filter((m) => m.status === 'PLANNED' && !m.scheduledAt)],
    ['finishedHeading', allMatches.filter((m) => m.status === 'FINISHED').sort((a, b) => when(b).localeCompare(when(a)))],
    ['unfinishedHeading', allMatches.filter((m) => m.status === 'UNFINISHED').sort((a, b) => when(b).localeCompare(when(a)))],
  ].filter(([, list]) => list.length);
  return `<div class="sv-matches match-list">${groups.map(([key, list]) => `<h2 class="match-list-heading">${matchHeadingHtml(key)}</h2>${list.map(leagueMatchCardHtml).join('')}`).join('')}</div>`;
}

function tablesHtml() {
  const groups = standings ? standings.groups : [];
  if (!groups.length) return '';
  const cats = CATEGORY_ORDER_ALL.filter((c) => groups.some((g) => g.category === c));
  if (!cats.includes(category)) category = cats[0];
  const pills = cats.map((c) => `<button type="button" class="tab${c === category ? ' active' : ''}" data-cat="${c}">${escapeHtml(CATEGORY_NAMES[c])}<small>${groups.filter((g) => g.category === c).length}</small></button>`).join('');
  const frozen = standings.frozen ? `<p class="sv-note">${escapeHtml(t('tables.frozen'))}</p>` : '';
  // a tournament that chose its rules says how the tables are calculated
  const rules = standings.rules
    ? `<p class="sv-note" id="sv-rules">${escapeHtml(t(`season.rulesScoring.${standings.rules.scoring}`))} ${escapeHtml(t('season.rulesOrder', { list: standings.rules.tiebreakers.map((k, i) => `${i + 1}. ${t(`season.rulesTie.${k}`)}`).join(', ') }))}</p>`
    : '';
  return `
    <section class="sv-sec" id="sv-tables">
      <div class="tabs" id="sv-cats">${pills}<a class="sv-more" href="/tables?season=${season.id}">${escapeHtml(t('season.fullTables'))} ›</a></div>
      <div class="sv-gl">${groups.filter((g) => g.category === category).map(groupTableHtml).join('')}</div>
      ${frozen}${rules}
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
  const cats = CATEGORY_ORDER_ALL.filter((c) => groups.some((g) => g.category === c));
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
  // no payment column when the entry fee is 0 (or "free"): there is nothing to pay, so nobody "waits" or "has paid"
  const freeEntry = (() => { const f = String(season.entryFee || '').trim(); const n = f.replace(',', '.').match(/\d+(?:\.\d+)?/); return n ? Number(n[0]) === 0 : /^(zadarmo|free)\b/i.test(f); })();
  const showPaid = !freeEntry && !!(season.entryFee || season.paymentUrl || (season.registrations || []).some((r) => r.paid));
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
  // the substitutes of the categories shown: after the tables, in the order they will come in
  const waiting = model.substitutes.filter((r) => playersCat === 'ALL' || (r.category || 'NONE') === playersCat);
  const subs = waiting.length ? `
      <div class="sv-ptable">
        <div class="sv-ptable-t">${escapeHtml(t('season.substitutes'))}<em>${waiting.length}</em></div>
        ${waiting.map((r, i) => `<div class="sv-pr"><span class="n">${i + 1}</span><span class="nm">${escapeHtml(r.name)}${r.category ? ` <small>(${escapeHtml(CATEGORY_NAMES[r.category] || r.category)})</small>` : ''}</span></div>`).join('')}
        <p class="sv-sub-note">${escapeHtml(t('season.substitutesNote'))}</p>
      </div>` : '';
  return `<section class="sv-sec" id="sv-players">${filter}<div class="sv-pt">${tables}${subs}</div></section>`;
}

// The Play-off tab: a category filter, then the brackets of the season (a bracket whose name already says the category is
// not given the category twice).
function playoffHtml() {
  const hasGroups = standings && standings.groups.length;
  if (!brackets.length && (statusOf() === 'past' || !hasGroups)) return '';
  if (!brackets.length) return `<section class="sv-sec" id="sv-playoff"><div class="sv-empty">${escapeHtml(t('season.playoffSoon'))}</div></section>`;
  // the doubles (štvorhra) draw of a tournament is a "category" of its own here
  const catOfBracket = (b) => (b.isDoubles ? 'DOUBLES' : b.category);
  const catName = (c) => (c === 'DOUBLES' ? t('season.catDoubles') : CATEGORY_NAMES[c]);
  const cats = [...CATEGORY_ORDER, 'DOUBLES', 'OPEN'].filter((c) => brackets.some((b) => catOfBracket(b) === c));
  if (playoffCat !== 'ALL' && !cats.includes(playoffCat)) playoffCat = 'ALL';
  const btn = (value, label, count) => `<button type="button" class="tab${playoffCat === value ? ' active' : ''}" data-oc="${value}">${escapeHtml(label)}<small>${count}</small></button>`;
  const filter = `<div class="tabs sv-line" id="sv-pcats">${btn('ALL', t('season.schedAll'), brackets.length)}${cats.map((c) => btn(c, catName(c), brackets.filter((b) => catOfBracket(b) === c).length)).join('')}</div>`;
  const title = (b) => {
    const cat = catName(catOfBracket(b)) || '';
    const named = cat && !b.name.toLowerCase().includes(cat.toLowerCase()) ? `${cat} · ${b.name}` : b.name;
    // a tournament's bracket carries the name of the tournament
    return isTournament() && !named.toLowerCase().includes(season.name.toLowerCase()) ? `${season.name} — ${named}` : named;
  };
  const body = brackets.filter((b) => playoffCat === 'ALL' || catOfBracket(b) === playoffCat)
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
  // the photos of the event (kept in Google Drive like the photos of the matches): a grid, and the button to add more for who organises it
  const { canAdd, photos } = photoState;
  const grid = photos.length ? `<div class="sv-photos">${photos.map((p, i) => `<button type="button" class="sv-photo" data-photo="${i}" aria-label="${escapeHtml(t('match.photoOpen'))}">${photoImgFailed(p.thumbUrl) ? '' : photoImgTag(p.thumbUrl)}</button>`).join('')}</div>` : '';
  const add = (canAdd || photoUploading) ? `<button type="button" class="btn btn-dark sv-photo-add" id="sv-photo-add"${photoUploading ? ' disabled' : ''}>${escapeHtml(photoUploading ? t('match.photoUploading') : t('season.galleryAdd'))}</button>` : '';
  if (add || grid) {
    const link = season.galleryUrl ? `<a class="sv-gallery-btn" href="${escapeHtml(season.galleryUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.galleryOpen'))}</a>` : '';
    return `<section class="sv-sec" id="sv-gallery">${secHead('gallery', '')}${add}${grid}${link}</section>`;
  }
  if (!season.galleryUrl) return '';
  return `<section class="sv-sec" id="sv-gallery">${secHead('gallery', '')}<a class="sv-gallery-btn" href="${escapeHtml(season.galleryUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.galleryOpen'))}</a></section>`;
}

// The Live video tab: the YouTube video of every court that has one, stacked under each other in court order, each under its court heading
function liveVideoHtml() {
  const courts = (season.courtStreams || []).map((stream, i) => (stream && stream.videoId ? `
    <section class="sv-live-court">
      <h3>${escapeHtml(t('courts.court', { n: i + 1 }))}</h3>
      <div class="sv-live-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(stream.videoId)}?rel=0" title="${escapeHtml(t('courts.court', { n: i + 1 }))} — ${escapeHtml(t('courts.liveVideo'))}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
    </section>` : '')).join('');
  return courts ? `<section class="sv-sec" id="sv-live">${courts}</section>` : '';
}

// ---------- registration ----------

// The form: one name field that suggests the existing players (a new name can just be typed), phone, e-mail and category.
// A name close to an existing player asks "did you mean …?" before it is taken as a new one.
async function openRegisterModal() {
  await loadPlayers();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  // with a hero photo the title and the name of the series stand over it (black gradient from the bottom), the cross in its corner
  const heroWide = season.heroUrl || season.heroMobileUrl;
  const heroPhone = season.heroMobileUrl || season.heroUrl;
  const regTitle = escapeHtml(t(isTournament() ? 'season.regTitleTournament' : 'season.regTitle'));
  const closeLabel = escapeHtml(t('season.regClose'));
  const head = heroWide
    ? `<div class="sv-reg-cover">
        <picture><source media="(max-width: 480px)" srcset="${escapeHtml(heroPhone)}"><img src="${escapeHtml(heroWide)}" alt=""></picture><span class="sv-reg-shade"></span>
        <button type="button" class="close" data-close aria-label="${closeLabel}">&times;</button>
        <div class="sv-reg-cover-text"><h3>${regTitle}</h3><div class="sv-reg-season">${escapeHtml(season.name)}</div></div>
      </div>`
    : `<button type="button" class="close" data-close aria-label="${closeLabel}">&times;</button>
      <h3>${regTitle}</h3>
      <div class="sv-reg-season">${escapeHtml(season.name)}</div>`;
  wrap.innerHTML = `
    <div class="modal sv-reg" role="dialog" aria-modal="true">
      ${head}
      <form id="sv-reg-form" novalidate>
        <div class="field">
          <label for="sv-reg-name">${escapeHtml(t('season.regName'))}</label>
          <div class="autocomplete"><input type="text" id="sv-reg-name" autocomplete="off" maxlength="80"><div class="autocomplete-list" id="sv-reg-name-list"></div></div>
          <small>${escapeHtml(t('season.regNameHint'))}</small>
        </div>
        <div class="field"><label for="sv-reg-phone">${escapeHtml(t('season.regPhone'))}</label><input type="tel" id="sv-reg-phone" autocomplete="tel" maxlength="20" placeholder="0903 111 222"></div>
        <div class="field"><label for="sv-reg-email">${escapeHtml(t('season.regEmail'))}</label><input type="email" id="sv-reg-email" autocomplete="email" maxlength="120"></div>
        <div class="sv-reg-full" id="sv-reg-full" hidden>${escapeHtml(t('season.regFull'))}</div>
        ${noCategoryChoice() ? '' : `<div class="field"><label for="sv-reg-cat">${escapeHtml(t('season.regCategory'))}</label>
          <select id="sv-reg-cat"><option value="">${escapeHtml(t('season.regChoose'))}</option>${CATEGORY_ORDER.filter((c) => (season.categories || []).includes(c)).map((c) => `<option value="${c}">${escapeHtml(CATEGORY_NAMES[c])}</option>`).join('')}</select>
        </div>`}
        ${isDoublesTournament() ? `<div class="field">
          <label for="sv-reg-partner">${escapeHtml(t('season.regPartner'))}</label>
          <div class="autocomplete"><input type="text" id="sv-reg-partner" autocomplete="off" maxlength="80"><div class="autocomplete-list" id="sv-reg-partner-list"></div></div>
          <small>${escapeHtml(t('season.regPartnerHint'))}</small>
        </div>` : ''}
        <div class="field"><label for="sv-reg-notetext">${escapeHtml(t('season.regNoteLabel'))}</label><textarea id="sv-reg-notetext" rows="3" maxlength="500"></textarea></div>
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
  if (isDoublesTournament()) setupAutocomplete('sv-reg-partner', 'sv-reg-partner-list');
  if (playerAuthed && currentPlayerName) $('name').value = currentPlayerName;
  if (typeof currentPlayerEmail === 'string' && currentPlayerEmail) $('email').value = currentPlayerEmail;
  $('name').focus();

  // the maximum of players is reached (for the chosen category, or for the whole event): the registration is a substitute one - the form says so before it is sent
  const isFull = () => {
    const cap = (season.capacity || {})[noCategoryChoice() ? '' : ($('cat') ? $('cat').value : '')];
    return !!(cap && cap.limit && cap.in >= cap.limit);
  };
  const showFull = () => {
    const full = isFull();
    $('full').hidden = !full;
    $('send').textContent = t(full ? 'season.regSendSub' : 'season.regSend');
  };
  if ($('cat')) $('cat').addEventListener('change', showFull);
  showFull();

  let chosenId = null; // a player picked from the "did you mean" list
  const fail = (msg) => { $('error').textContent = msg; $('similar').innerHTML = ''; };

  async function send(confirmNew) {
    $('error').textContent = '';
    const typed = $('name').value.replace(/\s+/g, ' ').trim();
    const phone = $('phone').value.trim();
    const email = $('email').value.trim();
    const category = noCategoryChoice() ? '' : $('cat').value; // a tournament, or a season without categories, has no category choice: the admin sorts the players
    if (typed.length < 3) return fail(t('season.regErrName'));
    if (phone.replace(/\D/g, '').length < 9) return fail(t('season.regErrPhone'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('season.regErrEmail'));
    if (!category && !noCategoryChoice()) return fail(t('season.regErrCategory'));
    if (isDoublesTournament() && $('partner').value.replace(/\s+/g, ' ').trim().length < 3) return fail(t('season.regErrPartner'));
    const known = chosenId ? { id: chosenId } : findPlayerByTypedName(typed);
    const button = $('send');
    button.disabled = true;
    button.textContent = t('season.regSending');
    try {
      const res = await api(`/seasons/${season.id}/registrations`, {
        method: 'POST',
        body: { name: typed, phone, email, category, note: $('notetext').value.trim(), ...(isDoublesTournament() ? { partner: $('partner').value.trim() } : {}), website: $('website').value, ...(known ? { playerId: known.id } : {}), ...(confirmNew ? { confirmNew: true } : {}) },
      });
      const stripe = res && res.paymentUrl
        ? `<p>${escapeHtml(t('season.regPayHint'))}</p><a class="btn btn-primary btn-block" href="${escapeHtml(res.paymentUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.payOnline'))}</a>`
        : '';
      // a tournament also offers a bank transfer: the IBAN of the contact page, the entry fee and a reminder to put the tournament's name in the note
      const contact = isTournament() ? await api('/contact').catch(() => null) : null;
      // a substitute pays nothing yet (the payment is asked when he comes in), and an event with no entry fee asks for no payment at all
      const pay = (res && res.substitute) || !hasEntryFee() ? '' : stripe + bankTransferHtml(contact, !!stripe);
      wrap.querySelector('.modal').innerHTML = `
        <button type="button" class="close" data-close aria-label="${escapeHtml(t('season.regClose'))}">&times;</button>
        <h3>${escapeHtml(t('season.regThanks', { name: (res && res.name) || typed }))}</h3>
        <p>${escapeHtml(t(res && res.substitute ? 'season.regDoneSub' : 'season.regDone'))}</p>${res && res.pinSetupRequired ? `<p><b>${escapeHtml(t('season.regAccount'))}</b></p>` : ''}${pay}
        <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">${escapeHtml(t('season.regClose'))}</button>`;
      wrap.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
        const done = () => { b.textContent = t('season.copied'); };
        if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, done); else done();
      }));
      if (res && res.pinSetupRequired) askForCode = true;
      refresh(); // the new name appears in the players tab
    } catch (err) {
      button.disabled = false;
      showFull();
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

// ---------- the final standings ----------

let finalData = null;
async function loadFinal() {
  if (!isTournament()) { finalData = { sections: [], complete: false }; return; } // only a tournament has the tab
  try { finalData = await api(`/seasons/${season.id}/final-standings`); } catch { finalData = { sections: [], complete: false }; }
}
// the place and what the player did, in words: "1. miesto", "Semifinalista" …
function finalRowText(r) {
  const range = r.from === r.to ? `${r.from}.` : `${r.from}.–${r.to}.`;
  const result = r.stage === 'WINNER' || r.stage === 'FINALIST' || r.stage === 'TABLE' || (r.stage === 'PLACE' && r.from === r.to) ? t('season.final.place', { n: r.from })
    : r.stage === 'PLACE' ? t('season.final.placeRange', { from: r.from, to: r.to })
    : r.stage === 'SEMI' ? t('season.final.semi')
    : r.stage === 'QUARTER' ? t('season.final.quarter')
    : r.stage === 'LAST16' ? t('season.final.last16')
    : r.stage === 'ROUND' ? t('season.final.round', { n: r.round })
    : r.stage === 'GROUP' ? `${t('season.final.group', { n: r.place })}${r.group ? ` · ${r.group}` : ''}`
    : r.stage === 'PLAYING' ? t('season.final.playing')
    : t('season.final.place', { n: r.from });
  return { range, result };
}
function finalHtml() {
  if (!finalData || !finalData.sections.length) return '';
  const note = finalData.complete ? '' : `<p class="sv-final-note">${escapeHtml(t('season.final.provisional'))}</p>`;
  const sections = finalData.sections.map((s) => `
    <div class="sv-final-one">
      <div class="sv-ptable">
        <div class="sv-ptable-t">${escapeHtml(s.title)}<em>${s.rows.length}</em></div>
        <div class="sv-pr head"><span class="n">#</span><span class="nm">${escapeHtml(t('season.final.colName'))}</span><span class="fee">${escapeHtml(t('season.final.colResult'))}</span></div>
        ${s.rows.map((r) => {
          const text = finalRowText(r);
          const name = r.player.slug ? `<a href="/player/${encodeURIComponent(r.player.slug)}">${escapeHtml(r.player.name)}</a>` : escapeHtml(r.player.name);
          return `<div class="sv-pr"><span class="n">${text.range}</span><span class="nm">${name}</span><span class="fee">${escapeHtml(text.result)}</span></div>`;
        }).join('')}
      </div>
    </div>`).join('');
  return `<section class="sv-sec" id="sv-final">${note}<div class="sv-pt">${sections}</div><p class="sv-sub-note">${escapeHtml(t('season.final.hint'))}</p></section>`;
}

// ---------- tabs ----------

// The tabs, always all of them in the same order; `has` says whether the season has anything for that tab yet (an empty tab
// shows a short note instead).
function availableTabs() {
  const hasGroups = !!(standings && standings.groups.length);
  const players = playersModel().total;
  // the order of a season's tabs: Základné info · Hráči · Tabuľky · Rozpis · Výsledky · Play-off · Galéria (a tournament: Základné info · Harmonogram · Skupiny · Pavúky · Galéria)
  const tabs = [
    { key: 'info', label: t('season.navInfo'), has: !!season.info },
    { key: 'players', label: t(isDoublesTournament() ? 'season.pairsTitle' : 'season.navPlayers'), has: players > 0, count: players },
    { key: 'courts', label: t('season.navCourts'), has: (season.courtCount || 0) > 0 },
    { key: 'tables', label: t(isTournament() ? 'season.navGroups' : 'season.navTables'), has: hasGroups },
    { key: 'schedule', label: t('season.navSchedule'), has: (season.rounds || []).length > 0 },
    { key: 'results', label: t('season.navResults'), has: season.matchCount > 0 },
    { key: 'playoff', label: t(isTournament() ? 'season.navBrackets' : 'season.navPlayoff'), has: isTournament() ? brackets.length > 0 : (brackets.length > 0 || (hasGroups && statusOf() !== 'past')) },
    { key: 'matches', label: t('season.navMatches'), has: season.matchCount > 0 },
    { key: 'final', label: t('season.navFinal'), has: !!(finalData && finalData.sections.length) },
    { key: 'gallery', label: t('season.navGallery'), has: !!season.galleryUrl },
    // the live video of the courts (a tournament, only when the organiser entered at least one link)
    { key: 'live', label: t('season.navLive'), has: (season.courtStreams || []).some(Boolean) },
  ];
  // a tournament has only the tabs Základné info, Harmonogram (court timetable with live scores), Skupiny (the group tables), Pavúky and Galéria (Rozpis is for league seasons); its players are shown below the Základné info tab (see fixedPlayersHtml)
  // (and the tabs that have nothing for this tournament are left out: no Skupiny tab for a bracket, no Pavúky before there is one, no Konečné poradie before something is played)
  return isTournament() ? tabs.filter((x) => ['info', 'courts', 'tables', 'playoff', 'matches', 'final', 'gallery', 'live'].includes(x.key) && (!['tables', 'playoff', 'final', 'live'].includes(x.key) || x.has)) : tabs.filter((x) => x.key !== 'courts' && x.key !== 'final' && x.key !== 'live'); // (a league season has its tables: the final standings are for tournaments only)
}

// the players of a tournament are shown on the Základné info tab only
function fixedPlayersHtml() {
  if (!isTournament() || tab !== 'info') return '';
  const list = playersHtml() || `<div class="sv-empty">${escapeHtml(t('season.empty.playersTournament'))}</div>`;
  return `<div class="sv-fixed-players"><div class="sv-sec-h"><h2>${escapeHtml(t(isDoublesTournament() ? 'season.pairsTitle' : 'season.navPlayers'))}</h2></div>${list}</div>`;
}

function renderFixedPlayers() {
  const el = document.getElementById('sv-players-fixed');
  if (el) el.innerHTML = fixedPlayersHtml();
}

function panelHtml() {
  const html = tab === 'tables' ? tablesHtml()
    : tab === 'matches' ? matchesHtml()
      : tab === 'results' ? resultsHtml()
      : tab === 'schedule' ? scheduleHtml()
        : tab === 'players' ? playersHtml()
          : tab === 'playoff' ? playoffHtml()
            : tab === 'final' ? finalHtml()
            : tab === 'gallery' ? galleryHtml()
              : tab === 'live' ? liveVideoHtml()
              : tab === 'courts' ? '<div id="sv-courts"></div>'
                : infoHtml();
  const emptyKey = tab === 'playoff' && isTournament() ? 'season.empty.brackets' : `season.empty.${tab}`;
  return html || `<div class="sv-empty">${escapeHtml(t(emptyKey))}</div>`;
}

// The gallery tab: the button that adds photos (a phone asks: take one or choose), a tap on a picture opens the full-screen viewer (all of it is match-photos.js)
function bindGallery(panel) {
  const add = panel.querySelector('#sv-photo-add');
  if (add) add.addEventListener('click', () => { if (!photoUploading) askPhotoSource(); });
  panel.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => openPhotoViewer(Number(b.dataset.photo) || 0)));
  watchPhotoImages(panel);
}
// the photos of the event are loaded with the page; a change of them draws the gallery tab again
async function loadGallery() {
  await loadSeasonPhotos(season.id, () => { if (tab === 'gallery') renderPanel(); });
}

// Loads what the open tab needs the first time it is opened (the header and the tables are loaded with the page).
async function ensureLoaded() {
  if (loaded.has(tab)) return;
  if (tab === 'results') await loadBlocks();
  if (tab === 'schedule') await loadRound();
  if (tab === 'matches') await loadAllMatches();
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
  renderFixedPlayers();
  const panel = document.getElementById('sv-panel');
  const key = tab;
  if (!loaded.has(key)) {
    panel.innerHTML = `<div class="sv-empty">${escapeHtml(t('common.loading'))}</div>`;
    await ensureLoaded();
    if (key !== tab) return; // another tab was opened meanwhile
  }
  panel.innerHTML = panelHtml();
  if (!panel.querySelector('h2')) { const open = availableTabs().find((x) => x.key === tab); if (open) panel.insertAdjacentHTML('afterbegin', `<h2 class="sr-only">${escapeHtml(open.label)}</h2>`); }
  if (key === 'playoff') fillBrackets();
  if (key === 'gallery') bindGallery(panel);
  if (key === 'courts') initCourtSchedule(document.getElementById('sv-courts'), season).catch(() => { document.getElementById('sv-courts').innerHTML = `<div class="sv-empty">${escapeHtml(t('season.empty.courts'))}</div>`; });
}

function render() {
  rootEl.innerHTML = `${headerHtml()}${tilesHtml()}${seriesWinnersHtml()}<div class="tabs" id="sv-tabs" role="tablist"></div><div id="sv-panel" class="sv-panel"></div><div id="sv-players-fixed"></div><section class="sv-partners" id="sv-partners" hidden></section>`;
  renderFixedPlayers();
  loadSponsorStrip(document.getElementById('sv-partners'), `?seasonId=${season.id}`);
  return renderPanel();
}

function openTab(key) {
  tab = key;
  try { history.replaceState(null, '', `#${key}`); } catch { /* the address just stays as it is */ }
  window.dispatchEvent(new CustomEvent('blta:season-tab', { detail: { tab } })); // the club bar highlights it
  renderPanel();
}

// The "i" next to the green button of a registered player: hover or keyboard focus shows the text, a click pins it (a tap on a phone), another click closes it
{
  const wrap = () => document.getElementById('sv-reg-wrap');
  const setTip = (open) => { const w = wrap(); const info = document.getElementById('sv-info'); if (!w || !info) return; w.classList.toggle('tip-open', open); info.setAttribute('aria-expanded', String(open)); };
  const isInfo = (el) => !!(el && el.closest && el.closest('#sv-info'));
  rootEl.addEventListener('mouseover', (e) => { if (isInfo(e.target)) setTip(true); });
  rootEl.addEventListener('mouseout', (e) => { const w = wrap(); if (isInfo(e.target) && w && !w.dataset.pinned) setTip(false); });
  rootEl.addEventListener('focusin', (e) => { if (isInfo(e.target)) setTip(true); });
  rootEl.addEventListener('focusout', (e) => { const w = wrap(); if (isInfo(e.target) && w && !w.dataset.pinned) setTip(false); });
  rootEl.addEventListener('click', (e) => {
    const w = wrap();
    if (!w) return;
    if (isInfo(e.target)) { e.stopPropagation(); if (w.dataset.pinned) { delete w.dataset.pinned; setTip(false); } else { w.dataset.pinned = '1'; setTip(true); } }
  });
  document.addEventListener('click', (e) => { const w = wrap(); if (w && w.dataset.pinned && !isInfo(e.target)) { delete w.dataset.pinned; setTip(false); } });
}

rootEl.addEventListener('click', async (e) => {
  if (e.target.closest('#sv-register')) { openRegisterModal(); return; }
  if (e.target.closest('#sv-unregister')) {
    if (!window.confirm(t('season.unregisterConfirm', { name: season.name }))) return;
    try {
      await api(`/seasons/${season.id}/registrations/mine`, { method: 'DELETE' });
      toast(t('season.unregistered'));
    } catch (err) {
      const code = err.data && err.data.code;
      toast(code && /^UNREGISTER_/.test(code) ? t(`season.unregister${code.slice(11)}`) : (err.message || t('season.unregisterFailed')));
    }
    await refresh(); // the button is the registration again; the list of players no longer has him
    return;
  }
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
    await findMyGroup();
    await loadFinal();
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
    clearClubContext(); // no such event (any more): no club view either
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('season.notFound'))}</div>`;
    return;
  }
  publishClubView();
  if (!document.title.includes(season.name)) document.title = `${season.name} — BLTA`; // the server already put the title from Backend > SEO
  await loadStandings();
  await findMyGroup();
  await loadFinal();
  await loadGallery();
  const wantsRegister = window.location.hash === '#register'; // the green "Registrácia" button of a schedule row (slta.sk) leads here
  tab = (wantsRegister ? '' : window.location.hash.slice(1)) || null; // renderTabs picks the first tab with content when there is none
  await render();
  window.dispatchEvent(new CustomEvent('blta:season-tab', { detail: { tab } }));
  if (wantsRegister && season.registrationOpen && document.getElementById('sv-register')) openRegisterModal();
  if (typeof io === 'function') {
    io().on('matches:changed', () => {
      clearTimeout(refreshTimer);
      // the timetable tab only reloads its own data (a live score changes often); the other tabs load again when opened
      refreshTimer = setTimeout(() => {
        if (tab === 'live') return; // nothing on the Live video tab changes with a score, and a redraw would reload every video
        if (tab === 'courts' && typeof reloadCourtSchedule === 'function') { loaded.clear(); reloadCourtSchedule(); } else refresh();
      }, tab === 'courts' ? 600 : 1500);
    });
  }
})();
