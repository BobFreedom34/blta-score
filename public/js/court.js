const root = document.getElementById('court-root');
const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

function infoRow(icon, label, valueHtml) {
  return `
    <div class="court-info-row">
      <span class="court-info-icon">${icon}</span>
      <div>
        <div class="court-info-label">${escapeHtml(label)}</div>
        <div class="court-info-value">${valueHtml}</div>
      </div>
    </div>
  `;
}

function externalLink(url, text) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

function infoRowsHtml(v) {
  const rows = [];
  if (v.address) rows.push(infoRow(courtIcon('pin'), t('court.address'), externalLink(venueMapsUrl(v), [v.address, v.area].filter(Boolean).join(' — '))));
  else if (v.area) rows.push(infoRow(courtIcon('pin'), t('court.address'), escapeHtml(v.area)));
  if (v.phone) rows.push(infoRow(courtIcon('phone'), t('court.phone'), `<a href="${escapeHtml(venueTelHref(v.phone))}">${escapeHtml(v.phone)}</a>`));
  if (v.email) rows.push(infoRow(courtIcon('mail'), t('court.email'), `<a href="mailto:${escapeHtml(v.email)}">${escapeHtml(v.email)}</a>`));
  if (v.website) rows.push(infoRow(courtIcon('globe'), t('court.website'), externalLink(v.website, venueHostLabel(v.website))));
  if (v.instagram) rows.push(infoRow(courtIcon('instagram'), 'Instagram', externalLink(`https://www.instagram.com/${encodeURIComponent(v.instagram)}/`, `@${v.instagram}`)));
  if (v.facebook) rows.push(infoRow(courtIcon('facebook'), 'Facebook', externalLink(v.facebook, venueHostLabel(v.facebook))));
  if (v.courtsCount || v.courtType) {
    const parts = [v.courtsCount ? courtsCountLabel(v.courtsCount) : '', v.courtType ? t(`courtType.${v.courtType}`) : ''].filter(Boolean);
    rows.push(infoRow(courtIcon('ball'), t('court.courts'), escapeHtml(parts.join(' · '))));
  }
  if (v.surfaces.length) rows.push(infoRow(courtIcon('layers'), t('court.surface'), escapeHtml(v.surfaces.map((s) => t(`surface.${s}`)).join(', '))));
  if (v.openingHours) rows.push(infoRow(courtIcon('clock'), t('court.hours'), escapeHtml(v.openingHours)));
  if (v.price) rows.push(infoRow(courtIcon('price'), t('court.price'), escapeHtml(v.price)));
  if (v.facilities.length) {
    rows.push(infoRow(courtIcon('check'), t('court.facilities'), `<div class="court-chips">${v.facilities.map((f) => `<span class="court-chip">${escapeHtml(t(`facility.${f}`))}</span>`).join('')}</div>`));
  }
  return rows.join('');
}

function matchRowHtml(m) {
  const winner1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winner2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  return `
    <a class="court-match" href="/match/${encodeURIComponent(m.token)}">
      <div class="court-match-top">
        ${categoryBadge(m.category)}
        ${m.status === 'LIVE' ? `<span class="court-match-live">● ${escapeHtml(t('matches.liveHeading'))}</span>` : ''}
        <span class="court-match-date">${escapeHtml(fmtDateShort(m.scheduledAt))}</span>
      </div>
      <div class="court-match-players">
        <span class="${winner1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}</span>
        <span class="court-match-vs">vs</span>
        <span class="${winner2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}</span>
      </div>
      ${m.scoreSummary ? `<div class="court-match-score">${escapeHtml(m.scoreSummary)}</div>` : ''}
    </a>
  `;
}

function matchesSectionHtml(matches) {
  const groups = [
    [t('court.upcoming'), matches.upcoming],
    [t('court.recent'), matches.recent],
  ].filter(([, list]) => list.length);
  return `
    <h2 class="court-section-title">${escapeHtml(t('court.matchesHeading'))}</h2>
    ${groups.length ? groups.map(([label, list]) => `
      <div class="court-match-group">${escapeHtml(label)}</div>
      <div class="court-matches">${list.map(matchRowHtml).join('')}</div>
    `).join('') : `<p class="court-muted">${escapeHtml(t('court.noMatches'))}</p>`}
  `;
}

function render(v) {
  document.title = `${v.name} — Tennis SCORE`;
  const meta = [];
  if (v.address) meta.push(`<a class="court-meta-address" href="${escapeHtml(venueMapsUrl(v))}" target="_blank" rel="noopener noreferrer">${courtIcon('pin')}${escapeHtml(v.address)}</a>`);
  else if (v.area) meta.push(`<span class="court-meta-address">${courtIcon('pin')}${escapeHtml(v.area)}</span>`);
  if (v.courtType) meta.push(`<span class="court-chip court-chip-type">${escapeHtml(t(`courtType.${v.courtType}`))}</span>`);
  if (v.price) meta.push(`<span class="court-chip">${escapeHtml(v.price)}</span>`);

  const actions = [];
  if (v.bookingUrl) actions.push(`<a class="court-btn court-btn-primary" href="${escapeHtml(v.bookingUrl)}" target="_blank" rel="noopener noreferrer">${courtIcon('arrow')}${escapeHtml(t('courts.book'))}</a>`);
  if (v.website) actions.push(`<a class="court-btn" href="${escapeHtml(v.website)}" target="_blank" rel="noopener noreferrer">${courtIcon('globe')}${escapeHtml(t('courts.website'))}</a>`);
  if (v.phone) actions.push(`<a class="court-btn" href="${escapeHtml(venueTelHref(v.phone))}">${courtIcon('phone')}${escapeHtml(t('courts.call'))}</a>`);
  if (v.lat != null || v.address) actions.push(`<a class="court-btn" href="${escapeHtml(venueMapsUrl(v))}" target="_blank" rel="noopener noreferrer">${courtIcon('directions')}${escapeHtml(t('courts.directions'))}</a>`);

  const info = infoRowsHtml(v);
  root.innerHTML = `
    <h1 class="court-title">${escapeHtml(v.name)}</h1>
    <div class="court-meta">${meta.join('')}</div>
    ${actions.length ? `<div class="court-actions court-actions-hero">${actions.join('')}</div>` : ''}
    ${v.description ? `<p class="court-desc">${escapeHtml(v.description)}</p>` : ''}
    ${matchesSectionHtml(v.matches)}
    ${info ? `<h2 class="court-section-title">${escapeHtml(t('court.infoHeading'))}</h2><div class="court-info">${info}</div>` : ''}
    ${v.lat != null && v.lng != null ? `
      <h2 class="court-section-title">${escapeHtml(t('court.whereHeading'))}</h2>
      <div id="court-map" class="courts-map"></div>
    ` : ''}
  `;

  if (v.lat != null && v.lng != null && typeof L !== 'undefined') {
    const map = L.map('court-map', { scrollWheelZoom: false }).setView([v.lat, v.lng], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.marker([v.lat, v.lng]).addTo(map);
  } else {
    const mapEl = document.getElementById('court-map');
    if (mapEl) mapEl.style.display = 'none';
  }
}

(async () => {
  try {
    render(await api(`/venues/${encodeURIComponent(slug)}`));
  } catch {
    root.innerHTML = `<p class="court-muted">${escapeHtml(t('court.notFound'))}</p>`;
  }
})();
