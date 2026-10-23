const root = document.getElementById('seasons-admin-root');
// The same editor serves two pages: /seasons-admin (league seasons) and /tournaments-admin (tournaments, data-kind="TOURNAMENT").
const KIND = root && root.dataset.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE';
const IS_TOURNAMENT = KIND === 'TOURNAMENT';
const WORD = IS_TOURNAMENT ? 'tournament' : 'season';

let seasons = [];

// Which season cards are unfolded. Remembered in this browser; the first time only the running season is open.
const OPEN_KEY = IS_TOURNAMENT ? 'blta_tournaments_admin_open' : 'blta_seasons_admin_open';
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
      <h3 style="margin-top:0">Add a ${WORD}</h3>
      <form id="add-season-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">Name
          <input type="text" id="season-name" maxlength="120" placeholder="${IS_TOURNAMENT ? 'e.g. Slávia Filozof Cup 2026' : 'e.g. Winter Opening Series 2027'}" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Starts
          <input type="date" id="season-start" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">Ends
          <input type="date" id="season-end" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        ${IS_TOURNAMENT ? `<label style="flex:1;min-width:200px;font-size:12px;font-weight:700">Venue <span style="font-weight:600;color:var(--gray)">(optional)</span>
          <input type="text" id="season-venue" maxlength="200" placeholder="Address or club" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>` : ''}
        <button type="submit" class="btn btn-primary">Add</button>
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
          kind: KIND,
          venue: IS_TOURNAMENT ? document.getElementById('season-venue').value.trim() : '',
        },
      });
      e.target.reset();
      if (created && created.id) { initOpenIds(); openIds.add(created.id); saveOpenIds(); }
      toast(IS_TOURNAMENT ? 'Tournament added' : 'Season added');
      await load();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  load();
}

async function load() {
  seasons = (await api('/seasons')).filter((s) => s.kind === KIND);
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

// The schedule of the whole season: preview first, then create the matches. A league season only: a tournament is played in brackets.
function scheduleSectionHtml() {
  if (IS_TOURNAMENT) return '';
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

// The hero photo of the page: one for wide screens (3:1) and one for phones (4:3). The pictures are cut to these sizes from their centre
// and shrunk here before they are sent, so any picture can be used; what matters is that the main thing is in the middle.
const HERO_KINDS = {
  desktop: { w: 2400, h: 800, label: 'Počítač a tablet', shape: '3:1', note: 'Na šírku. Dôležité veci daj do stredu, názov je cez dolnú ľavú časť (tam nech je pokojné miesto).' },
  mobile: { w: 1200, h: 900, label: 'Mobil', shape: '4:3', note: 'Takmer štvorec. Ak ho nenahráš, mobil ukáže obrázok pre počítač (orezaný zo stredu).' },
};

function heroBlockHtml(s, kind) {
  const k = HERO_KINDS[kind];
  const url = kind === 'desktop' ? s.heroUrl : s.heroMobileUrl;
  return `
    <div class="sa-hero" data-hero="${kind}">
      <div class="sa-hero-pic" style="aspect-ratio:${k.w} / ${k.h}">${url ? `<img src="${escapeHtml(url)}" alt="">` : '<span>Zatiaľ bez fotky</span>'}</div>
      <div class="sa-hero-info">
        <strong>${k.label} — ${k.w} × ${k.h} px (${k.shape})</strong>
        <span>${k.note}</span>
        <div class="sa-hero-actions">
          <label class="btn btn-sm btn-outline">${url ? 'Nahradiť fotku' : 'Nahrať fotku'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
          ${url ? '<button type="button" class="btn btn-sm btn-danger" data-hero-remove>Odstrániť</button>' : ''}
          <span class="sa-hero-msg"></span>
        </div>
      </div>
    </div>`;
}

// Cuts the picture to the ratio from its centre and shrinks it to the size (JPG); the file itself when the browser cannot read it.
async function cropHero(file, w, h) {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = w / h;
    let sw = bitmap.width;
    let sh = Math.round(sw / ratio);
    if (sh > bitmap.height) { sh = bitmap.height; sw = Math.round(sh * ratio); }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(w, sw);
    canvas.height = Math.round(canvas.width / ratio);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, Math.round((bitmap.width - sw) / 2), Math.round((bitmap.height - sh) / 2), sw, sh, 0, 0, canvas.width, canvas.height);
    return (await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))) || file;
  } catch {
    return file;
  }
}

