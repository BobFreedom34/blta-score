const root = document.getElementById('seasons-admin-root');

let seasons = [];

// Which season cards are unfolded. Remembered in this browser; the first time only the running season is open.
const OPEN_KEY = 'blta_seasons_admin_open';
let openIds = null;
const openPanels = new Set(); // groups whose players panel is unfolded
const previewOpen = new Set(); // seasons whose schedule preview is shown
const FORMAT_KEYS = ['BO1', 'BO3', 'BO3_STB', 'BO5', 'BO5_STB'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function seasonStatus(s) {
  const today = todayIso();
  if (s.startDate && s.endDate) {
    if (s.endDate < today) return 'past';
    if (s.startDate > today) return 'future';
    return 'now';
  }
  return 'future';
}

function initOpenIds() {
  if (openIds) return;
  try {
    const stored = JSON.parse(localStorage.getItem(OPEN_KEY));
    if (Array.isArray(stored)) openIds = new Set(stored);
  } catch { /* no saved state */ }
  if (!openIds) openIds = new Set(seasons.filter((s) => seasonStatus(s) === 'now').map((s) => s.id));
}

function saveOpenIds() {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openIds])); } catch { /* ignore */ }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

const STATUS_LABEL = { now: 'Running', past: 'Finished', future: 'Upcoming' };

const CATEGORIES = [
  ['ELITE', 'Elite'],
  ['NEXT_GEN', 'Next Gen'],
  ['NOVICE', 'Novice'],
];
const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';

function categoryOptions(selected) {
  return CATEGORIES.map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');
}

