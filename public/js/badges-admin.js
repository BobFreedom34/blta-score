const root = document.getElementById('badges-admin-root');

// groupLabel matches the player-facing group headings (see BADGE_GROUP_ORDER
// in badges.js / the 'badge.group.*' English strings in i18n.js) — this
// array's own order is what both the dropdown options and the admin badge
// list's grouping use.
const LOGIC_TYPES = [
  { value: 'GAMES_PLAYED', label: 'Games played ≥', groupLabel: 'Matches Played', needsThreshold: true },
  { value: 'WINS', label: 'Wins ≥', groupLabel: 'Wins', needsThreshold: true },
  { value: 'WIN_STREAK', label: 'Win streak ≥', groupLabel: 'Win Streak', needsThreshold: true },
  { value: 'STRAIGHT_SETS', label: 'Straight-set wins (no sets dropped) ≥', groupLabel: 'Straight Sets', needsThreshold: true },
  { value: 'CATEGORY_SWEEP', label: 'Win in Elite, Next Gen and Novice', groupLabel: 'Versatility', needsThreshold: false },
  // Counts individual 6-0 sets won (see countBagelSets in badgeEngine.js/
  // badges.js) — a double-bagel match (6-0, 6-0) counts as 2, not 1 — so a
  // threshold actually distinguishes "won a set 6-0 once" from "made a
  // habit of it", unlike before this needed one.
  { value: 'BAGEL', label: 'Sets won 6–0 ≥', groupLabel: 'Bagel', needsThreshold: true },
  // Counts matches, not sets (see badgeEngine.js/badges.js) — same reason
  // as BAGEL just above needing one.
  { value: 'COMEBACK', label: 'Comeback wins (lost 1st set) ≥', groupLabel: 'Comeback', needsThreshold: true },
  // "threshold" here isn't a count — it's the target day as MMDD (Jan 1
  // -> 101, Dec 25 -> 1225). Earned by playing any match on that calendar
  // day, win or lose. thresholdLabel/thresholdHint override the generic
  // "Threshold" field wording for this one type.
  {
    value: 'CALENDAR_DATE',
    label: 'Play a match on a specific calendar day',
    groupLabel: 'Special Days',
    needsThreshold: true,
    thresholdLabel: 'Date as MMDD',
    thresholdHint: 'e.g. 101 for Jan 1, 704 for Jul 4, 1225 for Dec 25',
  },
];

function needsThreshold(logicType) {
  const type = LOGIC_TYPES.find((t) => t.value === logicType);
  return type ? type.needsThreshold : false;
}

