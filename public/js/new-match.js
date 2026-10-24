setupFormatOptions('format-options');

loadPlayers();
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');
setupAutocomplete('player1b', 'player1b-suggestions');
setupAutocomplete('player2b', 'player2b-suggestions');
const getBallsPlayer = setupBallsPicker();
const getCourtPlayer = setupCourtPicker();

// Admin only: tag a BLTA-league match with its season and group right away (the group has to be of the match's category).
const seasonField = document.getElementById('season-field');
const groupField = document.getElementById('group-field');
const seasonSelect = document.getElementById('season');
const groupSelect = document.getElementById('group');
const stageField = document.getElementById('stage-field');
const stageSelect = document.getElementById('stage');
let seasonsList = [];
let isAdminCreator = false;

function renderSeasonFields() {
  const isBlta = BLTA_CATEGORIES.includes(document.getElementById('category').value);
  const show = isAdminCreator && isBlta && !(typeof isDoubles === 'function' && isDoubles());
  seasonField.style.display = show ? '' : 'none';
  groupField.style.display = show ? '' : 'none';
  stageField.style.display = show ? '' : 'none';
  if (!show) return;
  const none = `<option value="">${escapeHtml(t('match.noneOption'))}</option>`;
  const keepSeason = seasonSelect.value;
  seasonSelect.innerHTML = none + seasonsList.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  seasonSelect.value = seasonsList.some((s) => String(s.id) === keepSeason) ? keepSeason : '';
  const season = seasonsList.find((s) => String(s.id) === seasonSelect.value);
  const category = document.getElementById('category').value;
  const keepGroup = groupSelect.value;
  const groups = season ? season.groups.filter((g) => g.category === category) : [];
  groupSelect.innerHTML = none + groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  groupSelect.value = groups.some((g) => String(g.id) === keepGroup) ? keepGroup : '';
  groupSelect.disabled = !season;
}

// ELITE, NEXT GEN and NOVICE start greyed out (see new-match.html); only an admin gets them. Until then (and for everyone else) the
// category is a friendly match.
const categorySelect = document.getElementById('category');
let categoryTouched = false;
categorySelect.value = 'FRIENDLY';
categorySelect.addEventListener('change', () => { categoryTouched = true; });
(async () => {
  try {
    isAdminCreator = await checkAdmin();
    if (isAdminCreator) {
      BLTA_CATEGORIES.forEach((c) => { const o = categorySelect.querySelector(`option[value="${c}"]`); if (o) o.disabled = false; });
      if (!categoryTouched) categorySelect.value = 'ELITE'; // the admin's usual default
    } else {
      document.getElementById('category-admin-note').style.display = '';
    }
    if (!isAdminCreator) return;
    seasonsList = await api('/seasons');
    renderSeasonFields();
  } catch { /* the season picker is optional */ }
})();
document.getElementById('category').addEventListener('change', renderSeasonFields);

// Singles / doubles (štvorhra). Doubles is a friendly match of two pairs: the category is fixed, the league fields are hidden, and the
// "who brings the balls / reserves the court" buttons name the pairs.
const form = document.getElementById('new-match-form');
const modeButtons = Array.from(document.querySelectorAll('#mode-switch button'));
const isDoubles = () => form.classList.contains('is-doubles');
const val = (id) => document.getElementById(id).value.trim();

function refreshSideLabels() {
  if (!isDoubles()) return;
  const side = (a, b, key) => [val(a), val(b)].filter(Boolean).join(' / ') || t(key);
  ['balls-choice-row', 'court-choice-row'].forEach((rowId) => {
    const btns = document.querySelectorAll('#' + rowId + ' button');
    btns[0].textContent = side('player1', 'player1b', 'newMatch.team1');
    btns[1].textContent = side('player2', 'player2b', 'newMatch.team2');
  });
}
['player1', 'player1b', 'player2', 'player2b'].forEach((id) => document.getElementById(id).addEventListener('input', refreshSideLabels));

function setMode(mode) {
  const doubles = mode === 'doubles';
  form.classList.toggle('is-doubles', doubles);
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('doubles-note').style.display = doubles ? '' : 'none';
  document.getElementById('player1b').required = doubles;
  document.getElementById('player2b').required = doubles;
  if (doubles) { categorySelect.value = 'FRIENDLY'; categoryTouched = true; }
  categorySelect.disabled = doubles;
  renderSeasonFields();
  if (doubles) refreshSideLabels();
  else document.getElementById('player1').dispatchEvent(new Event('input')); // the pickers show the typed names again
}
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
seasonSelect.addEventListener('change', () => { groupSelect.value = ''; renderSeasonFields(); });

