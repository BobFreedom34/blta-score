// Part of common.js (loaded after common-nav.js): who is logged in, the login window, the bell with the badges and notifications.



// Shared "log in as player" gate: each player logs in with their own phone
// number (set per-player by an admin — see routes/players.js) which both
// authenticates them and identifies WHICH player they are, so match-editing
// rights can be scoped to their own matches instead of every match in the
// league (see checkMatchAccess in routes/matches.js). Lives in common.js
// since the popup and nav toggle are identical across every page.
//
// There used to be a second, more limited "anonymous" login here too (its
// own shared code) — it's been removed entirely; phone number is now the
// only way in besides admin. refereeAuthed below is a deliberately
// narrower re-introduction of that same "shared code, no real account"
// idea for one specific purpose — see its own comment.
let playerAuthed = false;
// A referee session (see the "Referee" button/modal in match.js,
// src/routes/referee.js) — unlike playerAuthed above, this carries no
// identity at all, just a yes/no, and only ever matters to
// requireLiveScoreAuth below (used ONLY by match.js's live-scoring button
// handlers) — nothing else in the app checks it or should.
let refereeAuthed = false;
// The kiosk of a court (public/js/kiosk.js, src/courtKiosk.js): { seasonId, courtNo } while this browser is the kiosk of a court, else null. Like a referee it may run the
// live score - but only of the matches of its own court (the server checks that on every request; match.js hides the controls of any other match).
let kioskCourt = null;
let currentPlayerName = null;
let currentPlayerPhotoUrl = null; // the photo of the logged-in player (his profile pill shows it instead of letters), or null
// Null for a pure admin session (no player cookie) or no session at all —
// only set once a *specific* player is logged in via their phone number.
// Pages that need to scope a button/action to "this player's own stuff"
// (see checkMatchAccess in routes/matches.js) compare against this.
let currentPlayerId = null;
// Only meaningful alongside currentPlayerId — the "My profile" nav link
// needs somewhere to actually point (see updatePlayerNavLinks below;
// /player/:id still resolves without a slug, but the slug is what every
// other profile link on the site already uses).
let currentPlayerSlug = null;
// Only meaningful alongside currentPlayerId — used to prefill "email me
// when someone confirms a time" on the propose-times/counter-propose
// modals (see openProposeTimesModal below and openCounterProposeModal in
// match.js) whenever the player already has one on file, rather than
// making them type it in again for every proposal.
let currentPlayerEmail = null;

function updatePlayerNavLinks() {
  document.querySelectorAll('.player-login-link').forEach((el) => {
    // The 🔑 icon lives in its own sibling span (see the nav-icon markup)
    // so it survives every text update below untouched — only the text
    // span itself gets rewritten, never the whole link's content.
    const textEl = el.querySelector('.player-login-link-text') || el;
    if (playerAuthed && currentPlayerName) textEl.textContent = t('nav.logoutWithName', { name: currentPlayerName });
    else if (playerAuthed) textEl.textContent = t('nav.logout');
    else textEl.textContent = t('nav.loginPlayer');
  });
  // Always visible (unlike .player-login-link's text, which already says
  // whether you're logged in) — kept pointed at the real profile once
  // known so a normal click, middle-click, or "open in new tab" all just
  // work; the click handler below is only what's needed for the logged-
  // out case, where there's nowhere real to point yet.
  document.querySelectorAll('.nav-my-profile-link').forEach((el) => {
    el.href = (playerAuthed && currentPlayerId) ? `/player/${currentPlayerSlug || currentPlayerId}` : '#';
  });
  // Registering is only meaningful for someone who isn't a player yet —
  // hidden once a real player session exists, same reasoning as
  // .player-login-link's text switching to "Log out" instead of offering
  // to log in again.
  document.querySelectorAll('.nav-register-link').forEach((el) => {
    el.style.display = playerAuthed ? 'none' : '';
  });
}

document.querySelectorAll('.nav-my-profile-link').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (playerAuthed && currentPlayerId) return; // real href already set — let it navigate normally
    e.preventDefault();
    requirePlayerAuth(() => { window.location.href = siteUrl(`/player/${currentPlayerSlug || currentPlayerId}`); });
  });
});

// Opens the same login modal straight at its registration step (see
// opts.startAtRegister in openPlayerLoginModal) instead of the normal
// phone-entry step — the one difference from reaching registration via
// the "not registered yet?" prompt is that the phone number isn't known
// yet either, so the register step's own phone field starts blank here
// instead of pre-filled.
document.querySelectorAll('.nav-register-link').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    openPlayerLoginModal(null, { startAtRegister: true });
  });
});

async function refreshPlayerAuth() {
  let needsPinSetup = false;
  let unreadNotificationCount = 0;
  try {
    const res = await loadSession();
    playerAuthed = !!res.isPlayer;
    currentPlayerName = res.playerName || null;
    currentPlayerPhotoUrl = res.playerPhotoUrl || null;
    currentPlayerId = res.playerId || null;
    currentPlayerSlug = res.playerSlug || null;
    currentPlayerEmail = res.playerEmail || null;
    needsPinSetup = !!res.needsPinSetup;
    unreadNotificationCount = res.unreadNotificationCount || 0;
    refereeAuthed = !!res.isReferee;
    kioskCourt = res.kioskCourt || null;
  } catch {
    playerAuthed = false;
    currentPlayerName = null;
    currentPlayerId = null;
    currentPlayerSlug = null;
    currentPlayerEmail = null;
    refereeAuthed = false;
    kioskCourt = null;
  }
  updatePlayerNavLinks();
  updateBadgeBellUI(unreadNotificationCount);
  // Lets any page's own script react to a login/logout finishing (e.g. the
  // homepage re-showing/hiding "Set date & location" once it knows who's
  // logged in) without common.js needing to know what each page does.
  window.dispatchEvent(new Event('blta:auth-changed'));
  // A player who's logged in but never finished creating a code (see
  // needsPinSetup in routes/player.js) gets sent straight back to that
  // step on every page load — this is what actually stops "close the
  // modal and never set one" from working: closing it (see the
  // pinSetupMandatory close-handlers below) logs them back out, and the
  // very next page they land on runs this same check again regardless.
  if (needsPinSetup) openPlayerLoginModal(null, { startAtSetPin: true });
  else maybeShowEventPopup();
  return playerAuthed;
}

