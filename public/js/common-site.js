// Part of common.js (loaded after common-player.js): web push, the backend tabs, the install prompt, the brand, accessibility and the other things every page starts at load.



// Registered on every real page but not inside the embed widget — an iframe
// embedded on someone else's site has no business becoming its own
// installable app.
if ('serviceWorker' in navigator && !document.body.classList.contains('embed')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal — installability just won't work */ });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Subscribes this browser to push notifications for one match/type —
// mirrors the email-based /notify-me flow. Throws a user-facing message on
// any failure (unsupported browser, permission denied, no VAPID key
// configured server-side, etc).
async function subscribeToPush(matchToken, type) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error("This browser doesn't support push notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }
  const { publicKey } = await api('/push/vapid-public-key');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api(`/matches/${matchToken}/push-subscribe`, { method: 'POST', body: { subscription: subscription.toJSON(), type } });
}

// ---- automatic push of the bell and the messages, for this device ----
// Once the phone allows notifications for the site, a player who logs in here gets the device linked automatically (no button); every bell
// notification and every new message then arrives as a push (src/playerPush.js). A phone that has not been asked yet gets one friendly question
// after the login (again after a week if it was waved away); the bell panel and the Messages page keep the button. A player who turned the push
// off on a device ("Vypnúť") is not linked there again, and logging out unlinks the device, so it never stays with somebody else on a shared phone.
const PUSH_PLAYER_KEY = 'blta-push-player';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const rememberedPushPlayer = () => { try { return localStorage.getItem(PUSH_PLAYER_KEY); } catch { return null; } };
const rememberPushPlayer = (id) => { try { if (id) localStorage.setItem(PUSH_PLAYER_KEY, String(id)); else localStorage.removeItem(PUSH_PLAYER_KEY); } catch { /* private mode */ } };
const PUSH_ASK_DAYS = 7; // a phone that waved the question away is asked again after this many days
const pushStore = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch { /* private mode */ } return null; };
const pushOptedOut = (id) => pushStore(`blta-push-off-${id}`) === '1';
const pushAskedRecently = (id) => Date.now() - (Number(pushStore(`blta-push-asked-${id}`)) || 0) < PUSH_ASK_DAYS * 86400000;

async function devicePushSubscription() {
  if (!pushSupported()) return null;
  try {
    // `ready` never settles when no service worker is registered (e.g. a page opened inside a frame): do not hang a logout on it
    const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
    return registration ? await registration.pushManager.getSubscription() : null;
  } catch { return null; }
}

async function enablePlayerPush() {
  if (!pushSupported()) throw new Error(t('notif.pushUnsupported'));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('notif.pushDenied'));
  pushStore(`blta-push-off-${currentPlayerId}`, null);
  await linkDevicePush();
}

// links this device to the logged-in player (the browser's permission is already given): the subscription of the browser is made if there is none
async function linkDevicePush() {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await api('/push/vapid-public-key');
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await api('/player/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON(), lang: currentLang } });
  rememberPushPlayer(currentPlayerId);
}

// stops the pushes to this device on the server (the browser's own subscription stays: the match start/finish push uses it too)
async function dropDevicePush() {
  const sub = await devicePushSubscription();
  if (!sub) return;
  try { await api('/player/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch { /* ignore */ }
}

// called after every login check and every login: a phone that already allows notifications is linked to the player (and the language kept up to
// date) without asking; a phone that has not been asked yet gets the question once in a while
async function syncPlayerPush() {
  if (!playerAuthed || !currentPlayerId || !pushSupported() || document.body.classList.contains('embed')) return;
  const id = String(currentPlayerId);
  if (Notification.permission === 'denied' || pushOptedOut(id)) return;
  if (Notification.permission === 'granted') {
    try { await linkDevicePush(); } catch { /* not available (no keys on the server) or no service worker: nothing to link */ }
    return;
  }
  if (pushAskedRecently(id) || pushAskShown) return;
  try {
    const sub = await devicePushSubscription();
    const status = await api(`/player/push/status?endpoint=${encodeURIComponent(sub ? sub.endpoint : '')}`);
    if (!status.available || status.subscribed) return;
  } catch { return; }
  // not over a window that is open (the login, the code to create): try again a few times, then wait for the next page
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!playerAuthed || String(currentPlayerId) !== id) return;
    if (![...document.querySelectorAll('.modal-backdrop')].some((m) => getComputedStyle(m).display !== 'none')) { askPlayerPush(id); return; }
  }
}
window.addEventListener('blta:auth-changed', () => { syncPlayerPush(); });

let pushAskShown = false;
// the question after a login: one tap on the button, then the phone's own "Allow"
function askPlayerPush(id) {
  if (pushAskShown) return;
  pushAskShown = true;
  pushStore(`blta-push-asked-${id}`, Date.now());
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:380px">
      <button type="button" class="close" aria-label="Close">&times;</button>
      <h3 style="margin-top:0">${escapeHtml(t('notif.askTitle'))}</h3>
      <p style="color:var(--ink);font-size:14px;line-height:1.5">${escapeHtml(t('notif.askBody'))}</p>
      <button type="button" class="btn btn-primary btn-block" id="push-ask-yes">${escapeHtml(t('notif.pushOn'))}</button>
      <button type="button" class="btn btn-outline btn-block" id="push-ask-no" style="margin-top:8px">${escapeHtml(t('notif.askLater'))}</button>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.close').addEventListener('click', close);
  modal.querySelector('#push-ask-no').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#push-ask-yes').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await enablePlayerPush(); } catch (err) { window.alert(err.message || t('notif.pushError')); }
    close();
  });
}