// The card of a tournament or a season: under the name the tabs — a tournament: Základné info · Registrácie · Zaradenie do kategórií ·
// Pavúk turnaja; a season: Základné info · Registrácie · Skupiny · Rozpis — and only the chosen one is shown (what is in a tab is loaded
// when it is opened). The form of the basic info is in sections.
const CARD_TABS = IS_TOURNAMENT
  ? [['info', 'Základné info'], ['regs', 'Registrácie'], ['assign', 'Zaradenie do kategórií'], ['draw', 'Pavúk turnaja']]
  : [['info', 'Základné info'], ['regs', 'Registrácie'], ['groups', 'Skupiny'], ['schedule', 'Rozpis']];
const cardTab = new Map(); // season id -> the tab last opened (kept when the list is drawn again)

function seasonCardHtml(s) {
  const byCategory = CATEGORIES.map(([key]) => s.groups.filter((g) => g.category === key).length);
  const field = (label, control, cls = '') => `<label class="sa-field ${cls}">${label}${control}</label>`;
  const input = (name, value, attrs = '') => '<input ' + (/type=/.test(attrs) ? '' : 'type="text" ') + 'data-field="' + name + '" value="' + escapeHtml(value == null ? '' : String(value)) + '" ' + attrs + '>';
  const active = cardTab.get(s.id) || 'info';
  return `
    <details class="card season-admin-card sa-card" data-season="${s.id}"${openIds.has(s.id) ? ' open' : ''} style="margin-bottom:12px">
      <summary class="sa-sum">
        <svg class="sa-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="sa-name">${escapeHtml(s.name)}</span>
        <span class="sa-dates">${escapeHtml(s.startDate && s.endDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '')}</span>
        <span class="sa-chip ${seasonStatus(s)}">${STATUS_LABEL[seasonStatus(s)]}</span>
        <span class="sa-count">${IS_TOURNAMENT ? '' : `${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'} · `}${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}</span>
      </summary>
      <div class="sa-tabs" role="tablist">
        ${CARD_TABS.map(([key, label]) => `<button type="button" class="sa-tab${key === active ? ' active' : ''}" data-tab="${key}" role="tab">${label}</button>`).join('')}
        <a class="sa-tab-link" href="/${IS_TOURNAMENT ? 'tournament' : 'season'}/${escapeHtml(s.slug)}" target="_blank" rel="noopener">${IS_TOURNAMENT ? 'Stránka turnaja' : 'Stránka sezóny'} ↗</a>
      </div>
      <div class="sa-body">
        <div class="season-error" style="color:var(--danger);font-weight:600"></div>

        <div class="sa-panel" data-panel="info"${active === 'info' ? '' : ' hidden'}>
          <form class="season-edit-form">
            <section class="sa-section">
              <h4>Základné údaje</h4>
              <div class="sa-grid">
                ${field('Názov', input('name', s.name, 'maxlength="120" required'), 'sa-wide')}
                ${field('Začiatok', input('startDate', s.startDate || '', 'type="date"'))}
                ${field('Koniec', input('endDate', s.endDate || '', 'type="date"'))}
                ${IS_TOURNAMENT ? field('Miesto', input('venue', s.venue || '', 'maxlength="200" placeholder="Adresa alebo klub"'), 'sa-wide') : ''}
                ${IS_TOURNAMENT ? `<div class="sa-field sa-wide">Kategórie
                  <div class="sa-checks">${CATEGORIES.map(([k, label]) => `<label><input type="checkbox" data-cat="${k}"${s.categories.includes(k) ? ' checked' : ''}> ${label}</label>`).join('')}</div>
                </div>` : ''}
              </div>
            </section>

            ${IS_TOURNAMENT ? `<section class="sa-section">
              <h4>Kurty a pravidlá hrania</h4>
              <div class="sa-grid">
                ${field('Počet kurtov (Kurt 1 … Kurt n)', input('courtCount', s.courtCount || '', 'type="number" min="0" max="50" inputmode="numeric" placeholder="napr. 4"'))}
                ${field('Max. zápasov hráča za deň', input('maxMatchesPerDay', s.maxMatchesPerDay || '', 'type="number" min="0" max="10" inputmode="numeric" placeholder="bez limitu"'))}
              </div>
            </section>` : ''}

            <section class="sa-section">
              <h4>Štartovné a registrácia</h4>
              <div class="sa-grid">
                ${field('Štartovné', input('entryFee', s.entryFee || '', 'maxlength="40" placeholder="napr. 20 €"'))}
                ${field('Ceny pre víťazov', input('prizeMoney', s.prizeMoney || '', 'maxlength="120"'))}
                ${field('Dátum žrebovania', input('drawDate', s.drawDate || '', 'type="date"'))}
                <label class="sa-field sa-check"><input type="checkbox" data-field="registrationOpen"${s.registrationOpen ? ' checked' : ''}> Registrácia je otvorená</label>
                ${field('Odkaz na platbu (Stripe) — tlačidlo „Úhrada štartovného online“', input('paymentUrl', s.paymentUrl || '', 'maxlength="500" placeholder="https://buy.stripe.com/…"'), 'sa-full')}
              </div>
            </section>

            <section class="sa-section">
              <h4>Vzhľad stránky</h4>
              <div class="sa-grid">
                ${field('Odkaz na galériu', input('galleryUrl', s.galleryUrl || '', 'maxlength="500" placeholder="https://…"'), 'sa-wide')}
                ${field('Logo (odkaz na obrázok, napr. /img/seasons/autumn.png)', input('logoUrl', s.logoUrl || '', 'maxlength="300"'), 'sa-wide')}
              </div>
              <div class="sa-field sa-full" style="margin-top:12px" data-logo-block>Logo — nahranie <span class="sa-hint">— vyber logo z počítača alebo z knižnice (Backend → Média). Nahrá sa hneď, netreba Uložiť. PNG, JPG alebo WebP do 8 MB.</span>
                <div class="sa-logo-row">
                  <div class="sa-logo-pic" data-logo-pic>${s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" alt="">` : '<span>Zatiaľ bez loga</span>'}</div>
                  <div class="sa-hero-actions">
                    <label class="btn btn-sm btn-outline"><span data-logo-label>${s.logoUrl ? 'Nahradiť logo' : 'Nahrať logo'}</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
                    <button type="button" class="btn btn-sm btn-danger" data-logo-remove${s.logoUrl ? '' : ' hidden'}>Odstrániť</button>
                    <span class="sa-hero-msg" data-logo-msg></span>
                  </div>
                </div>
              </div>
              <div class="sa-field sa-full" style="margin-top:12px">Hero fotka stránky <span class="sa-hint">— veľká fotka hore na stránke, názov ${IS_TOURNAMENT ? 'turnaja' : 'sezóny'} je cez jej dolnú časť. Nahrá sa hneď, netreba Uložiť. JPG, PNG alebo WebP do 8 MB.</span>
                <div class="sa-hero-grid">${heroBlockHtml(s, 'desktop')}${heroBlockHtml(s, 'mobile')}</div>
              </div>
              <div class="sa-field sa-full" style="margin-top:12px">Popis <span class="sa-hint">— riadok „Názov: hodnota“ sa na stránke zobrazí ako dlaždica</span>
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
            </section>

            <div class="sa-actions">
              <button type="submit" class="btn btn-sm btn-primary">Uložiť</button>
              <span style="flex:1"></span>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-season">${IS_TOURNAMENT ? 'Zmazať turnaj' : 'Zmazať sezónu'}</button>
            </div>
          </form>
        </div>

        <div class="sa-panel" data-panel="regs"${active === 'regs' ? '' : ' hidden'}><div class="season-regs-list"></div></div>
        ${IS_TOURNAMENT ? `<div class="sa-panel" data-panel="assign"${active === 'assign' ? '' : ' hidden'}><div class="season-assign"></div></div>
        <div class="sa-panel" data-panel="draw"${active === 'draw' ? '' : ' hidden'}><div class="season-draw"></div></div>` : `<div class="sa-panel" data-panel="groups"${active === 'groups' ? '' : ' hidden'}>
          <div style="font-size:12px;color:var(--gray);margin:0 0 12px">${s.matchCount} tagged ${s.matchCount === 1 ? 'match' : 'matches'} · ${s.groups.length} ${s.groups.length === 1 ? 'group' : 'groups'}
            (${byCategory[0]} Elite, ${byCategory[1]} Next Gen, ${byCategory[2]} Novice) — each group is one standings table</div>
          <div class="season-groups">${s.groups.length ? s.groups.map(groupRowHtml).join('') : '<div class="empty-state" style="padding:12px 0">No groups yet.</div>'}</div>
          <form class="add-group-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <input type="text" data-field="name" maxlength="80" placeholder="New group, e.g. Babolat" required style="flex:1;min-width:160px;${inputStyle}">
            <select data-field="category" required style="${inputStyle}">
              <option value="">Category…</option>
              ${categoryOptions('')}
            </select>
            <button type="submit" class="btn btn-sm btn-primary">Add group</button>
          </form>
        </div>
        <div class="sa-panel" data-panel="schedule"${active === 'schedule' ? '' : ' hidden'}>${scheduleSectionHtml()}</div>`}
      </div>
    </details>
  `;
}

function seasonHtml(s) {
  return seasonCardHtml(s);
}

function renderList() {
  const listEl = document.getElementById('season-list');
  if (!seasons.length) {
    listEl.innerHTML = `<div class="card"><div class="empty-state">No ${WORD}s yet.</div></div>`;
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
      await api(`/seasons/${id}`, { method: 'PATCH', body: { name: f('name').trim(), startDate: f('startDate') || null, endDate: f('endDate') || null, entryFee: f('entryFee'), prizeMoney: f('prizeMoney'), paymentUrl: f('paymentUrl'), logoUrl: f('logoUrl'), registrationOpen: e.target.querySelector('[data-field="registrationOpen"]').checked, drawDate: f('drawDate') || null, galleryUrl: f('galleryUrl'), info: e.target.querySelector('[data-rte]').innerHTML, ...(IS_TOURNAMENT ? { venue: f('venue'), courtCount: f('courtCount') === '' ? 0 : Number(f('courtCount')), maxMatchesPerDay: f('maxMatchesPerDay') === '' ? 0 : Number(f('maxMatchesPerDay')), categories: [...e.target.querySelectorAll('[data-cat]')].filter((b) => b.checked).map((b) => b.dataset.cat) } : {}) } });
      toast('Saved');
      await load();
    } catch (err) { fail(err); }
  });

  // the description editor: toolbar buttons act on the selection; pasting keeps only the text
  // the hero photos: cut, shrunk and sent at once
  card.querySelectorAll('[data-hero]').forEach((block) => {
    const kind = block.dataset.hero;
    const spec = HERO_KINDS[kind];
    const done = (updated) => {
      const i = seasons.findIndex((x) => x.id === id);
      if (i >= 0) seasons[i] = { ...seasons[i], heroUrl: updated.heroUrl, heroMobileUrl: updated.heroMobileUrl };
      Object.assign(season, { heroUrl: updated.heroUrl, heroMobileUrl: updated.heroMobileUrl });
      block.outerHTML = heroBlockHtml(updated, kind);
      const fresh = card.querySelector(`[data-hero="${kind}"]`);
      wireHeroBlock(fresh);
    };
    const wireHeroBlock = (el) => {
      const input = el.querySelector('input[type=file]');
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const m = el.querySelector('.sa-hero-msg');
        m.textContent = 'Nahrávam…';
        try {
          const blob = await cropHero(file, spec.w, spec.h);
          const body = new FormData();
          body.append('photo', blob, 'hero.jpg');
          const res = await fetch(`/api/seasons/${id}/hero?kind=${kind}`, { method: 'POST', body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
          toast('Fotka nahraná');
          done(data);
        } catch (err) { m.textContent = err.message; m.style.color = 'var(--danger)'; }
      });
      const remove = el.querySelector('[data-hero-remove]');
      if (remove) remove.addEventListener('click', async () => {
        try { done(await api(`/seasons/${id}/hero?kind=${kind}`, { method: 'DELETE' })); toast('Fotka odstránená'); } catch (err) { el.querySelector('.sa-hero-msg').textContent = err.message; }
      });
    };
    wireHeroBlock(block);
  });

  // the logo: a picture from the computer or the library, sent at once; the address goes into the field above
  const logoBlock = card.querySelector('[data-logo-block]');
  if (logoBlock) {
    const urlField = card.querySelector('[data-field="logoUrl"]');
    const pic = logoBlock.querySelector('[data-logo-pic]');
    const msg = logoBlock.querySelector('[data-logo-msg]');
    const removeBtn = logoBlock.querySelector('[data-logo-remove]');
    const fileInput = logoBlock.querySelector('input[type=file]');
    const show = (url) => {
      pic.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : '<span>Zatiaľ bez loga</span>';
      urlField.value = url || '';
      removeBtn.hidden = !url;
      logoBlock.querySelector('[data-logo-label]').textContent = url ? 'Nahradiť logo' : 'Nahrať logo';
      const i = seasons.findIndex((x) => x.id === id);
      if (i >= 0) seasons[i] = { ...seasons[i], logoUrl: url || '' };
      season.logoUrl = url || '';
    };
    urlField.addEventListener('input', () => { pic.innerHTML = urlField.value.trim() ? `<img src="${escapeHtml(urlField.value.trim())}" alt="">` : '<span>Zatiaľ bez loga</span>'; });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      msg.style.color = ''; msg.textContent = 'Nahrávam…';
      try {
        const body = new FormData();
        body.append('photo', file, file.name || 'logo.png');
        const res = await fetch(`/api/seasons/${id}/logo`, { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        show(data.logoUrl);
        msg.textContent = '';
        toast('Logo nahrané');
      } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--danger)'; }
      fileInput.value = '';
    });
    removeBtn.addEventListener('click', async () => {
      try { await api(`/seasons/${id}/logo`, { method: 'DELETE' }); show(''); toast('Logo odstránené'); } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--danger)'; }
    });
  }

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
  const regsBtn = card.querySelector('[data-tab="regs"]');
  const regsList = card.querySelector('.season-regs-list');
  const catLabel = (key) => (CATEGORIES.find(([k]) => k === key) || [key, key])[1];
  // "Add a player": an existing player is registered by the admin, no registration form. Their phone, e-mail and category fill
  // in from the profile (and can be changed for this registration); players already registered are left out of the list.
  let addableNames = [];
  function addPlayerFormHtml(players, rows) {
    const taken = new Set(rows.map((r) => r.playerId).filter(Boolean));
    addableNames = players.filter((p) => !taken.has(p.id)).map((p) => p.name);
    const box = `display:block;margin-top:4px;${inputStyle}`;
    return `
      <form class="reg-add" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding:2px 0 6px">
        <label style="flex:2;min-width:220px;font-size:12px;font-weight:700">Add a player
          <div class="autocomplete"><input type="text" data-ra="player" id="reg-player-${id}" placeholder="Start typing a name or surname…" autocomplete="off" style="${box};width:100%"><div class="autocomplete-list" id="reg-player-list-${id}"></div></div>
        </label>
        <label style="font-size:12px;font-weight:700">Category
          <select data-ra="category" style="${box}"><option value="">${IS_TOURNAMENT ? 'No category' : 'Category…'}</option>${categoryOptions('')}</select>
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
    setupAutocomplete(`reg-player-${id}`, `reg-player-list-${id}`, () => addableNames);
    const byName = (text) => players.find((p) => p.name.toLowerCase() === String(text).trim().toLowerCase());
    let chosen = null; // the player typed in the first field, with what their profile holds
    field('player').addEventListener('input', () => {
      chosen = byName(field('player').value) || null;
      field('phone').value = chosen && chosen.phone ? chosen.phone : '';
      field('email').value = chosen && chosen.email ? chosen.email : '';
      field('category').value = chosen ? profileCategory(chosen.category) : '';
      if (!chosen) { say(''); return; }
      const missing = [chosen.phone ? '' : 'phone', chosen.email ? '' : 'email', IS_TOURNAMENT || profileCategory(chosen.category) ? '' : 'category'].filter(Boolean);
      say(missing.length ? `No ${missing.join(', ')} in the profile yet — fill ${missing.length === 1 ? 'it' : 'them'} in here (only this registration gets it).` : 'Phone, email and category are taken from the profile.');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!chosen) { say('Choose a player from the list.', true); return; }
      // a tournament entry may have no category: the empty choice is sent as it is; a league season takes the profile's when none is picked
      const body = { playerId: chosen.id, category: IS_TOURNAMENT ? field('category').value : (field('category').value || undefined) };
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

  let editingReg = null; // the registration being edited (its row shows a small form)
  function regEditHtml(r) {
    const box = `display:block;margin-top:4px;${inputStyle}`;
    return `
        <div style="padding:10px 0;border-top:1px solid #eee" data-reg="${r.id}">
          <strong>${escapeHtml(r.name)}</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px">
            <label style="font-size:12px;font-weight:700">Category
              <select data-re="category" style="${box}">${IS_TOURNAMENT ? `<option value="">No category</option>` : ''}${categoryOptions(r.category)}</select>
            </label>
            <label style="flex:1;min-width:130px;font-size:12px;font-weight:700">Phone
              <input type="text" data-re="phone" maxlength="20" value="${escapeHtml(r.phone || '')}" style="${box};width:100%">
            </label>
            <label style="flex:1;min-width:170px;font-size:12px;font-weight:700">Email
              <input type="text" data-re="email" maxlength="120" value="${escapeHtml(r.email || '')}" style="${box};width:100%">
            </label>
          </div>
          <label style="display:block;font-size:12px;font-weight:700;margin-top:8px">Note
            <textarea data-re="note" rows="2" maxlength="500" style="${box};width:100%">${escapeHtml(r.note || '')}</textarea>
          </label>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="button" class="btn btn-sm btn-primary" data-reg-save>Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-reg-cancel>Cancel</button>
          </div>
        </div>`;
  }

  async function loadRegs() {
    try {
      const rows = await api(`/seasons/${id}/registrations`);
      regsBtn.textContent = `Registrácie (${rows.length})`;
      const players = await loadAdminPlayers();
      regsList.innerHTML = addPlayerFormHtml(players, rows) + (rows.length ? rows.map((r) => (r.id === editingReg ? regEditHtml(r) : `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid #eee" data-reg="${r.id}">
          <div style="flex:1;min-width:220px">
            <strong>${escapeHtml(r.name)}</strong> <span class="sa-chip future">${escapeHtml(r.category ? catLabel(r.category) : 'No category')}</span>${r.playerId ? '' : ' <span style="font-size:11px;color:var(--gray)">new name</span>'}
            <div style="font-size:12px;color:var(--gray)">${r.phone || r.email ? `${escapeHtml(r.phone)} · <a href="mailto:${escapeHtml(r.email)}" style="color:var(--orange)">${escapeHtml(r.email)}</a>` : 'no contact details'} · ${escapeHtml(fmtDate(r.createdAt.slice(0, 10)))}</div>
            ${r.note ? `<div style="font-size:13px;margin-top:4px;white-space:pre-wrap"><strong>Note:</strong> ${escapeHtml(r.note)}</div>` : ''}
          </div>
          <button type="button" class="sg-link" data-reg-edit title="Change the category, phone, e-mail or note">Edit</button>
          <button type="button" class="sg-link" data-reg-paid="${r.paid ? 0 : 1}">${r.paid ? 'Paid ✓' : 'Not paid'}</button>
          <button type="button" class="sg-x" data-reg-del title="Delete this registration">&times;</button>
        </div>`)).join('') : '<div class="sg-empty">No registrations yet.</div>');
      wireAddPlayerForm(players);
    } catch (err) { fail(err); }
  }
  // the tabs under the name (what is in a tab is loaded each time it is opened)
  {
    const assignHost = card.querySelector('.season-assign');
    const drawHost = card.querySelector('.season-draw');
    const openers = IS_TOURNAMENT ? {
      regs: () => loadRegs(),
      assign: () => openAssignPanel(assignHost, id, () => {}),
      draw: () => openDrawPanel(drawHost, id),
    } : { regs: () => loadRegs() };
    async function showTab(name) {
      cardTab.set(id, name);
      card.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      card.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
      errorEl.textContent = '';
      if (openers[name]) { try { await openers[name](); } catch (err) { fail(err); } }
    }
    card.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    // the registrations count is in the tab's name from the start; the tab that was open is filled in
    const first = cardTab.get(id) || 'info';
    if (first !== 'info') showTab(first);
    api(`/seasons/${id}/registrations`).then((rows) => { regsBtn.textContent = `Registrácie (${rows.length})`; }).catch(() => {});
  }
  regsList.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-reg]');
    if (!row) return;
    const rid = row.dataset.reg;
    try {
      if (e.target.closest('[data-reg-edit]')) {
        editingReg = Number(rid);
        await loadRegs();
      } else if (e.target.closest('[data-reg-cancel]')) {
        editingReg = null;
        await loadRegs();
      } else if (e.target.closest('[data-reg-save]')) {
        const val = (name) => row.querySelector(`[data-re="${name}"]`).value;
        await api(`/seasons/registrations/${rid}`, { method: 'PATCH', body: { category: val('category'), phone: val('phone'), email: val('email'), note: val('note') } });
        editingReg = null;
        toast('Registration saved');
        await loadRegs();
      } else if (e.target.closest('[data-reg-paid]')) {
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
    // a tournament goes with everything that belongs to it: its matches, brackets, registrations
    if (IS_TOURNAMENT) {
      const matches = season.matchCount ? `ALL ${season.matchCount} of its matches (with their results and the ranking points they gave)` : 'its brackets';
      if (!confirm(`Delete the tournament "${season.name}" together with ${matches}, its registrations and brackets?\n\nThis cannot be undone.`)) return;
    } else if (!confirm(`Delete "${season.name}" and its ${season.groups.length} groups?${extra}`)) return;
    try {
      const res = await api(`/seasons/${id}${IS_TOURNAMENT ? '?withMatches=1' : ''}`, { method: 'DELETE' });
      toast(IS_TOURNAMENT ? `Tournament deleted (${res.deletedMatches || 0} matches)` : 'Season deleted');
      await load();
    } catch (err) { fail(err); }
  });

  const addGroupForm = card.querySelector('.add-group-form');
  if (addGroupForm) addGroupForm.addEventListener('submit', async (e) => {
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
  if (IS_TOURNAMENT) return;
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