// The pop-up about an event (Backend > Popups) for a logged-in player on the public pages (not the backend, the screens, the overlays or a frame).
// The script is loaded only when a player is logged in; it asks the server whether there is something to show.
let eventPopupAsked = false;
function maybeShowEventPopup() {
  if (eventPopupAsked || !playerAuthed || !currentPlayerId) return;
  const path = window.location.pathname;
  if (window.self !== window.top || /-admin$|^\/admin|^\/login-history|\/embed|\/overlay|\/screen|\/draw-live|\/live\b|\/court-?iq|^\/match\//i.test(path)) return;
  eventPopupAsked = true;
  const run = () => setTimeout(() => window.BLTA_EVENT_POPUP && window.BLTA_EVENT_POPUP.check(), 1500);
  if (window.BLTA_EVENT_POPUP) { run(); return; }
  const s = document.createElement('script');
  s.src = '/js/event-popup.js';
  s.onload = run;
  document.head.appendChild(s);
}

// Mirrors checkMatchAccess in routes/matches.js — whether the current
// session could actually manage this match (start it, set its date/
// location, propose times for the opponent, edit an existing proposal,
// etc.), so those controls only show up where they'd work instead of
// showing everywhere and 403ing on click. isAdminUser is passed in rather
// than read off a shared global since each page tracks its own admin
// status (via checkAdmin()) independently. A visitor with no session at
// all still sees these controls — requirePlayerAuth prompts login, then
// the action proceeds normally — this only hides them once we actually
// know who's logged in and they're not eligible for THIS match.
function canManageMatch(m, isAdminUser) {
  if (isAdminUser) return true;
  if (m.viewerManagesClub) return true; // the admin of the club that runs its tournament (the match page asks the server and sets this)
  if (playerAuthed && currentPlayerId) {
    const playsInMatch = currentPlayerId === m.player1.id || currentPlayerId === m.player2.id;
    if (m.createdByAdmin && playsInMatch) return true;
    if (m.createdByPlayerId === currentPlayerId) return true;
    // Grandfather clause — mirrors checkMatchAccess in routes/matches.js:
    // a match with no creator attribution at all predates per-player
    // tracking (created under the old shared PLAYER_CODE login), so treat
    // it like an admin-created match instead of leaving it permanently
    // unmanageable by either player still in it.
    return !m.createdByAdmin && !m.createdByAnonymous && !m.createdByPlayerId && playsInMatch;
  }
  return true;
}

// Mirrors checkLiveScoreAccess server-side (routes/matches.js) — narrower
// than canManageMatch just above on purpose: that one also lets a match's
// mere CREATOR manage it (right for editing location/date or deleting a
// match you organized), but running the live score is a different
// permission — only an admin or one of the two actual players, never
// someone who just set the match up for two other people. Same logged-out
// "decide once requirePlayerAuth resolves" convention as canManageMatch
// (see its own comment above) — a referee session is checked separately
// wherever this is used (see requireLiveScoreAuth/refereeAuthed), not here.
function canManageLiveScore(m, isAdminUser) {
  if (isAdminUser) return true;
  if (m.viewerManagesClub) return true;
  if (playerAuthed && currentPlayerId) {
    return currentPlayerId === m.player1.id || currentPlayerId === m.player2.id;
  }
  return true;
}

// "N attempt(s) left" needs real plural forms in Slovak (1/2-4/5+), not
// just an English-style singular/plural switch — used only by
// loginErrorText's incorrectCode case below.
function attemptsWord(n) {
  if (currentLang === 'sk') {
    if (n === 1) return 'pokus';
    if (n >= 2 && n <= 4) return 'pokusy';
    return 'pokusov';
  }
  return n === 1 ? 'attempt' : 'attempts';
}

// Every /player/* auth error (login, register, set-pin, forgot-pin,
// reset-pin, request-admin-reset) carries a plain-English "error" string
// (this app's long-standing convention for server error text generally)
// alongside a short machine "errorCode" — this maps that code to a
// translated string via t(`login.error.${code}`), falling back to the raw
// English message for any code that isn't mapped (a future/forgotten one)
// rather than showing nothing.
function loginErrorText(err) {
  const code = err.data && err.data.errorCode;
  if (!code) return err.message;
  const key = `login.error.${code}`;
  const vars = code === 'incorrectCode' ? { count: err.data.attemptsLeft, word: attemptsWord(err.data.attemptsLeft) } : undefined;
  const translated = t(key, vars);
  return translated === key ? err.message : translated;
}

// Same mechanism as loginErrorText above, for POST /referee/login's own
// errorCode ('notConfigured'/'wrongCode') — a separate function rather
// than widening loginErrorText's own login.error.* namespace, since these
// are unrelated errors under their own referee.error.* keys.
function refereeErrorText(err) {
  const code = err.data && err.data.errorCode;
  if (!code) return err.message;
  const key = `referee.error.${code}`;
  const translated = t(key);
  return translated === key ? err.message : translated;
}

// Six steps, only three of which any one login ever visits — see the
// #player-login-step-* panels in the modal markup:
//   1. player-login-step-form     — phone number; also where the "not
//                                    registered yet?" prompt into step 6
//                                    lives (server 401s with notFound)
//   2. player-login-step-pin      — only if that phone already has a code
//                                    set up (server 401s with pinRequired);
//                                    also where "Forgot your code?" lives
//   3. player-login-step-set-pin  — only the first time (server 200s with
//                                    pinSetupRequired), or any later page
//                                    load that still finds no code set
//                                    (see refreshPlayerAuth's needsPinSetup
//                                    check) — creating a code is mandatory
//                                    going forward: closing the modal here
//                                    (the X button or the backdrop) logs
//                                    the player back out instead of just
//                                    hiding it, via pinSetupMandatory below
//   4. player-login-step-forgot   — reached from step 2's "Forgot your
//                                    code?" link, not from a server response
//   5. player-login-step-register — reached from step 1's "not registered
//                                    yet?" prompt, not from switching a
//                                    login-vs-register mode upfront —
//                                    self-service registration (see POST
//                                    /player/register) for a phone number
//                                    with no player behind it at all;
//                                    success lands on step 3 exactly like
//                                    an admin-added player's first login
//   6. player-login-step-success  — always the last step, whichever way it
//                                    got there
//
// True only while step 3 is showing because a code genuinely still has to
// be created (not just "the modal happens to be sitting on that panel"
// mid-flow) — gates the close-handlers below so closing the modal any
// OTHER time (e.g. a not-yet-logged-in visitor backing out of the phone
// step) behaves exactly as it always has, no logout involved.
let pinSetupMandatory = false;

function openPlayerLoginModal(onSuccess, opts) {
  const modal = document.getElementById('player-login-modal');
  if (!modal) return;
  const steps = ['form', 'pin', 'set-pin', 'forgot', 'register', 'success'].map((name) => document.getElementById(`player-login-step-${name}`));
  const [formStep, pinStep, setPinStep, forgotStep, registerStep, successStep] = steps;

  const form = document.getElementById('player-login-form');
  const input = document.getElementById('player-login-input');
  const errorEl = document.getElementById('player-login-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const registerPromptEl = document.getElementById('player-login-register-prompt');
  const registerLink = document.getElementById('player-login-register-link');

  const pinForm = document.getElementById('player-login-pin-form');
  const pinInput = document.getElementById('player-login-pin-input');
  const pinErrorEl = document.getElementById('player-login-pin-error');
  const pinSubmitBtn = pinForm.querySelector('button[type="submit"]');
  const pinBackBtn = document.getElementById('player-login-pin-back-btn');
  const forgotLink = document.getElementById('player-login-forgot-link');

  const setPinForm = document.getElementById('player-login-set-pin-form');
  const setPinInput = document.getElementById('player-login-set-pin-input');
  const setPinConfirmInput = document.getElementById('player-login-set-pin-confirm-input');
  const setPinErrorEl = document.getElementById('player-login-set-pin-error');
  const setPinSubmitBtn = setPinForm.querySelector('button[type="submit"]');

  const forgotLoading = document.getElementById('player-login-forgot-loading');
  const forgotEmailSent = document.getElementById('player-login-forgot-email-sent');
  const forgotNoEmail = document.getElementById('player-login-forgot-no-email');
  const forgotErrorEl = document.getElementById('player-login-forgot-error');
  const forgotBackBtn = document.getElementById('player-login-forgot-back-btn');
  const requestAdminBtn = document.getElementById('player-login-request-admin-btn');
  const requestAdminSentEl = document.getElementById('player-login-request-admin-sent');

  const registerForm = document.getElementById('player-login-register-form');
  const registerPhoneInput = document.getElementById('player-login-register-phone-input');
  const registerNameInput = document.getElementById('player-login-register-name-input');
  const registerEmailInput = document.getElementById('player-login-register-email-input');
  const registerLevelInput = document.getElementById('player-login-register-level-input');
  const registerErrorEl = document.getElementById('player-login-register-error');
  const registerSubmitBtn = registerForm.querySelector('button[type="submit"]');
  const registerBackBtn = document.getElementById('player-login-register-back-btn');

  function showStep(step) {
    steps.forEach((el) => { el.style.display = 'none'; });
    step.style.display = '';
  }

  // The phone number just entered — carried from the form step to the pin
  // and forgot steps so their own submits can resend it (see the login/
  // forgot-pin/request-admin-reset routes' contract in routes/player.js)
  // without asking for the phone number twice.
  let enteredPhone = '';

  function showSuccess() {
    document.getElementById('player-login-success-text').textContent = currentPlayerName
      ? t('login.successNamed', { name: currentPlayerName })
      : t('login.successGeneric');
    showStep(successStep);
  }

  function applySession(res) {
    playerAuthed = !!res.isPlayer;
    currentPlayerName = res.playerName || null;
    currentPlayerPhotoUrl = res.playerPhotoUrl || null;
    currentPlayerId = res.playerId || null;
    currentPlayerSlug = res.playerSlug || null;
    updatePlayerNavLinks();
    window.dispatchEvent(new Event('blta:auth-changed'));
  }

  errorEl.textContent = '';
  registerPromptEl.style.display = 'none';
  input.value = '';
  input.disabled = false;

  if (opts && opts.startAtSetPin) {
    // Not a fresh login — refreshPlayerAuth found an already-logged-in
    // player with no code yet (see needsPinSetup in routes/player.js) and
    // is sending them straight back here, skipping the phone/pin steps
    // entirely since they're not relevant right now.
    pinSetupMandatory = true;
    otpClear('player-login-set-pin-input');
    otpClear('player-login-set-pin-confirm-input');
    setPinErrorEl.textContent = '';
    showStep(setPinStep);
    setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
  } else if (opts && opts.startAtRegister) {
    // Opened directly from the nav's "Register" link (see the
    // .nav-register-link handler above) — no phone step first, so unlike
    // registerLink.onclick below, the phone field starts blank rather
    // than pre-filled with a just-entered, already-known number.
    registerPhoneInput.value = '';
    registerNameInput.value = '';
    registerEmailInput.value = '';
    registerErrorEl.textContent = '';
    showStep(registerStep);
    setTimeout(() => registerPhoneInput.focus(), 50);
  } else {
    showStep(formStep);
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    errorEl.textContent = '';
    registerPromptEl.style.display = 'none';
    input.disabled = true;
    submitBtn.disabled = true;
    try {
      const res = await api('/player/login', { method: 'POST', body: { code } });
      applySession(res);
      if (res.pinSetupRequired) {
        enteredPhone = code;
        pinSetupMandatory = true;
        otpClear('player-login-set-pin-input');
        otpClear('player-login-set-pin-confirm-input');
        setPinErrorEl.textContent = '';
        showStep(setPinStep);
        setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
      } else {
        // Confirm who just logged in instead of closing silently — see
        // showSuccess; the modal only actually closes (and hands off to
        // onSuccess, continuing whatever action prompted this login) once
        // the player acknowledges it via the OK button below.
        showSuccess();
      }
    } catch (err) {
      // pinRequired and locked both land here (a locked account still 401s
      // with pinRequired unset, but showing the pin step either way is
      // right — the "Forgot your code?" link on it is exactly what a
      // locked-out player needs, and the error text itself explains why).
      if (err.data && (err.data.pinRequired || err.data.locked)) {
        enteredPhone = code;
        otpClear('player-login-pin-input');
        pinErrorEl.textContent = err.data.locked ? loginErrorText(err) : '';
        showStep(pinStep);
        setTimeout(() => otpFocus('player-login-pin-input'), 50);
      } else {
        errorEl.textContent = loginErrorText(err);
        // notFound means this genuinely looks like a phone number, just
        // not a registered one — offer self-registration instead of a
        // dead end (see the login route's contract in routes/player.js).
        if (err.data && err.data.notFound) {
          enteredPhone = code;
          registerPromptEl.style.display = '';
        }
        input.focus();
      }
    }
    input.disabled = false;
    submitBtn.disabled = false;
  };

  // a visible way to register for somebody who has no account yet (the link under the form only appears after an unknown number)
  let registerBtn = document.getElementById('player-login-register-btn');
  if (!registerBtn) {
    registerBtn = document.createElement('button');
    registerBtn.type = 'button';
    registerBtn.id = 'player-login-register-btn';
    registerBtn.className = 'btn btn-outline btn-block';
    registerBtn.style.marginTop = '10px';
    registerBtn.textContent = t('login.registerBtn');
    form.insertAdjacentElement('afterend', registerBtn);
  }
  registerBtn.onclick = () => {
    registerPhoneInput.value = input.value.trim();
    registerNameInput.value = '';
    registerEmailInput.value = '';
    registerLevelInput.value = '';
    registerErrorEl.textContent = '';
    showStep(registerStep);
    setTimeout(() => (registerPhoneInput.value ? registerNameInput : registerPhoneInput).focus(), 50);
  };

  registerLink.onclick = (e) => {
    e.preventDefault();
    // Already known from the phone step that led here (see notFound
    // above) — pre-filled rather than left for the player to retype, but
    // still just a normal editable field in case they mistyped it there.
    registerPhoneInput.value = enteredPhone;
    registerNameInput.value = '';
    registerEmailInput.value = '';
    registerLevelInput.value = '';
    registerErrorEl.textContent = '';
    showStep(registerStep);
    setTimeout(() => registerNameInput.focus(), 50);
  };

  registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const phone = registerPhoneInput.value.trim();
    const name = registerNameInput.value.trim();
    const email = registerEmailInput.value.trim();
    const tennisLevel = registerLevelInput.value;
    if (!phone || !name || !email) return;
    if (!tennisLevel) { registerErrorEl.textContent = t('login.error.levelRequired'); return; }
    enteredPhone = phone;
    registerErrorEl.textContent = '';
    registerSubmitBtn.disabled = true;
    try {
      const res = await api('/player/register', { method: 'POST', body: { name, email, phone, tennisLevel, lang: typeof currentLang === 'string' ? currentLang : 'sk' } });
      applySession(res);
      trackConversion('blta_complete_registration'); // after the server said yes
      // Same landing spot a pinSetupRequired login uses — registering and
      // a first login both end with "now create your code".
      otpClear('player-login-set-pin-input');
      otpClear('player-login-set-pin-confirm-input');
      setPinErrorEl.textContent = '';
      showStep(setPinStep);
      setTimeout(() => otpFocus('player-login-set-pin-input'), 50);
    } catch (err) {
      registerErrorEl.textContent = loginErrorText(err);
    }
    registerSubmitBtn.disabled = false;
  };

  registerBackBtn.onclick = () => {
    showStep(formStep);
    setTimeout(() => input.focus(), 50);
  };

  pinForm.onsubmit = async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;
    pinErrorEl.textContent = '';
    otpSetDisabled('player-login-pin-input', true);
    pinSubmitBtn.disabled = true;
    try {
      const res = await api('/player/login', { method: 'POST', body: { code: enteredPhone, pin } });
      applySession(res);
      showSuccess();
    } catch (err) {
      pinErrorEl.textContent = loginErrorText(err);
      otpClear('player-login-pin-input');
      otpFocus('player-login-pin-input');
    }
    otpSetDisabled('player-login-pin-input', false);
    pinSubmitBtn.disabled = false;
  };

  // Back to the phone step — e.g. the phone number itself was mistyped and
  // this isn't actually their code to enter.
  pinBackBtn.onclick = () => {
    errorEl.textContent = '';
    input.value = '';
    showStep(formStep);
    setTimeout(() => input.focus(), 50);
  };

  setPinForm.onsubmit = async (e) => {
    e.preventDefault();
    const pin = setPinInput.value.trim();
    const confirmPin = setPinConfirmInput.value.trim();
    if (!pin || !confirmPin) return;
    setPinErrorEl.textContent = '';
    setPinSubmitBtn.disabled = true;
    try {
      await api('/player/set-pin', { method: 'POST', body: { pin, confirmPin } });
      pinSetupMandatory = false;
      showSuccess();
    } catch (err) {
      setPinErrorEl.textContent = loginErrorText(err);
    }
    setPinSubmitBtn.disabled = false;
  };

  // "Forgot your code?" — reuses the phone number already entered on the
  // form step (see enteredPhone above), so there's nothing new to type
  // before this fires. The server tells us which of the two outcomes
  // applies (an email on file to send a reset link to, or not); either
  // way this never logs the player in by itself — that only happens once
  // they actually follow the emailed link (POST /player/reset-pin, on the
  // dedicated public/reset-code.html page) or an admin resets it.
  forgotLink.onclick = async (e) => {
    e.preventDefault();
    forgotErrorEl.textContent = '';
    forgotLoading.style.display = '';
    forgotEmailSent.style.display = 'none';
    forgotNoEmail.style.display = 'none';
    requestAdminBtn.style.display = '';
    requestAdminBtn.disabled = false;
    requestAdminSentEl.style.display = 'none';
    showStep(forgotStep);
    try {
      const res = await api('/player/forgot-pin', { method: 'POST', body: { code: enteredPhone } });
      forgotLoading.style.display = 'none';
      if (res.noEmail) forgotNoEmail.style.display = '';
      else forgotEmailSent.style.display = '';
    } catch (err) {
      forgotLoading.style.display = 'none';
      forgotErrorEl.textContent = loginErrorText(err);
    }
  };

  requestAdminBtn.onclick = async () => {
    requestAdminBtn.disabled = true;
    try {
      await api('/player/request-admin-reset', { method: 'POST', body: { code: enteredPhone } });
      requestAdminBtn.style.display = 'none';
      requestAdminSentEl.style.display = '';
    } catch (err) {
      requestAdminBtn.disabled = false;
      forgotErrorEl.textContent = loginErrorText(err);
    }
  };

  forgotBackBtn.onclick = () => {
    showStep(pinStep);
    setTimeout(() => otpFocus('player-login-pin-input'), 50);
  };

  document.getElementById('player-login-ok-btn').onclick = () => {
    modal.style.display = 'none';
    if (onSuccess) onSuccess();
  };

  modal.style.display = 'flex';
  // The startAtSetPin branch above already showed its own step and
  // focused its own field — focusing the (now-hidden) phone input here
  // too would just steal it back.
  if (!(opts && opts.startAtSetPin)) setTimeout(() => input.focus(), 50);
}

