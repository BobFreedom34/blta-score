const root = document.getElementById('bracket-admin-root');

let brackets = [];
let entryRowCounter = 0;
// Tracks which bracket ids currently have their "Manage slots" panel open,
// so re-rendering the list after a slot assignment can reopen the same
// one instead of collapsing everything back down.
const openManagePanels = new Set();

function formatLabel(key) {
  return t(`format.${key}.label`) || key;
}

const CATEGORY_OPTIONS = [
  ['', 'None (freestanding)'],
  ['ELITE', 'BLTA ELITE'],
  ['NEXT_GEN', 'BLTA NEXT GEN'],
  ['NOVICE', 'BLTA NOVICE'],
  ['FRIENDLY', 'FRIENDLY'],
  ['VIP_CUP', 'VIP CUP'],
  ['ATA_TENNIS', 'ATA TENNIS'],
  ['OTHER', 'OTHER'],
];

function categoryOptionsHtml(selected) {
  return CATEGORY_OPTIONS.map(([value, label]) => `<option value="${value}" ${(selected || '') === value ? 'selected' : ''}>${label}</option>`).join('');
}

// ---------- Create form ----------

function entryRowHtml(rowId, seedDefault) {
  return `
    <div class="bracket-entry-row" data-row-id="${rowId}" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <div class="autocomplete" style="flex:1;position:relative">
        <input type="text" id="entry-${rowId}-name" placeholder="Player name" autocomplete="off" style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        <div class="autocomplete-list" id="entry-${rowId}-list"></div>
      </div>
      <input type="number" id="entry-${rowId}-seed" min="1" value="${seedDefault}" style="width:70px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px" title="Seed">
      <button type="button" class="btn btn-sm btn-outline" data-action="remove-entry" title="Remove">✕</button>
    </div>
  `;
}

function addEntryRow() {
  entryRowCounter += 1;
  const rowId = entryRowCounter;
  const existingRows = document.querySelectorAll('.bracket-entry-row').length;
  const container = document.getElementById('bracket-entries-list');
  container.insertAdjacentHTML('beforeend', entryRowHtml(rowId, existingRows + 1));
  setupAutocomplete(`entry-${rowId}-name`, `entry-${rowId}-list`);
  document.querySelector(`.bracket-entry-row[data-row-id="${rowId}"] [data-action="remove-entry"]`)
    .addEventListener('click', () => {
      document.querySelector(`.bracket-entry-row[data-row-id="${rowId}"]`).remove();
    });
}

function createFormHtml() {
  return `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Create a bracket</h3>
      <form id="create-bracket-form">
        <div class="field">
          <label>Name</label>
          <input type="text" id="bracket-name" maxlength="120" placeholder="e.g. Summer Rally Series 2026 — Elite" required style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        </div>
        <div class="field">
          <label>Match format</label>
          <div id="bracket-format-options"></div>
        </div>
        <div class="field">
          <label for="bracket-category">Category <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(optional — tags the matches this bracket creates)</span></label>
          <select id="bracket-category" style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
            ${categoryOptionsHtml('')}
          </select>
        </div>
        <div class="field">
          <label>How should the draw be filled?</label>
          <div style="display:flex;gap:16px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="seeded" checked> Auto-generate from seeds</label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="manual"> Manual (empty draw)</label>
          </div>
        </div>
        <div id="bracket-seeded-section" style="margin-bottom:16px">
          <label style="font-weight:700;display:block;margin-bottom:6px">Players <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(seed 1 = best — byes go to the top seeds if the count isn't a power of two)</span></label>
          <div id="bracket-entries-list"></div>
          <button type="button" class="btn btn-sm btn-outline" id="add-entry-row-btn" style="margin-top:4px">+ Add player</button>
        </div>
        <div id="bracket-manual-section" class="field" style="display:none">
          <label>Draw size <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(rounds up to the next power of two)</span></label>
          <input type="number" id="bracket-manual-size" min="2" max="256" value="8" style="width:100px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400">
            <input type="checkbox" id="bracket-auto-create-matches" checked style="width:auto;flex-shrink:0;margin:0">
            Automatically create a match for each pairing
          </label>
          <p style="font-size:12px;color:var(--gray-dim);margin:2px 0 0">Uncheck this for a past/historical bracket — the games already happened outside the app, so you'll enter each result directly instead of playing a match through it.</p>
        </div>
        <div id="create-bracket-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary" style="margin-top:6px">Create bracket</button>
      </form>
    </div>
  `;
}

function resetCreateForm() {
  document.getElementById('bracket-name').value = '';
  document.getElementById('bracket-category').value = '';
  document.getElementById('bracket-entries-list').innerHTML = '';
  document.getElementById('bracket-auto-create-matches').checked = true;
  entryRowCounter = 0;
  addEntryRow();
  addEntryRow();
}

