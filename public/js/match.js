const matchToken = window.location.pathname.split('/').filter(Boolean).pop();
const root = document.getElementById('match-root');
let current = null;
let timerInterval = null;
let isAdminUser = false;
let messages = [];
let chatDraftBody = '';
let editSetIndex = null;

// Mirrors src/matchEngine.js FORMATS — only the bits needed to build the
// manual-result-entry form (how many sets, and whether the last one is a
// match tiebreak instead of a normal set).
const FORMAT_META = {
  BO1: { setsToWin: 1, finalSetSuperTiebreak: false },
  BO3: { setsToWin: 2, finalSetSuperTiebreak: false },
  BO3_STB: { setsToWin: 2, finalSetSuperTiebreak: true },
  BO5: { setsToWin: 3, finalSetSuperTiebreak: false },
  BO5_STB: { setsToWin: 3, finalSetSuperTiebreak: true },
};

// Standard tiebreak serve rotation: the player whose turn it is serves point 1
// only, then serve alternates every 2 points for the rest of the tiebreak.
function tiebreakServerAtPoint(pointNumber, firstServer) {
  if (pointNumber <= 1) return firstServer;
  const other = firstServer === 1 ? 2 : 1;
  const block = Math.floor((pointNumber - 2) / 2);
  return block % 2 === 0 ? other : firstServer;
}

// Who serves the next point/game right now, given who served first in the
// match. Serve alternates every game across the whole match (set boundaries
// don't reset it); a tiebreak — standard or match-deciding — counts as
// exactly one "game" in that alternation regardless of how many points it
// takes, with its own point-by-point rotation inside it.
function currentServer(state, firstServer) {
  if (!firstServer) return null;
  const other = firstServer === 1 ? 2 : 1;
  let priorGames = 0;
  for (let i = 0; i < state.currentSet; i += 1) {
    const s = state.sets[i];
    priorGames += s.isSuperTiebreak ? 1 : (s.p1 + s.p2);
  }
  const curSet = state.sets[state.currentSet];
  if (curSet.tiebreak) {
    // curSet.p1+p2 is either 12 (6-6, then frozen while the tiebreak plays
    // out) or 0 (the whole set is a match tiebreak) — either way it's exactly
    // the games played before this tiebreak "game" began.
    const tbFirstServer = (priorGames + curSet.p1 + curSet.p2) % 2 === 0 ? firstServer : other;
    const pointsPlayed = curSet.tiebreak.p1 + curSet.tiebreak.p2;
    return tiebreakServerAtPoint(pointsPlayed + 1, tbFirstServer);
  }
  const gamesInSet = curSet.p1 + curSet.p2;
  return (priorGames + gamesInSet) % 2 === 0 ? firstServer : other;
}

// Which set an admin's +1/-1 buttons currently target: their explicit pick if
// still valid, otherwise the active set while live, or the last set once finished.
function getEffectiveSetIndex(m) {
  if (editSetIndex !== null && editSetIndex >= 0 && editSetIndex < m.state.sets.length) return editSetIndex;
  return m.status === 'LIVE' ? m.state.currentSet : m.state.sets.length - 1;
}

function pad(n) { return String(n).padStart(2, '0'); }

function toDateValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startTimer(m) {
  clearInterval(timerInterval);
  const start = new Date(m.startTime).getTime();
  const pausedSeconds = m.pausedSeconds || 0;
  const pausedAtMs = m.pausedAt ? new Date(m.pausedAt).getTime() : null;
  const tick = () => {
    const el = document.getElementById('timer');
    if (!el) { clearInterval(timerInterval); return; }
    const nowMs = pausedAtMs || Date.now();
    const secs = Math.max(0, Math.floor((nowMs - start) / 1000) - pausedSeconds);
    const h = Math.floor(secs / 3600);
    const mm = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    el.textContent = h > 0 ? `${h}:${pad(mm)}:${pad(s)}` : `${pad(mm)}:${pad(s)}`;
  };
  tick();
  if (!pausedAtMs) timerInterval = setInterval(tick, 1000);
}