// The stored description is cleaned HTML, or plain text from before the editor existed (blank lines = paragraphs).
function richText(value) {
  const text = String(value || '');
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderLoggedOut() {
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        Managing seasons requires an admin login.
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">Log in as admin</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">Add a season</h3>
      <form id="add-season-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">Name
          <input type="text" id="season-name" maxlength="120" placeholder="e.g. Winter Opening Series 2027" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" id="season-start" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends
          <input type="date" id="season-end" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <button type="submit" class="btn btn-primary">Add season</button>
      </form>
      <div id="add-season-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div id="season-list">Loading…</div>
  `;

  document.getElementById('add-season-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-season-error');
    errorEl.textContent = '';
    try {
      const created = await api('/seasons', {
        method: 'POST',
        body: {
          name: document.getElementById('season-name').value.trim(),
          startDate: document.getElementById('season-start').value || null,
          endDate: document.getElementById('season-end').value || null,
        },
      });
      e.target.reset();
      if (created && created.id) { initOpenIds(); openIds.add(created.id); saveOpenIds(); }
      toast('Season added');
      await load();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  load();
}

async function load() {
  seasons = await api('/seasons');
  initOpenIds();
  renderList();
}

// The players of a group (a player is in one group per season) and the way to add or withdraw them.
function playersPanelHtml(g) {
  const chips = g.members.map((m) => `
    <span class="sg-chip${m.withdrawn ? ' out' : ''}">${escapeHtml(m.name)}${m.withdrawn ? ' <em>withdrawn</em>' : ''}
      <button type="button" class="sg-link" data-action="toggle-paid" data-player="${m.id}" title="Entry fee paid? (shown on the season page)">${m.paid ? 'Paid ✓' : 'Not paid'}</button>
      ${m.withdrawn ? '' : `<button type="button" class="sg-link" data-action="withdraw" data-player="${m.id}" title="Withdraw: their unplayed matches become walkovers">Withdraw</button>`}
      <button type="button" class="sg-x" data-action="remove-member" data-player="${m.id}" title="Remove (only before the player has matches)">&times;</button>
    </span>`).join('');
  return `
    <div class="sg-panel" data-panel="${g.id}"${openPanels.has(g.id) ? '' : ' hidden'}>
      <div class="sg-chips">${chips || '<span class="sg-empty">No players yet.</span>'}</div>
      <form class="sg-add">
        <div class="autocomplete" style="flex:1;min-width:200px;position:relative">
          <input type="text" id="sg-add-${g.id}" placeholder="Player name" autocomplete="off" style="width:100%;${inputStyle}">
          <div class="autocomplete-list" id="sg-add-list-${g.id}"></div>
        </div>
        <button type="submit" class="btn btn-sm btn-primary">Add player</button>
        ${!g.members.length && g.matchCount ? '<button type="button" class="btn btn-sm btn-outline" data-action="import-members">Import players from matches</button>' : ''}
      </form>
      <div class="sg-chooser"></div>
    </div>`;
}

function groupRowHtml(g) {
  return `
    <div class="season-group" data-group-wrap="${g.id}">
      <div class="season-group-row" data-group="${g.id}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--gray-light)">
        <input type="text" data-field="name" value="${escapeHtml(g.name)}" maxlength="80" style="flex:1;min-width:140px;${inputStyle}">
        <select data-field="category" style="${inputStyle}">${categoryOptions(g.category)}</select>
        <span style="font-size:12px;color:var(--gray);min-width:70px">${g.matchCount} ${g.matchCount === 1 ? 'match' : 'matches'}</span>
        <button type="button" class="btn btn-sm btn-outline" data-action="toggle-players">Players (${g.activeMemberCount})</button>
        <button type="button" class="btn btn-sm btn-outline" data-action="save-group">Save</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-group">Delete</button>
      </div>
      ${playersPanelHtml(g)}
    </div>
  `;
}

// The schedule of the whole season: preview first, then create the matches.
function scheduleSectionHtml() {
  return `
    <div class="sg-schedule">
      <div class="sg-sched-title">Schedule</div>
      <div class="sg-sched-note">Rounds follow from the number of players in each group (6 players: 5 rounds · 7 players: 7 rounds, one player rests each round). Creates planned matches without dates. Running it again only adds the matches that are missing, for example for a player added later.</div>
      <div class="sg-sched-actions">
        <label>Match format
          <select class="sg-format" style="${inputStyle}">${FORMAT_KEYS.map((k) => `<option value="${k}"${k === 'BO3_STB' ? ' selected' : ''}>${escapeHtml(t('format.' + k + '.label'))}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn btn-sm btn-outline" data-action="preview-schedule">Preview schedule</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="create-schedule">Create matches</button>
      </div>
      <div class="sg-preview"></div>
    </div>`;
}

function schedulePreviewHtml(data) {
  if (!data.groups.length) return '<div class="sg-empty">This season has no groups yet.</div>';
  const total = data.groups.reduce((sum, g) => sum + g.toCreate, 0);
  const catLabel = (key) => (CATEGORIES.find(([k]) => k === key) || [key, key])[1];
  const groups = data.groups.map((g) => {
    const head = `<div class="sg-group-head"><b>${escapeHtml(g.name)}</b> <span class="sg-cat">${escapeHtml(catLabel(g.category))}</span> · ${g.activeCount} players · ${g.rounds.length} rounds · ${g.existing} existing · <b>${g.toCreate} to create</b></div>`;
    if (g.activeCount < 2) return `<div class="sg-group">${head}<div class="sg-empty">Add at least 2 players.</div></div>`;
    const pair = (m) => `<span class="sg-pair${m.exists ? '' : ' new'}">${escapeHtml(m.p1.name)} – ${escapeHtml(m.p2.name)}</span>`;
    const rounds = g.rounds.map((r) => `<div class="sg-round"><span class="sg-rn">Round ${r.round}</span><span class="sg-pairs">${r.matches.map(pair).join('')}</span>${r.rest.length ? `<span class="sg-rest">rests: ${escapeHtml(r.rest.join(', '))}</span>` : ''}</div>`).join('');
    const loose = g.unassigned.length ? `<div class="sg-round"><span class="sg-rn">No round</span><span class="sg-pairs">${g.unassigned.map(pair).join('')}</span></div>` : '';
    return `<div class="sg-group">${head}${rounds}${loose}</div>`;
  }).join('');
  return `<div class="sg-total">${total ? `${total} matches would be created (shown in orange)` : 'Nothing to create — every pair already has a match'}</div>${groups}`;
}

function seasonHtml(s) {
  const byCategory = CATEGORIES.map(([key]) => s.groups.filter((g) => g.category === key).length);
  return `
    <details class="card season-admin-card" data-season="${s.id}"${openIds.has(s.id) ? ' open' : ''} style="margin-bottom:12px">
      <summary class="sa-sum">
        <svg class="sa-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="sa-name">${escapeHtml(s.name)}</span>
        <span class="sa-dates">${escapeHtml(s.startDate && s.endDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '')}</span>
        <span class="sa-chip ${seasonStatus(s)}">${STATUS_LABEL[seasonStatus(s)]}</span>
        <span class="sa-count">${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'} · ${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>
      </summary>
      <div class="sa-body">
      <form class="season-edit-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">Season
          <input type="text" data-field="name" value="${escapeHtml(s.name)}" maxlength="120" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" data-field="startDate" value="${escapeHtml(s.startDate || '')}" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends
          <input type="date" data-field="endDate" value="${escapeHtml(s.endDate || '')}" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <div style="flex-basis:100%;margin-top:6px;font-size:12px;font-weight:800;color:var(--gray)">Season page <a href="/season/${escapeHtml(s.slug)}" target="_blank" style="color:var(--orange);text-decoration:underline">/season/${escapeHtml(s.slug)}</a> — all optional</div>
        <label style="font-size:12px;font-weight:700">Entry fee
          <input type="text" data-field="entryFee" value="${escapeHtml(s.entryFee || '')}" maxlength="40" placeholder="e.g. 20 €" style="display:block;margin-top:4px;width:110px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Draw date
          <input type="date" data-field="drawDate" value="${escapeHtml(s.drawDate || '')}" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Prize money
          <input type="text" data-field="prizeMoney" value="${escapeHtml(s.prizeMoney || '')}" maxlength="120" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Gallery link
          <input type="text" data-field="galleryUrl" value="${escapeHtml(s.galleryUrl || '')}" maxlength="500" placeholder="https://…" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Logo (image link, e.g. /img/seasons/autumn.png)
          <input type="text" data-field="logoUrl" value="${escapeHtml(s.logoUrl || '')}" maxlength="300" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Payment link (Stripe) — the "Úhrada štartovného online" button
          <input type="text" data-field="paymentUrl" value="${escapeHtml(s.paymentUrl || '')}" maxlength="500" placeholder="https://buy.stripe.com/…" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700;display:flex;gap:6px;align-items:center;padding-bottom:9px">
          <input type="checkbox" data-field="registrationOpen"${s.registrationOpen ? ' checked' : ''}> Registration open
        </label>
        <div style="flex-basis:100%;font-size:12px;font-weight:700">Description <span style="font-weight:600;color:var(--gray)">— a "Label: value" line becomes a fact tile on the page</span>
          <div class="rte-toolbar">
            <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
            <button type="button" data-cmd="heading" title="Heading">H</button>
            <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
            <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
            <button type="button" data-cmd="link" title="Link">Link</button>
            <button type="button" data-cmd="removeFormat" title="Remove formatting">Clear</button>
          </div>
          <div class="rte" contenteditable="true" data-rte>${richText(s.info)}</div>
        </div>
        <button type="submit" class="btn btn-sm btn-outline">Save season</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-season">Delete season</button>
      </form>
      <div class="season-regs" style="margin:10px 0 0">
        <button type="button" class="btn btn-sm btn-outline" data-action="show-regs">Registrations</button>
        <div class="season-regs-list" hidden style="margin-top:10px"></div>
      </div>
      <div style="font-size:12px;color:var(--gray);margin:8px 0 12px">
        ${s.matchCount} tagged ${s.matchCount === 1 ? 'match' : 'matches'} ·
        ${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'}
        (${byCategory[0]} Elite, ${byCategory[1]} Next Gen, ${byCategory[2]} Novice) — each group is one standings table
      </div>
      <div class="season-error" style="color:var(--danger);font-weight:600"></div>
      <div class="season-groups">${s.groups.length ? s.groups.map(groupRowHtml).join('') : '<div class="empty-state" style="padding:12px 0">No groups yet.</div>'}</div>
      <form class="add-group-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <input type="text" data-field="name" maxlength="80" placeholder="New group, e.g. Babolat" required style="flex:1;min-width:160px;${inputStyle}">
        <select data-field="category" required style="${inputStyle}">
          <option value="">Category…</option>
          ${categoryOptions('')}
        </select>
        <button type="submit" class="btn btn-sm btn-primary">Add group</button>
      </form>
      ${scheduleSectionHtml()}
      </div>
    </details>
  `;
}

function renderList() {
  const listEl = document.getElementById('season-list');
  if (!seasons.length) {
    listEl.innerHTML = '<div class="card"><div class="empty-state">No seasons yet.</div></div>';
    return;
  }
  listEl.innerHTML = `<div class="sa-bar"><button type="button" data-fold="open">Expand all</button><span>·</span><button type="button" data-fold="close">Collapse all</button></div>` + seasons.map(seasonHtml).join('');
  listEl.querySelectorAll('.season-admin-card').forEach(wireSeason);
  listEl.querySelectorAll('[data-fold]').forEach((btn) => {
    btn.addEventListener('click', () => {
      listEl.querySelectorAll('.season-admin-card').forEach((c) => { c.open = btn.dataset.fold === 'open'; });
    });
  });
}

// Players for "Add a player" in a season's registrations, with the phone, e-mail and category of their profile (admin only).
let adminPlayers = null;
async function loadAdminPlayers() {
  if (!adminPlayers) adminPlayers = await api('/players');
  return adminPlayers;
}

// the category written in a profile ("Next Gen", "ELITE"…) as one of ours, or ''
function profileCategory(raw) {
  const key = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return key === 'ELITE' ? 'ELITE' : key === 'NEXTGEN' ? 'NEXT_GEN' : key === 'NOVICE' ? 'NOVICE' : '';
}

function wireSeason(card) {
  const id = Number(card.dataset.season);
  const season = seasons.find((s) => s.id === id);
  const errorEl = card.querySelector('.season-error');
  const fail = (err) => { errorEl.textContent = err.message; };
  card.addEventListener('toggle', () => {
    if (card.open) openIds.add(id); else openIds.delete(id);
    saveOpenIds();
  });

  card.querySelector('.season-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const f = (name) => e.target.querySelector(`[data-field="${name}"]`).value;
    try {
      await api(`/seasons/${id}`, { method: 'PATCH', body: { name: f('name').trim(), startDate: f('startDate') || null, endDate: f('endDate') || null, entryFee: f('entryFee'), prizeMoney: f('prizeMoney'), paymentUrl: f('paymentUrl'), logoUrl: f('logoUrl'), registrationOpen: e.target.querySelector('[data-field="registrationOpen"]').checked, drawDate: f('drawDate') || null, galleryUrl: f('galleryUrl'), info: e.target.querySelector('[data-rte]').innerHTML } });
      toast('Season saved');
      await load();
    } catch (err) { fail(err); }
  });

  // the description editor: toolbar buttons act on the selection; pasting keeps only the text
  const rte = card.querySelector('[data-rte]');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported: the server turns divs into paragraphs */ }
  card.querySelectorAll('.rte-toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the editor
    btn.addEventListener('click', () => {
      rte.focus();
      const cmd = btn.dataset.cmd;
      if (cmd === 'link') {
        const url = prompt('Link address (https://…)');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'heading') {
        const inHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h3';
        document.execCommand('formatBlock', false, inHeading ? 'p' : 'h3');
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });
  rte.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertHTML', false, richText(text));
  });

  // "Registration open" takes effect the moment it is ticked or unticked, without waiting for "Save season"
  const openBox = card.querySelector('[data-field="registrationOpen"]');
  openBox.addEventListener('change', async () => {
    try {
      await api(`/seasons/${id}`, { method: 'PATCH', body: { registrationOpen: openBox.checked } });
      season.registrationOpen = openBox.checked;
      toast(openBox.checked ? 'Registration opened' : 'Registration closed');
    } catch (err) {
      openBox.checked = !openBox.checked;
      fail(err);
    }
  });

  // registrations from the season page's form: contact details, the paid tick, delete
  const regsBtn = card.querySelector('[data-action="show-regs"]');
  const regsList = card.querySelector('.season-regs-list');
  const catLabel = (key) => (CATEGORIES.find(([k]) => k === key) || [key, key])[1];
  // "Add a player": an existing player is registered by the admin, no registration form. Their phone, e-mail and category fill
  // in from the profile (and can be changed for this registration); players already registered are left out of the list.
  function addPlayerFormHtml(players, rows) {
    const taken = new Set(rows.map((r) => r.playerId).filter(Boolean));
    const options = players.filter((p) => !taken.has(p.id)).map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join('');
    const box = `display:block;margin-top:4px;${inputStyle}`;
    return `
      <form class="reg-add" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding:2px 0 6px">
        <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Add a player
          <input type="text" data-ra="player" list="reg-players-${id}" placeholder="Start typing a name…" autocomplete="off" style="${box};width:100%">
          <datalist id="reg-players-${id}">${options}</datalist>
        </label>
        <label style="font-size:12px;font-weight:700">Category
          <select data-ra="category" style="${box}"><option value="">Category…</option>${categoryOptions('')}</select>
        </label>
        <label style="flex:1;min-width:130px;font-size:12px;font-weight:700">Phone
          <input type="text" data-ra="phone" maxlength="20" placeholder="from the profile" style="${box};width:100%">
        </label>
        <label style="flex:1;min-width:170px;font-size:12px;font-weight:700">Email
          <input type="text" data-ra="email" maxlength="120" placeholder="from the profile" style="${box};width:100%">
        </label>
        <button type="submit" class="btn btn-sm btn-primary">Add player</button>
      </form>
      <div class="reg-add-hint" style="font-size:12px;color:var(--gray);min-height:16px;margin-bottom:8px"></div>`;
  }

  function wireAddPlayerForm(players) {
    const form = regsList.querySelector('.reg-add');
    const hint = regsList.querySelector('.reg-add-hint');
    const field = (name) => form.querySelector(`[data-ra="${name}"]`);
    const say = (text, bad) => { hint.textContent = text; hint.style.color = bad ? 'var(--danger)' : 'var(--gray)'; };
    const byName = (text) => players.find((p) => p.name.toLowerCase() === String(text).trim().toLowerCase());
    let chosen = null; // the player typed in the first field, with what their profile holds
    field('player').addEventListener('input', () => {
      chosen = byName(field('player').value) || null;
      field('phone').value = chosen && chosen.phone ? chosen.phone : '';
      field('email').value = chosen && chosen.email ? chosen.email : '';
      field('category').value = chosen ? profileCategory(chosen.category) : '';
      if (!chosen) { say(''); return; }
      const missing = [chosen.phone ? '' : 'phone', chosen.email ? '' : 'email', profileCategory(chosen.category) ? '' : 'category'].filter(Boolean);
      say(missing.length ? `No ${missing.join(', ')} in the profile yet — fill ${missing.length === 1 ? 'it' : 'them'} in here (only this registration gets it).` : 'Phone, email and category are taken from the profile.');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!chosen) { say('Choose a player from the list.', true); return; }
      const body = { playerId: chosen.id, category: field('category').value || undefined };
      if (field('phone').value.trim() !== (chosen.phone || '')) body.phone = field('phone').value;
      if (field('email').value.trim() !== (chosen.email || '')) body.email = field('email').value;
      try {
        await api(`/seasons/${id}/registrations/admin`, { method: 'POST', body });
        toast(`${chosen.name} added`);
        await loadRegs();
        regsList.querySelector('[data-ra="player"]').focus();
      } catch (err) { say(err.message, true); }
    });
  }

  async function loadRegs() {
    try {
      const rows = await api(`/seasons/${id}/registrations`);
      regsBtn.textContent = `Registrations (${rows.length})`;
      const players = await loadAdminPlayers();
      regsList.innerHTML = addPlayerFormHtml(players, rows) + (rows.length ? rows.map((r) => `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid #eee" data-reg="${r.id}">
          <div style="flex:1;min-width:220px">
            <strong>${escapeHtml(r.name)}</strong> <span class="sa-chip future">${escapeHtml(catLabel(r.category))}</span>${r.playerId ? '' : ' <span style="font-size:11px;color:var(--gray)">new name</span>'}
            <div style="font-size:12px;color:var(--gray)">${r.phone || r.email ? `${escapeHtml(r.phone)} · <a href="mailto:${escapeHtml(r.email)}" style="color:var(--orange)">${escapeHtml(r.email)}</a>` : 'no contact details'} · ${escapeHtml(fmtDate(r.createdAt.slice(0, 10)))}</div>
            ${r.note ? `<div style="font-size:13px;margin-top:4px;white-space:pre-wrap"><strong>Note:</strong> ${escapeHtml(r.note)}</div>` : ''}
          </div>
          <button type="button" class="sg-link" data-reg-paid="${r.paid ? 0 : 1}">${r.paid ? 'Paid ✓' : 'Not paid'}</button>
          <button type="button" class="sg-x" data-reg-del title="Delete this registration">&times;</button>
        </div>`).join('') : '<div class="sg-empty">No registrations yet.</div>');
      wireAddPlayerForm(players);
    } catch (err) { fail(err); }
  }
  regsBtn.addEventListener('click', async () => {
    regsList.hidden = !regsList.hidden;
    if (!regsList.hidden) await loadRegs();
  });
  regsList.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-reg]');
    if (!row) return;
    const rid = row.dataset.reg;
    try {
      if (e.target.closest('[data-reg-paid]')) {
        await api(`/seasons/registrations/${rid}`, { method: 'PATCH', body: { paid: e.target.closest('[data-reg-paid]').dataset.regPaid === '1' } });
        await loadRegs();
      } else if (e.target.closest('[data-reg-del]')) {
        if (!confirm('Delete this registration?')) return;
        await api(`/seasons/registrations/${rid}`, { method: 'DELETE' });
        await loadRegs();
      }
    } catch (err) { fail(err); }
  });

  card.querySelector('[data-action="delete-season"]').addEventListener('click', async () => {
    const extra = season.matchCount ? ` ${season.matchCount} matches will lose their season and group (the matches stay).` : '';
    if (!confirm(`Delete "${season.name}" and its ${season.groups.length} groups?${extra}`)) return;
    try {
      await api(`/seasons/${id}`, { method: 'DELETE' });
      toast('Season deleted');
      await load();
    } catch (err) { fail(err); }
  });

  card.querySelector('.add-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const f = (name) => e.target.querySelector(`[data-field="${name}"]`).value;
    try {
      await api(`/seasons/${id}/groups`, { method: 'POST', body: { name: f('name').trim(), category: f('category') } });
      toast('Group added');
      await load();
    } catch (err) { fail(err); }
  });

  card.querySelectorAll('.season-group').forEach((wrap) => {
    const gid = Number(wrap.dataset.groupWrap);
    wireGroupPanel(wrap, season.groups.find((g) => g.id === gid), fail);
  });
  wireSchedule(card, id, fail);

  card.querySelectorAll('.season-group-row').forEach((row) => {
    const groupId = Number(row.dataset.group);
    const group = season.groups.find((g) => g.id === groupId);
    const val = (name) => row.querySelector(`[data-field="${name}"]`).value;
    row.querySelector('[data-action="save-group"]').addEventListener('click', async () => {
      errorEl.textContent = '';
      try {
        await api(`/seasons/groups/${groupId}`, { method: 'PATCH', body: { name: val('name').trim(), category: val('category') } });
        toast('Group saved');
        await load();
      } catch (err) { fail(err); }
    });
    row.querySelector('[data-action="delete-group"]').addEventListener('click', async () => {
      const extra = group.matchCount ? ` ${group.matchCount} matches will lose their group (they stay in the season).` : '';
      if (!confirm(`Delete group "${group.name}" and its player list?${extra}`)) return;
      try {
        await api(`/seasons/groups/${groupId}`, { method: 'DELETE' });
        toast('Group deleted');
        await load();
      } catch (err) { fail(err); }
    });
  });
}