// Closing the modal while pinSetupMandatory is true (the X button or
// clicking the backdrop — both already close the modal via the generic
// [data-close]/.modal-backdrop handlers up top; this just runs alongside
// them) means walking away without creating a code, which would otherwise
// leave the player sitting fully logged in with no code, indefinitely —
// exactly the stuck state needsPinSetup/refreshPlayerAuth above exists to
// prevent. Logging them out here closes that loophole for the current
// page; the recheck on every other page load closes it for good.
async function forceLogoutFromPinSetup() {
  if (!pinSetupMandatory) return;
  pinSetupMandatory = false;
  try { await api('/player/logout', { method: 'POST' }); } catch { /* ignore */ }
  playerAuthed = false;
  currentPlayerName = null;
  currentPlayerId = null;
  updatePlayerNavLinks();
  window.dispatchEvent(new Event('blta:auth-changed'));
}
document.querySelectorAll('#player-login-modal [data-close]').forEach((el) => {
  el.addEventListener('click', forceLogoutFromPinSetup);
});
const playerLoginModalEl = document.getElementById('player-login-modal');
if (playerLoginModalEl) {
  playerLoginModalEl.addEventListener('click', (e) => {
    if (e.target.id === 'player-login-modal') forceLogoutFromPinSetup();
  });
}

