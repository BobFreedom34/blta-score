# Community / club app: own bottom menu + install as app + share

Date: 2026-11-01. Size: medium (one bar, one top-menu mode, one manifest route per community, two button rows).
Status: design agreed with the user in chat; waiting for the go-ahead to build. (Revised three times the same day:
first one event = one app, then buttons under the season hero, finally the community page — this is the final shape.)

## Intent and why
A player who enters a community or club (its page, or a season or tournament of it) is "inside" that club. The phone
bottom bar and the top menu should then work for that club, and the player should be able to put the club on the
home screen as its own app (name and logo of the club) and share its link.

## Goals
- **Club view** on: the community/club page (`/community/<slug>`) and every season / tournament of a community or club
  (`/season/<slug>`, `/tournament/<slug>` with `season.organisation`). It lasts the whole visit (user decision) —
  profile, match pages, player pages keep the club bar.
- **Club bottom bar**, in this order: **Domov** (the community/club page), **Zápasy** (the `#matches` tab of the club's
  current event), **Profil** (own profile; login prompt when logged out, as today), **Tabuľky** (`#tables` of the current
  event), **Play off** (`#playoff` of the current event; replaces Rebríček).
- **Current event** = the season or tournament the player is looking at; on the community page, the club's own pick:
  the running or coming event (soonest first), otherwise the latest finished one (same rule as `GET /api/communities/my-events`).
  A club with no event: those three items open the community's Events tab (`/community/<slug>#events`).
- **Top menu in club view:** the whole menu row (Domov, Liga, Môj profil, Komunity a kluby, Hľadám súpera, + Nový
  zápas, Kurty, Kontakt, the booking button) is replaced by ONLY a small "← BLTA" item that leaves the club view and
  goes to the normal home page. It is hidden in the installed app (the row is then empty). The top strip (logo,
  player, SK/EN, bell) stays — my reading of "the menu".
- **Two buttons "Nainštaluj ako appku" and "Zdieľať":**
  - On the community/club page: in the action row (`.com-actions`) to the right of Opustiť / Pozvať ľudí / Pridať
    člena (the two circles in the user's third screenshot), install on the left, share on the right.
  - Also on a club's season/tournament page, in a right-aligned row under the hero image (second screenshot) — same
    two buttons, same behaviour (the user said "right" to this in chat).
  - Install installs the COMMUNITY/CLUB: app named after it, its logo as icon, opens on the community page. Share
    shares the link of the page the player is on.

## Non-goals / anti-goals
- League (BLTA) seasons and tournaments keep the normal bar, menu and install behaviour.
- No per-event apps, no new addresses, no path-prefix mini-sites, no change to the desktop layout beyond the above.
- A player must never be stuck in the club view with no way out (the "← BLTA" item), and a club that is hidden or no
  longer approved must not leave a manifest behind.

## Constraints (from the code)
- Bar: built once in `public/js/common.js` (`initBottomNav`), keyed on `currentCodePath()`. Tabs of an event page are
  switched by hash in `public/js/season.js` (`availableTabs`, `hashchange`).
- Install code (`initInstallPrompt`, common.js) is hard-wired to one app (BLTA, or an SLTA city via `window.CITY`).
- A manifest per page already exists as a pattern (`cityManifest` in `server.js`). Club logos are uploads of any size
  (`/community-images/...`), a manifest needs 192/512 px PNG icons; `@resvg/resvg-js` is already a dependency.
- Chrome PWAs share `localStorage` with the browser, so "which club the visitor is in" lives in `sessionStorage`.
- The community page shows events only for a readable, unlocked club (`communities.canRead`, `org.locked`).

## Approaches considered
- **A. Remember the club in the tab (`sessionStorage`) — chosen.** Community and season pages store the club (and the
  current event); the bar reads it on every page. The installed app opens on the community page, which sets it again.
- B. Club in the URL (`?club=`) — pollutes shared links. Rejected. C. Path-prefix mini-site like the city apps —
  duplicate pages/SEO, far bigger than asked. Rejected.

## Decided with the user
- Keep the club view for the whole visit; "← BLTA" is the only item of the top menu, hidden in the installed app.
- Install + Share beside the community's action buttons; install = the whole community/club, club logo as icon;
  Zápasy / Tabuľky / Play off point to the club's current event, or to the opened event.

## Builder's calls (my decisions, easy to change)
- Domov goes to the community page (the club's home), also while the player is on an event page.
- On the community page an existing club view of the SAME club keeps its event (the one the player opened); a
  different or no club view takes the club's own pick.
- Share: `navigator.share({ title, url })`, else copy the link (`copyToClipboard`) and the toast `share.linkCopied`;
  the link is the page address without `?app=1` or a hash. Share and Install are hidden on a locked or not yet
  approved club; Install stays hidden until the browser can install (iOS: at once) and when already installed.
- Manifest: `GET /api/communities/<slug>/manifest.json`; `id` = `start_url` path = `/community/<slug>` (`?app=1`),
  `scope` `/`, name = the club's name. Icons: logo rendered to 192, 512 and maskable 512 PNG
  (`GET /api/communities/<slug>/icon-<192|512|maskable>.png`), BLTA icons when there is no usable logo.
- The generic BLTA install banner and nav install button are off while a club view is active; "installed" memory is
  per club.
- Active highlight: Domov on the community page; the three tab items follow the open tab on the event page.
- SEO: no new public page → nothing in Backend > SEO. Texts in `i18n.js` (SK + EN).

## Left to the builder
Icon padding/background for transparent logos, exact button styling to match each row, EN wording.
