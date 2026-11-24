// Shared helpers of every page: the API call and the session, labels and badges of matches, escapeHtml, flags, dates, toast, sharing, checkAdmin.
// common.js is loaded first; common-forms, common-cards, common-nav, common-player and common-site follow it (one global scope, same order on every page).



// The session ("who is logged in, and is it an admin") is asked for once and shared: common.js, checkAdmin() and the
// pages' own start-up all want it within the same moment. Reused for a few seconds only, and dropped by any write (a
// login, a logout, a referee code), so a later call always sees the current state.
let sessionRequest = null;
let sessionRequestAt = 0;
function loadSession() {
  if (!sessionRequest || Date.now() - sessionRequestAt > 10000) {
    sessionRequestAt = Date.now();
    const request = api('/player/session');
    sessionRequest = request;
    request.catch(() => { if (sessionRequest === request) sessionRequest = null; });
  }
  return sessionRequest;
}

async function api(path, options = {}) {
  if (options.method && options.method !== 'GET') sessionRequest = null;
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    // The parsed body, if any — lets a caller branch on a custom field the
    // server sent alongside the error (e.g. pinRequired in the player
    // login flow) rather than only ever having the message text.
    err.data = data;
    // the HTTP status, so a page can show a text of its own in the language of the page instead of the server's English message
    err.status = res.status;
    throw err;
  }
  return data;
}

// Plain-text version of the same lookup categoryBadge uses below — for
// spots that need just the label (an info-item value, a <select> option),
// not the badge markup.
function categoryLabel(category) {
  const key = `category.${category}`;
  const hasTranslation = TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key];
  return hasTranslation ? t(key) : (CATEGORY_LABELS[category] || category);
}

