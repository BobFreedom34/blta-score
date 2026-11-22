// The kiosk of a tournament (/kiosk/<token>, one link for all its courts): the link shows the courts, the phone picks the one it lies on (/kiosk/<token>?court=2 - the address keeps it, so
// the icon on the home screen of the phone opens that court), and lists the matches of THAT court; a player taps their match and scores it on the match page
// (public/js/match.js in kiosk mode, ?kiosk=<token>), which brings them back here when the match is over. The list follows the schedule: when the organiser moves, adds or removes a
// match on this court (the server tells it with the socket message "matches:changed") the list is fetched again, and every 20 seconds anyway in case the socket was lost.
// Picking the court also gives the browser the cookie that lets it score the matches of this court (GET /api/kiosk/<token>/court/<n>, src/routes/kiosk.js).
// Needs common.js (api, escapeHtml, categoryLabel) and the texts of i18n-match.js.
const ksToken = window.location.pathname.split('/').filter(Boolean).pop();
// the short address /turnaj<number> (the number of the tournament): the page asks for the code of the kiosk, then goes on to the long address
const ksShort = /^[/]turnaj([0-9]+)[/]?$/.exec(window.location.pathname);
const ksCourt = Number(new URLSearchParams(window.location.search).get('court')) || 0;
const ksRoot = document.getElementById('ks');
const ksTime = new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const KS_DONE_SHOWN = 4; // how many finished matches stay under the list
let ksData = null;
let ksOffline = false;
let ksTimer = null;

const ksClock = () => ksTime.format(new Date());

// a match of the court as a row: the time, the two players one under the other, and what the match is (category, group or round)
function ksRow(m, kind) {
  const won = (p) => (m.winnerId && m.winnerId === p.id ? ' class="win"' : '');
  const what = [m.category ? categoryLabel(m.category) : '', m.bracket ? m.bracket.name : (m.group ? m.group.name : '')].filter(Boolean).join(' · ');
  const body = `
    <span class="ks-time">${ksTime.format(new Date(m.blockStart || m.scheduledAt))}</span>
    <span class="ks-pl">
      ${kind === 'live' ? `<b class="ks-pill">${escapeHtml(t('kiosk.live'))}</b>` : ''}
      <span${won(m.player1)}>${escapeHtml(m.player1.name || '?')}</span>
      <span${won(m.player2)}>${escapeHtml(m.player2.name || '?')}</span>
      ${kind === 'done' && m.scoreSummary ? `<span class="ks-score">${escapeHtml(m.scoreSummary)}</span>` : ''}
      ${what ? `<em class="ks-meta">${escapeHtml(what)}</em>` : ''}
    </span>`;
  if (kind === 'done') return `<div class="ks-row done">${body}</div>`;
  return `<a class="ks-row ${kind}" href="/match/${encodeURIComponent(m.token)}?kiosk=${encodeURIComponent(ksToken)}&court=${ksCourt}">${body}</a>`;
}

function ksSection(title, rows) {
  return rows.length ? `<section class="ks-section"><h2 class="ks-section-h">${escapeHtml(title)}</h2>${rows.join('')}</section>` : '';
}

function ksRender() {
  if (!ksData) return;
  const matches = ksData.matches;
  const live = matches.filter((m) => m.status === 'LIVE' || m.status === 'UNFINISHED');
  const next = matches.filter((m) => m.status === 'PLANNED');
  const done = matches.filter((m) => m.status === 'FINISHED').slice(-KS_DONE_SHOWN);
  ksRoot.innerHTML = `
    <header class="ks-head">
      <div><h1 class="ks-court">${escapeHtml(ksData.courtName)}</h1><p class="ks-season">${escapeHtml(ksData.seasonName)}</p></div>
      <div class="ks-clock" id="ks-clock">${ksClock()}</div>
    </header>
    ${ksOffline ? `<div class="ks-offline">${escapeHtml(t('kiosk.offline'))}</div>` : ''}
    ${live.length || next.length ? `<p class="ks-hint">${escapeHtml(t('kiosk.hint'))}</p>` : ''}
    ${ksSection(t('kiosk.nowPlaying'), live.map((m) => ksRow(m, 'live')))}
    ${ksSection(t('kiosk.next'), next.map((m, i) => ksRow(m, i === 0 && !live.length ? 'next' : 'planned')))}
    ${live.length || next.length ? '' : `<div class="ks-message">${escapeHtml(t('kiosk.empty'))}</div>`}
    ${ksSection(t('kiosk.done'), done.map((m) => ksRow(m, 'done')))}
    <a class="ks-change" href="/kiosk/${encodeURIComponent(ksToken)}">${escapeHtml(t('kiosk.changeCourt'))}</a>`;
}

