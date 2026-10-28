// Komunity a kluby (communities and clubs): the list page (/komunity-a-kluby, code address /communities). Three tabs - everybody's communities and clubs
// (Discover), the ones the logged-in player belongs to (Mine) and the events of them (not there yet) - and a button that opens the form to make a new one.
// Data: GET /api/communities, GET /api/communities/mine, POST /api/communities (src/routes/communities.js).
(function communitiesPage() {
  const root = document.getElementById('com-root');
  if (!root) return;

  let tab = 'discover';
  let items = [];
  let mine = [];
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
          <span class="com-card-meta"><span class="com-badge">${escapeHtml(typeText(o))}</span>${o.approved ? '' : `<span class="com-badge com-badge-wait">${escapeHtml(t('com.pendingApproval'))}</span>`}${o.city ? escapeHtml(o.city) : ''}</span>
        </span>
        <span class="com-card-count">${escapeHtml(membersText(o.memberCount))}</span>
      </a>`;
  }

  function listHtml(list, emptyKey) {
    return list.length ? `<div class="com-list">${list.map(cardHtml).join('')}</div>` : `<p class="com-empty">${escapeHtml(t(emptyKey))}</p>`;
  }

  function render() {
    const body = tab === 'discover' ? listHtml(items, 'com.empty')
      : tab === 'mine' ? (loggedIn ? listHtml(mine, 'com.emptyMine') : `<p class="com-empty">${escapeHtml(t('com.emptyMine'))}</p><button type="button" class="btn btn-outline" id="com-login-btn">${escapeHtml(t('nav.loginPlayer'))}</button>`)
        : `<p class="com-empty">${escapeHtml(t('com.emptyEvents'))}</p>`;
    root.innerHTML = `
      <div class="com-tabs" role="tablist">
        ${[['discover', 'com.tabDiscover'], ['mine', 'com.tabMine'], ['events', 'com.tabEvents']]
          .map(([id, key]) => `<button type="button" class="com-tab${tab === id ? ' on' : ''}" data-tab="${id}" role="tab">${escapeHtml(t(key))}</button>`).join('')}
      </div>
      ${tab === 'mine' ? `<div class="com-lab">${escapeHtml(t('com.mineTitle'))}</div>` : ''}
      ${body}
      <button type="button" class="btn btn-primary com-create" id="com-create-btn">＋ ${escapeHtml(t('com.create'))}</button>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    document.getElementById('com-create-btn').addEventListener('click', () => requirePlayerAuth(openCreate));
    const loginBtn = document.getElementById('com-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', () => requirePlayerAuth(() => {}));
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
      items = (await api('/communities')).items;
      mine = loggedIn ? (await api('/communities/mine')).items : [];
    } catch (err) {
      root.innerHTML = `<p class="com-empty">${escapeHtml(err.message)}</p>`;
      return;
    }
    render();
  }

  window.addEventListener('blta:auth-changed', load);
  load();
})();
