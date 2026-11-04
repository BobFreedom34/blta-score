const root = document.getElementById('seasons-admin-root');
// The same editor serves two pages: /seasons-admin (league seasons) and /tournaments-admin (tournaments, data-kind="TOURNAMENT").
// A third use: the manage page of a tournament of a club (/community-tournament/<id>, data-club): the same card for the one tournament, for the admin of its club.
// There is no list and no "add a tournament" (it is made on the page of the club), and the club admin is a logged-in player, not a site admin.
// The season of a club (a league-style one with groups and a table, made on the page of the club too) uses the season card: the kind of that page is set when the season is read.
const CLUB = !!(root && root.dataset.club);
const CLUB_SEASON_ID = CLUB ? Number(window.location.pathname.split('/').filter(Boolean).pop()) : 0;
let KIND = CLUB || (root && root.dataset.kind === 'TOURNAMENT') ? 'TOURNAMENT' : 'LEAGUE';
let IS_TOURNAMENT = KIND === 'TOURNAMENT';
let WORD = IS_TOURNAMENT ? 'tournament' : 'season';
// the page of a season of a club: the same card as a league season (registration, groups, schedule, brackets); only its groups may also be without a category
const isClubSeason = () => CLUB && !IS_TOURNAMENT;

let seasons = [];

// Which season cards are unfolded. Remembered in this browser; the first time only the running season is open.
const openKey = () => (IS_TOURNAMENT ? 'blta_tournaments_admin_open' : 'blta_seasons_admin_open');
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
    const stored = JSON.parse(localStorage.getItem(openKey()));
    if (Array.isArray(stored)) openIds = new Set(stored);
  } catch { /* no saved state */ }
  if (!openIds) openIds = new Set(seasons.filter((s) => seasonStatus(s) === 'now').map((s) => s.id));
}

