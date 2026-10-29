// Správy / Messages: the page of the private chats (/spravy, /konverzacia/<id>, code address /messages). On a computer two panes - the inbox (tabs Main and
// Requests, a "+" to write to somebody) and the chat; on a phone one at a time. A first message from a stranger waits in Requests until it is accepted.
// Data: /api/messages/... (src/routes/messages.js); live: the events dm:message, dm:unread and dm:removed of the player's own room (server.js).
// Everything a player wrote (a name, a message) goes through escapeHtml before it reaches the page.
(function messagesPage() {
  const root = document.getElementById('msg-root');
  if (!root) return;

  let loggedIn = false;
  let myId = null;
  let initializing = false;
  let tab = 'main';
  let lists = { main: [], requests: [] };
  let counts = { main: 0, requests: 0 };
  let inboxState = 'loading'; // loading | ready | error
  let route = parseRoute();
  let chat = null; // { id, conv, items, more } of the open conversation
  let socket = null;
  let sending = false;
  let inboxTimer = null;
  let searchTimer = null;
  let searchSeq = 0;
  let layoutEl = null;

  // ---------------------------------------------------------------- helpers

  const locale = () => (currentLang === 'en' ? 'en-GB' : 'sk-SK');
  const initials = (name) => String(name || '?').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const clock = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric' });
  const listTime = (iso) => (sameDay(new Date(iso), new Date()) ? clock(iso) : new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' }));

  // the text of an error in the language of the page (the server's own messages are English)
  function errorText(err, fallbackKey) {
    const byStatus = { 409: 'msg.errWait', 429: 'msg.errFast', 403: 'msg.errBlocked', 400: 'msg.errInvalid' };
    return byStatus[err && err.status] ? t(byStatus[err.status]) : t(fallbackKey || 'msg.sendError');
  }

  // /spravy (list), /konverzacia/12 (a chat), /konverzacia/new (write to somebody); in English /messages and /chat/12
  function parseRoute() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (/^\d+$/.test(last)) return { view: 'chat', id: Number(last) };
    if (last === 'new' && parts.length > 1) return { view: 'new' };
    return { view: 'list' };
  }

  function go(path, replace) {
    const url = typeof siteUrl === 'function' ? siteUrl(path) : path;
    if (new URL(url, window.location.origin).pathname === window.location.pathname) return; // already there: no new history entry, no re-render
    // an entry opened from the list remembers it, so the back arrow of the page can simply go back (the history does not grow)
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState({ fromList: route.view === 'list' }, '', url);
    route = parseRoute();
    showRoute();
  }
  const goBack = () => {
    if (window.history.state && window.history.state.fromList) window.history.back();
    else go('/messages', true);
  };

  // the text of a message: cut into plain pieces and http(s) addresses, every piece escaped (nothing but http and https ever becomes a link; a quote or
  // a bracket ends an address, so it cannot reach into the attribute)
  function linkify(text) {
    const re = /\bhttps?:\/\/[^\s<>"']+/gi;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      let url = m[0];
      const trail = (url.match(/[.,;:!?)\]]+$/) || [''])[0];
      if (trail) url = url.slice(0, -trail.length);
      out += `${escapeHtml(text.slice(last, m.index))}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>${escapeHtml(trail)}`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }

  const avatar = (p) => (p && p.photoUrl ? `<span class="msg-av"><img src="${escapeHtml(p.photoUrl)}" alt=""></span>` : `<span class="msg-av">${escapeHtml(initials(p && p.name))}</span>`);

  // what the player has typed in the box survives a re-render of the chat
  const keepDraft = () => { const el = document.getElementById('msg-input'); return el ? { value: el.value, focus: document.activeElement === el } : null; };
  const restoreDraft = (draft) => {
    const el = document.getElementById('msg-input');
    if (!draft || !el) return;
    if (draft.value) { el.value = draft.value; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }
    if (draft.focus && !el.disabled) el.focus();
  };

  // ---------------------------------------------------------------- inbox

  function rowHtml(c) {
    const last = c.lastMessage;
    return `
      <button type="button" class="msg-row${chat && chat.id === c.id ? ' on' : ''}" data-open="${c.id}">
        ${avatar(c.other)}
        <span class="msg-row-body">
          <span class="msg-row-top"><b>${escapeHtml(c.other ? c.other.name : '')}</b><span class="msg-row-time">${escapeHtml(listTime(last.createdAt))}</span></span>
          <span class="msg-row-last">${escapeHtml(last.body)}</span>
        </span>
        ${c.unread ? `<span class="msg-badge">${c.unread}</span>` : ''}
      </button>`;
  }

  function listBody(list) {
    if (inboxState === 'loading') return '';
    if (inboxState === 'error') return `<p class="msg-empty">${escapeHtml(t('msg.loadError'))}</p>`;
    return list.length ? list.map(rowHtml).join('') : `<p class="msg-empty">${escapeHtml(t(tab === 'requests' ? 'msg.emptyRequests' : 'msg.emptyMain'))}</p>`;
  }

  function renderSide() {
    const side = document.getElementById('msg-side');
    if (!side) return;
    const list = tab === 'requests' ? lists.requests : lists.main;
    side.innerHTML = `
      <div class="msg-side-head"><h1>${escapeHtml(t('msg.heading'))}</h1><button type="button" class="msg-plus" id="msg-plus" aria-label="${escapeHtml(t('msg.newMessage'))}">+</button></div>
      <div class="msg-tabs" role="tablist">
        <button type="button" class="msg-tab${tab === 'main' ? ' on' : ''}" data-tab="main" role="tab" aria-selected="${tab === 'main'}">${escapeHtml(t('msg.tabMain'))}${counts.main ? `<span class="msg-badge">${counts.main}</span>` : ''}</button>
        <button type="button" class="msg-tab${tab === 'requests' ? ' on' : ''}" data-tab="requests" role="tab" aria-selected="${tab === 'requests'}">${escapeHtml(t('msg.tabRequests'))}${counts.requests ? `<span class="msg-badge">${counts.requests}</span>` : ''}</button>
      </div>
      <div class="msg-list">${listBody(list)}</div>`;
    side.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderSide(); }));
    side.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go(`/messages/${b.dataset.open}`)));
    document.getElementById('msg-plus').addEventListener('click', () => go('/messages/new'));
  }

  // the badge on the "Správy" item of the main menu (common.js) follows the count of this page
  const tellMenu = () => window.dispatchEvent(new CustomEvent('msg:unread', { detail: counts }));

  async function loadInbox() {
    try {
      const [main, requests, unread] = await Promise.all([api('/messages/conversations?box=main'), api('/messages/conversations?box=requests'), api('/messages/unread')]);
      lists = { main: main.items, requests: requests.items };
      counts = unread;
      inboxState = 'ready';
    } catch {
      inboxState = lists.main.length || lists.requests.length ? 'ready' : 'error'; // what we already have stays
    }
    renderSide();
    tellMenu();
  }
  const loadInboxSoon = () => { clearTimeout(inboxTimer); inboxTimer = setTimeout(loadInbox, 150); };

  // ---------------------------------------------------------------- the chat

  // an invitation to a community or club: its card with what the viewer can do (join at once, he is a member, it was sent, it is no longer valid)
  function inviteHtml(m) {
    const inv = m.invite;
    const org = inv.organisation;
    const kind = org && org.type === 'CLUB' ? t('com.typeClub') : t('com.typeCommunity');
    const from = chat && chat.conv && chat.conv.other ? chat.conv.other.name : '';
    const link = org ? siteUrl(`/community/${encodeURIComponent(org.slug)}`) : '#';
    const act = inv.status === 'INVITED' ? `<button type="button" class="btn btn-join com-small" data-invite-join="${org.id}">${escapeHtml(t('msg.inviteJoin'))}</button>`
      : inv.status === 'MEMBER' ? `<span class="msg-invite-state">✓ ${escapeHtml(t('msg.inviteMember'))}</span>`
        : inv.status === 'SENT' ? `<span class="msg-invite-state">${escapeHtml(t('msg.inviteSent'))}</span>`
          : `<span class="msg-invite-state">${escapeHtml(t('msg.inviteGone'))}</span>`;
    return `<div class="msg-invite">
      ${m.mine ? '' : `<span class="msg-text">${escapeHtml(t('msg.inviteText', { name: from, type: kind, org: org ? org.name : '' }))}</span>`}
      <a class="msg-invite-card" href="${escapeHtml(link)}"><span class="com-logo">${org && org.logoUrl ? `<img src="${escapeHtml(org.logoUrl)}" alt="">` : escapeHtml(String(org ? org.name : '?').trim().charAt(0).toUpperCase())}</span><b>${escapeHtml(org ? org.name : '')}</b><small>${escapeHtml(kind)}</small></a>
      ${act}</div>`;
  }

  // the request to approve a new club: the club on a card, and the button for the player who may approve it
  function approvalHtml(m) {
    const ap = m.approval;
    const org = ap.organisation;
    const from = chat && chat.conv && chat.conv.other ? chat.conv.other.name : '';
    const act = ap.status === 'WAITING' ? `<button type="button" class="btn btn-join com-small" data-approval-approve="${org.id}">${escapeHtml(t('msg.approvalApprove'))}</button>`
      : ap.status === 'APPROVED' ? `<span class="msg-invite-state">✓ ${escapeHtml(t('msg.approvalApproved'))}</span>`
        : ap.status === 'SENT' ? `<span class="msg-invite-state">${escapeHtml(t('msg.approvalSent'))}</span>`
          : `<span class="msg-invite-state">${escapeHtml(t('msg.approvalGone'))}</span>`;
    return `<div class="msg-invite">
      ${m.mine ? '' : `<span class="msg-text">${escapeHtml(t('msg.approvalText', { name: from, org: org ? org.name : '' }))}</span>`}
      <div class="msg-invite-card"><span class="com-logo">${org && org.logoUrl ? `<img src="${escapeHtml(org.logoUrl)}" alt="">` : escapeHtml(String(org ? org.name : '?').trim().charAt(0).toUpperCase())}</span><b>${escapeHtml(org ? org.name : '')}</b><small>${escapeHtml(t('com.typeClub'))}</small></div>
      ${act}</div>`;
  }

  function bubblesHtml(items) {
    let out = '';
    let day = null;
    items.forEach((m) => {
      const d = new Date(m.createdAt);
      if (!day || !sameDay(day, d)) { out += `<div class="msg-day">${escapeHtml(dayLabel(m.createdAt))}</div>`; day = d; }
      out += `<div class="msg-bubble${m.mine ? ' mine' : ''}" data-id="${m.id}">${m.invite ? inviteHtml(m) : m.approval ? approvalHtml(m) : `<span class="msg-text">${linkify(m.body)}</span>`}<span class="msg-time">${escapeHtml(clock(m.createdAt))}</span></div>`;
    });
    return out;
  }

  function footerHtml() {
    const conv = chat.conv;
    const name = conv.other ? conv.other.name : '';
    if (conv.state === 'REQUEST') {
      return `<div class="msg-request"><div><b>${escapeHtml(t('msg.requestBanner', { name }))}</b><span>${escapeHtml(t('msg.requestHint'))}</span></div>
        <div class="msg-request-acts"><button type="button" class="btn btn-primary" id="msg-accept">${escapeHtml(t('msg.accept'))}</button><button type="button" class="btn btn-outline" id="msg-decline">${escapeHtml(t('msg.decline'))}</button></div></div>`;
    }
    const left = conv.requestAllowanceLeft;
    const note = left === null ? '' : left === 0 ? t('msg.waiting', { name }) : t('msg.allowance', { n: left, name });
    return `${note ? `<p class="msg-note" id="msg-note">${escapeHtml(note)}</p>` : ''}
      <div class="msg-error" id="msg-error" role="alert"></div>
      <form class="msg-compose" id="msg-form">
        <textarea id="msg-input" rows="1" maxlength="2000" aria-label="${escapeHtml(t('msg.messagePlaceholder'))}" placeholder="${escapeHtml(t('msg.messagePlaceholder'))}"${left === 0 ? ' disabled' : ''}></textarea>
        <button type="submit" class="msg-send" id="msg-send" aria-label="${escapeHtml(t('msg.send'))}"${left === 0 ? ' disabled' : ''}>➤</button>
      </form>`;
  }

  function renderChat() {
    const main = document.getElementById('msg-main');
    if (!main || !chat) return;
    const draft = keepDraft();
    const other = chat.conv.other;
    main.innerHTML = `
      <div class="msg-chat-head">
        <button type="button" class="msg-back" id="msg-back" aria-label="${escapeHtml(t('msg.back'))}">←</button>
        ${avatar(other)}
        ${other ? `<a class="msg-chat-name" href="/player/${encodeURIComponent(other.slug || other.playerId)}">${escapeHtml(other.name)}</a>` : ''}
      </div>
      <div class="msg-scroll" id="msg-scroll">
        ${chat.more ? `<button type="button" class="btn btn-outline msg-older" id="msg-older">${escapeHtml(t('msg.showOlder'))}</button>` : ''}
        <div id="msg-bubbles" aria-live="polite">${bubblesHtml(chat.items)}</div>
      </div>
      <div class="msg-footer" id="msg-footer">${footerHtml()}</div>`;
    bindChat();
    restoreDraft(draft);
    const scroll = document.getElementById('msg-scroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  function renderFooter() {
    const footer = document.getElementById('msg-footer');
    if (!footer || !chat) return;
    const draft = keepDraft();
    footer.innerHTML = footerHtml();
    bindFooter();
    restoreDraft(draft);
  }

  function appendMessage(m) {
    if (!chat || chat.items.some((x) => x.id === m.id)) return false;
    chat.items.push(m);
    const holder = document.getElementById('msg-bubbles');
    const scroll = document.getElementById('msg-scroll');
    if (!holder || !scroll) return true;
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
    holder.innerHTML = bubblesHtml(chat.items);
    if (nearBottom || m.mine) scroll.scrollTop = scroll.scrollHeight;
    return true;
  }

  function showError(message) {
    const el = document.getElementById('msg-error');
    if (el) el.textContent = message || '';
  }

  // the conversation as the server sees it now (the state of the request and how many messages a stranger may still send)
  async function refreshConversation() {
    const c = chat;
    if (!c) return;
    try {
      const conv = await api(`/messages/conversations/${c.id}`);
      if (chat !== c) return;
      c.conv = conv;
      renderFooter();
    } catch { /* the next event sets it right */ }
  }

  async function sendMessage() {
    const c = chat;
    const input = document.getElementById('msg-input');
    if (sending || !c || !input) return;
    const text = input.value;
    if (!text.trim()) return;
    sending = true;
    const button = document.getElementById('msg-send');
    if (button) button.disabled = true;
    showError('');
    // the box is emptied at once and stays enabled, so the phone keeps its keyboard; the text comes back if the sending fails
    input.value = '';
    input.style.height = '';
    try {
      const m = await api(`/messages/conversations/${c.id}/messages`, { method: 'POST', body: { body: text } });
      if (chat === c) {
        appendMessage(m);
        await refreshConversation();
      }
      loadInboxSoon();
    } catch (err) {
      const again = document.getElementById('msg-input');
      if (chat === c && again && !again.value) again.value = text;
      showError(errorText(err, 'msg.sendError'));
    } finally {
      sending = false;
      const b = document.getElementById('msg-send');
      if (b && chat === c && !(c.conv.requestAllowanceLeft === 0)) b.disabled = false;
    }
  }

  function bindFooter() {
    const form = document.getElementById('msg-form');
    if (form) {
      const input = document.getElementById('msg-input');
      form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
      // Enter sends on a computer (never in the middle of an IME composition); on a phone there is no Shift, so Enter is a new line there
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); sendMessage(); }
      });
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
    }
    const accept = document.getElementById('msg-accept');
    if (accept) {
      accept.addEventListener('click', async () => {
        const c = chat;
        accept.disabled = true;
        try {
          await api(`/messages/conversations/${c.id}/accept`, { method: 'POST' });
          if (chat === c) { tab = 'main'; await refreshConversation(); }
          loadInboxSoon();
        } catch (err) { accept.disabled = false; toast(errorText(err, 'msg.loadError')); }
      });
    }
    const decline = document.getElementById('msg-decline');
    if (decline) {
      decline.addEventListener('click', async () => {
        if (decline.dataset.busy || !window.confirm(t('msg.declineConfirm'))) return;
        decline.dataset.busy = '1';
        const c = chat;
        try {
          await api(`/messages/conversations/${c.id}/decline`, { method: 'POST' });
          if (chat === c) { chat = null; go('/messages', true); }
          loadInboxSoon();
        } catch (err) { delete decline.dataset.busy; toast(errorText(err, 'msg.loadError')); }
      });
    }
  }

  function bindChat() {
    document.getElementById('msg-back').addEventListener('click', goBack);
    // joining from an invitation: no approval; the card then says he is a member
    // approving a new club from its request (the server lets the super admin and the player chosen to receive the requests do it)
    document.getElementById('msg-bubbles').addEventListener('click', async (e) => {
      const ok = e.target.closest('[data-approval-approve]');
      if (!ok || ok.disabled) return;
      ok.disabled = true;
      try {
        await api(`/communities/${ok.dataset.approvalApprove}/approval`, { method: 'PATCH', body: { approved: true } });
        chat.items.forEach((m) => { if (m.approval && m.approval.organisation && String(m.approval.organisation.id) === ok.dataset.approvalApprove && m.approval.status === 'WAITING') m.approval.status = 'APPROVED'; });
        document.getElementById('msg-bubbles').innerHTML = bubblesHtml(chat.items);
      } catch (err) { ok.disabled = false; if (typeof toast === 'function') toast(err.message); }
    });
    document.getElementById('msg-bubbles').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-invite-join]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try {
        await api(`/communities/${btn.dataset.inviteJoin}/join`, { method: 'POST' });
        chat.items.forEach((m) => { if (m.invite && m.invite.organisation && String(m.invite.organisation.id) === btn.dataset.inviteJoin && m.invite.status === 'INVITED') m.invite.status = 'MEMBER'; });
        document.getElementById('msg-bubbles').innerHTML = bubblesHtml(chat.items);
      } catch (err) { btn.disabled = false; if (typeof toast === 'function') toast(err.message); }
    });
    const older = document.getElementById('msg-older');
    if (older) {
      older.addEventListener('click', async () => {
        const c = chat;
        older.disabled = true;
        try {
          const more = await api(`/messages/conversations/${c.id}/messages?before=${c.items[0].id}`);
          if (chat !== c) return;
          const scroll = document.getElementById('msg-scroll');
          const before = scroll.scrollHeight;
          c.items = more.items.concat(c.items);
          c.more = more.more;
          renderChat();
          const after = document.getElementById('msg-scroll');
          after.scrollTop = after.scrollHeight - before;
        } catch (err) { older.disabled = false; toast(errorText(err, 'msg.loadError')); }
      });
    }
    bindFooter();
  }

  async function openChat(id) {
    try {
      const [conv, page] = await Promise.all([api(`/messages/conversations/${id}`), api(`/messages/conversations/${id}/messages`)]);
      if (route.view !== 'chat' || route.id !== id) return; // the player went elsewhere meanwhile
      chat = { id, conv, items: page.items, more: page.more };
      tab = conv.state === 'REQUEST' ? 'requests' : 'main'; // the tab of the list follows the chat
    } catch (err) {
      if (route.view !== 'chat' || route.id !== id) return; // an answer for a chat that is not on the screen any more
      chat = null;
      const main = document.getElementById('msg-main');
      if (main) main.innerHTML = `<p class="msg-empty msg-center">${escapeHtml(err.status === 404 ? t('msg.noChat') : t('msg.loadError'))}</p>`;
      return;
    }
    renderChat();
    renderSide();
    markRead();
  }

  async function markRead() {
    const c = chat;
    if (!c || document.hidden) return;
    try { await api(`/messages/conversations/${c.id}/read`, { method: 'POST' }); } catch { /* the next event sets it right */ }
    loadInboxSoon();
  }

  // after a reconnect (a phone suspends its connection in the background) or when the tab comes back: take what was missed, then mark the chat read
  async function resync() {
    if (!loggedIn || !layoutEl) return;
    loadInboxSoon();
    const c = chat;
    if (c) {
      try {
        const [conv, page] = await Promise.all([api(`/messages/conversations/${c.id}`), api(`/messages/conversations/${c.id}/messages`)]);
        if (chat === c) {
          c.conv = conv;
          page.items.forEach(appendMessage);
          renderFooter();
        }
      } catch { /* the next event sets it right */ }
    }
    markRead();
  }

  // ---------------------------------------------------------------- write to somebody

  function renderNew() {
    const main = document.getElementById('msg-main');
    if (!main) return;
    main.innerHTML = `
      <div class="msg-chat-head"><button type="button" class="msg-back" id="msg-back" aria-label="${escapeHtml(t('msg.back'))}">←</button><b>${escapeHtml(t('msg.newMessage'))}</b></div>
      <div class="msg-new">
        <input type="search" id="msg-search" aria-label="${escapeHtml(t('msg.searchPlaceholder'))}" placeholder="${escapeHtml(t('msg.searchPlaceholder'))}" autocomplete="off" maxlength="60">
        <div id="msg-results"><p class="msg-empty msg-center">${escapeHtml(t('msg.searchHint'))}</p></div>
      </div>`;
    document.getElementById('msg-back').addEventListener('click', goBack);
    const input = document.getElementById('msg-search');
    input.focus();
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = input.value.trim();
        const box = document.getElementById('msg-results');
        const seq = ++searchSeq;
        if (q.length < 2) { box.innerHTML = `<p class="msg-empty msg-center">${escapeHtml(t('msg.searchHint'))}</p>`; return; }
        try {
          const found = await api(`/messages/players?q=${encodeURIComponent(q)}`);
          if (seq !== searchSeq || !document.getElementById('msg-results')) return; // an older answer arriving late
          box.innerHTML = found.items.length
            ? found.items.map((p) => `<button type="button" class="msg-row" data-player="${p.playerId}">${avatar(p)}<span class="msg-row-body"><span class="msg-row-top"><b>${escapeHtml(p.name)}</b></span></span></button>`).join('')
            : `<p class="msg-empty msg-center">${escapeHtml(t('msg.noResults'))}</p>`;
          box.querySelectorAll('[data-player]').forEach((b) => b.addEventListener('click', async () => {
            if (b.dataset.busy) return;
            b.dataset.busy = '1';
            try {
              const started = await api('/messages/conversations', { method: 'POST', body: { playerId: Number(b.dataset.player) } });
              go(`/messages/${started.id}`, true);
            } catch (err) { delete b.dataset.busy; toast(errorText(err, 'msg.loadError')); }
          }));
        } catch (err) { if (seq === searchSeq) box.innerHTML = `<p class="msg-empty msg-center">${escapeHtml(t('msg.loadError'))}</p>`; }
      }, 250);
    });
  }

  // ---------------------------------------------------------------- page

  function renderPlaceholder() {
    const main = document.getElementById('msg-main');
    if (!main) return;
    main.innerHTML = `<div class="msg-placeholder"><span class="msg-placeholder-ic">💬</span><b>${escapeHtml(t('msg.pickChat'))}</b><span>${escapeHtml(t('msg.pickChatHint'))}</span></div>`;
  }

  function showRoute() {
    if (!layoutEl) return;
    layoutEl.dataset.pane = route.view === 'list' ? 'list' : 'chat';
    if (route.view === 'chat') {
      if (chat && chat.id === route.id) renderChat();
      else {
        chat = null;
        const main = document.getElementById('msg-main');
        if (main) main.innerHTML = `<p class="msg-empty msg-center">${escapeHtml(t('common.loading'))}</p>`; // not the previous chat while the next one loads
        openChat(route.id);
      }
    } else if (route.view === 'new') { chat = null; renderNew(); }
    else { chat = null; renderPlaceholder(); }
    renderSide();
  }

  function renderLayout() {
    root.innerHTML = '<div class="msg-layout" id="msg-layout"><aside class="msg-side" id="msg-side"></aside><section class="msg-main" id="msg-main"></section></div>';
    layoutEl = document.getElementById('msg-layout');
    showRoute();
  }

  function connectLive() {
    if (socket || typeof io !== 'function') return;
    socket = io();
    let first = true;
    socket.on('connect', () => {
      if (first) { first = false; return; }
      resync(); // a reconnect: whatever came in meanwhile was never delivered
    });
    socket.on('dm:message', (e) => {
      if (chat && e.conversationId === chat.id) {
        const mine = e.message.senderPlayerId === myId;
        const added = appendMessage({ id: e.message.id, body: e.message.body, createdAt: e.message.createdAt, mine, invite: e.message.invite, approval: e.message.approval });
        if (added && !mine) {
          markRead();
          // an answer opens the composer of a stranger's request again (and the count of what he may still send)
          if (chat.conv.requestAllowanceLeft !== null) refreshConversation();
        }
      }
      loadInboxSoon();
    });
    socket.on('dm:unread', (e) => { counts = e; renderSide(); tellMenu(); });
    socket.on('dm:removed', (e) => {
      if (chat && e.conversationId === chat.id) { chat = null; go('/messages', true); }
      loadInboxSoon();
    });
  }

  async function init() {
    if (initializing) return;
    initializing = true;
    try {
      let session;
      try { session = await loadSession(); } catch { session = {}; }
      loggedIn = !!session.isPlayer && !!session.playerId;
      myId = session.playerId || null;
      if (!loggedIn) {
        root.innerHTML = `<div class="msg-login"><p>${escapeHtml(t('msg.loginNeeded'))}</p><button type="button" class="btn btn-primary" id="msg-login">${escapeHtml(t('nav.loginPlayer'))}</button></div>`;
        document.getElementById('msg-login').addEventListener('click', () => requireRealPlayer(init));
        return;
      }
      renderLayout();
      connectLive();
      loadInbox();
    } finally {
      initializing = false;
    }
  }

  window.addEventListener('popstate', () => { route = parseRoute(); showRoute(); });
  // another player (or nobody) is on the page now: this page belongs to the one it was opened for, so it starts again from scratch
  window.addEventListener('blta:auth-changed', async () => {
    let session;
    try { session = await loadSession(); } catch { session = {}; }
    if (initializing) return;
    const id = session.isPlayer && session.playerId ? session.playerId : null;
    if (id === myId) return;
    if (myId !== null) window.location.reload();
    else init();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  init();
})();
