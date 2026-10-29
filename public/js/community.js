// Komunity a kluby: the page of one community or club (/komunita/<slug>, code address /community/<slug>). A cover, the logo, the name, how to join, and three tabs
// (news, events - the tournaments of the club -, info with the members). An admin of the club who has switched to its profile ("acting as", see GET /api/communities/mine) also gets
// the panel of the club: a news box, the requests to join, the settings and the pictures.
// Data: /api/communities/... (src/routes/communities.js).
(function communityPage() {
  const root = document.getElementById('com-page');
  if (!root) return;

  const slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  let org = null;
  let acting = null;
  let loggedIn = false;
  let members = { members: [], pending: [] };
  let posts = { items: [], more: false };
  let tournaments = [];
  // the tabs: News, Events, Info (the members are in Info; the old #members link of the club menu opens it)
  const tabFromHash = (hash) => (hash === 'members' ? 'info' : ['news', 'events', 'info'].includes(hash) ? hash : null);
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
  const isActing = () => !!(acting && org && acting.id === org.id);
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
    return `<button type="button" class="btn btn-join" data-act="join">${escapeHtml(t(org.joinPolicy === 'OPEN' ? 'com.join' : 'com.requestJoin'))}</button>`;
  }

  function postHtml(p) {
    return `
      <div class="com-post" data-post="${p.id}">
        <div class="com-post-head"><b>${escapeHtml(p.authorName)}</b><span>${escapeHtml(dateText(p.createdAt))}</span>
          ${p.canDelete ? `<button type="button" class="com-link" data-delete-post="${p.id}">${escapeHtml(t('com.deletePost'))}</button>` : ''}</div>
        <div class="com-post-body">${escapeHtml(p.body)}</div>
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
          <button type="button" class="btn btn-primary" id="com-post-btn">${escapeHtml(t('com.publish'))}</button>
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
        <div class="com-lab">${escapeHtml(t('com.settings'))}</div>
        <form id="com-settings">
          <div class="field"><label>${escapeHtml(t('com.fieldName'))}</label><input type="text" id="com-s-name" maxlength="120" value="${escapeHtml(org.name)}" required></div>
          <div class="field"><label>${escapeHtml(t('com.fieldDescription'))}</label><textarea id="com-s-description" rows="3" maxlength="2000">${escapeHtml(org.description)}</textarea></div>
          <div class="field"><label>${escapeHtml(t('com.fieldContact'))}</label><input type="text" id="com-s-contact" maxlength="200" value="${escapeHtml(org.contact)}"></div>
          <div class="field"><label>${escapeHtml(t('com.fieldJoin'))}</label>
            <label class="com-radio"><input type="radio" name="com-s-join" value="OPEN"${org.joinPolicy === 'OPEN' ? ' checked' : ''}> ${escapeHtml(t('com.joinOpen'))}</label>
            <label class="com-radio"><input type="radio" name="com-s-join" value="APPROVAL"${org.joinPolicy === 'APPROVAL' ? ' checked' : ''}> ${escapeHtml(t('com.joinApproval'))}</label>
          </div>
          <div id="com-s-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
          <button type="submit" class="btn btn-primary">${escapeHtml(t('com.save'))}</button>
        </form>
        <div class="com-pictures">
          <label class="btn btn-outline com-small">${escapeHtml(t('com.uploadLogo'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="logo" hidden></label>
          <label class="btn btn-outline com-small">${escapeHtml(t('com.uploadCover'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="cover" hidden></label>
          ${org.logoUrl ? `<button type="button" class="com-link" data-remove-image="logo">${escapeHtml(t('com.removeImage'))} (logo)</button>` : ''}
          ${org.coverUrl ? `<button type="button" class="com-link" data-remove-image="cover">${escapeHtml(t('com.removeImage'))} (cover)</button>` : ''}
        </div>
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
      <div class="com-lab">${escapeHtml(t('com.tabMembers'))} (${members.members.length})</div>
      ${members.members.length ? `<div class="com-members">${members.members.map(memberHtml).join('')}</div>` : ''}`;
  }

  // ---- the Events tab: the tournaments of the club (and, for its admin acting as the club, the way to make one and to manage it)
  function tournamentHtml(s) {
    const today = new Date().toISOString().slice(0, 10);
    const over = !!s.endDate && s.endDate < today;
    const open = s.registrationOpen && !over;
    const link = `/tournament/${encodeURIComponent(s.slug)}`;
    const facts = [s.venue, t(s.playType === 'DOUBLES' ? 'com.tDoubles' : 'com.tSingles'), t('com.eventRegistered', { n: s.registrationCount || 0 })].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="com-event${over ? ' over' : ''}">
        <div class="com-event-date">${escapeHtml(rangeText(s.startDate, s.endDate) || t('com.eventNoDate'))}</div>
        <div class="com-event-main"><a class="com-event-name" href="${escapeHtml(link)}">${escapeHtml(s.name)}</a><div class="com-event-sub">${facts}</div></div>
        <div class="com-event-acts">
          ${open ? `<a class="btn btn-primary com-small" href="${escapeHtml(link)}#register">${escapeHtml(t('com.eventRegister'))}</a>` : ''}
          <a class="btn btn-outline com-small" href="${escapeHtml(link)}">${escapeHtml(t('com.eventView'))}</a>
          ${isActing() ? `<a class="btn btn-outline com-small" href="/community-tournament/${s.id}">${escapeHtml(t('com.eventManage'))}</a>` : ''}
        </div>
      </div>`;
  }

  function eventsHtml() {
    const make = isActing() && org.approved ? `<button type="button" class="btn btn-primary com-new-tournament" data-act="new-tournament">+ ${escapeHtml(t('com.newTournament'))}</button>` : '';
    return `${make}${tournaments.length ? `<div class="com-events">${tournaments.map(tournamentHtml).join('')}</div>` : `<p class="com-empty">${escapeHtml(t('com.noEvents'))}</p>`}`;
  }

  // the dialog that makes a tournament of the club: the same few fields the editor of a tournament starts with; the rest is set on its manage page
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
        <label class="com-radio"><input type="checkbox" id="com-t-reg" checked> ${escapeHtml(t('com.tRegOpen'))}</label>
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
        if (back.querySelector('#com-t-reg').checked) await api(`/seasons/${made.id}`, { method: 'PATCH', body: { registrationOpen: true } });
        window.location.href = siteUrl(`/community-tournament/${made.id}`); // (a code address is only turned into the real one by siteUrl, links are rewritten by localize.js)
      } catch (err) { errorEl.textContent = err.message; delete submit.dataset.busy; }
    });
    back.querySelector('#com-t-name').focus();
  }

  function tabBody() {
    if (tab === 'events') return eventsHtml();
    if (tab === 'info') return infoHtml();
    return `${posts.items.length ? posts.items.map(postHtml).join('') : `<p class="com-empty">${escapeHtml(t('com.noNews'))}</p>`}
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
        <h1>${escapeHtml(org.name)}</h1>
        <div class="com-sub"><span class="com-badge">${escapeHtml(typeText(org))}</span>${org.city ? `${escapeHtml(org.city)} · ` : ''}${escapeHtml(membersText(org.memberCount))}</div>
        ${org.approved ? `<p class="com-join-info">${escapeHtml(joinInfoText())}</p>` : ''}
        <div class="com-actions" id="com-join">${joinHtml()}</div>
      </div>
      ${org.approved ? '' : `<div class="com-hint-box com-wait">${escapeHtml(t('com.pendingBanner'))}</div>`}
      ${isAdminOfOrg() && !isActing() ? `<div class="com-hint-box"><span>${escapeHtml(t('com.adminHint'))}</span><button type="button" class="btn btn-outline com-small" data-act="switch">${escapeHtml(t('com.switchTitle'))}</button></div>` : ''}
      ${isActing() ? panelHtml() : ''}
      <div class="com-tabs" role="tablist">
        ${[['news', 'com.tabNews'], ['events', 'com.tabEvents'], ['info', 'com.tabInfo']]
          .map(([id, key]) => `<button type="button" class="com-tab${tab === id ? ' on' : ''}" data-tab="${id}" role="tab">${escapeHtml(t(key))}</button>`).join('')}
      </div>
      <div id="com-body">${tabBody()}</div>`;
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
  const TYPED = ['com-post-text', 'com-s-name', 'com-s-description', 'com-s-contact'];
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
      if (act === 'join') requireRealPlayer(() => guard(b, async () => { await api(`/communities/${org.id}/join`, { method: 'POST' }); await load(); }));
      if (act === 'cancel-request') guard(b, async () => { await api(`/communities/${org.id}/cancel-request`, { method: 'POST' }); await load(); });
      if (act === 'leave' && window.confirm(t('com.leaveConfirm', { name: org.name }))) {
        guard(b, async () => { await api(`/communities/${org.id}/leave`, { method: 'POST' }); await load(); refreshActingOrg(); });
      }
      if (act === 'new-tournament') openTournamentDialog();
      if (act === 'switch') guard(b, async () => { await api('/communities/act-as', { method: 'POST', body: { organisationId: org.id } }); window.location.reload(); });
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
    const post = document.getElementById('com-post-btn');
    if (post) {
      post.addEventListener('click', () => guard(post, async () => {
        const box = document.getElementById('com-post-text');
        if (!box.value.trim()) return;
        await api(`/communities/${org.id}/posts`, { method: 'POST', body: { body: box.value } });
        box.value = '';
        tab = 'news';
        await loadPosts();
        render();
      }));
    }
    const settings = document.getElementById('com-settings');
    if (settings) {
      settings.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submit = settings.querySelector('button[type="submit"]');
        if (submit.dataset.busy) return;
        submit.dataset.busy = '1';
        const errorEl = document.getElementById('com-s-error');
        errorEl.textContent = '';
        try {
          await api(`/communities/${org.id}`, {
            method: 'PATCH',
            body: {
              name: document.getElementById('com-s-name').value,
              description: document.getElementById('com-s-description').value,
              contact: document.getElementById('com-s-contact').value,
              joinPolicy: settings.querySelector('input[name="com-s-join"]:checked').value,
            },
          });
          toast(t('com.saved'));
          await load();
          refreshActingOrg(); // the chip and the switcher show the new name
        } catch (err) { errorEl.textContent = err.message; } finally { delete submit.dataset.busy; }
      });
    }
    root.querySelectorAll('[data-upload]').forEach((input) => input.addEventListener('change', () => guard(input, async () => {
      if (!input.files[0]) return;
      await upload(input.dataset.upload, input.files[0]);
      await load();
    })));
    root.querySelectorAll('[data-remove-image]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
      await api(`/communities/${org.id}/${b.dataset.removeImage}`, { method: 'DELETE' });
      await load();
    })));
  }

  async function loadPosts() { posts = await api(`/communities/${org.id}/posts`); }

  let loadRun = 0;
  async function load() {
    const run = ++loadRun;
    try {
      const session = await loadSession();
      loggedIn = !!session.isPlayer && !!session.playerId;
      org = await api(`/communities/${encodeURIComponent(slug)}`);
      const [m, p, mineRes, ts] = await Promise.all([
        api(`/communities/${org.id}/members`),
        api(`/communities/${org.id}/posts`),
        loggedIn ? api('/communities/mine') : Promise.resolve({ acting: null }),
        api(`/communities/${org.id}/tournaments`).catch(() => ({ items: [] })),
      ]);
      if (run !== loadRun) return; // a newer load is on its way
      members = m;
      posts = p;
      tournaments = ts.items;
      acting = mineRes.acting;
    } catch (err) {
      root.innerHTML = `<p class="com-empty">${escapeHtml(err.status === 404 || /not found/i.test(err.message) ? t('com.notFound') : err.message)}</p>`;
      return;
    }
    render();
  }

  // the links of the club menu: #members and #events open that tab, #settings takes the admin to the panel of the club
  const scrollToPanel = () => {
    if (window.location.hash !== '#settings') return;
    const panel = root.querySelector('.com-panel');
    if (panel) panel.scrollIntoView();
  };
  window.addEventListener('hashchange', () => {
    const next = window.location.hash.slice(1);
    if (tabFromHash(next)) tab = tabFromHash(next);
    if (org) { render(); scrollToPanel(); }
  });
  window.addEventListener('blta:auth-changed', load);
  load().then(scrollToPanel);
})();
