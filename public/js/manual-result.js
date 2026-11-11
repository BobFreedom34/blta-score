// The window "Zadať výsledok manuálne" of a match: the sets, the place and the time, a walkover / retirement or an unfinished match. One window for every page:
// the match page and the pencil of a match in a drawn bracket (bracket-result.js) open the same one. It builds its own markup on first use.
// openManualResult(m, { token, onSaved }) — m: { format, player1: { name }, player2: { name }, location, scheduledAt }; token: the match; onSaved(match) after it was saved.
// Needs common.js (t, api, escapeHtml, toDateValue, toTimeValue, setupTimeInputs).

// Mirrors src/matchEngine.js FORMATS — only the bits needed to build the manual-result-entry form (how many sets, and whether the last one is a
// match tiebreak instead of a normal set).
const FORMAT_META = {
  BO1: { setsToWin: 1, finalSetSuperTiebreak: false },
  BO3: { setsToWin: 2, finalSetSuperTiebreak: false },
  BO3_STB: { setsToWin: 2, finalSetSuperTiebreak: true },
  BO5: { setsToWin: 3, finalSetSuperTiebreak: false },
  BO5_STB: { setsToWin: 3, finalSetSuperTiebreak: true },
  // the consolation draw of a tournament: sets to 4 games, a tie-break at 3-3
  BO3_G4_STB: { setsToWin: 2, finalSetSuperTiebreak: true, setGames: 4, tiebreakAt: 3 },
  // one set to 5 games, a tie-break at 5-5
  BO1_G5_TB: { setsToWin: 1, finalSetSuperTiebreak: false, setGames: 5, tiebreakAt: 5 },
  // Free Play is open-ended in real play — 6 is just a generous cap on how many set rows the manual-result-entry form offers.
  FREE_PLAY: { setsToWin: 6, finalSetSuperTiebreak: false },
};

function manualResultRowsHtml(m) {
  const meta = FORMAT_META[m.format] || { setsToWin: 2, finalSetSuperTiebreak: false };
  const maxSets = meta.setsToWin * 2 - 1;
  const deciderIndex = meta.setsToWin * 2 - 2;
  let rows = '';
  for (let i = 0; i < maxSets; i += 1) {
    const isDeciderTB = i === deciderIndex && meta.finalSetSuperTiebreak;
    rows += `
      <div class="manual-set-row" data-tb-at="${meta.tiebreakAt || 6}">
        <div class="manual-set-label">${isDeciderTB ? t('match.matchTiebreakLabel') : t('match.setLabel', { n: i + 1 })}</div>
        <div class="manual-set-fields">
          <div class="manual-set-field">
            <label>${escapeHtml(m.player1.name)}</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-set-input" data-player="1">
          </div>
          <div class="manual-set-dash">–</div>
          <div class="manual-set-field">
            <label>${escapeHtml(m.player2.name)}</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-set-input" data-player="2">
          </div>
        </div>
        ${isDeciderTB ? '' : `
        <div class="manual-tiebreak-row" style="display:none">
          <div class="manual-tiebreak-field">
            <label>${t('match.tiebreakScoreLabel')} <span style="font-weight:400;color:var(--gray-dim);font-size:11px">${t('common.optional')}</span></label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-tiebreak-input" data-tb-player="1">
          </div>
          <div class="manual-set-dash">–</div>
          <div class="manual-tiebreak-field">
            <label>&nbsp;</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-tiebreak-input" data-tb-player="2">
          </div>
        </div>
        `}
      </div>
    `;
  }
  return rows;
}

// A regular (non-decider) set's own real tiebreak point score — e.g. "7-6(4)" instead of a bare "7-6" — only ever makes sense once its game score actually IS a
// 7-6/6-7 tiebreak set, so the little sub-fields for it (see manualResultRowsHtml) stay hidden the rest of the time instead of cluttering every row with an input
// that's normally irrelevant. Wired once per row here rather than per-keystroke reformatting, since a row's own two game-score inputs are what decide whether its
// sibling tiebreak row applies.
function wireManualTiebreakToggle(row) {
  const tbRow = row.querySelector('.manual-tiebreak-row');
  if (!tbRow) return; // the decider (super-tiebreak) row has no sibling tiebreak fields
  const p1Input = row.querySelector('.manual-set-input[data-player="1"]');
  const p2Input = row.querySelector('.manual-set-input[data-player="2"]');
  const update = () => {
    const p1 = Number(p1Input.value);
    const p2 = Number(p2Input.value);
    const tbAt = Number(row.dataset.tbAt) || 6;
    const isTiebreakSet = (p1 === tbAt + 1 && p2 === tbAt) || (p1 === tbAt && p2 === tbAt + 1);
    tbRow.style.display = isTiebreakSet ? 'flex' : 'none';
    if (!isTiebreakSet) {
      tbRow.querySelectorAll('.manual-tiebreak-input').forEach((inp) => { inp.value = ''; });
    }
  };
  p1Input.addEventListener('input', update);
  p2Input.addEventListener('input', update);
}