// ---------- players of a group ----------

function wireGroupPanel(wrap, group, fail) {
  const row = wrap.querySelector('.season-group-row');
  const panel = wrap.querySelector('.sg-panel');
  const chooser = panel.querySelector('.sg-chooser');
  const input = panel.querySelector(`#sg-add-${group.id}`);
  row.querySelector('[data-action="toggle-players"]').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) openPanels.delete(group.id); else openPanels.add(group.id);
  });
  setupAutocomplete(`sg-add-${group.id}`, `sg-add-list-${group.id}`);

  const add = async (body) => {
    chooser.innerHTML = '';
    try {
      await api(`/seasons/groups/${group.id}/members`, { method: 'POST', body });
      toast('Player added');
      openPanels.add(group.id);
      await load();
    } catch (err) {
      const d = err.data || {};
      if (d.code === 'SIMILAR_PLAYERS' || d.code === 'UNKNOWN_PLAYER') showChooser(d);
      else fail(err);
    }
  };
  // A typed name that matches nobody exactly: pick an existing player or explicitly create a new one.
  const showChooser = (d) => {
    const title = d.code === 'SIMILAR_PLAYERS' ? `Is “${escapeHtml(d.typed)}” one of these players?` : `There is no player “${escapeHtml(d.typed)}” yet.`;
    chooser.innerHTML = `
      <div class="sg-choose-title">${title}</div>
      <div class="sg-choose-buttons">
        ${d.suggestions.map((p) => `<button type="button" class="btn btn-sm btn-outline" data-pick="${p.id}">${escapeHtml(p.name)}</button>`).join('')}
        <button type="button" class="btn btn-sm btn-primary" data-new="1">No — create new player “${escapeHtml(d.typed)}”</button>
        <button type="button" class="sg-link" data-cancel="1">Cancel</button>
      </div>`;
    chooser.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => add({ playerId: Number(b.dataset.pick) })));
    chooser.querySelector('[data-new]').addEventListener('click', () => add({ name: d.typed, confirmNew: true }));
    chooser.querySelector('[data-cancel]').addEventListener('click', () => { chooser.innerHTML = ''; });
  };
  panel.querySelector('.sg-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name) add({ name });
  });

  panel.querySelectorAll('[data-action="toggle-paid"]').forEach((b) => b.addEventListener('click', async () => {
    const member = group.members.find((m) => m.id === Number(b.dataset.player));
    try {
      await api(`/seasons/groups/${group.id}/members/${member.id}`, { method: 'PATCH', body: { paid: !member.paid } });
      openPanels.add(group.id);
      await load();
    } catch (err) { fail(err); }
  }));
  panel.querySelectorAll('[data-action="withdraw"]').forEach((b) => b.addEventListener('click', async () => {
    const member = group.members.find((m) => m.id === Number(b.dataset.player));
    if (!confirm(`Withdraw ${member.name} from ${group.name}?\n\nEvery match they have not played yet becomes a walkover win for the opponent (3 points), and no new matches are made for them.`)) return;
    try {
      const res = await api(`/seasons/groups/${group.id}/members/${member.id}/withdraw`, { method: 'POST' });
      toast(`${member.name} withdrew — ${res.walkovers} walkover${res.walkovers === 1 ? '' : 's'} recorded`);
      openPanels.add(group.id);
      await load();
    } catch (err) { fail(err); }
  }));
  panel.querySelectorAll('[data-action="remove-member"]').forEach((b) => b.addEventListener('click', async () => {
    const member = group.members.find((m) => m.id === Number(b.dataset.player));
    if (!confirm(`Remove ${member.name} from ${group.name}?`)) return;
    try {
      await api(`/seasons/groups/${group.id}/members/${member.id}`, { method: 'DELETE' });
      openPanels.add(group.id);
      await load();
    } catch (err) { fail(err); }
  }));
  const importBtn = panel.querySelector('[data-action="import-members"]');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      try {
        const res = await api(`/seasons/groups/${group.id}/members/import`, { method: 'POST' });
        toast(`${res.added} player${res.added === 1 ? '' : 's'} imported${res.inOtherGroup ? ` (${res.inOtherGroup} already in another group)` : ''}`);
        openPanels.add(group.id);
        await load();
      } catch (err) { fail(err); }
    });
  }
}

