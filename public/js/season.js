// Season page (/season/<slug>): one page per season that gathers what already lives elsewhere in the app — the numbers of the
// season (from its dates, groups and players), the group tables, the latest results and next matches, the round schedule, the
// players, the play-off bracket — as tabs: only the chosen tab is shown, and a tab loads its data when it is first opened. Only the entry fee, prize money, draw
// date, description, gallery link and the "paid" ticks are entered for this page (backend > Seasons).
// Data: GET /api/seasons/by-slug/:slug, /api/seasons/:id/standings, /api/seasons/:id/brackets, /api/matches?seasonId=…

const rootEl = document.getElementById('sv-root');
const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || '');

const CATEGORY_ORDER = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };

let season = null;
let standings = null;
let brackets = [];
let results = [];
let upcoming = [];
let roundMatches = [];
let category = null;
let round = null;
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

// "Sep – Dec 2026" / "Dec 2025 – Apr 2026"
function termText() {
  if (!season.startDate || !season.endDate) return '';
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

async function loadRound() {
  roundMatches = round === null ? [] : await api(`/matches?seasonId=${season.id}&round=${round}`).catch(() => []);
}

// The round to show first: the first one that still has matches to play, else the last.
function pickRound() {
  const rounds = season.rounds || [];
  if (!rounds.length) return null;
  const open = rounds.find((r) => r.finished < r.total);
  return (open || rounds[rounds.length - 1]).round;
}

// ---------- pieces ----------

function statusOf() {
  const today = todayIso();
  if (standings && standings.frozen) return 'past';
  if (season.endDate && season.endDate < today) return 'past';
  if (season.startDate && season.startDate > today) return 'future';
  return 'now';
}

// The players of the season grouped like the season itself: category -> group -> players. A group's list is its members
// (backend), else the names in its table; a registered player not yet placed in a group waits in "ungrouped". `paid` is
// true/false when known (a registration or a group member), null when it is not tracked (a finished season).
function playersModel() {
  const regs = new Map((season.registrations || []).map((r) => [nameKey(r.name), r]));
  const tables = new Map((standings ? standings.groups : []).map((g) => [g.id, g]));
  const placed = new Set();
  const cats = CATEGORY_ORDER.map((category) => ({ category, groups: [] }));
  (season.groups || []).forEach((g) => {
    const members = g.members.filter((m) => !m.withdrawn);
    let people;
    if (members.length) {
      people = members.map((m) => ({ name: m.name, slug: m.slug, paid: !!(m.paid || (regs.get(nameKey(m.name)) || {}).paid) }));
    } else {
      const table = tables.get(g.id);
      people = (table ? table.rows : []).map((r) => {
        const reg = regs.get(nameKey(r.player.name));
        return { name: r.player.name, slug: r.player.slug, paid: reg ? reg.paid : null };
      });
    }
    people.forEach((p) => placed.add(nameKey(p.name)));
    const cat = cats.find((c) => c.category === g.category);
    if (cat && people.length) cat.groups.push({ name: g.name, players: people }); // a group without players has nothing to show yet
  });
  const ungrouped = (season.registrations || []).filter((r) => !placed.has(nameKey(r.name))).map((r) => ({ name: r.name, slug: r.slug, paid: r.paid, category: r.category }));
  const total = cats.reduce((sum, c) => sum + c.groups.reduce((a, g) => a + g.players.length, 0), 0) + ungrouped.length;
  return { cats: cats.filter((c) => c.groups.length), ungrouped, total };
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
        <div class="sv-chips"><span class="sv-chip l">${escapeHtml(t('schedule.league'))}</span>${state}${note}${actionsHtml(status)}</div>
      </div>
    </div>
    <div class="sv-progress">${seasonProgressHtml(season, standings)}</div>`;
}

function tilesHtml() {
  const players = playersModel().total;
  const groupCount = (season.groups || []).length || (standings ? standings.groups.length : 0);
  const tile = (key, value, sub) => `<div class="sv-tile"><div class="k">${escapeHtml(t(key))}</div><div class="v">${value}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div></div>`;
  const cats = CATEGORY_ORDER.filter((c) => (season.groups || []).some((g) => g.category === c) || (standings && standings.groups.some((g) => g.category === c)));
  const tiles = [
    cats.length ? tile('season.tileCats', String(cats.length), cats.map((c) => CATEGORY_NAMES[c]).join(' · ')) : '',
    termText() ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileTerm'))}</div><div class="v sm">${escapeHtml(termText())}</div></div>` : '',
    players ? tile('season.tilePlayers', String(players), groupCount ? t('season.groupsN', { n: groupCount }) : '') : '',
    season.entryFee ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileFee'))}</div><div class="v">${escapeHtml(season.entryFee)}</div></div>` : '',
    season.drawDate ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tileDraw'))}</div><div class="v sm">${escapeHtml(formatDate(season.drawDate))}</div></div>` : '',
    season.prizeMoney ? `<div class="sv-tile"><div class="k">${escapeHtml(t('season.tilePrize'))}</div><div class="v sm">${escapeHtml(season.prizeMoney)}</div></div>` : '',
  ].join('');
  return `<div class="sv-tiles">${tiles}</div>`;
}

