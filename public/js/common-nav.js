// Part of common.js (loaded after common-cards.js): the menu and the top strip, the club view and the bottom bar, the messages and club badges, the modals' close buttons, the code boxes.



// 'past' (finished), 'now' (running) or 'future' (coming) — by the season's dates, on the day `today` (YYYY-MM-DD). A season without
// dates counts as coming. Used by the home page's timeline and by the pills in the menu.
function seasonState(s, today) {
  if (s.startDate && s.endDate) {
    if (s.endDate < today || s.tournamentEnded) return 'past'; // (tournamentEnded: the playing window of the last day of a tournament is over)
    if (s.startDate > today) return 'future';
    return 'now';
  }
  return 'future';
}

// A menu item that links to a season page (/season/<slug>) is /season/<slug> in the code addresses the menu is stored with.
const NAV_SEASON_LINK = /^\/(?:season|tournament)\/([^/?#]+)/;

// NAV ICONS START
// Every item of the main menu has an icon before its name, on a computer and on a phone, in the top row and in a dropdown: the icon of an address is
// chosen here (by the address, then by what kind of item it is), drawn from the same paths as every other icon of the site (COURT_ICON_PATHS) and put on
// the link as the custom property --nav-ico, which the CSS shows as a mask in the colour of the text. An item nobody has heard of gets a neutral one.
function navIconName(item) {
  if (item.isMyProfile) return 'user';
  const link = String(item.link || '').replace(/\/+$/, '') || '/';
  const byLink = {
    '/': 'home', '/matches': 'ball', '/tables': 'table', '/rankings': 'barChart', '/players': 'users', '/courts': 'pin', '/harmonogram': 'calendar',
    '/vitazi': 'trophy', '/looking-to-play': 'search', '/new-match': 'playCircle', '/communities': 'group', '/messages': 'send', '/propozicie': 'clipboard',
    '/about-league': 'info', '/reservations': 'calendarPlus', '/blog': 'message', '/courtiq': 'trendUp', '#kontakt': 'mail',
  };
  if (byLink[link]) return byLink[link];
  if (/^\/(season|tournament|bracket)\//.test(link)) return 'trophy';
  if ((item.children && item.children.length) || isHeadingLink(item.link)) {
    const name = `${item.labelSk || ''} ${item.labelEn || ''}`;
    if (/liga|league/i.test(name)) return 'trophy';
    if (/viac|more|info/i.test(name)) return 'menu';
  }
  return 'layers';
}

function navIconUrl(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${COURT_ICON_PATHS[name] || COURT_ICON_PATHS.layers}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
// NAV ICONS END

async function renderHeaderNav() {
  const container = document.getElementById('header-dynamic-items');
  if (!container) return;
  let items;
  try {
    items = await api('/header-items');
  } catch {
    return; // leave the placeholder empty rather than break the whole topbar
  }
  // The seasons are only asked for when the menu has an item that links to one: those items get a small pill with the season's state.
  const seasonBySlug = {};
  const hasSeasonLink = (list) => list.some((i) => NAV_SEASON_LINK.test(i.link || '') || (i.children && hasSeasonLink(i.children)));
  let seasonsLoaded = false;
  if (hasSeasonLink(items)) {
    try {
      (await api('/seasons')).forEach((s) => { if (s.slug) seasonBySlug[s.slug] = s; });
      seasonsLoaded = true;
    } catch { /* no pills, the menu itself still works */ }
  }
  // A season or a tournament of another city is not shown (a menu copied from another city can still link to them), and a group (a
  // heading with sub-items) that only held such links goes with them. /seasons lists the seasons of this city only.
  if (seasonsLoaded) {
    const prune = (list) => list.map((i) => ({ ...i, children: i.children ? prune(i.children) : i.children })).filter((i, n) => {
      const link = NAV_SEASON_LINK.exec(i.link || '');
      if (link && !seasonBySlug[decodeURIComponent(link[1])]) return false;
      const had = list[n].children && list[n].children.length;
      return !(had && !i.children.length && isHeadingLink(i.link));
    });
    items = prune(items);
  }
  // the main menu does not draw a Messages item (a city that still has one): it is the icon of the top strip now
  const withoutMessages = (list) => list.filter((i) => i.link !== '/messages').map((i) => ({ ...i, children: i.children ? withoutMessages(i.children) : i.children }));
  items = withoutMessages(items);
  const today = new Date().toISOString().slice(0, 10);
  const seasonPillLabel = { past: t('home.tlPast'), now: t('home.tlNow'), future: t('home.tlFuture') };
  const labelFor = (item) => (currentLang === 'en' && item.labelEn) ? item.labelEn : item.labelSk;
  const isActive = (link) => link === currentCodePath();
  const myProfileEl = document.getElementById('nav-my-profile-link');
  if (myProfileEl) myProfileEl.style.display = ''; // shown again when the club menu gives way to the normal one
  if (myProfileEl) myProfileEl.style.setProperty('--nav-ico', navIconUrl('user'));
  const makeLink = (item) => {
    const a = document.createElement('a');
    const heading = isHeadingLink(item.link);
    a.href = heading ? '#' : (isContactLink(item.link) ? '#kontakt' : item.link);
    a.textContent = labelFor(item);
    if (heading) a.classList.add('nav-heading'); // opens its sub-items on a tap (the click handler below), goes nowhere
    else if (isActive(item.link)) a.className = 'active';
    if (item.highlight) a.classList.add('nav-btn-green'); // a button of its own colour (a switch on the item in /header-admin)
    if (item.outline) a.classList.add('nav-btn-green-outline'); // a green frame and green words (the same place)
    // an item that is only a heading for a dropdown has no page of its own: its icon follows its name
    if (isHeadingLink(item.link) || (item.children && item.children.length)) {
      const name = `${item.labelSk} ${item.labelEn || ''}`;
      a.dataset.navIcon = /liga|league/i.test(name) ? 'trophy' : /viac|more|info/i.test(name) ? 'more' : 'grid';
    }
    // Tagged (not matched later by href, which could be relative/absolute
    // inconsistently) so attachLookingToPlayBadge can find whichever nav
    // item currently points here, however an admin has it labeled or
    // nested — see /header-admin.
    if (item.link === '/looking-to-play') a.dataset.navBadgeTarget = 'looking-to-play';
    const seasonLink = NAV_SEASON_LINK.exec(item.link || '');
    const season = seasonLink ? seasonBySlug[decodeURIComponent(seasonLink[1])] : null;
    if (season) {
      const state = seasonState(season, today);
      a.classList.add('nav-season-link');
      const label = document.createElement('span');
      label.textContent = a.textContent;
      const pill = document.createElement('span');
      pill.className = `nav-season-pill ${state}`;
      pill.textContent = seasonPillLabel[state];
      a.textContent = '';
      a.append(label, pill);
    }
    a.style.setProperty('--nav-ico', navIconUrl(navIconName(item)));
    return a;
  };
  // An item with sub-items becomes a dropdown; a sub-item that has sub-items of its own becomes a dropdown inside it (a
  // fly-out beside the panel on a computer, an indented list on a phone) — three levels at most, see routes/headerItems.js.
  const buildItem = (item, nested) => {
    if (!item.children || !item.children.length) return makeLink(item);
    const wrap = document.createElement('div');
    wrap.className = nested ? 'nav-item-dropdown nav-item-nested' : 'nav-item-dropdown';
    // The label + caret live in their own row (.nav-item-dropdown-toggle)
    // separate from .nav-submenu below — that's what lets the submenu
    // switch from an absolute-positioned popover (desktop) to a plain
    // collapsed block (mobile) via CSS alone, without the toggle row's own
    // layout needing to change between the two.
    const toggle = document.createElement('div');
    toggle.className = 'nav-item-dropdown-toggle';
    toggle.appendChild(makeLink(item));
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'nav-caret';
    caret.setAttribute('aria-label', 'Show more');
    caret.textContent = '▾';
    toggle.appendChild(caret);
    wrap.appendChild(toggle);
    const submenu = document.createElement('div');
    submenu.className = 'nav-submenu';
    item.children.forEach((child) => submenu.appendChild(buildItem(child, true)));
    wrap.appendChild(submenu);
    return wrap;
  };
  const frag = document.createDocumentFragment();
  items.forEach((item) => {
    if (item.isMyProfile) {
      if (myProfileEl) frag.appendChild(myProfileEl);
      return;
    }
    frag.appendChild(buildItem(item, false));
  });
  container.innerHTML = '';
  container.appendChild(frag);
  attachLookingToPlayBadge();
  // a player who has switched to the profile of his club sees the menu of the club (the switcher block below knows it by then, or applies it itself later)
  if (actingOrg) applyClubMenu();
  if (messageUnread) applyMessageBadge();
}
renderHeaderNav();

// Správy / Messages: an icon in the top strip (next to the bell) on every page, with the unread badge on it. It is not an item of the main menu any more.
function mountMessagesLink() {
  const right = document.querySelector('.topbar-right');
  if (!right || document.getElementById('topbar-msg')) return;
  const a = document.createElement('a');
  a.id = 'topbar-msg';
  a.className = 'topbar-msg';
  a.href = '/messages';
  a.title = t('msg.heading');
  a.setAttribute('aria-label', t('msg.heading'));
  a.innerHTML = courtIcon('send');
  right.appendChild(a);
}
mountMessagesLink();

// Komunity a kluby: the profile switcher. A player who runs a community or a club can switch to its profile (the profile pill in the top strip): the pill
// then shows its name and the menu becomes the menu of the club (Domov · Členovia · Udalosti · Profil klubu). Switching changes nothing about
// the player himself; the server decides on every request whether he still runs that club (GET /api/communities/mine, POST /api/communities/act-as).
// Only DOM text is used here: the names of the clubs are written by players.
let actingOrg = null; // the club the player acts as (as GET /api/communities/mine reports it), or null

function applyClubMenu() {
  const container = document.getElementById('header-dynamic-items');
  if (!container || !actingOrg) return;
  const base = `/community/${encodeURIComponent(actingOrg.slug)}`;
  // the "my profile" link of the normal menu lives inside the container: take it out first (hidden while acting), or the menu could not bring it back
  const myProfile = document.getElementById('nav-my-profile-link');
  if (myProfile) {
    if (container.contains(myProfile)) container.after(myProfile);
    myProfile.style.display = 'none';
  }
  container.textContent = '';
  [['com.menuHome', base, 'home'], ['com.menuMembers', `${base}#members`, 'users'], ['com.menuEvents', `${base}#events`, 'calendar'], ['com.menuProfile', `${base}#settings`, 'user']].forEach(([key, href, icon]) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = t(key);
    a.style.setProperty('--nav-ico', navIconUrl(icon)); // an icon before every item, like the normal menu
    container.appendChild(a);
  });
}

async function switchActing(organisation) {
  try {
    await api('/communities/act-as', { method: 'POST', body: { organisationId: organisation ? organisation.id : null } });
  } catch (err) {
    toast(err.message);
    return;
  }
  if (organisation) window.location.href = siteUrl(`/community/${encodeURIComponent(organisation.slug)}`);
  else window.location.reload();
}

// the address of a picture written by a player or an admin (a photo, a logo): only a picture of this site or an https address goes into src, else ''
function safePictureUrl(url) {
  const u = String(url || '');
  if (/^\/(player-photos|community-images|season-heroes|winner-photos|media)\/[\w.\-\/]+$/.test(u)) return u;
  return /^https:\/\/[^\s"'<>\\]+$/.test(u) ? u : '';
}

function clubInitials(name) {
  return String(name || '?').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';
}

let actingRun = 0; // the number of the newest refresh: the session event can fire twice at once, and only the newest run may draw the pill

async function refreshActingOrg() {
  const run = ++actingRun;
  document.querySelectorAll('.profile-pill-wrap').forEach((el) => el.remove());
  document.body.classList.remove('has-profile-pill');
  const wasActing = !!actingOrg;
  actingOrg = null;
  if (!playerAuthed || !currentPlayerId) {
    if (wasActing) renderHeaderNav(); // logged out: the normal menu comes back
    return;
  }
  let mine;
  try {
    mine = await api('/communities/mine');
  } catch {
    if (wasActing && run === actingRun) renderHeaderNav();
    return; // the menu simply has no switcher
  }
  if (run !== actingRun) return; // a newer refresh is on its way (or already drew the pill)
  document.querySelectorAll('.profile-pill-wrap').forEach((el) => el.remove());
  document.body.classList.remove('has-profile-pill');
  actingOrg = mine.acting;
  if (wasActing && !actingOrg) renderHeaderNav(); // left the club or no longer its admin: the normal menu comes back
  const admins = mine.items.filter((o) => o.me && o.me.role === 'ADMIN');

  // The profile pill, first in the top strip: who the player is acting as (himself, or one of his clubs) with a dropdown to switch. Every logged-in player has it,
  // with or without a club. Only DOM text and src of a picture the server itself wrote are used: names are written by players.
  const right = document.querySelector('.topbar-right');
  if (right) {
    const avatar = (organisation) => {
      const av = document.createElement('span');
      av.className = organisation ? 'profile-pill-av club' : 'profile-pill-av';
      const picture = safePictureUrl(organisation ? organisation.logoUrl : currentPlayerPhotoUrl);
      if (picture) {
        const img = document.createElement('img');
        img.src = picture;
        img.alt = '';
        av.appendChild(img);
      } else {
        av.textContent = clubInitials(organisation ? organisation.name : currentPlayerName);
      }
      return av;
    };
    const wrap = document.createElement('div');
    wrap.className = 'profile-pill-wrap';
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = actingOrg ? 'profile-pill club' : 'profile-pill';
    pill.setAttribute('aria-haspopup', 'true');
    pill.setAttribute('aria-expanded', 'false');
    pill.title = actingOrg ? t('com.actingAs', { name: actingOrg.name }) : t('com.switchTitle');
    const label = document.createElement('span');
    label.className = 'profile-pill-name';
    label.textContent = actingOrg ? actingOrg.name : currentPlayerName;
    const caret = document.createElement('span');
    caret.className = 'profile-pill-caret';
    caret.setAttribute('aria-hidden', 'true');
    pill.append(avatar(actingOrg), label, caret);

    const menu = document.createElement('div');
    menu.className = 'auth-menu-panel profile-pill-menu com-switch';
    menu.hidden = true;
    menu.appendChild(buildLangRow());
    const title = document.createElement('div');
    title.className = 'com-switch-title';
    title.textContent = t('com.switchTitle');
    menu.appendChild(title);
    const row = (text, organisation, active) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'auth-menu-item com-switch-item' + (active ? ' on' : '');
      const name = document.createElement('span');
      name.textContent = text;
      a.append(avatar(organisation), name);
      if (active) {
        const mark = document.createElement('span');
        mark.className = 'com-switch-mark';
        mark.textContent = '✓';
        a.appendChild(mark);
      }
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (!active) { switchActing(organisation); return; }
        // the one you are acting as: its own page
        window.location.href = siteUrl(organisation ? '/community/' + encodeURIComponent(organisation.slug) : '/player/' + encodeURIComponent(currentPlayerSlug || currentPlayerId));
      });
      return a;
    };
    menu.appendChild(row(currentPlayerName, null, !actingOrg));
    admins.forEach((o) => menu.appendChild(row(o.name, o, !!actingOrg && actingOrg.id === o.id)));
    const create = document.createElement('a');
    create.href = '/communities';
    create.className = 'auth-menu-item com-switch-item';
    create.textContent = '＋ ' + t('com.create');
    menu.appendChild(create);
    const logout = document.createElement('a');
    logout.href = '#';
    logout.className = 'auth-menu-item com-switch-item pill-logout';
    logout.textContent = t('nav.logout');
    logout.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.player-login-link').click(); });
    menu.appendChild(logout);

    const close = () => { menu.hidden = true; pill.setAttribute('aria-expanded', 'false'); };
    pill.addEventListener('click', () => {
      // (the click goes on to the document, which closes the account menu if it is open: only one dropdown at a time)
      menu.hidden = !menu.hidden;
      pill.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => { if (!menu.hidden && !wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    wrap.append(pill, menu);
    right.insertBefore(wrap, right.firstChild);
    document.body.classList.add('has-profile-pill');
  }

  if (actingOrg) applyClubMenu();
}
window.addEventListener('blta:auth-changed', refreshActingOrg);

// Správy / Messages: the number of unread conversations and waiting requests as a small badge on the "Správy" item of the main menu. It is asked for at
// every page load of a logged-in player and kept current live by the Messages page itself (it sends 'msg:unread'); other pages do not open a live
// connection just for this.
let messageUnread = 0;

function applyMessageBadge() {
  document.querySelectorAll('.nav-msg-badge').forEach((el) => el.remove());
  if (!messageUnread) return;
  const link = document.getElementById('topbar-msg');
  if (!link) return;
  const badge = document.createElement('span');
  badge.className = 'nav-msg-badge';
  badge.textContent = String(messageUnread);
  link.appendChild(badge);
}

async function refreshMessageBadge() {
  messageUnread = 0;
  if (playerAuthed && currentPlayerId) {
    try {
      const counts = await api('/messages/unread');
      messageUnread = (counts.main || 0) + (counts.requests || 0);
    } catch { /* no badge */ }
  }
  applyMessageBadge();
}
window.addEventListener('blta:auth-changed', refreshMessageBadge);
window.addEventListener('msg:unread', (e) => {
  const counts = e.detail || {};
  messageUnread = (counts.main || 0) + (counts.requests || 0);
  applyMessageBadge();
});

// Small orange "N" pill next to whichever nav item links to /looking-to-play
// — one row per player currently posted there (GET /api/availability/count
// counts the open posts, one per player, after pruning expired ones
// server-side — see routes/availability.js). Skipped
// entirely (not just left at 0) when the board is empty, same "don't show
// a badge for nothing" convention the notification bell uses.
async function attachLookingToPlayBadge() {
  const link = document.querySelector('[data-nav-badge-target="looking-to-play"]');
  if (!link) return;
  let count;
  try {
    ({ count } = await api('/availability/count'));
  } catch {
    return;
  }
  if (!count) return;
  const badge = document.createElement('span');
  badge.className = 'nav-item-badge';
  badge.textContent = count;
  link.appendChild(badge);
}

// The caret click toggles .open for touch/keyboard reachability (hover
// alone, via :hover in style.css, already covers a mouse) — delegated on
// document rather than bound per-caret since the caret buttons don't exist
// yet until renderHeaderNav's fetch resolves. Clicking anywhere outside an
// open dropdown closes it, same convention as the auth menu/lang switcher
// below.
document.addEventListener('click', (e) => {
  // a link to #kontakt (the Kontakt menu item) opens the contact window
  const contactLink = e.target.closest('a[href="#kontakt"]');
  if (contactLink) {
    e.preventDefault();
    openContactModal();
    return;
  }
  // a heading (an item without a real link) works like its caret anywhere on it; on its own, with nothing under it, it does nothing
  const heading = e.target.closest('a.nav-heading');
  if (heading) {
    e.preventDefault();
    const own = heading.closest('.nav-item-dropdown');
    const row = heading.parentElement;
    if (own && row && row.classList.contains('nav-item-dropdown-toggle')) {
      e.stopPropagation();
      const wasOpen = own.classList.contains('open');
      document.querySelectorAll('.nav-item-dropdown.open').forEach((d) => { if (d !== own && !d.contains(own)) d.classList.remove('open'); });
      own.classList.toggle('open', !wasOpen);
    }
    return;
  }
  const caret = e.target.closest('.nav-caret');
  if (caret) {
    e.preventDefault();
    e.stopPropagation();
    const dropdown = caret.closest('.nav-item-dropdown');
    const wasOpen = dropdown.classList.contains('open');
    // opening one closes the others, but never the dropdowns it sits inside (a nested one lives in its parent's panel)
    document.querySelectorAll('.nav-item-dropdown.open').forEach((d) => { if (d !== dropdown && !d.contains(dropdown)) d.classList.remove('open'); });
    dropdown.classList.toggle('open', !wasOpen);
    return;
  }
  document.querySelectorAll('.nav-item-dropdown.open').forEach((d) => {
    if (!d.contains(e.target)) d.classList.remove('open');
  });
});

(function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  if (!toggle || !links) return;
  // Resets any expanded sub-item dropdown whenever the off-canvas panel
  // itself closes, so it's always collapsed again the next time it opens —
  // otherwise a dropdown left open from a previous visit would just sit
  // there expanded on the very next rolldown instead of needing its own tap.
  const closeAllDropdowns = () => {
    links.querySelectorAll('.nav-item-dropdown.open').forEach((d) => d.classList.remove('open'));
  };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const nowOpen = links.classList.toggle('open');
    if (!nowOpen) closeAllDropdowns();
  });
  links.addEventListener('click', (e) => {
    // a heading (no real link) only opens its own sub-items, the panel stays open
    if (e.target.tagName === 'A' && !e.target.classList.contains('nav-heading')) {
      links.classList.remove('open');
      closeAllDropdowns();
    }
  });
  document.addEventListener('click', (e) => {
    if (links.classList.contains('open') && !links.contains(e.target) && e.target !== toggle) {
      links.classList.remove('open');
      closeAllDropdowns();
    }
  });
})();

// #lang-switcher stays in .topbar-right at every width (its own order:2,
// lower than .badge-bell-wrap's order:10 in style.css, is what keeps it to
// the left of the notification bell everywhere) — but below 1024px there's
// only room for one pill at a time, so it collapses to just the active
// language; tapping it reveals the other one(s) to switch to instead of a
// real dropdown. Desktop is untouched — every pill always shows there.
(function initLangSwitcherCollapse() {
  const langSwitcher = document.getElementById('lang-switcher');
  if (!langSwitcher) return;
  const mq = window.matchMedia('(max-width: 1024px)');
  function apply(isMobile) {
    langSwitcher.classList.toggle('lang-switcher-collapsible', isMobile);
    if (!isMobile) langSwitcher.classList.remove('expanded');
  }
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));

  // Tapping the (visible, active) pill while collapsed just reveals the
  // rest instead of switching language — .lang-btn's own click handler
  // (initLangSwitcher in i18n.js) already no-ops for the active button
  // regardless, so this only ever adds the reveal, never fights it.
  // Tapping an actually-different language (only reachable once expanded)
  // still goes straight through to that handler and reloads as normal.
  langSwitcher.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-btn');
    if (!btn || !btn.classList.contains('active')) return;
    if (langSwitcher.classList.contains('lang-switcher-collapsible')) {
      langSwitcher.classList.toggle('expanded');
    }
  });
  // Collapses again on a tap elsewhere without picking a language, same
  // spirit as #nav-links' own click-outside-closes handling above.
  document.addEventListener('click', (e) => {
    if (langSwitcher.classList.contains('expanded') && !langSwitcher.contains(e.target)) {
      langSwitcher.classList.remove('expanded');
    }
  });
})();

