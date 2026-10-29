// Komunity a kluby (communities and clubs): the list page (/komunity-a-kluby, code address /communities). Four tabs - the Feed (the news of the communities and clubs
// the player has joined), everybody's communities and clubs (Discover), the ones the logged-in player belongs to (Mine) and the events of them (not there yet) - and a
// button that opens the form to make a new one.
// Data: GET /api/communities, GET /api/communities/mine, GET /api/communities/feed, POST /api/communities (src/routes/communities.js).
(function communitiesPage() {
  const root = document.getElementById('com-root');
  if (!root) return;

  let tab = 'feed';
  let items = [];
  let currentLeagueId = null;
  // the filters of the Discover tab: a search text, the kind and the city (the city of the page unless he picks another or all)
  const filters = { q: '', type: '', city: null };
  let mine = [];
  let feed = { items: [], more: false, next: null };
  let loggedIn = false;

  const goTo = (path) => { window.location.href = window.BLTA_LOCALIZE && BLTA_LOCALIZE.localUrl ? BLTA_LOCALIZE.localUrl(path) : path; };
  // the first letters of the first two words (a lone dash or an ampersand is not a word)
  const initials = (name) => String(name || '?').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
  // Slovak: 1 člen, 2-4 členovia, 5 členov
  const membersText = (n) => (n === 1 ? t('com.membersOne') : n >= 2 && n <= 4 ? t('com.membersFew', { n }) : t('com.membersN', { n }));
  const typeText = (o) => (o.type === 'CLUB' ? t('com.typeClub') : t('com.typeCommunity'));

  function logoHtml(o) {
    return o.logoUrl
      ? `<span class="com-logo"><img src="${escapeHtml(o.logoUrl)}" alt=""></span>`
      : `<span class="com-logo">${escapeHtml(initials(o.name))}</span>`;
  }

  function cardHtml(o) {
    return `
      <a class="com-card" href="/community/${encodeURIComponent(o.slug)}">
        ${logoHtml(o)}
        <span class="com-card-body">
          <span class="com-card-name">${escapeHtml(o.name)}</span>
          <span class="com-card-meta"><span class="com-badge">${escapeHtml(typeText(o))}</span><span class="com-badge ${o.joinPolicy === 'OPEN' ? 'com-badge-open' : 'com-badge-approval'}">${escapeHtml(t(o.joinPolicy === 'OPEN' ? 'com.cardOpen' : 'com.cardApproval'))}</span>${o.approved ? '' : `<span class="com-badge com-badge-wait">${escapeHtml(t('com.pendingApproval'))}</span>`}${o.city ? escapeHtml(o.city) : ''}</span>
        </span>
        <span class="com-card-count">${escapeHtml(membersText(o.memberCount))}</span>
      </a>`;
  }

  const dateText = (iso) => new Date(iso).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' });

  const dayText = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
  const rangeText = (a, b) => (a && b && a !== b ? `${dayText(a)} – ${dayText(b)}` : dayText(a || b));

  // a tournament made by one of his communities: what it is, when and where, and the way to its page (and to register while it is open)
  function feedTournamentHtml(p) {
    const link = `/tournament/${encodeURIComponent(p.slug)}`;
    const facts = [rangeText(p.startDate, p.endDate), p.venue, t(p.playType === 'DOUBLES' ? 'com.tDoubles' : 'com.tSingles')].filter(Boolean).map(escapeHtml).join(' · ');
    const over = !!p.endDate && p.endDate < new Date().toISOString().slice(0, 10);
    return `
      <div class="com-post com-feed-post com-feed-tournament">
        <a class="com-feed-head" href="/community/${encodeURIComponent(p.organisation.slug)}">
          ${logoHtml(p.organisation)}
          <span class="com-feed-from"><b>${escapeHtml(p.organisation.name)}</b><span class="com-badge">${escapeHtml(typeText(p.organisation))}</span></span>
          <span class="com-feed-date">${escapeHtml(dateText(p.createdAt))}</span>
        </a>
        <div class="com-feed-kicker">${escapeHtml(t('com.feedNewTournament'))}</div>
        <a class="com-feed-tname" href="${escapeHtml(link)}">${escapeHtml(p.name)}</a>
        <div class="com-feed-facts">${facts}</div>
        <div class="com-feed-acts">
          ${p.registrationOpen && !over ? `<a class="btn btn-join com-small" href="${escapeHtml(link)}#register">${escapeHtml(t('com.eventRegister'))}</a>` : ''}
          <a class="btn btn-outline com-small" href="${escapeHtml(link)}">${escapeHtml(t('com.eventView'))}</a>
        </div>
      </div>`;
  }

  // one news item of the feed: the community it comes from (logo, name, kind), when, who wrote it, the text
  function feedPostHtml(p) {
    if (p.type === 'TOURNAMENT') return feedTournamentHtml(p);
    return `
      <div class="com-post com-feed-post" data-post="${p.id}" data-org="${p.organisation.id}">
        <a class="com-feed-head" href="/community/${encodeURIComponent(p.organisation.slug)}">
          ${logoHtml(p.organisation)}
          <span class="com-feed-from"><b>${escapeHtml(p.organisation.name)}</b><span class="com-badge">${escapeHtml(typeText(p.organisation))}</span></span>
          <span class="com-feed-date">${escapeHtml(dateText(p.createdAt))}</span>
        </a>
        ${p.body ? `<div class="com-post-body">${comPostText(p.body)}</div>` : ''}
        ${comPostImage(p.imageUrl)}
        ${comReactionsHtml(p)}
      </div>`;
  }

  // the Feed: the news of the communities he has joined; without any, a way to Discover and a few communities to start with; logged out, a login prompt
  function feedHtml() {
    if (!loggedIn) {
      return `<div class="com-feed-empty"><p class="com-empty">${escapeHtml(t('com.feedLogin'))}</p>
        <button type="button" class="btn btn-join" id="com-login-btn">${escapeHtml(t('nav.loginPlayer'))}</button></div>`;
    }
    if (feed.items.length) {
      return `${feed.items.map(feedPostHtml).join('')}${feed.more ? `<button type="button" class="btn btn-outline com-small" id="com-feed-older">${escapeHtml(t('com.showOlder'))}</button>` : ''}`;
    }
    const joined = new Set(mine.map((o) => o.id));
    const suggested = items.filter((o) => o.approved && !joined.has(o.id) && o.leagueId === currentLeagueId).slice(0, 5);
    return `
      <div class="com-feed-empty">
        <span class="com-feed-icon" aria-hidden="true">${courtIcon('group')}</span>
        <h3>${escapeHtml(t('com.feedEmptyTitle'))}</h3>
        <p class="com-empty">${escapeHtml(t('com.feedEmptyText'))}</p>
        <button type="button" class="btn btn-join" id="com-explore-btn">${escapeHtml(t('com.feedExplore'))}</button>
      </div>
      ${suggested.length ? `<div class="com-lab">${escapeHtml(t('com.feedSuggested'))}</div>${listHtml(suggested, 'com.empty')}` : ''}`;
  }

  // plain text for the search: no accents, no capitals
  const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = () => {
    const q = plain(filters.q).trim();
    return items.filter((o) => (!filters.type || o.type === filters.type)
      && (filters.city === '' || String(o.leagueId) === String(filters.city))
      && (!q || plain([o.name, o.description, o.city].join(' ')).includes(q)));
  };
  function discoverHtml() {
    if (filters.city === null) filters.city = items.some((o) => o.leagueId === currentLeagueId) ? String(currentLeagueId) : '';
    const cities = [...new Map(items.map((o) => [o.leagueId, o.city])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'sk'));
    return `<div class="filters com-filters">
      <input type="search" id="com-f-search" class="com-f-search" maxlength="60" placeholder="${escapeHtml(t('com.filterSearch'))}" value="${escapeHtml(filters.q)}" autocomplete="off">
      <select id="com-f-type" aria-label="${escapeHtml(t('com.filterAllTypes'))}">
        <option value="">${escapeHtml(t('com.filterAllTypes'))}</option>
        <option value="COMMUNITY"${filters.type === 'COMMUNITY' ? ' selected' : ''}>${escapeHtml(t('com.filterCommunities'))}</option>
        <option value="CLUB"${filters.type === 'CLUB' ? ' selected' : ''}>${escapeHtml(t('com.filterClubs'))}</option>
      </select>
      <select id="com-f-city" aria-label="${escapeHtml(t('com.filterAllCities'))}">
        <option value="">${escapeHtml(t('com.filterAllCities'))}</option>
        ${cities.map(([id, name]) => `<option value="${id}"${String(filters.city) === String(id) ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-outline" id="com-f-reset"><span style="color:var(--orange)">✕</span> ${escapeHtml(t('filters.reset'))}</button>
    </div>
    <div id="com-discover-list">${listHtml(filtered(), items.length ? 'com.filterNone' : 'com.empty')}</div>`;
  }

  function listHtml(list, emptyKey) {
    return list.length ? `<div class="com-list">${list.map(cardHtml).join('')}</div>` : `<p class="com-empty">${escapeHtml(t(emptyKey))}</p>`;
  }

  function render() {
    const body = tab === 'feed' ? feedHtml()
      : tab === 'discover' ? discoverHtml()
      : tab === 'mine' ? (loggedIn ? listHtml(mine, 'com.emptyMine') : `<p class="com-empty">${escapeHtml(t('com.emptyMine'))}</p><button type="button" class="btn btn-join" id="com-login-btn">${escapeHtml(t('nav.loginPlayer'))}</button>`)
        : `<p class="com-empty">${escapeHtml(t('com.emptyEvents'))}</p>`;
    root.innerHTML = `
      <div class="com-tabs" role="tablist">
        ${[['feed', 'com.tabFeed'], ['discover', 'com.tabDiscover'], ['mine', 'com.tabMine'], ['events', 'com.tabEvents']]
          .map(([id, key]) => `<button type="button" class="com-tab${tab === id ? ' on' : ''}" data-tab="${id}" role="tab">${escapeHtml(t(key))}</button>`).join('')}
      </div>
      ${tab === 'mine' ? `<div class="com-lab">${escapeHtml(t('com.mineTitle'))}</div>` : ''}
      ${body}
      <button type="button" class="btn btn-primary com-create" id="com-create-btn">＋ ${escapeHtml(t('com.create'))}</button>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    comBindReactions(root, (el) => el.dataset.org);
    // the Discover filters change the list only (the search box keeps the focus)
    const refilter = () => { document.getElementById('com-discover-list').innerHTML = listHtml(filtered(), items.length ? 'com.filterNone' : 'com.empty'); };
    const fSearch = document.getElementById('com-f-search');
    if (fSearch) {
      fSearch.addEventListener('input', () => { filters.q = fSearch.value; refilter(); });
      document.getElementById('com-f-type').addEventListener('change', (e) => { filters.type = e.target.value; refilter(); });
      document.getElementById('com-f-city').addEventListener('change', (e) => { filters.city = e.target.value; refilter(); });
      document.getElementById('com-f-reset').addEventListener('click', () => { filters.q = ''; filters.type = ''; filters.city = ''; render(); });
    }
    document.getElementById('com-create-btn').addEventListener('click', () => requireRealPlayer(openCreate));
    const loginBtn = document.getElementById('com-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', () => requireRealPlayer(() => {}));
    const explore = document.getElementById('com-explore-btn');
    if (explore) explore.addEventListener('click', () => { tab = 'discover'; render(); });
    const older = document.getElementById('com-feed-older');
    if (older) {
      older.addEventListener('click', async () => {
        if (older.disabled) return;
        older.disabled = true;
        try {
          const more = await api(`/communities/feed?before=${encodeURIComponent(feed.next)}`);
          feed = { items: feed.items.concat(more.items), more: more.more, next: more.next };
          render();
        } catch { older.disabled = false; }
      });
    }
  }

  function openCreate() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.style.display = 'flex';
    back.innerHTML = `
      <div class="modal">
        <button type="button" class="close" aria-label="Close">&times;</button>
        <h3 style="margin-top:0">${escapeHtml(t('com.createTitle'))}</h3>
        <form id="com-form">
          <div class="field"><label>${escapeHtml(t('com.fieldType'))}</label>
            <label class="com-radio"><input type="radio" name="com-type" value="CLUB" checked> ${escapeHtml(t('com.typeClub'))}</label>
            <label class="com-radio"><input type="radio" name="com-type" value="COMMUNITY"> ${escapeHtml(t('com.typeCommunity'))}</label>
          </div>
          <p class="com-hint" id="com-club-note" style="margin:-6px 0 12px">${escapeHtml(t('com.clubNote'))}</p>
          <div class="field"><label>${escapeHtml(t('com.fieldName'))}</label><input type="text" id="com-name" maxlength="120" required></div>
          <div class="field"><label>${escapeHtml(t('com.fieldDescription'))}</label><textarea id="com-description" rows="3" maxlength="2000"></textarea></div>
          <div class="field"><label>${escapeHtml(t('com.fieldContact'))}</label><input type="text" id="com-contact" maxlength="200"></div>
          <div class="field"><label>${escapeHtml(t('com.fieldJoin'))}</label>
            <label class="com-radio"><input type="radio" name="com-join" value="OPEN" checked> ${escapeHtml(t('com.joinOpen'))}</label>
            <label class="com-radio"><input type="radio" name="com-join" value="APPROVAL"> ${escapeHtml(t('com.joinApproval'))}</label>
          </div>
          <div id="com-error" style="color:var(--danger);font-weight:600;margin-bottom:8px"></div>
          <button type="submit" class="btn btn-primary btn-block">${escapeHtml(t('com.createSubmit'))}</button>
        </form>
      </div>`;
    // only a club has to be approved: the note is shown for it only
    const note = back.querySelector('#com-club-note');
    const showNote = () => { note.style.display = back.querySelector('input[name="com-type"]:checked').value === 'CLUB' ? '' : 'none'; };
    back.querySelectorAll('input[name="com-type"]').forEach((r) => r.addEventListener('change', showNote));
    showNote();
    const close = () => back.remove();
    back.querySelector('.close').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('#com-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = back.querySelector('button[type="submit"]');
      if (submit.disabled) return; // a double tap would make two clubs
      submit.disabled = true;
      const errorEl = back.querySelector('#com-error');
      errorEl.textContent = '';
      try {
        const created = await api('/communities', {
          method: 'POST',
          body: {
            type: back.querySelector('input[name="com-type"]:checked').value,
            name: back.querySelector('#com-name').value,
            description: back.querySelector('#com-description').value,
            contact: back.querySelector('#com-contact').value,
            joinPolicy: back.querySelector('input[name="com-join"]:checked').value,
          },
        });
        goTo(`/community/${encodeURIComponent(created.slug)}`);
      } catch (err) {
        errorEl.textContent = err.message;
        submit.disabled = false;
      }
    });
    document.body.appendChild(back);
    back.querySelector('#com-name').focus();
  }

  async function load() {
    try {
      const session = await loadSession();
      loggedIn = !!session.isPlayer && !!session.playerId;
      const all = await api('/communities?scope=all');
      items = all.items;
      currentLeagueId = all.currentLeagueId;
      mine = loggedIn ? (await api('/communities/mine')).items : [];
      feed = loggedIn ? await api('/communities/feed') : { items: [], more: false, next: null };
    } catch (err) {
      root.innerHTML = `<p class="com-empty">${escapeHtml(err.message)}</p>`;
      return;
    }
    render();
  }

  window.addEventListener('blta:auth-changed', load);
  load();
})();
