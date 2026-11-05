// Entering the result of a bracket match right in the drawn bracket (the "Pavúk" of a season, the bracket page, the Play-off filter of the tables) - for an
// admin or a city admin only (the server asks for the admin too: PATCH /api/brackets/:id/nodes/:nodeId/result, POST /api/matches/:token/manual-result).
// Loaded after bracket-view.js, which draws the boards and keeps each one in BRACKET_BOARDS. Every undecided match with both players seated gets a small
// button "Zapísať výsledok": a match without a real match of its own (a past bracket) asks for the winner and a score; a planned match opens the window
// "Zadať výsledok manuálne" of the match page (manual-result.js: the sets, the place and the time) and finishes the match the usual way (the winner moves on, the ranking points and CourtIQ follow). A decided result
// entered by hand can be edited or cleared the same way.
(function bracketResult() {
  if (typeof BRACKET_BOARDS === 'undefined') return;
  let admin = false;
  let ready = false; // whether the session is known: the buttons are drawn for an admin and for the admin of the club that runs the tournament of the bracket

  // what the button does for a match of the bracket: 'manual' (no match of its own), 'match' (a planned match), or null (nothing to enter)
  function kindOf(node) {
    if (node.isBye || !node.player1 || !node.player2) return null;
    if (node.isManualResult) return 'manual';
    if (!node.match) return 'manual';
    return node.match.status === 'PLANNED' ? 'match' : null;
  }

  function addButtons(wrap) {
    const data = BRACKET_BOARDS.get(Number(wrap.dataset.bracketId));
    if (!data || !(admin || data.canManage)) return;
    data.nodes.forEach((node) => {
      const kind = kindOf(node);
      const card = kind && wrap.querySelector(`.bracket-node[data-node-id="${node.id}"] .bracket-match-card`);
      if (!card || card.querySelector('.bracket-res-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bracket-res-btn';
      // a small orange pencil in the top right corner of the match
      const label = t(node.isManualResult ? 'bracket.editResult' : 'bracket.addResult');
      btn.innerHTML = courtIcon('pencil');
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.addEventListener('click', (e) => { e.stopPropagation(); open(data, node, kind); });
      card.appendChild(btn);
    });
  }

  function scan() {
    if (!ready) return;
    document.querySelectorAll('.bracket-wrap[data-bracket-id]:not([data-res-done])').forEach((wrap) => {
      wrap.setAttribute('data-res-done', '1');
      addButtons(wrap);
    });
  }

  function modal(html) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal"><button type="button" class="close" aria-label="Close">&times;</button>${html}</div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    return { back, close };
  }

  // the board is drawn again from what the server answers; the pages that keep the bracket in their own list are told
  async function refresh(bracketId) {
    const fresh = await api(`/brackets/${bracketId}`);
    document.dispatchEvent(new CustomEvent('bracket:changed', { detail: fresh }));
    const wrap = document.querySelector(`.bracket-wrap[data-bracket-id="${bracketId}"]`);
    if (wrap) wrap.outerHTML = bracketBoardHtml(fresh);
    scan();
  }

  const inputStyle = 'width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';
  const title = (node) => `<h3>${escapeHtml(node.player1.name)} <span style="color:var(--gray-dim);font-weight:500">${escapeHtml(t('match.vsLabel'))}</span> ${escapeHtml(node.player2.name)}</h3>`;

  function openManual(data, node) {
    const edit = node.isManualResult;
    const { back, close } = modal(`
      ${title(node)}
      <form id="br-form">
        <div class="field"><label>${escapeHtml(t('bracket.winner'))}</label>
          ${[node.player1, node.player2].map((p) => `<label style="display:flex;align-items:center;gap:8px;font-weight:600;margin:4px 0"><input type="radio" name="br-winner" value="${p.id}"${node.winnerId === p.id ? ' checked' : ''} style="width:auto;margin:0"> ${escapeHtml(p.name)}</label>`).join('')}
        </div>
        <div class="field"><label>${escapeHtml(t('bracket.score'))}</label><input type="text" id="br-score" maxlength="100" value="${escapeHtml(node.scoreSummary || '')}" style="${inputStyle}"></div>
        <div id="br-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
        <button type="submit" class="btn btn-primary btn-block">${escapeHtml(t('common.save'))}</button>
        ${edit ? `<button type="button" class="btn btn-outline btn-block" id="br-clear" style="margin-top:8px">${escapeHtml(t('bracket.clearResult'))}</button>` : ''}
      </form>`);
    const errorEl = back.querySelector('#br-error');
    back.querySelector('#br-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const picked = back.querySelector('input[name="br-winner"]:checked');
      if (!picked) { errorEl.textContent = t('bracket.pickWinner'); return; }
      try {
        await api(`/brackets/${data.id}/nodes/${node.id}/result`, { method: 'PATCH', body: { winnerId: Number(picked.value), score: back.querySelector('#br-score').value.trim() } });
        close();
        await refresh(data.id);
      } catch (err) { errorEl.textContent = err.message; }
    });
    const clear = back.querySelector('#br-clear');
    if (clear) {
      clear.addEventListener('click', async () => {
        try {
          await api(`/brackets/${data.id}/nodes/${node.id}/result`, { method: 'DELETE' });
          close();
          await refresh(data.id);
        } catch (err) { errorEl.textContent = err.message; }
      });
    }
  }

  function open(data, node, kind) {
    // a planned match: the window "Zadať výsledok manuálne" of the match page (manual-result.js), then the board is drawn again
    if (kind === 'match') {
      openManualResult({ format: data.format, player1: node.player1, player2: node.player2, location: node.match.location, scheduledAt: node.match.scheduledAt }, { token: node.match.token, onSaved: () => refresh(data.id) });
    }
    else openManual(data, node);
  }

  checkAdmin().then((isAdmin) => {
    admin = isAdmin;
    ready = true;
    scan();
    // the boards are drawn when their data has arrived (and again when a tab or a filter is changed)
    let timer = null;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
  });
})();