function logicOptionsHtml(selected) {
  return LOGIC_TYPES.map((t) => `<option value="${t.value}" ${t.value === selected ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('');
}

function badgeMedalInner(icon) {
  return icon && icon.startsWith('/badge-icons/')
    ? `<img src="${escapeHtml(icon)}" alt="" style="width:100%;height:100%;border-radius:var(--radius);object-fit:contain">`
    : (icon || '');
}

function badgeFormHtml(prefix, badge) {
  const b = badge || { name: '', description: '', icon: '', logicType: 'GAMES_PLAYED', threshold: '', sortOrder: 0 };
  const isImage = b.icon && b.icon.startsWith('/badge-icons/');
  return `
    <div class="field">
      <label>Name</label>
      <input type="text" id="${prefix}-name" value="${escapeHtml(b.name)}" maxlength="60" required>
    </div>
    <div class="field">
      <label>Description (shown as the badge's tooltip)</label>
      <input type="text" id="${prefix}-description" value="${escapeHtml(b.description)}" maxlength="140" required>
    </div>
    <div class="field">
      <label>Icon emoji (used if no image is uploaded below)</label>
      <input type="text" id="${prefix}-icon" value="${isImage ? '' : escapeHtml(b.icon)}" maxlength="8" style="width:80px">
    </div>
    <div class="field">
      <label>Or upload an icon image (PNG/JPG, under 2MB)</label>
      <input type="file" id="${prefix}-iconFile" accept="image/png,image/jpeg">
      <div id="${prefix}-iconPreview" style="margin-top:8px;width:44px;height:44px">
        ${isImage ? badgeMedalInner(b.icon) : ''}
      </div>
    </div>
    <div class="field">
      <label>Unlock condition</label>
      <select id="${prefix}-logicType">${logicOptionsHtml(b.logicType)}</select>
    </div>
    <div class="field" id="${prefix}-threshold-field">
      <label id="${prefix}-threshold-label">Threshold</label>
      <input type="number" id="${prefix}-threshold" value="${b.threshold != null ? b.threshold : ''}" min="1" step="1">
      <div id="${prefix}-threshold-hint" style="font-size:12px;color:var(--gray);margin-top:4px"></div>
    </div>
    <div class="field">
      <label>Sort order (lower shows first within its unlock-condition group)</label>
      <input type="number" id="${prefix}-sortOrder" value="${b.sortOrder != null ? b.sortOrder : 0}" step="1" style="width:80px">
    </div>
  `;
}

function wireThresholdToggle(prefix) {
  const select = document.getElementById(`${prefix}-logicType`);
  const field = document.getElementById(`${prefix}-threshold-field`);
  const labelEl = document.getElementById(`${prefix}-threshold-label`);
  const hintEl = document.getElementById(`${prefix}-threshold-hint`);
  const update = () => {
    const type = LOGIC_TYPES.find((t) => t.value === select.value);
    field.style.display = (type && type.needsThreshold) ? '' : 'none';
    labelEl.textContent = (type && type.thresholdLabel) || 'Threshold';
    hintEl.textContent = (type && type.thresholdHint) || '';
  };
  select.addEventListener('change', update);
  update();
}

function wireIconPreview(prefix) {
  const fileInput = document.getElementById(`${prefix}-iconFile`);
  const preview = document.getElementById(`${prefix}-iconPreview`);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" style="width:100%;height:100%;border-radius:var(--radius);object-fit:contain">`;
  });
}

// Uploaded separately from the JSON create/edit call since it's a file,
// not JSON — the shared api() helper always JSON-stringifies its body, so
// this bypasses it with a plain fetch instead.
async function uploadIconIfSelected(prefix, badgeId) {
  const file = document.getElementById(`${prefix}-iconFile`).files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('icon', file);
  const res = await fetch(`/api/badges/${badgeId}/icon`, { method: 'POST', body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not upload the image');
  }
}

function readBadgeForm(prefix) {
  const logicType = document.getElementById(`${prefix}-logicType`).value;
  return {
    name: document.getElementById(`${prefix}-name`).value.trim(),
    description: document.getElementById(`${prefix}-description`).value.trim(),
    icon: document.getElementById(`${prefix}-icon`).value.trim(),
    logicType,
    threshold: needsThreshold(logicType) ? Number(document.getElementById(`${prefix}-threshold`).value) : null,
    sortOrder: Number(document.getElementById(`${prefix}-sortOrder`).value) || 0,
  };
}

// MMDD -> "Jan 1" for the admin list's readout. Bad/missing values just
// fall back to showing the raw number.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthDayLabel(mmdd) {
  const month = Math.floor(mmdd / 100);
  const day = mmdd % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return String(mmdd);
  return `${MONTH_ABBR[month - 1]} ${day}`;
}

