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

// every board drawn, by bracket id (bracket-result.js finds the match behind a button here)
const BRACKET_BOARDS = new Map();
// the view of every board that was switched (the page draws all again with every live change of a score, and the board keeps its view)
const BRACKET_VIEWS = new Map();

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

  return `<div data-node-id="${node.id}" class="bracket-node${connectorClasses.length ? ` ${connectorClasses.join(' ')}` : ''}" style="grid-column:${node.round};grid-row:${node.position * span + 2} / span ${span};--connector-len:${connectorLen}px"><div class="${cardClass}"${clickNav}>${inner}</div></div>`;
}

function bracketBoardHtml(data) {
  BRACKET_BOARDS.set(data.id, data);
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

  // the tree comes first (it is what opens); the switch under it shows the rounds one under the other, like a list of matches
  const view = BRACKET_VIEWS.get(data.id) || 'tree';
  return `
    <div class="bracket-wrap card card-dark" data-bracket-id="${data.id}" data-view="${view}">
      <div class="bk-switch" role="tablist">
        <button type="button" class="bk-switch-btn${view === 'tree' ? ' on' : ''}" data-bk-view="tree">${escapeHtml(t('bracket.viewTree'))}</button>
        <button type="button" class="bk-switch-btn${view === 'rounds' ? ' on' : ''}" data-bk-view="rounds">${escapeHtml(t('bracket.viewRounds'))}</button>
      </div>
      <div class="bk-tree">
        <div class="bracket-grid" style="grid-template-columns:repeat(${totalColumns}, minmax(180px, 1fr));grid-template-rows:auto repeat(${data.size}, ${ROW_HEIGHT}px)">
          ${headerHtml}
          ${nodesHtml}
          ${championHtml}
        </div>
      </div>
      <div class="bk-rounds">${roundsHtml(data, championPlayer)}</div>
    </div>
  `;
}

// ---------- the rounds view (like the draw page of a tennis site): every round is a list of its matches; a round that is not played yet shows, in grey, who can be there ("A or B") ----------

function roundTitle(round, total) {
  if (round === total) return t('bracket.final');
  if (round === total - 1) return t('bracket.semi');
  if (round === total - 2) return t('bracket.quarter');
  return t('bracket.roundN', { n: round });
}

// the players that can still come out of a node: its winner when it is decided, else everybody who can reach it (recursively through the rounds before)
function nodeCandidates(node, feeders) {
  const bySlot = [1, 2].map((slot) => {
    const player = slot === 1 ? node.player1 : node.player2;
    if (player) return [player];
    const feeder = feeders.get(`${node.id}:${slot}`);
    return feeder ? nodeCandidates(feeder, feeders) : [];
  });
  if (node.winnerId) {
    const winner = bySlot.flat().find((p) => p && p.id === node.winnerId);
    if (winner) return [winner];
  }
  if (node.isBye) return bySlot.flat().slice(0, 1);
  return bySlot.flat();
}

// the sets of a match of a node that are shown in the rounds view (the same rule as the lists of matches: a set is shown once it has a score; the running set of a live match too)
function shownSets(node) {
  const m = node.match;
  if (!m || !m.state || !['LIVE', 'FINISHED', 'UNFINISHED'].includes(m.status)) return [];
  const started = (s, i) => s.winner || s.p1 || s.p2 || (s.tiebreak && (s.tiebreak.p1 || s.tiebreak.p2)) || (m.status === 'LIVE' && i === m.state.currentSet);
  return (m.state.sets || []).filter(started);
}