// The person-icon button next to #lang-switcher — replaces the old
// two-tier "utility strip" (a separate bar above .topbar) entirely.
// #auth-menu-panel holds the exact same #player-login-link/
// #nav-register-link elements every other page already had — their own
// click handlers (openPlayerLoginModal, logout, etc. — see
// updatePlayerNavLinks and the .player-login-link/.nav-register-link
// listeners further down) are untouched, this only adds the show/hide
// toggle around them. Same open/close pattern as the notification bell's
// own panel (toggleBadgeNotifPanel) and #nav-links' own dropdown above.
(function initAuthMenu() {
  const btn = document.getElementById('auth-menu-btn');
  const panel = document.getElementById('auth-menu-panel');
  if (!btn || !panel) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = panel.hidden;
    panel.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
  });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
})();

// Language on phones and tablets: a row at the top of the person-icon dropdown (SK | EN) instead of a pill in the top bar, which took too much room there. The
// CSS shows the row and hides the pill below 1025px; on a wide screen the pill of the grey strip stays and the row is hidden.
function buildLangRow() {
  const row = document.createElement('div');
  row.className = 'auth-lang-row';
  const label = document.createElement('span');
  label.textContent = t('nav.language');
  const seg = document.createElement('span');
  seg.className = 'auth-lang-seg';
  [['sk', 'SK'], ['en', 'EN']].forEach(([code, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (code === currentLang) b.className = 'on';
    b.addEventListener('click', () => { if (code !== currentLang) setLang(code); });
    seg.appendChild(b);
  });
  row.append(label, seg);
  return row;
}
// (a logged-in player has no person icon any more: for him the same row is in the dropdown of his profile pill, see refreshActingOrg)
function mountLangRow() {
  const panel = document.getElementById('auth-menu-panel');
  if (!panel || panel.querySelector('.auth-lang-row')) return;
  panel.insertBefore(buildLangRow(), panel.firstChild);
}
mountLangRow();

// Desktop-only scroll-to-top button — skipped on pages with no topbar
// (the embed views), which are short widgets that don't need it.
(function initScrollTop() {
  if (!document.querySelector('.topbar')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'scroll-top-btn';
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', 'Scroll to top');
  btn.textContent = '↑';
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

// A sticky orange "Court booking" button under the top menu, on every page except the booking page itself and the embeds.
(function initBookingButton() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.body.classList.contains('embed')) return;
  if (currentCodePath() === '/reservations') return;
  if (window.CITY) return; // the courts of the booking are Bratislava's; a city has none yet
  const a = document.createElement('a');
  a.className = 'booking-btn';
  a.href = siteUrl('/reservations');
  a.innerHTML = `${courtIcon('ball')}<span>${escapeHtml(t('rv.bookBtn'))}</span>`;
  document.body.appendChild(a);
  // below the menu; on a wide screen its right edge lines up with the language switcher
  const place = () => {
    const root = document.documentElement;
    root.style.setProperty('--booking-top', `${topbar.offsetHeight}px`);
    const lang = document.getElementById('lang-switcher');
    const edge = lang ? lang.getBoundingClientRect().right : 0;
    root.style.setProperty('--booking-right', edge > 0 ? `${Math.max(0, Math.round(root.clientWidth - edge))}px` : '0px');
  };
  place();
  window.addEventListener('resize', place);
  window.addEventListener('load', place);
  if (window.ResizeObserver) new ResizeObserver(place).observe(topbar); // the menu can wrap or load late

  // a strip of its own under the menu, so the page starts below the button and it never covers the top of the content...
  const spacer = document.createElement('div');
  spacer.className = 'booking-spacer';
  topbar.insertAdjacentElement('afterend', spacer);
  // ...and it slides away behind the menu while scrolling down and comes back when scrolling up (and at the very top)
  let last = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (Math.abs(y - last) < 6) return;
    a.classList.toggle('booking-hidden', y > last && y > 120);
    last = y;
  }, { passive: true });
})();