// the row of the bell panel (or of the Messages page: row given, with data-hide-on so it disappears once the push is on): turn the push on or off, or
// say why it cannot be turned on here
async function refreshPushRow(target) {
  const row = target || document.getElementById('badge-notif-push');
  if (!row) return;
  row.hidden = true;
  row.innerHTML = '';
  row.classList.remove('prominent');
  if (!playerAuthed || !currentPlayerId) return;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.navigator.standalone;
  if (!pushSupported()) {
    if (ios) { row.textContent = t('notif.pushIosHint'); row.classList.add('prominent'); row.hidden = false; }
    return;
  }
  let status;
  try {
    const sub = await devicePushSubscription();
    status = await api(`/player/push/status?endpoint=${encodeURIComponent(sub ? sub.endpoint : '')}`);
  } catch { return; }
  if (!status.available) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary badge-notif-push-btn';
  if (Notification.permission === 'denied' && !status.subscribed) {
    row.textContent = t('notif.pushBlocked');
    row.classList.add('prominent');
  } else if (status.subscribed) {
    if (row.dataset.hideOn) return; // (hidden: nothing to ask for any more)
    row.textContent = `${t('notif.pushOnLabel')} `;
    button.classList.replace('btn-primary', 'btn-outline');
    button.textContent = t('notif.pushOff');
    button.onclick = async () => { await dropDevicePush(); rememberPushPlayer(null); pushStore(`blta-push-off-${currentPlayerId}`, 1); refreshPushRow(row); };
    row.appendChild(button);
  } else {
    // not on yet: a bright box at the top of the panel (at the bottom it was scrolled out of sight), saying that it covers the messages too
    row.classList.add('prominent');
    row.textContent = t('notif.pushOnHint');
    button.textContent = t('notif.pushOn');
    button.onclick = async () => {
      button.disabled = true;
      try { await enablePlayerPush(); } catch (err) { window.alert(err.message || t('notif.pushError')); }
      refreshPushRow(row);
    };
    row.appendChild(button);
  }
  row.hidden = false;
}

// Reveals the backend section-nav tabs (Overview/Menu/Badges/Players/Login
// History — see .admin-tabs in admin.html/badges-admin.html/header-admin.html/
// login-history.html) only for a logged-in admin — hidden by default in the
// HTML so it never flashes visible for everyone else while this check is in
// flight. A plain visitor just sees that page's own content (or, on admin.html,
// the login form) with no section nav at all.
if (!document.body.classList.contains('embed')) {
  checkAdmin().then(async (isAdminUser) => {
    if (!isAdminUser) return;
    await setUpAdminTabs();
    document.querySelectorAll('.admin-tabs').forEach((el) => { el.style.display = ''; });
  });
}

// The pages of the backend tell the server they are the backend (X-Backend: 1): only then does an admin work on "his" city (the one picked in
// the "Working on" bar, or his own); on a public page every list shows the city of the address, an admin included.
if (/(^|\/)(admin|[a-z-]+-admin|login-history)\/?$/.test(location.pathname)) {
  const plainFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/\/api\//.test(url)) return plainFetch.call(this, input, init);
    const headers = new Headers((init && init.headers) || (input && input.headers) || {});
    headers.set('X-Backend', '1');
    return plainFetch.call(this, input, { ...(init || {}), headers });
  };
}

