# Komunity a kluby (communities and clubs) - design

Status: phase 1 built (see the plan); phases 2-4 not started. Changed after the first approval: a CLUB needs the super admin's approval (see "Approval of clubs").

## Intent and why

Today every tournament on blta.sk / slta.sk is made by an admin in the Backend. Tennis clubs and informal groups (a Tuesday-evening group, a company league, a school) run their own events, but have no way to put them on the platform, take registrations or draw and run a bracket without asking an admin.

This feature lets any registered player create a **community** or a **club** with its own public page, news feed, members and events. The player who creates it can switch to the club's profile and, from the front end only (no Backend), create and run tournaments for it. A new menu item **"Komunity a kluby"** leads to it.

A *Klub* and a *Komunita* work the same way; the type only changes the label and badge.

## Goals

- Any logged-in player can create a community or club. Each club chooses how people join: **anyone can join** at once, or **only on approval** by a club admin (the choice can be changed at any time).
- A club page has a cover photo, logo, description, member count, upcoming and past events, a news feed and a member list.
- The creator (and admins they promote) can switch between their player profile and the club profile (top-right switcher) and, as the club, post news and create and run tournaments on the front end.
- Club tournaments use the existing tournament engine: registration, draw (bracket or groups + play-off), timetable, bracket results, doubles. No second system.
- Club tournaments are clearly separate from the league and labelled with the club.
- A **community** is public at once; a **club** is approved once by the **super admin** before other players see it (see "Approval of clubs"). The city admin and the super admin can hide any community, club or tournament afterwards (moderation).
- The look matches the rest of the site (black cards, grey borders and fills, lime-green dates and statuses, orange buttons and active items), see the mockups in `.superpowers` of the brainstorm session.

## Non-goals (v1)

- No approval step before a community, a tournament or a post goes public (decided by the user). Only a club is approved, by the super admin (decided by the user, after the first design).
- No chat or private messages, no payments (an entry fee is text and an optional payment link, as for existing tournaments), no members-only tournaments, no club leagues (only tournaments and friendly matches) - lifted on 2026-10-30, see [club seasons](2026-10-30-club-seasons-design.md).
- Club tournament results do not count for league tables, ranking points, badges or CourtIQ (see Rating below), unless an admin turns it on for a club.

## Anti-goals

- A club organiser must never be able to read or change anything outside their own club's tournaments (other tournaments, players list, other clubs, settings, the Backend). A bug here is worse than the feature missing.
- Club tournaments must never appear in league standings, the league ranking, the season list of the league, or "Hráči mesiaca".

## Constraints from the code

- Permissions today: `requireAdmin` / `adminSession` in `src/auth.js`; a city admin is narrowed by `src/cityScope.js` (areas and row-by-row owner checks). `isAdmin` is also used for privacy (`canSeePrivateFields`: phone and email), so an organiser must **not** be made an "admin".
- Tournaments are `seasons` rows with `kind = 'TOURNAMENT'`; the tournament routes in `src/routes/seasons.js` (registrations, draw, seeds, doubles, schedule, season PATCH, hero/logo upload) and `src/routes/brackets.js` are `requireAdmin`. Matches finish through `src/routes/matches.js` (`checkMatchAccess`, `manual-result` is `requireLoggedIn` + `checkMatchAccess`).
- Rating side effects run when a match finishes: CourtIQ (`syncCourtIQIfFinished`), badges (`syncBadgesIfFinished`), ranking points (`rankingPoints.reconcile`, `reverseForMatchWithChanges`), and the doubles rating (`src/doubles.js`).
- Player login is the phone + code cookie `blta_player` (`getPlayerId`); there is no separate "organisation" identity today.
- Multi-city: rows carry `league_id`; `req.pageLeagueId` is the city of the address; `leagues.actingIdOf(req)` stamps new rows.
- Every new public page must appear in Backend > SEO (`src/seo.js`), and strings go through `t()` in `public/js/i18n.js` (SK and EN).

## Approaches considered

- **A. Clubs own tournaments in the existing engine (chosen by the user).** A club is a new record; each tournament gets `organisation_id`; the existing screens are reused and the per-tournament routes accept the organiser of the owning club as well as an admin. Fastest, one tournament system. Risk: the permission change, covered by tests.
- B. Each club as a small league (like a city) with its own admin. Rejected: players, ratings and city lists are per league, so clubs would clutter the city structure.
- C. A separate simpler tournament module for clubs. Rejected: duplicates registration, brackets and results; two systems to maintain.

## Design (approach A)

### Data