// ---- Club view: while a player is inside a community or club (its page, or a season / tournament of it) the phone bottom bar and the top menu work for that club.
// The community page and the season page store the club (and the event the bar points to) here; every other page only reads it, so the club view lasts the whole
// visit. sessionStorage: it ends with the tab (or the installed app window), and a page that opens cold (a link from WhatsApp) shows the normal bar.
//   ctx = { orgSlug, orgName, logoUrl, path: '/community/<slug>', event: { slug, name, kind: 'SEASON'|'TOURNAMENT', path: '/season/<slug>' | '/tournament/<slug>' } | null }
const CLUB_CTX_KEY = 'blta_club_ctx';
let clubCtxMemory = null; // the same, for a browser that does not let the page use sessionStorage
function getClubContext() {
  let c = null;
  try { c = JSON.parse(sessionStorage.getItem(CLUB_CTX_KEY)); } catch { c = null; }
  if (!c) c = clubCtxMemory;
  // a club view belongs to the site it was made on: slta.sk is one origin for the national page and every city, and a club of one city does not exist in another
  return c && typeof c.orgSlug === 'string' && typeof c.path === 'string' && c.path.startsWith('/community/') && (c.city || '') === (window.CITY_BASE || '') ? c : null;
}
// the admin tools keep their own menu: no club view there (the bottom bar skips them the same way)
const clubViewShown = () => !!getClubContext() && !/(^|\/)(admin|[a-z-]+-admin|login-history)\/?$/.test(window.location.pathname);
// Only an app installed FROM a club is a club app: it starts on the club page with ?app=1 (the start_url of the club's manifest, see src/clubApp.js) and keeps
// that in sessionStorage for the window. The general BLTA app (or a browser tab) is not one, so it can always leave the club view with "← BLTA".
const CLUB_APP_KEY = 'blta_club_app';
let clubAppMemory = false;
const isStandaloneApp = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
if (isStandaloneApp() && new URLSearchParams(window.location.search).get('app') === '1') {
  clubAppMemory = true;
  try { sessionStorage.setItem(CLUB_APP_KEY, '1'); } catch { /* the memory above keeps it for this page */ }
}
function inClubApp() {
  let stored = false;
  try { stored = sessionStorage.getItem(CLUB_APP_KEY) === '1'; } catch { stored = false; }
  return isStandaloneApp() && (clubAppMemory || stored);
}
function syncClubViewClasses() {
  document.body.classList.toggle('club-view', clubViewShown());
  document.body.classList.toggle('club-app', clubViewShown() && inClubApp()); // in the club's own app there is nothing to leave
}
function syncClubView() {
  syncClubViewClasses();
  window.dispatchEvent(new CustomEvent('blta:club-context'));
}
// The page the visitor came from when the club view began: "← BLTA" leads back to it (the first one is kept for the whole visit, also when the visitor moves on
// from club to club). Only a page of this site counts (the same address, or one of the sites blta.sk / slta.sk), never a stranger's page.
function clubBackAddress() {
  try {
    const u = new URL(document.referrer);
    const ours = u.origin === window.location.origin || /(^|\.)(blta|slta)\.sk$/.test(u.hostname);
    return /^https?:$/.test(u.protocol) && ours && u.href !== window.location.href ? u.href : '';
  } catch { return ''; }
}
function setClubContext(ctx) {
  const before = getClubContext();
  ctx = { ...ctx, city: window.CITY_BASE || '', back: before ? before.back || '' : clubBackAddress() };
  clubCtxMemory = ctx;
  try { sessionStorage.setItem(CLUB_CTX_KEY, JSON.stringify(ctx)); } catch { /* the memory above keeps it for this page */ }
  syncClubView();
}
function clearClubContext() {
  clubCtxMemory = null;
  try { sessionStorage.removeItem(CLUB_CTX_KEY); } catch { /* nothing stored */ }
  syncClubView();
}
syncClubViewClasses();

