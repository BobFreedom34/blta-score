# Community / club app: menu, install and share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entering a community/club (its page, or one of its seasons or tournaments) switches the phone bottom bar and the top menu to a club view that lasts the whole visit, and the club page and its event pages get "Nainštaluj ako appku" (installs the club as an app with its logo) and "Zdieľať" buttons.

**Architecture:** Community and season pages store the club (and its current event) in `sessionStorage` (the "club context"); `common.js` reads it on every page to build the club bar and the one-item top menu and to name the installable app. The server serves a per-community web manifest and logo icons (`@resvg/resvg-js`) from `src/routes/communities.js`.

**Tech Stack:** Node 22 + Express, `@resvg/resvg-js` (already a dependency), vanilla JS pages (no build step), `scripts/check-*.js` server checks.

**Spec:** `docs/superpowers/specs/2026-11-01-club-season-menu-and-install-design.md`

## Global Constraints

- Club view applies to: `/community/<slug>` and any season/tournament whose payload (`GET /api/seasons/by-slug/:slug`) has `organisation`. League seasons/tournaments keep today's bar, menu and install behaviour untouched.
- Club context: `sessionStorage` key `blta_club_ctx`, JSON `{ orgSlug, orgName, logoUrl, path, event }` with `path` = `/community/<orgSlug>` and `event` = `{ slug, name, kind: 'SEASON'|'TOURNAMENT', path } | null` (`path` = `/season/<slug>` or `/tournament/<slug>`; a community's `kind === 'LEAGUE'` is a season).
- Club bar, in order: **Domov** → `ctx.path`; **Zápasy** → `<event.path>#matches`; **Profil** (own profile, login prompt when logged out, exactly as today); **Tabuľky** → `<event.path>#tables`; **Play off** → `<event.path>#playoff`. With `ctx.event === null` the three event items go to `ctx.path + '#events'`. Icons from `COURT_ICON_PATHS`: `home`, `ball`, `user`, `table`, `trophy`.
- Current event (community page): running or coming events soonest first, else the latest finished one — same rule as `GET /api/communities/my-events` in `src/routes/communities.js`; an event with no dates counts as coming, last.
- Top menu in club view: only a small `← BLTA` item (class `club-exit`) that clears the context and goes to `/`; hidden in the installed app (`display-mode: standalone`). The top strip (logo, player, SK/EN, bell) stays. The orange booking button is hidden in club view.
- Buttons "Nainštaluj ako appku" (EN "Install as app", id `club-install`) and "Zdieľať" (EN "Share", id `club-share`), install left, share right: on the community page appended to `.com-actions` (after Pridať člena); on a club event page a right-aligned row `.sv-club-actions` directly after the `.sv-head` block in `headerHtml()` of `season.js`. Hidden for a locked or unapproved club. Install is hidden until the browser can install (iOS: at once), and when standalone or already installed for this club.
- Share: `navigator.share({ title, url })` when it exists, else `copyToClipboard(url)` + `toast(t('share.linkCopied'))`; `url` = `location.origin + location.pathname`.
- App identity: manifest `name` = club name, `short_name` = club name (cut to 14 chars with `…` when longer), `id` and `start_url` = `/community/<slug>` (+ `?app=1` for `start_url`), `scope` `/`, `display` `standalone`; icons = club logo rendered to 192, 512 and maskable 512 PNG; no logo or unreadable file → `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`.
- While a club context exists, the generic BLTA install banner and nav install button are not shown.
- Texts in `public/js/i18n.js`, SK and EN. No new public page, so nothing to add in Backend > SEO.
- Every changed JS file: `node -c <file>` and a null-byte check before showing the result. **Do not commit or push** — the project workflow waits for the user's explicit "deploy"; `git add` then only the specific changed files.

## Review Focus

1. Club has no logo, or its logo file is gone from disk → manifest still valid with BLTA icons, icon routes answer without a 500.
2. Hidden or unapproved club, a league slug, an unknown slug → manifest 404, never a manifest.
3. Stale club context: the player later opens a league season, or an event/club that no longer exists → the club view clears and the normal bar returns.
4. A club with no events yet (or a locked club) → bar items go to `#events`, no crash, no install/share buttons for a locked club.
5. Logged-out player taps Profil in the club bar → the same login prompt as the normal bar; English pages (`/en/...`) show English labels, exit item and buttons.

---

### Task 1: Per-community manifest and logo icons (server)

**Files:**
- Create: `src/clubApp.js`
- Modify: `src/routes/communities.js` (two routes right after `router.get('/:slug', …)`, ~line 316)
- Test: `scripts/check-club-app.js` (copy the server-start / `call` / `makePlayer` helpers from `scripts/check-club-seasons.js`)

**Interfaces:**
- Produces:
  - `clubApp.manifestFor(org) -> object` (`org` = the `organisations` row; manifest per Global Constraints)
  - `clubApp.iconPng(logoUrl: string, variant: '192'|'512'|'maskable') -> Buffer | null` (null when no logo, a non-`/community-images/` address, or it cannot be read/rendered)
  - `GET /api/communities/:slug/manifest.json` (`application/manifest+json`, `Cache-Control: no-cache`) and `GET /api/communities/:slug/icon-:variant.png` (`image/png`, long cache; 302 to the matching BLTA static icon when `iconPng` is null). Same lookup and same `communities.canRead` / league check as `GET /:slug`, 404 otherwise (`{ error: 'Community not found' }`).

- [ ] **Step 1: Write the failing checks** in `scripts/check-club-app.js` (setup: a community whose admin uploads a PNG logo via `POST /api/communities/:id/logo`, the PNG made with `@resvg/resvg-js`; a second community without logo). Tests:
  - `'manifest names the club and opens on its page'`: `name === <club name>`, `start_url === '/community/<slug>?app=1'`, `id === '/community/<slug>'`, `scope === '/'`, `display === 'standalone'`, icons point to `/api/communities/<slug>/icon-192.png`, `icon-512.png`, `icon-maskable.png`.
  - `'icons are PNGs of the right size'`: PNG signature, IHDR width/height 192 / 512 / 512.
  - `'a club without a logo uses the BLTA icons'`: icons are `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`.
  - `'a logo file gone from disk redirects to the BLTA icon (302), no 500'`.
  - `'an unknown slug has no manifest'` and `'a hidden club has no manifest'`: 404 (hide a club the way `check-club-seasons.js` does).

- [ ] **Step 2: Run** `node scripts/check-club-app.js` → expect FAIL (404 on the manifest route).

- [ ] **Step 3: Implement `src/clubApp.js`.** `iconPng` reads `path.join(db.dataDir, 'community-images', path.basename(logoUrl))` (only for addresses starting `/community-images/`), builds an SVG with the logo as a base64 `<image>` contained in the square on a white background (padding 10 % for 192/512, 20 % for `maskable`), renders it with `Resvg`, and caches the Buffer in a `Map` keyed by `logoUrl + variant` (a new upload has a new filename, so no invalidation); any error → `null`. `manifestFor` returns the manifest from Global Constraints.

- [ ] **Step 4: Add the two routes** in `src/routes/communities.js` using the lookup of `router.get('/:slug')`; send `clubApp.manifestFor(org)` / `clubApp.iconPng(org.logo_url, variant)` or the 302.

- [ ] **Step 5: Run** `node scripts/check-club-app.js` → all PASS; `node scripts/check-club-seasons.js` and `node scripts/check-communities*.js` (whatever matches) still PASS.

---

### Task 2: Club context, club bottom bar, one-item top menu, install plumbing (`common.js`, CSS, i18n)

**Files:**
- Modify: `public/js/common.js` (`initBottomNav` ~line 1983 with new helpers just above it; `initInstallPrompt` ~3867)
- Modify: `public/css/style.css` (rules next to the `.bottom-nav` block, ~line 3446)
- Modify: `public/js/i18n.js` (SK block near `bottomNav.home` ~641, EN block near ~2114)

**Interfaces:**
- Produces (globals in `common.js`, used by Tasks 3 and 4):
  - `getClubContext() -> ctx | null` (parses `blta_club_ctx` in try/catch; null on anything invalid)
  - `setClubContext(ctx)` / `clearClubContext()` — write/remove the key, toggle `club-view` on `document.body`, dispatch `window` event `blta:club-context`
  - `window.BLTA_INSTALL = { ready: boolean, run(): Promise<void> }` and `window` event `blta:install-ready` when `ready` turns true
  - `setClubManifest(orgSlug)` — points `<link rel="manifest">` at `(window.CITY_BASE || '') + '/api/communities/' + orgSlug + '/manifest.json'`
  - `clubShare(title: string) -> Promise<void>` — the Share behaviour from Global Constraints
  - Event `blta:season-tab` (`detail: { tab }`), dispatched by `season.js`, used for the active highlight
- i18n keys: `bottomNav.playoff` ("Play off" / "Play-off"), `clubView.exit` ("← BLTA"), `club.installApp` ("Nainštaluj ako appku" / "Install as app"), `club.share` ("Zdieľať" / "Share"); `share.linkCopied` exists already in both languages.

- [ ] **Step 1: Context helpers** as above; on load, a valid context adds `club-view` to `document.body`.

- [ ] **Step 2: Rework `initBottomNav`** so the item list comes from `buildItems()` (normal list unchanged; club list per Global Constraints) and the bar re-renders on `blta:club-context`. Active state in club view: Domov when the page is `ctx.path`; the event items by the open tab (`blta:season-tab`, else `location.hash`) when the page is `ctx.event.path`; Profil as today. The Profil click/auth logic and `syncProfile` stay shared by both lists.

- [ ] **Step 3: Top menu.** In club view add one `<a class="club-exit">` (text `t('clubView.exit')`, href `/`, click calls `clearClubContext()` first) to `#nav-links`; remove it when the context is cleared. CSS: `body.club-view .nav-links > *:not(.club-exit)`, `body.club-view .booking-btn`, `body.club-view .booking-spacer`, `body.club-view .install-app-btn` → `display: none`; `@media (display-mode: standalone) { .club-exit { display: none } }`.

- [ ] **Step 4: Make `initInstallPrompt` identity-aware.** Behaviour without a club context stays as today. With one: the "installed" and "dismissed" keys get the suffix `:club:<orgSlug>` and are evaluated when needed, not once at load (the early `return` on `alreadyInstalled` must not block the club app); the iOS steps modal title uses the club name; `maybeShowBanner()` returns early while any club context exists and the banner is hidden on `blta:club-context`; `window.BLTA_INSTALL.ready` is true on iOS or once `beforeinstallprompt` fired, `run()` shows the iOS steps modal on iOS, else calls `deferredPrompt.prompt()`; `appinstalled` stores the per-club key.

- [ ] **Step 5: Add `setClubManifest`, `clubShare` and the i18n keys** (SK + EN).

- [ ] **Step 6: Verify in the browser preview** (`preview_start` name `blta-seasons-test`, login code `09170000001`; 390 px wide via `resize_window` mobile preset). Set `sessionStorage.blta_club_ctx` by hand to a club with an event, reload: bar = Domov / Zápasy / Profil / Tabuľky / Play off, nav row shows only "← BLTA", no booking button. Open `/rankings`: the club bar is still there. Click "← BLTA": normal bar and menu are back and the key is gone. Same with `event: null`: the three event items link to `<path>#events`. Logged out: Profil opens the login prompt. `/en/...`: English labels. `read_console_messages`: no errors.

---

### Task 3: Community page — context, install and share buttons

**Files:**
- Modify: `public/js/community.js` (`render()` ~line 520-547 for the buttons in `.com-actions`; `load()` ~line 680-705 for the context; `bind()` ~line 565 for the clicks)
- Modify: `public/css/style.css` (button styling next to the `.com-actions` rules)

**Interfaces:**
- Consumes: `getClubContext`, `setClubContext`, `clearClubContext`, `setClubManifest`, `clubShare`, `window.BLTA_INSTALL`, event `blta:install-ready`, i18n `club.installApp` / `club.share` (Task 2).
- Produces: `pickCurrentEvent(events, today) -> { slug, name, kind, path } | null` (local to `community.js`; `events` = the `tournaments` array already loaded there, `kind === 'LEAGUE'` → `'SEASON'`; rule from Global Constraints).

- [ ] **Step 1: Context.** After a successful `load()` of a readable club (also when `org.locked`: then `event: null`): `setClubContext({ orgSlug: org.slug, orgName: org.name, logoUrl: org.logoUrl || '', path: '/community/' + org.slug, event })` where `event` = the event of the existing context when it is the same club and has one, else `pickCurrentEvent(tournaments, today)`; call `setClubManifest(org.slug)`. A club that is not found → `clearClubContext()`.

- [ ] **Step 2: Buttons.** At the end of the `.com-actions` markup (after "Pridať člena" for an admin, after Opustiť / join for others) add `club-install` (hidden until `BLTA_INSTALL.ready`, and not rendered when standalone or installed — `localStorage` per club, try/catch) and `club-share`; nothing for a locked or unapproved club. Click handlers in `bind()`: install → `window.BLTA_INSTALL.run()`, share → `clubShare(org.name)`. `render()` runs often, so re-reveal install from `BLTA_INSTALL.ready` on each render and on `blta:install-ready`. Style both like the neighbouring `.btn` pills of that row (the user's screenshot: same height, install and share to the right of Pridať člena).

- [ ] **Step 3: Verify in the browser preview** on a club page as admin and as a plain member: row shows Opustiť / Pozvať ľudí / Pridať člena (admin) and then Nainštaluj ako appku and Zdieľať, as in the user's third screenshot; manifest link is the club's and `fetch` of it returns the club name and the three icon URLs return PNGs; the bar is the club bar with the event picked (running → coming → latest, check with a club that has two events); Share with `navigator.share` removed copies the link and shows the toast; a locked club shows no buttons. Screenshot for the user.

---

### Task 4: Event page of a club — context and button row

**Files:**
- Modify: `public/js/season.js` (`headerHtml` ~line 225-250, `openTab` ~715, startup block ~756-768, click handler ~721)
- Modify: `public/css/style.css` (`.sv-club-actions`, next to `.sv-actions` ~line 4107)

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: nothing new; dispatches `blta:season-tab` (`detail: { tab }`) from `openTab` and once after the first render.

- [ ] **Step 1: Context.** After the season loads: if `season.organisation` → `setClubContext({ orgSlug: season.organisation.slug, orgName: season.organisation.name, logoUrl: season.organisation.logoUrl, path: '/community/' + season.organisation.slug, event: { slug, name: season.name, kind: isTournament() ? 'TOURNAMENT' : 'SEASON', path: (isTournament() ? '/tournament/' : '/season/') + slug } })` and `setClubManifest(season.organisation.slug)`; else `clearClubContext()`; season not found → `clearClubContext()`.

- [ ] **Step 2: Button row.** `clubActionsHtml()` (empty unless `season.organisation` and the club is not locked) returns `<div class="sv-club-actions">` with `club-install` (hidden until ready, same conditions as Task 3) and `club-share`, appended after the `.sv-head` block in `headerHtml()`. CSS: `.sv-club-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 12px 0 0 }` using `.sv-btn` looks; the row must sit in the gap between the hero and the "Priebeh série" card without touching either (check 390 px and desktop). The delegated click handler: `#club-install` → `window.BLTA_INSTALL.run()`, `#club-share` → `clubShare(season.name)`. Show install on `BLTA_INSTALL.ready` at render and on `blta:install-ready`.

- [ ] **Step 3: Verify in the browser preview.** Open a club season and a club tournament: row under the hero as in the user's second screenshot (install left, share right, right-aligned); the bar is the club bar, and Zápasy / Tabuľky / Play off switch the tab without a reload with the highlight following; Domov goes to the community page; open a league season → normal bar and menu, install banner back to BLTA, `blta_club_ctx` gone; open a deleted/unknown season → context cleared. Check the English page. State plainly that the real "Add to home screen" flow can only be confirmed on a phone after deploy.

- [ ] **Step 4: Docs, syntax, regression.** Add a row to the "how to make future edits" table in `README.md` (club view / club app: files from this plan); `node -c` and the null-byte check on `common.js`, `season.js`, `community.js`, `i18n.js`, `src/clubApp.js`, `src/routes/communities.js`; run `npm test -- club` and `npm test -- season`; show the user and stop (no commit).

---

## Self-review

- Spec coverage: club view on community and event pages (T3/T4), whole-visit memory (T2), bar with Domov = community page and the three event items (T2), one-item top menu hidden in the app (T2), current-event rule (T3), install + share on both pages (T3/T4), club logo icons and manifest (T1), banner suppression (T2), SEO untouched, tests (T1) and browser verification (T2–T4).
- Names are the same in every task: `blta_club_ctx`, `getClubContext/setClubContext/clearClubContext/setClubManifest/clubShare`, `blta:club-context`, `blta:season-tab`, `window.BLTA_INSTALL`, `blta:install-ready`, `club-install`, `club-share`, `manifestFor`, `iconPng`, `pickCurrentEvent`.
- Proportion: the plan carries decisions and signatures only; code bodies are left to the implementer.
