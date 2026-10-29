# Komunity a kluby - Phase 2 (club tournaments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin of a (public) community or club who has switched to its profile can create a tournament on the front end and run it there - registrations, draw, bracket or groups, timetable, results - without the Backend; the tournament shows on the club page and in the Harmonogram, stays out of the league, and does not move ratings unless the super admin allows it.

**Architecture:** A club tournament is an ordinary tournament season (`seasons.kind = 'TOURNAMENT'`) with a new `organisation_id`. The existing per-tournament admin routes (`src/routes/seasons.js`, `src/routes/brackets.js`, parts of `src/routes/matches.js`) keep working for admins and additionally accept the admin of the owning club, through ONE helper (`src/clubTournaments.js`: `canManageSeason`, `requireSeasonManager`) that replaces `requireAdmin` only on the listed routes. A club admin is never a site admin: every other admin route stays closed. Rating side effects go through one gate `matchCountsForRating(row)`.

**Tech Stack:** Node >= 22.5 (`node:sqlite`), Express 4, vanilla JS front end; tests are `scripts/check-*.js` files that start their own server.

**Spec:** `docs/superpowers/specs/2026-10-28-communities-and-clubs-design.md` (sections "Permissions", "Creating a tournament", "Separation from the league", "Rating"; phase 2 of its "Phases" list). Phase 1 (communities core) is live.

## Global Constraints

- A club tournament: `seasons.kind = 'TOURNAMENT'`, `seasons.organisation_id = <club id>`, `seasons.league_id = organisations.league_id`. An organiser can **never** change `kind`, `organisation_id` or `league_id` of it (the PATCH ignores them).
- Only a **public** organisation can have tournaments: not hidden, and (for a CLUB) approved by the super admin. Creating, and every organiser action on its tournaments, is refused (404) while it is hidden or not approved.
- Who may manage a club tournament: an admin of the site who passes the existing city scope (as today), or an `ACTIVE` `ADMIN` member of the owning organisation (`communities.isOrgAdmin`), checked on **every request** (a demoted admin loses it at once). Nobody else: a plain member, a visitor, an admin of another club, an organiser of a league season - all 401/403/404 as the route did before.
- A club admin does **not** become an admin: `auth.isAdmin`, `adminSession`, `requireAdmin`, `canSeePrivateFields` are not changed; routes not on the list below stay `requireAdmin`.
- A club may have at most **5 open tournaments** (`organisations.max_open_tournaments`, default 5, super admin changes it); "open" = `end_date` is empty or today or later. A club tournament is **public** (no members-only tournaments in this phase).
- Rating: results of a club tournament do **not** count for ranking points, badges, CourtIQ or the doubles rating unless `organisations.counts_for_rating = 1` (default 0, only the super admin changes it, `PATCH /api/communities/:id/rating`). Matches of league seasons and of admin tournaments (no `organisation_id`) are unchanged.
- Club tournaments do not appear in the league: the public season list (`GET /api/seasons`), the league tables, rankings, winners and the home page of the league never include a season with `organisation_id`; the Harmonogram (`/api/schedule`) and the club page do, labelled with the club (name + link).
- Registration lists contain phone and e-mail: they are returned only by the manager routes, for that tournament only.
- Every user-visible string goes through `t()` in `public/js/i18n.js` (SK and EN blocks); new public pages are listed in `src/seo.js`. Look: the site's own classes and tokens (see the phase 1 pages).
- Do not commit or push; the owner says "deploy" when ready. Run the check script after each task and the whole `scripts/check-*.js` set before reporting the plan done (re-run a script that fails under load alone before it counts as failed). After any web page change show the page in the built-in browser preview.

## Review Focus