// The app of the club: the page's manifest (and the icon iOS uses for "Add to Home Screen") become the club's own, so what gets installed is the club.
function setClubManifest(orgSlug) {
  const base = `${window.CITY_BASE || ''}/api/communities/${encodeURIComponent(orgSlug)}`;
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.setAttribute('href', `${base}/manifest.json`);
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) touch.setAttribute('href', `${base}/icon-192.png`);
  // the icon a browser keeps for a home-screen shortcut of the page (Chrome: menu > Add to Home screen > Create shortcut) is the club's too
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) { icon.setAttribute('href', `${base}/icon-192.png`); icon.setAttribute('type', 'image/png'); icon.setAttribute('sizes', '192x192'); }
}

// "Share": the phone's share sheet where there is one, else the link is copied. Always the address of the page the player is on.
async function clubShare(title) {
  const url = window.location.origin + window.location.pathname;
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch { /* the player closed the sheet */ }
    return;
  }
  try { await copyToClipboard(url); toast(t('share.linkCopied')); } catch { window.prompt(t('share.copyLink'), url); }
}

// The button of a club page: "Share" (the community page and the season / tournament page of a club draw it with this and share the click, below).
function clubAppButtonsHtml(btnClass, shareTitle) {
  const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return `<button type="button" class="${btnClass}" id="club-share" data-club-act="share" data-title="${escapeHtml(shareTitle || '')}">${svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>')}${escapeHtml(t('club.share'))}</button>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-club-act]');
  if (!b) return;
  clubShare(b.dataset.title);
});

// Phone bottom menu: Home / Matches / My profile / Tables / Rankings (shown by CSS below ~1024px, where the top menu collapses).
// In the club view: Home (the club page) / Matches / My profile / Tables / Play-off, the three event items for the event of the club view (or the club's Events tab
// when it has none). Skipped on embeds and the admin tools.
(function initBottomNav() {
  if (!document.querySelector('.topbar') || document.body.classList.contains('embed')) return;
  // the admin tools only (a path that ends in admin, <name>-admin or login-history), not a club or a player whose name merely contains "admin"
  if (/(^|\/)(admin|[a-z-]+-admin|login-history)\/?$/.test(window.location.pathname)) return;
  const path = currentCodePath();
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Main');
  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');

  const itemsFor = (ctx) => {
    if (!ctx) {
      return [
        { key: 'home', href: '/', icon: 'home', label: t('bottomNav.home') },
        { key: 'matches', href: '/matches', icon: 'ball', label: t('nav.matches') },
        { key: 'profile', href: '#', icon: 'user', label: t('nav.myProfile') },
        { key: 'tables', href: '/tables', icon: 'table', label: t('bottomNav.tables') },
        { key: 'rankings', href: '/rankings', icon: 'barChart', label: t('nav.rankings') },
      ];
    }
    const to = (tab) => (ctx.event ? `${ctx.event.path}#${tab}` : `${ctx.path}#events`);
    return [
      { key: 'home', href: ctx.path, icon: 'home', label: t('bottomNav.home') },
      { key: 'matches', href: to('matches'), icon: 'ball', label: t('nav.matches') },
      { key: 'profile', href: '#', icon: 'user', label: t('nav.myProfile') },
      { key: 'tables', href: to('tables'), icon: 'table', label: t('bottomNav.tables') },
      { key: 'playoff', href: to('playoff'), icon: 'trophy', label: t('bottomNav.playoff') },
    ];
  };
  const el = (k) => nav.querySelector(`[data-nav="${k}"]`);
  let eventTab = null; // the tab the event page has open (the page tells us; its address only has it after a click)

  const setActive = () => {
    const ctx = getClubContext();
    const tab = eventTab || window.location.hash.slice(1);
    const onEvent = !!(ctx && ctx.event && path === ctx.event.path);
    nav.querySelectorAll('.bottom-nav-item').forEach((a) => {
      const k = a.dataset.nav;
      let on = false;
      if (k === 'profile') on = path.startsWith('/player/') && a.dataset.code === path;
      else if (ctx) on = k === 'home' ? path === ctx.path : onEvent && tab === k;
      else on = k === 'home' ? path === '/' : k === 'matches' ? path === '/matches' : k === 'tables' ? path.startsWith('/tables') : path.startsWith('/rankings');
      a.classList.toggle('active', on);
    });
  };
  const syncProfile = () => {
    // (the first draw of the bar runs before the login state exists, and reading it then throws: no profile link yet, blta:auth-changed brings it)
    let mine = '';
    try { mine = (playerAuthed && currentPlayerId) ? `/player/${currentPlayerSlug || currentPlayerId}` : ''; } catch { /* not known yet */ }
    const a = el('profile');
    if (!a) return;
    a.dataset.code = mine;
    a.href = mine || '#';
    setActive();
  };
  const render = () => {
    nav.innerHTML = itemsFor(getClubContext()).map((i) => `<a class="bottom-nav-item" data-nav="${i.key}" href="${i.href}">${courtIcon(i.icon)}<span>${escapeHtml(i.label)}</span></a>`).join('');
    // on the page of the event itself (a tournament or a season of the club) the bar does not load the page again: the page opens the tab and scrolls down to it
    nav.querySelectorAll('[data-nav="matches"], [data-nav="tables"], [data-nav="playoff"]').forEach((a) => a.addEventListener('click', (e) => {
      const ctx = getClubContext();
      if (!ctx || !ctx.event || path !== ctx.event.path) return;
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('blta:open-season-tab', { detail: { tab: a.dataset.nav } }));
    }));
    el('profile').addEventListener('click', (e) => {
      if (playerAuthed && currentPlayerId) return; // real href already set
      e.preventDefault();
      requirePlayerAuth(() => { window.location.href = siteUrl(`/player/${currentPlayerSlug || currentPlayerId}`); });
    });
    syncProfile();
  };
  render();
  window.addEventListener('blta:auth-changed', syncProfile);
  window.addEventListener('blta:club-context', render);
  window.addEventListener('blta:season-tab', (e) => { eventTab = e.detail && e.detail.tab; setActive(); });
  window.addEventListener('hashchange', () => { eventTab = null; setActive(); });
})();