// ---------- schedule of a season ----------

function wireSchedule(card, seasonId, fail) {
  const previewEl = card.querySelector('.sg-preview');
  const loadPreview = async () => {
    const data = await api(`/seasons/${seasonId}/schedule-preview`);
    previewEl.innerHTML = schedulePreviewHtml(data);
    previewOpen.add(seasonId);
    return data;
  };
  card.querySelector('[data-action="preview-schedule"]').addEventListener('click', async () => {
    try { await loadPreview(); } catch (err) { fail(err); }
  });
  card.querySelector('[data-action="create-schedule"]').addEventListener('click', async () => {
    try {
      const data = await loadPreview();
      const total = data.groups.reduce((sum, g) => sum + g.toCreate, 0);
      if (!total) { toast('Nothing to create — every pair already has a match'); return; }
      const groupsWith = data.groups.filter((g) => g.toCreate > 0).length;
      if (!confirm(`Create ${total} planned matches in ${groupsWith} group${groupsWith === 1 ? '' : 's'}?\n\nThey get no date yet; the players agree it themselves.`)) return;
      const res = await api(`/seasons/${seasonId}/schedule`, { method: 'POST', body: { format: card.querySelector('.sg-format').value } });
      toast(`${res.created} matches created`);
      await load();
    } catch (err) { fail(err); }
  });
  if (previewOpen.has(seasonId)) loadPreview().catch(() => {});
}

(async () => {
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  await loadPlayers();
  renderAdmin();
})();