// Runs onReady immediately if already logged in (as a real player or
// admin), otherwise shows the login popup first and runs onReady only
// after a successful login. Getting past this gate doesn't guarantee the
// server will actually allow the action — the real per-match ownership
// check happens server-side, with the error surfaced back through the
// normal toast(err.message) path.
function requirePlayerAuth(onReady) {
  if (playerAuthed) { onReady(); return; }
  openPlayerLoginModal(onReady);
}

// For what needs a real PLAYER (messages, communities and clubs, writing to a player): a session that is only an admin says isPlayer, but has no player identity
// (currentPlayerId is null), so requirePlayerAuth let it through and the button did nothing. Here it needs the identity, else the login window opens.
function requireRealPlayer(onReady) {
  if (playerAuthed && currentPlayerId) { onReady(); return; }
  openPlayerLoginModal(onReady);
}

// Same idea as requirePlayerAuth, but also lets a referee session through
// (see refereeAuthed above) — used ONLY by match.js's live-scoring button
// handlers (start/score/undo/pause/resume/restart/finish/unfinished/
// resume-later/finish-as-is, mirroring exactly the routes in
// routes/matches.js gated by requireLoggedInOrReferee there), never as a
// general replacement for requirePlayerAuth elsewhere — a referee isn't a
// stand-in for a real player or admin on anything but live scoring.
function requireLiveScoreAuth(onReady) {
  if (playerAuthed || refereeAuthed || kioskCourt) { onReady(); return; }
  openPlayerLoginModal(onReady);
}

