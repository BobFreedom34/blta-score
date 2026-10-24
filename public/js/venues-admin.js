const root = document.getElementById('venues-admin-root');

let venues = [];

const COURT_TYPES = [
  ['', '— not set —'],
  ['OUTDOOR', 'Outdoor'],
  ['INDOOR', 'Indoor'],
  ['BOTH', 'Indoor + Outdoor'],
];
const SURFACES = [
  ['CLAY', 'Clay (antuka)'],
  ['HARD', 'Hard'],
  ['ARTIFICIAL_GRASS', 'Artificial grass'],
  ['CARPET', 'Carpet'],
  ['GRASS', 'Grass'],
];
const FACILITIES = [
  ['PARKING', 'Parking'],
  ['SHOWERS', 'Showers'],
  ['CHANGING_ROOMS', 'Changing rooms'],
  ['BAR_CAFE', 'Bar / café'],
  ['RESTAURANT', 'Restaurant'],
  ['LIGHTING', 'Lighting'],
  ['RACKET_RENTAL', 'Racket rental'],
  ['COACHING', 'Coaching / tennis school'],
  ['PRO_SHOP', 'Pro shop'],
  ['WELLNESS', 'Wellness (sauna, pool…)'],
  ['MULTISPORT', 'MultiSport card accepted'],
];

const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing venues requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a venue</h3>
      <form id="add-venue-form" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="venue-name" maxlength="120" placeholder="e.g. NTC Bratislava" required style="flex:1;min-width:200px;${inputStyle}">
        <button type="submit" class="btn btn-primary">Add venue</button>
      </form>
      <p style="font-size:12px;color:var(--gray-dim);margin:8px 0 0">Just the name is enough to start — then use Edit details to add the address, contact, courts and more. Venues show up on the public <a data-public href="/courts" target="_blank" rel="noopener" style="text-decoration:underline">Courts page</a> and as suggestions when typing a match location.</p>
      <div id="add-venue-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Venues <span id="venue-count" style="font-weight:400;color:var(--gray-dim);font-size:13px"></span></h3>
      <div id="venue-list">Loading…</div>
    </div>
  `;

  document.getElementById('add-venue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-venue-error');
    errorEl.textContent = '';
    const input = document.getElementById('venue-name');
    try {
      const created = await api('/venues', { method: 'POST', body: { name: input.value.trim() } });
      input.value = '';
      toast('Venue added');
      await loadVenuesList();
      openEditor(created.id);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  loadVenuesList();
}

async function loadVenuesList() {
  venues = await api('/venues');
  renderList();
}

function summaryText(v) {
  const bits = [v.area, v.address, v.courtsCount ? `${v.courtsCount} courts` : ''].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'No details yet';
}

function rowHtml(v, index) {
  return `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span class="hi-move"><span class="hi-handle" title="Potiahni na zmenu poradia">⋮⋮</span><button type="button" class="hi-arrow" data-move="up" title="Vyššie" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="hi-arrow" data-move="down" title="Nižšie" ${index === venues.length - 1 ? 'disabled' : ''}>↓</button></span>
      <div class="venue-row-thumb" style="width:64px;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:#e6e6e6;flex-shrink:0">${v.imageUrl ? `<img src="${escapeHtml(v.imageUrl)}" alt="" style="display:block;width:100%;height:100%;object-fit:cover">` : ''}</div>
      <div style="flex:1;min-width:180px">
        <div style="font-weight:700">${escapeHtml(v.name)}</div>
        <div style="font-size:12px;color:var(--gray)">${escapeHtml(summaryText(v))}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
        <a data-public href="/courts/${encodeURIComponent(v.slug)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View</a>
        <button type="button" class="btn btn-sm btn-outline" data-action="edit">Edit details</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </div>
    </div>
    <div class="venue-editor-slot"></div>
  `;
}

function renderList() {
  document.getElementById('venue-count').textContent = venues.length ? `(${venues.length})` : '';
  const listEl = document.getElementById('venue-list');
  if (!venues.length) {
    listEl.innerHTML = '<div class="empty-state">No venues yet.</div>';
    return;
  }
  listEl.innerHTML = venues.map((v, i) => `<div class="venue-admin-row" data-id="${v.id}" style="border-bottom:1px solid var(--gray-light);padding:12px 4px">${rowHtml(v, i)}</div>`).join('');
  listEl.querySelectorAll('.venue-admin-row').forEach(wireRow);
  if (!listEl.dataset.dragWired) { listEl.dataset.dragWired = '1'; wireVenueDrag(listEl); }
}

// Saves the order of the whole list (the public Courts page follows it) and shows it.
async function reorderVenues(ids) {
  try {
    venues = await api('/venues/reorder', { method: 'POST', body: { ids } });
  } catch (err) {
    toast(err.message);
    venues = await api('/venues');
  }
  renderList();
}

// Dragging: grab the ⋮⋮ handle of a venue and drop it before or after another one (the arrows do the same one step at a time).
function wireVenueDrag(listEl) {
  let dragged = null;
  let mark = null;
  const clear = () => {
    listEl.querySelectorAll('.vn-drop-before, .vn-drop-after').forEach((el) => el.classList.remove('vn-drop-before', 'vn-drop-after'));
    mark = null;
  };
  listEl.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.hi-handle');
    if (handle) handle.closest('.venue-admin-row').draggable = true;
  });
  listEl.addEventListener('mouseup', () => listEl.querySelectorAll('.venue-admin-row[draggable="true"]').forEach((el) => { el.draggable = false; }));
  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.venue-admin-row');
    if (!row || !row.draggable) return;
    dragged = row;
    row.classList.add('hi-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.id);
  });
  listEl.addEventListener('dragover', (e) => {
    if (!dragged) return;
    const over = e.target.closest('.venue-admin-row');
    if (!over || over === dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clear();
    const box = over.getBoundingClientRect();
    mark = { row: over, before: e.clientY < box.top + box.height / 2 };
    over.classList.add(mark.before ? 'vn-drop-before' : 'vn-drop-after');
  });
  listEl.addEventListener('drop', (e) => {
    if (!dragged || !mark) return;
    e.preventDefault();
    const id = Number(dragged.dataset.id);
    const target = Number(mark.row.dataset.id);
    const ids = venues.map((v) => v.id).filter((x) => x !== id);
    const at = ids.indexOf(target);
    ids.splice(mark.before ? at : at + 1, 0, id);
    const before = venues.map((v) => v.id);
    clear();
    dragged.classList.remove('hi-dragging');
    dragged.draggable = false;
    dragged = null;
    if (ids.every((x, i) => x === before[i])) return; // dropped where it was
    reorderVenues(ids);
  });
  listEl.addEventListener('dragend', () => {
    clear();
    if (dragged) { dragged.classList.remove('hi-dragging'); dragged.draggable = false; }
    dragged = null;
  });
}

function wireRow(rowEl) {
  const id = Number(rowEl.dataset.id);
  const venue = venues.find((x) => x.id === id);

  rowEl.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', () => {
    const ids = venues.map((v) => v.id);
    const at = ids.indexOf(id);
    const to = btn.dataset.move === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    reorderVenues(ids);
  }));

  rowEl.querySelector('[data-action="edit"]').addEventListener('click', () => {
    const slot = rowEl.querySelector('.venue-editor-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    openEditor(id);
  });

  rowEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete "${venue.name}"? Matches already using it as their location keep it — it just stops being suggested and its page is removed.`)) return;
    try {
      await api(`/venues/${id}`, { method: 'DELETE' });
      toast('Venue deleted');
      await loadVenuesList();
    } catch (err) {
      toast(err.message);
    }
  });
}

