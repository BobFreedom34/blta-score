// The live screen of a match (/screen/<token>): a full-page scoreboard for a TV or a projector at the court. It follows the match by itself (Socket.IO, and a
// refresh every 20 seconds in case the connection drops), and has a full-screen button (also the F key) and a way back to the match page.
const screenToken = window.location.pathname.split('/').filter(Boolean).pop();
const scrRoot = document.getElementById('scr');
let scrMatch = null;
let scrUpdatedAt = null;
let scrError = '';
let scrIdleTimer = null;

const scrPad = (n) => String(n).padStart(2, '0');
const scrTime = (d) => `${scrPad(d.getHours())}:${scrPad(d.getMinutes())}`;
const scrDate = (d) => `${weekdayShort(d)} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;

function scrPhase(m) {
  const fromBracket = typeof bracketPhaseLabel === 'function' ? bracketPhaseLabel(m.bracket) : '';
  if (fromBracket) return fromBracket;
  if (m.stage === 'PLAYOFF') return t('season.playoff');
  if (m.round) return t('season.roundN', { n: m.round });
  return '';
}

function scrInitials(name) {
  return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function scrAvatar(p) {
  const photo = p.photo_url || p.photoUrl;
  return photo
    ? `<img class="scr-avatar" src="${escapeHtml(photo)}" alt="">`
    : `<div class="scr-avatar" aria-hidden="true">${escapeHtml(scrInitials(p.name))}</div>`;
}

function scrSetChip(set, i) {
  const label = set.isSuperTiebreak ? tl('MTB', 'MTB') : `${tl('Set', 'Set')} ${i + 1}`;
  const tb = set.tiebreak && !set.isSuperTiebreak ? `<sup>${Math.min(set.tiebreak.p1, set.tiebreak.p2)}</sup>` : '';
  return `<div class="scr-set"><small>${label}</small>${set.p1}:${set.p2}${tb}</div>`;
}

// the middle of the screen, by the state of the match
function scrMiddle(m) {
  const st = m.state;
  const sets = st.sets || [];
  const won = st.setsWon || { 1: 0, 2: 0 };
  const startedSets = sets.filter((s) => s.winner || s.p1 || s.p2 || (s.tiebreak && (s.tiebreak.p1 || s.tiebreak.p2)));
  if (m.status === 'PLANNED') {
    const d = m.scheduledAt ? new Date(m.scheduledAt) : null;
    const valid = d && !Number.isNaN(d.getTime());
    return `
      <div class="scr-pill"><i></i>${escapeHtml(tl('Naplánovaný', 'Scheduled'))}</div>
      <div class="scr-label">${escapeHtml(valid ? tl('Začiatok', 'Start') : tl('Termín sa ešte dohodne', 'Time not agreed yet'))}</div>
      <div class="scr-big time">${valid ? scrTime(d) : '– : –'}</div>
      ${valid ? `<div class="scr-sub">${escapeHtml(scrDate(d))}</div>` : ''}`;
  }
  if (m.status === 'LIVE') {
    const cur = sets[st.currentSet] || sets[sets.length - 1] || { p1: 0, p2: 0 };
    const inTb = !!cur.tiebreak;
    const a = inTb ? cur.tiebreak.p1 : cur.p1;
    const b = inTb ? cur.tiebreak.p2 : cur.p2;
    const label = inTb
      ? (cur.isSuperTiebreak ? tl('Supertajbrejk', 'Match tie-break') : tl('Tajbrejk', 'Tie-break'))
      : `${tl('Set', 'Set')} ${(st.currentSet || 0) + 1}`;
    const done = sets.filter((s) => s.winner);
    return `
      <div class="scr-pill ${m.pausedAt ? 'paused' : 'live'}"><i></i>${escapeHtml(m.pausedAt ? tl('Prerušené', 'Paused') : tl('Naživo', 'Live'))}</div>
      <div class="scr-label">${escapeHtml(label)}</div>
      <div class="scr-big">${a}<span class="sep">:</span>${b}</div>
      <div class="scr-sub">${escapeHtml(tl('Sety', 'Sets'))} ${won[1]} : ${won[2]}</div>
      ${done.length ? `<div class="scr-sets">${sets.map((s, i) => (s.winner ? scrSetChip(s, i) : '')).join('')}</div>` : ''}
      <div class="scr-timer" id="scr-timer"></div>`;
  }
  // FINISHED or UNFINISHED
  const finished = m.status === 'FINISHED';
  return `
    <div class="scr-pill done"><i></i>${escapeHtml(finished ? tl('Ukončený', 'Finished') : tl('Predčasne ukončený', 'Ended early'))}</div>
    <div class="scr-label">${escapeHtml(finished ? tl('Konečný výsledok', 'Final result') : tl('Stav pri ukončení', 'Score when it ended'))}</div>
    <div class="scr-big">${won[1]}<span class="sep">:</span>${won[2]}</div>
    <div class="scr-sub">${escapeHtml(tl('Sety', 'Sets'))}</div>
    ${startedSets.length ? `<div class="scr-sets">${sets.map((s, i) => (startedSets.includes(s) ? scrSetChip(s, i) : '')).join('')}</div>` : ''}`;
}

function scrPlayer(m, num) {
  const p = num === 1 ? m.player1 : m.player2;
  const winner = m.status === 'FINISHED' && m.winnerId === p.id;
  return `
    <div class="scr-player p${num}${winner ? ' won' : ''}">
      ${scrAvatar(p)}
      <h2 class="scr-name">${escapeHtml(p.name)}</h2>
      ${winner ? `<div class="scr-winner">${escapeHtml(tl('Víťaz', 'Winner'))}</div>` : ''}
    </div>`;
}

function scrRender() {
  const m = scrMatch;
  if (!m) {
    scrRoot.innerHTML = `<div class="scr-loading">${escapeHtml(scrError || '…')}</div>`;
    return;
  }
  const title = m.season ? m.season.name : (m.league || categoryLabel(m.category));
  const phase = scrPhase(m);
  const meta = [
    phase ? `<span class="scr-phase">${escapeHtml(phase)}</span>` : '',
    m.season ? `<span>${escapeHtml(categoryLabel(m.category))}</span>` : '',
    m.group && m.group.name ? `<span>${escapeHtml(m.group.name)}</span>` : '',
    m.location ? `<span>${courtIcon('pin')} ${escapeHtml(m.location)}</span>` : '',
  ].filter(Boolean).join('');
  const fullscreenOn = !!document.fullscreenElement;
  scrRoot.innerHTML = `
    <header class="scr-head">
      <div class="scr-head-main">
        <h1 class="scr-comp">${escapeHtml(title)}</h1>
        <div class="scr-meta">${meta}</div>
      </div>
      <div class="scr-head-side">
        <div class="scr-clock" id="scr-clock"></div>
        <img class="scr-logo" src="/img/blta-logo-sm.png" alt="BLTA">
      </div>
    </header>
    <main class="scr-stage">
      ${scrPlayer(m, 1)}
      <div class="scr-mid">${scrMiddle(m)}</div>
      ${scrPlayer(m, 2)}
    </main>
    <footer class="scr-foot">
      <div class="left">${scrUpdatedAt ? `⟳ ${escapeHtml(tl('Obnovuje sa automaticky · naposledy', 'Updates by itself · last at'))} ${scrPad(scrUpdatedAt.getHours())}:${scrPad(scrUpdatedAt.getMinutes())}:${scrPad(scrUpdatedAt.getSeconds())}` : ''}</div>
      <div class="scr-controls">
        <a class="scr-btn" href="${escapeHtml(siteUrl(`/match/${encodeURIComponent(m.token)}`))}">← ${escapeHtml(tl('Späť na zápas', 'Back to the match'))}</a>
        <span class="scr-hint">${escapeHtml(tl('Kláves F = celá obrazovka', 'Key F = full screen'))}</span>
        <button type="button" class="scr-btn green" id="scr-full">${escapeHtml(fullscreenOn ? tl('Zavrieť celú obrazovku', 'Exit full screen') : tl('Celá obrazovka', 'Full screen'))}</button>
      </div>
      <div class="right">${escapeHtml(window.location.host)}/match/${escapeHtml(m.token.slice(0, 8))}…</div>
    </footer>`;
  scrTick();
}

// the clock and the timer of a live match tick by themselves, without drawing the page again
function scrTick() {
  const clock = document.getElementById('scr-clock');
  if (clock) clock.textContent = scrTime(new Date());
  const timer = document.getElementById('scr-timer');
  const m = scrMatch;
  if (timer && m && m.status === 'LIVE' && m.startTime) {
    const start = new Date(m.startTime).getTime();
    const nowMs = m.pausedAt ? new Date(m.pausedAt).getTime() : Date.now();
    const secs = Math.max(0, Math.floor((nowMs - start) / 1000) - (m.pausedSeconds || 0));
    const h = Math.floor(secs / 3600);
    const mm = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    timer.textContent = h > 0 ? `${h}:${scrPad(mm)}:${scrPad(s)}` : `${scrPad(mm)}:${scrPad(s)}`;
  }
}

function scrSet(m) {
  if (!m || m.token !== screenToken) return;
  scrMatch = m;
  scrUpdatedAt = new Date();
  scrError = '';
  scrRender();
}

async function scrLoad() {
  try {
    scrSet(await api(`/matches/${screenToken}`));
  } catch (err) {
    if (!scrMatch) { scrError = err.message; scrRender(); }
  }
}

function scrToggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}

// the mouse pointer (and in full screen the buttons) fade away after a few seconds of quiet
function scrWake() {
  document.body.classList.remove('idle');
  clearTimeout(scrIdleTimer);
  scrIdleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
}

scrRoot.addEventListener('click', (e) => { if (e.target.closest('#scr-full')) scrToggleFullscreen(); });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); scrToggleFullscreen(); }
  scrWake();
});
document.addEventListener('mousemove', scrWake);
document.addEventListener('touchstart', scrWake, { passive: true });
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-full', !!document.fullscreenElement);
  scrRender();
});

scrWake();
scrLoad();
setInterval(scrTick, 1000);
setInterval(scrLoad, 20000);
const scrSocket = io();
scrSocket.on('connect', () => scrSocket.emit('join', `match:${screenToken}`));
scrSocket.on('match:update', scrSet);