- `organisations`: `id`, `league_id` (city of the page it was created on), `type` (`CLUB` | `COMMUNITY`), `name`, `slug` (unique), `description`, `logo_url`, `cover_url`, `contact`, `join_policy` (`OPEN` | `APPROVAL`, default `OPEN`, set by the club's admins), `hidden` (0/1, set by an admin), `counts_for_rating` (0/1, default 0, admin only), `max_open_tournaments` (default 5, admin only), `created_by_player_id`, `created_at`.
- `organisation_members`: `organisation_id`, `player_id`, `role` (`ADMIN` | `MEMBER`), `status` (`ACTIVE` | `PENDING`), `joined_at`; unique per pair. The creator is `ADMIN` and `ACTIVE`. An `ADMIN` can promote or demote other members (at least one `ADMIN` stays).
- Joining: on an `OPEN` club the Join button makes the player `ACTIVE` at once. On an `APPROVAL` club it becomes "Žiadosť o vstup" and creates a `PENDING` row; the club's admins see the pending requests (with the player's name and level) at the top of the Members tab and approve or reject each one. The player sees "Žiadosť odoslaná" with a Cancel option; a rejected request can be sent again after 7 days. Only `ACTIVE` members count in the member total, appear in the member list, and can leave. Switching a club from `APPROVAL` to `OPEN` does not auto-approve existing requests (the admin approves them, or a one-click "approve all" is offered). Only club admins (and city/super admins) can change the policy.
- `organisation_posts`: `id`, `organisation_id`, `author_player_id`, `body` (sanitised, plain text with links), optional image, `created_at`, `hidden`.
- `seasons.organisation_id` (nullable). Null = a league season or an admin tournament, exactly as today.
- Logos and covers use the same upload and storage pattern as the season hero photo (`season-heroes` on the persistent disk, only files in that folder are ever removed).

### Acting as a club (the profile switcher)

- A signed cookie `blta_acting_org` holds the organisation id the player has switched to; `POST /api/communities/act-as { organisationId | null }` sets or clears it. The server checks on **every** request that the logged-in player is an `ADMIN` of that organisation, so the cookie alone grants nothing.
- Switching changes the menu (Domov · Členovia · Udalosti · Profil klubu), the header shows the club with a green icon, and the club's "create" actions appear. The player's own identity (registrations, matches) never changes.

### Permissions (the heart of approach A)

- New helper `canManageSeason(req, season)`: true for an admin who passes the existing city scope, **or** for a logged-in player who is an `ADMIN` of `season.organisation_id` (and the organisation is not hidden).
- New middleware `requireSeasonManager` replaces `requireAdmin` **only** on the per-tournament routes: registrations (list, add, edit, delete, categories, remind, csv), draw, seeds, doubles pairs, schedule settings/auto/matches, season PATCH, hero/logo upload, groups, the bracket routes of that season (create bracket, node result), and `matches/:token/manual-result` plus match creation inside that season. It never opens a route that is not on this list.
- What an organiser cannot change on their tournament: `kind`, `organisation_id`, `league_id`. They cannot delete a tournament that has finished matches (only an admin can); they can delete an empty one.
- Everything else stays `requireAdmin`; the Backend stays closed to organisers. `cityScope.guard` is untouched (it only reacts to city admins); a city admin is allowed to hide any organisation or tournament of their own city, so `communities` is added to `CITY_AREAS` with a row-owner check by `league_id`.
- Registration lists contain phone and email, so they are returned only through the manager routes, for that tournament only.
- A test file (`scripts/check-communities-permissions.js`) must prove, with a real organiser, a member, another club's organiser, a visitor, a city admin and the super admin, that the allowed routes work and every other admin route returns 401/403.

### Creating a tournament

- `POST /api/communities/:id/tournaments` (not `POST /api/seasons`): forces `kind = TOURNAMENT`, `league_id` of the organisation, `organisation_id`, and enforces the open-tournament limit. The fields come from the wizard in the mockups: name, venue, start and end date, format (bracket | groups + play-off), singles or doubles, number of places, registration deadline, description and entry fee.
- After creation the tournament is managed with the existing screens, scoped to one tournament inside the club's manage view (the same pattern as the bracket tab inside the season card: `mountBracketAdmin(host, seasonId)`).

### Separation from the league

- Lists that show seasons or tournaments of the league exclude `organisation_id IS NOT NULL` (season list, home progress, league tables, rankings, "Hráči mesiaca", winners). The Harmonogram (`/api/schedule`) and the tournaments page include club tournaments in their own **"Tournaments of clubs and communities"** section, each labelled with and linking to its club.
- The public tournament page (registration, draw, bracket, timetable) is the existing one, with a "Organizer: <club>" line.