document.querySelectorAll('.player-login-link').forEach((el) => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    if (playerAuthed) {
      await dropDevicePush(); // before the logout: it needs the session
      try { await api('/player/logout', { method: 'POST' }); } catch { /* ignore */ }
      playerAuthed = false;
      currentPlayerName = null;
      currentPlayerId = null;
      currentPlayerSlug = null;
      currentPlayerEmail = null;
      updatePlayerNavLinks();
      window.dispatchEvent(new Event('blta:auth-changed'));
      toast('Logged out');
    } else {
      openPlayerLoginModal();
    }
  });
});

// --- Notification bell ------------------------------------------------
// Two unrelated things land here: a player earning a badge server-side
// the instant a match finishes (see badgeEngine.syncPlayerBadges),
// someone posting in a match's chat that this player is in (see
// POST /:token/messages in routes/matches.js), someone picking a time on
// this player's looking-to-play post (see POST /availability/:id/join in
// routes/availability.js), and someone proposing/confirming times on a
// match of theirs (see notifyProposalReceived/notifyProposalConfirmed in
// routes/matches.js) — this is what surfaces all of these as one small
// bell in the topbar. Fed by GET /player/session's unreadNotificationCount
// (kept current on every page load via refreshPlayerAuth above, exactly
// like the rest of the player session) and, once opened, the merged list
// from GET /player/notifications, each item carrying a `type` ('BADGE',
// 'CHAT_MESSAGE', 'PLAY_REQUEST', 'PROPOSAL', 'PHOTO', ...) this branches on to
// render and handle it. Still named badge-* throughout below (bell/panel/
// item CSS classes included) since the badge was what this started as —
// not worth a sitewide rename now that it's grown a second use. All of it
// — the bell, its dropdown, and the badge "Congratulations" modal — is
// built here rather than living as static markup in every page, so it
// works sitewide without needing to touch (and keep byte-identical) the
// shared block across all 7 core HTML files. A page with no topbar at all
// (the embed views) just never gets one — ensureBadgeBellUI bails out the
// moment it can't find `.topbar-right`.
let badgeBellEl = null;
let badgeBellBubbleEl = null;
let badgeNotifPanelEl = null;
let badgeCongratsModalEl = null;
let badgeNotifCache = null; // holds every notification type, despite the name

