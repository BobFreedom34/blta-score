const matchToken = window.location.pathname.split('/').filter(Boolean).pop();
const root = document.getElementById('match-root');
let current = null;
let timerInterval = null;
let isAdminUser = false;
let messages = [];
let chatDraftBody = '';
let editSetIndex = null;
let viewerCount = null;
let h2hKey = null;
let h2hHtml = '';

// Mirrors src/matchEngine.js FORMATS — only the bits needed to build the
// manual-result-entry form (how many sets, and whether the last one is a
// match tiebreak instead of a normal set).
const FORMAT_META = {
  BO1: { setsToWin: 1, finalSetSuperTiebreak: false },
  BO3: { setsToWin: 2, finalSetSuperTiebreak: false },
  BO3_STB: { setsToWin: 2, finalSetSuperTiebreak: true },
  BO5: { setsToWin: 3, finalSetSuperTiebreak: false },
  BO5_STB: { setsToWin: 3, finalSetSuperTiebreak: true },
  // Free Play is open-ended in real play — 6 is just a generous cap on how
  // many set rows the manual-result-entry form offers.
  FREE_PLAY: { setsToWin: 6, finalSetSuperTiebreak: false },
};

// Mirrors public/js/new-match.js FORMATS — for the change-format picker.
const FORMATS_LIST = [
  { key: 'BO1', label: 'Best of 1 set' },
  { key: 'BO3', label: 'Best of 3 sets', sublabel: '(BLTA Play-Off)' },
  { key: 'BO3_STB', label: 'Best of 3 sets — deciding set is a match tiebreak', sublabel: '(BLTA League)' },
  { key: 'BO5', label: 'Best of 5 sets' },
  { key: 'BO5_STB', label: 'Best of 5 sets — deciding set is a match tiebreak' },
  { key: 'FREE_PLAY', label: 'Free Play', sublabel: '(training)' },
];

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

// setCell is shared from common.js (also used by a match card's compact scoreboard).

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
  const unitLabel = isTiebreak
    ? (curSet.isSuperTiebreak ? (curSet.tiebreakTarget === 7 ? 'point (tiebreak to 7)' : 'point (match tiebreak)') : 'point (tiebreak)')
    : 'game';
  // The big number IS the current score — tapping it adds one game (or one
  // point mid-tiebreak); it naturally shows 0-0 again once a new set starts.
  const p1Value = isTiebreak ? curSet.tiebreak.p1 : curSet.p1;
  const p2Value = isTiebreak ? curSet.tiebreak.p2 : curSet.p2;
  const setPicker = m.state.sets.length > 1 ? `
    <div class="set-picker">
      ${m.state.sets.map((s, i) => `
        <button type="button" class="set-picker-btn ${i === effIndex ? 'active' : ''}" data-set-index="${i}">
          ${s.isSuperTiebreak ? (s.tiebreakTarget === 7 ? 'TB-7' : 'MTB') : `Set ${i + 1}`} <span class="set-picker-score">${describeSet(s)}</span>
        </button>
      `).join('')}
    </div>
  ` : '';
  // Free Play only: which style the *next* set (or the current one, if it
  // has no progress yet) will be played to — always visible while live,
  // since there's no fixed format to fall back on.
  const styleSwitcher = (showFinish && m.format === 'FREE_PLAY') ? `
    <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--gray-dim);font-weight:700;letter-spacing:0.03em;margin-top:10px">Next set</div>
    <div class="set-picker">
      <button type="button" class="set-picker-btn ${(m.state.nextSetStyle || 'REGULAR') === 'REGULAR' ? 'active' : ''}" data-set-style="REGULAR">Games to 6</button>
      <button type="button" class="set-picker-btn ${m.state.nextSetStyle === 'TB7' ? 'active' : ''}" data-set-style="TB7">Tiebreak to 7</button>
      <button type="button" class="set-picker-btn ${m.state.nextSetStyle === 'TB10' ? 'active' : ''}" data-set-style="TB10">Tiebreak to 10</button>
    </div>
  ` : '';
  return `
    ${setPicker}
    ${styleSwitcher}
    <div class="score-controls">
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player1.name)}</div>
        <button class="btn btn-giant btn-score-number" data-player="1" data-delta="1" aria-label="Add a ${unitLabel} for ${escapeHtml(m.player1.name)}">${p1Value}</button>
        <button class="btn btn-minus" data-player="1" data-delta="-1">−1</button>
      </div>
      <div class="player-controls">
        <div class="pname">${escapeHtml(m.player2.name)}</div>
        <button class="btn btn-giant btn-score-number" data-player="2" data-delta="1" aria-label="Add a ${unitLabel} for ${escapeHtml(m.player2.name)}">${p2Value}</button>
        <button class="btn btn-minus" data-player="2" data-delta="-1">−1</button>
      </div>
    </div>
    <div class="match-actions">
      ${showFinish ? (m.pausedAt
        ? '<button class="btn" id="resume-btn">▶ Resume match</button>'
        : '<button class="btn" id="pause-btn">⏸ Stop match</button>') : ''}
      ${showRestart ? '<button class="btn" id="restart-btn">🔁 Restart match</button>' : ''}
      ${showFinish ? '<button class="btn btn-dark" id="finish-btn">🏁 Finish match</button>' : ''}
      ${showFinish ? '<button class="btn btn-outline" id="unfinished-btn" title="No winner yet — e.g. ran out of court time. Can be resumed later.">⏹ Match unfinished</button>' : ''}
    </div>
  `;
}