function setCell(set, playerNum) {
  const gKey = playerNum === 1 ? 'p1' : 'p2';
  if (set.isSuperTiebreak) {
    return `${set.tiebreak[gKey]}`;
  }
  const main = set[gKey];
  const sub = set.tiebreak ? `<sup class="sub-tb">${set.tiebreak[gKey]}</sup>` : '';
  return `${main}${sub}`;
}

function scoreboardHtml(m, durationHtml) {
  const state = m.state;
  const setsToShow = state.sets;
  const headerCells = setsToShow.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `Set ${i + 1}`}</th>`).join('');
  const serving = m.status === 'LIVE' ? currentServer(state, m.firstServer) : null;

  const row = (playerNum, player) => {
    const isWinner = m.status === 'FINISHED' && m.winnerId === player.id;
    const cells = setsToShow.map((s, i) => {
      const isCurrent = m.status === 'LIVE' && i === state.currentSet;
      return `<td class="set-score ${isCurrent ? 'current' : ''}">${setCell(s, playerNum)}</td>`;
    }).join('');
    const ball = serving === playerNum ? '<span class="serve-ball" title="Serving">🟡</span>' : '';
    return `<tr class="${isWinner ? 'winner-row' : ''}"><td class="name-cell">${ball}${escapeHtml(player.name)}</td>${cells}</tr>`;
  };

  return `
    <div class="scoreboard">
      <table>
        <thead><tr><th class="timer-cell">${durationHtml || ''}</th>${headerCells}</tr></thead>
        <tbody>
          ${row(1, m.player1)}
          ${row(2, m.player2)}
        </tbody>
      </table>
    </div>
  `;
}

function scoreControlsHtml(m, { showFinish, showRestart }) {
  // scoreControlsHtml is only ever called for a FINISHED match from the
  // admin-only correction view, so the picker below is naturally admin-only
  // there too — for a LIVE match it's open to everyone, same as scoring itself.
  const effIndex = getEffectiveSetIndex(m);
  const curSet = m.state.sets[effIndex];
  const isTiebreak = !!curSet.tiebreak;
  const unitLabel = isTiebreak ? (curSet.isSuperTiebreak ? 'point (match tiebreak)' : 'point (tiebreak)') : 'game';
  // The big number IS the current score — tapping it adds one game (or one
  // point mid-tiebreak); it naturally shows 0-0 again once a new set starts.
  const p1Value = isTiebreak ? curSet.tiebreak.p1 : curSet.p1;
  const p2Value = isTiebreak ? curSet.tiebreak.p2 : curSet.p2;
  const naturalIndex = m.status === 'LIVE' ? m.state.currentSet : m.state.sets.length - 1;
  // Once the match is decided, the active set is locked (matches the engine
  // refusing further scoring there) — pick an earlier set to correct instead,
  // or Finish the match. The admin correction view (showFinish false) is
  // exempt: it's always editing a specific set on purpose.
  const isLocked = showFinish && m.state.status === 'COMPLETE' && effIndex === naturalIndex;
  const setPicker = m.state.sets.length > 1 ? `
    <div class="set-picker">
      ${m.state.sets.map((s, i) => `
        <button type="button" class="set-picker-btn ${i === effIndex ? 'active' : ''}" data-set-index="${i}">
          ${s.isSuperTiebreak ? 'MTB' : `Set ${i + 1}`} <span class="set-picker-score">${describeSet(s)}</span>
        </button>
      `).join('')}
    </div>
  ` : '';
  return `
    ${setPicker}
    ${isLocked ? '<div class="set-locked-note">This set is decided — pick an earlier set above to correct it, or finish the match below.</div>' : ''}
    <div class="score-controls">
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player1.name)}</div>
        <button class="btn btn-giant btn-score-number" data-player="1" data-delta="1" ${isLocked ? 'disabled' : ''} aria-label="Add a ${unitLabel} for ${escapeHtml(m.player1.name)}">${p1Value}</button>
        <button class="btn btn-minus" data-player="1" data-delta="-1" ${isLocked ? 'disabled' : ''}>−1</button>
      </div>
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player2.name)}</div>
        <button class="btn btn-giant btn-score-number" data-player="2" data-delta="1" ${isLocked ? 'disabled' : ''} aria-label="Add a ${unitLabel} for ${escapeHtml(m.player2.name)}">${p2Value}</button>
        <button class="btn btn-minus" data-player="2" data-delta="-1" ${isLocked ? 'disabled' : ''}>−1</button>
      </div>
    </div>
    <div class="match-actions">
      <button class="btn btn-outline" id="undo-btn" ${m.canUndo ? '' : 'disabled'}>↺ Undo last point</button>
      ${showFinish ? (m.pausedAt
        ? '<button class="btn btn-outline" id="resume-btn">▶ Resume match</button>'
        : '<button class="btn btn-outline" id="pause-btn">⏸ Stop match</button>') : ''}
      ${showRestart ? '<button class="btn btn-outline" id="restart-btn">🔁 Restart match</button>' : ''}
      ${showFinish ? '<button class="btn btn-dark" id="finish-btn">🏁 Finish match</button>' : ''}
    </div>
  `;
}

function controlsHtml(m) {
  if (m.status === 'PLANNED') {
    return `
      <button class="btn btn-primary btn-block" id="start-btn" style="padding:16px;font-size:16px;margin-top:16px">▶ Start match</button>
      <button class="btn btn-outline btn-block" id="manual-result-btn" style="margin-top:10px">📝 Enter result manually</button>
    `;
  }
  if (m.status === 'LIVE') {
    return scoreControlsHtml(m, { showFinish: true, showRestart: true });
  }
  // FINISHED
  const winnerName = m.winnerId === m.player1.id ? m.player1.name : m.winnerId === m.player2.id ? m.player2.name : null;
  const reasonLabel = m.endReason && END_REASON_LABELS[m.endReason] ? END_REASON_LABELS[m.endReason] : null;
  const winnerCard = `
    <div class="card" style="margin-top:16px;text-align:center">
      <div style="font-size:13px;color:var(--gray);font-weight:700;letter-spacing:0.03em;text-transform:uppercase">Winner</div>
      <div style="font-size:22px;font-weight:800;color:var(--green-light)">${winnerName ? escapeHtml(winnerName) : 'Match ended without a result'}</div>
      ${reasonLabel ? `<div style="font-size:12px;color:var(--gray);font-weight:700;margin-top:4px">${reasonLabel}</div>` : ''}
    </div>
  `;
  if (!isAdminUser) return winnerCard;
  return `
    ${winnerCard}
    <div style="text-align:center;font-size:12px;color:var(--gray);margin:14px 0 -6px">Admin: you can still correct any set below, or restart the match entirely.</div>
    ${scoreControlsHtml(m, { showFinish: false, showRestart: true })}
  `;
}

function chatMessageHtml(msg) {
  return `
    <div class="chat-message">
      <div class="chat-message-meta"><span class="chat-message-author">${escapeHtml(msg.author)}</span><span class="chat-message-time">${fmtDateShort(msg.createdAt)}</span></div>
      <div class="chat-message-body">${escapeHtml(msg.body)}</div>
    </div>
  `;
}

function appendChatMessage(message) {
  if (messages.some((m) => m.id === message.id)) return;
  messages.push(message);
  const chatMessagesEl = document.getElementById('chat-messages');
  if (chatMessagesEl) {
    const emptyEl = chatMessagesEl.querySelector('.chat-empty');
    if (emptyEl) emptyEl.remove();
    chatMessagesEl.insertAdjacentHTML('beforeend', chatMessageHtml(message));
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

function chatHtml() {
  const savedName = localStorage.getItem('blta_chat_name') || '';
  return `
    <div class="card chat-card" style="margin-bottom:16px">
      <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--gray);font-weight:700;letter-spacing:0.03em">Chat</div>
      <div class="chat-messages" id="chat-messages">
        ${messages.length === 0
          ? '<div class="chat-empty">No messages yet — say hi 👋</div>'
          : messages.map(chatMessageHtml).join('')}
      </div>
      <form id="chat-form">
        <input type="text" id="chat-name" placeholder="Your name" value="${escapeHtml(savedName)}" maxlength="60" required>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input type="text" id="chat-body" placeholder="Type a message…" value="${escapeHtml(chatDraftBody)}" maxlength="500" required style="flex:1">
          <button type="submit" class="btn btn-primary btn-sm">Send</button>
        </div>
      </form>
    </div>
  `;
}

function render(m) {
  current = m;
  const durationHtml = m.status === 'LIVE'
    ? `<div class="timer${m.pausedAt ? ' timer-paused' : ''}" id="timer">00:00</div>${m.pausedAt ? '<div class="paused-label">⏸ PAUSED</div>' : ''}`
    : (m.startTime && m.endTime
      ? `<div class="timer">${Math.max(1, Math.round((new Date(m.endTime) - new Date(m.startTime)) / 60000))} min</div>`
      : '');

  const locationEditable = m.status !== 'FINISHED' || isAdminUser;

  root.innerHTML = `
    <div class="match-header">
      <div>
        ${categoryBadge(m.category)} ${statusBadge(m.status)}
        <h1 style="margin-top:8px">${escapeHtml(m.player1.name)} <span style="color:var(--gray);font-weight:500">vs</span> ${escapeHtml(m.player2.name)}</h1>
        <div style="color:var(--gray);font-size:13px">${m.formatLabel}</div>
      </div>
    </div>

    ${scoreboardHtml(m, durationHtml)}
    ${controlsHtml(m)}

    <div class="info-grid">
      <div class="info-item">
        <div class="label">Location</div>
        <div class="value" id="location-display">${m.location ? escapeHtml(m.location) : '<span style="color:var(--gray)">Not set</span>'}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-location-link">Edit</button>` : ''}
      </div>
      <div class="info-item">
        <div class="label">Date</div>
        <div class="value" id="date-display">${fmtDateLong(m.scheduledAt)}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-date-link">Edit</button>` : ''}
      </div>
      <div class="info-item">
        <div class="label">Category</div>
        <div class="value">${CATEGORY_LABELS[m.category]}</div>
      </div>
    </div>

    ${m.notes || locationEditable ? `
      <div class="card" style="margin-bottom:16px">
        <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--gray);font-weight:700;letter-spacing:0.03em">Additional info</div>
        <div class="value" id="notes-display" style="margin-top:4px;white-space:pre-wrap;font-weight:600">${m.notes ? escapeHtml(m.notes) : '<span style="color:var(--gray);font-weight:500">Not set</span>'}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-notes-link" style="margin-top:8px">Edit</button>` : ''}
      </div>
    ` : ''}

    ${chatHtml()}

    <div class="match-actions">
      <button class="btn btn-yellow" id="share-btn">🔗 Share</button>
      <button class="btn btn-outline" id="embed-btn">🧩 Embed</button>
      ${m.status === 'FINISHED' ? '<button class="btn btn-green" id="whatsapp-result-btn">📱 Send to WhatsApp</button>' : ''}
      ${isAdminUser || (m.status !== 'FINISHED' && !m.createdByAdmin) ? '<button class="btn btn-danger" id="delete-btn">🗑 Delete match</button>' : ''}
    </div>
  `;

  if (m.status === 'LIVE' && m.startTime) startTimer(m);
  else clearInterval(timerInterval);

  attachHandlers(m);
}