// The backend is for two kinds of admin. The super admin sees every tab, gets the Admins tab and a picker of the city he works on; the admin of
// a city sees only the tabs of his city (the settings of the whole site are closed to him on the server too, see src/cityScope.js).
const SUPER_ONLY_TABS = ['/badges-admin', '/leagues-admin', '/admins-admin', '/faq-admin', '/tracking-admin', '/reservations-admin', '/changelog-admin', '/login-history'];
let adminSessionInfo = null;
// A link of the Backend to a PUBLIC page (data-public, the href is the plain path: /tournament/slug) has to open the site of the city the admin
// works on: the Backend may be open on blta.sk while the city is Košice, whose pages are at slta.sk/kosice. The address is put on the link
// just before it is used (hover, focus, touch, click, right click), so lists drawn at any time are covered and the status bar shows the true one.
function fixPublicLink(e) {
  const a = e.target && e.target.closest ? e.target.closest('a[data-public]') : null;
  const base = adminSessionInfo && adminSessionInfo.acting && adminSessionInfo.acting.publicBase;
  if (!a || !base) return;
  if (!a.dataset.publicPath) a.dataset.publicPath = a.getAttribute('href') || '';
  if (a.dataset.publicPath.startsWith('/')) {
    // the address of the page in the language in use (/season/x is /sezona/x: the code address alone is a 404), then the site of the city
    const L = window.BLTA_LOCALIZE;
    let path = a.dataset.publicPath;
    try { path = (L && L.toPublic(path, typeof currentLang !== 'undefined' ? currentLang : 'sk')) || path; } catch { /* keep the plain path */ }
    const next = base + path;
    if (a.getAttribute('href') !== next) a.setAttribute('href', next);
  }
}
['pointerover', 'pointerdown', 'focusin', 'click', 'auxclick', 'contextmenu'].forEach((type) => document.addEventListener(type, fixPublicLink, true));
// At slta.sk/<city>/… the links of the tab bar carry the prefix of the city (/kosice/badges-admin): compared without it, so the tabs a city admin
// may not use are hidden there too, and no tab is added twice.
const tabPath = (a) => {
  const href = a.getAttribute('href') || '';
  const base = window.CITY_BASE || '';
  return base && href.startsWith(`${base}/`) ? href.slice(base.length) : href;
};
const tabLink = (bar, path) => [...bar.querySelectorAll('a')].find((a) => tabPath(a) === path) || null;
async function setUpAdminTabs() {
  const bars = document.querySelectorAll('.admin-tabs');
  if (!bars.length) return;
  try { adminSessionInfo = await api('/admin/session'); } catch { return; }
  const info = adminSessionInfo;
  // the super admin approves new clubs: the Communities tab says how many wait
  let waitingClubs = 0;
  if (info.role === 'SUPER') {
    try { waitingClubs = (await api('/communities/pending-count')).count || 0; } catch { /* the tab just has no number */ }
  }
  bars.forEach((bar) => {
    if (waitingClubs > 0) {
      const link = tabLink(bar, '/communities-admin');
      if (link && !link.querySelector('.tab-count')) link.insertAdjacentHTML('beforeend', ` <span class="tab-count">${waitingClubs}</span>`);
    }
    if (info.role === 'CITY') {
      bar.querySelectorAll('a.tab').forEach((a) => { if (SUPER_ONLY_TABS.includes(tabPath(a))) a.style.display = 'none'; });
    }
    // the window of the home page is written by every admin, for the city he works on
    if (!tabLink(bar, '/about-admin')) {
      const rules = tabLink(bar, '/rules-admin') || tabLink(bar, '/seo-admin');
      const link = document.createElement('a');
      link.href = '/about-admin';
      link.className = `tab${location.pathname.endsWith('/about-admin') ? ' active' : ''}`;
      link.textContent = 'Info';
      if (rules) rules.after(link); else bar.appendChild(link);
    }
    // the footer of the public pages is written by every admin, for the city he works on
    if (!tabLink(bar, '/footer-admin')) {
      const after = tabLink(bar, '/about-admin') || tabLink(bar, '/rules-admin');
      const link = document.createElement('a');
      link.href = '/footer-admin';
      link.className = `tab${location.pathname.endsWith('/footer-admin') ? ' active' : ''}`;
      link.textContent = 'Footer';
      if (after) after.after(link); else bar.appendChild(link);
    }
    // the pop-ups that ask the players to register for the next season or tournament
    if (!tabLink(bar, '/popups-admin')) {
      const after = tabLink(bar, '/footer-admin') || tabLink(bar, '/about-admin') || tabLink(bar, '/rules-admin');
      const link = document.createElement('a');
      link.href = '/popups-admin';
      link.className = `tab${location.pathname.endsWith('/popups-admin') ? ' active' : ''}`;
      link.textContent = 'Popups';
      if (after) after.after(link); else bar.appendChild(link);
    }
    // the sponsors and partners of a city (shown as a "Partners" strip on its pages)
    if (!tabLink(bar, '/sponsors-admin')) {
      const after = tabLink(bar, '/media-admin') || tabLink(bar, '/carousel-admin');
      const link = document.createElement('a');
      link.href = '/sponsors-admin';
      link.className = `tab${location.pathname.endsWith('/sponsors-admin') ? ' active' : ''}`;
      link.textContent = 'Sponsors';
      if (after) after.after(link); else bar.appendChild(link);
    }
    if (!tabLink(bar, '/media-admin')) {
      const after = tabLink(bar, '/about-admin') || tabLink(bar, '/rules-admin');
      const link = document.createElement('a');
      link.href = '/media-admin';
      link.className = `tab${location.pathname.endsWith('/media-admin') ? ' active' : ''}`;
      link.textContent = 'Media';
      if (after) after.after(link); else bar.appendChild(link);
    }
    // the questions and answers of slta.sk belong to the whole site
    if (info.role === 'SUPER' && !tabLink(bar, '/faq-admin')) {
      const after = tabLink(bar, '/media-admin') || tabLink(bar, '/about-admin');
      const link = document.createElement('a');
      link.href = '/faq-admin';
      link.className = `tab${location.pathname.endsWith('/faq-admin') ? ' active' : ''}`;
      link.textContent = 'Q&A';
      if (after) after.after(link); else bar.appendChild(link);
    }
    // the Tag Manager of blta.sk and slta.sk belongs to the whole site too
    if (info.role === 'SUPER' && !tabLink(bar, '/tracking-admin')) {
      const after = tabLink(bar, '/faq-admin') || tabLink(bar, '/media-admin');
      const link = document.createElement('a');
      link.href = '/tracking-admin';
      link.className = `tab${location.pathname.endsWith('/tracking-admin') ? ' active' : ''}`;
      link.textContent = 'Tracking';
      if (after) after.after(link); else bar.appendChild(link);
    }
    if (info.role === 'SUPER' && !tabLink(bar, '/admins-admin')) {
      const cities = tabLink(bar, '/leagues-admin');
      const link = document.createElement('a');
      link.href = '/admins-admin';
      link.className = `tab${location.pathname.endsWith('/admins-admin') ? ' active' : ''}`;
      link.textContent = 'Admins';
      if (cities) cities.after(link); else bar.appendChild(link);
    }
  });
  const first = bars[0];
  if (document.querySelector('.admin-city-bar') || !info.acting) return;
  const strip = document.createElement('div');
  strip.className = 'admin-city-bar';
  if (info.role === 'SUPER') {
    strip.innerHTML = `<span>Super admin · working on</span><select aria-label="City you work on">${info.cities.map((c) => `<option value="${c.id}"${c.id === info.acting.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select><small>Lists and new things in the backend belong to this city.</small>`;
    strip.querySelector('select').addEventListener('change', async (e) => {
      try {
        await api('/admin/acting-city', { method: 'POST', body: { leagueId: Number(e.target.value) } });
        location.reload();
      } catch (err) { toast(err.message); }
    });
  } else {
    strip.innerHTML = `<span>City admin</span><strong>${escapeHtml(info.acting.name)}</strong><small>${escapeHtml(info.name || '')}</small>`;
  }
  first.before(strip);
}

// "Install app" — a nav-menu button plus an auto-popping bottom banner on
// mobile, both driving the same install action, which does two different
// things depending on the platform (no single API covers both):
// Android/Chrome supports a real one-tap install via beforeinstallprompt;
// iOS Safari has no install API at all (Apple doesn't expose one), so the
// only thing a website can do there is show the manual Share -> Add to
// Home Screen steps. The nav button is the permanent, always-findable
// entry point; the banner is what actually surfaces it to someone who'd
// otherwise never open the mobile menu to notice it's there — it shows
// itself once, and stays dismissed (see INSTALL_DISMISS_KEY) once someone
// closes it or installs, so it never turns into a nag.
(function initInstallPrompt() {
  if (document.body.classList.contains('embed')) return;
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return; // already installed — nothing to offer

  // the app that is offered is the one of the page: on a city under the national address (slta.sk/kosice) it is "SLTA Košice" with the SLTA icon
  // (its own manifest, see cityManifest in server.js), not BLTA. Every app remembers "installed" and "not now" for itself (slta.sk is one origin for
  // the national app and all the cities, so one shared memory would keep a player who installed one from being offered the other).
  const cityApp = window.CITY && !window.CITY.first;
  const appName = cityApp ? (window.CITY.brand || window.CITY.name) : 'BLTA';
  const appIcon = cityApp ? '/img/slta/favicon-64.png' : '/icon-64.png';
  const named = (key) => t(key).replace(/BLTA/g, appName);
  const INSTALL_DISMISS_KEY = `blta_install_banner_dismissed_until${cityApp ? window.CITY_BASE : ''}`;
  const INSTALL_DONE_KEY = `blta_app_installed${cityApp ? window.CITY_BASE : ''}`;
  const DISMISS_DAYS = 30;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // A regular (non-standalone) browser tab can't tell on its own that this
  // browser already has the app installed — display-mode only reflects
  // *this* tab. INSTALL_DONE_KEY, set once by the appinstalled handler
  // below, is what keeps the banner from reoffering an install that
  // already happened the next time this same browser visits in a normal
  // tab (e.g. a search-result link) instead of the installed app.
  let alreadyInstalled = false;
  try { alreadyInstalled = localStorage.getItem(INSTALL_DONE_KEY) === '1'; } catch { /* ignore */ }
  if (alreadyInstalled) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'install-app-btn';
  btn.textContent = t('install.navBtn');
  btn.style.display = 'none';
  navLinks.appendChild(btn);

  let showIosModal = () => {};
  if (isIOS) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'install-ios-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal" style="max-width:340px;text-align:center">
        <button type="button" class="close" data-close="install-ios-modal" aria-label="Close">&times;</button>
        <h3 style="margin-top:0">${escapeHtml(named('install.iosTitle'))}</h3>
        <p style="color:var(--gray);font-size:14px;text-align:left">
          1. ${t('install.iosStep1')}<br><br>
          2. ${t('install.iosStep2')}<br><br>
          3. ${t('install.iosStep3')}
        </p>
      </div>
    `;
    document.body.appendChild(modal);
    // The generic [data-close]/.modal-backdrop listeners above already ran
    // by the time this modal exists, so it needs its own close wiring.
    modal.querySelector('[data-close]').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    showIosModal = () => { modal.style.display = 'flex'; };
    btn.style.display = '';
    btn.addEventListener('click', showIosModal);
  }

  let deferredPrompt = null;
  let triggerAndroidInstall = () => {};
  if (!isIOS) {
    triggerAndroidInstall = async () => {
      if (!deferredPrompt) return;
      const prompt = deferredPrompt;
      deferredPrompt = null;
      prompt.prompt();
      await prompt.userChoice;
    };
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btn.style.display = '';
      maybeShowBanner();
    });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await triggerAndroidInstall();
      btn.style.display = 'none';
      btn.disabled = false;
    });
    window.addEventListener('appinstalled', () => {
      btn.style.display = 'none';
      hideBanner();
      try { localStorage.setItem(INSTALL_DONE_KEY, '1'); } catch { /* ignore */ }
    });
  }

  // The banner itself — a bottom sheet that shows once, unprompted, so
  // someone who'd never think to open the mobile nav menu still sees the
  // option. Desktop gets nothing here (see the min-width guard in CSS) —
  // the nav button alone covers that case, same as before this existed.
  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', named('install.bannerTitle'));
  banner.innerHTML = `
    <div class="install-banner-row">
      <img src="${appIcon}" alt="" class="install-banner-icon">
      <strong class="install-banner-title">${escapeHtml(named('install.bannerTitle'))}</strong>
      <button type="button" class="install-banner-close" data-action="dismiss" aria-label="${t('install.notNow')}">&times;</button>
    </div>
    <p class="install-banner-body">${t('install.bannerBody')}</p>
    <button type="button" class="btn btn-sm btn-primary btn-block" data-action="install">${t('install.installBtn')}</button>
  `;
  document.body.appendChild(banner);

  function hideBanner() { banner.classList.remove('show'); }
  function dismissBanner() {
    hideBanner();
    try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)); } catch { /* ignore */ }
  }
  banner.querySelector('[data-action="dismiss"]').addEventListener('click', dismissBanner);
  banner.querySelector('[data-action="install"]').addEventListener('click', async () => {
    if (isIOS) { showIosModal(); hideBanner(); return; }
    await triggerAndroidInstall();
    hideBanner();
  });

  // the club view can start after the banner was due (the club page knows its club only once it has loaded)
  window.addEventListener('blta:club-context', () => { if (getClubContext()) hideBanner(); });

  function maybeShowBanner() {
    if (!window.matchMedia('(max-width: 680px)').matches) return; // mobile only
    if (getClubContext()) return; // a club has its own button (a shortcut on the home screen), not the general install
    let dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(INSTALL_DISMISS_KEY)) || 0; } catch { /* ignore */ }
    if (Date.now() < dismissedUntil) return;
    banner.classList.add('show');
  }

  // iOS never fires beforeinstallprompt at all, so it's the only signal
  // there ever will be to wait on — show after a short delay instead so
  // the banner doesn't appear mid-page-load, before anyone's had a chance
  // to see what they landed on. Android waits for beforeinstallprompt
  // itself (see the listener above) since without it there'd be nothing
  // for the banner's Install button to actually do.
  if (isIOS) setTimeout(maybeShowBanner, 1500);
})();

