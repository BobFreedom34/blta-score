// Part of common.js (loaded after common-forms.js): the propose-times modal, the HTML of the match cards, the contact window.



// ---------- "Propose times for opponent" modal (shared) ----------
// Turns an existing undated Planned match into one awaiting a scheduling
// response, same widgets as the "Schedule a match" page, just built once
// here and reset() on each open instead of reloading a whole page. Shared
// by app.js (homepage) and player.js (a player's own match list) — both
// pages carry identical #propose-times-modal/#share-modal markup (see
// index.html/player.html) so this one instance drives either.
let proposeTimesToken = null;
let proposeTimesOnSuccess = null;
let proposeAvailabilityPicker = null;
let proposeVenuePicker = null;
let proposeProposerPicker = null;
// Only index.html and player.html carry the #propose-times-modal markup —
// every other page (rankings.html, match.html, players.html) loads this
// same common.js, so this whole block must stay guarded. It used to run
// unconditionally and throw on those pages, which — because a thrown error
// aborts the rest of this script's top-level execution — also silently
// skipped everything declared further down in this file (NATIONALITY_CODES
// among others), breaking unrelated features like rankings' nationality
// flags on every page except these two.
if (document.getElementById('propose-times-modal')) {
  proposeAvailabilityPicker = createAvailabilityPicker({ weekTabsId: 'modal-week-tabs', gridWrapId: 'modal-availability-grid-wrap', slotCountId: 'modal-slot-count' });
  proposeVenuePicker = createVenueChipPicker({ listId: 'modal-venue-chip-list', inputId: 'modal-venue-input', addBtnId: 'modal-venue-add-btn' });
  proposeProposerPicker = createStaticPlayerChoicePicker('modal-proposer-choice-row');
  document.getElementById('modal-clear-slots-btn').addEventListener('click', () => proposeAvailabilityPicker.clear());
}

// onSuccess (optional) is called once the proposal is sent — app.js passes
// its own loadMatches(), player.js passes load(), so whichever page's list
// is showing this match refreshes to reflect the new "awaiting response"
// state.
function openProposeTimesModal(token, p1Name, p2Name, p1Id, p2Id, onSuccess) {
  proposeTimesToken = token;
  proposeTimesOnSuccess = onSuccess || null;
  proposeAvailabilityPicker.reset();
  proposeVenuePicker.clear();
  proposeProposerPicker.setNames(p1Name, p2Name);
  // If the logged-in player opening this modal is one of the two match
  // players, we already know who's proposing — lock the answer to them
  // instead of asking (see canManageMatch's ownership check, which is what
  // let them get here in the first place).
  const forcedProposer = (playerAuthed && currentPlayerId)
    ? (currentPlayerId === Number(p1Id) ? 1 : currentPlayerId === Number(p2Id) ? 2 : null)
    : null;
  proposeProposerPicker.reset(forcedProposer, { lock: forcedProposer != null });
  document.getElementById('modal-proposer-optional-hint').style.display = forcedProposer != null ? 'none' : '';
  // Prefilled from the proposer's own profile when they have an email on
  // file — same "we already know who's proposing" condition as the picker
  // above, so this never guesses whose email to fill in.
  document.getElementById('modal-notify-email').value = forcedProposer != null ? (currentPlayerEmail || '') : '';
  document.getElementById('propose-times-error').textContent = '';
  document.getElementById('propose-times-modal').style.display = 'flex';
}

if (document.getElementById('propose-times-form')) {
  document.getElementById('propose-times-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('propose-times-error');
    errorEl.textContent = '';
    if (proposeAvailabilityPicker.selectedSlots.size === 0) {
      errorEl.textContent = t('proposeTimes.markAtLeastOne');
      return;
    }
    if (proposeVenuePicker.venues.length === 0) {
      errorEl.textContent = t('proposeTimes.addAtLeastOneVenue');
      return;
    }
    const notifyEmail = document.getElementById('modal-notify-email').value.trim();
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
      errorEl.textContent = t('proposeTimes.invalidEmail');
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      // POST .../counter-propose rather than PATCH here deliberately — the
      // server writes this as the match's first proposal if it doesn't have
      // one yet, or as an independent second calendar alongside an existing
      // one otherwise (see routes/matches.js), so this same button keeps
      // working correctly for a match the opponent already proposed times
      // for instead of silently overwriting their offer.
      const updated = await api(`/matches/${proposeTimesToken}/counter-propose`, {
        method: 'POST',
        body: {
          proposalSlots: Array.from(proposeAvailabilityPicker.selectedSlots),
          proposalVenues: proposeVenuePicker.venues,
          proposedBy: proposeProposerPicker.getPicked(),
          proposalNotifyEmail: notifyEmail || undefined,
        },
      });
      document.getElementById('propose-times-modal').style.display = 'none';
      // The share-with-opponent popup (link + Copy link) is the actual
      // confirmation here — no separate toast needed on top of it.
      openShareModal(
        updated,
        t('proposeTimes.whatsappText', { p1: updated.player1.name, p2: updated.player2.name }),
        t('proposeTimes.shareDesc')
      );
      if (proposeTimesOnSuccess) proposeTimesOnSuccess();
    } catch (err) {
      errorEl.textContent = err.message;
    }
    submitBtn.disabled = false;
  });
}