function textField(name, label, value, opts = {}) {
  return `
    <div class="field" style="margin-bottom:0">
      <label for="vf-${name}">${label}${opts.hint ? ` <span style="font-weight:400;color:var(--gray-dim);font-size:12px">${opts.hint}</span>` : ''}</label>
      <input type="${opts.type || 'text'}" id="vf-${name}" value="${escapeHtml(value == null ? '' : value)}" ${opts.attrs || ''} placeholder="${escapeHtml(opts.placeholder || '')}">
    </div>
  `;
}

function checkboxGroup(name, options, selected) {
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px 18px">
      ${options.map(([value, label]) => `
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:14px">
          <input type="checkbox" name="vf-${name}" value="${value}" ${selected.includes(value) ? 'checked' : ''} style="width:auto;margin:0"> ${label}
        </label>
      `).join('')}
    </div>
  `;
}

function sectionTitle(text) {
  return `<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--orange);margin:18px 0 8px">${text}</div>`;
}

// The photo on the venue's card on /courts: always shown in a 16:9 frame, so one size fits all.
const PHOTO_W = 768;
const PHOTO_H = 432;

function photoSectionHtml(v) {
  return `
    ${sectionTitle('Photo')}
    <div class="venue-photo-box" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
      <div class="venue-photo-preview" style="width:240px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#d9d9d9;flex-shrink:0">
        ${v.imageUrl ? `<img src="${escapeHtml(v.imageUrl)}" alt="Kurty - ${escapeHtml(v.name)}" style="display:block;width:100%;height:100%;object-fit:cover">` : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--gray);font-size:13px">No photo yet</div>'}
      </div>
      <div style="flex:1;min-width:220px">
        <div style="font-size:13px;line-height:1.5;color:var(--gray)">
          <strong style="color:var(--ink)">Size: ${PHOTO_W} × ${PHOTO_H} px (16:9 landscape)</strong> — JPG, PNG or WebP, up to 6 MB.
          A bigger or differently shaped picture is cut to 16:9 from its centre and shrunk to ${PHOTO_W} × ${PHOTO_H} (saved as JPG) automatically, so choose one where the courts are in the middle. Use a picture of the courts without people, and one you are allowed to use.
          It is shown above the venue name on the Courts page, with the alt text "Kurty - ${escapeHtml(v.name)}".
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
          <label class="btn btn-sm btn-outline" style="margin:0;cursor:pointer">${v.imageUrl ? 'Replace photo' : 'Upload photo'}<input type="file" class="venue-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
          ${v.imageUrl ? '<button type="button" class="btn btn-sm btn-danger" data-action="remove-photo">Remove photo</button>' : ''}
          <span class="venue-photo-msg" style="font-size:13px;color:var(--gray)"></span>
        </div>
      </div>
    </div>
  `;
}