function controlsHtml(m) {
  if (m.status === 'PLANNED') {
    return `
      <button class="btn btn-primary btn-block" id="start-btn" style="padding:16px;font-size:16px;margin-top:16px;text-transform:uppercase">🔴 Start live match</button>
      <button class="btn btn-green btn-block" id="manual-result-btn" style="padding:16px;font-size:16px;margin-top:10px;text-transform:uppercase">📝 Enter result manually</button>
    `;
  }
  if (m.status === 'LIVE') {
    return scoreControlsHtml(m, { showFinish: true, showRestart: true });
  }
  if (m.status === 'UNFINISHED') {
    return `
      <div class="card" style="margin-top:16px;text-align:center">
        <div style="font-size:13px;color:var(--gray);font-weight:700;letter-spacing:0.03em;text-transform:uppercase">Unfinished</div>
        <div style="font-size:16px;font-weight:700;color:var(--ink);margin-top:4px">No winner yet — the score above is where it stopped.</div>
      </div>
      <button class="btn btn-primary btn-block" id="resume-later-btn" style="padding:16px;font-size:16px;margin-top:10px;text-transform:uppercase">📅 Set a new date &amp; resume later</button>
      <button class="btn btn-dark btn-block" id="finish-as-is-btn" style="margin-top:10px">🏁 Finish with the result as it is</button>
      <button class="btn btn-block" id="restart-btn" style="margin-top:10px">🔁 Restart match from scratch</button>
    `;
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
    <div style="text-align:center;font-size:12px;color:var(--gray-dim);margin:14px 0 -6px">Admin: you can still correct any set below, or restart the match entirely.</div>
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

// Prior meetings between these two players (any category, excluding this
// match itself) — fetched once per pair and cached, then re-rendered in
// place. Runs independently of the frequent re-renders that happen while
// scoring, since past history between them can't change from those.
async function ensureH2H(m) {
  const key = `${m.player1.id}-${m.player2.id}`;
  if (h2hKey === key) return;
  h2hKey = key;
  h2hHtml = '';
  try {
    const finished = await api(`/matches?playerId=${m.player1.id}&status=FINISHED`);
    const prior = finished.filter((x) => x.token !== matchToken && x.winnerId
      && x.endReason !== 'WALKOVER' && x.endReason !== 'UNFINISHED'
      && (x.player1.id === m.player2.id || x.player2.id === m.player2.id));
    if (prior.length) {
      let wins = 0;
      let losses = 0;
      prior.forEach((x) => { if (x.winnerId === m.player1.id) wins += 1; else losses += 1; });
      const total = wins + losses;
      const pct = Math.round((wins / total) * 100);
      const scoreColor = wins > losses ? 'var(--green)' : wins < losses ? 'var(--danger)' : 'var(--gray)';
      h2hHtml = `
        <div class="section-label">Head-to-head</div>
        <div class="h2h-card">
          <div class="h2h-row" style="flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <a class="h2h-name" href="/player/${m.player1.slug || m.player1.id}">${escapeHtml(m.player1.name)}</a>
              <span class="h2h-score" style="color:${scoreColor}">${wins} — ${losses}</span>
              <a class="h2h-name" href="/player/${m.player2.slug || m.player2.id}" style="text-align:right">${escapeHtml(m.player2.name)}</a>
            </div>
            <div class="h2h-bar" style="width:100%">
              <div style="width:${pct}%;background:var(--green)"></div><div style="width:${100 - pct}%;background:var(--danger)"></div>
            </div>
          </div>
        </div>
      `;
    }
  } catch (err) { /* non-critical — leave the section empty */ }
  if (current) render(current);
}

// "Respond to a proposed time" card — shown to anyone viewing this link
// while the match has proposed slots/venues but no confirmed date yet.
// Anyone can look at it and mark a slot/venue, but actually confirming
// requires being logged in as one of the two players in this match (or
// admin) — see attachProposalCardHandlers' confirm-*-btn handler and
// POST /:token/respond-proposal on the server. `which` is 'primary' (the
// first proposal) or 'counter' (the other player's own independent
// counter-proposal, see POST /:token/counter-propose) — each gets its own
// card with its own ids so both can render and work side by side at once.
function oneProposalCardHtml(m, which) {
  const isPrimary = which === 'primary';
  const idPrefix = isPrimary ? 'proposal' : 'counter-proposal';
  const slots = isPrimary ? m.proposalSlots : m.counterProposalSlots;
  const venues = isPrimary ? m.proposalVenues : m.counterProposalVenues;
  const proposedBy = isPrimary ? m.proposedBy : m.counterProposedBy;
  const proposerName = proposedBy === 1 ? m.player1.name : proposedBy === 2 ? m.player2.name : null;
  // Only offer "propose your own times instead" while there's just the one
  // calendar up — with two players there's no room for a third.
  const showCounterProposeLink = isPrimary && !m.counterProposalSlots;
  return `
    <div class="card" id="${idPrefix}-card" style="margin-bottom:16px;border:2px solid var(--orange)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div class="label" style="font-size:11px;text-transform:uppercase;color:var(--orange-dark);font-weight:800;letter-spacing:0.03em">📅 Pick a time</div>
        ${canManageMatch(m, isAdminUser) ? `
          <div style="display:flex;gap:10px">
            <button type="button" class="edit-link" id="edit-${idPrefix}-link">Edit</button>
            <button type="button" class="edit-link" id="delete-${idPrefix}-link" style="color:var(--danger)">Delete</button>
          </div>
        ` : ''}
      </div>
      <p style="font-size:13px;color:var(--gray);margin:6px 0 16px">${proposerName ? `${escapeHtml(proposerName)} proposed` : 'A few options were proposed'} for this match — pick whichever works for you and it's confirmed.</p>
      <div class="field">
        <label>When</label>
        <div class="tabs week-picker-tabs" id="${idPrefix}-week-tabs"></div>
        <div class="availability-grid-wrap" id="${idPrefix}-grid-wrap"></div>
      </div>
      <div class="field">
        <label>Where</label>
        <div class="proposal-option-list" id="${idPrefix}-venue-list">
          ${(venues || []).map((v) => `<button type="button" class="btn btn-outline proposal-option" data-venue="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="confirm-${idPrefix}-btn" disabled style="margin-top:6px">Confirm</button>
      <div id="${idPrefix}-error" style="color:var(--danger);font-weight:600;margin-top:8px"></div>
      ${showCounterProposeLink ? `<button type="button" class="edit-link" id="counter-propose-link" style="margin-top:12px">Can't make any of these? Propose your own times instead →</button>` : ''}
    </div>
  `;
}

function proposalCardHtml(m) {
  return oneProposalCardHtml(m, 'primary') + (m.counterProposalSlots ? oneProposalCardHtml(m, 'counter') : '');
}

// Wires up one proposal card's picker/Confirm/Edit/Delete — `which` is
// 'primary' or 'counter', matching oneProposalCardHtml's id scheme, so the
// same logic drives whichever card(s) are actually on the page (see the
// attachHandlers call site).
function attachProposalCardHandlers(m, which) {
  const isPrimary = which === 'primary';
  const idPrefix = isPrimary ? 'proposal' : 'counter-proposal';
  const slots = isPrimary ? m.proposalSlots : m.counterProposalSlots;
  const proposedBy = isPrimary ? m.proposedBy : m.counterProposedBy;
  // null when whoever proposed this card left "who's proposing" blank —
  // nothing to check the confirming player against then, mirrors the
  // server-side proposerPlayerId in POST /:token/respond-proposal.
  const proposerPlayerId = proposedBy === 1 ? m.player1.id : proposedBy === 2 ? m.player2.id : null;
  const card = document.getElementById(`${idPrefix}-card`);
  if (!card) return;

  let selectedSlot = null;
  let selectedVenue = null;
  const confirmBtn = document.getElementById(`confirm-${idPrefix}-btn`);
  const proposalErrorEl = document.getElementById(`${idPrefix}-error`);

  // Same weekly-grid look as the "Schedule a match" form that created this
  // proposal, but single-pick instead of multi-toggle: only cells matching
  // one of this card's own slots are clickable, everything else is inert
  // filler that keeps the calendar shape recognizable. The day range comes
  // from the actual proposed dates (not a fixed 14 days), paged in weeks of
  // 7 the same way, so a short proposal doesn't drag in empty weeks.
  const proposalSlotSet = new Set(slots);
  const dayDates = slots.map((iso) => {
    const d = new Date(iso);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const minDay = new Date(Math.min(...dayDates));
  const maxDay = new Date(Math.max(...dayDates));
  const proposalDays = [];
  for (let d = new Date(minDay); d <= maxDay; d.setDate(d.getDate() + 1)) proposalDays.push(new Date(d));
  const proposalWeeks = [];
  for (let i = 0; i < proposalDays.length; i += 7) proposalWeeks.push(proposalDays.slice(i, i + 7));
  let proposalActiveWeek = 0;

  function renderProposalWeekTabs() {
    const tabsEl = document.getElementById(`${idPrefix}-week-tabs`);
    if (proposalWeeks.length <= 1) { tabsEl.style.display = 'none'; return; }
    const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    tabsEl.innerHTML = proposalWeeks.map((days, i) => `
      <button type="button" class="tab${i === proposalActiveWeek ? ' active' : ''}" data-week="${i}">Week ${i + 1}<span>${fmt(days[0])} – ${fmt(days[days.length - 1])}</span></button>
    `).join('');
    tabsEl.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        proposalActiveWeek = Number(btn.dataset.week);
        renderProposalWeekTabs();
        renderProposalGrid();
      });
    });
  }

  function renderProposalGrid() {
    const days = proposalWeeks[proposalActiveWeek];
    const dayHead = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })}`;
    let html = `<div class="availability-grid" style="grid-template-columns:44px repeat(${days.length}, 1fr)"><div class="avail-corner"></div>`;
    for (const d of days) html += `<div class="avail-day-head">${dayHead(d)}</div>`;
    for (let h = 7; h < 22; h++) {
      html += `<div class="avail-time-label">${String(h).padStart(2, '0')}:00</div>`;
      for (const d of days) {
        const cellDate = new Date(d);
        cellDate.setHours(h, 0, 0, 0);
        const iso = cellDate.toISOString();
        const isProposed = proposalSlotSet.has(iso);
        const isSelected = iso === selectedSlot;
        html += `<div class="avail-cell${isProposed ? ' proposed' : ''}${isSelected ? ' selected' : ''}" data-iso="${iso}" data-proposed="${isProposed ? '1' : '0'}"></div>`;
      }
    }
    html += '</div>';
    document.getElementById(`${idPrefix}-grid-wrap`).innerHTML = html;

    document.querySelectorAll(`#${idPrefix}-grid-wrap .avail-cell[data-proposed="1"]`).forEach((cell) => {
      cell.addEventListener('click', () => {
        selectedSlot = cell.dataset.iso;
        renderProposalGrid();
        confirmBtn.disabled = !(selectedSlot && selectedVenue);
      });
    });
  }

  renderProposalWeekTabs();
  renderProposalGrid();

  const venueBtns = card.querySelectorAll(`#${idPrefix}-venue-list .proposal-option`);
  venueBtns.forEach((btn) => btn.addEventListener('click', () => {
    selectedVenue = btn.dataset.venue;
    venueBtns.forEach((b) => b.classList.toggle('selected', b === btn));
    confirmBtn.disabled = !(selectedSlot && selectedVenue);
  }));
  // Viewing the card and marking a slot/venue is open to anyone with the
  // link, but actually confirming one requires being logged in as one of
  // the two specific players in this match (or admin) — mirrors the
  // server-side gate in POST /:token/respond-proposal. Prompts login if
  // logged out, then rejects immediately with a clear message if this
  // isn't one of the two players in the match, same pattern as
  // handlePlannedActionClick in app.js. A player also can't confirm their
  // own card — only the *other* player's calendar is theirs to pick from.
  confirmBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    if (!selectedSlot || !selectedVenue) return;
    const playsInMatch = isAdminUser || (playerAuthed && currentPlayerId
      && (currentPlayerId === m.player1.id || currentPlayerId === m.player2.id));
    if (!playsInMatch) {
      proposalErrorEl.textContent = 'Log in as one of the two players in this match to pick a time.';
      return;
    }
    if (!isAdminUser && proposerPlayerId && currentPlayerId === proposerPlayerId) {
      proposalErrorEl.textContent = "You can't confirm the times you proposed yourself — wait for the other player to pick one.";
      return;
    }
    confirmBtn.disabled = true;
    proposalErrorEl.textContent = '';
    try {
      const updated = await api(`/matches/${matchToken}/respond-proposal`, {
        method: 'POST',
        body: { slot: selectedSlot, venue: selectedVenue },
      });
      toast('Time confirmed!');
      render(updated);
    } catch (err) {
      proposalErrorEl.textContent = err.message;
      confirmBtn.disabled = false;
    }
  }));

  // "Edit" — the proposer changing their own offer. Requires login (same
  // as editing Location/Date), unlike everything else on this card.
  const editProposalLink = document.getElementById(`edit-${idPrefix}-link`);
  if (editProposalLink) editProposalLink.addEventListener('click', () => requirePlayerAuth(() => (isPrimary ? openEditProposalModal(m) : openCounterProposeModal(m, { editing: true }))));

  // "Delete" — cancels this proposal outright (see PATCH /:token's
  // proposalSlots/counterProposalSlots: null handling), same access as
  // Edit. Deleting the primary card takes any counter-proposal with it
  // (nothing left to counter) — see the server-side comment.
  const deleteProposalLink = document.getElementById(`delete-${idPrefix}-link`);
  if (deleteProposalLink) deleteProposalLink.addEventListener('click', () => requirePlayerAuth(async () => {
    if (!confirm('Delete this proposal? The proposed times and venues will be removed.')) return;
    deleteProposalLink.disabled = true;
    try {
      const updated = await api(`/matches/${matchToken}`, {
        method: 'PATCH',
        body: isPrimary ? { proposalSlots: null } : { counterProposalSlots: null },
      });
      toast('Proposal deleted');
      render(updated);
    } catch (err) {
      toast(err.message);
      deleteProposalLink.disabled = false;
    }
  }));
}