// "6-4, 3-2" / "Retirement" / "6-4, 3-2 — Retirement" / "Best of 3 sets" (planned)
function matchResultText(m) {
  if (m.status === 'PLANNED') return m.formatLabel;
  const parts = [];
  if (m.scoreSummary) parts.push(m.scoreSummary);
  if (m.endReason && endReasonLabel(m.endReason)) parts.push(endReasonLabel(m.endReason));
  return parts.join(' — ') || '—';
}

// Same text as matchResultText, but for a Planned match whose format label
// has a parenthetical qualifier (e.g. "Best of 3 sets (Super Tie-break)"),
// breaks it onto its own line so it doesn't crowd the format's main name.
function matchScoreHtml(m) {
  const text = matchResultText(m);
  if (m.status === 'PLANNED') {
    const idx = text.indexOf(' (');
    if (idx !== -1) return `${escapeHtml(text.slice(0, idx))}<br>${escapeHtml(text.slice(idx + 1))}`;
  }
  return escapeHtml(text);
}

// Mirrors match.js's own render of a single set's score for one player,
// including the small tiebreak-loser superscript — shared here so a match
// card's compact scoreboard (below) and the full match-page scoreboard
// stay visually identical.
// highlightWinner colors the winning player's number green for a decided
// set (set.winner from matchEngine.js) — off by default so the full
// match-page scoreboard and the regular (non-compact) match-card
// scoreboard keep their existing plain-white look; only the compact
// match-list grid (see cardScoreboardHtml's compact mode) turns it on.
// highlightHigher colors the higher number of every set green (the match cards): the winner of a decided set, or the one ahead in a set
// that is still going — nothing in a tied set.
function setCell(set, playerNum, { highlightWinner = false, highlightHigher = false } = {}) {
  const gKey = playerNum === 1 ? 'p1' : 'p2';
  const otherKey = playerNum === 1 ? 'p2' : 'p1';
  const own = set.isSuperTiebreak ? set.tiebreak[gKey] : set[gKey];
  const other = set.isSuperTiebreak ? set.tiebreak[otherKey] : set[otherKey];
  const won = (highlightWinner && set.winner === playerNum) || (highlightHigher && own > other);
  if (set.isSuperTiebreak) {
    const val = set.tiebreak[gKey];
    return won ? `<span class="set-win">${val}</span>` : `${val}`;
  }
  const main = set[gKey];
  const sub = set.tiebreak ? `<sup class="sub-tb">${set.tiebreak[gKey]}</sup>` : '';
  return `${won ? `<span class="set-win">${main}</span>` : main}${sub}`;
}

// Static (non-ticking — updates whenever the card list itself re-renders,
// e.g. on any matches:changed broadcast) duration for a card's scoreboard
// header: elapsed time so far for a LIVE match, or total playtime once
// FINISHED. Mirrors match.js's own timer math minus the per-second tick.
function cardDurationHtml(m) {
  if (m.status === 'LIVE' && m.startTime) {
    const start = new Date(m.startTime).getTime();
    const pausedSeconds = m.pausedSeconds || 0;
    const nowMs = m.pausedAt ? new Date(m.pausedAt).getTime() : Date.now();
    const secs = Math.max(0, Math.floor((nowMs - start) / 1000) - pausedSeconds);
    const h = Math.floor(secs / 3600);
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const text = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    return `<div class="timer${m.pausedAt ? ' timer-paused' : ''}">${text}</div>${m.pausedAt ? `<div class="paused-label">${courtIcon('pauseCircle')}PAUSED</div>` : ''}`;
  }
  if (m.status === 'FINISHED' && m.startTime && m.endTime) {
    const mins = Math.max(1, Math.round((new Date(m.endTime) - new Date(m.startTime)) / 60000));
    return `<div class="timer">${mins} min</div>`;
  }
  return '';
}

