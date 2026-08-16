const matchToken = window.location.pathname.split('/').filter(Boolean).pop();
const root = document.getElementById('match-root');
let current = null;
let timerInterval = null;
let isAdminUser = false;

function pad(n) { return String(n).padStart(2, '0'); }

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startTimer(startTimeIso) {
  clearInterval(timerInterval);
  const start = new Date(startTimeIso).getTime();
  const tick = () => {
    const el = document.getElementById('timer');
    if (!el) { clearInterval(timerInterval); return; }
    const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    el.textContent = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
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

function scoreboardHtml(m) {
  const state = m.state;
  const setsToShow = state.sets;
  const headerCells = setsToShow.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `Set ${i + 1}`}</th>`).join('');

  const row = (playerNum, player) => {
    const isWinner = m.status === 'FINISHED' && m.winnerId === player.id;
    const cells = setsToShow.map((s, i) => {
      const isCurrent = m.status === 'LIVE' && i === state.currentSet;
      return `<td class="set-score ${isCurrent ? 'current' : ''}">${setCell(s, playerNum)}</td>`;
    }).join('');
    return `<tr class="${isWinner ? 'winner-row' : ''}"><td class="name-cell">${escapeHtml(player.name)}</td>${cells}</tr>`;
  };

  return `
    <div class="scoreboard">
      <table>
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>
          ${row(1, m.player1)}
          ${row(2, m.player2)}
        </tbody>
      </table>
    </div>
  `;
}

function scoreControlsHtml(m, { showFinish }) {
  const curSet = m.state.sets[m.state.currentSet];
  const label = curSet.tiebreak ? (curSet.isSuperTiebreak ? 'POINT · match TB' : 'POINT · tiebreak') : 'GAME';
  return `
    <div class="score-controls">
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player1.name)}</div>
        <button class="btn btn-giant" data-player="1" data-delta="1">+1 ${label}</button>
        <button class="btn btn-minus" data-player="1" data-delta="-1">−1</button>
      </div>
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player2.name)}</div>
        <button class="btn btn-giant" data-player="2" data-delta="1">+1 ${label}</button>
        <button class="btn btn-minus" data-player="2" data-delta="-1">−1</button>
      </div>
    </div>
    <div class="match-actions">
      <button class="btn btn-outline" id="undo-btn" ${m.canUndo ? '' : 'disabled'}>↺ Undo last point</button>
      ${showFinish ? '<button class="btn btn-dark" id="finish-btn">🏁 Finish match</button>' : ''}
    </div>
  `;
}

function controlsHtml(m) {
  if (m.status === 'PLANNED') {
    return `<button class="btn btn-primary btn-block" id="start-btn" style="padding:16px;font-size:16px;margin-top:16px">▶ Start match</button>`;
  }
  if (m.status === 'LIVE') {
    return scoreControlsHtml(m, { showFinish: true });
  }
  // FINISHED
  const winnerName = m.winnerId === m.player1.id ? m.player1.name : m.winnerId === m.player2.id ? m.player2.name : null;
  const winnerCard = `
    <div class="card" style="margin-top:16px;text-align:center">
      <div style="font-size:13px;color:var(--gray);font-weight:700;letter-spacing:0.03em;text-transform:uppercase">Winner</div>
      <div style="font-size:22px;font-weight:800;color:var(--green-light)">${winnerName ? escapeHtml(winnerName) : 'Match ended without a result'}</div>
    </div>
  `;
  if (!isAdminUser) return winnerCard;
  return `
    ${winnerCard}
    <div style="text-align:center;font-size:12px;color:var(--gray);margin:14px 0 -6px">Admin: you can still correct the score below.</div>
    ${scoreControlsHtml(m, { showFinish: false })}
  `;
}

function render(m) {
  current = m;
  const durationHtml = m.status === 'LIVE'
    ? `<div class="timer" id="timer">00:00</div>`
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
      ${durationHtml}
    </div>

    ${scoreboardHtml(m)}
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

    <div class="match-actions">
      <button class="btn btn-yellow" id="share-btn">🔗 Share</button>
      <button class="btn btn-outline" id="embed-btn">🧩 Embed</button>
      ${isAdminUser || (m.status !== 'FINISHED' && !m.createdByAdmin) ? '<button class="btn btn-danger" id="delete-btn">🗑 Delete match</button>' : ''}
    </div>
  `;

  if (m.status === 'LIVE' && m.startTime) startTimer(m.startTime);
  else clearInterval(timerInterval);

  attachHandlers(m);
}

function attachHandlers(m) {
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try { await api(`/matches/${matchToken}/start`, { method: 'POST' }); }
    catch (err) { toast(err.message); startBtn.disabled = false; }
  });

  root.querySelectorAll('.btn-giant, .btn-minus').forEach((btn) => {
    btn.addEventListener('click', async () => {
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = true);
      try {
        await api(`/matches/${matchToken}/score`, {
          method: 'POST',
          body: { player: Number(btn.dataset.player), delta: Number(btn.dataset.delta) },
        });
      } catch (err) { toast(err.message); }
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = false);
    });
  });

  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.addEventListener('click', async () => {
    try { await api(`/matches/${matchToken}/undo`, { method: 'POST' }); }
    catch (err) { toast(err.message); }
  });

  const finishBtn = document.getElementById('finish-btn');
  if (finishBtn) finishBtn.addEventListener('click', async () => {
    const complete = m.state.status === 'COMPLETE';
    if (!complete && !confirm('The match is not finished yet (no winner determined). Finish it anyway? This is meant for retirements or walkovers.')) return;
    finishBtn.disabled = true;
    try { await api(`/matches/${matchToken}/finish`, { method: 'POST' }); }
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
      <input type="datetime-local" id="date-input" value="${toDatetimeLocalValue(m.scheduledAt)}" style="width:100%;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">
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
      const val = document.getElementById('date-input').value;
      saveDate(val ? new Date(val).toISOString() : null);
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

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.addEventListener('click', () => openShareModal(m));
  const embedBtn = document.getElementById('embed-btn');
  if (embedBtn) embedBtn.addEventListener('click', () => openEmbedModal(m));

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

function openEmbedModal(m) {
  const src = `${window.location.origin}/embed/match/${m.token}`;
  const code = `<iframe src="${src}" width="100%" height="420" frameborder="0" style="border:0;max-width:480px"></iframe>`;
  document.getElementById('embed-code').textContent = code;
  document.getElementById('copy-embed-btn').onclick = () => {
    copyToClipboard(code).then(() => toast('Embed code copied'));
  };
  document.getElementById('embed-modal').style.display = 'flex';
}

document.querySelectorAll('[data-close]').forEach((el) => {
  el.addEventListener('click', () => {
    document.getElementById(el.dataset.close).style.display = 'none';
  });
});
document.querySelectorAll('.modal-backdrop').forEach((el) => {
  el.addEventListener('click', (e) => { if (e.target === el) el.style.display = 'none'; });
});

async function init() {
  isAdminUser = await checkAdmin();
  try {
    const m = await api(`/matches/${matchToken}`);
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
}
init();