// Cuts the picture to 16:9 from its centre and shrinks it to 768 x 432 (JPG). Falls back to the file itself when the browser cannot read it.
async function cropToVenuePhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = PHOTO_W / PHOTO_H;
    let sw = bitmap.width;
    let sh = Math.round(sw / ratio);
    if (sh > bitmap.height) { sh = bitmap.height; sw = Math.round(sh * ratio); }
    const sx = Math.round((bitmap.width - sw) / 2);
    const sy = Math.round((bitmap.height - sh) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W;
    canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

function wirePhoto(form, id, slot) {
  const msg = form.querySelector('.venue-photo-msg');
  const say = (text, bad) => { msg.textContent = text; msg.style.color = bad ? 'var(--danger)' : 'var(--gray)'; };
  const refresh = (updated) => {
    const i = venues.findIndex((x) => x.id === id);
    if (i >= 0) venues[i] = updated;
    // the editor is redrawn (its unsaved text fields would be lost, so only the photo block changes) and the list row updates its thumbnail
    const box = form.querySelector('.venue-photo-box');
    const holder = document.createElement('div');
    holder.innerHTML = photoSectionHtml(updated);
    box.replaceWith(holder.querySelector('.venue-photo-box'));
    wirePhoto(form, id, slot);
    const rowThumb = document.querySelector(`.venue-admin-row[data-id="${id}"] .venue-row-thumb`);
    if (rowThumb) rowThumb.innerHTML = updated.imageUrl ? `<img src="${escapeHtml(updated.imageUrl)}" alt="" style="display:block;width:100%;height:100%;object-fit:cover">` : '';
  };
  const input = form.querySelector('.venue-photo-input');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    say('Uploading…');
    try {
      const blob = await cropToVenuePhoto(file);
      const data = new FormData();
      data.append('photo', blob, 'photo.jpg');
      const res = await fetch(`/api/venues/${id}/photo`, { method: 'POST', body: data, credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      refresh(body);
      form.querySelector('.venue-photo-msg').textContent = 'Photo saved ✓';
    } catch (err) {
      say(err.message, true);
    }
    input.value = '';
  });
  const removeBtn = form.querySelector('[data-action="remove-photo"]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove the photo of this venue?')) return;
      try {
        refresh(await api(`/venues/${id}/photo`, { method: 'DELETE' }));
      } catch (err) {
        say(err.message, true);
      }
    });
  }
}

