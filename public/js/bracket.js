// Public playoff-bracket display — dark/orange theme matching the rest of
// the app (see .card-dark and friends in style.css). No live-update
// requirement for v1: this renders once on load; a match finishing
// elsewhere needs a page refresh to show here, same as any other static
// read of GET /api/matches. Also loaded, unchanged, by embed-bracket.html
// — the "Embed this bracket" button simply isn't present in that page's
// markup, so the wiring below is naturally a no-op there.
const bracketId = window.location.pathname.split('/').filter(Boolean).pop();

function slotHtml(node, which) {
  const player = which === 1 ? node.player1 : node.player2;
  const seed = which === 1 ? node.seed1 : node.seed2;
  // node.winnerId already folds together a real match's winner_id and a
  // historical/manual result's own winner (see serializeNode in
  // routes/brackets.js) — this doesn't need to know which one it is.
  const isWinner = node.winnerId && player && node.winnerId === player.id;
  // playerNameLink (common.js) — a clickable <span> with its own
  // stopPropagation, not a real <a> — because the whole match card below
  // is ALSO clickable (to the match itself); a real <a> nested inside
  // another clickable wrapper is invalid HTML and gets silently mangled
  // by the browser's parser (an anchor can't contain another anchor).
  const nameHtml = player
    ? playerNameLink(player)
    : `<span style="color:var(--gray-dim)">${node.round === 1 ? '—' : 'TBD'}</span>`;
  return `
    <div class="bracket-slot${isWinner ? ' winner' : ''}">
      <span class="bracket-slot-name">${seed ? `<span class="bracket-seed">(${seed})</span>` : ''}${nameHtml}</span>
    </div>
  `;
}

function matchMetaHtml(node) {
  if (node.isBye) return `<div class="bracket-match-meta">Bye</div>`;
  if (node.isManualResult) return `<div class="bracket-match-meta">${escapeHtml(node.scoreSummary || 'Result recorded')}</div>`;
  if (!node.match) return '';
  const m = node.match;
  if (m.status === 'LIVE') return `<div class="bracket-match-meta" style="color:var(--orange)">● Live</div>`;
  if (m.status === 'FINISHED') return `<div class="bracket-match-meta">${escapeHtml(m.scoreSummary || 'Finished')}</div>`;
  if (m.scheduledAt) return `<div class="bracket-match-meta">${escapeHtml(fmtDateShort(m.scheduledAt))}</div>`;
  return `<div class="bracket-match-meta">Not yet scheduled</div>`;
}

function nodeHtml(node) {
  const inner = `
    ${slotHtml(node, 1)}
    <div class="bracket-vs-divider"></div>
    ${slotHtml(node, 2)}
    ${matchMetaHtml(node)}
  `;
  // Never a real <a> (see slotHtml's comment above) — a plain onclick
  // navigation instead, same trick playerNameLink itself uses.
  const clickNav = node.match ? ` onclick="window.location.href='/match/${node.match.token}'"` : '';
  const cardClass = node.match ? 'bracket-match-card bracket-match-card-clickable' : 'bracket-match-card';
  return `<div class="bracket-node" style="grid-column:${node.round};grid-row:${node.position * (2 ** node.round) + 2} / span ${2 ** node.round}"><div class="${cardClass}"${clickNav}>${inner}</div></div>`;
}

function render(data) {
  document.title = `${data.name} — Tennis SCORE`;
  document.getElementById('bracket-title').textContent = data.name;

  const finalNode = data.nodes.find((n) => n.round === data.rounds);
  const finalDecided = finalNode && ((finalNode.match && finalNode.match.status === 'FINISHED') || finalNode.isManualResult);
  const championId = finalDecided ? finalNode.winnerId : null;
  const championPlayer = finalNode && championId
    ? [finalNode.player1, finalNode.player2].find((p) => p && p.id === championId)
    : (finalNode && finalNode.isBye ? (finalNode.player1 || finalNode.player2) : null);

  const totalColumns = data.rounds + 1;
  const headerHtml = Array.from({ length: data.rounds }, (_, i) => i + 1)
    .map((r) => `<div class="bracket-col-header" style="grid-column:${r}">${escapeHtml(bracketRoundLabel(r, data.rounds))}</div>`)
    .join('') + `<div class="bracket-col-header" style="grid-column:${totalColumns}">Winner</div>`;

  const nodesHtml = data.nodes.map(nodeHtml).join('');
  const championHtml = `
    <div class="bracket-node bracket-champion" style="grid-column:${totalColumns};grid-row:2 / span ${data.size}">
      ${championPlayer
    ? `<div class="bracket-champion-name">🏆 ${escapeHtml(championPlayer.name)}</div>`
    : `<span style="color:var(--gray-dim);font-size:12px">TBD</span>`}
    </div>
  `;

  document.getElementById('bracket-root').innerHTML = `
    <div class="bracket-wrap card card-dark">
      <div class="bracket-grid" style="grid-template-columns:repeat(${totalColumns}, minmax(180px, 1fr));grid-template-rows:auto repeat(${data.size}, 36px)">
        ${headerHtml}
        ${nodesHtml}
        ${championHtml}
      </div>
    </div>
  `;
}

async function load() {
  try {
    const data = await api(`/brackets/${bracketId}`);
    render(data);
  } catch (err) {
    document.getElementById('bracket-title').textContent = 'Bracket not found';
    document.getElementById('bracket-root').innerHTML = `<p style="color:var(--danger)">${escapeHtml(err.message)}</p>`;
  }
}

// "Embed this bracket" — same modal/pattern as rankings.js's own
// embed-rankings-btn. Only present on the real page's markup, not
// embed-bracket.html itself (which also loads this same file).
const embedBracketBtn = document.getElementById('embed-bracket-btn');
if (embedBracketBtn) {
  embedBracketBtn.addEventListener('click', () => {
    const src = `${window.location.origin}/embed/bracket/${bracketId}`;
    const code = `<iframe src="${src}" width="100%" height="600" frameborder="0" style="border:0;width:100%"></iframe>`;
    document.getElementById('embed-code').textContent = code;
    document.getElementById('copy-embed-btn').onclick = () => {
      copyToClipboard(code).then(() => toast(t('embed.copied')));
    };
    document.getElementById('embed-modal').style.display = 'flex';
  });
}

load();
