// Entering the result of a bracket match right in the drawn bracket (the "Pavúk" of a season, the bracket page, the Play-off filter of the tables) - for an
// admin or a city admin only (the server asks for the admin too: PATCH /api/brackets/:id/nodes/:nodeId/result, POST /api/matches/:token/manual-result).
// Loaded after bracket-view.js, which draws the boards and keeps each one in BRACKET_BOARDS. Every undecided match with both players seated gets a small
// button "Zapísať výsledok": a match without a real match of its own (a past bracket) asks for the winner and a score; a planned match asks for the games of
// each set, the place and the day, and finishes the match the usual way (the winner moves on, the ranking points and CourtIQ follow). A decided result
// entered by hand can be edited or cleared the same way.
(function bracketResult() {
  if (typeof BRACKET_BOARDS === 'undefined') return;
  let admin = false;

  const setsOf = (format) => (/^BO5/.test(format) ? 5 : /^BO1/.test(format) ? 1 : 3);
  const hasMatchTiebreak = (format) => /_STB$/.test(format);

  // what the button does for a match of the bracket: 'manual' (no match of its own), 'match' (a planned match), or null (nothing to enter)
  function kindOf(node) {
    if (node.isBye || !node.player1 || !node.player2) return null;
    if (node.isManualResult) return 'manual';
    if (!node.match) return 'manual';
    return node.match.status === 'PLANNED' ? 'match' : null;
  }

  function addButtons(wrap) {
    const data = BRACKET_BOARDS.get(Number(wrap.dataset.bracketId));
    if (!data) return;
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
    if (!admin) return;
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

  function openMatch(data, node) {
    const n = setsOf(data.format);
    const day = (node.match.scheduledAt || new Date().toISOString()).slice(0, 10);
    const rows = Array.from({ length: n }, (_, i) => {
      const last = i === n - 1 && n > 1 && hasMatchTiebreak(data.format);
      return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <span style="width:92px;font-size:13px;font-weight:700">${escapeHtml(last ? t('match.mtbAbbrev') : t('match.setLabel', { n: i + 1 }))}</span>
        <input type="number" min="0" max="99" class="br-p1" style="width:70px;padding:8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px" aria-label="${escapeHtml(node.player1.name)}">
        <span>:</span>
        <input type="number" min="0" max="99" class="br-p2" style="width:70px;padding:8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px" aria-label="${escapeHtml(node.player2.name)}">
      </div>`;
    }).join('');
    const { back, close } = modal(`
      ${title(node)}
      <form id="br-form">
        <p style="font-size:12px;color:var(--gray);margin:-6px 0 10px">${escapeHtml(t('bracket.setsHint'))}</p>
        ${rows}
        <div class="field" style="margin-top:10px"><label>${escapeHtml(t('bracket.place'))}</label><input type="text" id="br-place" maxlength="200" value="${escapeHtml(node.match.location || '')}" style="${inputStyle}"></div>
        <div class="field"><label>${escapeHtml(t('bracket.date'))}</label><input type="date" id="br-date" value="${escapeHtml(day)}" style="${inputStyle}"></div>
        <div id="br-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
        <button type="submit" class="btn btn-primary btn-block">${escapeHtml(t('common.save'))}</button>
      </form>`);
    const errorEl = back.querySelector('#br-error');
    back.querySelector('#br-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = [...back.querySelectorAll('.br-p1')];
      const p2 = [...back.querySelectorAll('.br-p2')];
      const sets = [];
      p1.forEach((el, i) => { if (el.value !== '' && p2[i].value !== '') sets.push({ p1: Number(el.value), p2: Number(p2[i].value) }); });
      const location = back.querySelector('#br-place').value.trim();
      const date = back.querySelector('#br-date').value;
      if (!sets.length) { errorEl.textContent = t('bracket.needSets'); return; }
      if (!location || !date) { errorEl.textContent = t('bracket.needPlaceDate'); return; }
      try {
        await api(`/matches/${node.match.token}/manual-result`, { method: 'POST', body: { sets, location, scheduledAt: new Date(`${date}T12:00:00`).toISOString() } });
        close();
        await refresh(data.id);
      } catch (err) { errorEl.textContent = err.message; }
    });
  }

  function open(data, node, kind) {
    if (kind === 'match') openMatch(data, node);
    else openManual(data, node);
  }

  checkAdmin().then((isAdmin) => {
    admin = isAdmin;
    if (!admin) return;
    scan();
    // the boards are drawn when their data has arrived (and again when a tab or a filter is changed)
    let timer = null;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
  });
})();