1. Reaching a tournament that is not yours through every id the routes take: `/:id`, `/groups/:groupId`, `/registrations/:rid`, a pair id, a match token, a bracket id and node id - an organiser of club A must get 404/403 on club B's tournaments and on league seasons, on every one of the listed routes.
2. A route that stayed `requireAdmin` but is reachable through the new helper by mistake (or the reverse: a route of the editor that forgot the helper): an automated walk over all admin routes with an organiser cookie must find nothing open outside the allowed list.
3. The rating gate: the four places that award or replay (`syncBadgesIfFinished`, `syncCourtIQIfFinished`, `rankingPoints.reconcile` / `reverseForMatchWithChanges`, the doubles rating in `src/doubles.js`) **and** the rebuilds (`src/courtIQBackfill.js`, `scripts/backfillCourtIQ.js`, the admin "Run CourtIQ backfill") - a rebuild must not pull club matches in again; flipping `counts_for_rating` on later must make the existing results count (via the normal rebuild) and off must take them out.
4. State changes during the work: the club is hidden or its approval withdrawn, the organiser is demoted or removed, the tournament is deleted, the end date passes (the limit of 5) - the next request must see the new state.
5. Input: a tournament with end date before start, a name that is only symbols (slug), a 6th open tournament, singles vs doubles, categories sent as garbage, a `venue`/`info` with script text (displayed escaped / the existing sanitiser), a very long description.

---

### Task 1: Data, the permission helper, create and list a club's tournaments

**Files:**
- Modify: `src/db.js` (add `seasons.organisation_id INTEGER` + index, `organisations.counts_for_rating INTEGER NOT NULL DEFAULT 0`, `organisations.max_open_tournaments INTEGER NOT NULL DEFAULT 5`, each added with the `PRAGMA table_info` + `ALTER TABLE` pattern used at the end of the organisations block)
- Create: `src/clubTournaments.js`
- Modify: `src/routes/communities.js` (two routes below)
- Test: `scripts/check-club-tournaments.js` (new; copy the server-spawn / `call` / `makePlayer` / `makeOrg` helpers from `scripts/check-communities.js`; `makeOrg` approves a club through `PATCH /api/communities/:id/approval`)

**Interfaces:**
- Consumes: `communities.isOrgAdmin(orgId, playerId)`, `auth.getPlayerId`, `auth.adminSession`, `communities.siteAdminFor(req, org)`, `serializeSeason` and `uniqueSlug`/`slugify` of `src/routes/seasons.js` (export them from that file as `module.exports.serializeSeason` / `.uniqueSlug` / `.slugify` if they are not exported yet).
- Produces (`src/clubTournaments.js`):
  - `isPublicOrg(org): boolean` (not hidden, and `approved`)
  - `canManageSeason(req, season): boolean` - site admin who passes `cityScope` for that season's league, or (season has `organisation_id`, the organisation `isPublicOrg`, the logged-in player is `isOrgAdmin` of it)
  - `requireSeasonManager(resolve): middleware` where `resolve(req): seasonRow | null | undefined`; answers 401 for a visitor who is nobody, 404 when `resolve` finds no season, 403 when `canManageSeason` is false (a season the caller cannot manage must not reveal more than the old `requireAdmin` did: 401 for a non-admin without a player, 403 otherwise)
  - `openTournamentCount(orgId): number`, `seasonOfOrganisation(seasonId): organisationRow | undefined`
- Produces (HTTP): `POST /api/communities/:id/tournaments` body `{ name, startDate?, endDate?, venue?, playType: 'SINGLES'|'DOUBLES', categories?, entryFee?, info? }` -> 201 `serializeSeason` (organisation admin only via `needOrgAdmin`; 404 when the organisation is not public; 409 `{ error }` when the club already has `max_open_tournaments` open ones; 400 for the checks the admin route does: name 1-120, dates valid and not reversed, venue <= 200, `playType`); `GET /api/communities/:id/tournaments` -> `{ items: [serializeSeason + { organisation: { id, slug, name } }] }` (public, newest first; 404 when the organisation is not readable by the caller). `serializeSeason` gains `organisationId` (null for the others).