// A logged-in player sees their own name in green in the rankings, the league tables and the home page tables.
// Done here once for every page: names in those lists are links to /player/<slug>, so the one that points at the
// logged-in player's own profile gets the class "is-me" (re-applied whenever a page redraws its lists or the login changes).
const MY_NAME_SELECTOR = '.rank-name, .grp-name, .home-t-row .nm';
function highlightMyName() {
  const key = playerAuthed ? (currentPlayerSlug || currentPlayerId) : null;
  const mine = key ? `/player/${key}` : null;
  document.querySelectorAll(MY_NAME_SELECTOR).forEach((el) => {
    let href = el.getAttribute('href');
    if (href) { try { href = decodeURIComponent(href); } catch { /* keep as is */ } }
    el.classList.toggle('is-me', !!mine && (href === mine || href === siteUrl(mine)));
  });
}
(function watchMyName() {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; highlightMyName(); });
  };
  window.addEventListener('blta:auth-changed', schedule);
  if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();

// "CourtIQ" is always written as the wordmark court|IQ — "court" lowercase, "IQ" capitals, both the same size (see .ciq in style.css). Done here once for every
// page: every "CourtIQ" in the visible text (translations, labels, buttons, anything a page draws later) is wrapped; titles,
// tooltips and form fields keep the plain word.
(function brandCourtIQ() {
  const FIND = /court\s?iq/i;
  const SPLIT = /court\s?iq/gi;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'SELECT', 'TITLE', 'NOSCRIPT', 'CODE', 'PRE']);

  function wrapText(node) {
    const p = node.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('.ciq, [contenteditable="true"]')) return;
    const text = node.nodeValue;
    if (!FIND.test(text)) return;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(SPLIT, (m, at) => {
      if (at > last) frag.appendChild(document.createTextNode(text.slice(last, at)));
      const mark = document.createElement('span');
      mark.className = 'ciq';
      mark.setAttribute('role', 'text');
      mark.setAttribute('aria-label', 'CourtIQ');
      mark.innerHTML = '<span class="ciq-c" aria-hidden="true">court</span><span class="ciq-iq" aria-hidden="true">IQ</span>';
      frag.appendChild(mark);
      last = at + m.length;
      return m;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    p.replaceChild(frag, node);
  }

  function wrapIn(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { wrapText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.tagName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (FIND.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    found.forEach(wrapText);
  }

  function start() {
    wrapIn(document.body);
    let queue = new Set();
    let queued = false;
    new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === 'characterData') queue.add(m.target);
        else m.addedNodes.forEach((n) => queue.add(n));
      });
      if (queued) return;
      queued = true;
      setTimeout(() => { // a timer, not requestAnimationFrame: that stops in a background tab
        queued = false;
        const nodes = [...queue];
        queue = new Set();
        nodes.forEach((n) => { if (n.isConnected) wrapIn(n); });
      }, 0);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// On the page of a city under the national address (slta.sk/kosice, see public/js/localize.js) the brand is the city's: SLTA Košice, not BLTA.
// The credit line at the bottom of the match list and the courts page carries the name of the league: the English pages get the English name of it.
(function creditLine() {
  const fix = () => {
    if (typeof currentLang === 'undefined' || currentLang !== 'en') return;
    document.querySelectorAll('footer.credit').forEach((f) => {
      const n = [...f.childNodes].find((x) => x.nodeType === 3 && x.textContent.includes('Bratislavská Liga Tenisových Amatérov'));
      if (n) n.textContent = n.textContent.replace('Bratislavská Liga Tenisových Amatérov', 'Bratislava Amateur Tennis League');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fix); else fix();
})();

(function cityBrand() {
  const city = window.CITY;
  if (!city || document.body.classList.contains('embed')) return;
  const apply = () => {
    if (city.first) {
      // the first city (Bratislava, BLTA) keeps its own brand
      document.querySelectorAll('.brand-text small').forEach((el) => { el.textContent = city.brand; });
      document.querySelectorAll('.brand-logo').forEach((el) => { el.style.display = 'none'; });
    } else {
      // every other city: the SLTA logo of the national page, and the name of the city after it
      document.querySelectorAll('.brand').forEach((el) => {
        el.innerHTML = `<img class="brand-logo" src="/img/slta-logo.png" alt="SLTA" width="500" height="141"><span class="brand-city">${escapeHtml(city.name)}</span>`;
      });
    }
    document.querySelectorAll('.site-footer-inner > span').forEach((el) => { el.textContent = city.brand; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();

// In the club view the logo of the header is the logo of the club (a club with no logo has none: the header's logo place stays empty) and it leads to the club
// page; the footer is hidden by CSS (body.club-view). Placed after cityBrand above: that one writes the logo of the city into the same place when the page is ready.
(function initClubBrand() {
  const brand = document.querySelector('.brand');
  if (!brand || document.body.classList.contains('embed')) return;
  const ownHref = brand.getAttribute('href');
  const apply = () => {
    brand.querySelectorAll('.club-brand-logo').forEach((el) => el.remove());
    if (!clubViewShown()) { brand.setAttribute('href', ownHref); return; }
    const ctx = getClubContext();
    // only a picture the server itself stored (the same rule as the cover of the club page)
    if (/^\/community-images\/[\w.-]+$/.test(ctx.logoUrl || '')) {
      const img = document.createElement('img');
      img.className = 'club-brand-logo';
      img.src = ctx.logoUrl;
      img.alt = ctx.orgName;
      brand.prepend(img);
    }
    brand.setAttribute('href', siteUrl(ctx.path));
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('load', apply);
  window.addEventListener('blta:club-context', apply);
})();

// Keyboard and screen-reader help that every page gets, whatever its script builds:
//  - a "Skip to content" link, the first thing Tab reaches, and the page's content box marked as the main landmark;
//  - every dialog (a .modal-backdrop, written in a page file or built by a script) is announced as a dialog with its heading as its name; while it is open
//    Tab stays inside it and Escape presses its close button; when it closes the focus goes back to what opened it.
(function initAccessibility() {
  const mountSkipLink = () => {
    if (document.querySelector('.skip-link')) return;
    const main = document.querySelector('main, [role="main"]') || [...document.querySelectorAll('.container')].find((c) => !c.closest('.topbar, .modal-backdrop'));
    if (!main) return;
    if (main.tagName !== 'MAIN') main.setAttribute('role', 'main');
    if (!main.id) main.id = 'main-content';
    main.tabIndex = -1;
    const link = document.createElement('a');
    link.className = 'skip-link';
    link.href = '#' + main.id;
    link.textContent = t('a11y.skip');
    // no jump to the address #main-content: some pages read the part after # (a season opens its tab from it)
    link.addEventListener('click', (e) => { e.preventDefault(); main.focus(); main.scrollIntoView(); });
    document.body.insertBefore(link, document.body.firstChild);
  };

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const shown = (el) => el.isConnected && getComputedStyle(el).display !== 'none';
  const boxOf = (backdrop) => backdrop.firstElementChild;
  const focusables = (box) => [...box.querySelectorAll(FOCUSABLE)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const openDialogs = () => [...document.querySelectorAll('.modal-backdrop')].filter(shown);
  const wasOpen = new WeakSet();
  const openers = new WeakMap();

  const describe = (box) => {
    if (!box.getAttribute('role')) box.setAttribute('role', 'dialog');
    if (!box.getAttribute('aria-modal')) box.setAttribute('aria-modal', 'true');
    if (!box.getAttribute('aria-labelledby') && !box.getAttribute('aria-label')) {
      const heading = box.querySelector('h1, h2, h3, h4, [role="heading"]');
      if (heading && heading.textContent.trim()) {
        if (!heading.id) heading.id = 'dlg-title-' + Math.random().toString(36).slice(2, 8);
        box.setAttribute('aria-labelledby', heading.id);
      }
    }
  };

  const check = (backdrop) => {
    const open = shown(backdrop);
    if (open && !wasOpen.has(backdrop)) {
      wasOpen.add(backdrop);
      const from = document.activeElement;
      if (from && from !== document.body && !backdrop.contains(from)) openers.set(backdrop, from);
      const box = boxOf(backdrop);
      if (!box) return;
      describe(box);
      // the dialog's own script may focus a field; otherwise the focus goes to the dialog itself (a box, so no phone keyboard pops up)
      setTimeout(() => {
        if (!shown(backdrop) || backdrop.contains(document.activeElement)) return;
        box.tabIndex = -1;
        box.focus({ preventScroll: true });
      }, 50);
    } else if (!open && wasOpen.has(backdrop)) {
      wasOpen.delete(backdrop);
      const from = openers.get(backdrop);
      openers.delete(backdrop);
      const active = document.activeElement;
      if (from && from.isConnected && (!active || active === document.body || backdrop.contains(active))) from.focus({ preventScroll: true });
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target.classList && m.target.classList.contains('modal-backdrop')) check(m.target);
        continue;
      }
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.classList.contains('modal-backdrop')) check(n);
        n.querySelectorAll && n.querySelectorAll('.modal-backdrop').forEach(check);
      });
      m.removedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const gone = n.classList.contains('modal-backdrop') ? [n] : [...(n.querySelectorAll ? n.querySelectorAll('.modal-backdrop') : [])];
        gone.forEach((b) => { if (wasOpen.has(b)) check(b); });
      });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' && e.key !== 'Escape') return;
    const dialogs = openDialogs();
    const top = dialogs[dialogs.length - 1];
    const box = top && boxOf(top);
    if (!box) return;
    if (e.key === 'Escape') {
      const close = box.querySelector('.close, .ct-close, [data-close], [aria-label="Close"]');
      if (close) close.click();
      return;
    }
    const list = focusables(box);
    if (!list.length) { e.preventDefault(); box.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (!box.contains(active) || active === box) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });

  const start = () => {
    mountSkipLink();
    document.querySelectorAll('.modal-backdrop').forEach(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // a page that draws its content box late (the season page) gets the link from the first pass above; the box is in the file, so nothing more is needed
})();

// A row of tabs that is wider than the screen scrolls sideways with its scrollbar hidden, so nothing says there is more. Three hints together (phones only):
//  - the edge with more tabs behind it fades out (the class fade-start / fade-end, see .tabs.fade-* in style.css) and the fade goes when the end is reached;
//  - once, when the row first comes into view, it slides left a little and back, so the next tab peeks in (not for people who asked for less motion, and
//    not when they touch it first);
//  - a thin line under the row whose orange part is the visible share of the row and moves as it scrolls (.tabs-progress).
(function initTabFades() {
  const phone = () => window.matchMedia('(max-width: 680px)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // the line under a row; not made where the row sits in a flex or grid box (it would become one more item of it)
  const barOf = (el) => {
    if (el._tabsBar && el._tabsBar.isConnected && el._tabsBar.previousElementSibling === el) return el._tabsBar;
    const parentDisplay = el.parentElement ? getComputedStyle(el.parentElement).display : '';
    if (parentDisplay.includes('flex') || parentDisplay.includes('grid')) return null;
    const bar = document.createElement('div');
    bar.className = 'tabs-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    el.insertAdjacentElement('afterend', bar);
    el._tabsBar = bar;
    return bar;
  };
  let seen = null;
  const nudge = (el) => {
    const room = Math.min(72, el.scrollWidth - el.clientWidth);
    const t0 = performance.now();
    const step = (now) => {
      const p = (now - t0) / 1300;
      if (p >= 1 || el._tabsTouched) { if (!el._tabsTouched) el.scrollLeft = 0; return; }
      el.scrollLeft = Math.sin(p * Math.PI) * room;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const watchForNudge = (el) => {
    if (el._tabsNudge || reduced.matches || !('IntersectionObserver' in window)) return;
    el._tabsNudge = true;
    ['pointerdown', 'touchstart', 'wheel'].forEach((type) => el.addEventListener(type, () => { el._tabsTouched = true; }, { once: true, passive: true }));
    if (!seen) {
      seen = new IntersectionObserver((entries) => entries.forEach((entry) => {
        const row = entry.target;
        if (!entry.isIntersecting || row._tabsTouched || row.scrollLeft > 4) return;
        seen.unobserve(row);
        setTimeout(() => { if (!row._tabsTouched && row.scrollLeft <= 4) nudge(row); }, 450);
      }), { threshold: 0.9 });
    }
    seen.observe(el);
  };
  const update = (el) => {
    const max = el.scrollWidth - el.clientWidth;
    const scrolls = max > 4;
    el.classList.toggle('fade-start', scrolls && el.scrollLeft > 4);
    el.classList.toggle('fade-end', scrolls && el.scrollLeft < max - 4);
    if (scrolls && phone()) {
      const bar = barOf(el);
      if (bar) {
        const share = (el.clientWidth / el.scrollWidth) * 100;
        bar.dataset.on = '1';
        // the line sits 6px under the tabs whatever space the row itself has below it (the two margins add up to 6px), and the space under it stays what it was
        const below = parseFloat(getComputedStyle(el).marginBottom) || 0;
        bar.style.margin = `${6 - below}px 0 ${Math.max(below - 9, 4)}px`;
        bar.firstChild.style.width = `${share}%`;
        bar.firstChild.style.left = `${(el.scrollLeft / max) * (100 - share)}%`;
      }
      watchForNudge(el);
    } else if (el._tabsBar) {
      el._tabsBar.dataset.on = '';
    }
  };
  const updateAll = () => document.querySelectorAll('.tabs').forEach(update);
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; updateAll(); }); };
  document.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('tabs')) update(e.target); }, true);
  window.addEventListener('resize', later);
  window.addEventListener('load', later);
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  later();
})();

// ---------------------------------------------------------------- sponsors
// The "Partners" strip: the logos of the sponsors to show now (/api/sponsors: the whole city; ?seasonId=… one season), each a link to the
// sponsor's site. A click is counted (a beacon, so the page is not slowed down). The element stays hidden when there is nobody to show.
async function loadSponsorStrip(el, query = '') {
  if (!el) return;
  let list;
  try { list = await api(`/sponsors${query}`); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  const item = (s) => {
    const inner = s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.name)}" loading="lazy">` : `<span>${escapeHtml(s.name)}</span>`;
    return s.link
      ? `<a class="sp-item" href="${escapeHtml(s.link)}" target="_blank" rel="sponsored noopener noreferrer" data-sponsor="${s.id}" title="${escapeHtml(s.name)}">${inner}</a>`
      : `<span class="sp-item" title="${escapeHtml(s.name)}">${inner}</span>`;
  };
  el.innerHTML = `<h2 class="sp-title">${escapeHtml(t('sponsors.title'))}</h2><div class="sp-box"><div class="sp-strip">${list.map(item).join('')}</div></div>`;
  el.hidden = false;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-sponsor]');
    if (!a) return;
    try { navigator.sendBeacon(`/api/sponsors/${a.dataset.sponsor}/click`); } catch { /* not counted */ }
  });
  // the arrows (js/sponsor-carousel.js, loaded on demand so no page needs its own <script> for it)
  const box = el.querySelector('.sp-box');
  if (window.initSponsorCarousel) window.initSponsorCarousel(box);
  else {
    const s = document.createElement('script');
    s.src = '/js/sponsor-carousel.js';
    s.onload = () => window.initSponsorCarousel(box);
    document.head.appendChild(s);
  }
}

