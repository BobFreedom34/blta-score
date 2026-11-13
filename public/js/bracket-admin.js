(function bracketAdmin() {
// Two homes: the page Backend > Brackets (every bracket of the city, root = #bracket-admin-root) and the tab "Pavúk" of a season (public/js/seasons-admin.js
// calls window.mountBracketAdmin(host, seasonId): only the brackets of that season, and a new bracket is made for it). One of them is shown at a time:
// the ids of the fields are the ones of the document.
let root = document.getElementById('bracket-admin-root');
let scopeSeasonId = null;
let registeredPlayers = null; // the tournament's registered players (editor of a tournament): only they are offered for a slot
let editOnly = false; // the editor of an existing bracket (the draw panel of a tournament): no form to make a new one

let brackets = [];
let seasonsList = [];
const BLTA_CATEGORY_KEYS = ['ELITE', 'NEXT_GEN', 'NOVICE'];
let entryRowCounter = 0;
// Tracks which bracket ids currently have their "Manage slots" panel open,
// so re-rendering the list after a slot assignment can reopen the same
// one instead of collapsing everything back down.
const openManagePanels = new Set();

function formatLabel(key) {
  return t(`format.${key}.label`) || key;
}

const CATEGORY_OPTIONS = [
  ['', tl('Žiadna (samostatný)', 'None (freestanding)')],
  ['ELITE', 'BLTA ELITE'],
  ['NEXT_GEN', 'BLTA NEXT GEN'],
  ['NOVICE', 'BLTA NOVICE'],
  ['FRIENDLY', tl('PRIATEĽSKÝ', 'FRIENDLY')],
  ['VIP_CUP', 'VIP CUP'],
  ['ATA_TENNIS', 'ATA TENNIS'],
  ['OTHER', tl('INÉ', 'OTHER')],
];

// (the editor of a tournament: only the categories the tournament is played in, or no category at all when it has none)
let scopedCategories = null;
function categoryOptionsHtml(selected) {
  const list = scopedCategories ? CATEGORY_OPTIONS.filter(([value]) => (value === '' ? !scopedCategories.length : scopedCategories.includes(value))) : CATEGORY_OPTIONS;
  return list.map(([value, label]) => `<option value="${value}" ${(selected || '') === value ? 'selected' : ''}>${scopedCategories && value === '' ? tl('Bez kategórie', 'No category') : label}</option>`).join('');
}

let scopeSeason = null; // the tournament of the editor (read on its own: the list of seasons has no tournaments of a club)
function seasonOptionsHtml(selectedId) {
  if (editOnly && scopeSeasonId) { const own = scopeSeason; return own ? `<option value="${own.id}" selected>${escapeHtml(own.name)}</option>` : ''; } // (the tournament's own bracket stays with it)
  return `<option value="">${tl('— žiadna —', '— none —')}</option>` + seasonsList.map((x) => `<option value="${x.id}" ${Number(selectedId) === x.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('');
}

// A season only goes with a BLTA category: the season picker is switched off (and cleared) for any other category.
function syncSeasonSelect(categorySelect, seasonSelect) {
  const isBlta = BLTA_CATEGORY_KEYS.includes(categorySelect.value);
  seasonSelect.disabled = !isBlta;
  if (!isBlta) seasonSelect.value = '';
}
function wireRootListeners() {
  if (!root || root._bracketWired) return;
  root._bracketWired = true;
  root.addEventListener('change', (e) => {
    if (e.target.id === 'bracket-category') {
      const seasonSelect = document.getElementById('bracket-season');
      if (seasonSelect && !scopeSeasonId) syncSeasonSelect(e.target, seasonSelect);
    } else if (e.target.classList && e.target.classList.contains('bracket-rename-category')) {
      syncSeasonSelect(e.target, e.target.closest('form').querySelector('.bracket-rename-season'));
    }
  });
}

// ---------- Create form ----------

function entryRowHtml(rowId, seedDefault) {
  return `
    <div class="bracket-entry-row" data-row-id="${rowId}" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <div class="autocomplete" style="flex:1;position:relative">
        <input type="text" id="entry-${rowId}-name" placeholder="${escapeHtml(tl('Meno hráča', 'Player name'))}" autocomplete="off" style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        <div class="autocomplete-list" id="entry-${rowId}-list"></div>
      </div>
      <div class="autocomplete entry-partner" style="flex:1;position:relative;display:none">
        <input type="text" id="entry-${rowId}-partner" placeholder="${escapeHtml(tl('Partner', 'Partner'))}" autocomplete="off" style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        <div class="autocomplete-list" id="entry-${rowId}-partner-list"></div>
      </div>
      <input type="number" id="entry-${rowId}-seed" min="1" value="${seedDefault}" style="width:70px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px" title="${escapeHtml(tl('Nasadenie', 'Seed'))}">
      <button type="button" class="btn btn-sm btn-outline" data-action="remove-entry" title="${escapeHtml(tl('Odstrániť', 'Remove'))}">✕</button>
    </div>
  `;
}

// A doubles draw: every entrant is a pair, so each row asks for a partner too, and the league categories (and so a season) are off.
function isDoublesForm() {
  const box = document.getElementById('bracket-doubles');
  return !!(box && box.checked);
}
function applyDoublesMode() {
  const doubles = isDoublesForm();
  document.querySelectorAll('.bracket-entry-row .entry-partner').forEach((el) => { el.style.display = doubles ? '' : 'none'; });
  const category = document.getElementById('bracket-category');
  if (!category) return;
  Array.from(category.options).forEach((o) => { if (['ELITE', 'NEXT_GEN', 'NOVICE'].includes(o.value)) o.disabled = doubles; });
  if (doubles && ['ELITE', 'NEXT_GEN', 'NOVICE'].includes(category.value)) {
    category.value = '';
    category.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function addEntryRow() {
  entryRowCounter += 1;
  const rowId = entryRowCounter;
  const existingRows = document.querySelectorAll('.bracket-entry-row').length;
  const container = document.getElementById('bracket-entries-list');
  container.insertAdjacentHTML('beforeend', entryRowHtml(rowId, existingRows + 1));
  setupAutocomplete(`entry-${rowId}-name`, `entry-${rowId}-list`);
  setupAutocomplete(`entry-${rowId}-partner`, `entry-${rowId}-partner-list`);
  applyDoublesMode();
  document.querySelector(`.bracket-entry-row[data-row-id="${rowId}"] [data-action="remove-entry"]`)
    .addEventListener('click', () => {
      document.querySelector(`.bracket-entry-row[data-row-id="${rowId}"]`).remove();
    });
}

function createFormHtml() {
  return `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">${tl('Vytvoriť pavúk', 'Create a bracket')}</h3>
      <form id="create-bracket-form">
        <div class="field">
          <label>${tl('Názov', 'Name')}</label>
          <input type="text" id="bracket-name" maxlength="120" placeholder="${escapeHtml(tl('napr. Letná séria 2026 — Elite', 'e.g. Summer Rally Series 2026 — Elite'))}" required style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400">
            <input type="checkbox" id="bracket-doubles" style="width:auto;flex-shrink:0;margin:0">
            ${tl('Štvorhra — každý účastník je pár', 'Doubles draw — every entrant is a pair')}
          </label>
          <p style="font-size:12px;color:var(--gray-dim);margin:2px 0 0">${tl('Zápasy sú štvorhry: počítajú sa do rebríčka štvorhry, nikdy do ligy, CourtIQ ani odznakov. Bez ligovej kategórie.', 'The matches are doubles matches: they count in the doubles ranking, never in the league, CourtIQ or badges. No league category.')}</p>
        </div>
        <div class="field">
          <label>${tl('Formát zápasu', 'Match format')}</label>
          <div id="bracket-format-options"></div>
        </div>
        <div class="field">
          <label for="bracket-category">${tl('Kategória', 'Category')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${tl('(nepovinné — označí zápasy, ktoré pavúk vytvorí)', '(optional — tags the matches this bracket creates)')}</span></label>
          <select id="bracket-category" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
            ${categoryOptionsHtml('')}
          </select>
        </div>
        <div class="field">
          <label for="bracket-season">${tl('Sezóna', 'Season')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${tl('(nepovinné — vyžaduje kategóriu BLTA; zápasy, ktoré vytvorí, dostanú túto sezónu a počítajú sa ako zápasy play-off)', '(optional — needs a BLTA category; the matches it creates get this season and count as play-off matches)')}</span></label>
          <select id="bracket-season" disabled style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
            ${seasonOptionsHtml('')}
          </select>
        </div>
        <div class="field">
          <label>${tl('Ako sa má žrebovanie naplniť?', 'How should the draw be filled?')}</label>
          <div style="display:flex;gap:16px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="seeded" checked> ${tl('Vytvoriť automaticky podľa nasadenia', 'Auto-generate from seeds')}</label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="manual"> ${tl('Ručne (prázdny pavúk)', 'Manual (empty draw)')}</label>
          </div>
        </div>
        <div id="bracket-seeded-section" style="margin-bottom:16px">
          <label style="font-weight:700;display:block;margin-bottom:6px">${tl('Hráči', 'Players')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${tl('(nasadenie 1 = najlepší — voľné miesta (bye) dostanú najlepšie nasadení, ak počet nie je mocnina dvojky)', "(seed 1 = best — byes go to the top seeds if the count isn't a power of two)")}</span></label>
          <div id="bracket-entries-list"></div>
          <button type="button" class="btn btn-sm btn-outline" id="add-entry-row-btn" style="margin-top:4px">${tl('+ Pridať hráča', '+ Add player')}</button>
        </div>
        <div id="bracket-manual-section" class="field" style="display:none">
          <label>${tl('Veľkosť pavúka', 'Draw size')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${tl('(zaokrúhli sa na najbližšiu mocninu dvojky)', '(rounds up to the next power of two)')}</span></label>
          <input type="number" id="bracket-manual-size" min="2" max="256" value="8" style="width:100px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400">
            <input type="checkbox" id="bracket-auto-create-matches" checked style="width:auto;flex-shrink:0;margin:0">
            ${tl('Automaticky vytvoriť zápas pre každú dvojicu', 'Automatically create a match for each pairing')}
          </label>
          <p style="font-size:12px;color:var(--gray-dim);margin:2px 0 0">${tl('Odškrtni pre minulý (historický) pavúk — zápasy sa odohrali mimo aplikácie, takže každý výsledok zadáš priamo namiesto hrania zápasu.', "Uncheck this for a past/historical bracket — the games already happened outside the app, so you'll enter each result directly instead of playing a match through it.")}</p>
        </div>
        <div id="create-bracket-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary" style="margin-top:6px">${tl('Vytvoriť pavúk', 'Create bracket')}</button>
      </form>
    </div>
  `;
}

function resetCreateForm() {
  document.getElementById('bracket-name').value = '';
  document.getElementById('bracket-category').value = '';
  const seasonReset = document.getElementById('bracket-season');
  if (!scopeSeasonId) {
    seasonReset.value = '';
    seasonReset.disabled = true;
  }
  document.getElementById('bracket-entries-list').innerHTML = '';
  document.getElementById('bracket-auto-create-matches').checked = true;
  entryRowCounter = 0;
  document.getElementById('bracket-doubles').checked = false;
  addEntryRow();
  addEntryRow();
  applyDoublesMode();
}

function wireCreateForm() {
  setupFormatOptions('bracket-format-options');
  addEntryRow();
  addEntryRow();
  document.getElementById('add-entry-row-btn').addEventListener('click', addEntryRow);
  document.getElementById('bracket-doubles').addEventListener('change', applyDoublesMode);

  document.querySelectorAll('input[name="bracket-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const seeded = document.querySelector('input[name="bracket-mode"]:checked').value === 'seeded';
      document.getElementById('bracket-seeded-section').style.display = seeded ? '' : 'none';
      document.getElementById('bracket-manual-section').style.display = seeded ? 'none' : '';
    });
  });

  document.getElementById('create-bracket-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('create-bracket-error');
    errorEl.textContent = '';
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const name = document.getElementById('bracket-name').value.trim();
      const format = document.querySelector('input[name="format"]:checked').value;
      const category = document.getElementById('bracket-category').value;
      const seeded = document.querySelector('input[name="bracket-mode"]:checked').value === 'seeded';
      const autoCreateMatches = document.getElementById('bracket-auto-create-matches').checked;
      const doubles = isDoublesForm();
      const body = { name, format, autoCreateMatches };
      if (doubles) body.doubles = true;
      if (category) body.category = category;
      const seasonId = scopeSeasonId || document.getElementById('bracket-season').value;
      if (seasonId) body.seasonId = Number(seasonId);
      if (scopeSeasonId && !category) throw new Error(tl('Vyber kategóriu pavúka', 'Choose the category of the bracket'));

      if (seeded) {
        const rows = Array.from(document.querySelectorAll('.bracket-entry-row'));
        const entries = [];
        for (const row of rows) {
          const rowId = row.dataset.rowId;
          const rawName = document.getElementById(`entry-${rowId}-name`).value.trim();
          if (!rawName) continue;
          const player = findPlayerByTypedName(rawName);
          if (!player) throw new Error(tl(`„${rawName}“ nie je známy hráč — vyber ho z návrhov`, `"${rawName}" isn't a known player — pick one from the suggestions`));
          const seed = Number(document.getElementById(`entry-${rowId}-seed`).value);
          if (!Number.isInteger(seed) || seed < 1) throw new Error(tl(`Daj „${rawName}“ nasadenie — celé číslo`, `Give "${rawName}" a whole-number seed`));
          const entry = { playerId: player.id, seed };
          if (doubles) {
            const rawPartner = document.getElementById(`entry-${rowId}-partner`).value.trim();
            if (!rawPartner) throw new Error(tl(`„${rawName}“ potrebuje partnera`, `"${rawName}" needs a partner`));
            const partner = findPlayerByTypedName(rawPartner);
            if (!partner) throw new Error(tl(`„${rawPartner}“ nie je známy hráč — vyber ho z návrhov`, `"${rawPartner}" isn't a known player — pick one from the suggestions`));
            entry.partnerId = partner.id;
          }
          entries.push(entry);
        }
        if (entries.length < 2) throw new Error(doubles ? tl('Pridaj aspoň 2 páry', 'Add at least 2 pairs') : tl('Pridaj aspoň 2 hráčov', 'Add at least 2 players'));
        body.entries = entries;
      } else {
        const size = Number(document.getElementById('bracket-manual-size').value);
        if (!Number.isInteger(size) || size < 2) throw new Error(tl('Veľkosť pavúka musí byť aspoň 2', 'Draw size must be at least 2'));
        body.size = size;
      }

      await api('/brackets', { method: 'POST', body });
      toast(tl('Pavúk vytvorený', 'Bracket created'));
      resetCreateForm();
      await loadBrackets();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });
}

// ---------- Bracket list + slot management ----------

async function loadBrackets() {
  brackets = await api('/brackets');
  if (scopeSeasonId) brackets = brackets.filter((b) => b.seasonId === scopeSeasonId);
  renderList();
}

// a bracket of a tournament shows the name of the tournament in front of its own name when that is not in it already
function displayName(b) {
  if (b.seasonKind === 'TOURNAMENT' && b.seasonName && !b.name.toLowerCase().includes(b.seasonName.toLowerCase())) return `${b.seasonName} — ${b.name}`;
  return b.name;
}

function bracketRowHtml(b) {
  return `
      <div class="bracket-admin-row" data-id="${b.id}" style="border-bottom:1px solid var(--gray-light);padding:14px 4px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="bracket-name-cell" style="flex:1;min-width:160px">
            <div class="bracket-name-display" style="font-weight:700">${escapeHtml(displayName(b))}${b.category ? ` <span style="font-size:11px;font-weight:700;color:var(--orange);border:1px solid var(--orange);border-radius:999px;padding:1px 8px;vertical-align:middle">${escapeHtml(b.category)}</span>` : ''}${b.seasonName && b.seasonKind !== 'TOURNAMENT' ? ` <span style="font-size:11px;font-weight:700;color:var(--charcoal);border:1px solid var(--gray-dim);border-radius:999px;padding:1px 8px;vertical-align:middle">${escapeHtml(b.seasonName)}</span>` : ''}${b.autoCreateMatches === false ? ` <span style="font-size:11px;font-weight:700;color:var(--gray-dim);border:1px solid var(--gray-dim);border-radius:999px;padding:1px 8px;vertical-align:middle">${tl('Historický', 'Historical')}</span>` : ''}${b.isDoubles ? ` <span style="font-size:11px;font-weight:700;color:var(--orange);border:1px solid var(--orange);border-radius:999px;padding:1px 8px;vertical-align:middle">${tl('Štvorhra', 'Doubles')}</span>` : ''}</div>
            <div style="font-size:12px;color:var(--gray)">${b.size}-${tl('pavúk', 'draw')} · ${escapeHtml(formatLabel(b.format))}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
            <a data-public href="/bracket/${b.id}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">${tl('Zobraziť', 'View')}</a>
            <button type="button" class="btn btn-sm btn-outline" data-action="rename">${tl('Upraviť', 'Edit')}</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="manage">${openManagePanels.has(b.id) ? tl('Skryť miesta', 'Hide slots') : tl('Spravovať miesta', 'Manage slots')}</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete">${tl('Zmazať', 'Delete')}</button>
          </div>
        </div>
        <div class="bracket-manage-slot" data-manage-id="${b.id}"></div>
      </div>
  `;
}

// the list is divided into leagues, tournaments (a heading per tournament) and brackets without a season
function groupedHtml() {
  if (scopeSeasonId) return brackets.map(bracketRowHtml).join('');
  const groups = [
    [tl('Ligy', 'Leagues'), brackets.filter((b) => b.seasonId && b.seasonKind !== 'TOURNAMENT'), (b) => b.seasonName],
    [tl('Turnaje', 'Tournaments'), brackets.filter((b) => b.seasonId && b.seasonKind === 'TOURNAMENT').sort((x, y) => String(x.seasonName).localeCompare(String(y.seasonName)) || x.id - y.id), (b) => b.seasonName],
    [tl('Bez sezóny', 'Without a season'), brackets.filter((b) => !b.seasonId), () => ''],
  ].filter(([, list]) => list.length);
  const head = (text) => `<div style="font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--orange);margin:18px 4px 4px">${escapeHtml(text)}</div>`;
  const sub = (text) => `<div style="font-size:13px;font-weight:800;margin:10px 4px 0">${escapeHtml(text)}</div>`;
  return groups.map(([title, list, subOf]) => {
    let last = null;
    const rows = list.map((b) => {
      const s = subOf(b);
      const heading = s && s !== last ? sub(s) : '';
      last = s;
      return heading + bracketRowHtml(b);
    }).join('');
    return head(title) + rows;
  }).join('');
}

function renderList() {
  const listEl = document.getElementById('bracket-list');
  listEl.innerHTML = brackets.length ? groupedHtml() : `<div class="empty-state">${tl('Zatiaľ žiadne pavúky.', 'No brackets yet.')}</div>`;

  document.querySelectorAll('.bracket-admin-row').forEach((rowEl) => {
    const id = Number(rowEl.dataset.id);

    rowEl.querySelector('[data-action="manage"]').addEventListener('click', async () => {
      const slot = rowEl.querySelector('.bracket-manage-slot');
      if (openManagePanels.has(id)) {
        openManagePanels.delete(id);
        slot.innerHTML = '';
        renderList();
        return;
      }
      openManagePanels.add(id);
      slot.innerHTML = `<p style="color:var(--gray-dim);margin:10px 4px">${tl('Načítavam…', 'Loading…')}</p>`;
      await renderManagePanel(id, slot);
      renderList();
    });

    rowEl.querySelector('[data-action="rename"]').addEventListener('click', () => {
      const b = brackets.find((x) => x.id === id);
      const nameCell = rowEl.querySelector('.bracket-name-cell');
      nameCell.innerHTML = `
        <form class="bracket-rename-form" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="text" class="bracket-rename-input" value="${escapeHtml(b.name)}" maxlength="120" required style="flex:1;min-width:160px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px;font-weight:700">
          <select class="bracket-rename-category" style="padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
            ${categoryOptionsHtml(b.category)}
          </select>
          <select class="bracket-rename-season" ${BLTA_CATEGORY_KEYS.includes(b.category) ? '' : 'disabled'} title="${escapeHtml(tl('Sezóna (vyžaduje kategóriu BLTA)', 'Season (needs a BLTA category)'))}" style="padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
            ${seasonOptionsHtml(b.seasonId)}
          </select>
          <button type="submit" class="btn btn-sm btn-primary">${tl('Uložiť', 'Save')}</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel-rename">${tl('Zrušiť', 'Cancel')}</button>
          <span class="bracket-rename-error" style="color:var(--danger);font-weight:600;font-size:12px;width:100%"></span>
        </form>
      `;
      const form = nameCell.querySelector('.bracket-rename-form');
      const input = form.querySelector('.bracket-rename-input');
      const categorySelect = form.querySelector('.bracket-rename-category');
      const seasonSelect = form.querySelector('.bracket-rename-season');
      input.focus();
      input.select();
      form.querySelector('[data-action="cancel-rename"]').addEventListener('click', renderList);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector('.bracket-rename-error');
        errorEl.textContent = '';
        const name = input.value.trim();
        if (!name) { errorEl.textContent = tl('Názov nemôže byť prázdny', 'Name cannot be empty'); return; }
        try {
          await api(`/brackets/${id}`, { method: 'PATCH', body: { name, category: categorySelect.value, seasonId: seasonSelect.value ? Number(seasonSelect.value) : null } });
          toast(tl('Pavúk upravený', 'Bracket updated'));
          await loadBrackets();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const b = brackets.find((x) => x.id === id);
      if (!confirm(tl(`Zmazať „${b.name}“? Zápasy, ktoré už vytvoril, ostanú ako obyčajné zápasy — odstráni sa len samotná štruktúra pavúka.`, `Delete "${b.name}"? Any matches it already created stay as ordinary matches — only the draw structure itself is removed.`))) return;
      try {
        await api(`/brackets/${id}`, { method: 'DELETE' });
        toast(tl('Pavúk zmazaný', 'Bracket deleted'));
        openManagePanels.delete(id);
        await loadBrackets();
      } catch (err) {
        toast(err.message);
      }
    });

    if (openManagePanels.has(id)) {
      renderManagePanel(id, rowEl.querySelector('.bracket-manage-slot'));
    }
  });
}

function nodeStatusText(node) {
  const p1 = node.player1 ? escapeHtml(node.player1.name) : (node.round === 1 ? '—' : tl('bude určené', 'TBD'));
  const p2 = node.player2 ? escapeHtml(node.player2.name) : (node.round === 1 ? '—' : tl('bude určené', 'TBD'));
  if (node.isBye) {
    const winner = node.player1 || node.player2;
    return `${escapeHtml(winner ? winner.name : '—')} <span style="color:var(--gray-dim)">${tl('(voľný žreb, postupuje automaticky)', '(bye, advances automatically)')}</span>`;
  }
  if (node.match) {
    const scoreText = node.match.scoreSummary ? ` — ${escapeHtml(node.match.scoreSummary)}` : '';
    return `${p1} vs ${p2} <span style="color:var(--gray-dim)">(${escapeHtml(node.match.status)}${scoreText})</span> <a data-public href="/match/${node.match.token}" target="_blank" rel="noopener" style="text-decoration:underline">${tl('Otvoriť zápas', 'Open match')}</a>`;
  }
  if (node.isManualResult) {
    const winnerName = node.winnerId === (node.player1 && node.player1.id) ? p1 : p2;
    const scoreText = node.scoreSummary ? ` — ${escapeHtml(node.scoreSummary)}` : '';
    return `${p1} vs ${p2} <span style="color:var(--green-light)">(${tl('víťaz', 'winner')}: ${winnerName}${scoreText})</span> <button type="button" class="bracket-reset-result-btn" data-node-id="${node.id}" style="background:none;border:none;color:var(--danger);text-decoration:underline;cursor:pointer;font-size:12px;padding:0;margin-left:4px">${tl('Zrušiť výsledok', 'Reset')}</button> <button type="button" class="bracket-edit-result-btn" data-node-id="${node.id}" style="background:none;border:none;color:var(--orange);text-decoration:underline;cursor:pointer;font-size:12px;padding:0;margin-left:4px">${tl('Upraviť', 'Edit')}</button>`;
  }
  return `${p1} vs ${p2}`;
}

let manageIsDoubles = false; // set by renderManagePanel for the bracket being shown

function slotAssignFormHtml(node) {
  // A bye's empty slot is intentional (a phantom seed beyond the entry
  // count, not a real pairing waiting to be filled in) — never offer to
  // assign a player into it.
  if (node.isBye) return '';
  const needP1 = !node.player1;
  const needP2 = !node.player2;
  if (!needP1 && !needP2) return '';
  return `
    <form class="bracket-slot-form" data-node-id="${node.id}" style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
      ${needP1 ? `
        <div class="autocomplete" style="position:relative">
          <input type="text" id="slot-${node.id}-p1" placeholder="${manageIsDoubles ? tl('Pár 1 — hráč', 'Pair 1 — player') : tl('Hráč 1', 'Player 1')}" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p1-list"></div>
        </div>
        ${manageIsDoubles ? `<div class="autocomplete" style="position:relative">
          <input type="text" id="slot-${node.id}-p1b" placeholder="${tl('Pár 1 — partner', 'Pair 1 — partner')}" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p1b-list"></div>
        </div>` : ''}
      ` : ''}
      ${needP2 ? `
        <div class="autocomplete" style="position:relative">
          <input type="text" id="slot-${node.id}-p2" placeholder="${manageIsDoubles ? tl('Pár 2 — hráč', 'Pair 2 — player') : tl('Hráč 2', 'Player 2')}" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p2-list"></div>
        </div>
        ${manageIsDoubles ? `<div class="autocomplete" style="position:relative">
          <input type="text" id="slot-${node.id}-p2b" placeholder="${tl('Pár 2 — partner', 'Pair 2 — partner')}" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p2b-list"></div>
        </div>` : ''}
      ` : ''}
      <button type="submit" class="btn btn-sm btn-primary">${tl('Priradiť', 'Assign')}</button>
      <span class="bracket-slot-error" style="color:var(--danger);font-weight:600;font-size:12px"></span>
    </form>
  `;
}

// Shown instead of (well, alongside — it only ever renders once both
// players are actually seated) a "Open match" link when this node has no
// real match yet — the historical-bracket path (autoCreateMatches off at
// creation, see createFormHtml), or a one-off node on an otherwise live
// bracket that never got a match. Picks the winner via two named buttons
// rather than a select — one click, no submit needed to change a
// selection first. Also reused (isEdit=true) for editing an
// already-recorded result — same fields, pre-filled with the current
// winner/score, injected on demand when the "Edit" button next to a
// decided node is clicked (see wireResultForm/bracket-edit-result-btn
// below) rather than shown inline for every already-decided node.
function recordResultFormHtml(node, isEdit) {
  if (!node.player1 || !node.player2 || node.match || node.isBye) return '';
  if (node.isManualResult && !isEdit) return '';
  return `
    <form class="bracket-result-form" data-node-id="${node.id}" style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--gray-dim)">${tl('Víťaz', 'Winner')}:</span>
      <label style="display:flex;align-items:center;gap:4px;font-weight:400;font-size:13px"><input type="radio" name="winner-${node.id}" value="${node.player1.id}" ${node.winnerId === node.player1.id ? 'checked' : ''} required>${escapeHtml(node.player1.name)}</label>
      <label style="display:flex;align-items:center;gap:4px;font-weight:400;font-size:13px"><input type="radio" name="winner-${node.id}" value="${node.player2.id}" ${node.winnerId === node.player2.id ? 'checked' : ''}>${escapeHtml(node.player2.name)}</label>
      <input type="text" id="result-${node.id}-score" value="${escapeHtml(node.scoreSummary || '')}" placeholder="${escapeHtml(tl('Skóre (nepovinné, napr. 6-2, 6-4)', 'Score (optional, e.g. 6-2, 6-4)'))}" style="width:190px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
      <button type="submit" class="btn btn-sm btn-primary">${isEdit ? tl('Upraviť výsledok', 'Update result') : tl('Zapísať výsledok', 'Record result')}</button>
      ${isEdit ? `<button type="button" class="btn btn-sm btn-outline" data-action="cancel-edit-result">${tl('Zrušiť', 'Cancel')}</button>` : ''}
      <span class="bracket-result-error" style="color:var(--danger);font-weight:600;font-size:12px"></span>
    </form>
  `;
}

// Wires a .bracket-result-form's submit — shared by the always-present
// "record result" form and an "edit result" form injected on demand,
// since both PATCH the exact same endpoint with the exact same body.
function wireResultForm(form, bracketId, nodeId, slotEl) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('.bracket-result-error');
    errorEl.textContent = '';
    const picked = form.querySelector(`input[name="winner-${nodeId}"]:checked`);
    if (!picked) {
      errorEl.textContent = tl('Vyber víťaza', 'Pick a winner');
      return;
    }
    const score = document.getElementById(`result-${nodeId}-score`).value.trim();
    try {
      await api(`/brackets/${bracketId}/nodes/${nodeId}/result`, {
        method: 'PATCH',
        body: { winnerId: Number(picked.value), score: score || undefined },
      });
      toast(tl('Výsledok zapísaný', 'Result recorded'));
      await renderManagePanel(bracketId, slotEl);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

async function renderManagePanel(bracketId, slotEl) {
  const data = await api(`/brackets/${bracketId}`);
  manageIsDoubles = !!data.isDoubles;
  const byRound = new Map();
  data.nodes.forEach((n) => {
    if (!byRound.has(n.round)) byRound.set(n.round, []);
    byRound.get(n.round).push(n);
  });
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  const roundLabel = (r) => bracketRoundLabel(r, data.rounds);

  slotEl.innerHTML = `
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:14px">
      ${rounds.map((r) => `
        <div>
          <div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.03em;color:var(--orange);margin-bottom:4px">${roundLabel(r)}</div>
          ${byRound.get(r).map((n) => `
            <div style="padding:6px 4px;border-bottom:1px solid var(--gray-light);font-size:13px">
              <div>${n.seed1 ? `<span style="color:var(--gray-dim)">(${n.seed1})</span> ` : ''}${nodeStatusText(n)}${n.seed2 ? ` <span style="color:var(--gray-dim)">(${n.seed2})</span>` : ''}</div>
              ${slotAssignFormHtml(n)}
              ${recordResultFormHtml(n)}
              <div class="bracket-edit-result-slot" data-edit-id="${n.id}"></div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;

  data.nodes.forEach((n) => {
    const form = slotEl.querySelector(`.bracket-slot-form[data-node-id="${n.id}"]`);
    if (form) {
      const slotNames = registeredPlayers ? () => registeredPlayers.map((p) => p.name) : undefined; // (the partner of a pair may be anybody)
      if (!n.player1) setupAutocomplete(`slot-${n.id}-p1`, `slot-${n.id}-p1-list`, slotNames);
      if (!n.player2) setupAutocomplete(`slot-${n.id}-p2`, `slot-${n.id}-p2-list`, slotNames);
      if (manageIsDoubles) {
        if (!n.player1) setupAutocomplete(`slot-${n.id}-p1b`, `slot-${n.id}-p1b-list`);
        if (!n.player2) setupAutocomplete(`slot-${n.id}-p2b`, `slot-${n.id}-p2b-list`);
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector('.bracket-slot-error');
        errorEl.textContent = '';
        const resolve = (elId) => {
          const el = document.getElementById(elId);
          if (!el) return undefined; // slot already filled — not part of this form
          const raw = el.value.trim();
          if (!raw) return null;
          const player = findPlayerByTypedName(raw);
          if (!player) throw new Error(tl(`„${raw}“ nie je známy hráč`, `"${raw}" isn't a known player`));
          return player.id;
        };
        try {
          const p1Resolved = resolve(`slot-${n.id}-p1`);
          const p2Resolved = resolve(`slot-${n.id}-p2`);
          const body = {};
          body.player1Id = p1Resolved !== undefined ? p1Resolved : (n.player1 ? n.player1.id : null);
          body.player2Id = p2Resolved !== undefined ? p2Resolved : (n.player2 ? n.player2.id : null);
          if (manageIsDoubles) {
            const p1b = resolve(`slot-${n.id}-p1b`);
            const p2b = resolve(`slot-${n.id}-p2b`);
            if (p1b) body.player1PartnerId = p1b;
            if (p2b) body.player2PartnerId = p2b;
          }
          await api(`/brackets/${bracketId}/slots/${n.id}`, { method: 'PATCH', body });
          toast(tl('Miesto upravené', 'Slot updated'));
          await renderManagePanel(bracketId, slotEl);
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }

    const resultForm = slotEl.querySelector(`.bracket-result-form[data-node-id="${n.id}"]`);
    if (resultForm) wireResultForm(resultForm, bracketId, n.id, slotEl);

    // Reset: takes the result back (the winner leaves the next round); later results that depend on it only after a confirmation
    const resetBtn = slotEl.querySelector(`.bracket-reset-result-btn[data-node-id="${n.id}"]`);
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const url = `/brackets/${bracketId}/nodes/${n.id}/result`;
        try {
          try {
            await api(url, { method: 'DELETE' });
          } catch (err) {
            if (!err.data || err.data.code !== 'HAS_DEPENDENTS') throw err;
            if (!confirm(tl(`${err.data.error}. Zrušiť ich všetky?`, `${err.data.error}. Reset them all?`))) return;
            await api(`${url}?cascade=1`, { method: 'DELETE' });
          }
          toast(tl('Výsledok zrušený', 'Result reset'));
          await loadBrackets();
        } catch (err) {
          toast(err.message);
        }
      });
    }

    const editBtn = slotEl.querySelector(`.bracket-edit-result-btn[data-node-id="${n.id}"]`);
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const editSlot = slotEl.querySelector(`.bracket-edit-result-slot[data-edit-id="${n.id}"]`);
        editSlot.innerHTML = recordResultFormHtml(n, true);
        const editForm = editSlot.querySelector('.bracket-result-form');
        wireResultForm(editForm, bracketId, n.id, slotEl);
        editForm.querySelector('[data-action="cancel-edit-result"]').addEventListener('click', () => { editSlot.innerHTML = ''; });
      });
    }
  });
}