// Mirrors badgeIconInner in badges.js (not reused directly — that file
// isn't loaded on every page, only player.html/rankings.html, while the
// bell has to work everywhere).
function badgeIconMarkup(icon) {
  return icon && icon.startsWith('/badge-icons/')
    ? `<img src="${escapeHtml(icon)}" alt="">`
    : escapeHtml(icon || '🏅');
}

function ensureBadgeBellUI() {
  if (badgeBellEl) return badgeBellEl;
  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return null;

  // Its own wrapper (position:relative), deliberately not put on
  // .topbar-right itself — .nav-toggle also lives in .topbar-right, and
  // its own centering (position:absolute; left:50%) resolves against
  // whatever the *nearest* positioned ancestor is. Putting position on
  // .topbar-right directly made that .topbar-right's own narrow,
  // right-aligned box instead of .topbar — silently recentering the
  // hamburger into the language switcher instead of the middle of the
  // bar. See the matching comment on .badge-bell-wrap in style.css.
  const wrap = document.createElement('span');
  wrap.className = 'badge-bell-wrap';
  // Its visual position (always to the right of #lang-switcher on desktop)
  // actually comes from .badge-bell-wrap's own order:10 in style.css, not
  // this append — kept as appendChild anyway since that's the more
  // sensible DOM position regardless.
  topbarRight.appendChild(wrap);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'badge-bell-btn';
  btn.className = 'badge-bell-btn';
  btn.setAttribute('aria-label', t('notif.bellLabel'));
  btn.innerHTML = '🔔<span class="badge-bell-bubble" id="badge-bell-bubble" hidden>0</span>';
  wrap.appendChild(btn);
  badgeBellEl = wrap;
  badgeBellBubbleEl = btn.querySelector('.badge-bell-bubble');

  const panel = document.createElement('div');
  panel.className = 'badge-notif-panel';
  panel.id = 'badge-notif-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="badge-notif-panel-header"><span>${t('notif.heading')}</span><button type="button" class="badge-notif-readall" id="badge-notif-readall" hidden>${t('notif.markAll')}</button></div>
    <div class="badge-notif-push" id="badge-notif-push" hidden></div>
    <div class="badge-notif-list" id="badge-notif-list"></div>
  `;
  wrap.appendChild(panel);
  badgeNotifPanelEl = panel;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBadgeNotifPanel();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
  });

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'badge-congrats-modal';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px;text-align:center">
      <button type="button" class="close" aria-label="Close">&times;</button>
      <div id="badge-congrats-content"></div>
    </div>
  `;
  document.body.appendChild(modal);
  // Same reasoning as install-ios-modal above — this element didn't exist
  // yet when the generic [data-close]/.modal-backdrop listeners ran at
  // page load, so it needs its own close wiring.
  modal.querySelector('.close').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  badgeCongratsModalEl = modal;

  return wrap;
}

// Called on every refreshPlayerAuth() (page load, login, logout) and again
// after a notification is marked read. `count` undefined leaves whatever's
// currently shown untouched — only whether the bell itself is shown/hidden
// gets re-evaluated every time.
function updateBadgeBellUI(count) {
  const shouldShow = !!(playerAuthed && currentPlayerId);
  const btn = shouldShow ? ensureBadgeBellUI() : badgeBellEl;
  if (!btn) return;
  // Explicit 'inline-flex', not '' — clearing the inline style would just
  // fall back to .badge-bell-btn's own default of display:none in the
  // stylesheet (it starts hidden there since most visitors never get one).
  btn.style.display = shouldShow ? 'inline-flex' : 'none';
  if (!shouldShow) {
    if (badgeNotifPanelEl) badgeNotifPanelEl.hidden = true;
    return;
  }
  if (count === undefined || !badgeBellBubbleEl) return;
  badgeBellBubbleEl.hidden = count <= 0;
  badgeBellBubbleEl.textContent = count > 99 ? '99+' : String(count);
}

async function toggleBadgeNotifPanel() {
  if (!badgeNotifPanelEl) return;
  const opening = badgeNotifPanelEl.hidden;
  badgeNotifPanelEl.hidden = !opening;
  if (!opening) return;
  refreshPushRow();
  const list = document.getElementById('badge-notif-list');
  list.innerHTML = `<div class="badge-notif-empty">${t('notif.loading')}</div>`;
  try {
    badgeNotifCache = await api('/player/notifications');
    renderBadgeNotifList();
  } catch {
    list.innerHTML = `<div class="badge-notif-empty">${t('notif.loadError')}</div>`;
  }
}

