// "Looking to play" board — a player posts the days/times they're free for
// a friendly match, other players can join in, and the post's owner gets
// notified (email, if they have one on file — see POST /:id/join server-
// side). currentPlayerId/playerAuthed/api/t/toast/escapeHtml/
// openPlayerLoginModal all come from common.js, loaded before this file.

const myPostCard = document.getElementById('my-post-card');
const loginRequiredCard = document.getElementById('login-required-card');
const listEl = document.getElementById('availability-list');

let posts = [];

// t('common.weekdaysShort') is 'Ne,Po,Ut,St,Št,Pi,So' — index i is the
// label for JS's Date.getDay() === i (0 = Sunday), which is also exactly
// how a post's `days` array is stored server-side (see routes/availability.js).
// DAY_ORDER just controls display order (Monday first, like the rest of
// this app's calendars), not the values themselves.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function dayLabels() {
  return t('common.weekdaysShort').split(',');
}

function formatDays(days) {
  const labels = dayLabels();
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => labels[d]);
}

function formatTimeRange(post) {
  if (post.timeFrom && post.timeTo) return `${post.timeFrom}–${post.timeTo}`;
  if (post.timeFrom) return `${t('lookingToPlay.timeFromLabel')} ${post.timeFrom}`;
  if (post.timeTo) return `${t('lookingToPlay.timeToLabel')} ${post.timeTo}`;
  return t('lookingToPlay.anytime');
}

// Builds the 7 Mon-first day-toggle pills into `container`, pre-selecting
// `selectedDays` (an array of getDay()-style ints) — clicking one just
// flips its own .active class; the actual value read happens later, at
// submit time, straight off which buttons carry that class (see
// selectedDaysFrom below), so no separate state needs to stay in sync.
function buildDayPicker(container, selectedDays) {
  const labels = dayLabels();
  container.innerHTML = DAY_ORDER.map((d) => `
    <button type="button" class="day-toggle${selectedDays.includes(d) ? ' active' : ''}" data-day="${d}">${escapeHtml(labels[d])}</button>
  `).join('');
  container.querySelectorAll('.day-toggle').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });
}

function selectedDaysFrom(container) {
  return [...container.querySelectorAll('.day-toggle.active')].map((btn) => Number(btn.dataset.day));
}

// ---------- My post card (create / edit / manage) ----------

function myPostFormHtml(existing) {
  return `
    <h2 style="margin-top:0">${t('lookingToPlay.myPostHeading')}</h2>
    <form id="my-post-form">
      <div class="field">
        <label>${t('lookingToPlay.daysLabel')}</label>
        <div class="day-picker" id="my-post-days"></div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="my-post-time-from">${t('lookingToPlay.timeFromLabel')}</label>
          <input type="time" id="my-post-time-from" value="${existing && existing.timeFrom ? existing.timeFrom : ''}">
        </div>
        <div class="field">
          <label for="my-post-time-to">${t('lookingToPlay.timeToLabel')}</label>
          <input type="time" id="my-post-time-to" value="${existing && existing.timeTo ? existing.timeTo : ''}">
        </div>
      </div>
      <div class="field">
        <label for="my-post-location">${t('lookingToPlay.locationLabel')}</label>
        <input type="text" id="my-post-location" maxlength="120" placeholder="${escapeHtml(t('lookingToPlay.locationPlaceholder'))}" value="${existing ? escapeHtml(existing.location || '') : ''}">
      </div>
      <div class="field">
        <label for="my-post-note">${t('lookingToPlay.noteLabel')}</label>
        <textarea id="my-post-note" rows="2" maxlength="300" placeholder="${escapeHtml(t('lookingToPlay.notePlaceholder'))}">${existing ? escapeHtml(existing.note || '') : ''}</textarea>
      </div>
      <div id="my-post-error" style="color:var(--danger);font-weight:600;margin:8px 0"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="submit" class="btn btn-primary">${existing ? t('lookingToPlay.updateBtn') : t('lookingToPlay.postBtn')}</button>
        ${existing ? `<button type="button" class="btn btn-outline" id="my-post-close-btn">${t('lookingToPlay.closeBtn')}</button>` : ''}
      </div>
    </form>
    ${existing ? interestedListHtml(existing) : ''}
  `;
}

function interestedListHtml(post) {
  const joins = post.joins || [];
  const rows = joins.length
    ? joins.map((j) => `
      <div class="availability-join-row">
        <a class="player-name-link" href="/player/${j.player.slug || j.player.id}">${escapeHtml(j.player.name)}</a>
        ${j.player.phone ? `<span class="availability-join-contact">${escapeHtml(j.player.phone)}</span>` : ''}
        ${j.message ? `<span class="availability-join-message">“${escapeHtml(j.message)}”</span>` : ''}
      </div>
    `).join('')
    : `<p style="color:var(--gray-dim);margin:6px 0 0">${t('lookingToPlay.noInterestYet')}</p>`;
  return `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--gray-light)">
      <strong style="font-size:13px;text-transform:uppercase;letter-spacing:0.03em;color:var(--gray)">${t('lookingToPlay.interestedHeading')}${joins.length ? ` (${joins.length})` : ''}</strong>
      ${rows}
    </div>
  `;
}