// the markup of the window, added to the page the first time it is needed
function ensureManualResultModal() {
  if (document.getElementById('manual-result-modal')) return;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'manual-result-modal';
  back.style.display = 'none';
  back.innerHTML = `
  <div class="modal">
    <button type="button" class="close" data-close="manual-result-modal" aria-label="Close">&times;</button>
    <h3>${escapeHtml(t('match.manualResultTitle'))}</h3>
    <p style="font-size:13px;color:var(--gray)">${escapeHtml(t('match.manualResultDesc'))}</p>
    <form id="manual-result-form">
      <div class="grid-2">
        <div class="field">
          <label for="manual-result-location">${escapeHtml(t('quickSchedule.place'))}</label>
          <input type="text" id="manual-result-location" placeholder="${escapeHtml(t('quickSchedule.placePlaceholder'))}" required>
        </div>
        <div class="field">
          <label for="manual-result-date">${escapeHtml(t('quickSchedule.dateTime'))}</label>
          <div style="display:flex;gap:8px">
            <input type="date" id="manual-result-date" style="flex:1" required>
            <input type="text" inputmode="numeric" class="time-input" placeholder="HH:MM" maxlength="5" autocomplete="off" id="manual-result-time" style="flex:1">
          </div>
        </div>
      </div>
      <div id="manual-result-sets"></div>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:6px">
        <input type="checkbox" id="manual-result-retired-checkbox">
        <span style="font-size:13px;font-weight:600">${escapeHtml(t('match.retiredCheckboxLabel'))}</span>
      </label>
      <div id="manual-result-retired-fields" style="display:none;margin-top:10px">
        <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--gray);font-weight:700;letter-spacing:0.03em">${escapeHtml(t('match.winner'))}</div>
        <div class="server-choice-row" id="manual-result-winner-row">
          <button type="button" class="btn btn-outline btn-block" data-winner="1"></button>
          <button type="button" class="btn btn-outline btn-block" data-winner="2"></button>
        </div>
        <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--gray);font-weight:700;letter-spacing:0.03em;margin-top:12px">${escapeHtml(t('match.reasonLabel'))}</div>
        <div class="server-choice-row" id="manual-result-reason-row">
          <button type="button" class="btn btn-outline btn-block" data-reason="RETIREMENT">${escapeHtml(t('common.endReason.RETIREMENT'))}</button>
          <button type="button" class="btn btn-outline btn-block" data-reason="WALKOVER">${escapeHtml(t('common.endReason.WALKOVER'))}</button>
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px">
        <input type="checkbox" id="manual-result-unfinished-checkbox">
        <span style="font-size:13px;font-weight:600">${escapeHtml(t('match.unfinishedCheckboxLabel'))}</span>
      </label>

      <div id="manual-result-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
      <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">${escapeHtml(t('match.saveResult'))}</button>
    </form>
  </div>`;
  document.body.appendChild(back);
  const close = () => { back.style.display = 'none'; };
  back.querySelector('.close').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  if (typeof setupTimeInputs === 'function') setupTimeInputs();
}

