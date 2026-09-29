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
          <label>How should the draw be filled?</label>
          <div style="display:flex;gap:16px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="seeded" checked> Auto-generate from seeds</label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="radio" name="bracket-mode" value="manual"> Manual (empty draw)</label>
          </div>
        </div>
        <div id="bracket-seeded-section">
          <label style="font-weight:700;display:block;margin-bottom:6px">Players <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(seed 1 = best — byes go to the top seeds if the count isn't a power of two)</span></label>
          <div id="bracket-entries-list"></div>
          <button type="button" class="btn btn-sm btn-outline" id="add-entry-row-btn" style="margin-top:4px">+ Add player</button>
        </div>
        <div id="bracket-manual-section" class="field" style="display:none">
          <label>Draw size <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(rounds up to the next power of two)</span></label>
          <input type="number" id="bracket-manual-size" min="2" max="256" value="8" style="width:100px;padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px">
        </div>
        <div id="create-bracket-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary" style="margin-top:6px">Create bracket</button>
      </form>
    </div>
  `;
}

function resetCreateForm() {
  document.getElementById('bracket-name').value = '';
  document.getElementById('bracket-entries-list').innerHTML = '';
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
      const seeded = document.querySelector('input[name="bracket-mode"]:checked').value === 'seeded';
      const body = { name, format };

      if (seeded) {
        const rows = Array.from(document.querySelectorAll('.bracket-entry-row'));
        const entries = [];
        for (const row of rows) {
          const rowId = row.dataset.rowId;
          const rawName = document.getElementById(`entry-${rowId}-name`).value.trim();
          if (!rawName) continue;
          const player = allPlayers.find((p) => p.name.toLowerCase() === rawName.toLowerCase());
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
          <div style="flex:1;min-width:160px">
            <div style="font-weight:700">${escapeHtml(b.name)}</div>
            <div style="font-size:12px;color:var(--gray)">${b.size}-draw · ${escapeHtml(formatLabel(b.format))}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
            <a href="/bracket/${b.id}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View</a>
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
  return `${p1} vs ${p2}`;
}

function slotAssignFormHtml(node) {
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
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;

  data.nodes.forEach((n) => {
    const form = slotEl.querySelector(`.bracket-slot-form[data-node-id="${n.id}"]`);
    if (!form) return;
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
        const player = allPlayers.find((p) => p.name.toLowerCase() === raw.toLowerCase());
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
