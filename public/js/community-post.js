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