// ---------- Boot ----------

function renderAdmin() {
  if (editOnly) {
    root.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${tl('Pavúk turnaja', 'Bracket of the tournament')}</h3>
      <p class="sa-hint" style="margin:0 0 12px">${tl('Pavúk je už vytvorený. Otvor „Spravovať miesta“ a dosaď hráčov do prvého kola (hráči sú z registrácií), potom zapisuj výsledky. Víťaz postupuje ďalej sám.', 'The bracket is made already. Open "Manage slots" and seat the players in the first round (they come from the registrations), then enter the results. The winner goes on by himself.')}</p>
      <div id="bracket-list">${tl('Načítavam…', 'Loading…')}</div>
    </div>`;
    loadBrackets();
    return;
  }
  root.innerHTML = `
    ${createFormHtml()}
    <div class="card">
      <h3 style="margin-top:0">${tl('Existujúce pavúky', 'Existing brackets')}</h3>
      <div id="bracket-list">${tl('Načítavam…', 'Loading…')}</div>
    </div>
  `;
  wireCreateForm();
  if (scopeSeasonId) scopeCreateForm();
  loadBrackets();
}

// In the tab of a season the bracket is made for that season: no doubles and no season to pick, only the categories of the league, a title that says so
function scopeCreateForm() {
  const hide = (id) => { const el = document.getElementById(id); const field = el && el.closest('.field'); if (field) field.style.display = 'none'; };
  hide('bracket-doubles');
  hide('bracket-season');
  const category = document.getElementById('bracket-category');
  Array.from(category.options).forEach((o) => { if (!BLTA_CATEGORY_KEYS.includes(o.value)) o.remove(); });
  category.required = true;
  category.value = '';
  const label = document.querySelector('label[for="bracket-category"]');
  if (label) label.innerHTML = `${tl('Kategória', 'Category')} <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${tl('(zápasy pavúka ju dostanú spolu s touto sezónou a počítajú sa ako zápasy play-off)', '(the matches of the bracket get it and this season, and count as play-off matches)')}</span>`;
  const title = document.querySelector('#create-bracket-form').closest('.card').querySelector('h3');
  if (title) title.textContent = tl('Vytvoriť play-off pavúk tejto sezóny', 'Create a play-off bracket of this season');
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        ${tl('Na správu pavúkov je potrebné prihlásenie správcu.', 'Managing brackets requires an admin login.')}
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">${tl('Prihlásiť sa ako správca', 'Log in as admin')}</a>.
      </p>
    </div>
  `;
}

// the tab "Pavúk" of a season (the card is shown to an admin only)
window.mountBracketAdmin = async function mountBracketAdmin(host, seasonId, opts) {
  root = host;
  editOnly = !!(opts && opts.editOnly);
  registeredPlayers = null;
  scopedCategories = null;
  scopeSeason = null;
  scopeSeasonId = Number(seasonId) || null;
  brackets = [];
  entryRowCounter = 0;
  openManagePanels.clear();
  wireRootListeners();
  root.innerHTML = `<p style="color:var(--gray-dim);margin:6px 0">${tl('Načítavam…', 'Loading…')}</p>`;
  await loadPlayers();
  try { seasonsList = await api('/seasons'); } catch { seasonsList = []; }
  // the editor of a tournament offers the categories of the tournament and its registered players only
  if (editOnly && scopeSeasonId) {
    try { scopeSeason = await api(`/seasons/${scopeSeasonId}`); } catch { scopeSeason = null; }
    scopedCategories = scopeSeason ? (scopeSeason.categories || []).filter((c) => BLTA_CATEGORY_KEYS.includes(c)) : null;
    try { if (!scopeSeason || scopeSeason.playType !== 'DOUBLES') registeredPlayers = (await api(`/seasons/${scopeSeasonId}/registrations`)).filter((r) => r.playerId).map((r) => ({ id: r.playerId, name: r.name })); } catch { registeredPlayers = null; }
  }
  renderAdmin();
};

if (root) {
  (async () => {
    wireRootListeners();
    const isAdminUser = await checkAdmin();
    if (!isAdminUser) return renderLoggedOut();
    await loadPlayers();
    try { seasonsList = await api('/seasons'); } catch { seasonsList = []; }
    renderAdmin();
  })();
}
})();