function editorHtml(v) {
  return `
    <form class="venue-editor" style="margin-top:14px;padding:16px;border-radius:12px;background:var(--gray-light)">
      ${photoSectionHtml(v)}
      ${sectionTitle('Basics')}
      <div class="grid-2">
        ${textField('name', 'Name', v.name, { attrs: 'maxlength="120" required' })}
        ${textField('area', 'Area', v.area, { hint: '(district / town)', placeholder: 'e.g. Petržalka', attrs: 'maxlength="80"' })}
      </div>
      <div style="margin-top:12px">${textField('address', 'Address', v.address, { placeholder: 'e.g. Príkopova 6, 831 03 Bratislava', attrs: 'maxlength="200"' })}</div>
      <div class="field" style="margin:12px 0 0">
        <label for="vf-description">Description <span style="font-weight:400;color:var(--gray-dim);font-size:12px">(optional, shown at the top of the venue page)</span></label>
        <textarea id="vf-description" rows="3" maxlength="1000" style="${inputStyle}">${escapeHtml(v.description || '')}</textarea>
      </div>

      ${sectionTitle('Contact')}
      <div class="grid-2">
        ${textField('phone', 'Phone', v.phone, { placeholder: '+421 …', attrs: 'maxlength="60"' })}
        ${textField('email', 'E-mail', v.email, { type: 'email', attrs: 'maxlength="120"' })}
        ${textField('website', 'Website', v.website, { placeholder: 'https://…', attrs: 'maxlength="500"' })}
        ${textField('bookingUrl', 'Booking link', v.bookingUrl, { placeholder: 'https://… (online reservation page)', attrs: 'maxlength="500"' })}
        ${textField('instagram', 'Instagram', v.instagram, { hint: '(handle or link)', placeholder: '@name', attrs: 'maxlength="200"' })}
        ${textField('facebook', 'Facebook', v.facebook, { placeholder: 'https://facebook.com/…', attrs: 'maxlength="500"' })}
      </div>

      ${sectionTitle('Courts')}
      <div class="grid-2">
        <div class="field" style="margin-bottom:0">
          <label for="vf-courtType">Court type</label>
          <select id="vf-courtType">${COURT_TYPES.map(([value, label]) => `<option value="${value}" ${(v.courtType || '') === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        </div>
        ${textField('courtsCount', 'Number of courts', v.courtsCount, { type: 'number', attrs: 'min="0" max="200" step="1"' })}
      </div>
      <div style="margin-top:12px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">Surfaces</div>
        ${checkboxGroup('surfaces', SURFACES, v.surfaces)}
      </div>
      <div class="grid-2" style="margin-top:12px">
        ${textField('openingHours', 'Opening hours', v.openingHours, { placeholder: 'e.g. Po–Pi 7:00–22:00, So–Ne 8:00–20:00', attrs: 'maxlength="200"' })}
        ${textField('price', 'Price', v.price, { hint: '(free text)', placeholder: 'e.g. od 12 € / hod', attrs: 'maxlength="120"' })}
      </div>

      ${sectionTitle('Facilities')}
      ${checkboxGroup('facilities', FACILITIES, v.facilities)}

      ${sectionTitle('Map')}
      <div class="grid-2">
        ${textField('lat', 'Latitude', v.lat, { type: 'number', placeholder: '48.1486', attrs: 'step="any" min="-90" max="90"' })}
        ${textField('lng', 'Longitude', v.lng, { type: 'number', placeholder: '17.1077', attrs: 'step="any" min="-180" max="180"' })}
      </div>
      <p style="font-size:12px;color:var(--gray);margin:6px 0 0">Needed for the pin on the maps. In Google Maps, right-click the spot and click the coordinates to copy them (latitude first).</p>

      <div class="venue-editor-error" style="color:var(--danger);font-weight:600;margin-top:12px"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" data-action="cancel">Cancel</button>
      </div>
    </form>
  `;
}

function checked(form, name) {
  return Array.from(form.querySelectorAll(`input[name="vf-${name}"]:checked`)).map((el) => el.value);
}

function openEditor(id) {
  const rowEl = document.querySelector(`.venue-admin-row[data-id="${id}"]`);
  const venue = venues.find((x) => x.id === id);
  if (!rowEl || !venue) return;
  const slot = rowEl.querySelector('.venue-editor-slot');
  slot.innerHTML = editorHtml(venue);
  const form = slot.querySelector('.venue-editor');
  const val = (name) => form.querySelector(`#vf-${name}`).value.trim();

  wirePhoto(form, id, slot);
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector('.venue-editor-error');
    errorEl.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api(`/venues/${id}`, {
        method: 'PATCH',
        body: {
          name: val('name'),
          area: val('area'),
          address: val('address'),
          description: val('description'),
          phone: val('phone'),
          email: val('email'),
          website: val('website'),
          bookingUrl: val('bookingUrl'),
          instagram: val('instagram'),
          facebook: val('facebook'),
          courtType: val('courtType'),
          courtsCount: val('courtsCount'),
          surfaces: checked(form, 'surfaces'),
          openingHours: val('openingHours'),
          price: val('price'),
          facilities: checked(form, 'facilities'),
          lat: val('lat'),
          lng: val('lng'),
        },
      });
      toast('Venue saved');
      await loadVenuesList();
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
  slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  renderAdmin();
})();