// Chat message bodies can run up to 500 characters (see routes/matches.js)
// — nowhere near reasonable for one dropdown row, so this clips it the
// same way a card-list preview would.
function truncateForNotif(text, max) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function renderBadgeNotifList() {
  const list = document.getElementById('badge-notif-list');
  if (!list) return;
  const readAllBtn = document.getElementById('badge-notif-readall');
  if (readAllBtn) readAllBtn.hidden = !(badgeNotifCache && badgeNotifCache.some((n) => !n.seen));
  if (!badgeNotifCache || !badgeNotifCache.length) {
    list.innerHTML = `<div class="badge-notif-empty">${t('notif.empty')}</div>`;
    return;
  }
  list.innerHTML = badgeNotifCache.map((n) => {
    let icon; let title; let subtitle;
    if (n.type === 'BADGE') {
      icon = badgeIconMarkup(n.badge.icon);
      title = t('notif.earnedTitle', { badge: escapeHtml(n.badge.name) });
      subtitle = fmtDateShort(n.createdAt);
    } else if (n.type === 'CHAT_MESSAGE') {
      icon = '💬';
      title = t('notif.chatTitle', { author: escapeHtml(n.chat.author) });
      subtitle = escapeHtml(truncateForNotif(n.chat.body, 80));
    } else if (n.type === 'PLAY_REQUEST') {
      icon = '👋';
      title = t(n.playRequest.mode === 'DOUBLES' ? 'notif.partnerRequestTitle' : 'notif.playRequestTitle', { name: escapeHtml(n.playRequest.joinerName) });
      subtitle = fmtDateShort(n.playRequest.slot);
    } else if (n.type === 'PROPOSAL') {
      // A missing otherPlayerName means something different depending on
      // kind: for RECEIVED it's genuinely unknown (see notifyProposalReceived
      // in routes/matches.js — only fires once a proposer is known, so this
      // shouldn't actually happen, but 'someone' is a safe fallback). For
      // CONFIRMED it specifically means admin confirmed it rather than the
      // other match player (the proposer can't confirm their own offer, and
      // only admin or that other player can respond at all — see
      // respond-proposal — so a null confirmer there is always admin).
      const fallbackName = n.proposal.kind === 'CONFIRMED' ? t('common.admin') : t('common.someone');
      const name = escapeHtml(n.proposal.otherPlayerName || fallbackName);
      icon = n.proposal.kind === 'CONFIRMED' ? '✅' : '📅';
      title = t(n.proposal.kind === 'CONFIRMED' ? 'notif.proposalConfirmedTitle' : 'notif.proposalReceivedTitle', { name });
      subtitle = fmtDateShort(n.createdAt);
    } else if (n.type === 'RANKING') {
      icon = n.ranking.direction === 'up' ? '📈' : '📉';
      title = t(n.ranking.direction === 'up' ? 'notif.rankingUpTitle' : 'notif.rankingDownTitle', {
        amount: n.ranking.amount, rank: n.ranking.newRank, week: n.ranking.week, places: nounFor(n.ranking.amount, 'miesto', 'miesta', 'miest', 'place', 'places'),
      });
      subtitle = fmtDateShort(n.createdAt);
    } else if (n.type === 'PHOTO') {
      // A null uploaderName is an admin's photo (no player behind it).
      icon = '📷';
      title = t('notif.photoTitle', { name: escapeHtml(n.photo.uploaderName || t('common.admin')) });
      subtitle = fmtDateShort(n.createdAt);
    } else if (n.type === 'POST') {
      icon = '📢';
      title = t('notif.postTitle', { name: escapeHtml(n.post.authorName), org: escapeHtml(n.post.orgName) });
      subtitle = n.post.body ? escapeHtml(truncateForNotif(n.post.body, 80)) : fmtDateShort(n.createdAt);
    } else if (n.type === 'REACTION') {
      icon = escapeHtml(n.reaction.emoji);
      title = t('notif.reactionTitle', { name: escapeHtml(n.reaction.actorName), org: escapeHtml(n.reaction.orgName) });
      subtitle = fmtDateShort(n.createdAt);
    } else if (n.type === 'REGISTRATION') {
      // an organiser of a club: somebody registered for one of its tournaments
      icon = '🎾';
      title = t(n.registration.kind === 'UNREGISTER' ? 'notif.unregistrationTitle' : (n.registration.substitute ? 'notif.registrationSubTitle' : 'notif.registrationTitle'), { name: escapeHtml(n.registration.name), season: escapeHtml(n.registration.seasonName) });
      subtitle = `${escapeHtml(n.registration.orgName)} · ${fmtDateShort(n.createdAt)}`;
    } else if (n.type === 'COMMENT') {
      icon = '💬';
      title = t('notif.commentTitle', { name: escapeHtml(n.comment.authorName), org: escapeHtml(n.comment.orgName) });
      subtitle = escapeHtml(truncateForNotif(n.comment.body, 80));
    } else if (n.type === 'MENTION') {
      icon = '@';
      title = t('notif.mentionTitle', { name: escapeHtml(n.comment.authorName), org: escapeHtml(n.comment.orgName) });
      subtitle = escapeHtml(truncateForNotif(n.comment.body, 80));
    } else { // BADGE_REMINDER
      icon = badgeIconMarkup(n.badge.icon);
      title = t('notif.reminderListTitle', { badge: escapeHtml(n.badge.name) });
      subtitle = escapeHtml(truncateForNotif(n.badge.description, 80));
    }
    return `
    <button type="button" class="badge-notif-item${n.seen ? '' : ' unread'}" data-notif-type="${n.type}" data-notif-id="${n.id}">
      <div class="badge-notif-icon">${icon}</div>
      <div class="badge-notif-text">
        <div class="badge-notif-title">${title}</div>
        <div class="badge-notif-date">${subtitle}</div>
      </div>
      ${n.seen ? '' : '<span class="badge-notif-dot"></span>'}
    </button>
  `;
  }).join('');
}

function openBadgeCongratsModal(notif) {
  if (!badgeCongratsModalEl) return;
  const content = document.getElementById('badge-congrats-content');
  content.innerHTML = `
    <div class="badge-congrats-icon">${badgeIconMarkup(notif.badge.icon)}</div>
    <h3 class="badge-congrats-title">${t('notif.congratsTitle')}</h3>
    <p class="badge-congrats-intro">${t('notif.congratsIntro')}</p>
    <div class="badge-congrats-badge-name">${escapeHtml(notif.badge.name)}</div>
    <p class="badge-congrats-desc">${escapeHtml(notif.badge.description)}</p>
  `;
  badgeCongratsModalEl.style.display = 'flex';
}

// Same modal element/markup as the earned-badge one above, just reminder
// wording instead of congratulations — a CALENDAR_DATE badge whose day is
// 3 days out and this player doesn't hold yet (see
// sendCalendarDateReminders in badgeEngine.js). currentPlayerName is
// already known by the time this can ever fire (the bell itself only
// exists for a logged-in player — see updateBadgeBellUI), so the greeting
// can always use it directly.
function openBadgeReminderModal(notif) {
  if (!badgeCongratsModalEl) return;
  const content = document.getElementById('badge-congrats-content');
  content.innerHTML = `
    <div class="badge-congrats-icon">${badgeIconMarkup(notif.badge.icon)}</div>
    <h3 class="badge-congrats-title">${t('notif.reminderTitle')}</h3>
    <p class="badge-congrats-intro">${t('notif.reminderIntro', { name: escapeHtml(currentPlayerName || '') })}</p>
    <div class="badge-congrats-badge-name">${escapeHtml(notif.badge.name)}</div>
    <p class="badge-congrats-desc">${escapeHtml(notif.badge.description)}</p>
    <p class="badge-congrats-cta">${t('notif.reminderCta')}</p>
  `;
  badgeCongratsModalEl.style.display = 'flex';
}