function attachHandlers(m) {
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', () => openFirstServerModal(m));

  const manualResultBtn = document.getElementById('manual-result-btn');
  if (manualResultBtn) manualResultBtn.addEventListener('click', () => openManualResultModal(m));

  root.querySelectorAll('.btn-giant, .btn-minus').forEach((btn) => {
    btn.addEventListener('click', async () => {
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = true);
      const body = { player: Number(btn.dataset.player), delta: Number(btn.dataset.delta) };
      // Only send setIndex for an explicit correction to a set other than the
      // natural active one — ordinary scoring must go through the plain path
      // so the engine's own "match already decided" guard and auto-advance
      // to the next set keep working (editSetScore intentionally has neither).
      const naturalIndex = m.status === 'LIVE' ? m.state.currentSet : m.state.sets.length - 1;
      const effIndex = getEffectiveSetIndex(m);
      if (m.status !== 'LIVE' || effIndex !== naturalIndex) body.setIndex = effIndex;
      const wasComplete = m.state.status === 'COMPLETE';
      try {
        const updated = await api(`/matches/${matchToken}/score`, { method: 'POST', body });
        if (!wasComplete && updated.status === 'LIVE' && updated.state.status === 'COMPLETE') {
          offerFinish(updated);
        }
      } catch (err) { toast(err.message); }
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = false);
    });
  });

  root.querySelectorAll('.set-picker-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editSetIndex = Number(btn.dataset.setIndex);
      render(current);
    });
  });

  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', async () => {
    try { await api(`/matches/${matchToken}/undo`, { method: 'POST' }); }
    catch (err) { toast(err.message); }
  });

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', async () => {
    try { await api(`/matches/${matchToken}/pause`, { method: 'POST' }); }
    catch (err) { toast(err.message); }
  });

  const resumeBtn = document.getElementById('resume-btn');
  if (resumeBtn) resumeBtn.addEventListener('click', async () => {
    try { await api(`/matches/${matchToken}/resume`, { method: 'POST' }); }
    catch (err) { toast(err.message); }
  });

  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.addEventListener('click', async () => {
    if (!confirm("Restart this match? The score and timer will be cleared and the match will go back to Planned. Are you sure?")) return;
    restartBtn.disabled = true;
    try { await api(`/matches/${matchToken}/restart`, { method: 'POST' }); }
    catch (err) { toast(err.message); }
    restartBtn.disabled = false;
  });

  const finishBtn = document.getElementById('finish-btn');
  if (finishBtn) finishBtn.addEventListener('click', async () => {
    if (m.state.status !== 'COMPLETE') {
      openFinishUndecidedModal(m);
      return;
    }
    if (!confirm("Finish this match? The result can't be changed afterward (only an admin will be able to correct it later). Are you sure?")) return;
    finishBtn.disabled = true;
    try {
      const finished = await api(`/matches/${matchToken}/finish`, { method: 'POST' });
      openWhatsAppResultModal(finished);
    }
    catch (err) { toast(err.message); finishBtn.disabled = false; }
  });

  const editLink = document.getElementById('edit-location-link');
  if (editLink) editLink.addEventListener('click', () => {
    const display = document.getElementById('location-display');
    const currentVal = m.location || '';
    display.innerHTML = `
      <input type="text" id="location-input" value="${escapeHtml(currentVal)}" style="width:100%;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" id="save-location-btn">Save</button>
        <button class="btn btn-sm btn-outline" id="cancel-location-btn">Cancel</button>
      </div>
    `;
    editLink.style.display = 'none';
    document.getElementById('location-input').focus();
    document.getElementById('cancel-location-btn').addEventListener('click', () => render(current));
    document.getElementById('save-location-btn').addEventListener('click', async () => {
      const val = document.getElementById('location-input').value.trim();
      try { await api(`/matches/${matchToken}`, { method: 'PATCH', body: { location: val } }); }
      catch (err) { toast(err.message); }
    });
  });

  const editDateLink = document.getElementById('edit-date-link');
  if (editDateLink) editDateLink.addEventListener('click', () => {
    const display = document.getElementById('date-display');
    display.innerHTML = `
      <div style="display:flex;gap:8px">
        <input type="date" id="date-input" value="${toDateValue(m.scheduledAt)}" style="flex:1;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">
        <input type="time" id="time-input" value="${toTimeValue(m.scheduledAt)}" style="flex:1;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">
      </div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" id="save-date-btn">Save</button>
        <button class="btn btn-sm btn-outline" id="clear-date-btn">Clear</button>
        <button class="btn btn-sm btn-outline" id="cancel-date-btn">Cancel</button>
      </div>
    `;
    editDateLink.style.display = 'none';
    document.getElementById('date-input').focus();
    document.getElementById('cancel-date-btn').addEventListener('click', () => render(current));
    const saveDate = async (scheduledAt) => {
      try { await api(`/matches/${matchToken}`, { method: 'PATCH', body: { scheduledAt } }); }
      catch (err) { toast(err.message); }
    };
    document.getElementById('save-date-btn').addEventListener('click', () => {
      const dateVal = document.getElementById('date-input').value;
      const timeVal = document.getElementById('time-input').value;
      saveDate(dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString() : null);
    });
    document.getElementById('clear-date-btn').addEventListener('click', () => saveDate(null));
  });

  const editNotesLink = document.getElementById('edit-notes-link');
  if (editNotesLink) editNotesLink.addEventListener('click', () => {
    const display = document.getElementById('notes-display');
    display.innerHTML = `
      <textarea id="notes-input" rows="3" maxlength="1000" style="width:100%;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">${escapeHtml(m.notes || '')}</textarea>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" id="save-notes-btn">Save</button>
        <button class="btn btn-sm btn-outline" id="cancel-notes-btn">Cancel</button>
      </div>
    `;
    editNotesLink.style.display = 'none';
    document.getElementById('notes-input').focus();
    document.getElementById('cancel-notes-btn').addEventListener('click', () => render(current));
    document.getElementById('save-notes-btn').addEventListener('click', async () => {
      const val = document.getElementById('notes-input').value.trim();
      try { await api(`/matches/${matchToken}`, { method: 'PATCH', body: { notes: val } }); }
      catch (err) { toast(err.message); }
    });
  });

  const chatMessagesEl = document.getElementById('chat-messages');
  if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  const chatForm = document.getElementById('chat-form');
  if (chatForm) {
    const bodyInput = document.getElementById('chat-body');
    bodyInput.addEventListener('input', () => { chatDraftBody = bodyInput.value; });
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('chat-name');
      const name = nameInput.value.trim();
      const body = bodyInput.value.trim();
      if (!name || !body) return;
      localStorage.setItem('blta_chat_name', name);
      const submitBtn = chatForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const created = await api(`/matches/${matchToken}/messages`, { method: 'POST', body: { author: name, body } });
        appendChatMessage(created);
        chatDraftBody = '';
        bodyInput.value = '';
      } catch (err) { toast(err.message); }
      submitBtn.disabled = false;
    });
  }

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.addEventListener('click', () => openShareModal(m));
  const embedBtn = document.getElementById('embed-btn');
  if (embedBtn) embedBtn.addEventListener('click', () => openEmbedModal(m));
  const whatsappResultBtn = document.getElementById('whatsapp-result-btn');
  if (whatsappResultBtn) whatsappResultBtn.addEventListener('click', () => openWhatsAppResultModal(m));

  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete this match (${m.player1.name} vs ${m.player2.name})? This can't be undone.`)) return;
    deleteBtn.disabled = true;
    try {
      await api(`/matches/${matchToken}`, { method: 'DELETE' });
      toast('Match deleted');
      window.location.href = '/';
    } catch (err) {
      toast(err.message);
      deleteBtn.disabled = false;
    }
  });
}