// The top menu in the club view: "← blta.sk" (or "← slta.sk", the site the visitor came from) leaves the club view; "Community home page" (the page of the club),
// "My profile" and "Communities and clubs" stay inside it, like the phone's bottom bar (the club, with its logo in the header, stays around the page they open). The rest of the menu is hidden by CSS,
// see body.club-view; in the installed app the whole menu is hidden: the app is the club.
function clubBackLabel(href) {
  let host = '';
  try { host = new URL(href, window.location.href).hostname; } catch { host = ''; }
  if (/(^|.)slta.sk$/.test(host)) return 'slta.sk';
  if (/(^|.)blta.sk$/.test(host)) return 'blta.sk';
  return window.CITY_BASE ? 'slta.sk' : 'blta.sk'; // a development address: a city under the national address is SLTA, the first city BLTA
}
(function initClubExit() {
  const links = document.getElementById('nav-links');
  if (!links || document.body.classList.contains('embed')) return;
  const profileHref = () => {
    try { return (playerAuthed && currentPlayerId) ? siteUrl(`/player/${currentPlayerSlug || currentPlayerId}`) : '#'; } catch { return '#'; }
  };
  const item = (cls, icon, label, href) => {
    const a = document.createElement('a');
    a.className = `club-nav-item ${cls}`;
    a.href = href;
    a.textContent = label;
    a.style.setProperty('--nav-ico', navIconUrl(icon));
    return a;
  };
  const sync = () => {
    let a = links.querySelector('.club-exit');
    if (!clubViewShown()) { links.querySelectorAll('.club-exit, .club-nav-item').forEach((el) => el.remove()); return; }
    const back = getClubContext().back || siteUrl('/');
    if (a) {
      a.href = back;
      a.textContent = `← ${clubBackLabel(back)}`;
      const me = links.querySelector('.club-nav-profile');
      if (me) me.href = profileHref();
      const home = links.querySelector('.club-nav-home'); // the club the visitor is in can change (club to club)
      if (home) home.href = siteUrl(getClubContext().path);
      return;
    }
    a = document.createElement('a');
    a.className = 'club-exit';
    a.href = back;
    a.textContent = `← ${clubBackLabel(back)}`;
    a.addEventListener('click', () => clearClubContext());
    const me = item('club-nav-profile', 'user', t('nav.myProfile'), profileHref());
    me.addEventListener('click', (e) => {
      if (playerAuthed && currentPlayerId) return; // the real address is on the link already
      e.preventDefault();
      requirePlayerAuth(() => { window.location.href = siteUrl(`/player/${currentPlayerSlug || currentPlayerId}`); });
    });
    links.append(a, item('club-nav-home', 'home', t('club.homeLink'), siteUrl(getClubContext().path)), me, item('club-nav-communities', 'group', t('com.heading'), siteUrl('/communities')));
  };
  sync();
  window.addEventListener('blta:club-context', sync);
  window.addEventListener('blta:auth-changed', sync);
})();

