// The live video links of the courts of a tournament, as the admin pages show them: one input per court ("Kurt 1" … "Kurt n") under the number of courts, and — for a
// court that has a SAVED link — the overlay link of its scoreboard (/overlay/<slug>/<court>, see public/js/overlay.js) to put into PRISM or OBS, with a Copy button.
// Used by the tournament form (seasons-admin.js) and the Kurty box of the draw page (season-draw.js); the server (src/courtStreams.js) checks the links.
// tl / escapeHtml / copyToClipboard / toast come from i18n.js and common.js, loaded before this file.

const COURT_STREAMS_MAX = 50; // the same top as the number of courts (src/routes/seasons.js)

function courtOverlayUrl(slug, court) {
  return `${window.location.origin}${window.CITY_BASE || ''}/overlay/${encodeURIComponent(slug)}/${court}`; // (a city site is slta.sk/<city>/…)
}

// saved: which courts have a saved link (only those have an overlay); slug: the tournament's address
function courtStreamInputsHtml(count, values, saved, slug) {
  const n = Math.max(0, Math.min(COURT_STREAMS_MAX, Math.floor(Number(count)) || 0));
  return Array.from({ length: n }, (_, i) => {
    const url = saved[i] && slug ? courtOverlayUrl(slug, i + 1) : '';
    return `
    <div class="court-stream-item">
      <label class="sa-field court-stream-field">${escapeHtml(tl('Kurt', 'Court'))} ${i + 1} — ${escapeHtml(tl('odkaz na live video (YouTube)', 'live video link (YouTube)'))}
        <input type="text" inputmode="url" maxlength="300" data-court-stream="${i + 1}" value="${escapeHtml(values[i] || '')}" placeholder="https://youtube.com/…">
      </label>
      ${url ? `<div class="court-overlay-url">
        <span>${escapeHtml(tl('Odkaz na overlay so skóre (PRISM / OBS)', 'Scoreboard overlay link (PRISM / OBS)'))}</span>
        <div><input type="text" readonly value="${escapeHtml(url)}" aria-label="${escapeHtml(tl('Odkaz na overlay', 'Overlay link'))} ${i + 1}"><button type="button" class="btn btn-sm btn-outline" data-copy-overlay="${escapeHtml(url)}">${escapeHtml(tl('Kopírovať', 'Copy'))}</button></div>
      </div>` : ''}
    </div>`;
  }).join('');
}

// count: the number of courts; streams: the saved ones from the server, [{ url } or null] for Court 1 … n; slug: the address of the tournament
function courtStreamFieldsHtml(count, streams, slug) {
  const values = (streams || []).map((s) => (s && s.url) || '');
  const saved = (streams || []).map((s) => !!s);
  return `<div class="court-streams sa-full" data-court-streams data-slug="${escapeHtml(slug || '')}" data-saved="${escapeHtml(JSON.stringify(saved))}">${courtStreamInputsHtml(count, values, saved, slug)}</div>`;
}

// the typed links in court order ('' for a court without one)
function readCourtStreams(root) {
  return [...root.querySelectorAll('[data-court-stream]')].map((input) => input.value.trim());
}

// the number of courts was changed: one input per court again, the links already typed stay on their courts
// (the links typed for courts that are not shown now are kept in box._kept and come back when the count grows again: typing "12" or erasing "3" to type "4"
// passes through counts that would otherwise throw the links away)
function syncCourtStreamFields(root, count) {
  const box = root.querySelector('[data-court-streams]');
  if (!box) return;
  const kept = box._kept || [];
  readCourtStreams(root).forEach((value, i) => { kept[i] = value; });
  box._kept = kept;
  let saved = [];
  try { saved = JSON.parse(box.dataset.saved || '[]'); } catch { saved = []; }
  box.innerHTML = courtStreamInputsHtml(count, kept, saved, box.dataset.slug || '');
}

// the Copy button of an overlay link
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-copy-overlay]');
  if (!button) return;
  copyToClipboard(button.dataset.copyOverlay).then(() => toast(tl('Odkaz skopírovaný', 'Link copied'))).catch(() => {
    const input = button.parentElement.querySelector('input');
    if (input) input.select();
  });
});