function renderMyPostArea() {
  if (!currentPlayerId) {
    myPostCard.style.display = 'none';
    loginRequiredCard.style.display = '';
    return;
  }
  loginRequiredCard.style.display = 'none';
  myPostCard.style.display = '';

  const mine = posts.find((p) => p.mine) || null;
  myPostCard.innerHTML = myPostFormHtml(mine);
  buildDayPicker(document.getElementById('my-post-days'), mine ? mine.days : []);

  document.getElementById('my-post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('my-post-error');
    errorEl.textContent = '';
    const days = selectedDaysFrom(document.getElementById('my-post-days'));
    if (days.length === 0) { errorEl.textContent = t('lookingToPlay.selectDayError'); return; }
    const body = {
      days,
      timeFrom: document.getElementById('my-post-time-from').value || null,
      timeTo: document.getElementById('my-post-time-to').value || null,
      location: document.getElementById('my-post-location').value,
      note: document.getElementById('my-post-note').value,
    };
    try {
      await api('/availability', { method: 'POST', body });
      toast(mine ? t('lookingToPlay.updated') : t('lookingToPlay.posted'));
      await loadPosts();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  const closeBtn = document.getElementById('my-post-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!confirm(t('lookingToPlay.closeConfirm'))) return;
      try {
        await api(`/availability/${mine.id}`, { method: 'DELETE' });
        toast(t('lookingToPlay.closed'));
        await loadPosts();
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

// ---------- Public board ----------

// The join button doesn't fire the request straight away — it reveals a
// small inline compose box (an optional message) right under that same
// card, closed again over data-join-toggle. Keeping this a plain
// show/hide rather than a modal means the board underneath stays fully
// visible and scrollable while writing it.
function boardPostHtml(post) {
  const photo = post.player.photoUrl
    ? `<img src="${escapeHtml(post.player.photoUrl)}" alt="" class="availability-post-photo">`
    : '';

  let joinArea;
  if (post.joinedByMe) {
    joinArea = `<span class="badge" style="background:var(--gray-light);color:var(--gray)">${t('lookingToPlay.joined')}</span>`;
  } else if (currentPlayerId) {
    joinArea = `<button type="button" class="btn btn-sm btn-primary" data-join-toggle="${post.id}">${t('lookingToPlay.joinBtn')}</button>`;
  } else {
    joinArea = `<button type="button" class="btn btn-sm btn-primary" data-join-login="1">${t('lookingToPlay.joinBtn')}</button>`;
  }

  const compose = (!post.joinedByMe && currentPlayerId) ? `
    <div class="availability-join-compose" id="join-compose-${post.id}" style="display:none">
      <textarea rows="2" maxlength="300" placeholder="${escapeHtml(t('lookingToPlay.messagePlaceholder'))}"></textarea>
      <button type="button" class="btn btn-sm btn-primary" data-send-join="${post.id}">${t('lookingToPlay.joinBtn')}</button>
    </div>
  ` : '';

  return `
    <div class="availability-post" data-id="${post.id}">
      <div class="availability-post-head">
        <div class="availability-post-player">
          ${photo}
          <a href="/player/${post.player.slug || post.player.id}" style="color:inherit;text-decoration:none">${escapeHtml(post.player.name)}</a>
        </div>
        ${joinArea}
      </div>
      <div class="availability-post-days">${formatDays(post.days).map((d) => `<span class="availability-day-pill">${escapeHtml(d)}</span>`).join('')}</div>
      <div class="availability-post-meta">🕒 ${escapeHtml(formatTimeRange(post))}${post.location ? ` · 📍 ${escapeHtml(post.location)}` : ''}</div>
      ${post.note ? `<div class="availability-post-note">${escapeHtml(post.note)}</div>` : ''}
      ${compose}
      ${post.joinCount > 0 ? `<div class="availability-join-count">${post.joinCount} 👋</div>` : ''}
    </div>
  `;
}

function renderBoard() {
  const others = posts.filter((p) => !p.mine);
  if (others.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t('lookingToPlay.none')}</div>`;
    return;
  }
  listEl.innerHTML = others.map(boardPostHtml).join('');

  listEl.querySelectorAll('[data-join-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const compose = document.getElementById(`join-compose-${btn.dataset.joinToggle}`);
      if (!compose) return;
      const opening = compose.style.display === 'none';
      compose.style.display = opening ? '' : 'none';
      if (opening) compose.querySelector('textarea').focus();
    });
  });
  listEl.querySelectorAll('[data-send-join]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.sendJoin);
      const compose = document.getElementById(`join-compose-${id}`);
      const message = compose ? compose.querySelector('textarea').value : '';
      sendJoin(id, message);
    });
  });
  listEl.querySelectorAll('[data-join-login]').forEach((btn) => {
    btn.addEventListener('click', () => openPlayerLoginModal(() => loadPosts()));
  });
}

async function sendJoin(postId, message) {
  const post = posts.find((p) => p.id === postId);
  try {
    await api(`/availability/${postId}/join`, { method: 'POST', body: { message: message || '' } });
    toast(post ? t('lookingToPlay.joinSent', { name: post.player.name }) : t('lookingToPlay.joined'));
    await loadPosts();
  } catch (err) {
    toast(err.message);
  }
}

async function loadPosts() {
  try {
    posts = await api('/availability');
    renderMyPostArea();
    renderBoard();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('lookingToPlay.couldNotLoad', { error: err.message }))}</div>`;
  }
}

document.getElementById('looking-to-play-login-link').addEventListener('click', (e) => {
  e.preventDefault();
  openPlayerLoginModal(() => loadPosts());
});

// currentPlayerId is only known once refreshPlayerAuth() (common.js)
// resolves, independently of this file's own initial load — and it's also
// what changes right after a login/logout elsewhere on the page (see
// common.js dispatching this same event there). Re-rendering on it keeps
// the My post area and every join button in sync either way.
window.addEventListener('blta:auth-changed', () => { renderMyPostArea(); renderBoard(); });

loadPosts();
