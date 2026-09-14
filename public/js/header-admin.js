const root = document.getElementById('header-admin-root');

let items = [];
// Flat id -> item lookup covering both top-level items and their nested
// children — GET /header-items already comes back as a tree (each
// top-level item carries its own `children` array), this just flattens
// that once per load so edit/delete/add-sub handlers can find any row by
// its id without walking the tree again.
let itemsById = new Map();

function indexItems() {
  itemsById = new Map();
  items.forEach((item) => {
    itemsById.set(item.id, item);
    (item.children || []).forEach((child) => itemsById.set(child.id, child));
  });
}

function headerItemFormHtml(prefix, item) {
  const it = item || { labelSk: '', labelEn: '', link: '', sortOrder: 0 };
  return `
    <div class="field">
      <label>Label (Slovak)</label>
      <input type="text" id="${prefix}-labelSk" value="${escapeHtml(it.labelSk)}" maxlength="60" required>
    </div>
    <div class="field">
      <label>Label (English) <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(optional — falls back to the Slovak label)</span></label>
      <input type="text" id="${prefix}-labelEn" value="${escapeHtml(it.labelEn || '')}" maxlength="60">
    </div>
    <div class="field">
      <label>Link</label>
      <input type="text" id="${prefix}-link" value="${escapeHtml(it.link)}" maxlength="500" placeholder="/players or https://blta.sk/news" required>
    </div>
    <div class="field">
      <label>Sort order (lower shows first)</label>
      <input type="number" id="${prefix}-sortOrder" value="${it.sortOrder != null ? it.sortOrder : 0}" step="1" style="width:80px">
    </div>
  `;
}

function readHeaderItemForm(prefix) {
  return {
    labelSk: document.getElementById(`${prefix}-labelSk`).value.trim(),
    labelEn: document.getElementById(`${prefix}-labelEn`).value.trim(),
    link: document.getElementById(`${prefix}-link`).value.trim(),
    sortOrder: Number(document.getElementById(`${prefix}-sortOrder`).value) || 0,
  };
}

function headerItemRowHtml(item, isSub) {
  const label = item.labelEn ? `${item.labelSk} / ${item.labelEn}` : item.labelSk;
  return `
    <div class="header-item-row" data-id="${item.id}" style="border-bottom:1px solid var(--gray-light);padding:${isSub ? '10px 4px 10px 24px' : '14px 4px'}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div style="font-weight:700">${isSub ? '↳ ' : ''}${escapeHtml(label)}</div>
          <div style="font-size:12px;color:var(--gray)">${escapeHtml(item.link)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
          ${!isSub ? '<button type="button" class="btn btn-sm btn-outline" data-action="add-sub">+ Sub-item</button>' : ''}
          <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  `;
}

// A top-level item's own row, its children's rows right beneath (indented),
// and an empty slot where the "+ Sub-item" button injects an add form —
// kept as a separate sibling rather than nested inside the row itself so
// opening it doesn't disturb the row's own edit/delete buttons.
function itemBlockHtml(item) {
  const childRows = (item.children || []).map((c) => headerItemRowHtml(c, true)).join('');
  return `
    <div class="header-item-block" data-item-id="${item.id}">
      ${headerItemRowHtml(item, false)}
      <div class="header-item-children">${childRows}</div>
      <div class="header-item-add-sub-slot" data-parent-id="${item.id}"></div>
    </div>
  `;
}

async function loadItems() {
  items = await api('/header-items');
  indexItems();
  renderList();
}

function renderList() {
  const listEl = document.getElementById('header-items-list');
  listEl.innerHTML = items.length
    ? items.map(itemBlockHtml).join('')
    : '<div class="empty-state">No header items yet.</div>';
  attachHandlers();
}

function attachHandlers() {
  document.querySelectorAll('.header-item-row').forEach((rowEl) => {
    const id = Number(rowEl.dataset.id);
    const item = itemsById.get(id);

    rowEl.querySelector('[data-action="edit"]').addEventListener('click', () => {
      rowEl.innerHTML = `
        <form class="edit-header-item-form">
          ${headerItemFormHtml('edit-' + id, item)}
          <div id="edit-${id}-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn btn-sm btn-primary">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="cancel">Cancel</button>
          </div>
        </form>
      `;
      rowEl.querySelector('[data-action="cancel"]').addEventListener('click', renderList);
      rowEl.querySelector('.edit-header-item-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById(`edit-${id}-error`);
        errorEl.textContent = '';
        try {
          const body = readHeaderItemForm('edit-' + id);
          body.parentId = item.parentId || null;
          await api(`/header-items/${id}`, { method: 'PATCH', body });
          toast('Header item saved');
          await loadItems();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const childCount = (item.children || []).length;
      const msg = childCount
        ? `Delete "${item.labelSk}" and its ${childCount} sub-item(s)?`
        : `Delete "${item.labelSk}"?`;
      if (!confirm(msg)) return;
      try {
        await api(`/header-items/${id}`, { method: 'DELETE' });
        toast('Header item deleted');
        await loadItems();
      } catch (err) {
        toast(err.message);
      }
    });

    const addSubBtn = rowEl.querySelector('[data-action="add-sub"]');
    if (addSubBtn) {
      addSubBtn.addEventListener('click', () => {
        const slot = document.querySelector(`.header-item-add-sub-slot[data-parent-id="${id}"]`);
        slot.innerHTML = `
          <form class="add-sub-header-item-form" style="padding:10px 4px 14px 24px;border-bottom:1px solid var(--gray-light)">
            ${headerItemFormHtml('add-sub-' + id)}
            <div id="add-sub-${id}-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
            <div style="display:flex;gap:8px">
              <button type="submit" class="btn btn-sm btn-primary">+ Add sub-item</button>
              <button type="button" class="btn btn-sm btn-outline" data-action="cancel">Cancel</button>
            </div>
          </form>
        `;
        slot.querySelector('[data-action="cancel"]').addEventListener('click', () => { slot.innerHTML = ''; });
        slot.querySelector('.add-sub-header-item-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const errorEl = document.getElementById(`add-sub-${id}-error`);
          errorEl.textContent = '';
          try {
            const body = readHeaderItemForm('add-sub-' + id);
            body.parentId = id;
            await api('/header-items', { method: 'POST', body });
            toast('Sub-item added');
            await loadItems();
          } catch (err) {
            errorEl.textContent = err.message;
          }
        });
      });
    }
  });
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a header item</h3>
      <form id="add-header-item-form">
        ${headerItemFormHtml('add')}
        <div id="add-header-item-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary">+ Add item</button>
      </form>
    </div>
    <div class="card">
      <div id="header-items-list">Loading…</div>
    </div>
  `;
  document.getElementById('add-header-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-header-item-error');
    errorEl.textContent = '';
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const body = readHeaderItemForm('add');
      body.parentId = null;
      await api('/header-items', { method: 'POST', body });
      toast('Header item added');
      e.target.reset();
      await loadItems();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });
  loadItems();
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing the header requires an admin login.
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
