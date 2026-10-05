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

// The players of the season: the group lists (with their paid tick); a finished season whose lists were never filled uses
// the names in its final tables.
function playersList() {
  const registered = season.registrations || [];
  if (registered.length) return registered.map((r) => ({ id: r.slug || null, name: r.name, slug: r.slug, category: r.category, paid: r.paid }));
  const groups = season.groups || [];
  const members = groups.flatMap((g) => g.members.filter((m) => !m.withdrawn).map((m) => ({ id: m.id, name: m.name, slug: m.slug, category: g.category, paid: m.paid })));
  if (members.length) return members;
  return (standings ? standings.groups : []).flatMap((g) => g.rows.map((r) => ({ id: r.player.id, name: r.player.name, slug: r.player.slug, category: g.category, paid: null })));
}

function matchRowHtml(m, withMeta = true) {
  const done = m.status === 'FINISHED';
  const live = m.status === 'LIVE';
  const sets = (m.state && m.state.setsWon) || { 1: 0, 2: 0 };
  const mid = done
    ? `<span class="sc">${sets[1]} : ${sets[2]}</span>`
    : live
      ? `<span class="sc live">${escapeHtml(t('home.live'))}</span>`
      : `<span class="sc tbd">${escapeHtml(m.scheduledAt ? compactDateOnly(m.scheduledAt) : t('season.noDate'))}</span>`;
  const meta = !withMeta ? '' : [
    m.group ? `${CATEGORY_NAMES[m.group.category] || m.group.category} · ${m.group.name}` : '',
    m.round ? t('season.roundN', { n: m.round }) : '',
    done && m.scheduledAt ? compactDateOnly(m.scheduledAt) : '',
  ].filter(Boolean).join(' · ');
  return `
    <a class="sv-m" href="/match/${m.token}">
      <span class="a${done && m.winnerId === m.player1.id ? ' w' : ''}">${escapeHtml(m.player1.name)}</span>${mid}<span class="b${done && m.winnerId === m.player2.id ? ' w' : ''}">${escapeHtml(m.player2.name)}</span>
      ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}
    </a>`;
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
  return `
    <div class="sv-crumb"><a href="/harmonogram">${escapeHtml(t('schedule.heading'))}</a> › ${escapeHtml(termText())}</div>
    <h1 class="sv-title">${escapeHtml(season.name)}</h1>
    <div class="sv-chips"><span class="sv-chip l">${escapeHtml(t('schedule.league'))}</span>${state}${note}${actionsHtml(status)}</div>
    <div class="sv-progress">${seasonProgressHtml(season, standings)}</div>`;
}

function tilesHtml() {
  const players = playersList().length;
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

function infoHtml() {
  return season.info ? `<p class="sv-info">${escapeHtml(season.info)}</p>` : '';
}

function resultsHtml() {
  const rows = (list, empty) => (list.length ? list.map(matchRowHtml).join('') : `<div class="sv-empty">${escapeHtml(empty)}</div>`);
  return `
    <section class="sv-sec" id="sv-results">
      <div class="sv-two">
        <div>${secHead('results', t('season.results'), `/matches?season=${season.id}&tab=FINISHED`, t('season.allResults'))}<div class="sv-box">${rows(results, t('season.noResults'))}</div></div>
        <div>${secHead('upcoming', t('season.upcoming'), `/matches?season=${season.id}`, t('season.allMatches'))}<div class="sv-box">${rows(upcoming, t('season.noUpcoming'))}</div></div>
      </div>
    </section>`;
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

function scheduleHtml() {
  const rounds = season.rounds || [];
  if (!rounds.length) return '';
  const pills = rounds.map((r) => `<button type="button" class="sv-round${r.round === round ? ' cur' : ''}${r.finished >= r.total ? ' done' : ''}" data-round="${r.round}">${escapeHtml(t('season.roundN', { n: r.round }))}<small>${r.finished}/${r.total}</small></button>`).join('');
  const order = new Map((season.groups || []).map((g, i) => [g.id, i]));
  const sorted = [...roundMatches].sort((a, b) => (order.get(a.group && a.group.id) ?? 99) - (order.get(b.group && b.group.id) ?? 99));
  let html = '';
  let last = null;
  sorted.forEach((m) => {
    const key = m.group ? m.group.id : 0;
    if (key !== last) {
      last = key;
      html += `<div class="sv-ghead">${m.group ? `${escapeHtml(CATEGORY_NAMES[m.group.category] || m.group.category)} · <b>${escapeHtml(m.group.name)}</b>` : ''}</div>`;
    }
    html += matchRowHtml(m, false);
  });
  return `
    <section class="sv-sec" id="sv-schedule">
      <div class="sv-rounds" id="sv-rounds">${pills}<a class="sv-more" href="/matches?season=${season.id}">${escapeHtml(t('season.allMatches'))} ›</a></div>
      <div class="sv-box">${html || `<div class="sv-empty">${escapeHtml(t('season.noSchedule'))}</div>`}</div>
    </section>`;
}

function playersHtml() {
  const list = playersList();
  if (!list.length) return '';
  const showPaid = !!(season.entryFee || season.paymentUrl) && list.some((p) => p.paid !== null);
  const loc = currentLang === 'en' ? 'en' : 'sk';
  const rows = [...list].sort((a, b) => a.name.localeCompare(b.name, loc)).map((p) => {
    const name = p.id ? `<a href="/player/${encodeURIComponent(p.slug || p.id)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
    const paid = showPaid ? `<span class="${p.paid ? 'ok' : 'no'}">${escapeHtml(p.paid ? `✓ ${t('season.paid')}` : `— ${t('season.unpaid')}`)}</span>` : '';
    return `<div><span>${name} <em>${escapeHtml(CATEGORY_NAMES[p.category] || '')}</em></span>${paid}</div>`;
  }).join('');
  return `
    <section class="sv-sec" id="sv-players">
      ${secHead('players', '', '/players', t('season.allPlayers'))}
      <div class="sv-pl">${rows}</div>
    </section>`;
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
  const players = playersList().length;
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