function wireCreateForm() {
  setupFormatOptions('bracket-format-options');
  addEntryRow();
  addEntryRow();
  document.getElementById('add-entry-row-btn').addEventListener('click', addEntryRow);

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
      const body = { name, format, autoCreateMatches };
      if (category) body.category = category;

      if (seeded) {
        const rows = Array.from(document.querySelectorAll('.bracket-entry-row'));
        const entries = [];
        for (const row of rows) {
          const rowId = row.dataset.rowId;
          const rawName = document.getElementById(`entry-${rowId}-name`).value.trim();
          if (!rawName) continue;
          const player = findPlayerByTypedName(rawName);
          if (!player) throw new Error(`"${rawName}" isn't a known player — pick one from the suggestions`);
          const seed = Number(document.getElementById(`entry-${rowId}-seed`).value);
          if (!Number.isInteger(seed) || seed < 1) throw new Error(`Give "${rawName}" a whole-number seed`);
          entries.push({ playerId: player.id, seed });
        }
        if (entries.length < 2) throw new Error('Add at least 2 players');
        body.entries = entries;
      } else {
        const size = Number(document.getElementById('bracket-manual-size').value);
        if (!Number.isInteger(size) || size < 2) throw new Error('Draw size must be at least 2');
        body.size = size;
      }

      await api('/brackets', { method: 'POST', body });
      toast('Bracket created');
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
  renderList();
}