// The description, laid out: the sentences as a lead card, "Label: value" lines as fact tiles, a short last line as the
// sign-off. (Plain text typed in the backend; blank lines separate the blocks.)
function infoHtml() {
  if (!season.info) return '';
  const blocks = season.info.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const lead = [];
  const facts = [];
  let sign = '';
  blocks.forEach((block, i) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const pairs = lines.map((l) => l.match(/^([^:]{2,40}):\s*(.+)$/));
    if (pairs.every(Boolean)) pairs.forEach((m) => facts.push([m[1], m[2]]));
    else if (i === blocks.length - 1 && lines.length === 1 && lines[0].length <= 40 && i > 0) sign = lines[0];
    else lead.push(lines.join(' '));
  });
  return `
    <div class="sv-about">
      ${lead.length ? `<div class="sv-about-lead">${lead.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : ''}
      ${facts.length ? `<div class="sv-facts">${facts.map(([k, v]) => `<div class="sv-fact"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>` : ''}
      ${sign ? `<div class="sv-sign">${escapeHtml(sign)}</div>` : ''}
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

// One match of the round in a group card: the two names stacked, the result or the date on the right.
function scheduleRow(m) {
  const done = m.status === 'FINISHED';
  const sets = (m.state && m.state.setsWon) || { 1: 0, 2: 0 };
  const right = done ? `<span class="rs">${sets[1]} : ${sets[2]}</span>`
    : m.status === 'LIVE' ? `<span class="rs live">${escapeHtml(t('home.live'))}</span>`
      : m.scheduledAt ? `<span class="rs date">${escapeHtml(chipDate(m.scheduledAt))}</span>`
        : '<span class="rs tbd">—</span>';
  return `<a class="sv-rg-m" href="/match/${m.token}"><span class="pl"><span class="${done && m.winnerId === m.player1.id ? 'w' : ''}">${escapeHtml(m.player1.name)}</span><span class="${done && m.winnerId === m.player2.id ? 'w' : ''}">${escapeHtml(m.player2.name)}</span></span>${right}</a>`;
}

// The Rozpis tab: the rounds as buttons (with how far each is), and the chosen round as one small card per group.
function scheduleHtml() {
  const rounds = season.rounds || [];
  if (!rounds.length) return '';
  const pills = rounds.map((r) => `<button type="button" class="sv-round${r.round === round ? ' cur' : ''}" data-round="${r.round}" style="--p:${Math.round((r.finished / Math.max(1, r.total)) * 100)}%"><b>${escapeHtml(t('season.roundN', { n: r.round }))}</b><small>${r.finished}/${r.total}</small></button>`).join('');
  const order = new Map((season.groups || []).map((g, i) => [g.id, i]));
  const byGroup = new Map();
  roundMatches.forEach((m) => {
    const id = m.group ? m.group.id : 0;
    if (!byGroup.has(id)) byGroup.set(id, { group: m.group, list: [] });
    byGroup.get(id).list.push(m);
  });
  const cards = [...byGroup.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99)).map(([, { group, list }]) => `
    <div class="sv-rg-card">
      <div class="sv-rg-h"><b>${escapeHtml(group ? group.name : '')}</b><span>${escapeHtml(group ? (CATEGORY_NAMES[group.category] || '') : '')}</span></div>
      ${list.map(scheduleRow).join('')}
    </div>`).join('');
  return `
    <section class="sv-sec" id="sv-schedule">
      <div class="sv-rounds" id="sv-rounds">${pills}<a class="sv-more" href="/matches?season=${season.id}">${escapeHtml(t('season.allMatches'))} ›</a></div>
      <div class="sv-rg">${cards || `<div class="sv-empty">${escapeHtml(t('season.noSchedule'))}</div>`}</div>
    </section>`;
}

// The Hráči tab: the players divided by category and group — a small card per group.
function playersHtml() {
  const model = playersModel();
  if (!model.total) return '';
  const showPaid = !!(season.entryFee || season.paymentUrl);
  const person = (p, withCat) => {
    const name = p.slug ? `<a href="/player/${encodeURIComponent(p.slug)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
    const paid = showPaid && p.paid !== null && p.paid !== undefined ? `<span class="${p.paid ? 'ok' : 'no'}" title="${escapeHtml(p.paid ? t('season.paid') : t('season.unpaid'))}">${p.paid ? '✓' : '—'}</span>` : '';
    return `<div class="sv-pp"><span class="nm">${name}${withCat ? ` <em>${escapeHtml(CATEGORY_NAMES[p.category] || '')}</em>` : ''}</span>${paid}</div>`;
  };
  const card = (title, people, withCat) => `<div class="sv-pcard"><div class="sv-pcard-h"><b>${escapeHtml(title)}</b><span>${people.length}</span></div>${people.map((p) => person(p, withCat)).join('')}</div>`;
  const sections = model.cats.map((c) => {
    const count = c.groups.reduce((sum, g) => sum + g.players.length, 0);
    return `<div class="sv-cat-h">${escapeHtml(CATEGORY_NAMES[c.category])}<em>${count}</em></div><div class="sv-pg">${c.groups.map((g) => card(g.name, g.players, false)).join('')}</div>`;
  });
  if (model.ungrouped.length) {
    sections.push(`<div class="sv-cat-h">${escapeHtml(t('season.noGroupYet'))}<em>${model.ungrouped.length}</em></div><div class="sv-pg">${card(t('season.noGroupCard'), model.ungrouped, true)}</div>`);
  }
  const legend = showPaid ? `<p class="sv-note">✓ ${escapeHtml(t('season.paid'))} · — ${escapeHtml(t('season.unpaid'))}</p>` : '';
  return `<section class="sv-sec" id="sv-players">${sections.join('')}${legend}</section>`;
}

