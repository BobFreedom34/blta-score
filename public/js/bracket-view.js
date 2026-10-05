// The drawing of a playoff bracket (the "Pavúk"), shared by the bracket page (bracket.js, also used by the embed) and
// the league tables page (tables.js, "Play-off" filter). bracketBoardHtml(data) takes the bracket as returned by
// GET /api/brackets/:id and returns the HTML of the whole draw; it needs common.js (escapeHtml, playerNameLink,
// fmtDateShort, bracketRoundLabel, courtIcon) and the .bracket-* styles in style.css.

// Pixel height of one "row unit" in the grid (see render()'s
// grid-template-rows) — a round-1 node spans 2 of these, round 2 spans 4,
// and so on (span = 2^round). Sized to comfortably fit a match card's
// real content (measured ~81px at the old 36px/unit, which only gave
// round 1 72px and made its cards visibly collide) rather than the
// tightest round-1 case, so every round gets the same breathing room
// round 2 always had.
const ROW_HEIGHT = 50;

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

  // Connector lines into the next round (see the CSS for the actual
  // drawing) — every node except the final draws one out, bending down
  // (::after, "top" — even position) or up ("bottom" — odd position) to
  // meet its sibling exactly at their shared parent's vertical center;
  // every node except round 1 draws a short incoming stub (::before). The
  // two meet in the middle of the column gap without needing a separate
  // element, because a child's distance to its parent's center is always
  // exactly half its own row-span — see bracketEngine's tree math.
  const span = 2 ** node.round;
  const connectorClasses = [];
  if (node.nextBracketMatchId) connectorClasses.push(node.position % 2 === 0 ? 'bracket-node--top' : 'bracket-node--bottom');
  if (node.round > 1) connectorClasses.push('bracket-node--incoming');
  const connectorLen = (span / 2) * ROW_HEIGHT;

  return `<div class="bracket-node${connectorClasses.length ? ` ${connectorClasses.join(' ')}` : ''}" style="grid-column:${node.round};grid-row:${node.position * span + 2} / span ${span};--connector-len:${connectorLen}px"><div class="${cardClass}"${clickNav}>${inner}</div></div>`;
}

function bracketBoardHtml(data) {
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
    ? `<div class="bracket-champion-name">${courtIcon('trophy')}${escapeHtml(championPlayer.name)}</div>`
    : `<span style="color:var(--gray-dim);font-size:12px">TBD</span>`}
    </div>
  `;

  return `
    <div class="bracket-wrap card card-dark">
      <div class="bracket-grid" style="grid-template-columns:repeat(${totalColumns}, minmax(180px, 1fr));grid-template-rows:auto repeat(${data.size}, ${ROW_HEIGHT}px)">
        ${headerHtml}
        ${nodesHtml}
        ${championHtml}
      </div>
    </div>
  `;
}