function openManualResult(m, { token, onSaved } = {}) {
  ensureManualResultModal();
  document.getElementById('manual-result-sets').innerHTML = manualResultRowsHtml(m);
  document.querySelectorAll('#manual-result-sets .manual-set-row').forEach(wireManualTiebreakToggle);
  document.getElementById('manual-result-location').value = m.location || '';
  document.getElementById('manual-result-date').value = toDateValue(m.scheduledAt);
  document.getElementById('manual-result-time').value = toTimeValue(m.scheduledAt);
  const errorEl = document.getElementById('manual-result-error');
  errorEl.textContent = '';
  const form = document.getElementById('manual-result-form');

  const retiredCheckbox = document.getElementById('manual-result-retired-checkbox');
  const retiredFields = document.getElementById('manual-result-retired-fields');
  const unfinishedCheckbox = document.getElementById('manual-result-unfinished-checkbox');
  retiredCheckbox.checked = false;
  unfinishedCheckbox.checked = false;
  retiredFields.style.display = 'none';
  // Mutually exclusive — a walkover/retirement claims a winner+reason, while Unfinished explicitly declines to claim anything, so only one can apply.
  retiredCheckbox.onchange = () => {
    retiredFields.style.display = retiredCheckbox.checked ? 'block' : 'none';
    if (retiredCheckbox.checked) unfinishedCheckbox.checked = false;
  };
  unfinishedCheckbox.onchange = () => {
    if (unfinishedCheckbox.checked) {
      retiredCheckbox.checked = false;
      retiredFields.style.display = 'none';
    }
  };

  let winner = null;
  let reason = null;
  const winnerBtns = Array.from(document.querySelectorAll('#manual-result-winner-row button'));
  const reasonBtns = Array.from(document.querySelectorAll('#manual-result-reason-row button'));
  winnerBtns[0].textContent = m.player1.name;
  winnerBtns[0].dataset.winner = '1';
  winnerBtns[1].textContent = m.player2.name;
  winnerBtns[1].dataset.winner = '2';
  winnerBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      winner = Number(btn.dataset.winner);
      winnerBtns.forEach((b) => b.classList.toggle('active', b === btn));
    };
  });
  reasonBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      reason = btn.dataset.reason;
      reasonBtns.forEach((b) => b.classList.toggle('active', b === btn));
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const location = document.getElementById('manual-result-location').value.trim();
    const dateVal = document.getElementById('manual-result-date').value;
    const timeVal = document.getElementById('manual-result-time').value;
    if (!location || !dateVal) {
      errorEl.textContent = t('match.locationDateRequired');
      return;
    }
    const scheduledAt = new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString();

    const rows = Array.from(document.querySelectorAll('.manual-set-row'));
    const sets = [];
    for (const row of rows) {
      const p1raw = row.querySelector('[data-player="1"]').value.trim();
      const p2raw = row.querySelector('[data-player="2"]').value.trim();
      if (p1raw === '' && p2raw === '') break;
      if (p1raw === '' || p2raw === '') {
        errorEl.textContent = t('match.fillBothScores');
        return;
      }
      const set = { p1: Number(p1raw), p2: Number(p2raw) };
      // The real tiebreak score (see manualResultRowsHtml/wireManualTiebreakToggle) only actually exists in the DOM — and is only ever visible — for a 7-6/6-7 set;
      // harmless to look for on every row regardless; only sent along when at least one of the two boxes has something in it, same "fully optional, never
      // fabricated" spirit as the server side.
      const tbRow = row.querySelector('.manual-tiebreak-row');
      if (tbRow) {
        const tb1raw = tbRow.querySelector('[data-tb-player="1"]').value.trim();
        const tb2raw = tbRow.querySelector('[data-tb-player="2"]').value.trim();
        if (tb1raw !== '' || tb2raw !== '') {
          if (tb1raw === '' || tb2raw === '') {
            errorEl.textContent = t('match.fillBothTiebreakScores');
            return;
          }
          set.tbP1 = Number(tb1raw);
          set.tbP2 = Number(tb2raw);
        }
      }
      sets.push(set);
    }

    const body = { sets, location, scheduledAt };
    if (retiredCheckbox.checked) {
      if (!winner || !reason) {
        errorEl.textContent = t('match.pickWhoWonWhy');
        return;
      }
      body.winner = winner;
      body.reason = reason;
    } else if (unfinishedCheckbox.checked) {
      if (sets.length === 0) {
        errorEl.textContent = t('match.enterAtLeastOneSetScore');
        return;
      }
      body.unfinished = true;
    } else if (sets.length === 0) {
      errorEl.textContent = t('match.enterAtLeastOneSetScore');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const finished = await api(`/matches/${token}/manual-result`, { method: 'POST', body });
      document.getElementById('manual-result-modal').style.display = 'none';
      if (onSaved) await onSaved(finished);
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  };
  document.getElementById('manual-result-modal').style.display = 'flex';
}