// ---------------------------------------------------------------- pictures from the media library (admin)
// Wherever an admin is about to pick a picture from the computer (a hero image, a carousel slide, a venue photo, a blog picture, a photo of a
// player …), a window asks where from: the computer (as before) or the library (Backend > Media: the pictures uploaded there and the ones
// that are on the server already). A picture of the library is handed to the very same upload code as a file from the computer, so nothing
// else on any page had to change: the input gets the file and a "change" event.
(function mediaChooser() {
  if (document.body.classList.contains('embed')) return;
  let enabled = false;
  let bypass = false;
  checkAdmin().then((ok) => { enabled = !!ok; });

  const realClick = HTMLInputElement.prototype.click;
  // an input marked data-no-library (the photos of a match: take one or choose one on the phone) never gets the window of the library
  const isPicture = (input) => !!input && input.type === 'file' && /image/i.test(input.accept || '') && !input.dataset.noLibrary;
  const openNative = (input) => { bypass = true; try { realClick.call(input); } finally { bypass = false; } };

  // a picture of the library that the input accepts (accept="image/png,image/jpeg" excludes a WebP one)
  const accepts = (input, mime) => {
    const list = String(input.accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return !list.length || list.some((a) => a === mime || a === 'image/*' || (a.startsWith('.') && mime.endsWith(a.slice(1).replace('jpg', 'jpeg'))));
  };

  async function toFile(item) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error('The picture could not be read');
    const blob = await res.blob();
    return new File([blob], item.name && /\.\w+$/.test(item.name) ? item.name : (item.url.split('/').pop() || 'picture'), { type: blob.type || item.mime });
  }

  async function open(input) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop mc-backdrop';
    wrap.innerHTML = `
      <div class="modal mc-modal" role="dialog" aria-modal="true">
        <button type="button" class="close" data-close aria-label="Close">&times;</button>
        <h3 style="margin-top:0">Choose a picture</h3>
        <div class="mc-top">
          <button type="button" class="btn btn-primary" data-computer>Upload from the computer</button>
          <span class="mc-or">or choose one that is on the server</span>
          <input type="search" class="mc-search" placeholder="Search by name">
        </div>
        <div class="mc-tabs"><button type="button" class="tab active" data-tab="library">Library</button><button type="button" class="tab" data-tab="server">On the server</button><select class="mc-place" aria-label="Kind of picture" style="display:none"></select><a href="/media-admin" class="mc-manage" target="_blank" rel="noopener">Manage the library ↗</a></div>
        <div class="mc-grid"><div class="mc-empty">Loading…</div></div>
        <div class="mc-foot" style="display:${input.multiple ? 'flex' : 'none'}"><span class="mc-count">Nothing chosen</span><button type="button" class="btn btn-primary" data-use disabled>Use the chosen</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    const grid = wrap.querySelector('.mc-grid');
    let tab = 'library';
    let data = { library: [], server: [] };
    const chosen = new Set();
    let place = ''; // the kind of the pictures on the server that is shown ('' = all of them)
    const query = () => wrap.querySelector('.mc-search').value.toLowerCase();
    const items = () => (data[tab] || []).filter((m) => accepts(input, m.mime) && (tab !== 'server' || !place || m.place === place) && (!query() || [m.name, m.label, m.place].join(' ').toLowerCase().includes(query())));
    const drawPlaces = () => {
      const select = wrap.querySelector('.mc-place');
      select.style.display = tab === 'server' ? '' : 'none';
      if (tab !== 'server') return;
      const counts = new Map();
      (data.server || []).filter((m) => accepts(input, m.mime)).forEach((m) => counts.set(m.place, (counts.get(m.place) || 0) + 1));
      select.innerHTML = `<option value="">All kinds (${[...counts.values()].reduce((a, b) => a + b, 0)})</option>${[...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `<option value="${escapeHtml(k)}"${k === place ? ' selected' : ''}>${escapeHtml(k)} (${n})</option>`).join('')}`;
    };
    const draw = () => {
      drawPlaces();
      const list = items();
      grid.innerHTML = list.length ? list.map((m) => `<button type="button" class="mc-item${chosen.has(m.url) ? ' on' : ''}" data-url="${escapeHtml(m.url)}" title="${escapeHtml(m.label ? `${m.label} — ${m.name}` : m.name)}"><img src="${escapeHtml(m.url)}" alt="" loading="lazy"><span>${escapeHtml(m.label || m.name)}</span></button>`).join('')
        : `<div class="mc-empty">${tab === 'library' ? 'The library has no picture of a fitting type yet. Upload some in Backend → Media, or choose one that is on the server.' : 'No picture of a fitting type on the server.'}</div>`;
      const n = chosen.size;
      wrap.querySelector('.mc-count').textContent = n ? `${n} chosen` : 'Nothing chosen';
      wrap.querySelector('[data-use]').disabled = !n;
    };
    const give = async (urls) => {
      try {
        const all = [...data.library, ...data.server];
        const files = await Promise.all(urls.map((u) => toFile(all.find((m) => m.url === u))));
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        input.files = dt.files;
        // a page that can use the address of a library picture as it is (no copy) reads it from here; others just take the file
        if (urls.length === 1) input.dataset.pickedUrl = urls[0]; else delete input.dataset.pickedUrl;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      } catch (err) { toast(err.message); }
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) { close(); return; }
      if (e.target.closest('[data-computer]')) { close(); openNative(input); return; }
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; wrap.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === t)); draw(); return; }
      if (e.target.closest('[data-use]')) { give([...chosen]); return; }
      const it = e.target.closest('.mc-item');
      if (!it) return;
      if (!input.multiple) { give([it.dataset.url]); return; }
      if (chosen.has(it.dataset.url)) chosen.delete(it.dataset.url); else chosen.add(it.dataset.url);
      draw();
    });
    wrap.querySelector('.mc-search').addEventListener('input', draw);
    wrap.querySelector('.mc-place').addEventListener('change', (e) => { place = e.target.value; draw(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    try { data = await api('/media?server=1'); } catch (err) { grid.innerHTML = `<div class="mc-empty">${escapeHtml(err.message)}</div>`; return; }
    // the library first; when it is empty the pictures on the server are the useful ones
    if (!data.library.length && data.server && data.server.length) { tab = 'server'; wrap.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'server')); }
    draw();
  }

  // a click that would open the file window of the computer (a visible input, a label around a hidden one) opens this window first
  document.addEventListener('click', (e) => {
    if (!enabled || bypass) return;
    const label = e.target.closest && e.target.closest('label');
    const input = (e.target.closest && e.target.closest('input[type="file"]')) || (label && label.control && label.control.type === 'file' ? label.control : null);
    if (!isPicture(input) || input.closest('#md-drop, .mc-modal')) return;
    e.preventDefault();
    e.stopPropagation();
    open(input);
  }, true);
  // the same for a file window that the page opens by code (input.click())
  HTMLInputElement.prototype.click = function click() {
    if (enabled && !bypass && isPicture(this) && !this.closest('#md-drop')) { open(this); return; }
    return realClick.apply(this, arguments);
  };
})();
