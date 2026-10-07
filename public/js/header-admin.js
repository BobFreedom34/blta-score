const root = document.getElementById('header-admin-root');

let items = [];
// Flat id -> item lookup covering every level — GET /header-items already comes back as a tree (each item carries its own
// `children` array, up to three levels deep), this flattens it once per load so edit/delete/add-sub handlers can find any
// row by its id without walking the tree again, and notes each item's `depth` (1 = main item, 2 = sub-item, 3 = sub-sub-item).
const MAX_DEPTH = 3;
let itemsById = new Map();

function indexItems() {
  itemsById = new Map();
  const walk = (list, depth) => list.forEach((item) => {
    item.depth = depth;
    itemsById.set(item.id, item);
    walk(item.children || [], depth + 1);
  });
  walk(items, 1);
}

// how many levels an item and everything under it take (1 = no sub-items)
function heightOf(item) {
  return 1 + (item.children || []).reduce((max, c) => Math.max(max, heightOf(c)), 0);
}

function isInside(item, id) {
  return (item.children || []).some((c) => c.id === id || isInside(c, id));
}

function descendantCount(item) {
  return (item.children || []).reduce((n, c) => n + 1 + descendantCount(c), 0);
}

// The menu items that can be moved under `parent` with their own sub-items: not the My profile row, not the parent itself or
// one of its ancestors/descendants-to-be, not already directly under it, and only where the whole branch still fits in three
// levels. Labelled with where they are now ("Sezóny" or "Liga › Zápasy").
function movableInto(parent) {
  const out = [];
  const walk = (list, path) => list.forEach((i) => {
    const here = [...path, i.labelSk];
    const loops = i.id === parent.id || isInside(i, parent.id);
    if (!i.isMyProfile && !loops && i.parentId !== parent.id && parent.depth + heightOf(i) <= MAX_DEPTH) out.push({ id: i.id, label: here.join(' › ') });
    walk(i.children || [], here);
  });
  walk(items, []);
  return out;
}

// The pages of the site an item can point to — picked from a list instead of typing the label and the address.
const SITE_PAGES = [
  { sk: 'Domov', en: 'Home', link: '/' },
  { sk: 'Zápasy', en: 'Matches', link: '/matches' },
  { sk: 'Hráči', en: 'Players', link: '/players' },
  { sk: 'Rebríček', en: 'Rankings', link: '/rankings' },
  { sk: 'Tabuľky', en: 'Tables', link: '/tables' },
  { sk: 'Kurty', en: 'Courts', link: '/courts' },
  { sk: 'Harmonogram', en: 'Schedule', link: '/harmonogram' },
  { sk: 'Víťazi', en: 'Winners', link: '/vitazi' },
  { sk: 'Propozície', en: 'Rules', link: '/propozicie' },
  { sk: 'Hľadám súpera', en: 'Looking to play', link: '/looking-to-play' },
  { sk: '+ Nový zápas', en: '+ New match', link: '/new-match' },
];
let seasonPages = []; // the seasons' own pages, loaded once

function pageChoices() {
  return [
    { group: 'Pages', list: SITE_PAGES },
    { group: 'Seasons', list: seasonPages },
  ].filter((g) => g.list.length);
}

function pickerOptionsHtml() {
  const inMenu = new Set([...itemsById.values()].map((i) => i.link));
  return '<option value="">— choose a page —</option>' + pageChoices().map((g) => `
    <optgroup label="${g.group}">${g.list.map((p) => `<option value="${escapeHtml(p.link)}">${escapeHtml(p.sk)}${inMenu.has(p.link) ? ' (already in the menu)' : ''}</option>`).join('')}</optgroup>`).join('');
}

function pickerHtml(prefix) {
  return `
    <div class="field">
      <label>Pick an existing page <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(fills in the labels and the link below)</span></label>
      <select class="hi-pick" data-prefix="${prefix}">${pickerOptionsHtml()}</select>
    </div>`;
}