function startMatch(firstServer) {
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.disabled = true;
  document.getElementById('first-server-modal').style.display = 'none';
  api(`/matches/${matchToken}/start`, { method: 'POST', body: { firstServer } })
    .catch((err) => {
      toast(err.message);
      if (startBtn) startBtn.disabled = false;
    });
}

function openFirstServerModal(m) {
  document.getElementById('first-server-p1-btn').textContent = m.player1.name;
  document.getElementById('first-server-p1-btn').onclick = () => startMatch(1);
  document.getElementById('first-server-p2-btn').textContent = m.player2.name;
  document.getElementById('first-server-p2-btn').onclick = () => startMatch(2);
  document.getElementById('first-server-skip-btn').onclick = () => startMatch(null);
  document.getElementById('first-server-modal').style.display = 'flex';
}

function openFinishUndecidedModal(m) {
  let winner = null;
  let reason = null;
  const winnerBtns = Array.from(document.querySelectorAll('#finish-winner-row button'));
  const reasonBtns = Array.from(document.querySelectorAll('#finish-reason-row button'));
  const confirmBtn = document.getElementById('finish-undecided-confirm-btn');

  winnerBtns[0].textContent = m.player1.name;
  winnerBtns[0].dataset.winner = '1';
  winnerBtns[1].textContent = m.player2.name;
  winnerBtns[1].dataset.winner = '2';

  const updateConfirm = () => { confirmBtn.disabled = !(winner && reason); };

  winnerBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      winner = Number(btn.dataset.winner);
      winnerBtns.forEach((b) => b.classList.toggle('active', b === btn));
      updateConfirm();
    };
  });
  reasonBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      reason = btn.dataset.reason;
      reasonBtns.forEach((b) => b.classList.toggle('active', b === btn));
      updateConfirm();
    };
  });

  confirmBtn.disabled = true;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    try {
      const finished = await api(`/matches/${matchToken}/finish`, { method: 'POST', body: { winner, reason } });
      document.getElementById('finish-undecided-modal').style.display = 'none';
      openWhatsAppResultModal(finished);
    } catch (err) {
      toast(err.message);
      confirmBtn.disabled = false;
    }
  };

  document.getElementById('finish-undecided-modal').style.display = 'flex';
}