- [ ] **Step 1: Write failing tests** in `scripts/check-club-tournaments.js`: `a club admin creates a tournament: 201, kind TOURNAMENT, organisationId, league of the club, slug from the name`; `a plain member, a visitor and an admin of another club get 403/401/403`; `a hidden club and a club that is not approved answer 404 on create`; `6th open tournament is 409, one with an end date in the past does not count`; `validation: reversed dates, empty name, 121 characters, bad playType are 400; a name of only symbols still gets a clean slug`; `GET /api/communities/:id/tournaments lists them for everybody, newest first, and is 404 for a hidden club`; `the club's max_open_tournaments (changed directly in the temp database) is respected`.
- [ ] **Step 2: Run** `node scripts/check-club-tournaments.js` - Expected: FAIL (404).
- [ ] **Step 3: Implement** the columns, `src/clubTournaments.js` and the two routes; creation inserts the season exactly the way `POST /api/seasons` does (reuse its field checks by extracting them into a function in `seasons.js` that both routes call, rather than copying them) with `league_id` of the organisation and `organisation_id`.
- [ ] **Step 4: Run** `node scripts/check-club-tournaments.js` - Expected: all PASS; also run `node scripts/check-tournaments.js` and `node scripts/check-communities.js` (unchanged behaviour).

### Task 2: The organiser may run his tournament (routes of `seasons.js`)

**Files:** Modify `src/routes/seasons.js`, `src/clubTournaments.js` (resolvers); Test `scripts/check-club-tournaments.js`.