function render(m) {
  current = m;
  // Always shows a timer chip, even before the match has started (a static
  // 00:00) — only actually starts counting once startTimer() runs, for LIVE.
  const durationHtml = m.status === 'LIVE'
    ? `<div class="timer${m.pausedAt ? ' timer-paused' : ''}" id="timer">00:00</div>${m.pausedAt ? '<div class="paused-label">⏸ PAUSED</div>' : ''}`
    : (m.startTime && m.endTime
      ? `<div class="timer">${Math.max(1, Math.round((new Date(m.endTime) - new Date(m.startTime)) / 60000))} min</div>`
      : '<div class="timer">00:00</div>');

  // Location/Date/Category/Notes all go through the same PATCH /:token +
  // checkMatchAccess path server-side, so they're gated together
  // client-side too — admin can always edit (even a finished match); a
  // real player or anon session otherwise needs canManageMatch to say
  // this is actually their match (see routes/matches.js).
  const locationEditable = (m.status !== 'FINISHED' || isAdminUser) && canManageMatch(m, isAdminUser);
  // A "propose times" match has no real location/date yet — say so plainly
  // rather than showing "Not set", since a response is actually pending
  // (see the proposal card below, where anyone with this link picks one).
  const awaitingProposal = !!(m.proposalSlots && !m.scheduledAt);
  const locationValue = m.location ? escapeHtml(m.location)
    : awaitingProposal ? '<span style="color:var(--gray)">Awaiting response…</span>'
    : '<span style="color:var(--gray)">Not set</span>';
  const dateValue = m.scheduledAt ? fmtDateLong(m.scheduledAt)
    : awaitingProposal ? '<span style="color:var(--gray)">Awaiting response…</span>'
    : fmtDateLong(m.scheduledAt);

  root.innerHTML = `
    <div class="match-header">
      <div>
        ${categoryBadge(m.category)} ${statusBadge(m.status)}${m.status === 'LIVE' ? ` <span class="badge badge-viewers" id="viewer-count-badge">👀 ${viewerCount !== null ? viewerCount : '…'} watching</span>` : ''}
        <h1 style="margin-top:8px">${escapeHtml(m.player1.name)}<a class="player-info-link" href="/player/${m.player1.slug || m.player1.id}" title="View ${escapeHtml(m.player1.name)}'s profile">i</a> <span style="color:var(--gray-dim);font-weight:500">vs</span> ${escapeHtml(m.player2.name)}<a class="player-info-link" href="/player/${m.player2.slug || m.player2.id}" title="View ${escapeHtml(m.player2.name)}'s profile">i</a></h1>
        <div style="color:var(--gray-dim);font-size:13px">${m.formatLabel}</div>
      </div>
    </div>

    ${scoreboardHtml(m, durationHtml)}
    ${controlsHtml(m)}

    <div class="info-grid">
      <div class="info-item">
        <div class="label">Location</div>
        <div class="value" id="location-display">${locationValue}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-location-link">Edit</button>` : ''}
      </div>
      <div class="info-item">
        <div class="label">Date</div>
        <div class="value" id="date-display">${dateValue}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-date-link">Edit</button>` : ''}
      </div>
      <div class="info-item">
        <div class="label">Category</div>
        <div class="value" id="category-display">${CATEGORY_LABELS[m.category]}</div>
        ${locationEditable ? `<button type="button" class="edit-link" id="edit-category-link">Edit</button>` : ''}
      </div>
    </div>

    ${awaitingProposal ? proposalCardHtml(m) : ''}

    ${h2hHtml}

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
      <button class="btn" id="embed-btn">🧩 Embed</button>
      ${(m.status === 'LIVE' || m.status === 'PLANNED') ? '<button class="btn" id="change-format-btn">🎾 Change format</button>' : ''}
      ${m.status === 'FINISHED' ? '<button class="btn btn-green" id="whatsapp-result-btn">📱 Send to WhatsApp</button>' : ''}
      ${isAdminUser || (m.status !== 'FINISHED' && !m.createdByAdmin) ? '<button class="btn btn-danger" id="delete-btn">🗑 Delete match</button>' : ''}
    </div>
  `;

  if (m.status === 'LIVE' && m.startTime) startTimer(m);
  else clearInterval(timerInterval);

  attachHandlers(m);
  ensureH2H(m);
}

function attachHandlers(m) {
  // Start live match / Enter result manually: prompt login if logged out
  // (requirePlayerAuth), then — the moment login is confirmed — reject
  // immediately with checkMatchAccess's own message if this isn't a match
  // this player/anon session can manage, rather than only rejecting after
  // they've filled out and submitted the schedule/first-server/result
  // form. Same pattern as handlePlannedActionClick in app.js.
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', () => requirePlayerAuth(() => {
    if (!canManageMatch(m, isAdminUser)) {
      toast('You can only manage matches you play in (if an admin created them) or matches you created yourself');
      return;
    }
    if (!m.location || !m.scheduledAt) {
      openStartScheduleModal(m, (updated) => openFirstServerModal(updated));
    } else {
      openFirstServerModal(m);
    }
  }));

  const manualResultBtn = document.getElementById('manual-result-btn');
  if (manualResultBtn) manualResultBtn.addEventListener('click', () => requirePlayerAuth(() => {
    if (!canManageMatch(m, isAdminUser)) {
      toast('You can only manage matches you play in (if an admin created them) or matches you created yourself');
      return;
    }
    openManualResultModal(m);
  }));

  // Proposal response card(s) — viewing/marking a slot is open to anyone
  // with the link, but confirming one is gated to the two match players
  // (or admin) inside attachProposalCardHandlers itself, matching the
  // server's POST /:token/respond-proposal (see oneProposalCardHtml
  // above). One call per card that's actually on the page — the primary
  // proposal, and the counter-proposal too once there is one.
  attachProposalCardHandlers(m, 'primary');
  if (m.counterProposalSlots) attachProposalCardHandlers(m, 'counter');

  // "Propose your own times instead" — only present on the primary card
  // while there's no counter-proposal yet (see oneProposalCardHtml).
  // Deliberately NOT behind requirePlayerAuth — same public, share-link
  // trust model as viewing the card, unlike actually confirming a slot
  // (see attachProposalCardHandlers), which does require being one of the
  // two match players.
  const counterProposeLink = document.getElementById('counter-propose-link');
  if (counterProposeLink) counterProposeLink.addEventListener('click', () => openCounterProposeModal(m));

  root.querySelectorAll('.btn-giant, .btn-minus').forEach((btn) => {
    btn.addEventListener('click', () => requirePlayerAuth(async () => {
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = true);
      const body = { player: Number(btn.dataset.player), delta: Number(btn.dataset.delta) };
      // Ordinary in-progress scoring goes through the plain path so the
      // engine's auto-advance to the next set keeps working (editSetScore
      // intentionally has none). But once the natural/active set has
      // already decided the match, applyDelta just no-ops on it — so a
      // correction there (e.g. undoing an over-click) has to go through
      // editSetScore too, same as correcting any earlier set.
      const naturalIndex = m.status === 'LIVE' ? m.state.currentSet : m.state.sets.length - 1;
      const effIndex = getEffectiveSetIndex(m);
      if (m.status !== 'LIVE' || m.state.status === 'COMPLETE' || effIndex !== naturalIndex) body.setIndex = effIndex;
      const wasComplete = m.state.status === 'COMPLETE';
      const setsBefore = m.state.sets.length;
      try {
        const updated = await api(`/matches/${matchToken}/score`, { method: 'POST', body });
        // Whenever this click causes a new set to appear — a picker
        // correction that re-decides an earlier set, or a sticky picker
        // selection that happened to match the natural set as it finished
        // normally — follow onto it instead of staying pinned to the now-
        // finished one, same as live scoring always tracks the active set.
        if (updated.state.sets.length > setsBefore) {
          editSetIndex = updated.state.sets.length - 1;
        }
        // Always render straight from this response rather than waiting on
        // the matches:changed socket echo — on mobile, backgrounding the
        // tab (screen lock, app switch) commonly drops the socket, so the
        // echo can arrive late or not at all even though the score change
        // itself went through; without this the screen was stuck showing
        // the pre-click score until a manual page refresh.
        render(updated);
        if (!wasComplete && updated.status === 'LIVE' && updated.state.status === 'COMPLETE') {
          offerFinish(updated);
        }
      } catch (err) { toast(err.message); }
      root.querySelectorAll('.btn-giant, .btn-minus').forEach((b) => b.disabled = false);
    }));
  });

  root.querySelectorAll('.set-picker-btn[data-set-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editSetIndex = Number(btn.dataset.setIndex);
      render(current);
    });
  });

  root.querySelectorAll('.set-picker-btn[data-set-style]').forEach((btn) => {
    btn.addEventListener('click', () => requirePlayerAuth(async () => {
      try { render(await api(`/matches/${matchToken}/set-style`, { method: 'PATCH', body: { style: btn.dataset.setStyle } })); }
      catch (err) { toast(err.message); }
    }));
  });

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    try { render(await api(`/matches/${matchToken}/pause`, { method: 'POST' })); }
    catch (err) { toast(err.message); }
  }));

  const resumeBtn = document.getElementById('resume-btn');
  if (resumeBtn) resumeBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    try { render(await api(`/matches/${matchToken}/resume`, { method: 'POST' })); }
    catch (err) { toast(err.message); }
  }));

  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    if (!confirm("Restart this match? The score and timer will be cleared and the match will go back to Planned. Are you sure?")) return;
    restartBtn.disabled = true;
    try { render(await api(`/matches/${matchToken}/restart`, { method: 'POST' })); }
    catch (err) { toast(err.message); restartBtn.disabled = false; }
  }));

  const finishBtn = document.getElementById('finish-btn');
  if (finishBtn) finishBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    // Free Play never reaches state.status === 'COMPLETE' on its own — but
    // if one player has clearly won more sets, finishing is just a normal
    // decided finish (the server picks that player); only a genuine tie
    // needs the "who won" prompt, same as any other undecided finish.
    const freePlayDecided = m.format === 'FREE_PLAY' && m.state.setsWon[1] !== m.state.setsWon[2];
    if (m.state.status !== 'COMPLETE' && !freePlayDecided) {
      openFinishUndecidedModal(m);
      return;
    }
    if (!confirm("Finish this match? The result can't be changed afterward (only an admin will be able to correct it later). Are you sure?")) return;
    finishBtn.disabled = true;
    try {
      const finished = await api(`/matches/${matchToken}/finish`, { method: 'POST' });
      render(finished);
      openWhatsAppResultModal(finished);
    }
    catch (err) { toast(err.message); finishBtn.disabled = false; }
  }));

  const unfinishedBtn = document.getElementById('unfinished-btn');
  if (unfinishedBtn) unfinishedBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    if (!confirm("Mark this match unfinished? No winner is recorded, and it won't count toward stats. You can pick a new date and resume it later, whenever you're ready.")) return;
    unfinishedBtn.disabled = true;
    try { render(await api(`/matches/${matchToken}/unfinished`, { method: 'POST' })); }
    catch (err) { toast(err.message); unfinishedBtn.disabled = false; }
  }));

  const resumeLaterBtn = document.getElementById('resume-later-btn');
  if (resumeLaterBtn) resumeLaterBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    resumeLaterBtn.disabled = true;
    try {
      const updated = await api(`/matches/${matchToken}/resume-later`, { method: 'POST' });
      render(updated);
      toast('Back to Planned — set a new date and location, then start it whenever you\'re ready.');
    } catch (err) { toast(err.message); resumeLaterBtn.disabled = false; }
  }));

  const finishAsIsBtn = document.getElementById('finish-as-is-btn');
  if (finishAsIsBtn) finishAsIsBtn.addEventListener('click', () => requirePlayerAuth(async () => {
    if (!confirm("Finish this match with the score exactly as it is? This can't be changed afterward, and it won't count toward stats or badges.")) return;
    finishAsIsBtn.disabled = true;
    try { render(await api(`/matches/${matchToken}/finish-as-is`, { method: 'POST' })); }
    catch (err) { toast(err.message); finishAsIsBtn.disabled = false; }
  }));

  const editLink = document.getElementById('edit-location-link');
  if (editLink) editLink.addEventListener('click', () => requirePlayerAuth(() => {
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
      try { render(await api(`/matches/${matchToken}`, { method: 'PATCH', body: { location: val } })); }
      catch (err) { toast(err.message); }
    });
  }));

  const editDateLink = document.getElementById('edit-date-link');
  if (editDateLink) editDateLink.addEventListener('click', () => requirePlayerAuth(() => {
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
      try { render(await api(`/matches/${matchToken}`, { method: 'PATCH', body: { scheduledAt } })); }
      catch (err) { toast(err.message); }
    };
    document.getElementById('save-date-btn').addEventListener('click', () => {
      const dateVal = document.getElementById('date-input').value;
      const timeVal = document.getElementById('time-input').value;
      saveDate(dateVal ? new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString() : null);
    });
    document.getElementById('clear-date-btn').addEventListener('click', () => saveDate(null));
  }));

  const editNotesLink = document.getElementById('edit-notes-link');
  if (editNotesLink) editNotesLink.addEventListener('click', () => requirePlayerAuth(() => {
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
      try { render(await api(`/matches/${matchToken}`, { method: 'PATCH', body: { notes: val } })); }
      catch (err) { toast(err.message); }
    });
  }));

  const editCategoryLink = document.getElementById('edit-category-link');
  if (editCategoryLink) editCategoryLink.addEventListener('click', () => requirePlayerAuth(() => {
    const display = document.getElementById('category-display');
    const options = Object.keys(CATEGORY_LABELS).map((key) =>
      `<option value="${key}"${key === m.category ? ' selected' : ''}>${CATEGORY_LABELS[key]}</option>`).join('');
    display.innerHTML = `
      <select id="category-input" style="width:100%;padding:6px 8px;border-radius:6px;border:1.5px solid #ddd;font-family:inherit">${options}</select>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" id="save-category-btn">Save</button>
        <button class="btn btn-sm btn-outline" id="cancel-category-btn">Cancel</button>
      </div>
    `;
    editCategoryLink.style.display = 'none';
    document.getElementById('category-input').focus();
    document.getElementById('cancel-category-btn').addEventListener('click', () => render(current));
    document.getElementById('save-category-btn').addEventListener('click', async () => {
      const val = document.getElementById('category-input').value;
      try { render(await api(`/matches/${matchToken}`, { method: 'PATCH', body: { category: val } })); }
      catch (err) { toast(err.message); }
    });
  }));

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
  const changeFormatBtn = document.getElementById('change-format-btn');
  if (changeFormatBtn) changeFormatBtn.addEventListener('click', () => requirePlayerAuth(() => openChangeFormatModal(m)));
  const whatsappResultBtn = document.getElementById('whatsapp-result-btn');
  if (whatsappResultBtn) whatsappResultBtn.addEventListener('click', () => openWhatsAppResultModal(m));

  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => requirePlayerAuth(async () => {
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
  }));
}

function startMatch(firstServer) {
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.disabled = true;
  document.getElementById('first-server-modal').style.display = 'none';
  api(`/matches/${matchToken}/start`, { method: 'POST', body: { firstServer } })
    .then((updated) => render(updated))
    .catch((err) => {
      toast(err.message);
      if (startBtn) startBtn.disabled = false;
    });
}

// Gate in front of starting a live match: a match needs a location and date
// before it can go live, so if either is missing this collects them first
// and only then hands off to onDone (normally openFirstServerModal) with
// the freshly patched match.
function openStartScheduleModal(m, onDone) {
  document.getElementById('start-schedule-location').value = m.location || '';
  document.getElementById('start-schedule-date').value = toDateValue(m.scheduledAt);
  document.getElementById('start-schedule-time').value = toTimeValue(m.scheduledAt);
  const errorEl = document.getElementById('start-schedule-error');
  errorEl.textContent = '';
  const form = document.getElementById('start-schedule-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const location = document.getElementById('start-schedule-location').value.trim();
    const dateVal = document.getElementById('start-schedule-date').value;
    const timeVal = document.getElementById('start-schedule-time').value;
    if (!location || !dateVal) {
      errorEl.textContent = 'Location and date are both required.';
      return;
    }
    const scheduledAt = new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const updated = await api(`/matches/${matchToken}`, { method: 'PATCH', body: { location, scheduledAt } });
      document.getElementById('start-schedule-modal').style.display = 'none';
      onDone(updated);
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  };
  document.getElementById('start-schedule-modal').style.display = 'flex';
}

// "Edit" on the proposal card — the proposer changing their own offer
// before anyone's confirmed it. Requires login (see attachHandlers above),
// same widgets as the Schedule a match page, pre-filled with what's
// already proposed.
const editAvailabilityPicker = createAvailabilityPicker({ weekTabsId: 'edit-week-tabs', gridWrapId: 'edit-availability-grid-wrap', slotCountId: 'edit-slot-count' });
const editVenuePicker = createVenueChipPicker({ listId: 'edit-venue-chip-list', inputId: 'edit-venue-input', addBtnId: 'edit-venue-add-btn' });
const editProposerPicker = createStaticPlayerChoicePicker('edit-proposer-choice-row');
document.getElementById('edit-clear-slots-btn').addEventListener('click', () => editAvailabilityPicker.clear());

function openEditProposalModal(m) {
  editAvailabilityPicker.reset();
  editAvailabilityPicker.setSlots(m.proposalSlots || []);
  editVenuePicker.clear();
  editVenuePicker.setVenues(m.proposalVenues || []);
  editProposerPicker.setNames(m.player1.name, m.player2.name);
  // If the logged-in player opening this modal is one of the two match
  // players, lock the answer to them instead of leaving it editable — see
  // createStaticPlayerChoicePicker's lock option.
  const forcedProposer = (playerAuthed && currentPlayerId)
    ? (currentPlayerId === m.player1.id ? 1 : currentPlayerId === m.player2.id ? 2 : null)
    : null;
  editProposerPicker.reset(forcedProposer != null ? forcedProposer : (m.proposedBy || null), { lock: forcedProposer != null });
  document.getElementById('edit-proposer-optional-hint').style.display = forcedProposer != null ? 'none' : '';
  document.getElementById('edit-notify-email').value = '';
  document.getElementById('edit-proposal-error').textContent = '';
  document.getElementById('edit-proposal-modal').style.display = 'flex';
}

document.getElementById('edit-proposal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('edit-proposal-error');
  errorEl.textContent = '';
  if (editAvailabilityPicker.selectedSlots.size === 0) {
    errorEl.textContent = 'Mark at least one time you can play.';
    return;
  }
  if (editVenuePicker.venues.length === 0) {
    errorEl.textContent = 'Add at least one preferred venue.';
    return;
  }
  const notifyEmail = document.getElementById('edit-notify-email').value.trim();
  if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    errorEl.textContent = 'Enter a valid confirmation email address, or leave it blank.';
    return;
  }
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const updated = await api(`/matches/${matchToken}`, {
      method: 'PATCH',
      body: {
        proposalSlots: Array.from(editAvailabilityPicker.selectedSlots),
        proposalVenues: editVenuePicker.venues,
        proposedBy: editProposerPicker.getPicked(),
        proposalNotifyEmail: notifyEmail || undefined,
      },
    });
    document.getElementById('edit-proposal-modal').style.display = 'none';
    toast('Proposal updated!');
    render(updated);
  } catch (err) {
    errorEl.textContent = err.message;
  }
  submitBtn.disabled = false;
});

// "Propose your own times instead" — the other player submitting their own
// availability as a second, independent proposal rather than picking from
// what's offered (see POST /:token/counter-propose — it no longer
// replaces the first proposal, both stand side by side, see
// oneProposalCardHtml). Deliberately public (see attachProposalCardHandlers
// above) — no login needed to submit a counter-proposal, same share-link
// trust model as viewing the card (unlike actually confirming a slot,
// which does require being one of the two match players). Reused for
// editing an existing counter-proposal too (its own "Edit" link reaches
// here with `editing: true`) — same form, pre-filled instead of starting
// empty, same POST route since it already just overwrites whatever
// counter-proposal is there.
const counterAvailabilityPicker = createAvailabilityPicker({ weekTabsId: 'counter-week-tabs', gridWrapId: 'counter-availability-grid-wrap', slotCountId: 'counter-slot-count' });
const counterVenuePicker = createVenueChipPicker({ listId: 'counter-venue-chip-list', inputId: 'counter-venue-input', addBtnId: 'counter-venue-add-btn' });
const counterProposerPicker = createStaticPlayerChoicePicker('counter-proposer-choice-row');
document.getElementById('counter-clear-slots-btn').addEventListener('click', () => counterAvailabilityPicker.clear());

function openCounterProposeModal(m, { editing = false } = {}) {
  counterAvailabilityPicker.reset();
  if (editing) counterAvailabilityPicker.setSlots(m.counterProposalSlots || []);
  counterVenuePicker.clear();
  if (editing) counterVenuePicker.setVenues(m.counterProposalVenues || []);
  counterProposerPicker.setNames(m.player1.name, m.player2.name);
  // Deliberately public (see the comment above) so most visitors here
  // aren't logged in as anyone in particular — but if this happens to be
  // one of the two match players, lock the answer to them same as the
  // other proposer pickers.
  const forcedProposer = (playerAuthed && currentPlayerId)
    ? (currentPlayerId === m.player1.id ? 1 : currentPlayerId === m.player2.id ? 2 : null)
    : null;
  counterProposerPicker.reset(forcedProposer != null ? forcedProposer : (editing ? (m.counterProposedBy || null) : null), { lock: forcedProposer != null });
  document.getElementById('counter-proposer-optional-hint').style.display = forcedProposer != null ? 'none' : '';
  document.getElementById('counter-notify-email').value = '';
  document.getElementById('counter-propose-error').textContent = '';
  document.getElementById('counter-propose-modal-title').textContent = editing ? 'Edit your proposed times' : 'Propose your own times instead';
  document.getElementById('counter-propose-modal-desc').textContent = editing
    ? "Update what works for you — the other player picks from these instead, or from the match's original options."
    : "None of the offered times work? Mark what does work for you — it shows up as its own calendar alongside the original, and either one can be picked from.";
  document.getElementById('counter-propose-submit-btn').textContent = editing ? 'Update my times' : 'Send my times instead';
  document.getElementById('counter-propose-modal').style.display = 'flex';
}

document.getElementById('counter-propose-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('counter-propose-error');
  errorEl.textContent = '';
  if (counterAvailabilityPicker.selectedSlots.size === 0) {
    errorEl.textContent = 'Mark at least one time you can play.';
    return;
  }
  if (counterVenuePicker.venues.length === 0) {
    errorEl.textContent = 'Add at least one preferred venue.';
    return;
  }
  const notifyEmail = document.getElementById('counter-notify-email').value.trim();
  if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    errorEl.textContent = 'Enter a valid confirmation email address, or leave it blank.';
    return;
  }
  const wasEditing = !!(current && current.counterProposalSlots);
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const updated = await api(`/matches/${matchToken}/counter-propose`, {
      method: 'POST',
      body: {
        proposalSlots: Array.from(counterAvailabilityPicker.selectedSlots),
        proposalVenues: counterVenuePicker.venues,
        proposedBy: counterProposerPicker.getPicked(),
        proposalNotifyEmail: notifyEmail || undefined,
      },
    });
    document.getElementById('counter-propose-modal').style.display = 'none';
    render(updated);
    // A brand-new counter-proposal gets the share-with-opponent popup
    // (link + Copy link) as its confirmation, same as the homepage's
    // Propose Times flow — editing an existing one just needs the toast,
    // since whoever's viewing this page already has the link.
    if (wasEditing) {
      toast('Your times were updated!');
    } else {
      openShareModal(updated, `${updated.player1.name} vs ${updated.player2.name} — pick a time that works for you:`);
    }
  } catch (err) {
    errorEl.textContent = err.message;
  }
  submitBtn.disabled = false;
});

function openFirstServerModal(m) {
  document.getElementById('first-server-p1-btn').textContent = m.player1.name;
  document.getElementById('first-server-p1-btn').onclick = () => startMatch(1);
  document.getElementById('first-server-p2-btn').textContent = m.player2.name;
  document.getElementById('first-server-p2-btn').onclick = () => startMatch(2);
  document.getElementById('first-server-skip-btn').onclick = () => startMatch(null);
  document.getElementById('first-server-modal').style.display = 'flex';
}

function openChangeFormatModal(m) {
  const container = document.getElementById('change-format-options');
  const errorEl = document.getElementById('change-format-error');
  errorEl.textContent = '';
  container.innerHTML = FORMATS_LIST.map((f) => `
    <label class="format-option">
      <input type="radio" name="change-format" value="${f.key}" ${f.key === m.format ? 'checked' : ''}>
      <span>
        <div style="font-weight:700">${f.label}${f.sublabel ? ` <span style="font-weight:400;color:var(--gray);font-size:12px">${f.sublabel}</span>` : ''}</div>
      </span>
    </label>
  `).join('');
  container.querySelectorAll('input[name="change-format"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (input.value === m.format) return;
      errorEl.textContent = '';
      try {
        const updated = await api(`/matches/${matchToken}/format`, { method: 'PATCH', body: { format: input.value } });
        document.getElementById('change-format-modal').style.display = 'none';
        render(updated);
      } catch (err) {
        errorEl.textContent = err.message;
        input.checked = false;
        const currentInput = container.querySelector(`input[value="${m.format}"]`);
        if (currentInput) currentInput.checked = true;
      }
    });
  });
  document.getElementById('change-format-modal').style.display = 'flex';
}

function openFinishUndecidedModal(m) {
  // Free Play only reaches this modal on a genuine tie (or 0-0) — there's
  // no walkover/retirement concept for an open-ended practice match, so it
  // only needs a winner, not a reason.
  const isFreePlay = m.format === 'FREE_PLAY';
  let winner = null;
  let reason = null;
  const winnerBtns = Array.from(document.querySelectorAll('#finish-winner-row button'));
  const reasonBtns = Array.from(document.querySelectorAll('#finish-reason-row button'));
  const confirmBtn = document.getElementById('finish-undecided-confirm-btn');
  const reasonSection = document.getElementById('finish-reason-section');

  document.getElementById('finish-undecided-title').textContent = isFreePlay ? 'Sets are tied — who won?' : 'Finish without a completed score?';
  document.getElementById('finish-undecided-desc').textContent = isFreePlay
    ? "You're tied on sets — pick who won this session."
    : "The match isn't decided by score yet. Pick who won and why.";
  reasonSection.style.display = isFreePlay ? 'none' : '';

  winnerBtns[0].textContent = m.player1.name;
  winnerBtns[0].dataset.winner = '1';
  winnerBtns[1].textContent = m.player2.name;
  winnerBtns[1].dataset.winner = '2';

  const updateConfirm = () => { confirmBtn.disabled = isFreePlay ? !winner : !(winner && reason); };

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
      render(finished);
      openWhatsAppResultModal(finished);
    } catch (err) {
      toast(err.message);
      confirmBtn.disabled = false;
    }
  };

  document.getElementById('finish-undecided-modal').style.display = 'flex';
}

// openShareModal now lives in common.js — used here by the plain "🔗
// Share" button (default text) and by the propose-times/counter-propose
// success flows (their own text, see attachHandlers/openCounterProposeModal
// call sites) — and by app.js's homepage propose-times flow too.

// Fired right when a scoring click decides the match, so the last point can't
// just keep growing the score — offers to finish it immediately instead.
function offerFinish(m) {
  if (!confirm(`${m.scoreSummary} — the match is decided! Finish it now?`)) return;
  api(`/matches/${matchToken}/finish`, { method: 'POST' })
    .then((finished) => { render(finished); openWhatsAppResultModal(finished); })
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
  document.getElementById('manual-result-location').value = m.location || '';
  document.getElementById('manual-result-date').value = toDateValue(m.scheduledAt);
  document.getElementById('manual-result-time').value = toTimeValue(m.scheduledAt);
  const errorEl = document.getElementById('manual-result-error');
  errorEl.textContent = '';
  const form = document.getElementById('manual-result-form');

  const retiredCheckbox = document.getElementById('manual-result-retired-checkbox');
  const retiredFields = document.getElementById('manual-result-retired-fields');
  const unfinishedCheckbox = document.getElementById('manual-result-unfinished-checkbox');
  retiredCheckbox.checked = false;
  unfinishedCheckbox.checked = false;
  retiredFields.style.display = 'none';
  // Mutually exclusive — a walkover/retirement claims a winner+reason, while
  // Unfinished explicitly declines to claim anything, so only one can apply.
  retiredCheckbox.onchange = () => {
    retiredFields.style.display = retiredCheckbox.checked ? 'block' : 'none';
    if (retiredCheckbox.checked) unfinishedCheckbox.checked = false;
  };
  unfinishedCheckbox.onchange = () => {
    if (unfinishedCheckbox.checked) {
      retiredCheckbox.checked = false;
      retiredFields.style.display = 'none';
    }
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

    const location = document.getElementById('manual-result-location').value.trim();
    const dateVal = document.getElementById('manual-result-date').value;
    const timeVal = document.getElementById('manual-result-time').value;
    if (!location || !dateVal) {
      errorEl.textContent = 'Location and date are both required.';
      return;
    }
    const scheduledAt = new Date(`${dateVal}T${timeVal || '00:00'}`).toISOString();

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

    const body = { sets, location, scheduledAt };
    if (retiredCheckbox.checked) {
      if (!winner || !reason) {
        errorEl.textContent = 'Pick who won and why.';
        return;
      }
      body.winner = winner;
      body.reason = reason;
    } else if (unfinishedCheckbox.checked) {
      if (sets.length === 0) {
        errorEl.textContent = 'Enter at least one set score.';
        return;
      }
      body.unfinished = true;
    } else if (sets.length === 0) {
      errorEl.textContent = 'Enter at least one set score.';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const finished = await api(`/matches/${matchToken}/manual-result`, { method: 'POST', body });
      document.getElementById('manual-result-modal').style.display = 'none';
      render(finished);
      // An unfinished result has no result to share — only pop the
      // WhatsApp-share modal when the match actually finished.
      if (finished.status === 'FINISHED') openWhatsAppResultModal(finished);
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  };
  document.getElementById('manual-result-modal').style.display = 'flex';
}

async function init() {
  // Both awaited before the first render() — canManageMatch (used for the
  // Location/Date/Category/Notes Edit links and the proposal card's Edit
  // link) needs isAdminUser/playerAuthed/currentPlayerId settled first, or
  // a first render that happens to win the race against common.js's own
  // (unawaited) session check would incorrectly hide them for an already
  // logged-in player.
  isAdminUser = await checkAdmin();
  await refreshPlayerAuth();
  try {
    const m = await api(`/matches/${matchToken}`);
    try { messages = await api(`/matches/${matchToken}/messages`); } catch { /* chat is best-effort */ }
    render(m);
  } catch (err) {
    root.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    return;
  }
  // Re-render once a *later* login/logout finishes (see the
  // blta:auth-changed dispatch in common.js) — registered only after the
  // refreshPlayerAuth() call above so its own initial dispatch doesn't
  // trigger a redundant extra render right after this one.
  window.addEventListener('blta:auth-changed', () => { if (current) render(current); });
  const socket = io();
  socket.emit('join', `match:${matchToken}`);
  socket.on('match:update', (m) => {
    if (m.token === matchToken) render(m);
  });
  socket.on('message:new', ({ token, message }) => {
    if (token !== matchToken) return;
    appendChatMessage(message);
  });
  socket.on('viewers:count', ({ room, count }) => {
    if (room !== `match:${matchToken}`) return;
    viewerCount = count;
    const badge = document.getElementById('viewer-count-badge');
    if (badge) badge.textContent = `👀 ${count} watching`;
  });
}
init();