// Name -> current overall BLTA rank (the "blta" rankings table only, not
// the per-category Race tables), so a match card can show "#N" next to a
// ranked player. Fetched once per page load; a page that renders cards
// should `await RANKS_READY` before its first render so the badges are
// there from the start rather than popping in on a later re-render. Best
// -effort — a scraper hiccup just means no badges, not a broken page.
const RANK_BY_NAME = new Map();
const RANKS_READY = (async () => {
  try {
    const { ranks } = await api('/rankings/ranks');
    Object.entries(ranks).forEach(([name, rank]) => RANK_BY_NAME.set(name, rank));
  } catch { /* no badges this load — not worth failing the page over */ }
})();

function rankBadgeHtml(name) {
  const rank = RANK_BY_NAME.get(name);
  return rank ? `<span class="player-rank">#${rank}</span> ` : '';
}

// A player's name inside a match card — clickable to their profile page;
// rank:false drops the "#N" badge (finished matches don't show it),
// a span with a click handler rather than a real <a>, because it sits
// inside the card's own <a>.
function playerNameLink(player, { rank = true } = {}) {
  const playerPath = player.slug || player.id;
  const nav = window.top === window.self
    ? `window.location.href='${siteUrl('/player/' + playerPath)}'`
    : `window.open('${siteUrl('/player/' + playerPath)}','_blank')`;
  return `<span class="player-name-link" onclick="event.preventDefault();event.stopPropagation();${nav}">${rank ? rankBadgeHtml(player.name) : ''}${escapeHtml(player.name)}</span>`;
}