function badgeRowHtml(badge) {
  const type = LOGIC_TYPES.find((t) => t.value === badge.logicType);
  // Same "no threshold set yet means 1" fallback as the engine itself
  // (computeEarnedBadgeIds/computeEarnedBadges) — matters for BAGEL badges
  // saved before it gained a threshold field, which still have a bare
  // null in the database until someone opens and re-saves them.
  let conditionText;
  if (!type) {
    conditionText = badge.logicType;
  } else if (badge.logicType === 'CALENDAR_DATE') {
    conditionText = `Play on ${badge.threshold != null ? monthDayLabel(badge.threshold) : '—'}`;
  } else if (type.needsThreshold) {
    conditionText = `${type.label} ${badge.threshold != null ? badge.threshold : 1}`;
  } else {
    conditionText = type.label;
  }
  return `
    <div class="badge-row" data-id="${badge.id}" style="border-bottom:1px solid var(--gray-light);padding:14px 4px">
      <div class="badge-row-view" style="display:flex;align-items:center;gap:12px">
        <div class="badge-medal" style="width:44px;height:44px;font-size:20px;margin:0">${badgeMedalInner(badge.icon)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${escapeHtml(badge.name)}</div>
          <div style="font-size:12px;color:var(--gray)">${escapeHtml(badge.description)} — ${escapeHtml(conditionText)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  `;
}

let badges = [];

async function loadBadges() {
  badges = await api('/badges');
  renderList();
}

// GET /badges already comes back ordered by sort_order (then id), so
// filtering into each group here preserves that as the intra-group order —
// grouping just re-partitions the flat list by unlock condition, in
// LOGIC_TYPES' own order, same as the player-facing "all badges" modal.
// A condition with no badges yet contributes no heading.
function badgeGroupsHtml(badgeList) {
  const parts = [];
  LOGIC_TYPES.forEach((type) => {
    const group = badgeList.filter((b) => b.logicType === type.value);
    if (!group.length) return;
    parts.push(`<div class="badge-group-heading">${escapeHtml(type.groupLabel)}</div>`);
    parts.push(...group.map(badgeRowHtml));
  });
  return parts.join('');
}

function renderList() {
  const listEl = document.getElementById('badges-list');
  listEl.innerHTML = badges.length
    ? badgeGroupsHtml(badges)
    : '<div class="empty-state">No badges yet.</div>';
  attachRowHandlers();
}

function attachRowHandlers() {
  document.querySelectorAll('.badge-row').forEach((rowEl) => {
    const id = Number(rowEl.dataset.id);
    const badge = badges.find((b) => b.id === id);

    rowEl.querySelector('[data-action="edit"]').addEventListener('click', () => {
      rowEl.innerHTML = `
        <form class="edit-badge-form">
          ${badgeFormHtml('edit-' + id, badge)}
          <div id="edit-${id}-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn btn-sm btn-primary">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="cancel">Cancel</button>
          </div>
        </form>
      `;
      wireThresholdToggle('edit-' + id);
      wireIconPreview('edit-' + id);
      rowEl.querySelector('[data-action="cancel"]').addEventListener('click', renderList);
      rowEl.querySelector('.edit-badge-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById(`edit-${id}-error`);
        errorEl.textContent = '';
        try {
          await api(`/badges/${id}`, { method: 'PATCH', body: readBadgeForm('edit-' + id) });
          await uploadIconIfSelected('edit-' + id, id);
          toast('Badge saved');
          await loadBadges();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete the "${badge.name}" badge? Players who earned it will just stop seeing it.`)) return;
      try {
        await api(`/badges/${id}`, { method: 'DELETE' });
        toast('Badge deleted');
        await loadBadges();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a badge</h3>
      <form id="add-badge-form">
        ${badgeFormHtml('add')}
        <div id="add-badge-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary">+ Add badge</button>
      </form>
    </div>
    <div class="card">
      <div id="badges-list">Loading…</div>
    </div>
  `;
  wireThresholdToggle('add');
  wireIconPreview('add');
  document.getElementById('add-badge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-badge-error');
    errorEl.textContent = '';
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const created = await api('/badges', { method: 'POST', body: readBadgeForm('add') });
      await uploadIconIfSelected('add', created.id);
      toast('Badge added');
      e.target.reset();
      wireThresholdToggle('add');
      wireIconPreview('add');
      await loadBadges();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });
  loadBadges();
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing badges requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (isAdminUser) renderAdmin();
  else renderLoggedOut();
})();