// The three BLTA league levels show three dots before the name: ELITE all filled, NEXT GEN two, NOVICE one.
// The other categories (friendly, VIP cup, ATA tennis, other) are not levels and get no dots.
const CATEGORY_LEVEL_DOTS = { ELITE: 3, NEXT_GEN: 2, NOVICE: 1 };
function levelDotsHtml(category) {
  const filled = CATEGORY_LEVEL_DOTS[category];
  if (!filled) return '';
  return `<span class="level-dots" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= filled ? 'on' : ''}"></i>`).join('')}</span>`;
}

function categoryBadge(category) {
  // Badges drop the "BLTA " prefix — the level dots / colour already say it's a league division.
  return `<span class="badge badge-${category}">${levelDotsHtml(category)}${categoryLabel(category).replace(/^BLTA /, '')}</span>`;
}

// One-line card shared by the /compact page and the /embed/compact widget:
// date, category, opponents, result, place, nothing else — built for
// embedding a lot of matches into a tight WordPress widget instead of the
// full card's scoreboard/notify buttons.

// Calendar date only — no weekday name, no clock time (unlike fmtDateShort).
function compactDateOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function compactDateHtml(m) {
  if (m.status === 'LIVE') return `<span class="compact-live">${courtIcon('live')}LIVE</span>`;
  return escapeHtml(compactDateOnly(m.scheduledAt) || 'Date TBD');
}

function compactMatchCardHtml(m) {
  const winnerP1 = m.status === 'FINISHED' && m.winnerId === m.player1.id;
  const winnerP2 = m.status === 'FINISHED' && m.winnerId === m.player2.id;
  // Same dark S1/S2/MTB score grid as the regular match cards' scoreboard
  // (cardScoreboardHtml), just without its own name column — falls back to
  // the plain result pill (format label for a Planned match, or a
  // walkover/retirement's reason text) when there's no real score grid to
  // show, same cases cardScoreboardHtml itself returns '' for.
  const scoreboard = cardScoreboardHtml(m, { compact: true });
  return `
    <a class="compact-card status-${m.status}${m.status === 'PLANNED' && m.scheduledAt ? ' has-date' : ''}" href="${window.location.origin}/match/${m.token}"${window.top !== window.self ? ' target="_blank" rel="noopener"' : ''}>
      <span class="compact-date-category">
        ${categoryBadge(m.category)}${videoBadge(m)}${photoBadge(m)}
        <span class="compact-date">${compactDateHtml(m)}</span>
      </span>
      <span class="compact-players">
        <span class="${winnerP1 ? 'winner' : ''}">${escapeHtml(m.player1.name)}${ballsIconHtml(m, 1)}${courtIconHtml(m, 1)}${proposalIconHtml(m, 1)}</span>
        <span class="${winnerP2 ? 'winner' : ''}">${escapeHtml(m.player2.name)}${ballsIconHtml(m, 2)}${courtIconHtml(m, 2)}${proposalIconHtml(m, 2)}</span>
      </span>
      ${scoreboard || `<span class="compact-result">${matchScoreHtml(m)}</span>`}
      <span class="compact-place">${m.location ? `${courtIcon('pin')}${escapeHtml(m.location)}` : ''}</span>
    </a>
  `;
}

// Accepts either a match object (preferred, so a scheduled Planned match can
// show its date/time instead of just "Planned") or a plain status string.
// opts.splitTime (match cards only): the pill holds just the date, the time follows as plain text.
function statusBadge(m, opts) {
  const status = typeof m === 'string' ? m : m.status;
  const scheduledAt = typeof m === 'string' ? null : m.scheduledAt;
  if (status === 'PLANNED' && scheduledAt) {
    if (opts && opts.splitTime) {
      const d = new Date(scheduledAt);
      if (!Number.isNaN(d.getTime())) {
        return `<span class="badge badge-status status-PLANNED-dated">${weekdayShort(d)} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}</span><span class="status-time">${hhmm(d)}</span>`;
      }
    }
    return `<span class="badge badge-status status-PLANNED-dated">${fmtDateShort(scheduledAt)}</span>`;
  }
  const key = `status.${status}`;
  const hasTranslation = TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key];
  const label = hasTranslation ? t(key) : (STATUS_LABELS[status] || status);
  return `<span class="badge badge-status status-${status}">${label}</span>`;
}

// The "Live video" pill of a match that has a YouTube video (set by the admin on the match page): shown next to the status on every match card.
// The line under the pills of a match card: the round and the group of a league match ("2. kolo - Wilson", "Play-off - Wilson"), built from the
// match's own round / stage / group — not the free-text notes (those stay on the match page). Empty for a match without any of them.
// "Elite — Skupina A" -> "Skupina A" (a group of a tournament carries its category; where the category is shown already it is left out)
function groupShortName(name) {
  return String(name || '').replace(/^(Elite|Next Gen|Novice) — /, '');
}

// The phase of a bracket match: "Finále", "Semifinále", "Štvrťfinále", "1. kolo", with "Útecha · " in front for the consolation draw.
function bracketPhaseLabel(b) {
  if (!b || !b.round) return '';
  let name = t('season.roundN', { n: b.prelim ? b.round - 1 : b.round });
  if (b.prelim && b.round === 1) name = t('bracket.prelim');
  else if (b.rounds && b.round === b.rounds) name = t('courts.final');
  else if (b.rounds && b.round === b.rounds - 1) name = t('courts.semi');
  else if (b.rounds && b.round === b.rounds - 2) name = t('courts.quarter');
  return b.kind === 'CONSOLATION' ? `${t('courts.consolation')} · ${name}` : name;
}

// the badge of a match played in a tournament of a club or a community: "Klub" / "Komunita" (the card's line under it has the name)
// followed by a grey crossed eye: such a match is not public, it is on the profile of the player who is logged in and nowhere else
function clubBadge(m) {
  const org = m && m.season && m.season.organisation;
  if (!org) return '';
  const note = escapeHtml(t('match.notPublic'));
  const eyeOff = `<span class="club-private" role="img" aria-label="${note}" title="${note}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/></svg></span>`;
  return `<span class="badge badge-club" title="${escapeHtml(org.name)}">${escapeHtml(t(org.type === 'CLUB' ? 'com.typeClub' : 'com.typeCommunity'))}</span>${eyeOff}`;
}

// the line under a match card; a match of a community or club starts with its name ("COURTCREW · Turnaj 1 · Elite · Semifinále")
// short = on the page of the tournament itself, where its name (and the club's) is already above: only what the schedule list shows ("INÉ · Bez kategórie — Skupina A · 3. kolo")
function matchRoundLabel(m, short) {
  const label = matchRoundLabelOf(m, short);
  const club = !short && m.season && m.season.organisation ? m.season.organisation.name : '';
  return club ? [club, label].filter(Boolean).join(' · ') : label;
}
function matchRoundLabelOf(m, short) {
  // a tournament match: the name of the tournament, the category and the phase ("Demo Open · Elite · Semifinále")
  if (m.season && m.season.kind === 'TOURNAMENT') {
    const category = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' }[m.category] || categoryLabel(m.category);
    const phase = bracketPhaseLabel(m.bracket) || (m.group ? [groupShortName(m.group.name), m.round ? t('season.roundN', { n: m.round }) : ''].filter(Boolean).join(' · ') : '');
    return [short ? '' : m.season.name, category, phase].filter(Boolean).join(' · ');
  }
  const parts = !short && m.season && m.season.organisation ? [m.season.name] : []; // (a season of a club: its name, then the round and the group)
  if (m.stage === 'PLAYOFF') parts.push(t('season.playoff'));
  else if (m.round) parts.push(t('season.roundN', { n: m.round }));
  if (m.group && m.group.name) parts.push(m.group.name);
  return parts.join(' - ');
}
function matchRoundHtml(m, short) {
  const label = matchRoundLabel(m, short);
  return label ? `<div class="match-card-notes">${escapeHtml(label)}</div>` : '';
}

