// Komunity a kluby: the page of one community or club (/komunita/<slug>, code address /community/<slug>). A cover, the logo, the name, how to join, and three tabs
// (news, events - the tournaments of the club -, info with the members). An admin of the club who has switched to its profile ("acting as", see GET /api/communities/mine) also gets
// the panel of the club: a news box, the requests to join, the settings and the pictures.
// Data: /api/communities/... (src/routes/communities.js).
(function communityPage() {
  const root = document.getElementById('com-page');
  if (!root) return;

  let slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || ''); // (changes when the community is renamed: its address follows its name)
  setClubManifest(slug); // the app that can be installed from this page is this club (see clubApp.js); done now, before the browser decides what to offer
  let org = null;
  let acting = null;
  let loggedIn = false;
  let members = { members: [], pending: [] };
  let posts = { items: [], more: false };
  let tournaments = [];
  let winners = []; // the winners lists of its tournaments (GET /api/winners?organisation=<slug>), newest tournament first
  let ranking = { items: [] }; // the own ranking of the community or club (GET /api/communities/:id/ranking), its points set by hand by an admin
  // a page opened from an invitation link (?invite=...): joining with it needs no approval
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  let draftImage = ''; // the picture chosen for the post that is being written (an address the server gave)
  // the tabs: News, Events, Ranking, Info (the members are in Info; the old #members link of the club menu opens it)
  const tabFromHash = (hash) => (hash === 'members' ? 'info' : ['news', 'events', 'ranking', 'info'].includes(hash) ? hash : null);
  let tab = tabFromHash(window.location.hash.slice(1)) || 'news';

  const locale = () => (currentLang === 'en' ? 'en-GB' : 'sk-SK');
  const dateText = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric', year: 'numeric' });
  // Slovak: 1 člen, 2-4 členovia, 5 členov
  const membersText = (n) => (n === 1 ? t('com.membersOne') : n >= 2 && n <= 4 ? t('com.membersFew', { n }) : t('com.membersN', { n }));
  const typeText = (o) => (o.type === 'CLUB' ? t('com.typeClub') : t('com.typeCommunity'));
  // the first letters of the first two words (a lone dash or an ampersand is not a word)
  const initials = (name) => String(name || '?').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
  const playerLink = (p) => `/player/${encodeURIComponent(p.slug || p.playerId)}`;
  // 2026-10-28 -> 28. 10. 2026 (a plain date is read at noon, so no time zone moves it to the neighbouring day)
  const dayText = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
  const rangeText = (a, b) => (a && b && a !== b ? `${dayText(a)} – ${dayText(b)}` : dayText(a || b));
  // managing: acting as this club (a player who runs it), or the super admin of the site (the server says so: org.canManage)
  // managing: an admin of this community or club (also one made an admin later: no need to switch profile), or the super admin of the site (org.canManage)
  const isActing = () => !!(org && ((acting && acting.id === org.id) || org.canManage || isAdminOfOrg()));
  const isAdminOfOrg = () => !!(org && org.me && org.me.role === 'ADMIN');

  async function upload(which, file) {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`/api/communities/${org.id}/${which}`, { method: 'POST', body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  // ---------------------------------------------------------------- pieces

  function joinHtml() {
    const me = org.me;
    if (!org.approved) return '';
    if (me && me.status === 'ACTIVE') return `<button type="button" class="btn btn-leave" data-act="leave">${escapeHtml(t('com.leave'))}</button>`;
    if (me && me.status === 'PENDING') {
      return `<button type="button" class="btn btn-outline" disabled>${escapeHtml(t('com.requestSent'))}</button>
        <button type="button" class="btn btn-outline" data-act="cancel-request">${escapeHtml(t('com.cancelRequest'))}</button>`;
    }
    if (me && me.canRequestAgainAt) return `<p class="com-hint">${escapeHtml(t('com.requestAgain', { date: dateText(me.canRequestAgainAt) }))}</p>`;
    return `<button type="button" class="btn btn-join" data-act="join">${escapeHtml(t(org.joinPolicy === 'OPEN' || inviteToken ? 'com.join' : 'com.requestJoin'))}</button>`;
  }

  // the logo of this community in the header of its news
  const orgLogoHtml = () => (org.logoUrl ? `<span class="com-logo"><img src="${escapeHtml(org.logoUrl)}" alt=""></span>` : `<span class="com-logo">${escapeHtml(initials(org.name))}</span>`);

  // Editing a post: the text turns into a box with Save and Cancel (one post at a time); only the text can be changed, the picture stays
  let editingPost = null;
  const postEditHtml = (p) => `<div class="com-post-edit"><textarea id="com-edit-text" rows="5" maxlength="2000">${escapeHtml(p.body || '')}</textarea>
      <div class="com-post-edit-bar"><button type="button" class="btn btn-outline com-small" id="com-edit-cancel">${escapeHtml(t('com.cancelEdit'))}</button><button type="button" class="btn btn-primary com-small" id="com-edit-save">${escapeHtml(t('com.saveEdit'))}</button></div></div>`;

  function postHtml(p) {
    return `
      <div class="com-post" data-post="${p.id}">
        ${comPostHeadHtml({ logo: orgLogoHtml(), name: org.name, by: t('com.postedBy', { name: p.authorName }), date: dateText(p.createdAt) + (p.editedAt ? ` · ${t('com.edited')}` : ''), postId: p.id, canDelete: p.canDelete, canEdit: p.canEdit })}
        ${editingPost === p.id ? postEditHtml(p) : p.body ? `<div class="com-post-body">${comPostText(p.body)}</div>` : ''}
        ${comPostImage(p.imageUrl)}
        ${comReactionsHtml(p)}
        ${comCommentsHtml(p)}
      </div>`;
  }

  function memberHtml(m) {
    const manage = isActing() && m.playerId !== currentPlayerId;
    return `
      <div class="com-member">
        <a href="${escapeHtml(playerLink(m))}">${escapeHtml(m.name)}</a>
        ${m.role === 'ADMIN' ? `<span class="com-badge">${escapeHtml(t('com.adminLabel'))}</span>` : ''}
        ${manage ? `<span class="com-member-acts">
          <button type="button" class="com-link" data-role="${m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'}" data-player="${m.playerId}">${escapeHtml(t(m.role === 'ADMIN' ? 'com.demote' : 'com.promote'))}</button>
          <button type="button" class="com-link" data-remove="${m.playerId}">${escapeHtml(t('com.remove'))}</button></span>` : ''}
      </div>`;
  }

  function panelHtml() {
    const pending = members.pending;
    return `
      <div class="com-panel">
        <h3>${escapeHtml(t('com.adminPanel'))}</h3>
        <div class="com-newpost">
          <textarea id="com-post-text" rows="3" maxlength="2000" placeholder="${escapeHtml(t('com.postPlaceholder'))}"></textarea>
          <div class="com-newpost-img" id="com-post-img"${draftImage ? '' : ' hidden'}>${draftImage ? draftImageHtml() : ''}</div>
          <div class="com-newpost-bar">
            <button type="button" class="btn btn-outline com-small com-tool" id="com-post-emoji" aria-label="${escapeHtml(t('com.emoji'))}" title="${escapeHtml(t('com.emoji'))}">😊</button>
            <label class="btn btn-outline com-small com-tool" title="${escapeHtml(t('com.addImage'))}">📷 ${escapeHtml(t('com.addImage'))}<input type="file" accept="image/png,image/jpeg,image/webp" id="com-post-file" hidden></label>
            <button type="button" class="btn btn-primary" id="com-post-btn">${escapeHtml(t('com.publish'))}</button>
          </div>
        </div>
        ${pending.length ? `
        <div class="com-lab">${escapeHtml(t('com.requests'))} (${pending.length})</div>
        ${pending.map((r) => `
          <div class="com-member">
            <a href="${escapeHtml(playerLink(r))}">${escapeHtml(r.name)}</a>
            ${r.level !== null ? `<span class="com-badge">${escapeHtml(t('com.level'))} ${escapeHtml(String(r.level))}</span>` : ''}
            <span class="com-member-acts">
              <button type="button" class="btn btn-primary com-small" data-decide="approve" data-player="${r.playerId}">${escapeHtml(t('com.approve'))}</button>
              <button type="button" class="btn btn-outline com-small" data-decide="reject" data-player="${r.playerId}">${escapeHtml(t('com.reject'))}</button>
            </span>
          </div>`).join('')}
        ${pending.length > 1 ? `<button type="button" class="btn btn-outline com-small" id="com-approve-all">${escapeHtml(t('com.approveAll'))}</button>` : ''}` : ''}
      </div>`;
  }

  const joinInfoText = () => t(org.joinPolicy === 'OPEN' ? 'com.joinOpenInfo' : 'com.joinApprovalInfo');

  // the Info tab: the basic facts as label and value rows, then the members
  function infoHtml() {
    const rows = [
      org.description ? ['com.infoAbout', org.description, true] : null,
      ['com.infoType', typeText(org)],
      org.city ? ['com.infoCity', org.city] : null,
      ['com.infoJoin', joinInfoText()],
      org.contact ? ['com.infoContact', org.contact] : null,
    ].filter(Boolean);
    return `
      <div class="com-info">
        ${rows.map(([key, value, text]) => `<div class="com-info-row"><span class="com-info-label">${escapeHtml(t(key))}</span><span class="com-info-value${text ? ' com-info-text' : ''}">${escapeHtml(value)}</span></div>`).join('')}
      </div>
      ${[['website', org.website], ['facebook', org.facebook], ['instagram', org.instagram]].filter(([, url]) => /^https?:\/\//.test(url || '')).length ? `<div class="com-lab">${escapeHtml(t('com.infoLinks'))}</div>
      <div class="com-links">${[['website', org.website, 'com.fieldWebsite'], ['facebook', org.facebook, 'com.fieldFacebook'], ['instagram', org.instagram, 'com.fieldInstagram']].filter(([, url]) => /^https?:\/\//.test(url || '')).map(([key, url, label]) => `<a class="btn btn-outline com-small com-link-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(t(label))} ↗</a>`).join('')}</div>` : ''}
      <div class="com-lab">${escapeHtml(t('com.tabMembers'))} (${members.members.length})</div>
      ${members.members.length ? `<div class="com-members">${members.members.map(memberHtml).join('')}</div>` : ''}`;
  }

  // ---- the Events tab: the tournaments of the club (and, for its admin acting as the club, the way to make one and to manage it)
  function tournamentHtml(s) {
    const today = new Date().toISOString().slice(0, 10);
    const over = !!s.endDate && s.endDate < today;
    const season = s.kind === 'LEAGUE'; // a season (groups and a table) or a tournament
    // what a visitor can do (the page of the tournament goes by the same): the switch of the Backend is not enough, a tournament that has started takes no registration
    const regAvailable = s.registrationAvailable !== undefined ? s.registrationAvailable : s.registrationOpen;
    const open = !season && regAvailable && !over;
    const closed = !season && !regAvailable && !over;
    const link = `/${season ? 'season' : 'tournament'}/${encodeURIComponent(s.slug)}`;
    const facts = (season ? [t('com.seasonTag'), s.venue, t('com.seasonMatches', { n: s.matchCount || 0 })] : [s.venue, t(s.playType === 'DOUBLES' ? 'com.tDoubles' : 'com.tSingles'), t('com.eventRegistered', { n: s.registrationCount || 0 })]).filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="com-event${over ? ' over' : ''}">
        <div class="com-event-date">${escapeHtml(rangeText(s.startDate, s.endDate) || t('com.eventNoDate'))}</div>
        <div class="com-event-main"><a class="com-event-name" href="${escapeHtml(link)}">${escapeHtml(s.name)}</a><div class="com-event-sub">${facts}</div></div>
        <div class="com-event-acts">
          ${open ? `<a class="btn btn-primary com-small" href="${escapeHtml(link)}#register">${escapeHtml(t('com.eventRegister'))}</a>` : ''}
          ${closed ? `<span class="btn com-small com-reg-closed">${escapeHtml(t('season.registerClosed'))}</span>` : ''}
          <a class="btn btn-outline com-small" href="${escapeHtml(link)}">${escapeHtml(t('com.eventView'))}</a>
          ${isActing() ? `<a class="btn btn-outline com-small" href="/community-tournament/${s.id}">${escapeHtml(t('com.eventManage'))}</a>` : ''}
        </div>
      </div>`;
  }

  // the winners of the tournaments of the club: per tournament its categories with the winner, the finalist and the semifinalists (the tiles of the page of a tournament)
  function winnersHtml() {
    const blocks = winners.map((e) => {
      const cards = e.blocks.map((b) => {
        const tiles = b.places.map((p) => {
          const [tone, labelKey] = p.slot === 1 ? ['win-gold', 'winners.winner'] : p.slot === 2 ? ['win-silver', 'winners.finalist'] : ['win-bronze', 'winners.semifinalist'];
          const photo = p.photoUrl ? `<img class="sw-img" src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">` : `<div class="sw-av">${escapeHtml(String(p.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</div>`;
          const inner = `<div class="sw-ph">${photo}</div><div class="sw-l"><small>${escapeHtml(t(labelKey))}</small><b>${escapeHtml(p.name)}</b></div>`;
          return p.playerId ? `<a class="sw-tile ${tone}" href="/player/${encodeURIComponent(p.playerSlug || p.playerId)}">${inner}</a>` : `<div class="sw-tile ${tone}">${inner}</div>`;
        }).join('');
        const label = b.category ? ({ ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' }[b.category] || b.category) : (b.title === 'Konečné poradie' ? t('season.navFinal') : b.title);
        return `<div class="sw-card"><h3 class="sw-cat">${escapeHtml(label)}</h3><div class="sw-pair sw-quad">${tiles}</div></div>`;
      }).join('');
      return `<div class="com-winners-ed"><h3 class="com-winners-title">${e.seasonSlug ? `<a href="/tournament/${encodeURIComponent(e.seasonSlug)}">${escapeHtml(e.seasonName || e.title)}</a>` : escapeHtml(e.title)}</h3><div class="sw-row sw-row-quad">${cards}</div></div>`;
    }).join('');
    return blocks ? `<section class="com-winners"><div class="com-lab">${escapeHtml(t('com.winners'))}</div>${blocks}</section>` : '';
  }

  function eventsHtml() {
    const make = isActing() && org.approved ? `<button type="button" class="btn btn-primary com-new-tournament" data-act="new-tournament">+ ${escapeHtml(t('com.newTournament'))}</button> <button type="button" class="btn btn-outline com-new-tournament" data-act="new-season">+ ${escapeHtml(t('com.newSeason'))}</button>` : '';
    return `${make}${tournaments.length ? `<div class="com-events">${tournaments.map(tournamentHtml).join('')}</div>` : `<p class="com-empty">${escapeHtml(t('com.noEvents'))}</p>`}${winnersHtml()}`;
  }

  // ---- the Ranking tab: every member of the club is in it by himself (nobody is added); the admin sets the points by hand, a member with none has no rank yet
  function rankingHtml() {
    const manage = isActing() && org.approved;
    const rows = ranking.items;
    if (!rows.length) return `<p class="com-empty">${escapeHtml(t('com.rankEmpty'))}</p>`;
    const list = `
      <div class="com-rank">
        <div class="com-rank-row com-rank-head"><span class="com-rank-pos">#</span><span class="com-rank-name">${escapeHtml(t('com.rankPlayer'))}</span><span class="com-rank-pts">${escapeHtml(t('com.rankPoints'))}</span></div>
        ${rows.map((r) => `
          <div class="com-rank-row">
            <span class="com-rank-pos${r.rank && r.rank <= 3 ? ' top' : ''}">${r.rank === null ? '–' : r.rank}</span>
            <a class="com-rank-name" href="${escapeHtml(playerLink(r))}">${escapeHtml(r.name)}</a>
            ${manage ? `<span class="com-rank-edit">
              <input type="number" min="0" max="1000000" step="1" inputmode="numeric" value="${r.points}" data-rank-input="${r.playerId}" aria-label="${escapeHtml(t('com.rankPoints'))}">
              <button type="button" class="btn btn-outline com-small" data-rank-save="${r.playerId}">${escapeHtml(t('com.rankSave'))}</button>
            </span>` : `<span class="com-rank-pts">${r.points}</span>`}
          </div>`).join('')}
      </div>`;
    return `${list}${manage ? `<p class="com-hint">${escapeHtml(t('com.rankHint'))}</p>` : ''}`;
  }

  // the dialog that makes a tournament of the club: only what the tournament is (name, place, dates, type, categories, fee, description); it opens the manage page
  // of the new tournament, where the rest (registration, courts and planning, scoring rules, look of the page) is set
  function openTournamentDialog() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal com-tdialog" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('com.tournamentTitle'))}</h3>
      <form id="com-t-form">
        <div class="field"><label>${escapeHtml(t('com.tFieldName'))}</label><input type="text" id="com-t-name" maxlength="120" required></div>
        <div class="field"><label>${escapeHtml(t('com.tFieldVenue'))}</label><input type="text" id="com-t-venue" maxlength="200"></div>
        <div class="com-t-row">
          <div class="field"><label>${escapeHtml(t('com.tFieldStart'))}</label><input type="date" id="com-t-start" required></div>
          <div class="field"><label>${escapeHtml(t('com.tFieldEnd'))}</label><input type="date" id="com-t-end"></div>
        </div>
        <div class="field"><label>${escapeHtml(t('com.tFieldType'))}</label>
          <label class="com-radio"><input type="radio" name="com-t-type" value="SINGLES" checked> ${escapeHtml(t('com.tSingles'))}</label>
          <label class="com-radio"><input type="radio" name="com-t-type" value="DOUBLES"> ${escapeHtml(t('com.tDoubles'))}</label>
        </div>
        <div class="field" id="com-t-cats"><label>${escapeHtml(t('com.tFieldCategories'))}</label>
          ${[['ELITE', 'Elite'], ['NEXT_GEN', 'Next Gen'], ['NOVICE', 'Novice']].map(([k, label]) => `<label class="com-radio"><input type="checkbox" data-cat="${k}" checked> ${label}</label>`).join('')}
          <label class="com-radio"><input type="checkbox" id="com-t-open"> ${escapeHtml(t('com.tNoCategory'))}</label>
        </div>
        <div class="field"><label>${escapeHtml(t('com.tFieldFee'))}</label><input type="text" id="com-t-fee" maxlength="40" placeholder="${escapeHtml(t('com.tFeeHint'))}"></div>
        <div class="field"><label>${escapeHtml(t('com.tFieldInfo'))}</label><textarea id="com-t-info" rows="4" maxlength="4000" placeholder="${escapeHtml(t('com.tInfoHint'))}"></textarea></div>
        <div id="com-t-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary">${escapeHtml(t('com.tCreate'))}</button>
        <button type="button" class="btn btn-outline" id="com-t-cancel">${escapeHtml(t('com.tCancel'))}</button>
      </form></div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.querySelector('#com-t-cancel').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    const form = back.querySelector('#com-t-form');
    const cats = back.querySelector('#com-t-cats');
    // "Bez kategórie" switches the three categories off: the tournament is played without them (one draw for everybody)
    const noCategory = form.querySelector('#com-t-open');
    noCategory.addEventListener('change', () => {
      cats.querySelectorAll('[data-cat]').forEach((b) => { b.disabled = noCategory.checked; if (noCategory.checked) b.checked = false; });
    });
    form.querySelectorAll('input[name="com-t-type"]').forEach((r) => r.addEventListener('change', () => { cats.hidden = form.querySelector('input[name="com-t-type"]:checked').value === 'DOUBLES'; }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit.dataset.busy) return;
      submit.dataset.busy = '1';
      const errorEl = back.querySelector('#com-t-error');
      errorEl.textContent = '';
      const value = (id) => back.querySelector(id).value;
      const playType = form.querySelector('input[name="com-t-type"]:checked').value;
      try {
        const body = {
          name: value('#com-t-name').trim(), venue: value('#com-t-venue').trim(), startDate: value('#com-t-start') || null, endDate: value('#com-t-end') || null,
          playType, entryFee: value('#com-t-fee').trim(), info: value('#com-t-info').trim() ? `<p>${escapeHtml(value('#com-t-info').trim()).replace(/\n/g, '<br>')}</p>` : '',
        };
        if (playType === 'SINGLES') body.categories = noCategory.checked ? ['OPEN'] : [...cats.querySelectorAll('[data-cat]')].filter((b) => b.checked).map((b) => b.dataset.cat);
        const made = await api(`/communities/${org.id}/tournaments`, { method: 'POST', body });
        window.location.href = siteUrl(`/community-tournament/${made.id}`); // (a code address is only turned into the real one by siteUrl, links are rewritten by localize.js)
      } catch (err) { errorEl.textContent = err.message; delete submit.dataset.busy; }
    });
    back.querySelector('#com-t-name').focus();
  }

  // the dialog that makes a season of the club: only a name, a place, the dates and a description; it opens the manage page of the new season, where the rest
  // (the groups and their players, the scoring rules) is set
  function openSeasonDialog() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal com-tdialog" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('com.seasonTitle'))}</h3>
      <p style="font-size:13.5px;line-height:1.5;margin:0 0 10px">${escapeHtml(t('com.seasonHint'))}</p>
      <form id="com-s-form">
        <div class="field"><label>${escapeHtml(t('com.sFieldName'))}</label><input type="text" id="com-s-name" maxlength="120" required></div>
        <div class="field"><label>${escapeHtml(t('com.tFieldVenue'))}</label><input type="text" id="com-s-venue" maxlength="200"></div>
        <div class="com-t-row">
          <div class="field"><label>${escapeHtml(t('com.tFieldStart'))}</label><input type="date" id="com-s-start" required></div>
          <div class="field"><label>${escapeHtml(t('com.tFieldEnd'))}</label><input type="date" id="com-s-end" required></div>
        </div>
        <div class="field"><label>${escapeHtml(t('com.tFieldInfo'))}</label><textarea id="com-s-info" rows="4" maxlength="4000" placeholder="${escapeHtml(t('com.sInfoHint'))}"></textarea></div>
        <div id="com-s-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary">${escapeHtml(t('com.tCreate'))}</button>
        <button type="button" class="btn btn-outline" id="com-s-cancel">${escapeHtml(t('com.tCancel'))}</button>
      </form></div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.querySelector('#com-s-cancel').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    const form = back.querySelector('#com-s-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit.dataset.busy) return;
      submit.dataset.busy = '1';
      const errorEl = back.querySelector('#com-s-error');
      errorEl.textContent = '';
      const value = (id) => back.querySelector(id).value;
      try {
        const info = value('#com-s-info').trim();
        const body = { name: value('#com-s-name').trim(), venue: value('#com-s-venue').trim(), startDate: value('#com-s-start') || null, endDate: value('#com-s-end') || null, info: info ? `<p>${escapeHtml(info).replace(/\n/g, '<br>')}</p>` : '' };
        const made = await api(`/communities/${org.id}/seasons`, { method: 'POST', body });
        window.location.href = siteUrl(`/community-tournament/${made.id}`); // (its manage page: the groups and their players)
      } catch (err) { errorEl.textContent = err.message; delete submit.dataset.busy; }
    });
    back.querySelector('#com-s-name').focus();
  }

  // Invite people: the admin picks names from a list (one or several) and each gets an invitation message he can join from at once; below it the
  // private link to copy, share or renew (the old one then stops working)
  async function openInviteDialog() {
    document.querySelectorAll('.com-idialog-back').forEach((el) => el.remove());
    let token;
    try { token = (await api(`/communities/${org.id}/invite`)).token; } catch (err) { toast(err.message); return; }
    const linkOf = (tk) => `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(tk)}`;
    const back = document.createElement('div');
    back.className = 'modal-backdrop com-idialog-back';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal com-tdialog" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('com.inviteTitle'))}</h3>
      <div class="com-lab com-lab-dark">${escapeHtml(t('com.invitePlayers'))}</div>
      <div class="field"><input type="search" id="com-invite-search" maxlength="60" placeholder="${escapeHtml(t('com.inviteSearch'))}" autocomplete="off"></div>
      <div class="com-invite-list" id="com-invite-list"></div>
      <button type="button" class="btn btn-primary" id="com-invite-send" disabled>${escapeHtml(t('com.inviteSend'))}</button>
      <div class="com-lab com-lab-dark" style="margin-top:18px">${escapeHtml(t('com.inviteOr'))}</div>
      <p style="font-size:13.5px;line-height:1.5;margin:0 0 8px">${escapeHtml(t('com.inviteHint'))}</p>
      <div class="field"><input type="text" id="com-invite-link" readonly value="${escapeHtml(linkOf(token))}"></div>
      <div class="com-invite-acts">
        <button type="button" class="btn btn-outline" id="com-invite-copy">${escapeHtml(t('com.inviteCopy'))}</button>
        ${navigator.share ? `<button type="button" class="btn btn-outline" id="com-invite-share">${escapeHtml(t('com.inviteShare'))}</button>` : ''}
        <button type="button" class="btn btn-outline" id="com-invite-new">${escapeHtml(t('com.inviteNew'))}</button>
      </div></div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);

    // the list of players
    const picked = new Map(); // id -> name, kept while the search changes
    const list = back.querySelector('#com-invite-list');
    const send = back.querySelector('#com-invite-send');
    const search = back.querySelector('#com-invite-search');
    const refreshSend = () => {
      send.disabled = !picked.size;
      send.textContent = picked.size ? `${t('com.inviteSend')} (${picked.size})` : t('com.inviteSend');
    };
    let run = 0;
    async function loadList() {
      const mine = ++run;
      let items = [];
      try { items = (await api(`/communities/${org.id}/invite-candidates?q=${encodeURIComponent(search.value.trim())}`)).items; } catch (err) { list.innerHTML = `<p class="com-empty">${escapeHtml(err.message)}</p>`; return; }
      if (mine !== run) return; // a newer search is on its way
      list.innerHTML = items.length ? items.map((p) => `<label class="com-invite-row${p.invited ? ' done' : ''}">
          <input type="checkbox" value="${p.playerId}"${picked.has(p.playerId) ? ' checked' : ''}${p.invited ? ' disabled' : ''}>
          <span class="com-invite-name">${escapeHtml(p.name)}</span>${p.invited ? `<small>${escapeHtml(t('com.inviteAlready'))}</small>` : ''}</label>`).join('') : `<p class="com-empty">${escapeHtml(t('com.inviteNobody'))}</p>`;
      list.querySelectorAll('input[type="checkbox"]').forEach((box) => box.addEventListener('change', () => {
        const id = Number(box.value);
        if (box.checked) picked.set(id, box.closest('label').querySelector('.com-invite-name').textContent); else picked.delete(id);
        refreshSend();
      }));
    }
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadList, 250); });
    send.addEventListener('click', () => guard(send, async () => {
      const res = await api(`/communities/${org.id}/invite-players`, { method: 'POST', body: { playerIds: [...picked.keys()] } });
      toast(t('com.inviteSent', { n: res.sent }));
      picked.clear();
      refreshSend();
      await loadList();
    }));
    refreshSend();
    loadList();

    // the link
    const field = back.querySelector('#com-invite-link');
    field.addEventListener('focus', () => field.select());
    back.querySelector('#com-invite-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(field.value); } catch { field.select(); document.execCommand('copy'); }
      toast(t('com.inviteCopied'));
    });
    const share = back.querySelector('#com-invite-share');
    if (share) share.addEventListener('click', () => navigator.share({ title: org.name, url: field.value }).catch(() => {}));
    back.querySelector('#com-invite-new').addEventListener('click', () => guard(back.querySelector('#com-invite-new'), async () => {
      if (!window.confirm(t('com.inviteNewConfirm'))) return;
      token = (await api(`/communities/${org.id}/invite/reset`, { method: 'POST' })).token;
      field.value = linkOf(token);
    }));
  }

  // Add members by hand: the admin of the community or club (or the super admin) picks players from the list of the city; they are members at once, with no
  // message to accept and no approval, and need no phone (POST /api/communities/:id/add-members)
  function openAddMembersDialog() {
    document.querySelectorAll('.com-adialog-back').forEach((el) => el.remove());
    const back = document.createElement('div');
    back.className = 'modal-backdrop com-adialog-back';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal com-tdialog" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('com.addTitle'))}</h3>
      <p style="font-size:13.5px;line-height:1.5;margin:0 0 8px">${escapeHtml(t('com.addHint'))}</p>
      <div class="field"><input type="search" id="com-add-search" maxlength="60" placeholder="${escapeHtml(t('com.inviteSearch'))}" autocomplete="off"></div>
      <div class="com-invite-list" id="com-add-list"></div>
      <button type="button" class="btn btn-primary" id="com-add-send" disabled>${escapeHtml(t('com.addSend'))}</button></div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    const picked = new Map(); // id -> name, kept while the search changes
    const list = back.querySelector('#com-add-list');
    const send = back.querySelector('#com-add-send');
    const search = back.querySelector('#com-add-search');
    const refreshSend = () => {
      send.disabled = !picked.size;
      send.textContent = picked.size ? `${t('com.addSend')} (${picked.size})` : t('com.addSend');
    };
    let run = 0;
    async function loadList() {
      const mine = ++run;
      let items = [];
      try { items = (await api(`/communities/${org.id}/add-candidates?q=${encodeURIComponent(search.value.trim())}`)).items; } catch (err) { list.innerHTML = `<p class="com-empty">${escapeHtml(err.message)}</p>`; return; }
      if (mine !== run) return; // a newer search is on its way
      list.innerHTML = items.length ? items.map((p) => `<label class="com-invite-row">
          <input type="checkbox" value="${p.playerId}"${picked.has(p.playerId) ? ' checked' : ''}>
          <span class="com-invite-name">${escapeHtml(p.name)}</span>${p.waiting ? `<small>${escapeHtml(t('com.addWaiting'))}</small>` : ''}</label>`).join('') : `<p class="com-empty">${escapeHtml(t('com.inviteNobody'))}</p>`;
      list.querySelectorAll('input[type="checkbox"]').forEach((box) => box.addEventListener('change', () => {
        const id = Number(box.value);
        if (box.checked) picked.set(id, box.closest('label').querySelector('.com-invite-name').textContent); else picked.delete(id);
        refreshSend();
      }));
    }
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadList, 250); });
    send.addEventListener('click', () => guard(send, async () => {
      const res = await api(`/communities/${org.id}/add-members`, { method: 'POST', body: { playerIds: [...picked.keys()] } });
      toast(t('com.addDone', { n: res.added }));
      picked.clear();
      refreshSend();
      await loadList();
      await load(); // the member list behind the dialog
    }));
    refreshSend();
    loadList();
    search.focus();
  }

  const draftImageHtml = () => `<img src="${escapeHtml(draftImage)}" alt=""><button type="button" class="com-link" id="com-post-img-remove">${escapeHtml(t('com.removeImage'))}</button>`;

  // the settings of the community or club: a dialog opened by the gear beside its name (name, description, contact, who may join, logo and cover)
  function openSettingsDialog(keep) {
    document.querySelectorAll('.com-sdialog-back').forEach((el) => el.remove());
    const v = keep || { name: org.name, description: org.description, contact: org.contact, join: org.joinPolicy, website: org.website, facebook: org.facebook, instagram: org.instagram };
    const back = document.createElement('div');
    back.className = 'modal-backdrop com-sdialog-back';
    back.style.display = 'flex';
    back.innerHTML = `<div class="modal com-tdialog" role="dialog" aria-modal="true"><button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('com.settings'))}</h3>
      <form id="com-settings">
        <div class="field"><label>${escapeHtml(t('com.fieldName'))}</label><input type="text" id="com-s-name" maxlength="120" value="${escapeHtml(v.name)}" required></div>
        <div class="field"><label>${escapeHtml(t('com.fieldDescription'))}</label><textarea id="com-s-description" rows="3" maxlength="2000">${escapeHtml(v.description)}</textarea></div>
        <div class="field"><label>${escapeHtml(t('com.fieldContact'))}</label><input type="text" id="com-s-contact" maxlength="200" value="${escapeHtml(v.contact)}"></div>
        <div class="field"><label>${escapeHtml(t('com.fieldJoin'))}</label>
          <label class="com-radio"><input type="radio" name="com-s-join" value="OPEN"${v.join === 'OPEN' ? ' checked' : ''}> ${escapeHtml(t('com.joinOpen'))}</label>
          <label class="com-radio"><input type="radio" name="com-s-join" value="APPROVAL"${v.join === 'APPROVAL' ? ' checked' : ''}> ${escapeHtml(t('com.joinApproval'))}</label>
        </div>
        <div class="field"><label>${escapeHtml(t('com.fieldWebsite'))}</label><input type="url" id="com-s-website" maxlength="300" placeholder="https://" value="${escapeHtml(v.website || '')}"></div>
        <div class="field"><label>${escapeHtml(t('com.fieldFacebook'))}</label><input type="url" id="com-s-facebook" maxlength="300" placeholder="https://facebook.com/…" value="${escapeHtml(v.facebook || '')}"></div>
        <div class="field"><label>${escapeHtml(t('com.fieldInstagram'))}</label><input type="url" id="com-s-instagram" maxlength="300" placeholder="https://instagram.com/…" value="${escapeHtml(v.instagram || '')}"></div>
        <div class="com-pictures">
          <label class="btn btn-outline com-small">${escapeHtml(t('com.uploadLogo'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="logo" hidden></label>
          <label class="btn btn-outline com-small">${escapeHtml(t('com.uploadCover'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="cover" hidden></label>
          ${org.logoUrl ? `<button type="button" class="com-link com-link-dark" data-remove-image="logo">${escapeHtml(t('com.removeImage'))} (logo)</button>` : ''}
          ${org.coverUrl ? `<button type="button" class="com-link com-link-dark" data-remove-image="cover">${escapeHtml(t('com.removeImage'))} (cover)</button>` : ''}
        </div>
        <div id="com-s-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
        <button type="submit" class="btn btn-primary">${escapeHtml(t('com.save'))}</button>
        <button type="button" class="btn btn-outline" id="com-s-cancel">${escapeHtml(t('com.tCancel'))}</button>
        <div class="com-danger"><button type="button" class="btn btn-danger com-small" id="com-s-delete">${escapeHtml(t('com.deleteBtn'))}</button></div>
      </form></div>`;
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.querySelector('#com-s-cancel').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    const form = back.querySelector('#com-settings');
    const typedNow = () => ({ name: form.querySelector('#com-s-name').value, description: form.querySelector('#com-s-description').value, contact: form.querySelector('#com-s-contact').value, join: form.querySelector('input[name="com-s-join"]:checked').value, website: form.querySelector('#com-s-website').value, facebook: form.querySelector('#com-s-facebook').value, instagram: form.querySelector('#com-s-instagram').value });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit.dataset.busy) return;
      submit.dataset.busy = '1';
      const errorEl = back.querySelector('#com-s-error');
      errorEl.textContent = '';
      try {
        const now = typedNow();
        await api(`/communities/${org.id}`, { method: 'PATCH', body: { name: now.name, description: now.description, contact: now.contact, joinPolicy: now.join, website: now.website, facebook: now.facebook, instagram: now.instagram } });
        close();
        toast(t('com.saved'));
        await load();
        refreshActingOrg(); // the chip and the switcher show the new name
      } catch (err) { errorEl.textContent = err.message; } finally { delete submit.dataset.busy; }
    });
    // deleting: asks first; the server refuses while the community has tournaments
    back.querySelector('#com-s-delete').addEventListener('click', () => guard(back.querySelector('#com-s-delete'), async () => {
      if (!window.confirm(t('com.deleteConfirm', { name: org.name }))) return;
      await api(`/communities/${org.id}`, { method: 'DELETE' });
      toast(t('com.deleted'));
      refreshActingOrg();
      window.location.href = siteUrl('/communities');
    }));
    // a picture is saved at once; the dialog opens again with what was typed so far
    back.querySelectorAll('[data-upload]').forEach((input) => input.addEventListener('change', () => guard(input, async () => {
      if (!input.files[0]) return;
      const kept = typedNow();
      await upload(input.dataset.upload, input.files[0]);
      await load();
      openSettingsDialog(kept);
    })));
    back.querySelectorAll('[data-remove-image]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      const kept = typedNow();
      await api(`/communities/${org.id}/${b.dataset.removeImage}`, { method: 'DELETE' });
      await load();
      openSettingsDialog(kept);
    })));
    back.querySelector('#com-s-name').focus();
  }

  // the news: the posts and the tournaments of the community, the newest first. The posts come in pages, so a tournament older than the last post shown waits
  // until the older posts are loaded.
  function newsItems() {
    const cutoff = posts.more && posts.items.length ? new Date(posts.items[posts.items.length - 1].createdAt).getTime() : 0;
    const list = posts.items.map((p) => ({ at: new Date(p.createdAt).getTime(), html: postHtml(p) }));
    tournaments.filter((s) => s.createdAt && new Date(s.createdAt).getTime() >= cutoff).forEach((s) => {
      const head = comPostHeadHtml({ logo: orgLogoHtml(), name: org.name, by: t(s.kind === 'LEAGUE' ? 'com.feedNewSeason' : 'com.feedNewTournament'), date: dateText(s.createdAt) });
      list.push({ at: new Date(s.createdAt).getTime(), html: comTournamentNewsHtml(s, head) });
    });
    return list.sort((a, b) => b.at - a.at).map((x) => x.html);
  }

  function tabBody() {
    if (tab === 'events') return eventsHtml();
    if (tab === 'ranking') return rankingHtml();
    if (tab === 'info') return infoHtml();
    const news = newsItems();
    return `${news.length ? news.join('') : `<p class="com-empty">${escapeHtml(t('com.noNews'))}</p>`}
      ${posts.more ? `<button type="button" class="btn btn-outline com-small" id="com-older">${escapeHtml(t('com.showOlder'))}</button>` : ''}`;
  }

  // ---------------------------------------------------------------- page

  function render() {
    const typed = keepTyped();
    // only an address the server itself wrote goes into the style of the cover
    const cover = /^\/community-images\/[\w.-]+$/.test(org.coverUrl || '') ? org.coverUrl : '';
    const logo = org.logoUrl ? `<img src="${escapeHtml(org.logoUrl)}" alt="">` : escapeHtml(initials(org.name));
    root.innerHTML = `
      <div class="com-cover${cover ? '' : ' com-cover-empty'}"${cover ? ` style="background-image:url('${escapeHtml(cover)}')"` : ''}></div>
      <div class="com-head">
        <span class="com-logo com-logo-lg">${logo}</span>
        <h1>${escapeHtml(org.name)}${isActing() ? `<button type="button" class="com-gear" data-act="settings" aria-label="${escapeHtml(t('com.settings'))}" title="${escapeHtml(t('com.settings'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>` : ''}</h1>
        <div class="com-sub"><span class="com-badge">${escapeHtml(typeText(org))}</span>${org.city ? `${escapeHtml(org.city)} · ` : ''}${escapeHtml(membersText(org.memberCount))}</div>
        ${org.locked && (org.previewPhotos || []).length ? `<div class="com-faces">${org.previewPhotos.map((u) => `<img src="${escapeHtml(u)}" alt="">`).join('')}</div>` : ''}
        ${org.approved ? `<p class="com-join-info">${escapeHtml(joinInfoText())}</p>` : ''}
        <div class="com-actions" id="com-join">${joinHtml()}${isActing() ? `<button type="button" class="btn com-invite-btn" data-act="invite"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>${escapeHtml(t('com.invite'))}</button><button type="button" class="btn com-invite-btn" data-act="add-members"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/></svg>${escapeHtml(t('com.addMembers'))}</button>` : ''}${org.approved && !org.locked ? clubAppButtonsHtml('btn com-invite-btn', org.name) : ''}</div>
      </div>
      ${org.approved ? '' : `<div class="com-hint-box com-wait">${escapeHtml(t('com.pendingBanner'))}</div>`}
      ${inviteToken && !(org.me && (org.me.status === 'ACTIVE')) ? `<div class="com-hint-box com-invited">${escapeHtml(t('com.invitedBanner', { name: org.name }))}</div>` : ''}
      ${isAdminOfOrg() && !isActing() ? `<div class="com-hint-box"><span>${escapeHtml(t('com.adminHint'))}</span><button type="button" class="btn btn-outline com-small" data-act="switch">${escapeHtml(t('com.switchTitle'))}</button></div>` : ''}
      ${org.locked ? `<p class="com-locked">${escapeHtml(t('com.lockedNote'))}</p>` : ''}
      ${isActing() && !org.locked ? panelHtml() : ''}
      ${org.locked ? '' : `<div class="com-tabs" role="tablist">
        ${[['news', 'com.tabNews'], ['events', 'com.tabEvents'], ['ranking', 'com.tabRanking'], ['info', 'com.tabInfo']]
          .map(([id, key]) => `<button type="button" class="com-tab${tab === id ? ' on' : ''}" data-tab="${id}" role="tab">${escapeHtml(t(key))}</button>`).join('')}
      </div>
      <div id="com-body">${tabBody()}</div>`}`;
    bind();
    restoreTyped(typed);
  }

  async function run(fn) {
    try { await fn(); } catch (err) { toast(err.message); }
  }

  // a button works once while its request runs: a double click would otherwise post the news (or approve a request) twice
  function guard(btn, fn) {
    if (btn.dataset.busy) return Promise.resolve();
    btn.dataset.busy = '1';
    return run(fn).finally(() => { delete btn.dataset.busy; });
  }

  // what an admin has typed (the news, the settings) survives a re-render of the page
  const TYPED = ['com-post-text'];
  const keepTyped = () => TYPED.map((id) => [id, (document.getElementById(id) || {}).value]).filter(([, v]) => v);
  const restoreTyped = (kept) => kept.forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });

  function bind() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      // the hash follows the tab, so a link of the club menu to that very tab still counts as a change
      window.history.replaceState(null, '', `#${tab}`);
      render();
    }));
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'join') {
        requireRealPlayer(() => guard(b, async () => {
          await api(`/communities/${org.id}/join`, { method: 'POST', body: inviteToken ? { inviteToken } : undefined });
          if (inviteToken) window.history.replaceState(null, '', window.location.pathname + window.location.hash); // the invitation is used
          await load();
        }));
      }
      if (act === 'invite') openInviteDialog();
      if (act === 'add-members') openAddMembersDialog();
      if (act === 'cancel-request') guard(b, async () => { await api(`/communities/${org.id}/cancel-request`, { method: 'POST' }); await load(); });
      if (act === 'leave' && window.confirm(t('com.leaveConfirm', { name: org.name }))) {
        guard(b, async () => { await api(`/communities/${org.id}/leave`, { method: 'POST' }); await load(); refreshActingOrg(); });
      }
      if (act === 'new-tournament') openTournamentDialog();
      if (act === 'new-season') openSeasonDialog();
      if (act === 'settings') openSettingsDialog();
      if (act === 'switch') guard(b, async () => { await api('/communities/act-as', { method: 'POST', body: { organisationId: org.id } }); window.location.reload(); });
    }));
    root.querySelectorAll('[data-rank-save]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      const id = b.dataset.rankSave;
      const raw = (root.querySelector(`[data-rank-input="${id}"]`) || {}).value;
      const points = raw === '' || raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(points) || points < 0) { toast(t('com.rankInvalid')); return; }
      ranking = await api(`/communities/${org.id}/ranking/${id}`, { method: 'PUT', body: { points } });
      toast(t('com.rankSaved'));
      render();
    })));
    root.querySelectorAll('[data-edit-post]').forEach((b) => b.addEventListener('click', () => {
      editingPost = Number(b.dataset.editPost);
      render();
      const box = document.getElementById('com-edit-text');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }));
    const editCancel = document.getElementById('com-edit-cancel');
    if (editCancel) editCancel.addEventListener('click', () => { editingPost = null; render(); });
    const editSave = document.getElementById('com-edit-save');
    if (editSave) editSave.addEventListener('click', () => guard(editSave, async () => {
      const saved = await api(`/communities/${org.id}/posts/${editingPost}`, { method: 'PATCH', body: { body: document.getElementById('com-edit-text').value } });
      const post = posts.items.find((x) => x.id === editingPost);
      if (post) { post.body = saved.body; post.editedAt = saved.editedAt; }
      editingPost = null;
      toast(t('com.postEdited'));
      render();
    }));
    root.querySelectorAll('[data-delete-post]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      await api(`/communities/${org.id}/posts/${b.dataset.deletePost}`, { method: 'DELETE' });
      await loadPosts();
      render();
    })));
    const older = document.getElementById('com-older');
    if (older) older.addEventListener('click', () => guard(older, async () => {
      const more = await api(`/communities/${org.id}/posts?before=${posts.items[posts.items.length - 1].id}`);
      posts = { items: posts.items.concat(more.items), more: more.more };
      render();
    }));
    root.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      await api(`/communities/${org.id}/members/${b.dataset.player}`, { method: 'PATCH', body: { role: b.dataset.role } });
      await load();
    })));
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      await api(`/communities/${org.id}/members/${b.dataset.remove}`, { method: 'DELETE' });
      await load();
    })));
    root.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      await api(`/communities/${org.id}/members/${b.dataset.player}/${b.dataset.decide}`, { method: 'POST' });
      await load();
    })));
    const all = document.getElementById('com-approve-all');
    if (all) all.addEventListener('click', () => guard(all, async () => { await api(`/communities/${org.id}/approve-all`, { method: 'POST' }); await load(); }));
    comBindReactions(root, () => org.id);
    comBindComments(root, () => org.id);
    comBindTournaments(root);
    comBindPostMenus(root);
    const post = document.getElementById('com-post-btn');
    if (post) {
      const box = document.getElementById('com-post-text');
      document.getElementById('com-post-emoji').addEventListener('click', (e) => { e.stopPropagation(); comEmojiPanel(e.currentTarget, COM_EMOJI, (emoji) => comInsertAtCursor(box, emoji)); });
      const preview = document.getElementById('com-post-img');
      const showDraft = () => { preview.hidden = !draftImage; preview.innerHTML = draftImage ? draftImageHtml() : ''; const rm = document.getElementById('com-post-img-remove'); if (rm) rm.addEventListener('click', () => { draftImage = ''; showDraft(); }); };
      showDraft();
      const file = document.getElementById('com-post-file');
      file.addEventListener('change', () => guard(file, async () => {
        if (!file.files[0]) return;
        const form = new FormData();
        form.append('image', file.files[0]);
        const res = await fetch(`/api/communities/${org.id}/post-image`, { method: 'POST', body: form });
        const data = await res.json().catch(() => null);
        file.value = '';
        if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
        draftImage = data.url;
        showDraft();
      }));
      post.addEventListener('click', () => guard(post, async () => {
        if (!box.value.trim() && !draftImage) return;
        await api(`/communities/${org.id}/posts`, { method: 'POST', body: { body: box.value, imageUrl: draftImage } });
        box.value = '';
        draftImage = '';
        tab = 'news';
        await loadPosts();
        render();
      }));
    }
  }

  async function loadPosts() { posts = await api(`/communities/${org.id}/posts`); }

  // The event the club bar points to when nothing else says: the running or coming one (soonest first), else the latest finished one (the order of
  // GET /api/communities/my-events). A season is kind LEAGUE.
  function pickCurrentEvent(events, today) {
    const day = (s) => s.endDate || s.startDate || '';
    const over = (s) => !!day(s) && day(s) < today;
    const coming = events.filter((s) => !over(s)).sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999') || a.id - b.id);
    const past = events.filter(over).sort((a, b) => day(b).localeCompare(day(a)) || b.id - a.id);
    return coming[0] || past[0] || null;
  }
  const clubEvent = (s) => {
    const season = s.kind === 'LEAGUE';
    return { slug: s.slug, name: s.name, kind: season ? 'SEASON' : 'TOURNAMENT', path: '/' + (season ? 'season' : 'tournament') + '/' + s.slug }; // (plain text for the storage of the club view, not markup)
  };

  // The club view (bottom bar and top menu of the club, see getClubContext in common.js) starts here. A club view of THIS club keeps the event the player
  // opened; otherwise the club's own pick is used.
  function publishClubView() {
    const prev = getClubContext();
    let event = prev && prev.orgSlug === org.slug && prev.event && tournaments.some((s) => s.slug === prev.event.slug) ? prev.event : null;
    if (!event) {
      const picked = pickCurrentEvent(tournaments, new Date().toISOString().slice(0, 10));
      event = picked ? clubEvent(picked) : null;
    }
    setClubContext({ orgSlug: org.slug, orgName: org.name, logoUrl: org.logoUrl || '', path: '/community/' + org.slug, event });
  }

  let loadRun = 0;
  async function load() {
    const run = ++loadRun;
    try {
      const session = await loadSession();
      loggedIn = !!session.isPlayer && !!session.playerId;
      org = await api(`/communities/${encodeURIComponent(slug)}`);
      // an old address (the community was renamed since the link was made, or just now in the settings): the address bar shows the new one, so a link that is copied
      // from the page (the invitation) has the new name in it
      if (org.slug && org.slug !== slug) {
        const parts = window.location.pathname.replace(/\/+$/, '').split('/');
        parts[parts.length - 1] = encodeURIComponent(org.slug);
        window.history.replaceState(null, '', parts.join('/') + window.location.search + window.location.hash);
        slug = org.slug;
        setClubManifest(slug);
      }
      // a community that decides on every request shows its header only until the player is approved: the server refuses the rest
      if (org.locked) {
        const mine = loggedIn ? await api('/communities/mine') : { acting: null };
        if (run !== loadRun) return;
        members = { members: [], pending: [] };
        posts = { items: [], more: false };
        tournaments = [];
        ranking = { items: [] };
        acting = mine.acting;
        publishClubView();
        render();
        return;
      }
      const [m, p, mineRes, ts, ss, rk, wn] = await Promise.all([
        api(`/communities/${org.id}/members`),
        api(`/communities/${org.id}/posts`),
        loggedIn ? api('/communities/mine') : Promise.resolve({ acting: null }),
        api(`/communities/${org.id}/tournaments`).catch(() => ({ items: [] })),
        api(`/communities/${org.id}/seasons`).catch(() => ({ items: [] })),
        api(`/communities/${org.id}/ranking`).catch(() => ({ items: [] })),
        api(`/winners?organisation=${encodeURIComponent(org.slug)}`).catch(() => []),
      ]);
      if (run !== loadRun) return; // a newer load is on its way
      ranking = rk;
      winners = Array.isArray(wn) ? wn : [];
      members = m;
      posts = p;
      // the events of the club: its tournaments and its seasons together, the latest start first
      tournaments = [...ts.items, ...ss.items].sort((x, y) => (y.startDate || '').localeCompare(x.startDate || '') || y.id - x.id);
      acting = mineRes.acting;
    } catch (err) {
      if (err.status === 404) clearClubContext(); // no such club (any more): no club view either
      root.innerHTML = `<p class="com-empty">${escapeHtml(err.status === 404 || /not found/i.test(err.message) ? t('com.notFound') : err.message)}</p>`;
      return;
    }
    publishClubView();
    render();
  }

  // the links of the club menu: #members and #events open that tab, #settings opens the settings of the club
  const scrollToPanel = () => {
    if (window.location.hash !== '#settings' || !org || !isActing()) return;
    openSettingsDialog();
    window.history.replaceState(null, '', window.location.pathname + window.location.search); // so the link works again the next time
  };
  window.addEventListener('hashchange', () => {
    const next = window.location.hash.slice(1);
    if (tabFromHash(next)) tab = tabFromHash(next);
    if (org) { render(); scrollToPanel(); }
  });
  window.addEventListener('blta:auth-changed', load);
  load().then(scrollToPanel);
})();