document.getElementById('new-match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const player1Name = document.getElementById('player1').value.trim();
  const player2Name = document.getElementById('player2').value.trim();
  const doubles = isDoubles();
  const player1bName = doubles ? val('player1b') : '';
  const player2bName = doubles ? val('player2b') : '';
  const category = document.getElementById('category').value;
  const location = document.getElementById('location').value.trim();
  const scheduledAtDate = document.getElementById('scheduledAtDate').value;
  const scheduledAtTime = document.getElementById('scheduledAtTime').value;
  const notes = document.getElementById('notes').value.trim();
  const format = document.querySelector('input[name="format"]:checked').value;

  if (doubles) {
    const four = [player1Name, player1bName, player2Name, player2bName];
    if (four.some((n) => !n)) { errorEl.textContent = t('newMatch.errorFourNames'); return; }
    if (new Set(four.map(nameKey)).size !== 4) { errorEl.textContent = t('newMatch.errorFourDifferent'); return; }
  } else {
    if (!player1Name || !player2Name) {
      errorEl.textContent = t('newMatch.errorBothNames');
      return;
    }
    if (nameKey(player1Name) === nameKey(player2Name)) {
      errorEl.textContent = t('newMatch.errorSameName');
      return;
    }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');

  const body = (extra) => ({
    player1Name,
    player2Name,
    ...(doubles ? { doubles: true, player1bName, player2bName } : {}),
    category,
    location,
    scheduledAt: scheduledAtDate ? new Date(`${scheduledAtDate}T${scheduledAtTime || '00:00'}`).toISOString() : null,
    format,
    notes,
    ballsPlayer: getBallsPlayer(),
    courtPlayer: getCourtPlayer(),
    ...(!doubles && isAdminCreator && BLTA_CATEGORIES.includes(category) && seasonSelect.value
      ? { seasonId: Number(seasonSelect.value), groupId: groupSelect.value ? Number(groupSelect.value) : null }
      : {}),
    ...(!doubles && isAdminCreator && BLTA_CATEGORIES.includes(category) && stageSelect.value === 'PLAYOFF' ? { stage: 'PLAYOFF' } : {}),
    ...extra,
  });

  // extra: what the user decided about similar names so far ({ player1Id, confirmNew: { player2: true } }…)
  const send = async (extra) => {
    submitBtn.disabled = true;
    try {
      const match = await api('/matches', { method: 'POST', body: body(extra) });
      window.location.href = siteUrl(`/match/${match.token}`);
    } catch (err) {
      if (err.data && err.data.code === 'SIMILAR_PLAYERS') {
        askWhoIsMeant(err.data.conflicts, extra, send);
      } else {
        errorEl.textContent = err.message;
      }
      submitBtn.disabled = false;
    }
  };

  requirePlayerAuth(() => send({}));
});

// The server found players with a similar name to a typed one. Ask, for each, whether it is one of them or really a
// new player — so a typo never creates a duplicate and a genuinely new opponent can still be added.
function askWhoIsMeant(conflicts, previous, send) {
  const modal = document.getElementById('similar-modal');
  const list = document.getElementById('similar-list');
  const errorEl = document.getElementById('similar-error');
  errorEl.textContent = '';
  list.innerHTML = conflicts.map((c) => `
    <div class="similar-block" data-field="${c.field}">
      <div class="similar-typed">${escapeHtml(t('newMatch.similarPlayer' + c.field.slice('player'.length), { name: c.typed }))}</div>
      ${c.suggestions.map((p) => `<label class="similar-opt"><input type="radio" name="similar-${c.field}" value="${p.id}"><span>${escapeHtml(p.name)}</span></label>`).join('')}
      <label class="similar-opt new"><input type="radio" name="similar-${c.field}" value="new"><span>${escapeHtml(t('newMatch.similarCreateNew', { name: c.typed }))}</span></label>
    </div>`).join('');
  document.getElementById('similar-continue-btn').onclick = () => {
    const extra = { ...previous, confirmNew: { ...(previous.confirmNew || {}) } };
    for (const c of conflicts) {
      const picked = list.querySelector(`input[name="similar-${c.field}"]:checked`);
      if (!picked) { errorEl.textContent = t('newMatch.similarPickError'); return; }
      if (picked.value === 'new') extra.confirmNew[c.field] = true;
      else extra[`${c.field}Id`] = Number(picked.value);
    }
    modal.style.display = 'none';
    send(extra);
  };
  modal.style.display = 'flex';
}