// A small tennis-ball marker next to whichever player is bringing the
// balls (set at creation time, see new-match.js) — only while the match
// is still PLANNED, since once it's live/finished that's no longer
// useful information to surface on the card. Drawn as inline SVG rather
// than the 🎾 emoji — an emoji glyph's actual artwork is up to the
// viewer's own OS/font, and 🎾 renders as a racket-and-ball combo on
// several common platforms instead of a plain ball. Drawing it ourselves
// (a lime circle with two curved seam lines, the classic tennis-ball
// icon shape) guarantees the same ball-only look everywhere.
function ballsIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || m.ballsPlayer !== playerNum) return '';
  // The title has to be a <title> *child element*, not a title attribute on
  // <svg> itself — unlike a plain HTML element, a bare attribute there
  // isn't picked up as a hover tooltip by browsers.
  return `<svg class="balls-icon" viewBox="0 0 24 24"><title>${escapeHtml(t('common.bringsBallsTitle'))}</title>
    <circle cx="12" cy="12" r="11" fill="#d4ee4e" stroke="#a8c93a" stroke-width="1"/>
    <path d="M3 6c3.2 2.6 3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M21 6c-3.2 2.6-3.2 8.8 0 12" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// Same idea as ballsIconHtml, for whichever player is reserving the court —
// a plain 📞 emoji rather than a drawn icon (unlike the ball, there's no
// cross-platform rendering risk worth avoiding for a phone glyph). A plain
// HTML element's title attribute *does* work as a native tooltip, unlike
// the SVG case above, so no <title> child needed here.
function courtIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || m.courtPlayer !== playerNum) return '';
  return `<span class="court-icon" title="${escapeHtml(t('common.reservesCourtTitle'))}">${courtIcon('phone')}</span>`;
}

// Same idea again, for whichever player made a "propose times" offer
// that's still awaiting the other player's response — checks both the
// primary proposal and any independent counter-proposal (see
// proposeTimesModal/counter-propose in match.js), since either one can
// name its own proposer. Both proposal_slots/counter_proposal_slots are
// always cleared the moment a slot gets confirmed (see respond-proposal
// server-side), so there's no separate "still awaiting" check needed here
// beyond proposedBy/counterProposedBy actually being this player.
function proposalIconHtml(m, playerNum) {
  if (m.status !== 'PLANNED' || (m.proposedBy !== playerNum && m.counterProposedBy !== playerNum)) return '';
  return `<span class="proposal-icon" title="${escapeHtml(t('common.proposalTitle'))}">${courtIcon('clock')}</span>`;
}

// Compact per-set scoreboard for a match card (LIVE/FINISHED) — same dark
// table as the full match page, just condensed, with the same timer chip in
// its header cell. For a LIVE match this always shows (even at a fresh
// 0-0, matching the match page itself) since the clock is already running;
// for FINISHED it only shows once there's real per-set score data, so a
// walkover/retirement result still falls back to the plain text line.
// compact:true drops the name column (and the LIVE timer header cell) —
// used by compactMatchCardHtml, whose match list already shows player
// names in their own separate column right next to this one, so repeating
// them inside the table too would be redundant.
function cardScoreboardHtml(m, { compact = false } = {}) {
  if (!m.state || !m.state.sets) return '';
  const sets = m.status === 'LIVE'
    ? m.state.sets
    : m.state.sets.filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)));
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  // A finished match with no games played at all (walkover/retirement before
  // a point was scored) — keep the same dark scoreboard box as every other
  // finished card instead of falling back to the plain light layout, just
  // without a score table.
  if (!sets.length) {
    if (m.status !== 'FINISHED') return '';
    const reasonLabel = m.endReason ? endReasonLabel(m.endReason) : null;
    return `
      <div class="scoreboard scoreboard-compact">
        ${compact ? '' : `
          <table>
            <tbody>
              <tr class="${winnerP1 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player1, { rank: m.status !== 'FINISHED' })}</td></tr>
              <tr class="${winnerP2 ? 'winner-row' : ''}"><td class="name-cell">${playerNameLink(m.player2, { rank: m.status !== 'FINISHED' })}</td></tr>
            </tbody>
          </table>
        `}
        ${reasonLabel ? `<div class="scoreboard-reason">${escapeHtml(reasonLabel)}</div>` : ''}
      </div>
    `;
  }
  const headerCells = sets.map((s, i) => `<th>${s.isSuperTiebreak ? 'MTB' : `S${i + 1}`}</th>`).join('');
  const row = (playerNum, player, isWinner) => {
    const cells = sets.map((s) => `<td class="set-score">${setCell(s, playerNum, { highlightWinner: compact, highlightHigher: true })}</td>`).join('');
    const nameCell = compact ? '' : `<td class="name-cell">${playerNameLink(player, { rank: m.status !== 'FINISHED' })}</td>`;
    return `<tr class="${isWinner ? 'winner-row' : ''}">${nameCell}${cells}</tr>`;
  };
  return `
    <div class="scoreboard scoreboard-compact">
      <table>
        ${compact ? '' : `<thead><tr><th class="timer-cell">${cardDurationHtml(m)}</th>${headerCells}</tr></thead>`}
        <tbody>
          ${row(1, m.player1, winnerP1)}
          ${row(2, m.player2, winnerP2)}
        </tbody>
      </table>
    </div>
  `;
}

// A match was scheduled for a day (or more) in the past but never got
// started or finished — flags it as needing attention on its card.
function isOverdueUnresolved(m) {
  if (m.status !== 'PLANNED' || !m.scheduledAt) return false;
  return Date.now() - new Date(m.scheduledAt).getTime() > 24 * 60 * 60 * 1000;
}

// Renders the admin-managed header items (see /header-admin, GET
// /api/header-items) into the #header-dynamic-items placeholder every
// page's nav keeps — a plain item (no children) renders just like the
// static <a> tags it replaced; an item with sub-items gets wrapped in
// .nav-item-dropdown so it can carry both its own link and a
// hover/tap dropdown of children (see .nav-submenu in style.css).
// currentLang (from i18n.js, loaded before this script) picks labelEn vs.
// labelSk — falls back to labelSk when an item has no English label yet,
// same "don't just disappear" fallback t() itself uses for a missing key.
// A page with no placeholder (the reset-code page, embeds) is a no-op.
//
// Built via real DOM nodes rather than one innerHTML string because the
// item flagged isMyProfile isn't rendered fresh at all — it's the site's
// existing static #nav-my-profile-link element (still present in every
// page's markup) physically MOVED into position here. That element already
// carries its own id/class, a click listener bound to it once at script
// load (see the .nav-my-profile-link listener below), and gets its href
// kept current by updatePlayerNavLinks() — recreating it from scratch here
// would leave a lookalike node with none of that wiring. appendChild on a
// node already in the document simply relocates it, so all of that survives
// untouched; only its position among the other items changes.
// The pages have an address per language (/rebricek, /en/rankings — see localize.js and Backend > SEO), but the code names a page
// by its "code address" (/rankings, /player/<slug>): the one the menu items are stored with and the links are written with.
// siteUrl() turns a code address into the address in the language in use (links in the page are rewritten by localize.js itself);
// currentCodePath() is the code address of the page that is open.
function siteUrl(address) {
  return window.BLTA_LOCALIZE && BLTA_LOCALIZE.localUrl ? BLTA_LOCALIZE.localUrl(address) : address;
}
function currentCodePath() {
  return (window.BLTA_LOCALIZE && BLTA_LOCALIZE.page && BLTA_LOCALIZE.page.canonical) || window.location.pathname;
}

// A menu item whose link is empty, '#' or anything that is not a page of the site or a web address is only a heading: it opens its
// sub-items instead of going anywhere.
function isHeadingLink(link) {
  if (isContactLink(link)) return false;
  return !link || !/^(\/|https?:\/\/|mailto:|tel:)/i.test(String(link).trim());
}

// #kontakt is no page: it opens the contact window (the "Kontakt" menu item; any link to #kontakt on a page does the same)
function isContactLink(link) {
  return String(link || '').trim().toLowerCase() === '#kontakt';
}

// ---------- the contact window (menu item "Kontakt") ----------
// Who runs the league and how to reach them: GET /api/contact (edited in Backend > Menu). Built on first use and shown over
// whatever page is open; closes with the cross, a click beside it or Escape.
const CONTACT_ICONS = {
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
};

// the logo of the contact window: BLTA on blta.sk (the first city), the SLTA logo on slta.sk and on every other city (slta.sk/kosice, a city's own domain)
function contactLogoHtml() {
  const slta = window.CITY ? !window.CITY.first : /(^|.)slta.sk$/.test(window.location.hostname);
  return slta ? '<img class="ct-logo" src="/img/slta-logo.png" alt="SLTA" width="500" height="141">' : '<img class="ct-logo" src="/img/blta-logo.png" alt="BLTA">';
}

function contactWindowHtml(c) {
  const link = (url) => (/^https?:\/\//i.test(url || '') ? url : '');
  const lines = [];
  String(c.address || '').split('\n').map((x) => x.trim()).filter(Boolean).forEach((x) => lines.push(`<p>${escapeHtml(x)}</p>`));
  if (c.ico) lines.push(`<p><span class="ct-k">${escapeHtml(t('contact.ico'))}</span>${escapeHtml(c.ico)}</p>`);
  if (c.iban) lines.push(`<p><span class="ct-k">IBAN</span>${escapeHtml(c.iban)}</p>`);
  const phone = c.phone ? `<div class="ct-block"><div class="ct-label">${escapeHtml(t('contact.mobile'))}</div><a class="ct-value" href="tel:${escapeHtml(String(c.phone).replace(/[^\d+]/g, ''))}">${escapeHtml(c.phone)}</a></div>` : '';
  const email = c.email ? `<div class="ct-block"><div class="ct-label">${escapeHtml(t('contact.email'))}</div><a class="ct-value" href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : '';
  const social = [['facebook', 'Facebook', c.facebookUrl], ['instagram', 'Instagram', c.instagramUrl], ['youtube', 'YouTube', c.youtubeUrl], ['whatsapp', 'WhatsApp', c.whatsappUrl]]
    .filter(([, , url]) => link(url))
    .map(([key, name, url]) => `<a href="${escapeHtml(link(url))}" target="_blank" rel="noopener" aria-label="${name}" title="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${CONTACT_ICONS[key]}</svg></a>`).join('');
  return `
    <div class="ct-left">
      ${contactLogoHtml()}
      ${c.orgName ? `<h2 class="ct-title" id="ct-title">${escapeHtml(c.orgName)}</h2>` : ''}
      <div class="ct-lines">${lines.join('')}</div>
    </div>
    <div class="ct-right">
      ${phone}${email}
      ${social ? `<div class="ct-social">${social}</div>` : ''}
    </div>`;
}

async function openContactModal() {
  let el = document.getElementById('contact-modal');
  if (el) return;
  el = document.createElement('div');
  el.id = 'contact-modal';
  el.className = 'ct-backdrop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'ct-title');
  el.innerHTML = `<div class="ct-card"><button type="button" class="ct-close" aria-label="${escapeHtml(t('contact.close'))}">&times;</button><div class="ct-body"></div></div>`;
  const previousOverflow = document.body.style.overflow;
  const close = () => {
    el.remove();
    document.body.style.overflow = previousOverflow;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.ct-close')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(el);
  el.querySelector('.ct-close').focus();
  const body = el.querySelector('.ct-body');
  try {
    body.innerHTML = contactWindowHtml(await api('/contact'));
  } catch {
    body.innerHTML = `<p style="text-align:center;margin:0">${escapeHtml(t('contact.loadError'))}</p>`;
  }
}
