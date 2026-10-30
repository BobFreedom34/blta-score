// The news of a community or club, shared by the club page and the feed: the text with clickable links, the picture, the emoji panel of the
// composer and the emoji reactions under a published post (server: /api/communities/:id/posts/:postId/reactions in src/routes/communities.js).
//   comPostText(text)                      -> html of the text: escaped, links clickable
//   comPostImage(url)                      -> html of the picture (only an address the server wrote)
//   comReactionsHtml(post)                 -> the chips with the counts and the button that adds one
//   comBindReactions(root, orgIdOf)        -> wires the chips inside root; orgIdOf(postElement) gives the community of the post
//   comEmojiPanel(anchor, emojis, onPick)  -> a small panel under a button with a grid of emoji
const COM_REACTIONS = ['👍', '❤️', '🔥', '💪', '👏', '🎾', '🚀', '🏆', '😂', '😮'];
const COM_EMOJI = ['😀', '😄', '😁', '😂', '🤣', '😊', '😉', '😍', '🥰', '😘', '😎', '🤩', '🥳', '🤗', '🤔', '😮', '😢', '😭', '😡', '😴',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '🤞', '❤️', '🧡', '💛', '💚', '💙', '💜', '💔', '🔥', '⭐', '✨',
  '🎾', '🏆', '🥇', '🥈', '🥉', '🏅', '🎉', '🎊', '🚀', '💯', '✅', '❌', '⚡', '☀️', '🌧️', '📅', '📍', '⏰', '🍻', '🥤'];

// text -> html: escaped, then every http(s) link is clickable (opens in a new tab, never passes the page on to it)
function comPostText(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (raw) => {
    const trail = (raw.match(/(?:[.,;:!?)]|&quot;|&#39;|&gt;)+$/) || [''])[0];
    const url = trail ? raw.slice(0, -trail.length) : raw;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc">${url}</a>${trail}`;
  });
}

function comPostImage(url) {
  return /^\/community-images\/[\w.-]+$/.test(url || '') ? `<a class="com-post-img" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="" loading="lazy"></a>` : '';
}

function comReactionsHtml(post) {
  const chips = (post.reactions || []).map((r) => `<button type="button" class="com-react${r.mine ? ' on' : ''}" data-react="${escapeHtml(r.emoji)}"><span class="com-react-emoji">${escapeHtml(r.emoji)}</span><span class="com-react-count">${r.count}</span></button>`).join('');
  return `<div class="com-reactions" data-reactions="${post.id}">${chips}<button type="button" class="com-react com-react-add" data-react-add aria-label="${escapeHtml(t('com.react'))}" title="${escapeHtml(t('com.react'))}">☺<small>+</small></button></div>`;
}

function comEmojiPanel(anchor, emojis, onPick) {
  document.querySelectorAll('.com-emoji-panel').forEach((p) => p.remove());
  const panel = document.createElement('div');
  panel.className = 'com-emoji-panel';
  panel.innerHTML = emojis.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
  const close = () => { panel.remove(); document.removeEventListener('click', away, true); };
  const away = (e) => { if (!panel.contains(e.target) && e.target !== anchor) close(); };
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    onPick(b.dataset.emoji);
    close();
  });
  (anchor.parentElement || document.body).appendChild(panel);
  panel.style.position = 'absolute';
  panel.style.zIndex = '60';
  setTimeout(() => document.addEventListener('click', away, true), 0);
  return panel;
}

// puts the chosen emoji into a textarea where the cursor is
function comInsertAtCursor(box, text) {
  const start = box.selectionStart == null ? box.value.length : box.selectionStart;
  const end = box.selectionEnd == null ? start : box.selectionEnd;
  box.value = `${box.value.slice(0, start)}${text}${box.value.slice(end)}`;
  const at = start + text.length;
  box.focus();
  box.setSelectionRange(at, at);
}

