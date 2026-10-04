setupFormatOptions('format-options');

loadPlayers();
setupAutocomplete('player1', 'player1-suggestions');
setupAutocomplete('player2', 'player2-suggestions');
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
  const show = isAdminCreator && isBlta;
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

(async () => {
  try {
    isAdminCreator = await checkAdmin();
    if (!isAdminCreator) return;
    seasonsList = await api('/seasons');
    renderSeasonFields();
  } catch { /* the season picker is optional */ }
})();
document.getElementById('category').addEventListener('change', renderSeasonFields);
seasonSelect.addEventListener('change', () => { groupSelect.value = ''; renderSeasonFields(); });

document.getElementById('new-match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = '';

  const player1Name = document.getElementById('player1').value.trim();
  const player2Name = document.getElementById('player2').value.trim();
  const category = document.getElementById('category').value;
  const location = document.getElementById('location').value.trim();
  const scheduledAtDate = document.getElementById('scheduledAtDate').value;
  const scheduledAtTime = document.getElementById('scheduledAtTime').value;
  const notes = document.getElementById('notes').value.trim();
  const format = document.querySelector('input[name="format"]:checked').value;

  if (!player1Name || !player2Name) {
    errorEl.textContent = t('newMatch.errorBothNames');
    return;
  }
  if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
    errorEl.textContent = t('newMatch.errorSameName');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');

  requirePlayerAuth(async () => {
    submitBtn.disabled = true;
    try {
      const match = await api('/matches', {
        method: 'POST',
        body: {
          player1Name,
          player2Name,
          category,
          location,
          scheduledAt: scheduledAtDate ? new Date(`${scheduledAtDate}T${scheduledAtTime || '00:00'}`).toISOString() : null,
          format,
          notes,
          ballsPlayer: getBallsPlayer(),
          courtPlayer: getCourtPlayer(),
          ...(isAdminCreator && BLTA_CATEGORIES.includes(category) && seasonSelect.value
            ? { seasonId: Number(seasonSelect.value), groupId: groupSelect.value ? Number(groupSelect.value) : null }
            : {}),
          ...(isAdminCreator && BLTA_CATEGORIES.includes(category) && stageSelect.value === 'PLAYOFF' ? { stage: 'PLAYOFF' } : {}),
        },
      });
      window.location.href = `/match/${match.token}`;
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
});