async function ksLoad() {
  try {
    ksData = await api(`/kiosk/${encodeURIComponent(ksToken)}/court/${ksCourt}`);
    ksOffline = false;
    document.title = `${ksData.courtName} - BLTA`;
  } catch (err) {
    if (!ksData) { ksRoot.innerHTML = `<div class="ks-message bad">${escapeHtml(t('kiosk.invalid'))}</div>`; return; }
    // a link that was replaced answers 404 and stays dead; a lost connection comes back by itself
    if (/not valid/i.test(err.message || '')) { ksData = null; ksRoot.innerHTML = `<div class="ks-message bad">${escapeHtml(t('kiosk.invalid'))}</div>`; return; }
    ksOffline = true;
  }
  ksRender();
}

// fetched again at most once a second however many messages come
function ksSoon() {
  clearTimeout(ksTimer);
  ksTimer = setTimeout(ksLoad, 800);
}

// no court in the address: the courts of the tournament to pick from (a phone is set up once, then it keeps its court in the address)
async function ksPick() {
  try {
    const r = await api(`/kiosk/${encodeURIComponent(ksToken)}`);
    ksRoot.innerHTML = `
      <header class="ks-head"><div><h1 class="ks-court">${escapeHtml(t('kiosk.pickCourt'))}</h1><p class="ks-season">${escapeHtml(r.seasonName)}</p></div></header>
      <p class="ks-hint">${escapeHtml(t('kiosk.pickHint'))}</p>
      <div class="ks-section">${r.courts.map((c) => `<a class="ks-row ${c.live ? 'live' : ''}" href="/kiosk/${encodeURIComponent(ksToken)}?court=${c.courtNo}"><span class="ks-time">${c.courtNo}</span><span class="ks-pl"><span>${escapeHtml(c.name)}</span>${c.live ? `<b class="ks-pill">${escapeHtml(t('kiosk.live'))} · ${c.live}</b>` : ''}</span></a>`).join('')}</div>`;
  } catch (err) {
    ksRoot.innerHTML = `<div class="ks-message bad">${escapeHtml(t('kiosk.invalid'))}</div>`;
  }
}

// the code of the short address: five digits in the same boxes as the login of a player (.otp-group / .otp-box of style.css), asked once on a phone
// (the QR code of the Backend holds the long address and needs no code)
function ksCodeForm() {
  const boxesHtml = Array.from({ length: 5 }, (_, i) => `<input type="text" inputmode="numeric" maxlength="1" class="otp-box" autocomplete="off" aria-label="${escapeHtml(t('a11y.digit', { n: i + 1, total: 5 }))}">`).join('');
  ksRoot.innerHTML = `
    <header class="ks-head"><div><h1 class="ks-court">${escapeHtml(t('kiosk.codeTitle'))}</h1></div></header>
    <form class="ks-code" id="ks-code-form">
      <p class="ks-hint">${escapeHtml(t('kiosk.codeHint'))}</p>
      <div class="otp-group" id="ks-code-otp">${boxesHtml}</div>
      <div class="ks-code-error" id="ks-code-error" role="alert"></div>
      <button type="submit" class="btn btn-primary btn-block">${escapeHtml(t('kiosk.codeBtn'))}</button>
    </form>`;
  const boxes = Array.from(document.querySelectorAll('#ks-code-otp .otp-box'));
  const value = () => boxes.map((b) => b.value).join('');
  const form = document.getElementById('ks-code-form');
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/[^0-9]/g, '').slice(-1);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      else if (box.value && value().length === 5) form.requestSubmit();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
    });
    // a whole code pasted (or filled in by the phone) goes into the boxes at once
    box.addEventListener('paste', (e) => {
      const text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/[^0-9]/g, '');
      if (!text) return;
      e.preventDefault();
      boxes.forEach((b, j) => { b.value = text[j] || ''; });
      if (value().length === 5) form.requestSubmit();
    });
  });
  boxes[0].focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = document.getElementById('ks-code-error');
    error.textContent = '';
    try {
      const r = await api(`/kiosk/turnaj/${ksShort[1]}/open`, { method: 'POST', body: { code: value() } });
      window.location.href = `/kiosk/${encodeURIComponent(r.token)}`;
    } catch (err) {
      error.textContent = t(err.status === 401 ? 'kiosk.codeWrong' : (err.status === 429 ? 'kiosk.codeLocked' : 'kiosk.invalid'));
      boxes.forEach((b) => { b.value = ''; });
      boxes[0].focus();
    }
  });
}

if (ksShort) {
  ksCodeForm();
} else if (ksCourt) {
  ksLoad();
  setInterval(ksLoad, 20000);
} else {
  ksPick();
}
setInterval(() => { const el = document.getElementById('ks-clock'); if (el) el.textContent = ksClock(); }, 15000);
document.addEventListener('visibilitychange', () => { if (ksCourt && !ksShort && !document.hidden) ksLoad(); });
if (window.io && ksCourt && !ksShort) {
  const socket = io();
  socket.on('matches:changed', ksSoon);
  socket.on('connect', ksSoon);
}
// a phone that lies on a court must not fall asleep (where the browser lets a page ask for it)
(async function keepAwake() {
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* not allowed: the phone sleeps as it is set to */ }
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); });