function playoffHtml() {
  const hasGroups = standings && standings.groups.length;
  if (!brackets.length && (statusOf() === 'past' || !hasGroups)) return '';
  const body = brackets.length
    ? brackets.map((b) => `<div class="sv-bracket" data-bracket="${b.id}"><h3 class="grp-title">${escapeHtml(CATEGORY_NAMES[b.category] || '')} · ${escapeHtml(b.name)}</h3><div class="sv-bracket-body">${escapeHtml(t('common.loading'))}</div></div>`).join('')
    : `<div class="sv-empty">${escapeHtml(t('season.playoffSoon'))}</div>`;
  return `<section class="sv-sec" id="sv-playoff">${secHead('playoff', '')}${body}</section>`;
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
      <h3>${escapeHtml(t('season.regTitle'))}</h3>
      <div class="sv-reg-season">${escapeHtml(season.name)}</div>
      <form id="sv-reg-form" novalidate>
        <div class="field">
          <label for="sv-reg-name">${escapeHtml(t('season.regName'))}</label>
          <div class="autocomplete"><input type="text" id="sv-reg-name" autocomplete="off" maxlength="80"><div class="autocomplete-list" id="sv-reg-name-list"></div></div>
          <small>${escapeHtml(t('season.regNameHint'))}</small>
        </div>
        <div class="field"><label for="sv-reg-phone">${escapeHtml(t('season.regPhone'))}</label><input type="tel" id="sv-reg-phone" autocomplete="tel" maxlength="20" placeholder="0903 111 222"></div>
        <div class="field"><label for="sv-reg-email">${escapeHtml(t('season.regEmail'))}</label><input type="email" id="sv-reg-email" autocomplete="email" maxlength="120"></div>
        <div class="field"><label for="sv-reg-cat">${escapeHtml(t('season.regCategory'))}</label>
          <select id="sv-reg-cat"><option value="">${escapeHtml(t('season.regChoose'))}</option>${CATEGORY_ORDER.map((c) => `<option value="${c}">${escapeHtml(CATEGORY_NAMES[c])}</option>`).join('')}</select>
        </div>
        <input type="text" id="sv-reg-website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px">
        <div class="sv-reg-similar" id="sv-reg-similar"></div>
        <div class="sv-reg-error" id="sv-reg-error"></div>
        <p class="sv-reg-note">${escapeHtml(t('season.regNote'))}</p>
        <button type="submit" class="btn btn-primary btn-block" id="sv-reg-send">${escapeHtml(t('season.regSend'))}</button>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector(`#sv-reg-${id}`);
  const close = () => wrap.remove();
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
    const category = $('cat').value;
    if (typed.length < 3) return fail(t('season.regErrName'));
    if (phone.replace(/\D/g, '').length < 9) return fail(t('season.regErrPhone'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(t('season.regErrEmail'));
    if (!category) return fail(t('season.regErrCategory'));
    const known = chosenId ? { id: chosenId } : findPlayerByTypedName(typed);
    const button = $('send');
    button.disabled = true;
    button.textContent = t('season.regSending');
    try {
      const res = await api(`/seasons/${season.id}/registrations`, {
        method: 'POST',
        body: { name: typed, phone, email, category, website: $('website').value, ...(known ? { playerId: known.id } : {}), ...(confirmNew ? { confirmNew: true } : {}) },
      });
      const pay = res && res.paymentUrl
        ? `<p>${escapeHtml(t('season.regPayHint'))}</p><a class="btn btn-primary btn-block" href="${escapeHtml(res.paymentUrl)}" target="_blank" rel="noopener">${escapeHtml(t('season.payOnline'))}</a>`
        : '';
      wrap.querySelector('.modal').innerHTML = `
        <button type="button" class="close" data-close aria-label="${escapeHtml(t('season.regClose'))}">&times;</button>
        <h3>${escapeHtml(t('season.regThanks', { name: (res && res.name) || typed }))}</h3>
        <p>${escapeHtml(t('season.regDone'))}</p>${pay}
        <button type="button" class="btn btn-outline btn-block" data-close style="margin-top:10px">${escapeHtml(t('season.regClose'))}</button>`;
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
      const msg = { ALREADY_REGISTERED: 'season.regAlready', REGISTRATION_CLOSED: 'season.regClosedErr', BAD_NAME: 'season.regErrName', BAD_EMAIL: 'season.regErrEmail', BAD_PHONE: 'season.regErrPhone', BAD_CATEGORY: 'season.regErrCategory' }[d.code];
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
  return [
    { key: 'info', label: t('season.navInfo'), has: !!season.info },
    { key: 'tables', label: t('season.navTables'), has: hasGroups },
    { key: 'results', label: t('season.navResults'), has: season.matchCount > 0 },
    { key: 'schedule', label: t('season.navSchedule'), has: (season.rounds || []).length > 0 },
    { key: 'players', label: t('season.navPlayers'), has: players > 0, count: players },
    { key: 'playoff', label: t('season.navPlayoff'), has: brackets.length > 0 || (hasGroups && statusOf() !== 'past') },
    { key: 'gallery', label: t('season.navGallery'), has: !!season.galleryUrl },
  ];
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
  rootEl.innerHTML = `${headerHtml()}${tilesHtml()}<div class="tabs" id="sv-tabs" role="tablist"></div><div id="sv-panel" class="sv-panel"></div>`;
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
  const r = e.target.closest('#sv-panel [data-round]');
  if (r) {
    round = Number(r.dataset.round);
    await loadRound();
    renderPanel();
  }
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
  document.title = `${season.name} — Tennis SCORE`;
  round = pickRound();
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