### Approval of clubs (added after the first design)

- `organisations.approved` (1 for a COMMUNITY from the start; 0 for a CLUB until the super admin approves it, `PATCH /api/communities/:id/approval { approved }`, super admin only, a club only; the super admin can take the approval back).
- Until it is approved a club is visible, editable and can be switched to (acting as) by its own admins only - and by the admins of the site - it is not in the public list, its page and its members and news answer 404 to everybody else, nobody can join it, and its page does not give its name to the page title. Its creator sees a notice "waiting for approval".
- Backend > Communities lists the clubs that wait first, with an Approve button that only the super admin sees.

### Removing a member and other rules found in the final review

- Removing a member (by an admin) is not a plain delete: the member's row becomes REJECTED, so he waits 7 days like a declined request; leaving by himself is a plain delete and he may join again at once.
- Deleting a player (Backend) removes him from every community and club; the member count and the "last admin" rule count real players only.
- The addresses `mine` and `act-as` are routes, so no organisation gets them as a slug (a club called "Mine" gets `mine-2`).
- Approving a request dates the membership from the approval. A new login clears the "acting as" cookie of the browser.

### Rating (default off)

- A match of a season with `organisation_id` counts for ranking points, badges and CourtIQ (singles and doubles) only if the organisation has `counts_for_rating = 1`. One helper `matchCountsForRating(row)` is called at the places listed under the constraints above. Existing rated matches are untouched. An admin can switch it on later for a trusted club.
- Reason: with no approval step, results are entered by the organiser, so they must not move public ratings by default.

### Pages

- `/komunity` (list: Discover, Mine, Events; create button), `/komunity/<slug>` (club page with cover, logo, members, Join / Leave, tabs Events · News · Members), manage view (when switched): club home with stats, news box, create tournament, and a tab of its tournaments with the existing management screens.
- Each is added to Backend > SEO and to the menu of every city site. On a city site only that city's organisations are listed; the national site lists all.
- A Backend page "Komunity a kluby" for admins: list, hide/unhide, the rating switch, the tournament limit.

### Moderation and abuse

- No approval for a community, but: city admin and super admin can hide an organisation, a post or a tournament; a limit of open tournaments per club; basic rate limit on creating organisations (per player per day); a hidden organisation disappears from every list and its manage view is closed.

## Phases (each can ship on its own)

1. **Communities core**: tables, list and club pages, create, join/leave, members, posts feed, logo and cover upload, switcher, menu item, SEO entries, Backend list with hide.
2. **Club tournaments**: permission helper and middleware with the permission tests, create wizard, Harmonogram and tournaments page integration, separation from the league, rating gate.
3. **Manage view**: registrations, draw, bracket result pencil, timetable for the organiser, scoped to their tournaments.
4. **Polish**: friendly "Create match" for members, notifications of new club events, promote/demote admins UI, rate limits and caps tuning.

## Decided by the user

- Name: "Komunity a kluby".
- No approval by city admins for anything. A community is public at once; a CLUB waits for the approval of the super admin (a city admin cannot approve).
- Joining is set per club: anyone, or only on approval by the club's admins.
- Approach A.
- Look: the site's design, as in the mockups.

## Calls I made (please check)

1. Club tournament results do **not** count for CourtIQ, ranking points or badges by default; an admin can switch it on per club.
2. Members-only tournaments are left out of v1 (the mockup showed the option); all club tournaments are public.
3. "Create match" (friendly match between members) is phase 4, not v1.
4. Each club picks "anyone can join" (default) or "only on approval"; a rejected player may ask again after 7 days; pending requests are visible to the club's admins only. Notifying admins of a new request is phase 4 (until then they see it on the Members tab).
5. Organisers can add walk-in players by name to their tournament, as admins can today; these are normal player rows that an admin can merge or delete.
6. Limits: 5 open tournaments per club, creating at most 3 organisations per player per day (both adjustable by an admin).

## Left to the builder

- Exact column names and migrations; file layout of the new routes (`src/routes/communities.js`) and pages; the markup and CSS of the pages (follow the existing classes and the mockups); the exact list of routes that get `requireSeasonManager` (start from the list above and verify each against the current code); where each season list and ranking query needs the `organisation_id IS NULL` filter (search every `FROM seasons` and ranking query); i18n keys; tests for each phase in the style of the existing `scripts/check-*.js`.