**Interfaces:**
- Consumes: Task 1's `requireSeasonManager`.
- Produces (`src/clubTournaments.js` resolvers, each `(req) => seasonRow | null`): `byParamId` (`req.params.id`), `byGroupId` (`req.params.groupId`, through `season_groups`), `byRegistrationId` (`req.params.rid`, through `season_registrations`), `byPairId` (`req.params.pairId`, through `tournament_pairs`).
- Routes that switch from `requireAdmin` to `requireSeasonManager(<resolver>)` (everything the tournament editor needs, nothing else): `POST /:id/hero`, `DELETE /:id/hero`, `POST /:id/logo`, `DELETE /:id/logo`, `GET /:id/registrations.csv`, `POST /:id/registrations/remind`, `GET /:id/registrations`, `POST /:id/registrations/categories`, `GET /:id/draw`, `POST /:id/seeds`, `POST /:id/draw`, `GET /:id/draw/groups-suggestion`, `POST /:id/draw/bracket`, `GET /:id/doubles`, `POST /:id/doubles/pairs`, `DELETE /:id/doubles/pairs/:pairId`, `DELETE /:id/draw/:category`, `PATCH /:id/schedule/settings`, `POST /:id/schedule/auto`, `PUT /:id/schedule/matches/:token`, `POST /:id/registrations/admin`, `PATCH /registrations/:rid`, `DELETE /registrations/:rid`, `PATCH /:id`, `DELETE /:id`, `POST /:id/groups`, `PATCH /groups/:groupId`, `DELETE /groups/:groupId`, `POST /groups/:groupId/members`, `PATCH /groups/:groupId/members/:playerId`, `DELETE /groups/:groupId/members/:playerId`, `POST /groups/:groupId/members/:playerId/withdraw`, `POST /groups/:groupId/members/import`, `GET /:id/schedule-preview`, `POST /:id/schedule`. (`POST /` creating a season stays `requireAdmin`; clubs use Task 1's route.)
- Rules inside those handlers: when the caller is an organiser (not a site admin) `PATCH /:id` ignores `kind`, `organisationId`, `leagueId`; `DELETE /:id` is refused 409 when the tournament has a finished match (an admin may still delete); `POST /:id/registrations/admin` may add a player by name as for admins.

- [ ] **Step 1: Write failing tests**: for every route of the list above, with a real tournament of club A: `organiser of A: not 401/403/404 (the route's own answer, e.g. 200/201/400 for a valid or empty body)`; `organiser of club B, a plain member of A, a visitor: 403/401 (never the route's own answer)`; `a league season and an admin tournament: an organiser gets 403`; `site admin: unchanged`; `the ids that name another thing (group of tournament B, registration of tournament B, pair of B) with the organiser of A -> 403/404`; `PATCH /:id as organiser keeps kind, organisationId, league`; `DELETE as organiser: ok for an empty tournament, 409 once a match is finished, an admin can delete either`; `demoted organiser, hidden club and withdrawn approval lose access on the next request`; `a registration list is returned to the organiser and to nobody else (phone/email present for him, 401/403 for a visitor)`. Build the route table in the test once (method, path template, body) and loop.
- [ ] **Step 2: Run** `node scripts/check-club-tournaments.js` - Expected: new tests FAIL (403).
- [ ] **Step 3: Implement** the resolvers and replace `requireAdmin` on exactly the listed routes (keep each handler's body; add the organiser rules above where the handler touches `kind`/`league_id`/delete).
- [ ] **Step 4: Run** the check script and `node scripts/check-tournaments.js`, `check-tournament-draw.js`, `check-tournament-schedule.js`, `check-season-registrations.js` - Expected: all PASS.

### Task 3: Brackets and matches of a club tournament

**Files:** Modify `src/routes/brackets.js`, `src/routes/matches.js`, `src/clubTournaments.js`; Test `scripts/check-club-tournaments.js`.

**Interfaces:**
- Produces resolvers: `byBracketId` (`req.params.id` through `brackets.season_id`), `byMatchToken` (`req.params.token` through `matches.season_id`).
- Switch to `requireSeasonManager`: `POST /api/brackets` (when the body's `seasonId` names a club tournament it requires the manager of that season; without `seasonId` it stays admin-only), `PATCH /:id`, `DELETE /:id`, `POST /:id/consolation`, `PATCH /:id/slots/:nodeId`, `PATCH /:id/nodes/:nodeId/result`, `DELETE /:id/nodes/:nodeId/result`; `GET /api/brackets` (the admin list) stays admin-only.
- `src/routes/matches.js`: `checkMatchAccess(req, res, row)` and `checkLiveScoreAccess(req, res, row)` also return true for `canManageSeason(req, season of row)`; `POST /api/matches` with a `seasonId` of a club tournament is allowed for its manager (the match gets `created_by_player_id` of the organiser, `league_id` of the season); an organiser may not pass a `seasonId` of anything else.

- [ ] **Step 1: Write failing tests**: `organiser creates a bracket for his tournament from a draw, enters a node result (PATCH) and the winner moves on`; `he creates a match inside the tournament, enters its result with manual-result, scores it live (start, score, finish)`; `the same calls on club B's tournament, on a league season and on a plain match are refused (403/404)`; `a plain member of the club cannot`; `POST /api/matches with seasonId of another club is 403`; `the bracket page shows the result for a visitor`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the check script and `check-doubles-tournament.js`, `check-doubles-bracket.js`, `check-tournament-formats.js`, `check-bracket-result-ui.js`, `check-match-format-g4.js` - Expected: all PASS.

### Task 4: The rating gate and its super-admin switch

**Files:** Modify `src/clubTournaments.js`, `src/routes/matches.js` (`syncBadgesIfFinished`, `syncCourtIQIfFinished`, the `rankingPoints.reconcile` call), `src/rankingPoints.js`, `src/doubles.js`, `src/courtIQBackfill.js`, `src/routes/communities.js`; Test `scripts/check-club-tournaments.js`.

**Interfaces:**
- Produces: `matchCountsForRating(row: { season_id? }): boolean` in `src/clubTournaments.js` (true when there is no season, no `organisation_id`, or the organisation has `counts_for_rating = 1`); `PATCH /api/communities/:id/rating` body `{ countsForRating?: boolean, maxOpenTournaments?: number (1-50) }` -> `OrgJson` with `countsForRating` and `maxOpenTournaments` added to `serialize()` (super admin only: `auth.requireSuperAdmin`; a city admin and a club admin are refused).
- Gate calls: `syncBadgesIfFinished` and `syncCourtIQIfFinished` return early when `!matchCountsForRating(row)`; the `rankingPoints.reconcile` call site passes a match that does not count as "earns nothing" (the previous award is still taken back); `src/doubles.js` leaves such matches out of `ratingStates` and of the badge counts; `src/courtIQBackfill.js` skips them in its rebuild.

- [ ] **Step 1: Write failing tests**: `a finished singles match of a club tournament: no CourtIQ history row, no ranking award, no badge progress; the same match in an admin tournament: counted (control)`; `a doubles match of a club tournament does not enter the doubles rating`; `the super admin sets countsForRating true: after the normal rebuild (the admin's "Run CourtIQ backfill" route) the club matches count; false again: they are out`; `the backfill never pulls a non-counting club match in`; `only the super admin may PATCH rating (club admin 403/401, city admin 403), values are checked (0 and 51 are 400)`; `a match of a league season is unchanged`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the gates, the route and the serializer fields.
- [ ] **Step 4: Run** the check script and `check-rankings.js`, `check-doubles.js`, `check-level-changes.js`, `check-winners.js` - Expected: all PASS.

### Task 5: Separation from the league, the Harmonogram and the club page data

**Files:** Modify `src/routes/seasons.js` (`GET /`, `GET /by-slug/:slug`), `src/routes/schedule.js`, `src/routes/leagues.js` / `src/seo.js` / `server.js` / other `FROM seasons` readers found by the search below; Test `scripts/check-club-tournaments.js`.

**Interfaces:**
- Search first: `grep -n "FROM seasons\|JOIN seasons" src/*.js src/routes/*.js server.js` (about 70 hits); every reader that lists or counts the seasons of the **league** adds `AND organisation_id IS NULL` (public season list, league tables, rankings, winners, home progress, nav season pills, sitemap lists of seasons are handled by their existing `kind != 'TOURNAMENT'` rules - verify each); readers by a given id or slug are left as they are.
- `GET /api/seasons/by-slug/:slug` for a club tournament answers 404 while its organisation is hidden or not approved; its JSON gains `organisation: { id, slug, name }` (null otherwise).
- `GET /api/schedule` items of a club tournament carry `organisation: { slug, name }`; the page `public/js/harmonogram.js` shows the club name on the card (a small tag "Organizer: <name>" linking to `/community/<slug>`), club tournaments of a hidden or unapproved club are not in it.

- [ ] **Step 1: Write failing tests**: `a club tournament is not in GET /api/seasons, not in the league tables data, not in rankings, not in the nav season data; it is in /api/schedule with its club; its public page answers 200 with organisation, 404 when the club is hidden or its approval withdrawn`; `the sitemap lists it like a tournament while public, not when the club is hidden`; `a league season and an admin tournament still appear everywhere as before`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the filters (one by one, each with the test line that proves it) and the schedule/page changes.
- [ ] **Step 4: Run** the check script and `check-seo.js`, `check-schedule-cards.js`, `check-tournaments.js`, `check-season-brackets-tab.js`, `check-city-pages.js` - Expected: all PASS.

### Task 6: Front end - create dialog, the Events tab, and the manage page

**Files:**
- Modify: `public/js/community.js` (button "Vytvoriť turnaj" in the club panel when acting, the Events tab lists the tournaments), `public/js/seasons-admin.js` (a club mode), `public/js/i18n.js`, `public/css/style.css`, `src/seo.js` + `server.js` (`TEMPLATE_ENTITY`) for the new page
- Create: `public/club-tournament.html` + `public/js/club-tournament.js` (code address `/community-tournament/:id`, SK `/turnaj-klubu/:id`, noindex; the page for the organiser: it mounts the existing tournament editor for that one tournament)
- Test: `scripts/check-club-tournaments-pages.js` (new, static + spawned-server checks in the style of `scripts/check-communities-pages.js`)

**Interfaces:**
- Consumes: Task 1-5 endpoints, `GET /api/communities/mine` (`acting`), `requirePlayerAuth`, `api`, `escapeHtml`, `t`.
- Produces: in the club panel (only when `isActing()`) a button opening a `.modal` form: name, venue, start, end, singles/doubles, categories (for singles), places is NOT asked (the existing editor has no places field), registration open, entry fee, description (plain textarea, sent as `info` and sanitised by the server); on success it goes to `/community-tournament/<id>`. The Events tab shows the club's tournaments as cards (date pill in lime, name, venue, registered count, a "Registrácia" or "Zobraziť" link to `/tournament/<slug>`), for an organiser also "Spravovať" -> the manage page. `club-tournament.js` loads `GET /api/communities/:orgId/tournaments`, finds the tournament, and calls `window.mountSeasonEditor(host, season, { club: true })` which is the existing season card of `seasons-admin.js` with club mode: the "new season" form, the "delete with all matches" button and every control whose endpoint is not in Task 2/3's lists are hidden. A test reads `public/js/seasons-admin.js` and checks that every `api('/...')` path it uses in club mode belongs to the allowed lists (a table in the test).

- [ ] **Step 1: Write failing tests**: `community.js has the create dialog and the Events tab with texts in both languages and escapes every field written by a player`; `club-tournament.html exists, is served at both addresses, is noindex, loads seasons-admin.js and club-tournament.js`; `seasons-admin.js club mode: every endpoint called is in the allowed table; the hidden controls are listed`; `all new keys exist in SK and EN`.
- [ ] **Step 2: Run** `node scripts/check-club-tournaments-pages.js` - Expected: FAIL.
- [ ] **Step 3: Implement**; verify in the built-in browser with a throwaway server (port 3559, temp `DATA_DIR`, `ADMIN_PASSWORD=test`): create a club (approve it as admin), switch to it, create a tournament, register two players from the public page, draw a bracket, enter a result in the drawn bracket, see it in the Harmonogram labelled with the club; check phone width.
- [ ] **Step 4: Run** the check script and `check-communities-pages.js`, `check-season-brackets-tab.js`, `check-schedule-tab.js` - Expected: all PASS.

### Task 7: The walk over all admin routes, and the final checks

**Files:** Create `scripts/check-club-tournaments-permissions.js`; Modify nothing else unless it finds a hole.

**Interfaces:**
- Produces: a check that reads every route of `src/routes/*.js` registered with `requireAdmin` / `requireSuperAdmin` (regex over `router.(get|post|put|patch|delete)('<path>', ... requireAdmin|requireSuperAdmin ...`), maps the file to its mount prefix from `server.js` (`app.use('/api/...', xRouter)`), fills `:param` with an id of a real tournament of another club (and with a plausible id), and calls each route as: a club admin (organiser of club A), a plain member, a visitor. Allowed for the organiser of A: exactly the routes of Tasks 2-3 **when the id belongs to club A's tournament**; for everything else, and for every route with ids of club B, the answer must be 401/403/404 (never 2xx, never 500).

- [ ] **Step 1: Write the walk**; run it before Task 2-3 are applied in a scratch state is not possible, so write it last and run it: Expected: PASS (if it finds a route that answers an organiser, fix that route and add its test line to the owning task's tests).
- [ ] **Step 2: Run the whole suite** `for f in scripts/check-*.js; do node $f || echo "FAILED $f"; done` (re-run any failure alone) - Expected: no `FAILED` line.
- [ ] **Step 3:** show the club page, the create dialog and the manage page in the built-in browser; report what could not be verified (real Render deploy, a real admin login).

## Self-review notes

- Spec coverage (phase 2): organisation_id on seasons, `requireSeasonManager` on the listed routes, immutability of kind/organisation/league, creation route with the limit and public-club rule, separation from the league and the Harmonogram label, rating default off with the super-admin switch, the create dialog and the manage page, the automated walk. Left for phase 3/4: friendly "Create match" of members, notifications of new club events, members-only tournaments.
- Names used across tasks: `canManageSeason`, `requireSeasonManager`, `isPublicOrg`, `openTournamentCount`, `matchCountsForRating`, resolvers `byParamId`, `byGroupId`, `byRegistrationId`, `byPairId`, `byBracketId`, `byMatchToken`; columns `seasons.organisation_id`, `organisations.counts_for_rating`, `organisations.max_open_tournaments`.