// "What is CourtIQ?" — a small always-there "?" button sits next to the
// word "CourtIQ" everywhere it appears as a heading/label (the player
// profile header badge, the full CourtIQ card, the Rankings tab's column
// header — see .courtiq-info-btn in player.html/player.js/rankings.js),
// all opening this one shared modal. Built lazily on first click, same
// "doesn't exist until it's needed" pattern as badgeCongratsModalEl above
// — it needs its own close wiring for the same reason that one does.
let courtIQInfoModalEl = null;
function ensureCourtIQInfoModal() {
  if (courtIQInfoModalEl) return courtIQInfoModalEl;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'courtiq-info-modal';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal" style="max-width:420px">
      <button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('courtiq.infoTitle'))}</h3>
      <p style="color:var(--ink);font-size:14px;line-height:1.5">${escapeHtml(t('courtiq.infoBody1'))}</p>
      <p style="color:var(--ink);font-size:14px;line-height:1.5">${escapeHtml(t('courtiq.infoBody2'))}</p>
      <p style="color:var(--ink);font-size:14px;line-height:1.5">${escapeHtml(t('courtiq.infoBody3'))}</p>
      <a class="btn btn-primary btn-block" href="/courtiq" style="margin-top:18px">${escapeHtml(t('courtiq.readMore'))}</a>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  courtIQInfoModalEl = modal;
  return modal;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.courtiq-info-btn')) return;
  ensureCourtIQInfoModal().style.display = 'flex';
});

// A badge and a chat notification each have their own independent id
// sequence (separate DB tables — see GET /player/notifications in
// routes/player.js), so the two together are what actually identify one
// row here; a bare id alone could match either.
// "Označiť všetko ako prečítané" in the head of the bell's panel
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#badge-notif-readall');
  if (!btn) return;
  btn.disabled = true;
  try {
    const res = await api('/player/notifications/read-all', { method: 'POST' });
    if (badgeNotifCache) badgeNotifCache.forEach((n) => { n.seen = true; });
    renderBadgeNotifList();
    updateBadgeBellUI(res.unreadNotificationCount);
  } catch { /* the list stays as it is; the button works again */ }
  btn.disabled = false;
});

function findNotif(type, id) {
  return badgeNotifCache && badgeNotifCache.find((n) => n.type === type && n.id === id);
}

// Clicking a badge notification (read or not) reopens its congrats modal
// in place; clicking a chat one jumps straight to that match, where the
// message actually lives — there's no equivalent standalone view for it
// to reopen. Either way, only an unread one also marks itself read and
// drops the bell's count first.
document.addEventListener('click', async (e) => {
  const item = e.target.closest('.badge-notif-item');
  if (!item || !badgeNotifCache) return;
  const type = item.dataset.notifType;
  const id = Number(item.dataset.notifId);
  const notif = findNotif(type, id);
  if (!notif) return;
  if (badgeNotifPanelEl) badgeNotifPanelEl.hidden = true;
  if (notif.type === 'BADGE') openBadgeCongratsModal(notif);
  if (notif.type === 'BADGE_REMINDER') openBadgeReminderModal(notif);
  if (!notif.seen) {
    notif.seen = true;
    item.classList.remove('unread');
    const dot = item.querySelector('.badge-notif-dot');
    if (dot) dot.remove();
    try {
      const urlType = notif.type === 'BADGE' ? 'badge'
        : notif.type === 'CHAT_MESSAGE' ? 'chat'
        : notif.type === 'PLAY_REQUEST' ? 'play_request'
        : notif.type === 'RANKING' ? 'ranking'
        : notif.type === 'BADGE_REMINDER' ? 'badge_reminder'
        : notif.type === 'PHOTO' ? 'photo'
        : notif.type === 'COMMENT' ? 'comment'
        : notif.type === 'MENTION' ? 'mention'
        : notif.type === 'POST' ? 'post'
        : notif.type === 'REACTION' ? 'reaction'
        : notif.type === 'REGISTRATION' ? 'registration'
        : 'proposal';
      const res = await api(`/player/notifications/${urlType}/${id}/read`, { method: 'POST' });
      updateBadgeBellUI(res.unreadNotificationCount);
    } catch { /* worst case the bubble count is stale until the next page load */ }
  }
  if (notif.type === 'CHAT_MESSAGE') window.location.href = siteUrl(`/match/${notif.chat.matchToken}`);
  if (notif.type === 'PROPOSAL') window.location.href = siteUrl(`/match/${notif.proposal.matchToken}`);
  if (notif.type === 'PHOTO') window.location.href = siteUrl(`/match/${notif.photo.matchToken}`);
  if (notif.type === 'COMMENT') window.location.href = siteUrl(`/community/${encodeURIComponent(notif.comment.orgSlug)}`);
  if (notif.type === 'MENTION') window.location.href = siteUrl(`/community/${encodeURIComponent(notif.comment.orgSlug)}`);
  if (notif.type === 'POST') window.location.href = siteUrl(`/community/${encodeURIComponent(notif.post.orgSlug)}`);
  if (notif.type === 'REACTION') window.location.href = siteUrl(`/community/${encodeURIComponent(notif.reaction.orgSlug)}`);
  if (notif.type === 'REGISTRATION') window.location.href = siteUrl(`/community-tournament/${notif.registration.seasonId}`); // the manage page of the event (its Registrácie tab)
  if (notif.type === 'PLAY_REQUEST') window.location.href = siteUrl('/looking-to-play');
  if (notif.type === 'RANKING') window.location.href = siteUrl('/rankings');
});

refreshPlayerAuth();