function comBindReactions(root, orgIdOf) {
  root.querySelectorAll('[data-reactions]').forEach((row) => {
    const postEl = row.closest('[data-post]') || row.parentElement;
    const postId = row.dataset.reactions;
    const send = (emoji) => requireRealPlayer(async () => {
      try {
        const res = await api(`/communities/${orgIdOf(postEl)}/posts/${postId}/reactions`, { method: 'POST', body: { emoji } });
        row.outerHTML = comReactionsHtml({ id: postId, reactions: res.reactions });
        comBindReactions(postEl, orgIdOf);
      } catch (err) { if (typeof toast === 'function') toast(err.message); }
    });
    row.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', () => send(b.dataset.react)));
    const add = row.querySelector('[data-react-add]');
    if (add) add.addEventListener('click', (e) => { e.stopPropagation(); comEmojiPanel(add, COM_REACTIONS, send); });
  });
}

// ---- comments under a post (the members of the community write them; everybody reads them) ----
const comCountText = (n) => (n === 0 ? t('com.commentFirst') : n === 1 ? t('com.commentsOne') : n >= 2 && n <= 4 ? t('com.commentsFew', { n }) : t('com.commentsMany', { n }));
const comWhen = (iso) => new Date(iso).toLocaleString(currentLang === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function comCommentsHtml(post) {
  return `<div class="com-comments" data-comments="${post.id}" data-count="${post.commentCount || 0}">
    <button type="button" class="com-comments-toggle" data-comments-toggle>💬 <span class="com-comments-label">${escapeHtml(comCountText(post.commentCount || 0))}</span></button>
    <div class="com-comments-body" hidden></div></div>`;
}

function comCommentHtml(c) {
  const face = c.authorPhotoUrl ? `<img src="${escapeHtml(c.authorPhotoUrl)}" alt="">` : escapeHtml(String(c.authorName || '?').trim().charAt(0).toUpperCase());
  const name = c.authorSlug ? `<a href="/player/${encodeURIComponent(c.authorSlug)}">${escapeHtml(c.authorName)}</a>` : escapeHtml(c.authorName);
  return `<div class="com-comment" data-comment="${c.id}"><span class="com-comment-face">${face}</span>
    <div class="com-comment-main"><div class="com-comment-bubble"><b>${name}</b><span class="com-comment-text">${comPostText(c.body)}</span></div>
    <div class="com-comment-meta">${escapeHtml(comWhen(c.createdAt))}${c.canDelete ? ` · <button type="button" class="com-link" data-comment-delete="${c.id}">${escapeHtml(t('com.commentDelete'))}</button>` : ''}</div></div></div>`;
}

function comBindComments(root, orgIdOf) {
  root.querySelectorAll('[data-comments]').forEach((box) => {
    const postEl = box.closest('[data-post]') || box.parentElement;
    const postId = box.dataset.comments;
    const body = box.querySelector('.com-comments-body');
    const label = box.querySelector('.com-comments-label');
    const url = (suffix = '') => `/communities/${orgIdOf(postEl)}/posts/${postId}/comments${suffix}`;
    let state = null; // { items, more, canComment }
    const setCount = (n) => { box.dataset.count = String(n); label.textContent = comCountText(n); };

    function paint() {
      const composer = state.canComment
        ? `<div class="com-comment-new"><textarea rows="1" maxlength="1000" placeholder="${escapeHtml(t('com.commentWrite'))}"></textarea>
            <button type="button" class="btn btn-outline com-small com-tool" data-comment-emoji aria-label="${escapeHtml(t('com.emoji'))}">😊</button>
            <button type="button" class="btn btn-primary com-small" data-comment-send>${escapeHtml(t('com.commentSend'))}</button></div>`
        : `<p class="com-comment-hint">${escapeHtml(t('com.commentMembersOnly'))}</p>`;
      body.innerHTML = `${state.more ? `<button type="button" class="com-link" data-comments-older>${escapeHtml(t('com.commentsOlder'))}</button>` : ''}
        <div class="com-comment-list">${state.items.map(comCommentHtml).join('')}</div>${composer}`;
      const older = body.querySelector('[data-comments-older]');
      if (older) older.addEventListener('click', async () => {
        older.disabled = true;
        try {
          const more = await api(url(`?before=${state.items[0].id}`));
          state.items = more.items.concat(state.items);
          state.more = more.more;
          paint();
        } catch (err) { older.disabled = false; if (typeof toast === 'function') toast(err.message); }
      });
      body.querySelectorAll('[data-comment-delete]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api(url(`/${b.dataset.commentDelete}`), { method: 'DELETE' });
          state.items = state.items.filter((c) => String(c.id) !== b.dataset.commentDelete);
          setCount(Math.max(0, Number(box.dataset.count) - 1));
          paint();
        } catch (err) { b.disabled = false; if (typeof toast === 'function') toast(err.message); }
      }));
      const area = body.querySelector('textarea');
      if (area) {
        const send = async () => {
          const text = area.value.trim();
          if (!text) return;
          const btn = body.querySelector('[data-comment-send]');
          btn.disabled = true;
          try {
            const made = await api(url(), { method: 'POST', body: { body: text } });
            state.items.push(made);
            setCount(Number(box.dataset.count) + 1);
            paint();
            body.querySelector('textarea').focus();
          } catch (err) { btn.disabled = false; if (typeof toast === 'function') toast(err.message); }
        };
        body.querySelector('[data-comment-send]').addEventListener('click', send);
        area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        const emoji = body.querySelector('[data-comment-emoji]');
        emoji.addEventListener('click', (e) => { e.stopPropagation(); comEmojiPanel(emoji, COM_EMOJI, (em) => comInsertAtCursor(area, em)); });
      }
    }

    box.querySelector('[data-comments-toggle]').addEventListener('click', async () => {
      if (!body.hidden) { body.hidden = true; return; }
      body.hidden = false;
      if (state) return;
      try {
        state = await api(url());
        paint();
        const area = body.querySelector('textarea');
        if (area && !state.items.length) area.focus();
      } catch (err) { body.hidden = true; if (typeof toast === 'function') toast(err.message); }
    });
  });
}