// "Show under": where the item sits — at the top of the menu, or under any item that leaves room for it. The menu has three
// levels (item, sub-item, sub-sub-item), so an item that has sub-items of its own can only go where its whole branch still
// fits, and never under itself or one of its own sub-items.
function parentFieldHtml(prefix, item) {
  const choices = [];
  const walk = (list, path) => list.forEach((i) => {
    const here = [...path, i.labelSk];
    const fits = i.depth + (item ? heightOf(item) : 1) <= MAX_DEPTH;
    const inside = item && (i.id === item.id || isInside(item, i.id));
    if (!i.isMyProfile && fits && !inside) choices.push({ id: i.id, label: here.join(' › ') });
    walk(i.children || [], here);
  });
  walk(items, []);
  return `
    <div class="field">
      <label>Show under</label>
      <select id="${prefix}-parentId">
        <option value="">— main item (top of the menu) —</option>
        ${choices.map((c) => `<option value="${c.id}"${item && item.parentId === c.id ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
      <div style="font-size:12px;color:var(--gray-dim);margin-top:4px">Up to three levels: item › sub-item › sub-sub-item.</div>
    </div>`;
}

function headerItemFormHtml(prefix, item, opts) {
  const it = item || { labelSk: '', labelEn: '', link: '', sortOrder: 0 };
  return `
    ${pickerHtml(prefix)}
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
    ${opts && opts.withParent ? parentFieldHtml(prefix, item) : ''}
    <div class="field">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="${prefix}-highlight"${it.highlight ? ' checked' : ''}> Show as a green button</label>
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
    highlight: document.getElementById(`${prefix}-highlight`).checked,
  };
}

// "My profile" is a fixed nav entry the site itself drives (see
// .nav-my-profile-link/updatePlayerNavLinks in common.js) — its label and
// link aren't real settings here (routes/headerItems.js ignores them on
// PATCH), only where it sits among the other items is, so its row only
// ever offers an "Edit position" action, never Delete or + Sub-item.
function headerItemRowHtml(item) {
  const depth = item.depth || 1;
  const isSub = depth > 1;
  if (item.isMyProfile) {
    return `
      <div class="header-item-row" data-id="${item.id}" style="border-bottom:1px solid var(--gray-light);padding:14px 4px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <div style="font-weight:700">Môj profil / My profile</div>
            <div style="font-size:12px;color:var(--gray)">Fixed nav item tied to player login — only its position here is editable.</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit position</button>
          </div>
        </div>
      </div>
    `;
  }
  const label = item.labelEn ? `${item.labelSk} / ${item.labelEn}` : item.labelSk;
  return `
    <div class="header-item-row" data-id="${item.id}" style="border-bottom:1px solid var(--gray-light);padding:${isSub ? `10px 4px 10px ${24 * (depth - 1)}px` : '14px 4px'}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div style="font-weight:700">${isSub ? '↳ ' : ''}${escapeHtml(label)}${item.highlight ? ' <span style="font-size:11px;font-weight:800;background:var(--green);color:#0a0a0a;border-radius:6px;padding:1px 7px;margin-left:6px">GREEN</span>' : ''}</div>
          <div style="font-size:12px;color:var(--gray)">${escapeHtml(item.link)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
          ${depth < MAX_DEPTH ? '<button type="button" class="btn btn-sm btn-outline" data-action="add-sub">+ Sub-item</button>' : ''}
          <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  `;
}

// An item's own row, its sub-items right beneath (each one the same again, indented one step further), and an empty slot
// where the "+ Sub-item" button injects an add form — kept as a separate sibling rather than nested inside the row itself
// so opening it doesn't disturb the row's own edit/delete buttons. My profile never has children or a + Sub-item slot, so
// it's just its own row.
function itemBlockHtml(item) {
  const cls = (item.depth || 1) === 1 ? 'header-item-block' : 'header-item-node';
  if (item.isMyProfile) {
    return `<div class="${cls}" data-item-id="${item.id}">${headerItemRowHtml(item)}</div>`;
  }
  const childRows = (item.children || []).map(itemBlockHtml).join('');
  return `
    <div class="${cls}" data-item-id="${item.id}">
      ${headerItemRowHtml(item)}
      <div class="header-item-children">${childRows}</div>
      <div class="header-item-add-sub-slot" data-parent-id="${item.id}"></div>
    </div>
  `;
}