function roundSlotHtml(node, slot, feeders, sets) {
  const player = slot === 1 ? node.player1 : node.player2;
  const seed = slot === 1 ? node.seed1 : node.seed2;
  if (player) {
    const isWinner = node.winnerId && node.winnerId === player.id;
    // with a score: the games of every set to the right (the winner of a set green), like in the lists of matches; without: the check of the winner
    const right = sets.length
      ? `<span class="cs-sc">${sets.map((s) => `<span>${setCell(s, slot, { highlightWinner: true })}</span>`).join('')}</span>`
      : (isWinner ? '<span class="bk-chk">✓</span>' : '');
    return `<div class="bk-p${isWinner ? ' win' : ''}"><span class="bk-name">${seed ? `<span class="bracket-seed">(${seed})</span>` : ''}${playerNameLink(player)}</span>${right}</div>`;
  }
  // round 1 of a consolation draw: who can drop in (the two players of the main match that feeds this slot)
  const loserFrom = slot === 1 ? node.loserFrom1 : node.loserFrom2;
  if (loserFrom && loserFrom.length) {
    const who = loserFrom.map((x) => escapeHtml(x.name)).join(` ${escapeHtml(t('bracket.or'))} `);
    return `<div class="bk-p pending"><span class="bk-name">${escapeHtml(t('bracket.loserOf', { names: '' })).trim()} ${who}</span></div>`;
  }
  const feeder = feeders.get(`${node.id}:${slot}`);
  const names = feeder ? nodeCandidates(feeder, feeders).filter(Boolean) : [];
  if (!names.length) return `<div class="bk-p pending"><span class="bk-name">${node.round === 1 ? '—' : escapeHtml(t('bracket.tbd'))}</span></div>`;
  const shown = names.slice(0, 4).map((p) => escapeHtml(p.name)).join(` ${escapeHtml(t('bracket.or'))} `);
  const more = names.length > 4 ? ` +${names.length - 4}` : '';
  return `<div class="bk-p pending"><span class="bk-name">${shown}${more}</span></div>`;
}

// the head line of a match with a score: the pill (finished / live) and the labels of the sets (S1, S2, MTB) above the columns of the games
function roundHeadHtml(node, sets) {
  if (!sets.length) return '';
  const live = node.match.status === 'LIVE';
  const pill = `<span class="bk-pill${live ? ' live' : ''}">${escapeHtml(t(live ? 'bracket.pillLive' : 'bracket.pillDone'))}</span>`;
  return `<div class="bk-p bk-head">${pill}<span class="cs-sc">${sets.map((s, i) => `<span>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</span>`).join('')}</span></div>`;
}

function roundMetaHtml(node, sets) {
  if (node.isBye) return `<div class="bracket-match-meta">Bye</div>`;
  if (node.isManualResult) return `<div class="bracket-match-meta">${escapeHtml(node.scoreSummary || '')}</div>`;
  if (!node.match || sets.length) return '';
  if (node.match.scheduledAt) return `<div class="bracket-match-meta">${escapeHtml(fmtDateShort(node.match.scheduledAt))}</div>`;
  return `<div class="bracket-match-meta">${escapeHtml(t('bracket.notScheduled'))}</div>`;
}

function roundsHtml(data, championPlayer) {
  const feeders = new Map();
  data.nodes.forEach((n) => { if (n.nextBracketMatchId) feeders.set(`${n.nextBracketMatchId}:${n.nextSlot}`, n); });
  const parts = [];
  for (let r = 1; r <= data.rounds; r += 1) {
    const nodes = data.nodes.filter((n) => n.round === r).sort((a, b) => a.position - b.position).filter((n) => !(r === 1 && n.isBye && !n.player1 && !n.player2));
    if (!nodes.length) continue;
    const cards = nodes.map((node) => {
      const click = node.match ? ` onclick="window.location.href='/match/${node.match.token}'"` : '';
      const sets = shownSets(node);
      return `<div class="bk-m${node.match ? ' link' : ''}"${click}>${roundHeadHtml(node, sets)}${roundSlotHtml(node, 1, feeders, sets)}${roundSlotHtml(node, 2, feeders, sets)}${roundMetaHtml(node, sets)}</div>`;
    }).join('');
    parts.push(`<section class="bk-round"><h4 class="bk-round-h">${escapeHtml(roundTitle(r, data.rounds))} <small>(${nodes.length})</small></h4>${cards}</section>`);
  }
  const champ = championPlayer
    ? `<div class="bk-p win"><span class="bk-name">${courtIcon('trophy')}${escapeHtml(championPlayer.name)}</span></div>`
    : `<div class="bk-p pending"><span class="bk-name">${escapeHtml(t('bracket.tbd'))}</span></div>`;
  parts.push(`<section class="bk-round"><h4 class="bk-round-h">${escapeHtml(t('bracket.winnerLabel'))}</h4><div class="bk-m bk-champ">${champ}</div></section>`);
  return parts.join('');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bk-view]');
  if (!b) return;
  const wrap = b.closest('.bracket-wrap');
  if (!wrap) return;
  wrap.dataset.view = b.dataset.bkView;
  BRACKET_VIEWS.set(Number(wrap.dataset.bracketId), b.dataset.bkView);
  wrap.querySelectorAll('.bk-switch-btn').forEach((x) => x.classList.toggle('on', x === b));
});