function openShareModal(m) {
  const url = `${window.location.origin}/match/${m.token}`;
  document.getElementById('share-link').textContent = url;
  document.getElementById('whatsapp-btn').onclick = () => {
    window.open(whatsappShareUrl(`${m.player1.name} vs ${m.player2.name} — BLTA live score:`, url), '_blank');
  };
  document.getElementById('copy-link-btn').onclick = () => {
    copyToClipboard(url).then(() => toast('Link copied'));
  };
  document.getElementById('share-modal').style.display = 'flex';
}

// Fired right when a scoring click decides the match, so the last point can't
// just keep growing the score — offers to finish it immediately instead.
function offerFinish(m) {
  if (!confirm(`${m.scoreSummary} — the match is decided! Finish it now?`)) return;
  api(`/matches/${matchToken}/finish`, { method: 'POST' })
    .then((finished) => openWhatsAppResultModal(finished))
    .catch((err) => toast(err.message));
}

function openWhatsAppResultModal(m) {
  const url = `${window.location.origin}/match/${m.token}`;
  const winnerName = m.winnerId === m.player1.id ? m.player1.name : m.winnerId === m.player2.id ? m.player2.name : null;

  const lines = [
    `🎾 ${m.player1.name} vs ${m.player2.name}`,
    `🏆 ${matchResultText(m) || 'No result'}${winnerName ? ` — ${winnerName} wins` : ''}`,
    `📅 ${fmtDateShort(m.startTime)}`,
  ];
  if (m.location) lines.push(`📍 ${m.location}`);
  lines.push(`🔗 ${url}`);
  const text = lines.join('\n');

  document.getElementById('whatsapp-result-text').textContent = text;
  document.getElementById('whatsapp-result-send-btn').onclick = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };
  document.getElementById('whatsapp-result-modal').style.display = 'flex';
}