// "Book a court" on a planned match card that has no date yet: opens the court booking page. A card is one big <a>, so these are buttons that
// stop the click from opening the match and go to the booking page themselves (same trick as playerNameLink). Two shapes of the same
// thing, one of them shown by CSS depending on the width: the green outlined button with its words in the row of buttons under the
// players (wide screens), and a small green ball pill in the card's info line (phones, where a third button would not fit the row).
// Both are empty for every other card.
function reserveCourtOnclick() {
  const target = siteUrl('/reservations');
  const nav = window.top === window.self ? `window.location.href='${target}'` : `window.open('${target}','_blank')`;
  return `event.preventDefault();event.stopPropagation();${nav}`;
}
function reserveCourtBtnHtml() {
  return `<button type="button" class="btn btn-sm btn-reserve-court" onclick="${reserveCourtOnclick()}">${courtIcon('ball')}${t('matches.reserveCourt')}</button>`;
}
function reserveCourtPillHtml(m) {
  if (!m || m.status !== 'PLANNED' || m.scheduledAt) return '';
  const label = escapeHtml(t('matches.reserveCourt'));
  return `<button type="button" class="reserve-court-pill" title="${label}" aria-label="${label}" onclick="${reserveCourtOnclick()}">${courtIcon('ball')}</button>`;
}

// The "Photo" pill: the match has at least one photo (see public/js/match-photos.js for the photos themselves).
// iconOnly: just the camera (for the small rows on the home page), with the word as its tooltip.
function photoBadge(m, { iconOnly = false } = {}) {
  if (!m || !(m.photoCount > 0)) return '';
  return `<span class="badge badge-photo"${iconOnly ? ` title="${escapeHtml(t('match.photoBadge'))}"` : ''}>${courtIcon('camera')}${iconOnly ? '' : t('match.photoBadge')}</span>`;
}

function videoBadge(m, { iconOnly = false } = {}) {
  if (!m || !m.videoId) return '';
  return `<span class="badge badge-video"${iconOnly ? ` title="${escapeHtml(t('match.liveVideo'))}"` : ''}>${courtIcon('video')}${iconOnly ? '' : t('match.liveVideo')}</span>`;
}

// A conversion for the ad pixels (Meta Pixel in Google Tag Manager, Backend > Tracking): pushed to the dataLayer ONLY after the server has said yes
// (never on page load). 'blta_complete_registration' = a new player account, 'blta_lead' = a registration to an event. GTM tags listen to these names.
function trackConversion(event, data) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event, event_id: `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, data || {}));
  } catch (e) { /* tracking never breaks the page */ }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Nationality is free text (admin-typed), not a country code, so flags are
// matched by name — covers every value currently in use plus a handful of
// common variants/languages. Falls back to no flag for anything unmapped
// rather than guessing. Rendered as an actual flag image (flagcdn.com SVGs)
// rather than a Unicode flag emoji — Windows browsers commonly fall back to
// showing the raw two-letter region code ("SK") instead of a flag glyph, so
// emoji aren't reliable here.
const NATIONALITY_CODES = {
  'slovenska republika': 'sk',
  slovensko: 'sk',
  slovakia: 'sk',
  ukrajina: 'ua',
  ukraine: 'ua',
  nemecko: 'de',
  germany: 'de',
  francuzsko: 'fr',
  france: 'fr',
  'korejska republika': 'kr',
  'south korea': 'kr',
  korea: 'kr',
  czechia: 'cz',
  'ceska republika': 'cz',
  'czech republic': 'cz',
  cesko: 'cz',
  vietnam: 'vn',
  bulharsko: 'bg',
  bulgaria: 'bg',
  polsko: 'pl',
  poland: 'pl',
  madarsko: 'hu',
  hungary: 'hu',
  rakusko: 'at',
  austria: 'at',
  rusko: 'ru',
  russia: 'ru',
  srbsko: 'rs',
  serbia: 'rs',
  chorvatsko: 'hr',
  croatia: 'hr',
  taliansko: 'it',
  italy: 'it',
  spanielsko: 'es',
  spain: 'es',
  'velka britania': 'gb',
  'united kingdom': 'gb',
  anglicko: 'gb',
  usa: 'us',
  'united states': 'us',
};

function flagCodeFor(nationality) {
  if (!nationality) return '';
  const key = nationality.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return NATIONALITY_CODES[key] || '';
}

function flagImgHtml(nationality, cssClass) {
  const code = flagCodeFor(nationality);
  if (!code) return '';
  return `<img class="${cssClass}" src="https://flagcdn.com/${code}.svg" alt="${code.toUpperCase()}" loading="lazy">`;
}

// Shared building blocks for every date/time label in the app — driven by
// the site's own SK/EN toggle (t()), never the visitor's browser/OS locale
// (toLocaleDateString(undefined, ...) and friends silently follow THAT
// instead, which is how a calendar grid ended up showing English weekday
// names to a visitor who has this site itself set to Slovak). Numeric
// punctuation (d.m., 24h HH:MM) stays the same regardless of language,
// same "reads the same for everyone" spirit fmtDateShort below already
// had — only the weekday/month text actually switches with the toggle.
function weekdayShort(d) {
  return t('common.weekdaysShort').split(',')[d.getDay()];
}
function monthShort(d) {
  return t('common.monthsShort').split(',')[d.getMonth()];
}
function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Fixed Ddd d.m.yyyy, HH:MM format (not locale-dependent) so it reads the
// same for every visitor regardless of their browser's locale settings.
function fmtDateShort(iso) {
  if (!iso) return t('common.dateTbd');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${weekdayShort(d)} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${hhmm(d)}`;
}