// ---- a tournament of the community as a piece of news: the card of a Harmonogram row (the same markup and styles, src/css .sch-*) under a line with the day it
// was posted. s: { name, slug, startDate, endDate, venue, categories, registrationOpen, organisation: { name, slug } }
const COM_CATEGORY_NAMES = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
const comCategoryName = (c) => (c === 'DOUBLES' ? t('season.catDoubles') : COM_CATEGORY_NAMES[c] || c);
const comDay = (iso) => new Date(`${iso}T12:00:00`);
const comDaysBetween = (a, b) => Math.round((comDay(b) - comDay(a)) / 864e5);
function comDayWord(n) {
  if (n === 1) return t('schedule.dayOne');
  if (currentLang === 'en') return t('schedule.dayMany');
  return n >= 2 && n <= 4 ? t('schedule.dayFew') : t('schedule.dayMany');
}
// "01.05. – 31.08.", "14. – 15.11.", "13.12."
function comDateRange(a, b) {
  if (!a) return '';
  const x = comDay(a);
  const y = comDay(b || a);
  const two = (n) => String(n).padStart(2, '0');
  const dm = (d) => `${two(d.getDate())}.${two(d.getMonth() + 1)}.`;
  if (!b || a === b) return dm(x);
  if (x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()) return `${two(x.getDate())}. – ${dm(y)}`;
  return `${dm(x)} – ${dm(y)}`;
}