function openEmbedModal(m) {
  const src = `${window.location.origin}/embed/match/${m.token}`;
  const code = `<iframe src="${src}" width="100%" height="420" frameborder="0" style="border:0;max-width:480px"></iframe>`;
  document.getElementById('embed-code').textContent = code;
  document.getElementById('copy-embed-btn').onclick = () => {
    copyToClipboard(code).then(() => toast('Embed code copied'));
  };
  document.getElementById('embed-modal').style.display = 'flex';
}

function manualResultRowsHtml(m) {
  const meta = FORMAT_META[m.format] || { setsToWin: 2, finalSetSuperTiebreak: false };
  const maxSets = meta.setsToWin * 2 - 1;
  const deciderIndex = meta.setsToWin * 2 - 2;
  let rows = '';
  for (let i = 0; i < maxSets; i += 1) {
    const isDeciderTB = i === deciderIndex && meta.finalSetSuperTiebreak;
    rows += `
      <div class="manual-set-row">
        <div class="manual-set-label">${isDeciderTB ? 'Match tiebreak' : `Set ${i + 1}`}</div>
        <div class="manual-set-fields">
          <div class="manual-set-field">
            <label>${escapeHtml(m.player1.name)}</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-set-input" data-player="1">
          </div>
          <div class="manual-set-dash">–</div>
          <div class="manual-set-field">
            <label>${escapeHtml(m.player2.name)}</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="manual-set-input" data-player="2">
          </div>
        </div>
      </div>
    `;
  }
  return rows;
}