function saveOpenIds() {
  try { localStorage.setItem(openKey(), JSON.stringify([...openIds])); } catch { /* ignore */ }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

const STATUS_LABEL = { now: tl('Prebieha', 'Running'), past: tl('Skončené', 'Finished'), future: tl('Nadchádzajúce', 'Upcoming') };

const CATEGORIES = [
  ['ELITE', 'Elite'],
  ['NEXT_GEN', 'Next Gen'],
  ['NOVICE', 'Novice'],
];
const inputStyle = 'padding:8px 10px;border-radius:8px;border:1.5px solid #ddd;font-family:inherit;font-size:14px';

// a season played without categories (the box "Bez kategórie" of its editor)
const seasonWithoutCategories = (s) => !!s && (s.categories || []).includes('OPEN');

function categoryOptions(selected, forGroup = false, season = null) {
  // a group of a season of a club may also be without a category (like a tournament without categories); a season without categories has only such groups
  const none = tl('Bez kategórie', 'No category');
  const list = forGroup && seasonWithoutCategories(season) ? [['OPEN', none]] : forGroup && isClubSeason() ? [...CATEGORIES, ['OPEN', none]] : CATEGORIES;
  return list.map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`).join('');
}

// The stored description is cleaned HTML, or plain text from before the editor existed (blank lines = paragraphs).
function richText(value) {
  const text = String(value || '');
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderLoggedOut() {
  if (CLUB) {
    root.innerHTML = `<div class="card"><p style="margin:0;color:var(--gray)">${escapeHtml(t('ct.loginNeeded'))} <button type="button" class="btn btn-primary com-small" id="ct-login">${escapeHtml(t('ct.login'))}</button></p></div>`;
    document.getElementById('ct-login').addEventListener('click', () => requirePlayerAuth(() => window.location.reload()));
    return;
  }
  root.innerHTML = `
    <div class="card">
      <p style="margin:0;color:var(--gray)">
        ${tl('Na správu sezón a turnajov je potrebné prihlásenie správcu.', 'Managing seasons and tournaments requires an admin login.')}
        <a href="/admin" style="text-decoration:underline;color:var(--orange)">${tl('Prihlásiť sa ako správca', 'Log in as admin')}</a>.
      </p>
    </div>
  `;
}

function renderAdmin() {
  if (CLUB) {
    root.innerHTML = `<div id="season-list">${tl('Načítavam…', 'Loading…')}</div>`;
    load();
    return;
  }
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">${IS_TOURNAMENT ? tl('Pridať turnaj', 'Add a tournament') : tl('Pridať sezónu', 'Add a season')}</h3>
      <form id="add-season-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        ${IS_TOURNAMENT ? `<label style="font-size:12px;font-weight:700">${tl('Typ turnaja', 'Tournament type')}
          <select id="season-playtype" required style="display:block;margin-top:4px;${inputStyle}">
            <option value="">${tl('— najprv vyber —', '— choose first —')}</option><option value="SINGLES">${tl('Dvojhra', 'Singles')}</option><option value="DOUBLES">${tl('Štvorhra', 'Doubles')}</option>
          </select>
        </label>` : ''}
        <label style="flex:1;min-width:220px;font-size:12px;font-weight:700">${tl('Názov', 'Name')}
          <input type="text" id="season-name" maxlength="120" placeholder="${IS_TOURNAMENT ? tl('napr. Slávia Filozof Cup 2026', 'e.g. Slávia Filozof Cup 2026') : tl('napr. Zimná otváracia séria 2027', 'e.g. Winter Opening Series 2027')}" required style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">${tl('Začiatok', 'Starts')}
          <input type="date" id="season-start" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        <label style="font-size:12px;font-weight:700">${tl('Koniec', 'Ends')}
          <input type="date" id="season-end" style="display:block;margin-top:4px;${inputStyle}">
        </label>
        ${IS_TOURNAMENT ? `<label style="flex:1;min-width:200px;font-size:12px;font-weight:700">${tl('Miesto', 'Venue')} <span style="font-weight:600;color:var(--gray)">${tl('(nepovinné)', '(optional)')}</span>
          <input type="text" id="season-venue" maxlength="200" placeholder="${tl('Adresa alebo klub', 'Address or club')}" style="display:block;width:100%;margin-top:4px;${inputStyle}">
        </label>` : ''}
        <button type="submit" class="btn btn-primary">${tl('Pridať', 'Add')}</button>
      </form>
      <div id="add-season-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
    </div>
    <div id="season-list">${tl('Načítavam…', 'Loading…')}</div>
  `;

  document.getElementById('add-season-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('add-season-error');
    errorEl.textContent = '';
    try {
      // a tournament is singles or doubles, never both: chosen first (it cannot be changed afterwards)
      if (IS_TOURNAMENT && !document.getElementById('season-playtype').value) throw new Error(tl('Najprv vyber, či ide o dvojhru alebo o štvorhru.', 'First choose whether it is singles or doubles.'));
      const created = await api('/seasons', {
        method: 'POST',
        body: {
          name: document.getElementById('season-name').value.trim(),
          startDate: document.getElementById('season-start').value || null,
          endDate: document.getElementById('season-end').value || null,
          kind: KIND,
          venue: IS_TOURNAMENT ? document.getElementById('season-venue').value.trim() : '',
          ...(IS_TOURNAMENT ? { playType: document.getElementById('season-playtype').value } : {}),
        },
      });
      e.target.reset();
      if (created && created.id) { initOpenIds(); openIds.add(created.id); saveOpenIds(); }
      toast(IS_TOURNAMENT ? tl('Turnaj pridaný', 'Tournament added') : tl('Sezóna pridaná', 'Season added'));
      await load();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  load();
}

// the tabs of a card stay under the top bar while the page scrolls: the height of the bar goes to the stylesheet as --topbar-h, and follows it when it changes
// (its links are filled in after the page loads and wrap into more rows on a narrower screen)
let topbarWatched = false;
function syncTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  if (bar.offsetHeight) document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
  if (!topbarWatched && window.ResizeObserver) { topbarWatched = true; new ResizeObserver(syncTopbarHeight).observe(bar); }
}
window.addEventListener('resize', syncTopbarHeight);
window.addEventListener('load', syncTopbarHeight);

async function load() {
  syncTopbarHeight();
  if (CLUB) {
    try {
      seasons = [await api(`/seasons/${CLUB_SEASON_ID}`)];
    } catch (err) {
      root.innerHTML = `<div class="card"><p style="margin:0;color:var(--gray)">${escapeHtml(t('ct.notFound'))}</p></div>`;
      return;
    }
    const season = seasons[0];
    KIND = season.kind === 'TOURNAMENT' ? 'TOURNAMENT' : 'LEAGUE';
    IS_TOURNAMENT = KIND === 'TOURNAMENT';
    WORD = IS_TOURNAMENT ? 'tournament' : 'season';
    if (!IS_TOURNAMENT && !allPlayers.length) await loadPlayers(); // (the names offered when a player is added to a group)
    document.getElementById('ct-title').textContent = season.name;
    const back = document.getElementById('ct-back');
    if (season.organisation) { back.href = `/community/${encodeURIComponent(season.organisation.slug)}#events`; back.textContent = `‹ ${season.organisation.name}`; }
    initOpenIds();
    openIds.add(season.id);
    renderList();
    return;
  }
  seasons = (await api('/seasons')).filter((s) => s.kind === KIND);
  initOpenIds();
  renderList();
}

// The players of a group (a player is in one group per season) and the way to add or withdraw them.
function playersPanelHtml(g) {
  const chips = g.members.map((m) => `
    <span class="sg-chip${m.withdrawn ? ' out' : ''}">${escapeHtml(m.name)}${m.withdrawn ? ` <em>${tl('odstúpil', 'withdrawn')}</em>` : ''}
      <button type="button" class="sg-link" data-action="toggle-paid" data-player="${m.id}" title="${escapeHtml(tl('Štartovné zaplatené? (ukáže sa na stránke)', 'Entry fee paid? (shown on the page)'))}">${m.paid ? tl('Zaplatené ✓', 'Paid ✓') : tl('Nezaplatené', 'Not paid')}</button>
      ${m.withdrawn ? `<button type="button" class="sg-link" data-action="reinstate" data-player="${m.id}" title="${escapeHtml(tl('Zrušiť odstúpenie: hráč je opäť v skupine a jeho kontumácie z odstúpenia sa vrátia na neodohrané', 'Undo the withdrawal: the player is back in the group and the walkovers of the withdrawal become unplayed again'))}">${tl('Zrušiť odstúpenie', 'Undo withdrawal')}</button>` : `<button type="button" class="sg-link" data-action="withdraw" data-player="${m.id}" title="${escapeHtml(tl('Odstúpiť: jeho neodohrané zápasy sa kontumujú', 'Withdraw: their unplayed matches become walkovers'))}">${tl('Odstúpiť', 'Withdraw')}</button>`}
      <button type="button" class="sg-x" data-action="remove-member" data-player="${m.id}" title="${escapeHtml(tl('Odstrániť (len kým hráč nemá zápasy)', 'Remove (only before the player has matches)'))}">&times;</button>
    </span>`).join('');
  return `
    <div class="sg-panel" data-panel="${g.id}"${openPanels.has(g.id) ? '' : ' hidden'}>
      <div class="sg-chips">${chips || `<span class="sg-empty">${tl('Zatiaľ žiadni hráči.', 'No players yet.')}</span>`}</div>
      <form class="sg-add">
        <div class="autocomplete" style="flex:1;min-width:200px;position:relative">
          <input type="text" id="sg-add-${g.id}" placeholder="${escapeHtml(tl('Meno hráča', 'Player name'))}" autocomplete="off" style="width:100%;${inputStyle}">
          <div class="autocomplete-list" id="sg-add-list-${g.id}"></div>
        </div>
        <button type="submit" class="btn btn-sm btn-primary">${tl('Pridať hráča', 'Add player')}</button>
        ${!g.members.length && g.matchCount ? `<button type="button" class="btn btn-sm btn-outline" data-action="import-members">${tl('Importovať hráčov zo zápasov', 'Import players from matches')}</button>` : ''}
      </form>
      <div class="sg-chooser"></div>
    </div>`;
}

function groupRowHtml(g, season) {
  return `
    <div class="season-group" data-group-wrap="${g.id}">
      <div class="season-group-row" data-group="${g.id}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--gray-light)">
        <input type="text" data-field="name" value="${escapeHtml(g.name)}" maxlength="80" style="flex:1;min-width:140px;${inputStyle}">
        <select data-field="category" style="${inputStyle}">${categoryOptions(g.category, true, season)}</select>
        <span style="font-size:12px;color:var(--gray);min-width:70px">${g.matchCount} ${nounFor(g.matchCount, 'zápas', 'zápasy', 'zápasov', 'match', 'matches')}</span>
        <button type="button" class="btn btn-sm btn-outline" data-action="toggle-players">${tl('Hráči', 'Players')} (${g.activeMemberCount})</button>
        <button type="button" class="btn btn-sm btn-outline" data-action="save-group">${tl('Uložiť', 'Save')}</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-group">${tl('Zmazať', 'Delete')}</button>
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
      <div class="sg-sched-title">${tl('Rozpis', 'Schedule')}</div>
      <div class="sg-sched-note">${tl('Počet kôl vyplýva z počtu hráčov v skupine (6 hráčov: 5 kôl · 7 hráčov: 7 kôl, v každom kole jeden hráč oddychuje). Vytvorí naplánované zápasy bez dátumov. Ak ho spustíš znova, doplní len zápasy, ktoré chýbajú, napríklad pre neskôr pridaného hráča.', 'Rounds follow from the number of players in each group (6 players: 5 rounds · 7 players: 7 rounds, one player rests each round). Creates planned matches without dates. Running it again only adds the matches that are missing, for example for a player added later.')}</div>
      <div class="sg-sched-actions">
        <label>${tl('Formát zápasu', 'Match format')}
          <select class="sg-format" style="${inputStyle}">${FORMAT_KEYS.map((k) => `<option value="${k}"${k === 'BO3_STB' ? ' selected' : ''}>${escapeHtml(t('format.' + k + '.label'))}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn btn-sm btn-outline" data-action="preview-schedule">${tl('Náhľad rozpisu', 'Preview schedule')}</button>
        <button type="button" class="btn btn-sm btn-primary" data-action="create-schedule">${tl('Vytvoriť zápasy', 'Create matches')}</button>
      </div>
      <div class="sg-preview"></div>
    </div>`;
}

function schedulePreviewHtml(data) {
  if (!data.groups.length) return `<div class="sg-empty">${tl('Táto sezóna zatiaľ nemá skupiny.', 'This season has no groups yet.')}</div>`;
  const total = data.groups.reduce((sum, g) => sum + g.toCreate, 0);
  const catLabel = (key) => (CATEGORIES.find(([k]) => k === key) || [key, key])[1];
  const groups = data.groups.map((g) => {
    const head = `<div class="sg-group-head"><b>${escapeHtml(g.name)}</b> <span class="sg-cat">${escapeHtml(catLabel(g.category))}</span> · ${g.activeCount} ${nounFor(g.activeCount, 'hráč', 'hráči', 'hráčov', 'player', 'players')} · ${g.rounds.length} ${nounFor(g.rounds.length, 'kolo', 'kolá', 'kôl', 'round', 'rounds')} · ${g.existing} ${tl('existujúcich', 'existing')} · <b>${g.toCreate} ${tl('na vytvorenie', 'to create')}</b></div>`;
    if (g.activeCount < 2) return `<div class="sg-group">${head}<div class="sg-empty">${tl('Pridaj aspoň 2 hráčov.', 'Add at least 2 players.')}</div></div>`;
    const pair = (m) => `<span class="sg-pair${m.exists ? '' : ' new'}">${escapeHtml(m.p1.name)} – ${escapeHtml(m.p2.name)}</span>`;
    const rounds = g.rounds.map((r) => `<div class="sg-round"><span class="sg-rn">${tl('Kolo', 'Round')} ${r.round}</span><span class="sg-pairs">${r.matches.map(pair).join('')}</span>${r.rest.length ? `<span class="sg-rest">${tl('oddychuje', 'rests')}: ${escapeHtml(r.rest.join(', '))}</span>` : ''}</div>`).join('');
    const loose = g.unassigned.length ? `<div class="sg-round"><span class="sg-rn">${tl('Bez kola', 'No round')}</span><span class="sg-pairs">${g.unassigned.map(pair).join('')}</span></div>` : '';
    return `<div class="sg-group">${head}${rounds}${loose}</div>`;
  }).join('');
  return `<div class="sg-total">${total ? tl(`Vytvorí sa ${total} ${nounFor(total, 'zápas', 'zápasy', 'zápasov', '', '')} (oranžovou)`, `${total} ${nounFor(total, '', '', '', 'match', 'matches')} would be created (shown in orange)`) : tl('Nie je čo vytvárať — každá dvojica už má zápas', 'Nothing to create — every pair already has a match')}</div>${groups}`;
}

// The hero photo of the page: one for wide screens (3:1) and one for phones (4:3). The pictures are cut to these sizes from their centre
// and shrunk here before they are sent, so any picture can be used; what matters is that the main thing is in the middle.
const HERO_KINDS = {
  desktop: { w: 2400, h: 800, label: tl('Počítač a tablet', 'Computer and tablet'), shape: '3:1', note: tl('Na šírku. Dôležité veci daj do stredu, názov je cez dolnú ľavú časť (tam nech je pokojné miesto).', 'Landscape. Put the important things in the middle, the title runs over the lower left part (keep it calm there).') },
  mobile: { w: 1200, h: 900, label: tl('Mobil', 'Phone'), shape: '4:3', note: tl('Takmer štvorec. Ak ho nenahráš, mobil ukáže obrázok pre počítač (orezaný zo stredu).', 'Nearly square. If you do not upload one, the phone shows the computer picture (cropped from the centre).') },
};

function heroBlockHtml(s, kind) {
  const k = HERO_KINDS[kind];
  const url = kind === 'desktop' ? s.heroUrl : s.heroMobileUrl;
  return `
    <div class="sa-hero" data-hero="${kind}">
      <div class="sa-hero-pic" style="aspect-ratio:${k.w} / ${k.h}">${url ? `<img src="${escapeHtml(url)}" alt="">` : `<span>${tl('Zatiaľ bez fotky', 'No photo yet')}</span>`}</div>
      <div class="sa-hero-info">
        <strong>${k.label} — ${k.w} × ${k.h} px (${k.shape})</strong>
        <span>${k.note}</span>
        <div class="sa-hero-actions">
          <label class="btn btn-sm btn-outline">${url ? tl('Nahradiť fotku', 'Replace photo') : tl('Nahrať fotku', 'Upload photo')}<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
          ${url ? `<button type="button" class="btn btn-sm btn-danger" data-hero-remove>${tl('Odstrániť', 'Remove')}</button>` : ''}
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
// Formát turnaja; a season: Základné info · Registrácie · Skupiny · Rozpis · Pavúk (its play-off brackets) — and only the chosen one is shown (what is in a tab is loaded
// when it is opened). The form of the basic info is in sections.
const cardTabs = () => (IS_TOURNAMENT
  ? [['info', tl('Základné info', 'Basic info')], ['regs', tl('Registrácie', 'Registrations')], ['assign', tl('Zaradenie do kategórií', 'Category assignment')], ['draw', tl('Formát turnaja', 'Tournament format')]]
  : [['info', tl('Základné info', 'Basic info')], ['regs', tl('Registrácie', 'Registrations')], ['groups', tl('Skupiny', 'Groups')], ['schedule', tl('Rozpis', 'Schedule')], ['brackets', tl('Pavúk', 'Bracket')]]);
const cardTab = new Map(); // season id -> the tab last opened (kept when the list is drawn again)

// The most players that can register (see src/registrationCapacity.js): one for a tournament or a season without categories, one for each category of a season
// where the player chooses a category when registering. maxBody(form) is what the form says, in the shape the server takes; maxMissing(form) is true while
// something that has to be entered is empty (the maximum has to be there whenever the registration is open).
function maxByCategory(form) {
  const open = form.querySelector('[data-cat="OPEN"]');
  return !IS_TOURNAMENT && !(open && open.checked) && !!form.querySelector('[data-catmax]');
}
function maxBody(form) {
  const one = form.querySelector('[data-field="maxPlayers"]');
  if (!maxByCategory(form)) return one ? { maxPlayers: one.value === '' ? null : Number(one.value) } : {};
  const categoryMax = {};
  form.querySelectorAll('[data-catmax]').forEach((el) => {
    const box = form.querySelector(`[data-cat="${el.dataset.catmax}"]`);
    if (box && box.checked) categoryMax[el.dataset.catmax] = el.value === '' ? null : Number(el.value);
  });
  return Object.keys(categoryMax).length ? { categoryMax } : {};
}
function maxMissing(form) {
  const empty = (el) => !el || el.value === '' || !(Number(el.value) >= 1);
  if (!maxByCategory(form)) return empty(form.querySelector('[data-field="maxPlayers"]'));
  return [...form.querySelectorAll('[data-catmax]')].some((el) => { const box = form.querySelector(`[data-cat="${el.dataset.catmax}"]`); return box && box.checked && empty(el); });
}
const MAX_MISSING_TEXT = () => tl('Zadaj maximálny počet hráčov (pre každú kategóriu).', 'Enter the maximum number of players (for every category).');

function seasonCardHtml(s) {
  const byCategory = CATEGORIES.map(([key]) => s.groups.filter((g) => g.category === key).length);
  const field = (label, control, cls = '') => `<label class="sa-field ${cls}">${label}${control}</label>`;
  const input = (name, value, attrs = '') => '<input ' + (/type=/.test(attrs) ? '' : 'type="text" ') + 'data-field="' + name + '" value="' + escapeHtml(value == null ? '' : String(value)) + '" ' + attrs + '>';
  const active = cardTab.get(s.id) || 'info';
  return `
    <details class="card season-admin-card sa-card" data-season="${s.id}" data-playtype="${s.playType || 'SINGLES'}"${openIds.has(s.id) ? ' open' : ''} style="margin-bottom:12px">
      <summary class="sa-sum">
        <svg class="sa-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        <span class="sa-name">${escapeHtml(s.name)}</span>
        ${IS_TOURNAMENT ? `<span class="sa-chip future">${s.playType === 'DOUBLES' ? tl('Štvorhra', 'Doubles') : tl('Dvojhra', 'Singles')}</span>` : ''}
        <span class="sa-dates">${escapeHtml(s.startDate && s.endDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '')}</span>
        <span class="sa-chip ${seasonStatus(s)}">${STATUS_LABEL[seasonStatus(s)]}</span>
        <span class="sa-count">${IS_TOURNAMENT ? '' : `${s.groups.length} ${nounFor(s.groups.length, 'skupina', 'skupiny', 'skupín', 'group', 'groups')} · `}${s.matchCount} ${nounFor(s.matchCount, 'zápas', 'zápasy', 'zápasov', 'match', 'matches')}</span>
      </summary>
      <div class="sa-tabs" role="tablist">
        ${cardTabs().filter(([key]) => !(s.playType === 'DOUBLES' && key === 'assign') && !(s.categories.includes('OPEN') && key === 'assign')).map(([key, label]) => `<button type="button" class="sa-tab${key === active ? ' active' : ''}" data-tab="${key}" role="tab">${label}</button>`).join('')}
        <a class="sa-tab-link" data-public href="/${IS_TOURNAMENT ? 'tournament' : 'season'}/${escapeHtml(s.slug)}" target="_blank" rel="noopener">${IS_TOURNAMENT ? tl('Stránka turnaja', 'Tournament page') : tl('Stránka sezóny', 'Season page')} ↗</a>
      </div>
      <div class="sa-body">
        <div class="season-error" style="color:var(--danger);font-weight:600"></div>

        <div class="sa-panel" data-panel="info"${active === 'info' ? '' : ' hidden'}>
          <form class="season-edit-form">
            <section class="sa-section">
              <h4>${tl('Základné údaje', 'Basic details')}</h4>
              <div class="sa-grid">
                ${field(tl('Názov', 'Name'), input('name', s.name, 'maxlength="120" required'), 'sa-wide')}
                ${field(tl('Začiatok', 'Starts'), input('startDate', s.startDate || '', 'type="date"'))}
                ${field(tl('Koniec', 'Ends'), input('endDate', s.endDate || '', 'type="date"'))}
                ${IS_TOURNAMENT ? field(tl('Miesto', 'Venue'), input('venue', s.venue || '', `maxlength="200" placeholder="${escapeHtml(tl('Adresa alebo klub', 'Address or club'))}"`), 'sa-wide') : ''}
                ${IS_TOURNAMENT && s.playType === 'DOUBLES' ? `<div class="sa-field sa-wide">${tl('Typ turnaja', 'Tournament type')}
                  <div style="padding-top:6px">${tl('Štvorhra — turnaj dvojíc (typ sa po vytvorení nedá zmeniť)', 'Doubles — a tournament of pairs (the type cannot be changed after it is made)')}</div>
                </div>` : ''}
                ${s.playType !== 'DOUBLES' ? `<div class="sa-field sa-full">${tl('Kategórie', 'Categories')}
                  <div class="sa-cats-row">
                    <div class="sa-checks">${CATEGORIES.map(([k, label]) => `<label><input type="checkbox" data-cat="${k}"${s.categories.includes(k) ? ' checked' : ''}${s.categories.includes('OPEN') ? ' disabled' : ''}> ${label}</label>`).join('')}
                      <label><input type="checkbox" data-cat="OPEN"${s.categories.includes('OPEN') ? ' checked' : ''}> ${tl('Bez kategórie', 'No category')}</label></div>
                    <span class="sa-hint">${IS_TOURNAMENT
                      ? tl('Turnaj sa hrá len v zaškrtnutých kategóriách (len tie sa ukážu v „Zaradenie do kategórií“ a v „Formát turnaja“). „Bez kategórie“: hráči sa nezaraďujú, hrá sa jeden pavúk pre všetkých prihlásených.', 'The tournament is played only in the ticked categories (only those show in "Category assignment" and in "Tournament format"). "No category": players are not assigned, one bracket is played for everybody registered.')
                      : tl('Sezóna sa hrá len v zaškrtnutých kategóriách: tie sa ukážu pri registrácii hráčov a v harmonograme. „Bez kategórie“: hráči sa pri registrácii kategóriu nevyberajú a skupiny sezóny sú bez kategórie (hrajú sa ako zápasy kategórie Iné).', 'The season is played only in the ticked categories: they show when players register and in the schedule. "No category": players do not choose a category when they register and the groups of the season have no category (they are played as matches of the category Other).')}</span>
                  </div>
                </div>` : ''}
              </div>
            </section>

            <section class="sa-section">
              <h4>${tl('Štartovné a registrácia', 'Entry fee and registration')}</h4>
              <div class="sa-grid">
                ${field(tl('Štartovné', 'Entry fee'), input('entryFee', s.entryFee || '', `maxlength="40" placeholder="${escapeHtml(tl('napr. 20 €', 'e.g. €20'))}"`))}
                ${field(tl('Ceny pre víťazov', 'Prizes for the winners'), input('prizeMoney', s.prizeMoney || '', 'maxlength="120"'))}
                ${field(tl('Dátum žrebovania', 'Draw date'), input('drawDate', s.drawDate || '', 'type="date"'))}
                <label class="sa-field sa-check"><input type="checkbox" data-field="registrationOpen"${s.registrationOpen ? ' checked' : ''}> ${tl('Registrácia je otvorená', 'Registration is open')}</label>
                <div class="sa-field sa-full" data-max-single${!IS_TOURNAMENT && !s.categories.includes('OPEN') ? ' hidden' : ''}>
                  <label class="sa-field">${s.playType === 'DOUBLES' ? tl('Maximálny počet párov *', 'Maximum number of pairs *') : tl('Maximálny počet hráčov *', 'Maximum number of players *')}${input('maxPlayers', s.maxPlayers || '', `type="number" min="1" max="2000" inputmode="numeric" placeholder="${escapeHtml(tl('napr. 16', 'e.g. 16'))}"`)}</label>
                </div>
                ${!IS_TOURNAMENT ? `<div class="sa-field sa-full" data-max-cats${s.categories.includes('OPEN') ? ' hidden' : ''}>${tl('Maximálny počet hráčov v každej kategórii *', 'Maximum number of players in each category *')}
                  <div class="sa-cats-row">${CATEGORIES.map(([k, label]) => `<label class="sa-field" data-catmax-wrap="${k}"${s.categories.includes(k) ? '' : ' hidden'}>${label}${input('catMax', (s.categoryMax || {})[k] || '', `data-catmax="${k}" type="number" min="1" max="2000" inputmode="numeric" placeholder="${escapeHtml(tl('napr. 16', 'e.g. 16'))}"`)}</label>`).join('')}</div>
                </div>` : ''}
                <span class="sa-hint sa-full">${tl('Maximum zadaj vždy. Keď sa dosiahne, ďalší hráči sa môžu prihlásiť už len ako náhradníci. Ak sa niekto odhlási (alebo ho zmažeš), prvý náhradník automaticky nastúpi do turnaja.', 'Always enter the maximum. When it is reached, the next players can only register as substitutes. If somebody drops out (or you delete them), the first substitute automatically comes into the tournament.')}</span>
                ${field(tl('Odkaz na platbu (Stripe) — tlačidlo „Úhrada štartovného online“', 'Payment link (Stripe) — the button "Pay the entry fee online"'), input('paymentUrl', s.paymentUrl || '', 'maxlength="500" placeholder="https://buy.stripe.com/…"'), 'sa-full')}
              </div>
            </section>

            ${IS_TOURNAMENT ? `<section class="sa-section">
              <h4>${tl('Kurty a pravidlá hrania', 'Courts and playing rules')}</h4>
              <div class="sa-grid">
                ${field(tl('Počet kurtov (Kurt 1 … Kurt n)', 'Number of courts (Court 1 … Court n)'), input('courtCount', s.courtCount || '', `type="number" min="0" max="50" inputmode="numeric" placeholder="${escapeHtml(tl('napr. 4', 'e.g. 4'))}"`))}
                ${field(tl('Max. zápasov hráča za deň', 'Max. matches per player per day'), input('maxMatchesPerDay', s.maxMatchesPerDay || '', `type="number" min="0" max="10" inputmode="numeric" placeholder="${escapeHtml(tl('bez limitu', 'no limit'))}"`))}
              </div>
              <div class="tr-title" style="margin-top:14px">${tl('Plánovanie turnaja', 'Tournament planning')}</div>
              <p class="tr-hint">${tl('Podľa týchto údajov systém skladá rozvrh zápasov na kurty. Rozvrh sa dá ďalej upravovať v časti Rozpis.', 'The system builds the schedule of the matches on the courts from these. The schedule can be edited further in the Schedule part.')}</p>
              <div class="sa-grid">
                ${field(tl('Dĺžka zápasu (min)', 'Match length (min)'), input('matchMinutes', s.planning.matchMinutes, 'type="number" min="15" max="300" step="5" inputmode="numeric"'))}
                ${field(tl('Oddych hráča (min)', 'Player rest (min)'), input('restMinutes', s.planning.restMinutes, 'type="number" min="0" max="240" step="5" inputmode="numeric"'))}
                ${field(tl('Začiatok dňa', 'Start of the day'), input('dayStart', s.planning.dayStart, 'type="time"'))}
                ${field(tl('Koniec dňa', 'End of the day'), input('dayEnd', s.planning.dayEnd, 'type="time"'))}
                <label class="sa-field sa-check"><input type="checkbox" data-field="autoSchedule"${s.planning.autoSchedule ? ' checked' : ''}> ${tl('Rozvrh skladá systém sám', 'The system builds the schedule itself')}</label>
              </div>
            </section>` : ''}

            <section class="sa-section" data-rules-section${IS_TOURNAMENT || s.scoring ? '' : ' data-rules-default'}>
              <h4>${tl('Bodovanie a podmienky', 'Scoring and tie-breaks')}</h4>
              ${IS_TOURNAMENT || s.scoring ? '' : `<p class="tr-hint">${tl('Kým tu nič nezmeníte, platí štandardné bodovanie a poradie ligy BLTA.', 'Until you change something here, the standard scoring and order of the BLTA league apply.')}</p>`}
              ${TournamentRules.html(`season-${s.id}`, { scoring: s.scoring, tiebreakers: s.tiebreakers })}
            </section>

            <section class="sa-section">
              <h4>${tl('Vzhľad stránky', 'Look of the page')}</h4>
              <div class="sa-grid">
                ${field(tl('Odkaz na galériu', 'Gallery link'), input('galleryUrl', s.galleryUrl || '', 'maxlength="500" placeholder="https://…"'), 'sa-wide')}
                ${field(tl('Logo (odkaz na obrázok, napr. /img/seasons/autumn.png)', 'Logo (link to a picture, e.g. /img/seasons/autumn.png)'), input('logoUrl', s.logoUrl || '', 'maxlength="300"'), 'sa-wide')}
              </div>
              <div class="sa-field sa-full" style="margin-top:12px" data-logo-block>${tl('Logo — nahranie', 'Logo — upload')} <span class="sa-hint">— ${tl('vyber logo z počítača alebo z knižnice (Backend → Média). Nahrá sa hneď, netreba Uložiť. PNG, JPG alebo WebP do 8 MB.', 'pick a logo from your computer or from the library (Backend → Media). It uploads at once, no need to Save. PNG, JPG or WebP up to 8 MB.')}</span>
                <div class="sa-logo-row">
                  <div class="sa-logo-pic" data-logo-pic>${s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" alt="">` : `<span>${tl('Zatiaľ bez loga', 'No logo yet')}</span>`}</div>
                  <div class="sa-hero-actions">
                    <label class="btn btn-sm btn-outline"><span data-logo-label>${s.logoUrl ? tl('Nahradiť logo', 'Replace logo') : tl('Nahrať logo', 'Upload logo')}</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
                    <button type="button" class="btn btn-sm btn-danger" data-logo-remove${s.logoUrl ? '' : ' hidden'}>${tl('Odstrániť', 'Remove')}</button>
                    <span class="sa-hero-msg" data-logo-msg></span>
                  </div>
                </div>
              </div>
              <div class="sa-field sa-full" style="margin-top:12px">${tl('Hero fotka stránky', 'Hero photo of the page')} <span class="sa-hint">— ${IS_TOURNAMENT ? tl('veľká fotka hore na stránke, názov turnaja je cez jej dolnú časť. Nahrá sa hneď, netreba Uložiť. JPG, PNG alebo WebP do 8 MB.', 'a big photo at the top of the page, the name of the tournament runs over its lower part. It uploads at once, no need to Save. JPG, PNG or WebP up to 8 MB.') : tl('veľká fotka hore na stránke, názov sezóny je cez jej dolnú časť. Nahrá sa hneď, netreba Uložiť. JPG, PNG alebo WebP do 8 MB.', 'a big photo at the top of the page, the name of the season runs over its lower part. It uploads at once, no need to Save. JPG, PNG or WebP up to 8 MB.')}</span>
                <div class="sa-hero-grid">${heroBlockHtml(s, 'desktop')}${heroBlockHtml(s, 'mobile')}</div>
              </div>
              <div class="sa-field sa-full" style="margin-top:12px">${tl('Popis', 'Description')} <span class="sa-hint">— ${tl('riadok „Názov: hodnota“ sa na stránke zobrazí ako dlaždica', 'a line "Name: value" is shown on the page as a tile')}</span>
                <div class="rte-toolbar">
                  <button type="button" data-cmd="bold" title="${escapeHtml(tl('Tučné', 'Bold'))}"><b>B</b></button>
                  <button type="button" data-cmd="italic" title="${escapeHtml(tl('Kurzíva', 'Italic'))}"><i>I</i></button>
                  <button type="button" data-cmd="underline" title="${escapeHtml(tl('Podčiarknuté', 'Underline'))}"><u>U</u></button>
                  <button type="button" data-cmd="heading" title="${escapeHtml(tl('Nadpis', 'Heading'))}">H</button>
                  <button type="button" data-cmd="insertUnorderedList" title="${escapeHtml(tl('Odrážky', 'Bulleted list'))}">• ${tl('Zoznam', 'List')}</button>
                  <button type="button" data-cmd="insertOrderedList" title="${escapeHtml(tl('Číslovanie', 'Numbered list'))}">1. ${tl('Zoznam', 'List')}</button>
                  <button type="button" data-cmd="link" title="${escapeHtml(tl('Odkaz', 'Link'))}">${tl('Odkaz', 'Link')}</button>
                  <button type="button" data-cmd="removeFormat" title="${escapeHtml(tl('Zrušiť formátovanie', 'Remove formatting'))}">${tl('Vyčistiť', 'Clear')}</button>
                </div>
                <div class="rte" contenteditable="true" data-rte>${richText(s.info)}</div>
              </div>
            </section>

            <div class="sa-actions">
              <button type="submit" class="btn btn-sm btn-primary">${tl('Uložiť', 'Save')}</button>
              <span style="flex:1"></span>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-season">${IS_TOURNAMENT ? tl('Zmazať turnaj', 'Delete tournament') : tl('Zmazať sezónu', 'Delete season')}</button>
            </div>
          </form>
        </div>

        <div class="sa-panel" data-panel="regs"${active === 'regs' ? '' : ' hidden'}><div class="season-regs-list"></div></div>
        ${IS_TOURNAMENT ? `<div class="sa-panel" data-panel="assign"${active === 'assign' ? '' : ' hidden'}><div class="season-assign"></div></div>
        <div class="sa-panel" data-panel="draw"${active === 'draw' ? '' : ' hidden'}><div class="season-draw"></div></div>` : `<div class="sa-panel" data-panel="groups"${active === 'groups' ? '' : ' hidden'}>
          <section class="sa-section">
          <h4>${tl('Skupiny', 'Groups')}</h4>
          <div class="sa-hint" style="margin:0 0 14px">${s.matchCount} ${tl('označených', 'tagged')} ${nounFor(s.matchCount, 'zápas', 'zápasy', 'zápasov', 'match', 'matches')} · ${s.groups.length} ${nounFor(s.groups.length, 'skupina', 'skupiny', 'skupín', 'group', 'groups')}
            (${byCategory[0]} Elite, ${byCategory[1]} Next Gen, ${byCategory[2]} Novice) — ${tl('každá skupina je jedna tabuľka', 'each group is one standings table')}</div>
          <div class="season-groups">${s.groups.length ? s.groups.map((g) => groupRowHtml(g, s)).join('') : `<div class="empty-state" style="padding:12px 0">${tl('Zatiaľ žiadne skupiny.', 'No groups yet.')}</div>`}</div>
          </section>
          <section class="sa-section">
          <h4>${tl('Pridať skupinu', 'Add a group')}</h4>
          <form class="add-group-form" style="display:flex;gap:12px;flex-wrap:wrap">
            <input type="text" data-field="name" maxlength="80" placeholder="${escapeHtml(tl('Nová skupina, napr. Babolat', 'New group, e.g. Babolat'))}" required style="flex:1;min-width:160px;${inputStyle}">
            <select data-field="category" required style="${inputStyle}">
              <option value="">${tl('Kategória…', 'Category…')}</option>
              ${categoryOptions('', true, s)}
            </select>
            <button type="submit" class="btn btn-sm btn-primary">${tl('Pridať skupinu', 'Add group')}</button>
          </form>
          </section>
        </div>
        <div class="sa-panel" data-panel="schedule"${active === 'schedule' ? '' : ' hidden'}>${scheduleSectionHtml()}</div>
        <div class="sa-panel" data-panel="brackets"${active === 'brackets' ? '' : ' hidden'}><div class="season-brackets"></div></div>`}
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
    listEl.innerHTML = `<div class="card"><div class="empty-state">${IS_TOURNAMENT ? tl('Zatiaľ žiadne turnaje.', 'No tournaments yet.') : tl('Zatiaľ žiadne sezóny.', 'No seasons yet.')}</div></div>`;
    return;
  }
  listEl.innerHTML = `<div class="sa-bar"><button type="button" data-fold="open">${tl('Rozbaliť všetko', 'Expand all')}</button><span>·</span><button type="button" data-fold="close">${tl('Zbaliť všetko', 'Collapse all')}</button></div>` + seasons.map(seasonHtml).join('');
  listEl.querySelectorAll('.season-admin-card').forEach(wireSeason);
  // a link from the public page of an event (#season-<id>): that card is open and in view
  const wanted = /^#season-(\d+)$/.exec(window.location.hash || '');
  const wantedCard = wanted && listEl.querySelector(`.season-admin-card[data-season="${wanted[1]}"]`);
  if (wantedCard) {
    wantedCard.open = true;
    wantedCard.style.scrollMarginTop = 'calc(var(--topbar-h, 56px) + 8px)';
    wantedCard.scrollIntoView({ block: 'start' });
    setTimeout(() => wantedCard.scrollIntoView({ block: 'start' }), 600); // (its tabs fill in a moment later and move the page)
  }
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
  const isDoubles = card.dataset.playtype === 'DOUBLES'; // a doubles tournament is entered as pairs, with no categories
  const season = seasons.find((s) => s.id === id);
  const errorEl = card.querySelector('.season-error');
  const fail = (err) => { errorEl.textContent = err.message; };
  card.addEventListener('toggle', () => {
    if (card.open) openIds.add(id); else openIds.delete(id);
    saveOpenIds();
  });

  // "Bez kategórie" switches the three categories off (and back on when it is unticked): a tournament is played in some of the categories or in none
  const editForm = card.querySelector('.season-edit-form'); // (only the boxes of this form: the draw tab has controls with a data-cat of their own)
  const rulesSection = editForm.querySelector('[data-rules-section]');
  if (rulesSection) {
    TournamentRules.mount(rulesSection);
    // a season that has not chosen its rules keeps the league's own way until the admin changes them here
    rulesSection.addEventListener('click', (e) => { if (e.target.closest('.tr-move')) rulesSection.dataset.touched = '1'; });
    rulesSection.addEventListener('change', () => { rulesSection.dataset.touched = '1'; });
  }
  // the maximum for each category is asked for the ticked categories; "No category" asks for one maximum for everybody
  const syncMaxFields = () => {
    const none = editForm.querySelector('[data-cat="OPEN"]');
    const single = editForm.querySelector('[data-max-single]');
    const cats = editForm.querySelector('[data-max-cats]');
    if (single && cats) { single.hidden = !(none && none.checked); cats.hidden = !!(none && none.checked); }
    editForm.querySelectorAll('[data-catmax-wrap]').forEach((wrap) => {
      const box = editForm.querySelector(`[data-cat="${wrap.dataset.catmaxWrap}"]`);
      wrap.hidden = !(box && box.checked);
    });
  };
  editForm.querySelectorAll('[data-cat]').forEach((box) => box.addEventListener('change', syncMaxFields));
  const noCategoryBox = editForm.querySelector('[data-cat="OPEN"]');
  if (noCategoryBox) {
    noCategoryBox.addEventListener('change', () => {
      editForm.querySelectorAll('[data-cat]:not([data-cat="OPEN"])').forEach((box) => {
        box.disabled = noCategoryBox.checked;
        if (noCategoryBox.checked) box.checked = false;
      });
    });
  }

  card.querySelector('.season-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const f = (name) => e.target.querySelector(`[data-field="${name}"]`).value;
    try {
      // a season is played in at least one category (an empty choice would mean "all" to the server)
      if (!IS_TOURNAMENT && e.target.querySelectorAll('[data-cat]').length && ![...e.target.querySelectorAll('[data-cat]')].some((b) => b.checked)) throw new Error(tl('Vyber aspoň jednu kategóriu.', 'Choose at least one category.'));
      if (e.target.querySelector('[data-field="registrationOpen"]').checked && maxMissing(e.target)) throw new Error(MAX_MISSING_TEXT());
      await api(`/seasons/${id}`, { method: 'PATCH', body: { name: f('name').trim(), startDate: f('startDate') || null, endDate: f('endDate') || null, entryFee: f('entryFee'), prizeMoney: f('prizeMoney'), paymentUrl: f('paymentUrl'), logoUrl: f('logoUrl'), registrationOpen: e.target.querySelector('[data-field="registrationOpen"]').checked, ...maxBody(e.target), drawDate: f('drawDate') || null, galleryUrl: f('galleryUrl'), info: e.target.querySelector('[data-rte]').innerHTML, ...(() => { const box = e.target.querySelector('[data-rules-section]'); return box.hasAttribute('data-rules-default') && !box.dataset.touched ? {} : TournamentRules.read(box); })(), ...(IS_TOURNAMENT ? { venue: f('venue'), courtCount: f('courtCount') === '' ? 0 : Number(f('courtCount')), maxMatchesPerDay: f('maxMatchesPerDay') === '' ? 0 : Number(f('maxMatchesPerDay')), matchMinutes: Number(f('matchMinutes')), restMinutes: Number(f('restMinutes')), dayStart: f('dayStart'), dayEnd: f('dayEnd'), autoSchedule: e.target.querySelector('[data-field="autoSchedule"]').checked } : {}), ...(() => { const boxes = [...e.target.querySelectorAll('[data-cat]')]; return boxes.length ? { categories: boxes.filter((b) => b.checked).map((b) => b.dataset.cat) } : {}; })() } });
      toast(tl('Uložené', 'Saved'));
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
        m.textContent = tl('Nahrávam…', 'Uploading…');
        try {
          const blob = await cropHero(file, spec.w, spec.h);
          const body = new FormData();
          body.append('photo', blob, 'hero.jpg');
          const res = await fetch(`/api/seasons/${id}/hero?kind=${kind}`, { method: 'POST', body });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || tl(`Požiadavka zlyhala (${res.status})`, `Request failed (${res.status})`));
          toast(tl('Fotka nahraná', 'Photo uploaded'));
          done(data);
        } catch (err) { m.textContent = err.message; m.style.color = 'var(--danger)'; }
      });
      const remove = el.querySelector('[data-hero-remove]');
      if (remove) remove.addEventListener('click', async () => {
        try { done(await api(`/seasons/${id}/hero?kind=${kind}`, { method: 'DELETE' })); toast(tl('Fotka odstránená', 'Photo removed')); } catch (err) { el.querySelector('.sa-hero-msg').textContent = err.message; }
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
      pic.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="">` : `<span>${tl('Zatiaľ bez loga', 'No logo yet')}</span>`;
      urlField.value = url || '';
      removeBtn.hidden = !url;
      logoBlock.querySelector('[data-logo-label]').textContent = url ? tl('Nahradiť logo', 'Replace logo') : tl('Nahrať logo', 'Upload logo');
      const i = seasons.findIndex((x) => x.id === id);
      if (i >= 0) seasons[i] = { ...seasons[i], logoUrl: url || '' };
      season.logoUrl = url || '';
    };
    urlField.addEventListener('input', () => { pic.innerHTML = urlField.value.trim() ? `<img src="${escapeHtml(urlField.value.trim())}" alt="">` : `<span>${tl('Zatiaľ bez loga', 'No logo yet')}</span>`; });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      msg.style.color = ''; msg.textContent = tl('Nahrávam…', 'Uploading…');
      try {
        const body = new FormData();
        body.append('photo', file, file.name || 'logo.png');
        const res = await fetch(`/api/seasons/${id}/logo`, { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || tl(`Požiadavka zlyhala (${res.status})`, `Request failed (${res.status})`));
        show(data.logoUrl);
        msg.textContent = '';
        toast(tl('Logo nahrané', 'Logo uploaded'));
      } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--danger)'; }
      fileInput.value = '';
    });
    removeBtn.addEventListener('click', async () => {
      try { await api(`/seasons/${id}/logo`, { method: 'DELETE' }); show(''); toast(tl('Logo odstránené', 'Logo removed')); } catch (err) { msg.textContent = err.message; msg.style.color = 'var(--danger)'; }
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
        const url = prompt(tl('Adresa odkazu (https://…)', 'Link address (https://…)'));
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

  // "Registration open" takes effect the moment it is ticked or unticked, without waiting for "Save"
  const openBox = card.querySelector('[data-field="registrationOpen"]');
  openBox.addEventListener('change', async () => {
    try {
      // the maximum goes along (what is typed in the form), and has to be there to open
      if (openBox.checked && maxMissing(editForm)) { openBox.checked = false; throw new Error(MAX_MISSING_TEXT()); }
      await api(`/seasons/${id}`, { method: 'PATCH', body: { registrationOpen: openBox.checked, ...(openBox.checked ? maxBody(editForm) : {}) } });
      season.registrationOpen = openBox.checked;
      toast(openBox.checked ? tl('Registrácia otvorená', 'Registration opened') : tl('Registrácia zatvorená', 'Registration closed'));
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
    return `
      <section class="sa-section">
        <h4>${isDoubles ? tl('Pridať pár', 'Add a pair') : tl('Pridať hráča', 'Add a player')}</h4>
        <form class="reg-add sa-grid">
          <label class="sa-field sa-wide">${isDoubles ? tl('Hráč', 'Player') : tl('Meno hráča', 'Name of the player')}
            <div class="autocomplete"><input type="text" data-ra="player" id="reg-player-${id}" placeholder="${escapeHtml(tl('Začni písať meno alebo priezvisko…', 'Start typing a name or surname…'))}" autocomplete="off"><div class="autocomplete-list" id="reg-player-list-${id}"></div></div>
          </label>
          ${isDoubles ? `<label class="sa-field sa-wide">${tl('Partner', 'Partner')}
            <input type="text" data-ra="partner" list="reg-partner-names-${id}" maxlength="80" placeholder="${escapeHtml(tl('Meno partnera', 'Name of the partner'))}" autocomplete="off">
            <datalist id="reg-partner-names-${id}">${players.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join('')}</datalist>
          </label>` : `<label class="sa-field">${tl('Kategória', 'Category')}
            <select data-ra="category"><option value="">${IS_TOURNAMENT || seasonWithoutCategories(seasons.find((x) => x.id === id)) ? tl('Bez kategórie', 'No category') : tl('Kategória…', 'Category…')}</option>${categoryOptions('')}</select>
          </label>`}
          <label class="sa-field">${tl('Telefón', 'Phone')}
            <input type="text" data-ra="phone" maxlength="20" placeholder="${escapeHtml(tl('z profilu', 'from the profile'))}">
          </label>
          <label class="sa-field sa-wide">${tl('E-mail', 'Email')}
            <input type="text" data-ra="email" maxlength="120" placeholder="${escapeHtml(tl('z profilu', 'from the profile'))}">
          </label>
          <div><button type="submit" class="btn btn-sm btn-primary">${isDoubles ? tl('Pridať pár', 'Add pair') : tl('Pridať hráča', 'Add player')}</button></div>
        </form>
        <div class="reg-add-hint sa-hint" style="min-height:18px;margin-top:14px"></div>
      </section>`;
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
      if (!isDoubles) field('category').value = chosen ? profileCategory(chosen.category) : '';
      if (!chosen) { say(''); return; }
      const missing = [chosen.phone ? '' : tl('telefón', 'phone'), chosen.email ? '' : tl('e-mail', 'email'), IS_TOURNAMENT || profileCategory(chosen.category) ? '' : tl('kategória', 'category')].filter(Boolean);
      say(missing.length ? tl(`V profile zatiaľ chýba: ${missing.join(', ')} — doplň to tu (zapíše sa len do tejto registrácie).`, `No ${missing.join(', ')} in the profile yet — fill ${missing.length === 1 ? 'it' : 'them'} in here (only this registration gets it).`) : tl('Telefón, e-mail a kategória sa preberajú z profilu.', 'Phone, email and category are taken from the profile.'));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!chosen) { say(tl('Vyber hráča zo zoznamu.', 'Choose a player from the list.'), true); return; }
      // a tournament entry may have no category: the empty choice is sent as it is; a league season takes the profile's when none is picked
      const body = { playerId: chosen.id, category: isDoubles ? '' : (IS_TOURNAMENT ? field('category').value : (field('category').value || undefined)) };
      if (isDoubles) {
        const partner = field('partner').value.trim();
        if (!partner) { say(tl('Zadaj partnera páru.', 'Enter the partner of the pair.'), true); return; }
        body.partner = partner;
      }
      if (field('phone').value.trim() !== (chosen.phone || '')) body.phone = field('phone').value;
      if (field('email').value.trim() !== (chosen.email || '')) body.email = field('email').value;
      try {
        await api(`/seasons/${id}/registrations/admin`, { method: 'POST', body });
        toast(tl(`Pridané: ${chosen.name}`, `${chosen.name} added`));
        await loadRegs();
        regsList.querySelector('[data-ra="player"]').focus();
      } catch (err) { say(err.message, true); }
    });
  }

  let editingReg = null; // the registration being edited (its row shows a small form)
  let regFilter = 'all'; // all | unpaid | paid

  // the money of the registrations: how many paid, what is collected and what is still due (when the entry fee is a number)
  const feeAmount = (() => { const m = String(season.entryFee || '').replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; })();
  const money = (n) => `${Math.round(n * 100) / 100} €`;
  function payBarHtml(rows) {
    const paid = rows.filter((r) => r.paid).length;
    const unpaid = rows.length - paid;
    const tile = (label, value, tone) => `<div class="sa-tile"><div class="sa-tile-l">${label}</div><div class="sa-tile-v"${tone ? ` style="color:${tone}"` : ''}>${value}</div></div>`;
    const chip = (key, label, n) => `<button type="button" class="sg-link" data-reg-filter="${key}" style="${regFilter === key ? 'font-weight:800;text-decoration:underline' : ''}">${label} (${n})</button>`;
    const withMail = rows.filter((r) => !r.paid && r.email).length;
    // how full the event is: the maximum, who is in and who waits (substitutes)
    const waiting = rows.filter((r) => r.substitute).length;
    const subNoun = (n) => nounFor(n, 'náhradník', 'náhradníci', 'náhradníkov', 'substitute', 'substitutes');
    const capLine = (() => {
      if (!IS_TOURNAMENT && !season.categories.includes('OPEN')) {
        return CATEGORIES.filter(([k]) => season.categories.includes(k)).map(([k, label]) => {
          const mine = rows.filter((r) => r.category === k);
          const w = mine.filter((r) => r.substitute).length;
          const max = (season.categoryMax || {})[k];
          return `${label}: ${mine.length - w}${max ? ` / ${max}` : ''}${w ? ` (+${w} ${subNoun(w)})` : ''}`;
        }).join(' · ');
      }
      if (!season.maxPlayers && !waiting) return '';
      return `${tl('Obsadené', 'Filled')}: ${rows.length - waiting}${season.maxPlayers ? ` / ${season.maxPlayers}` : ''}${waiting ? ` · ${waiting} ${subNoun(waiting)}` : ''}`;
    })();
    return `
      <section class="sa-section">
        <h4>${tl('Prehľad registrácií', 'Registrations overview')}</h4>
        <div class="sa-tiles">
          ${tile(tl('Registrovaní', 'Registered'), rows.length)}${tile(tl('Zaplatili', 'Paid'), paid, 'var(--green-light)')}${tile(tl('Nezaplatili', 'Unpaid'), unpaid, unpaid ? '#ff8a7a' : '')}
          ${feeAmount !== null ? tile(tl('Vybrané', 'Collected'), money(feeAmount * paid), 'var(--green-light)') + tile(tl('Chýba', 'Missing'), money(feeAmount * unpaid), unpaid ? '#ff8a7a' : '') : ''}
        </div>
        ${capLine ? `<div class="sa-capline">${escapeHtml(capLine)}</div>` : ''}
        <div class="sa-filters">
          ${chip('all', tl('Všetci', 'All'), rows.length)}${chip('unpaid', tl('Nezaplatili', 'Unpaid'), unpaid)}${chip('paid', tl('Zaplatili', 'Paid'), paid)}${waiting ? chip('sub', tl('Náhradníci', 'Substitutes'), waiting) : ''}
          <span style="flex:1"></span>
          <button type="button" class="btn btn-sm btn-primary" data-remind-all${withMail ? '' : ' disabled'} title="${escapeHtml(tl('Pošle e-mail s pripomienkou platby všetkým, ktorí nezaplatili a majú e-mail', 'Sends an e-mail reminding about the payment to everybody who has not paid and has an e-mail'))}">${tl('Pripomenúť nezaplateným', 'Remind the unpaid')} (${withMail})</button>
          <a class="btn btn-sm btn-outline" href="/api/seasons/${id}/registrations.csv">${tl('Stiahnuť CSV', 'Download CSV')}</a>
        </div>
      </section>`;
  }
  const remindText = (r) => tl(`Odoslané: ${r.sent}${r.noEmail ? `, bez e-mailu: ${r.noEmail}` : ''}${r.recent ? `, nedávno pripomenuté: ${r.recent}` : ''}${r.failed ? `, zlyhalo: ${r.failed}` : ''}`, `Sent: ${r.sent}${r.noEmail ? `, no e-mail: ${r.noEmail}` : ''}${r.recent ? `, reminded recently: ${r.recent}` : ''}${r.failed ? `, failed: ${r.failed}` : ''}`);
  function regEditHtml(r) {
    return `
        <div class="sa-reg-edit" data-reg="${r.id}">
          <strong>${escapeHtml(r.name)}</strong>
          <div class="sa-grid" style="margin-top:14px">
            ${isDoubles ? `<label class="sa-field sa-wide">${tl('Partner', 'Partner')}
              <input type="text" data-re="partner" maxlength="80" value="${escapeHtml(r.partnerName || '')}">
            </label>` : `<label class="sa-field">${tl('Kategória', 'Category')}
              <select data-re="category">${IS_TOURNAMENT || seasonWithoutCategories(seasons.find((x) => x.id === id)) ? `<option value="">${tl('Bez kategórie', 'No category')}</option>` : ''}${categoryOptions(r.category)}</select>
            </label>`}
            <label class="sa-field">${tl('Telefón', 'Phone')}
              <input type="text" data-re="phone" maxlength="20" value="${escapeHtml(r.phone || '')}">
            </label>
            <label class="sa-field sa-wide">${tl('E-mail', 'Email')}
              <input type="text" data-re="email" maxlength="120" value="${escapeHtml(r.email || '')}">
            </label>
            <label class="sa-field sa-full">${tl('Poznámka', 'Note')}
              <textarea data-re="note" rows="2" maxlength="500">${escapeHtml(r.note || '')}</textarea>
            </label>
          </div>
          <div class="sa-actions" style="margin-top:16px">
            <button type="button" class="btn btn-sm btn-primary" data-reg-save>${tl('Uložiť', 'Save')}</button>
            <button type="button" class="btn btn-sm btn-outline" data-reg-cancel>${tl('Zrušiť', 'Cancel')}</button>
          </div>
        </div>`;
  }

  async function loadRegs() {
    try {
      const rows = await api(`/seasons/${id}/registrations`);
      const unpaidCount = rows.filter((r) => !r.paid).length;
      regsBtn.textContent = `${tl('Registrácie', 'Registrations')} (${rows.length}${unpaidCount ? ` · ${unpaidCount} ${tl('nezapl.', 'unpaid')}` : ''})`;
      const players = await loadAdminPlayers();
      const shown = rows.filter((r) => regFilter === 'all' || (regFilter === 'sub' ? r.substitute : regFilter === 'paid' ? r.paid : !r.paid));
      const regRow = (r) => (r.id === editingReg ? regEditHtml(r) : `
        <div class="sa-reg-row" data-reg="${r.id}">
          <div style="flex:1;min-width:220px">
            <strong>${escapeHtml(r.name)}${isDoubles && r.partnerName ? ` / ${escapeHtml(r.partnerName)}` : ''}</strong> ${isDoubles ? '' : `<span class="sa-chip future">${escapeHtml(r.category ? catLabel(r.category) : tl('Bez kategórie', 'No category'))}</span>`}${r.playerId ? '' : ` <span style="font-size:11px;color:var(--gray)">${tl('nové meno', 'new name')}</span>`}${r.substitute ? ` <span class="sa-chip now" title="${escapeHtml(tl('Maximum je naplnené: nastúpi, keď sa niekto odhlási', 'The maximum is reached: comes in when somebody drops out'))}">${tl('Náhradník č.', 'Substitute #')}${r.substitutePosition}</span>` : ''}
            <div style="font-size:12px;color:var(--gray);margin-top:6px">${r.phone || r.email ? `${escapeHtml(r.phone)} · <a href="mailto:${escapeHtml(r.email)}" style="color:var(--orange)">${escapeHtml(r.email)}</a>` : tl('bez kontaktných údajov', 'no contact details')} · ${escapeHtml(fmtDate(r.createdAt.slice(0, 10)))}</div>
            ${r.note ? `<div style="font-size:13px;margin-top:6px;white-space:pre-wrap"><strong>${tl('Poznámka', 'Note')}:</strong> ${escapeHtml(r.note)}</div>` : ''}
          </div>
          ${r.remindedAt ? `<span style="font-size:11px;color:var(--gray)">${tl('pripomenuté', 'reminded')} ${escapeHtml(fmtDate(r.remindedAt))}</span>` : ''}
          ${!r.paid && r.email ? `<button type="button" class="sg-link" data-reg-remind title="${escapeHtml(tl('Pošle e-mail s pripomienkou platby', 'Sends an e-mail reminding about the payment'))}">✉ ${tl('Pripomenúť', 'Remind')}</button>` : ''}
          <button type="button" class="sg-link" data-reg-edit title="${escapeHtml(tl('Zmeniť kategóriu, telefón, e-mail alebo poznámku', 'Change the category, phone, e-mail or note'))}">${tl('Upraviť', 'Edit')}</button>
          <button type="button" class="sg-link" data-reg-paid="${r.paid ? 0 : 1}">${r.paid ? tl('Zaplatené ✓', 'Paid ✓') : tl('Nezaplatené', 'Not paid')}</button>
          <button type="button" class="sg-x" data-reg-del title="${escapeHtml(tl('Zmazať túto registráciu', 'Delete this registration'))}">&times;</button>
        </div>`);
      regsList.innerHTML = payBarHtml(rows) + addPlayerFormHtml(players, rows) + `
        <section class="sa-section">
          <h4>${tl('Prihlásení', 'Registered')} (${shown.length})</h4>
          ${shown.length ? shown.map(regRow).join('') : `<div class="sg-empty">${rows.length ? tl('Nikto v tomto filtri.', 'Nobody in this filter.') : tl('Zatiaľ žiadne registrácie.', 'No registrations yet.')}</div>`}
        </section>`;
      wireAddPlayerForm(players);
    } catch (err) { fail(err); }
  }
  // the tabs under the name (what is in a tab is loaded each time it is opened)
  {
    const assignHost = card.querySelector('.season-assign');
    const drawHost = card.querySelector('.season-draw');
    const bracketsHost = card.querySelector('.season-brackets');
    const openers = IS_TOURNAMENT ? {
      regs: () => loadRegs(),
      assign: () => openAssignPanel(assignHost, id, () => {}, season.categories),
      draw: () => openDrawPanel(drawHost, id),
    } : {
      regs: () => loadRegs(),
      // the play-off brackets of the season: one panel is mounted at a time (the fields of the form have ids), so the others are emptied
      brackets: async () => {
        document.querySelectorAll('.season-brackets').forEach((el) => { if (el !== bracketsHost) el.innerHTML = ''; });
        if (window.mountBracketAdmin) await window.mountBracketAdmin(bracketsHost, id);
      },
    };
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
    api(`/seasons/${id}/registrations`).then((rows) => { regsBtn.textContent = `${tl('Registrácie', 'Registrations')} (${rows.length})`; }).catch(() => {});
  }
  regsList.addEventListener('click', async (e) => {
    try {
      const filterBtn = e.target.closest('[data-reg-filter]');
      if (filterBtn) { regFilter = filterBtn.dataset.regFilter; await loadRegs(); return; }
      if (e.target.closest('[data-remind-all]')) {
        if (!confirm(tl('Poslať e-mail s pripomienkou platby všetkým, ktorí nezaplatili a majú e-mail?', 'Send an e-mail reminding about the payment to everybody who has not paid and has an e-mail?'))) return;
        const res = await api(`/seasons/${id}/registrations/remind`, { method: 'POST', body: {} });
        toast(remindText(res));
        await loadRegs();
        return;
      }
    } catch (err) { fail(err); return; }
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
        await api(`/seasons/registrations/${rid}`, { method: 'PATCH', body: { ...(isDoubles ? { partner: val('partner') } : { category: val('category') }), phone: val('phone'), email: val('email'), note: val('note') } });
        editingReg = null;
        toast(tl('Registrácia uložená', 'Registration saved'));
        await loadRegs();
      } else if (e.target.closest('[data-reg-paid]')) {
        await api(`/seasons/registrations/${rid}`, { method: 'PATCH', body: { paid: e.target.closest('[data-reg-paid]').dataset.regPaid === '1' } });
        await loadRegs();
      } else if (e.target.closest('[data-reg-remind]')) {
        const res = await api(`/seasons/${id}/registrations/remind`, { method: 'POST', body: { ids: [Number(rid)] } });
        toast(res.sent ? tl('Pripomienka odoslaná', 'Reminder sent') : (res.recent ? tl('Dnes už bola pripomenutá', 'Already reminded today') : (res.failed ? tl('E-mail sa nepodarilo odoslať', 'The e-mail could not be sent') : tl('Bez e-mailu', 'No e-mail'))));
        await loadRegs();
      } else if (e.target.closest('[data-reg-del]')) {
        if (!confirm(tl('Zmazať túto registráciu?', 'Delete this registration?'))) return;
        await api(`/seasons/registrations/${rid}`, { method: 'DELETE' });
        await loadRegs();
      }
    } catch (err) { fail(err); }
  });

  card.querySelector('[data-action="delete-season"]').addEventListener('click', async () => {
    const extra = season.matchCount ? tl(` Zápasy (${season.matchCount}) stratia sezónu a skupinu (samotné zápasy ostanú).`, ` ${season.matchCount} matches will lose their season and group (the matches stay).`) : '';
    // a tournament goes with everything that belongs to it: its matches, brackets, registrations
    if (IS_TOURNAMENT || CLUB) {
      const matchesEn = season.matchCount ? `ALL ${season.matchCount} of its matches (with their results and the ranking points they gave)` : 'its brackets';
      const matchesSk = season.matchCount ? `všetkými ${season.matchCount} zápasmi (s ich výsledkami a bodmi do rebríčka, ktoré dali), ` : '';
      if (!confirm(tl(`Zmazať ${IS_TOURNAMENT ? 'turnaj' : 'sezónu'} „${season.name}“ spolu s ${matchesSk}registráciami a pavúkmi?\n\nTo sa nedá vrátiť späť.`, `Delete the ${IS_TOURNAMENT ? 'tournament' : 'season'} "${season.name}" together with ${matchesEn}, its registrations and brackets?\n\nThis cannot be undone.`))) return;
    } else if (!confirm(tl(`Zmazať „${season.name}“ a jej ${season.groups.length} ${nounFor(season.groups.length, 'skupinu', 'skupiny', 'skupín', '', '')}?${extra}`, `Delete "${season.name}" and its ${season.groups.length} groups?${extra}`))) return;
    try {
      const res = await api(`/seasons/${id}${IS_TOURNAMENT || CLUB ? '?withMatches=1' : ''}`, { method: 'DELETE' });
      toast(IS_TOURNAMENT ? tl(`Turnaj zmazaný (zápasov: ${res.deletedMatches || 0})`, `Tournament deleted (${res.deletedMatches || 0} matches)`) : tl('Sezóna zmazaná', 'Season deleted'));
      if (CLUB) { window.location.href = siteUrl(season.organisation ? `/community/${encodeURIComponent(season.organisation.slug)}#events` : '/communities'); return; }
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
      toast(tl('Skupina pridaná', 'Group added'));
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
        toast(tl('Skupina uložená', 'Group saved'));
        await load();
      } catch (err) { fail(err); }
    });
    row.querySelector('[data-action="delete-group"]').addEventListener('click', async () => {
      const extra = group.matchCount ? tl(` Zápasy (${group.matchCount}) stratia skupinu (v sezóne ostanú).`, ` ${group.matchCount} matches will lose their group (they stay in the season).`) : '';
      if (!confirm(tl(`Zmazať skupinu „${group.name}“ a jej zoznam hráčov?${extra}`, `Delete group "${group.name}" and its player list?${extra}`))) return;
      try {
        await api(`/seasons/groups/${groupId}`, { method: 'DELETE' });
        toast(tl('Skupina zmazaná', 'Group deleted'));
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
      toast(tl('Hráč pridaný', 'Player added'));
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
    const title = d.code === 'SIMILAR_PLAYERS' ? tl(`Je „${escapeHtml(d.typed)}“ jeden z týchto hráčov?`, `Is “${escapeHtml(d.typed)}” one of these players?`) : tl(`Hráč „${escapeHtml(d.typed)}“ zatiaľ neexistuje.`, `There is no player “${escapeHtml(d.typed)}” yet.`);
    chooser.innerHTML = `
      <div class="sg-choose-title">${title}</div>
      <div class="sg-choose-buttons">
        ${d.suggestions.map((p) => `<button type="button" class="btn btn-sm btn-outline" data-pick="${p.id}">${escapeHtml(p.name)}</button>`).join('')}
        <button type="button" class="btn btn-sm btn-primary" data-new="1">${tl(`Nie — vytvoriť nového hráča „${escapeHtml(d.typed)}“`, `No — create new player “${escapeHtml(d.typed)}”`)}</button>
        <button type="button" class="sg-link" data-cancel="1">${tl('Zrušiť', 'Cancel')}</button>
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
    if (!confirm(tl(`Odstúpiť ${member.name} zo skupiny ${group.name}?\n\nKaždý jeho neodohraný zápas sa kontumuje v prospech súpera (3 body) a nové zápasy sa mu už nevytvoria.`, `Withdraw ${member.name} from ${group.name}?\n\nEvery match they have not played yet becomes a walkover win for the opponent (3 points), and no new matches are made for them.`))) return;
    try {
      const res = await api(`/seasons/groups/${group.id}/members/${member.id}/withdraw`, { method: 'POST' });
      toast(tl(`${member.name} odstúpil — kontumácií: ${res.walkovers}`, `${member.name} withdrew — ${res.walkovers} walkover${res.walkovers === 1 ? '' : 's'} recorded`));
      openPanels.add(group.id);
      await load();
    } catch (err) { fail(err); }
  }));
  panel.querySelectorAll('[data-action="reinstate"]').forEach((b) => b.addEventListener('click', async () => {
    const member = group.members.find((m) => m.id === Number(b.dataset.player));
    if (!confirm(tl(`Zrušiť odstúpenie hráča ${member.name} zo skupiny ${group.name}?

Kontumácie, ktoré vznikli jeho odstúpením, sa vrátia na neodohrané zápasy a body, ktoré za ne dostali súperi, sa odoberú.`, `Undo the withdrawal of ${member.name} from ${group.name}?

The walkovers made by the withdrawal become unplayed matches again and the points the opponents got for them are taken back.`))) return;
    try {
      const res = await api(`/seasons/groups/${group.id}/members/${member.id}/reinstate`, { method: 'POST' });
      toast(tl(`${member.name} je opäť v skupine — vrátených zápasov: ${res.restored}`, `${member.name} is back in the group — ${res.restored} match${res.restored === 1 ? '' : 'es'} restored`));
      openPanels.add(group.id);
      await load();
    } catch (err) { fail(err); }
  }));
  panel.querySelectorAll('[data-action="remove-member"]').forEach((b) => b.addEventListener('click', async () => {
    const member = group.members.find((m) => m.id === Number(b.dataset.player));
    if (!confirm(tl(`Odstrániť ${member.name} zo skupiny ${group.name}?`, `Remove ${member.name} from ${group.name}?`))) return;
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
        toast(tl(`Importovaní hráči: ${res.added}${res.inOtherGroup ? ` (${res.inOtherGroup} už v inej skupine)` : ''}`, `${res.added} player${res.added === 1 ? '' : 's'} imported${res.inOtherGroup ? ` (${res.inOtherGroup} already in another group)` : ''}`));
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
      if (!total) { toast(tl('Nie je čo vytvárať — každá dvojica už má zápas', 'Nothing to create — every pair already has a match')); return; }
      const groupsWith = data.groups.filter((g) => g.toCreate > 0).length;
      if (!confirm(tl(`Vytvoriť naplánované zápasy (${total}) v ${groupsWith} ${groupsWith === 1 ? 'skupine' : 'skupinách'}?\n\nZatiaľ nemajú dátum; hráči sa naň dohodnú sami.`, `Create ${total} planned matches in ${groupsWith} group${groupsWith === 1 ? '' : 's'}?\n\nThey get no date yet; the players agree it themselves.`))) return;
      const res = await api(`/seasons/${seasonId}/schedule`, { method: 'POST', body: { format: card.querySelector('.sg-format').value } });
      toast(tl(`Vytvorené zápasy: ${res.created}`, `${res.created} matches created`));
      await load();
    } catch (err) { fail(err); }
  });
  if (previewOpen.has(seasonId)) loadPreview().catch(() => {});
}

(async () => {
  if (CLUB) {
    const session = await loadSession();
    if (!session.isAdmin && !session.isPlayer) return renderLoggedOut();
    return renderAdmin();
  }
  const isAdminUser = await checkAdmin();
  if (!isAdminUser) return renderLoggedOut();
  await loadPlayers();
  renderAdmin();
})();