document.querySelectorAll('[data-close]').forEach((el) => {
  el.addEventListener('click', () => {
    document.getElementById(el.dataset.close).style.display = 'none';
  });
});
document.querySelectorAll('.modal-backdrop').forEach((el) => {
  el.addEventListener('click', (e) => { if (e.target === el) el.style.display = 'none'; });
});

// OTP-style 5-digit code entry — a row of 5 single-digit boxes (see
// .otp-group/.otp-box in style.css) in front of a plain hidden <input>
// (id is the group's own id minus the "-otp" suffix, e.g.
// "player-login-pin-input-otp" pairs with "player-login-pin-input") that
// stays in sync with them. That hidden input is the one every existing
// bit of login/registration/reset JS actually reads/writes — via
// `.value`, or (since setting .value directly wouldn't touch the boxes)
// the otpClear/otpFocus/otpDisable helpers below wherever that code used
// to just call .value='' / .focus() / .disabled=x on the input directly —
// so this only changes how the digits get typed in, never how the rest
// of the app reads the result.
const otpBoxesByInputId = new Map();

function initOtpGroups() {
  document.querySelectorAll('.otp-group').forEach((group) => {
    const hiddenId = group.id.replace(/-otp$/, '');
    const hidden = document.getElementById(hiddenId);
    if (!hidden) return;
    const boxes = Array.from(group.querySelectorAll('.otp-box'));
    otpBoxesByInputId.set(hiddenId, boxes);
    const sync = () => { hidden.value = boxes.map((b) => b.value).join(''); };

    boxes.forEach((box, i) => {
      box.setAttribute('aria-label', t('a11y.digit', { n: i + 1, total: boxes.length }));
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        sync();
        if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
        else if (e.key === 'ArrowLeft' && boxes[i - 1]) boxes[i - 1].focus();
        else if (e.key === 'ArrowRight' && boxes[i + 1]) boxes[i + 1].focus();
      });
      // Pasting a full code (e.g. copied from a password manager) fills
      // every box at once instead of just dumping it all into whichever
      // one happened to be focused.
      box.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        e.preventDefault();
        boxes.forEach((b, j) => { b.value = text[j] || ''; });
        sync();
        const nextEmpty = boxes.findIndex((b) => !b.value);
        (nextEmpty === -1 ? boxes[boxes.length - 1] : boxes[nextEmpty]).focus();
      });
    });
  });
}
initOtpGroups();

function otpClear(hiddenInputId) {
  const hidden = document.getElementById(hiddenInputId);
  if (hidden) hidden.value = '';
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes) boxes.forEach((b) => { b.value = ''; });
}
function otpFocus(hiddenInputId) {
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes && boxes[0]) boxes[0].focus();
}
function otpSetDisabled(hiddenInputId, disabled) {
  const boxes = otpBoxesByInputId.get(hiddenInputId);
  if (boxes) boxes.forEach((b) => { b.disabled = disabled; });
}
