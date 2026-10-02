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
      <p style="font-size:12px;color:var(--gray-dim);margin:8px 0 0">Just the name is enough to start — then use Edit details to add the address, contact, courts and more. Venues show up on the public <a href="/courts" target="_blank" rel="noopener" style="text-decoration:underline">Courts page</a> and as suggestions when typing a match location.</p>
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

function rowHtml(v) {
  return `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <div style="font-weight:700">${escapeHtml(v.name)}</div>
        <div style="font-size:12px;color:var(--gray)">${escapeHtml(summaryText(v))}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
        <a href="/courts/${encodeURIComponent(v.slug)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">View</a>
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
  listEl.innerHTML = venues.map((v) => `<div class="venue-admin-row" data-id="${v.id}" style="border-bottom:1px solid var(--gray-light);padding:12px 4px">${rowHtml(v)}</div>`).join('');
  listEl.querySelectorAll('.venue-admin-row').forEach(wireRow);
}

function wireRow(rowEl) {
  const id = Number(rowEl.dataset.id);
  const venue = venues.find((x) => x.id === id);

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

function editorHtml(v) {
  return `
    <form class="venue-editor" style="margin-top:14px;padding:16px;border-radius:12px;background:var(--gray-light)">
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