function fmtDateLong(iso) {
  if (!iso) return t('common.dateTbd');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${weekdayShort(d)} ${String(d.getDate()).padStart(2, '0')}. ${monthShort(d)} ${d.getFullYear()}, ${hhmm(d)}`;
}

function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function describeSet(set) {
  if (set.isSuperTiebreak) return `${set.tiebreak.p1}-${set.tiebreak.p2}`;
  if (set.tiebreak && set.winner) {
    const loserPoints = set.winner === 1 ? set.tiebreak.p2 : set.tiebreak.p1;
    return `${set.p1}-${set.p2}(${loserPoints})`;
  }
  return `${set.p1}-${set.p2}`;
}

function describeMatch(state) {
  return state.sets
    .filter((s) => s.winner || s.p1 > 0 || s.p2 > 0 || (s.tiebreak && (s.tiebreak.p1 > 0 || s.tiebreak.p2 > 0)))
    .map(describeSet)
    .join(', ');
}

function whatsappShareUrl(text, url) {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

// Shared "share this match" popup — the match's link plus WhatsApp/Copy
// link actions. Used by match.js's plain "🔗 Share" button (default
// WhatsApp text, no description) and, with their own text/description, by
// the propose-times/counter-propose success flows on both the homepage
// (app.js) and the match page (match.js) — that's the moment the proposer
// actually needs the link to hand to their opponent. Every page that
// calls this needs the same #share-modal/#share-modal-desc/
// #share-whatsapp-preview-field/#share-whatsapp-preview/#share-link/
// #whatsapp-btn/#copy-link-btn markup.
function openShareModal(m, whatsappText, description) {
  const url = `${window.location.origin}/match/${m.token}`;
  document.getElementById('share-link').textContent = url;
  const descEl = document.getElementById('share-modal-desc');
  descEl.textContent = description || '';
  descEl.style.display = description ? '' : 'none';
  const text = whatsappText || t('share.defaultWhatsappText', { p1: m.player1.name, p2: m.player2.name });
  // The WhatsApp button's own pre-filled text isn't visible anywhere until
  // WhatsApp actually opens — show it here too so what's about to be sent
  // isn't a surprise. Only for a real custom message (the propose-times
  // flows) — the plain Share button's generic default text doesn't need
  // its own preview line, the link below already covers that case.
  const previewField = document.getElementById('share-whatsapp-preview-field');
  if (previewField) {
    document.getElementById('share-whatsapp-preview').textContent = whatsappText || '';
    previewField.style.display = whatsappText ? '' : 'none';
  }
  document.getElementById('whatsapp-btn').onclick = () => {
    window.open(whatsappShareUrl(text, url), '_blank');
  };
  document.getElementById('copy-link-btn').onclick = () => {
    copyToClipboard(url).then(() => toast(t('share.linkCopied')));
  };
  document.getElementById('share-modal').style.display = 'flex';
}

// Shown instead of a toast wherever a click is blocked by checkMatchAccess/
// canManageMatch — the rejection message stays on screen until dismissed
// instead of a toast that can be missed. Used by app.js's
// handlePlannedActionClick and match.js's Start live match/Enter result
// manually handlers; every page that calls this needs the same
// #access-denied-modal/#access-denied-text markup.
function showAccessDeniedModal(message) {
  document.getElementById('access-denied-text').textContent = message;
  document.getElementById('access-denied-modal').style.display = 'flex';
}

async function checkAdmin() {
  try {
    const res = await loadSession();
    return !!res.isAdmin;
  } catch {
    return false;
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}
