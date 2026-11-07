// The live video links of the courts of a tournament, as the admin pages show them: one input per court ("Kurt 1" … "Kurt n") under the number of courts.
// Used by the tournament form (seasons-admin.js) and the Kurty box of the draw page (season-draw.js); the server (src/courtStreams.js) checks the links.
// tl / escapeHtml come from i18n.js and common.js, loaded before this file.

const COURT_STREAMS_MAX = 50; // the same top as the number of courts (src/routes/seasons.js)

function courtStreamInputsHtml(count, values) {
  const n = Math.max(0, Math.min(COURT_STREAMS_MAX, Math.floor(Number(count)) || 0));
  return Array.from({ length: n }, (_, i) => `
    <label class="sa-field court-stream-field">${escapeHtml(tl('Kurt', 'Court'))} ${i + 1} — ${escapeHtml(tl('odkaz na live video (YouTube)', 'live video link (YouTube)'))}
      <input type="text" inputmode="url" maxlength="300" data-court-stream="${i + 1}" value="${escapeHtml(values[i] || '')}" placeholder="https://youtube.com/…">
    </label>`).join('');
}

// count: the number of courts; streams: the saved ones from the server, [{ url } or null] for Court 1 … n
function courtStreamFieldsHtml(count, streams) {
  const values = (streams || []).map((s) => (s && s.url) || '');
  return `<div class="court-streams sa-full" data-court-streams>${courtStreamInputsHtml(count, values)}</div>`;
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
  box.innerHTML = courtStreamInputsHtml(count, kept);
}