function renderList() {
  const listEl = document.getElementById('bracket-list');
  listEl.innerHTML = brackets.length
    ? brackets.map((b) => `
      <div class="bracket-admin-row" data-id="${b.id}" style="border-bottom:1px solid var(--gray-light);padding:14px 4px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="bracket-name-cell" style="flex:1;min-width:160px">
            <div class="bracket-name-display" style="font-weight:700">${escapeHtml(b.name)}${b.category ? ` <span style="font-size:11px;font-weight:700;color:var(--orange);border:1px solid var(--orange);border-radius:999px;padding:1px 8px;vertical-align:middle">${escapeHtml(b.category)}</span>` : ''}${b.autoCreateMatches === false ? ' <span style="font-size:11px;font-weight:700;color:var(--gray-dim);border:1px solid var(--gray-dim);border-radius:999px;padding:1px 8px;vertical-align:middle">Historical</span>' : ''}</div>
            <div style="font-size:12px;color:var(--gray)">${b.size}-draw · ${escapeHtml(formatLabel(b.format))}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
            <a href="/bracket/${b.id}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View</a>
            <button type="button" class="btn btn-sm btn-outline" data-action="rename">Edit</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="manage">${openManagePanels.has(b.id) ? 'Hide slots' : 'Manage slots'}</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
          </div>
        </div>
        <div class="bracket-manage-slot" data-manage-id="${b.id}"></div>
      </div>
    `).join('')
    : '<div class="empty-state">No brackets yet.</div>';

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
      slot.innerHTML = '<p style="color:var(--gray-dim);margin:10px 4px">Loading…</p>';
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
          <button type="submit" class="btn btn-sm btn-primary">Save</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel-rename">Cancel</button>
          <span class="bracket-rename-error" style="color:var(--danger);font-weight:600;font-size:12px;width:100%"></span>
        </form>
      `;
      const form = nameCell.querySelector('.bracket-rename-form');
      const input = form.querySelector('.bracket-rename-input');
      const categorySelect = form.querySelector('.bracket-rename-category');
      input.focus();
      input.select();
      form.querySelector('[data-action="cancel-rename"]').addEventListener('click', renderList);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector('.bracket-rename-error');
        errorEl.textContent = '';
        const name = input.value.trim();
        if (!name) { errorEl.textContent = 'Name cannot be empty'; return; }
        try {
          await api(`/brackets/${id}`, { method: 'PATCH', body: { name, category: categorySelect.value } });
          toast('Bracket updated');
          await loadBrackets();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const b = brackets.find((x) => x.id === id);
      if (!confirm(`Delete "${b.name}"? Any matches it already created stay as ordinary matches — only the draw structure itself is removed.`)) return;
      try {
        await api(`/brackets/${id}`, { method: 'DELETE' });
        toast('Bracket deleted');
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
  const p1 = node.player1 ? escapeHtml(node.player1.name) : (node.round === 1 ? '—' : 'TBD');
  const p2 = node.player2 ? escapeHtml(node.player2.name) : (node.round === 1 ? '—' : 'TBD');
  if (node.isBye) {
    const winner = node.player1 || node.player2;
    return `${escapeHtml(winner ? winner.name : '—')} <span style="color:var(--gray-dim)">(bye, advances automatically)</span>`;
  }
  if (node.match) {
    const scoreText = node.match.scoreSummary ? ` — ${escapeHtml(node.match.scoreSummary)}` : '';
    return `${p1} vs ${p2} <span style="color:var(--gray-dim)">(${escapeHtml(node.match.status)}${scoreText})</span> <a href="/match/${node.match.token}" target="_blank" rel="noopener" style="text-decoration:underline">Open match</a>`;
  }
  if (node.isManualResult) {
    const winnerName = node.winnerId === (node.player1 && node.player1.id) ? p1 : p2;
    const scoreText = node.scoreSummary ? ` — ${escapeHtml(node.scoreSummary)}` : '';
    return `${p1} vs ${p2} <span style="color:var(--green-light)">(winner: ${winnerName}${scoreText})</span> <button type="button" class="bracket-edit-result-btn" data-node-id="${node.id}" style="background:none;border:none;color:var(--orange);text-decoration:underline;cursor:pointer;font-size:12px;padding:0;margin-left:4px">Edit</button>`;
  }
  return `${p1} vs ${p2}`;
}

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
          <input type="text" id="slot-${node.id}-p1" placeholder="Player 1" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p1-list"></div>
        </div>
      ` : ''}
      ${needP2 ? `
        <div class="autocomplete" style="position:relative">
          <input type="text" id="slot-${node.id}-p2" placeholder="Player 2" autocomplete="off" style="width:150px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
          <div class="autocomplete-list" id="slot-${node.id}-p2-list"></div>
        </div>
      ` : ''}
      <button type="submit" class="btn btn-sm btn-primary">Assign</button>
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
      <span style="font-size:12px;color:var(--gray-dim)">Winner:</span>
      <label style="display:flex;align-items:center;gap:4px;font-weight:400;font-size:13px"><input type="radio" name="winner-${node.id}" value="${node.player1.id}" ${node.winnerId === node.player1.id ? 'checked' : ''} required>${escapeHtml(node.player1.name)}</label>
      <label style="display:flex;align-items:center;gap:4px;font-weight:400;font-size:13px"><input type="radio" name="winner-${node.id}" value="${node.player2.id}" ${node.winnerId === node.player2.id ? 'checked' : ''}>${escapeHtml(node.player2.name)}</label>
      <input type="text" id="result-${node.id}-score" value="${escapeHtml(node.scoreSummary || '')}" placeholder="Score (optional, e.g. 6-2, 6-4)" style="width:190px;padding:6px 8px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:13px">
      <button type="submit" class="btn btn-sm btn-primary">${isEdit ? 'Update result' : 'Record result'}</button>
      ${isEdit ? '<button type="button" class="btn btn-sm btn-outline" data-action="cancel-edit-result">Cancel</button>' : ''}
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
      errorEl.textContent = 'Pick a winner';
      return;
    }
    const score = document.getElementById(`result-${nodeId}-score`).value.trim();
    try {
      await api(`/brackets/${bracketId}/nodes/${nodeId}/result`, {
        method: 'PATCH',
        body: { winnerId: Number(picked.value), score: score || undefined },
      });
      toast('Result recorded');
      await renderManagePanel(bracketId, slotEl);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

async function renderManagePanel(bracketId, slotEl) {
  const data = await api(`/brackets/${bracketId}`);
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
      if (!n.player1) setupAutocomplete(`slot-${n.id}-p1`, `slot-${n.id}-p1-list`);
      if (!n.player2) setupAutocomplete(`slot-${n.id}-p2`, `slot-${n.id}-p2-list`);
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
          if (!player) throw new Error(`"${raw}" isn't a known player`);
          return player.id;
        };
        try {
          const p1Resolved = resolve(`slot-${n.id}-p1`);
          const p2Resolved = resolve(`slot-${n.id}-p2`);
          const body = {};
          body.player1Id = p1Resolved !== undefined ? p1Resolved : (n.player1 ? n.player1.id : null);
          body.player2Id = p2Resolved !== undefined ? p2Resolved : (n.player2 ? n.player2.id : null);
          await api(`/brackets/${bracketId}/slots/${n.id}`, { method: 'PATCH', body });
          toast('Slot updated');
          await renderManagePanel(bracketId, slotEl);
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }

    const resultForm = slotEl.querySelector(`.bracket-result-form[data-node-id="${n.id}"]`);
    if (resultForm) wireResultForm(resultForm, bracketId, n.id, slotEl);

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
  root.innerHTML = `
    ${createFormHtml()}
    <div class="card">
      <h3 style="margin-top:0">Existing brackets</h3>
      <div id="bracket-list">Loading…</div>
    </div>
  `;
  wireCreateForm();
  loadBrackets();
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing brackets requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  await loadPlayers();
  renderAdmin();
})();
