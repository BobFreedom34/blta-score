const grid = document.getElementById('courts-grid');
const summaryEl = document.getElementById('courts-summary');
const searchEl = document.getElementById('courts-search');
const filtersEl = document.getElementById('courts-filters');

let venues = [];
let filter = 'ALL';
let query = '';
let map = null;
let markerLayer = null;

function filterMatches(v) {
  if (filter === 'INDOOR' && !venueHasIndoor(v)) return false;
  if (filter === 'OUTDOOR' && !venueHasOutdoor(v)) return false;
  if (!query) return true;
  return foldText(`${v.name} ${v.area || ''} ${v.address || ''}`).includes(query);
}

function cardHtml(v) {
  const detailUrl = `/courts/${encodeURIComponent(v.slug)}`;
  const lines = [];
  if (v.address) lines.push(`<a class="court-line" href="${escapeHtml(venueMapsUrl(v))}" target="_blank" rel="noopener noreferrer"><span class="court-line-icon">📍</span>${escapeHtml(v.address)}</a>`);
  if (v.phone) lines.push(`<a class="court-line" href="${escapeHtml(venueTelHref(v.phone))}"><span class="court-line-icon">📞</span>${escapeHtml(v.phone)}</a>`);
  const chips = venueChipsHtml(v);
  const actions = [];
  if (v.website) actions.push(`<a class="btn btn-sm btn-outline" href="${escapeHtml(v.website)}" target="_blank" rel="noopener noreferrer">🌐 ${escapeHtml(t('courts.website'))}</a>`);
  if (v.bookingUrl) actions.push(`<a class="btn btn-sm btn-primary" href="${escapeHtml(v.bookingUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('courts.book'))}</a>`);
  actions.push(`<a class="btn btn-sm btn-dark" href="${detailUrl}">${escapeHtml(t('courts.details'))}</a>`);
  return `
    <article class="court-card">
      <a class="court-card-head" href="${detailUrl}">
        <h3 class="court-card-name">${escapeHtml(v.name)}</h3>
        ${v.area ? `<div class="court-card-area">${escapeHtml(v.area)}</div>` : ''}
      </a>
      ${lines.length ? `<div class="court-lines">${lines.join('')}</div>` : ''}
      ${chips ? `<div class="court-chips">${chips}</div>` : ''}
      <div class="court-actions">${actions.join('')}</div>
    </article>
  `;
}

function renderFilters() {
  const options = [
    ['ALL', t('courts.filterAll'), venues.length],
    ['INDOOR', t('courts.filterIndoor'), venues.filter(venueHasIndoor).length],
    ['OUTDOOR', t('courts.filterOutdoor'), venues.filter(venueHasOutdoor).length],
  ];
  filtersEl.innerHTML = options.map(([key, label, count]) => `
    <button type="button" class="tab${key === filter ? ' active' : ''}" data-filter="${key}" role="tab">${escapeHtml(label)} <span class="count">${count}</span></button>
  `).join('');
}

function renderMap(visible) {
  const mapEl = document.getElementById('courts-map');
  const pinned = visible.filter((v) => v.lat != null && v.lng != null);
  if (typeof L === 'undefined' || (!map && !venues.some((v) => v.lat != null))) {
    mapEl.style.display = 'none';
    return;
  }
  if (!map) {
    map = L.map(mapEl, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  markerLayer.clearLayers();
  pinned.forEach((v) => {
    L.marker([v.lat, v.lng]).addTo(markerLayer).bindPopup(
      `<strong>${escapeHtml(v.name)}</strong>${v.address ? `<br>${escapeHtml(v.address)}` : ''}<br><a href="/courts/${encodeURIComponent(v.slug)}">${escapeHtml(t('courts.details'))} →</a>`
    );
  });
  if (pinned.length) map.fitBounds(L.latLngBounds(pinned.map((v) => [v.lat, v.lng])), { padding: [30, 30], maxZoom: 14 });
}

function render() {
  const visible = venues.filter(filterMatches);
  grid.innerHTML = visible.length
    ? visible.map(cardHtml).join('')
    : `<div class="courts-empty">${escapeHtml(t('courts.empty'))}</div>`;
  renderFilters();
  renderMap(visible);
}

filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  render();
});

searchEl.addEventListener('input', () => {
  query = foldText(searchEl.value.trim());
  render();
});

(async () => {
  try {
    venues = await api('/venues');
  } catch {
    grid.innerHTML = `<div class="courts-empty">${escapeHtml(t('courts.empty'))}</div>`;
    return;
  }
  const indoor = venues.filter(venueHasIndoor).length;
  summaryEl.textContent = [
    t('courts.summary', { count: venues.length }),
    indoor ? t('courts.summaryIndoor', { count: indoor }) : '',
  ].filter(Boolean).join(' ');
  render();
})();