function openManualResultModal(m) {
  document.getElementById('manual-result-sets').innerHTML = manualResultRowsHtml(m);
  const errorEl = document.getElementById('manual-result-error');
  errorEl.textContent = '';
  const form = document.getElementById('manual-result-form');

  const retiredCheckbox = document.getElementById('manual-result-retired-checkbox');
  const retiredFields = document.getElementById('manual-result-retired-fields');
  retiredCheckbox.checked = false;
  retiredFields.style.display = 'none';
  retiredCheckbox.onchange = () => {
    retiredFields.style.display = retiredCheckbox.checked ? 'block' : 'none';
  };

  let winner = null;
  let reason = null;
  const winnerBtns = Array.from(document.querySelectorAll('#manual-result-winner-row button'));
  const reasonBtns = Array.from(document.querySelectorAll('#manual-result-reason-row button'));
  winnerBtns[0].textContent = m.player1.name;
  winnerBtns[0].dataset.winner = '1';
  winnerBtns[1].textContent = m.player2.name;
  winnerBtns[1].dataset.winner = '2';
  winnerBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      winner = Number(btn.dataset.winner);
      winnerBtns.forEach((b) => b.classList.toggle('active', b === btn));
    };
  });
  reasonBtns.forEach((btn) => {
    btn.classList.remove('active');
    btn.onclick = () => {
      reason = btn.dataset.reason;
      reasonBtns.forEach((b) => b.classList.toggle('active', b === btn));
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const rows = Array.from(document.querySelectorAll('.manual-set-row'));
    const sets = [];
    for (const row of rows) {
      const p1raw = row.querySelector('[data-player="1"]').value.trim();
      const p2raw = row.querySelector('[data-player="2"]').value.trim();
      if (p1raw === '' && p2raw === '') break;
      if (p1raw === '' || p2raw === '') {
        errorEl.textContent = 'Fill in both scores for each set you enter.';
        return;
      }
      sets.push({ p1: Number(p1raw), p2: Number(p2raw) });
    }

    const body = { sets };
    if (retiredCheckbox.checked) {
      if (!winner || !reason) {
        errorEl.textContent = 'Pick who won and why.';
        return;
      }
      body.winner = winner;
      body.reason = reason;
    } else if (sets.length === 0) {
      errorEl.textContent = 'Enter at least one set score.';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const finished = await api(`/matches/${matchToken}/manual-result`, { method: 'POST', body });
      document.getElementById('manual-result-modal').style.display = 'none';
      openWhatsAppResultModal(finished);
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  };
  document.getElementById('manual-result-modal').style.display = 'flex';
}

async function init() {
  isAdminUser = await checkAdmin();
  try {
    const m = await api(`/matches/${matchToken}`);
    try { messages = await api(`/matches/${matchToken}/messages`); } catch { /* chat is best-effort */ }
    render(m);
  } catch (err) {
    root.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    return;
  }
  const socket = io();
  socket.emit('join', `match:${matchToken}`);
  socket.on('match:update', (m) => {
    if (m.token === matchToken) render(m);
  });
  socket.on('message:new', ({ token, message }) => {
    if (token !== matchToken) return;
    appendChatMessage(message);
  });
}
init();