async function loadItems() {
  items = await api('/header-items');
  indexItems();
  const topPick = document.querySelector('.hi-pick[data-prefix="add"]');
  if (topPick) topPick.innerHTML = pickerOptionsHtml();
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
      if (item.isMyProfile) {
        rowEl.innerHTML = `
          <form class="edit-header-item-form">
            <div class="field">
              <label>Sort order (lower shows first)</label>
              <input type="number" id="edit-${id}-sortOrder" value="${item.sortOrder != null ? item.sortOrder : 0}" step="1" style="width:80px">
            </div>
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
            const sortOrder = Number(document.getElementById(`edit-${id}-sortOrder`).value) || 0;
            await api(`/header-items/${id}`, { method: 'PATCH', body: { sortOrder } });
            toast('Position saved');
            await loadItems();
          } catch (err) {
            errorEl.textContent = err.message;
          }
        });
        return;
      }
      rowEl.innerHTML = `
        <form class="edit-header-item-form">
          ${headerItemFormHtml('edit-' + id, item, { withParent: true })}
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
          const parentEl = document.getElementById(`edit-${id}-parentId`);
          body.parentId = parentEl ? (parentEl.value ? Number(parentEl.value) : null) : (item.parentId || null);
          await api(`/header-items/${id}`, { method: 'PATCH', body });
          toast('Header item saved');
          await loadItems();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });

    const deleteBtn = rowEl.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const childCount = descendantCount(item);
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
    }

    const addSubBtn = rowEl.querySelector('[data-action="add-sub"]');
    if (addSubBtn) {
      addSubBtn.addEventListener('click', () => {
        const slot = document.querySelector(`.header-item-add-sub-slot[data-parent-id="${id}"]`);
        const movable = movableInto(item);
        const moveHtml = movable.length ? `
            <div class="field">
              <label>Move an existing menu item here <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(it keeps its own sub-items)</span></label>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <select id="move-in-${id}" style="flex:1;min-width:200px">
                  <option value="">— choose an item —</option>
                  ${movable.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-sm btn-primary" data-action="move-in">Move here</button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--gray-dim);margin:2px 0 12px">…or add a new sub-item:</div>` : '';
        slot.innerHTML = `
          <form class="add-sub-header-item-form" style="padding:10px 4px 14px ${24 * item.depth}px;border-bottom:1px solid var(--gray-light)">
            ${moveHtml}
            ${headerItemFormHtml('add-sub-' + id)}
            <div id="add-sub-${id}-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
            <div style="display:flex;gap:8px">
              <button type="submit" class="btn btn-sm btn-primary">+ Add sub-item</button>
              <button type="button" class="btn btn-sm btn-outline" data-action="cancel">Cancel</button>
            </div>
          </form>
        `;
        slot.querySelector('[data-action="cancel"]').addEventListener('click', () => { slot.innerHTML = ''; });
        const moveBtn = slot.querySelector('[data-action="move-in"]');
        if (moveBtn) {
          moveBtn.addEventListener('click', async () => {
            const errorEl = document.getElementById(`add-sub-${id}-error`);
            errorEl.textContent = '';
            const moving = itemsById.get(Number(document.getElementById(`move-in-${id}`).value));
            if (!moving) { errorEl.textContent = 'Choose the item to move first'; return; }
            try {
              await api(`/header-items/${moving.id}`, { method: 'PATCH', body: {
                labelSk: moving.labelSk, labelEn: moving.labelEn || '', link: moving.link, sortOrder: moving.sortOrder, highlight: moving.highlight, parentId: id,
              } });
              toast(`"${moving.labelSk}" moved under "${item.labelSk}"`);
              await loadItems();
            } catch (err) {
              errorEl.textContent = err.message;
            }
          });
        }
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

// Choosing an existing page fills in the labels and the link of the form it is in.
root.addEventListener('change', (e) => {
  const pick = e.target.closest('.hi-pick');
  if (!pick || !pick.value) return;
  const prefix = pick.dataset.prefix;
  const page = pageChoices().flatMap((g) => g.list).find((p) => p.link === pick.value);
  if (!page) return;
  document.getElementById(`${prefix}-labelSk`).value = page.sk;
  document.getElementById(`${prefix}-labelEn`).value = page.en || '';
  document.getElementById(`${prefix}-link`).value = page.link;
});

async function loadSeasonPages() {
  try {
    const seasons = await api('/seasons');
    seasonPages = seasons.filter((x) => x.slug).map((x) => ({ sk: x.name, en: x.name, link: `/season/${x.slug}` }));
  } catch { seasonPages = []; }
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
  loadSeasonPages().then(loadItems);
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
