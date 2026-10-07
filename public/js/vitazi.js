// Winners page (/vitazi): per edition (series or tournament) and category the winner, the finalist and the two semifinalists as
// photo cards. Data: GET /api/winners (edited in Backend > Winners). Pills at the top show all editions or just one.
// Language changes reload the page.

const tabsEl = document.getElementById('win-tabs');
const rootEl = document.getElementById('win-root');

let editions = [];
let selected = 'ALL';

// slot 1 winner (gold), 2 finalist (silver), 3 and 4 semifinalists (bronze)
const MEDALS = { 1: ['win-gold', 'winners.winner'], 2: ['win-silver', 'winners.finalist'], 3: ['win-bronze', 'winners.semifinalist'], 4: ['win-bronze', 'winners.semifinalist'] };

function cardHtml(p) {
  const [tone, labelKey] = MEDALS[p.slot] || MEDALS[3];
  const photo = p.photoUrl
    ? `<img class="win-img" src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`
    : `<div class="win-av">${escapeHtml(initials(p.name))}</div>`;
  const inner = `
    <div class="win-ph">${photo}<img class="win-logo" src="/favicon-64.png" alt=""></div>
    <div class="win-lab"><small>${escapeHtml(t(labelKey))}</small><b>${escapeHtml(p.name)}</b></div>`;
  if (p.playerId) return `<a class="win-card ${tone}" href="/player/${encodeURIComponent(p.playerSlug || p.playerId)}">${inner}</a>`;
  return `<div class="win-card ${tone}">${inner}</div>`;
}

function blockHtml(b) {
  const head = b.category ? categoryBadge(b.category) : `<span class="win-pill">${escapeHtml(b.title)}</span>`;
  return `<div class="win-block"><div class="win-block-head">${head}</div><div class="win-grid">${b.places.map(cardHtml).join('')}</div></div>`;
}

function editionHtml(e) {
  const link = e.seasonSlug ? `<a href="/season/${encodeURIComponent(e.seasonSlug)}">${escapeHtml(t('winners.season'))}</a>` : '';
  return `<section class="win-edition"><div class="home-sec-title"><span class="l">${escapeHtml(e.title)}</span>${link}</div>${e.blocks.map(blockHtml).join('')}</section>`;
}

function render() {
  tabsEl.innerHTML = [`<button type="button" class="tab${selected === 'ALL' ? ' active' : ''}" data-id="ALL">${escapeHtml(t('winners.all'))}</button>`]
    .concat(editions.map((e) => `<button type="button" class="tab${selected === e.id ? ' active' : ''}" data-id="${e.id}">${escapeHtml(e.title)}</button>`))
    .join('');
  const shown = selected === 'ALL' ? editions : editions.filter((e) => e.id === selected);
  rootEl.innerHTML = shown.map(editionHtml).join('');
}

tabsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-id]');
  if (!btn) return;
  selected = btn.dataset.id === 'ALL' ? 'ALL' : Number(btn.dataset.id);
  render();
});

(async () => {
  try {
    editions = await api('/winners');
  } catch {
    tabsEl.innerHTML = '';
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('winners.loadError'))}</div>`;
    return;
  }
  if (!editions.length) {
    tabsEl.innerHTML = '';
    rootEl.innerHTML = `<div class="empty-state">${escapeHtml(t('winners.empty'))}</div>`;
    return;
  }
  render();
})();