function comTournamentRow(s) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = s.startDate || '';
  const end = s.endDate || s.startDate || '';
  const status = !start ? 'future' : end < today ? 'past' : start > today ? 'future' : 'now';
  let extra = '';
  if (status === 'now') extra = t('schedule.daysLeft', { n: Math.max(0, comDaysBetween(today, end)), d: comDayWord(Math.max(0, comDaysBetween(today, end))) });
  else if (status === 'future' && start) extra = t('schedule.startsIn', { n: comDaysBetween(today, start), d: comDayWord(comDaysBetween(today, start)) });
  const season = s.kind === 'LEAGUE'; // a season of the community (groups and a table) or a tournament
  const link = `/${season ? 'season' : 'tournament'}/${encodeURIComponent(s.slug)}`;
  const org = s.organisation;
  const tags = `<span class="sch-tags"><span class="sch-tag ${season ? 'league' : 'tour'}">${escapeHtml(season ? t('com.seasonTag') : t('schedule.tournament'))}</span>`
    + (status === 'now' ? `<span class="sch-tag now">${escapeHtml(t('schedule.running'))}</span>` : '')
    + (status === 'past' ? `<span class="sch-tag past">${escapeHtml(t('schedule.finishedTag'))}</span>` : '')
    + (org ? `<span class="sch-tag sch-club" role="link" tabindex="0" title="${escapeHtml(t('schedule.organiser', { name: org.name }))}" data-href="/community/${encodeURIComponent(org.slug)}">${escapeHtml(org.name)}</span>` : '')
    + '</span>';
  const chips = (s.categories || []).map((c) => `<span class="sch-chip">${escapeHtml(comCategoryName(c))}</span>`).join('');
  const sub = `${s.venue ? `<span class="sch-venue">${escapeHtml(s.venue)} · </span>` : ''}<b class="sch-cats">${chips}</b><span class="sch-extra">${extra ? escapeHtml(` · ${extra}`) : ''}</span>`;
  const reg = !season && s.registrationOpen && status !== 'past' ? `<span class="sch-reg" role="link" tabindex="0" data-href="${escapeHtml(link)}#register">${escapeHtml(t('schedule.register'))}</span>` : '';
  const go = `<span class="sch-go">${escapeHtml(t('schedule.more'))} ›</span>`;
  return `<a class="sch-row link ${status}" href="${escapeHtml(link)}">
      <div class="sch-date">${escapeHtml(comDateRange(start, end) || t('com.eventNoDate'))}<small>${start ? escapeHtml(String(comDay(start).getFullYear())) : ''}</small></div>
      <span class="sch-eta"></span>
      <div class="sch-info"><div class="sch-text"><div class="sch-name"><span class="sch-title">${escapeHtml(s.name)}</span>${tags}</div><div class="sch-sub">${sub}</div></div></div>
      ${reg ? `<span class="sch-acts">${reg}${go}</span>` : go}
    </a>`;
}

// the whole item: headHtml (who and when it was posted) and the card
function comTournamentNewsHtml(s, headHtml) {
  return `<div class="com-post com-news-tournament">${headHtml}${comTournamentRow(s)}</div>`;
}

// the buttons and the club tag inside the card are links by role: they lead somewhere of their own, not to the page of the card
function comBindTournaments(root) {
  root.querySelectorAll('.sch-row [data-href]').forEach((el) => {
    const go = (e) => { e.preventDefault(); e.stopPropagation(); window.location.href = siteUrl(el.dataset.href); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  });
}

// ---- the header of a piece of news, like a social post: the logo of the community, its name, "Posted by <author> · <date>", and - for who may delete it - a
// three-dot menu. o: { logo (html), name, href (optional), by, date, postId, canDelete }
function comPostHeadHtml(o) {
  const name = o.href ? `<a href="${escapeHtml(o.href)}">${escapeHtml(o.name)}</a>` : escapeHtml(o.name);
  const menu = o.canDelete && o.postId
    ? `<div class="com-dots-wrap"><button type="button" class="com-dots" data-dots aria-label="${escapeHtml(t('com.postMenu'))}" title="${escapeHtml(t('com.postMenu'))}" aria-haspopup="true">⋮</button>
        <div class="com-dots-menu" hidden><button type="button" data-delete-post="${o.postId}">${escapeHtml(t('com.deletePost'))}</button></div></div>` : '';
  return `<div class="com-post-head2">${o.logo}<div class="com-post-who"><b>${name}</b><span>${escapeHtml(o.by)} · ${escapeHtml(o.date)}</span></div>${menu}</div>`;
}

// opens and closes the three-dot menus inside root (one open at a time; a click anywhere else closes them)
function comBindPostMenus(root) {
  root.querySelectorAll('[data-dots]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = b.parentElement.querySelector('.com-dots-menu');
    const wasHidden = menu.hidden;
    document.querySelectorAll('.com-dots-menu').forEach((m) => { m.hidden = true; });
    menu.hidden = !wasHidden;
  }));
}
document.addEventListener('click', () => document.querySelectorAll('.com-dots-menu').forEach((m) => { m.hidden = true; }));
