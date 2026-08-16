const listEl = document.getElementById('live-list');

function itemHtml(m) {
  const url = `${window.location.origin}/match/${m.token}`;
  return `
    <div class="embed-live-item">
      ${categoryBadge(m.category)}
      <a href="${url}" target="_blank" rel="noopener">
        <strong>${escapeHtml(m.player1.name)}</strong> vs <strong>${escapeHtml(m.player2.name)}</strong>
      </a>
      <span class="match-score">${escapeHtml(m.scoreSummary) || 'starting…'}</span>
    </div>
  `;
}

async function load() {
  try {
    const matches = await api('/matches?status=LIVE');
    listEl.innerHTML = matches.length
      ? `<div style="font-weight:800;margin-bottom:8px">🔴 Live now</div>${matches.map(itemHtml).join('')}`
      : `<div class="empty-state" style="padding:24px">No live matches right now.</div>`;
  } catch {
    listEl.innerHTML = `<div class="empty-state">Could not load live matches.</div>`;
  }
}

const socket = io();
socket.on('matches:changed', load);
load();
