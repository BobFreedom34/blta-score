# Komunity a kluby - Phase 1 (communities core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any logged-in player can create a community or club with its own page, news feed, members and a join policy (anyone / on approval); the creator can switch to the club's profile; a "Komunity a kluby" menu item leads to it. No tournaments yet (phase 2).

**Architecture:** A new `src/routes/communities.js` (mounted at `/api/communities`) owns three new tables (`organisations`, `organisation_members`, `organisation_posts`) created in `src/db.js`. Players are identified by the existing `blta_player` cookie (`auth.getPlayerId`); a new signed cookie `blta_acting_org` records "acting as this club" and is re-validated against the member table on every request. Pages are plain HTML + one JS file each, like `reservations.html`; SEO, menu and i18n follow the existing patterns.

**Tech Stack:** Node >= 22.5 (`node:sqlite` via `src/db.js`), Express 4, multer, vanilla JS front end, no build step, tests are `scripts/check-*.js` files that start their own server.

**Spec:** `docs/superpowers/specs/2026-10-28-communities-and-clubs-design.md` (phase 1 of its "Phases" list; phases 2-4 get their own plans after this one is live).

## Global Constraints

- Feature name in the menu and page titles: **"Komunity a kluby"** (EN: "Communities and clubs"); a record has `type` `CLUB` or `COMMUNITY` (label "Klub" / "Komunita"), same behaviour.
- `join_policy` is `OPEN` (default) or `APPROVAL`; a member `status` is `ACTIVE`, `PENDING` or `REJECTED` (a rejected request, kept so the 7-day wait can be enforced), a `role` is `ADMIN` or `MEMBER`.
- No approval by city admins for anything; city/super admins may **hide** an organisation afterwards. **Changed after this plan was written (owner's instruction):** a COMMUNITY is public at once, a CLUB needs the approval of the **super admin** (`organisations.approved`, `PATCH /api/communities/:id/approval`) and is seen only by its own admins and site admins until then - see the spec, "Approval of clubs".
- Limit: a player may create at most **3 organisations per 24 hours**.
- A rejected join request may be sent again after **7 days**; at least **one `ADMIN`** must always remain in an organisation.
- Only `ACTIVE` members count in the member total and appear in the public member list; pending requests are visible to the organisation's admins only.
- An organiser/club admin is never an "admin" in `src/auth.js` (`isAdmin` stays false): do not touch `adminSession`, `requireAdmin` or `canSeePrivateFields`.
- Look: the site's own classes and tokens (black `.card-dark` cards, `--fill-grey`, `--border-grey`, lime `--status-green`, orange `--orange` for buttons/active items, radii `--radius`, `--radius-md`, `--radius-sm`); mockups were shown to and accepted by the owner.
- Every user-visible string goes through `t()` in `public/js/i18n.js` with both the SK block and the EN block; every new public page is listed in `src/seo.js` (Backend > SEO).
- Images use the same pattern as venue photos (`src/routes/venues.js`): multer memory storage, files in a folder under `db.dataDir`, only files in that folder are ever deleted.
- Do not commit or push; the owner says "deploy" when ready. Run `node scripts/check-<name>.js` after each task and the whole `scripts/check-*.js` set before reporting the plan done.
- After any web page change, show the page in the built-in browser preview (owner's standing rule).

## Review Focus

1. A name with only symbols or diacritics (`"!!!"`, `"Športový klub Čadca"`): slug must still be non-empty, unique and URL-safe; a second club with the same name gets `-2`.
2. Script in a name, description or news text (`<img onerror=...>`): must render as text on every page (escape on output; posts stored as plain text).
3. The last `ADMIN` leaving, being demoted or removed: refused with a clear error, never an organisation nobody can manage; the creator leaving while other admins exist is fine.
4. A hidden organisation: 404 on its detail/members/posts for everybody except admins, absent from lists, cannot be joined or posted to, and acting as it is refused.
5. A stale or forged `blta_acting_org` cookie (membership removed after switching, organisation hidden, cookie for another player's club): the server must treat the player as not acting.

---

### Task 1: Schema, create / list / read / update an organisation

**Files:**
- Modify: `src/db.js` (append the three tables + indexes at the end, same `CREATE TABLE IF NOT EXISTS` style as `venues`)
- Create: `src/communities.js` (data helpers), `src/routes/communities.js`
- Modify: `server.js` (`require` the router near the other routers, `app.use('/api/communities', communitiesRouter);` next to `/api/venues`)
- Test: `scripts/check-communities.js` (new; copy the server-spawn / `call` / `cookieOf` skeleton from `scripts/check-faq.js`, add the helper `makePlayer(name, phone)` that does `POST /api/players {name}`, `PATCH /api/players/:id/phone {phone}`, `POST /api/player/login {code: phone}` and returns `{ id, cookie }`)

**Interfaces:**
- Consumes: `auth.getPlayerId(req)`, `leagues.actingIdOf(req)` (city to stamp), `req.league.id`, `db`.
- Produces (in `src/communities.js`):
  - `slugFor(name: string, exceptId?: number): string` (diacritics folded, lowercase, falls back to `'community'`, unique among `organisations.slug` with `-2`, `-3`)
  - `serialize(row, req): OrgJson` where `OrgJson = { id, slug, type, name, description, contact, logoUrl, coverUrl, joinPolicy, leagueId, hidden, memberCount, createdAt, me: null | { status: 'ACTIVE'|'PENDING'|null, role: 'ADMIN'|'MEMBER'|null, canRequestAgainAt: string|null } }` (`me` is `null` when the visitor is not a logged-in player; `memberCount` counts `ACTIVE` rows)
  - `memberOf(orgId, playerId): { role, status, decided_at } | undefined`
  - `isOrgAdmin(orgId, playerId): boolean` (`ACTIVE` + `ADMIN`)
- Produces (HTTP): `GET /api/communities` -> `{ items: OrgJson[] }` (this city's, hidden excluded, newest members-count first); `GET /api/communities/:slug` -> `OrgJson`; `POST /api/communities` body `{ type, name, description?, contact?, joinPolicy? }` -> 201 `OrgJson` (401 if no player identity, 400 invalid, 429 over the limit); `PATCH /api/communities/:id` body `{ name?, description?, contact?, joinPolicy? }` -> `OrgJson` (organisation admin only; `type` and `slug` never change).
- Table columns: `organisations(id, league_id, type, name, slug UNIQUE, description, contact, logo_url, cover_url, join_policy DEFAULT 'OPEN', hidden DEFAULT 0, created_by_player_id, created_at)`; `organisation_members(organisation_id, player_id, role, status, joined_at, decided_at, PRIMARY KEY (organisation_id, player_id))`; `organisation_posts(id, organisation_id, author_player_id, body, hidden DEFAULT 0, created_at)`.

- [ ] **Step 1: Write failing tests** in `scripts/check-communities.js`: `a visitor cannot create (401)`; `a player creates a club: 201, slug from the name, creator is ADMIN/ACTIVE (me.role === 'ADMIN'), memberCount 1, joinPolicy defaults to OPEN`; `type must be CLUB or COMMUNITY, name 1-120 chars, description <= 2000, contact <= 200 (400 otherwise)`; `slug of "!!!" is non-empty and a second "Utorkáči" gets utorkaci-2`; `the 4th creation by one player within a day is 429 while another player can still create`; `list shows it, detail by slug works, unknown slug 404`; `only an organisation admin can PATCH (a non-member and a visitor get 403/401), joinPolicy accepts OPEN|APPROVAL only, type in the body is ignored`.
- [ ] **Step 2: Run** `node scripts/check-communities.js` - Expected: FAIL (404 on `/api/communities`).
- [ ] **Step 3: Implement** the tables in `src/db.js`, the helpers in `src/communities.js` and the five routes above in `src/routes/communities.js`; creation inserts the organisation and the creator's `ADMIN`/`ACTIVE` member row in one `BEGIN`/`COMMIT`; the 24-hour limit counts `organisations.created_by_player_id` rows in the last 24 h; the name is trimmed and internal whitespace collapsed; `league_id` is `leagues.actingIdOf(req)`.
- [ ] **Step 4: Run** `node scripts/check-communities.js` - Expected: all PASS.

### Task 2: Membership and join policy

**Files:**
- Modify: `src/routes/communities.js`, `src/communities.js`
- Test: `scripts/check-communities.js`

**Interfaces:**
- Consumes: Task 1's `memberOf`, `isOrgAdmin`, `serialize`.
- Produces (HTTP, all under `/api/communities/:id`, `:id` is the numeric organisation id):
  - `POST /join` -> `{ status: 'ACTIVE' | 'PENDING' }` (OPEN: `ACTIVE` at once; APPROVAL: `PENDING`; idempotent for an existing row; 429-style 409 `canRequestAgainAt` when rejected < 7 days ago)
  - `POST /cancel-request` -> `{ ok: true }` (removes a `PENDING` row of the caller)
  - `POST /leave` -> `{ ok: true }` (an `ACTIVE` member; refused 409 if the caller is the last `ADMIN`)
  - `GET /members` -> `{ members: [{ playerId, name, slug, role, joinedAt }], pending: [{ playerId, name, slug, requestedAt, level }] }` (`pending` is `[]` unless the caller is an organisation admin; `level` is the player's `courtiq_ratings.rating` rounded to 1 decimal or `null`)
  - `POST /members/:playerId/approve` and `/reject` (admin; approve sets `ACTIVE`, reject sets `REJECTED` and `decided_at`), `POST /approve-all` (admin, approves every `PENDING`), `PATCH /members/:playerId` body `{ role: 'ADMIN'|'MEMBER' }` (admin; demoting the last admin refused 409), `DELETE /members/:playerId` (admin removes an `ACTIVE` member; the last admin cannot be removed).
- Note: store a rejection as `status = 'REJECTED'` with `decided_at`; `REJECTED` rows are never listed or counted, and `join` after 7 days turns them back into `PENDING`/`ACTIVE`. `serialize().me.status` reports `null` for `REJECTED` and fills `canRequestAgainAt`.

- [ ] **Step 1: Write failing tests**: `OPEN club: join makes ACTIVE, member count 2, joining twice is idempotent`; `APPROVAL club: join is PENDING, not counted, not in the public list, shown to an admin in pending with a level field, hidden from a plain member`; `approve makes ACTIVE and counted, reject keeps them out, a second join within 7 days is 409 with canRequestAgainAt, and after back-dating decided_at by 8 days (open the temp database file in the test with node:sqlite's DatabaseSync, path join(dir, 'blta-score.db'), and UPDATE organisation_members) a join is PENDING again`; `cancel-request removes a pending row`; `approve-all approves every pending`; `a non-admin cannot approve/reject/promote/remove (403)`; `the last admin cannot leave, be demoted or be removed (409) but can after promoting another`; `switching a club to OPEN does not approve pending requests`; `a visitor joining is 401`.
- [ ] **Step 2: Run** `node scripts/check-communities.js` - Expected: new tests FAIL (404).
- [ ] **Step 3: Implement** the routes; every mutation re-reads membership inside the handler (no trusting the client); counts via `SELECT COUNT(*) ... status = 'ACTIVE'`.
- [ ] **Step 4: Run** the same command - Expected: all PASS.

### Task 3: News feed

**Files:** Modify `src/routes/communities.js`; Test `scripts/check-communities.js`.

**Interfaces:**
- Consumes: `isOrgAdmin`, `memberOf`.
- Produces (HTTP): `GET /api/communities/:id/posts?before=<postId>` -> `{ items: [{ id, body, authorName, authorSlug, createdAt, canDelete }], more: boolean }` (page size 20, newest first, `canDelete` true for the author, an organisation admin or an admin); `POST /:id/posts` body `{ body }` -> 201 item (organisation admin only; trimmed, 1-2000 chars, stored as plain text with `<`, `>` kept verbatim - the pages escape on output); `DELETE /:id/posts/:postId` (author, organisation admin or admin; sets nothing hidden, deletes the row).

- [ ] **Step 1: Write failing tests**: `an admin posts, anyone reads (posts are public)`; `a plain member and a visitor cannot post (403/401)`; `empty and 2001-char bodies are 400`; `a body containing <img src=x onerror=alert(1)> is returned verbatim as a string`; `delete by the author works, by an unrelated member is 403`; `20 per page and more:true with before=`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the three routes.
- [ ] **Step 4: Run** - Expected: all PASS.

### Task 4: Logo and cover uploads

**Files:** Modify `src/routes/communities.js`, `server.js` (static `app.use('/community-images', express.static(path.join(db.dataDir, 'community-images'), { maxAge: '30d' }));` next to `/season-heroes`); Test `scripts/check-communities.js`.

**Interfaces:**
- Produces (HTTP): `POST /api/communities/:id/logo` and `POST /api/communities/:id/cover` (multipart field `image`, png/jpeg/webp, <= 6 MB, organisation admin only) -> `OrgJson` with the new `logoUrl` / `coverUrl` (`/community-images/<id>-logo-<random>.<ext>`); `DELETE` on the same paths clears it and removes the old file. Old file removed when replaced. Only paths starting with `/community-images/` are ever unlinked.

- [ ] **Step 1: Write failing tests** (use `FormData` + `Blob` with a tiny 1x1 png buffer): `admin uploads a logo, logoUrl starts with /community-images/ and the file is served (200 image/png)`; `a non-admin member gets 403`; `a text/plain file is rejected 400`; `replacing removes the old file (old URL becomes 404)`; `DELETE clears the url`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** following `src/routes/venues.js` (`PHOTO_DIR`, `MIME_EXT`, `photoUpload`, `deletePhotoFile`); the photo is optional so the organisation stays valid without one.
- [ ] **Step 4: Run** - Expected: all PASS.

### Task 5: Hide an organisation (moderation) and the Backend page

**Files:**
- Modify: `src/routes/communities.js`, `src/cityScope.js` (add `'communities'` to `CITY_AREAS` and a `case 'communities': return id(a) ? one('SELECT league_id FROM organisations WHERE id = ?', id(a)) : undefined;` in `leagueOfAddress`)
- Create: `public/communities-admin.html`, `public/js/communities-admin.js`
- Modify: the Backend tab bar on the other `*-admin.html` pages (add one tab "Komunity a kluby" linking to `/communities-admin`; find the bar by searching an existing `tournaments-admin` link)
- Test: `scripts/check-communities.js`, `scripts/check-communities-admin.js` (new, static: file exists, script included, tab present on every admin page, in the style of `scripts/check-schedule-tab.js`)

**Interfaces:**
- Produces (HTTP): `PATCH /api/communities/:id/moderation` body `{ hidden: boolean }` (`requireAdmin`; a city admin only for his own city's organisation - enforced by `cityScope.guard`); `GET /api/communities?includeHidden=1` returns hidden ones too **only for an admin** (ignored otherwise). Hidden organisations: detail, members, posts return 404 to everybody except an admin; `join`, `posts` POST and `act-as` refuse (404).

- [ ] **Step 1: Write failing tests** in `check-communities.js`: `an admin hides a club: it vanishes from the list, its detail is 404 for a visitor and a member but 200 for the admin`; `a hidden club cannot be joined or posted to`; `a player cannot call moderation (401/403)`; `a city admin of another city cannot hide it (403), the city admin of its own city can` (create the city admin the way `scripts/check-city-admin-pages.js` does).
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the route and the hidden checks (one helper `visibleOr404(req, res, row)` in `src/communities.js` used by every `/:id` and `/:slug` route), then the Backend page: a table (name, type, city, members, hidden toggle) fed by `GET /api/communities?includeHidden=1`, using `checkAdmin()` and the layout of `public/venues-admin.html`.
- [ ] **Step 4: Run** both check scripts - Expected: all PASS.

### Task 6: Acting as a club (server side)

**Files:** Modify `src/auth.js` (only two new small exports, see below - nothing existing changes), `src/routes/communities.js`; Test `scripts/check-communities.js`.

**Interfaces:**
- Produces in `src/auth.js`: `ACTING_ORG_COOKIE = 'blta_acting_org'`, `getActingOrgId(req): number | null` (reads the signed cookie only; never grants anything alone).
- Produces in `src/communities.js`: `actingOrganisation(req): OrgRow | null` (returns the organisation only if the cookie id exists, is not hidden and the logged-in player is `ACTIVE` `ADMIN` of it; otherwise `null`).
- Produces (HTTP): `POST /api/communities/act-as` body `{ organisationId: number | null }` -> `{ acting: OrgJson | null }` (401 without a player; 403 if the player is not an `ADMIN` of it; `null` clears the cookie; it is cleared too on player logout - `POST /api/player/logout` in `src/routes/player.js` calls `res.clearCookie(ACTING_ORG_COOKIE, ...)` with the same options as `logOutPlayer`); `GET /api/communities/mine` -> `{ items: [OrgJson], acting: OrgJson | null }` (every organisation where the caller is `ACTIVE`; `acting` is `actingOrganisation(req)` serialized).

- [ ] **Step 1: Write failing tests**: `an admin switches to the club: /mine reports acting`; `switching to a club the player only belongs to as MEMBER is 403`; `switching to a club of somebody else is 403`; `after the admin is demoted /mine reports acting: null although the cookie is still sent`; `after the club is hidden acting is null`; `act-as null clears it`; `logout clears it`; `a forged unsigned cookie value gives acting: null`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the two helpers, the two routes and the logout clearing; cookie options reuse `cookieOptions()` shape (signed, httpOnly, sameSite lax, 30 days) - export a `setActingOrg(res, id)` / `clearActingOrg(res)` pair from `src/auth.js` rather than exporting `cookieOptions`.
- [ ] **Step 4: Run** - Expected: all PASS.

### Task 7: List page `/communities` and the create dialog

**Files:**
- Create: `public/communities.html` (skeleton copied from `public/reservations.html`, `<title data-i18n="page.communitiesTitle">`), `public/js/communities.js`
- Modify: `public/css/style.css` (append a `/* communities */` block: `.com-card`, `.com-logo`, `.com-badge`, `.com-tabs`, using the tokens in Global Constraints), `public/js/i18n.js` (SK + EN keys, prefix `com.` and `page.communitiesTitle`), `src/seo.js` (a `PAGES` entry `{ key: 'communities', label: 'Communities and clubs', path: '/communities', file: 'communities.html', blta: null, slugSk: 'komunity-a-kluby', title, description }` and an `ENGLISH.communities` entry `{ slug: 'communities', title, description }`, following `reservations`)
- Test: `scripts/check-communities-pages.js` (new, static file checks in the style of `scripts/check-schedule-cards.js` plus a spawned-server check that `/communities` and `/en/communities` (use `seo.pageUrl`) answer 200 with the SEO title)

**Interfaces:**
- Consumes: `GET /api/communities`, `GET /api/communities/mine`, `POST /api/communities`, `loadSession()`, `api()`, `escapeHtml()`, `t()`, `playerAuthed`, `currentPlayerId`.
- Produces: the page with three tabs "Objaviť" (all, each card = logo or initials circle, name, type badge `KLUB`/`KOMUNITA`, city, member count, link to `/community/<slug>`), "Moje" (from `/mine`), "Udalosti" (empty state "Čoskoro" until phase 2), and a "Vytvoriť komunitu alebo klub" button that opens a `.modal` form (type, name, description, contact, join policy radio) and, for a visitor who is not logged in, opens the existing player login instead (find the function the "PRIHLÁSIŤ SA" link calls in `common.js`); on success it navigates to the new club's page.

- [ ] **Step 1: Write failing tests**: `communities.html exists, includes common.js, i18n.js and communities.js`; `all com.* keys used in communities.js exist in both the SK and EN blocks of i18n.js` (parse the keys with a regex on `t('com.…')`); `/communities answers 200 and its <title> contains "Komunity a kluby"`; `no inline user text is inserted without escapeHtml` (grep `innerHTML` lines of communities.js and require `escapeHtml(` in each template that interpolates a field of an organisation).
- [ ] **Step 2: Run** `node scripts/check-communities-pages.js` - Expected: FAIL.
- [ ] **Step 3: Implement** the files above; show the page in the built-in browser preview at 375 px and desktop width, with at least two seeded clubs (log in as a seeded player on a local throwaway server with `ADMIN_PASSWORD=test`).
- [ ] **Step 4: Run** `node scripts/check-communities-pages.js` - Expected: all PASS.

### Task 8: Club page `/community/<slug>`

**Files:**
- Create: `public/community.html`, `public/js/community.js`
- Modify: `public/css/style.css` (`.com-cover`, `.com-head`, `.com-panel`), `public/js/i18n.js`, `src/seo.js` (`PAGES` entry `{ key: 'community', path: '/community/:slug', file: 'community.html', template: true, slugSk: 'komunita', ... title: '{name}' + SUFFIX }`, `ENGLISH.community`), `server.js` (`TEMPLATE_ENTITY.community = (slug, lang, leagueId) => { const o = db.prepare('SELECT name, logo_url, cover_url FROM organisations WHERE slug = ? AND league_id = ? AND hidden = 0').get(slug, leagueId); return o ? { name: o.name, image: o.cover_url || o.logo_url || '' } : null; }`)
- Test: `scripts/check-communities-pages.js`

**Interfaces:**
- Consumes: the Task 1-6 endpoints.
- Produces: the page for a visitor/player: cover (the picture, or a grey gradient when none), logo circle with a lime ring, name, `Klub|Komunita · city · N členov`, the join button by state (`Pridať sa` for OPEN, `Žiadosť o vstup` for APPROVAL, `Žiadosť odoslaná` + `Zrušiť` for PENDING, `Opustiť` for an `ACTIVE` member; a visitor who is not logged in gets the login dialog), tabs `Udalosti` (placeholder "Žiadne nadchádzajúce udalosti" - phase 2 fills it), `Novinky` (posts, "Zobraziť staršie"), `Členovia` (names linking to `/player/<slug>`). For an organisation admin who is **acting as this club** (Task 6 `mine.acting.id === org.id`) an extra panel shows: a news box with "Zverejniť", the pending requests (name, level, `Schváliť` / `Zamietnuť`, `Schváliť všetkých`), the members with `Povýšiť` / `Odobrať`, a settings form (name, description, contact, join policy) and logo/cover upload buttons. A hidden or unknown slug shows the "not found" state of the other detail pages.

- [ ] **Step 1: Write failing tests**: `community.html includes its script and every com.* key exists in SK and EN`; `/community/<slug> of a real club answers 200 with the club name in <title>` and `an unknown or hidden slug does not put a name in the title`; `community.js escapes organisation and post fields` (same grep check as Task 7).
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement**; verify in the built-in browser: visitor view, member view, pending view, acting-admin view with a pending request approved and a post published, plus a name `<b>x</b>` rendered as text.
- [ ] **Step 4: Run** `node scripts/check-communities-pages.js` - Expected: all PASS.

### Task 9: Profile switcher and club menu

**Files:** Modify `public/js/common.js` (account menu + header items), `public/css/style.css` (`.acting-chip`), `public/js/i18n.js`; Test `scripts/check-communities-pages.js`.

**Interfaces:**
- Consumes: `GET /api/communities/mine`, `POST /api/communities/act-as`, the account menu `#auth-menu-panel`, the code that fills `#header-dynamic-items` (find it in `common.js`; it builds the menu from `/api/header-items`).
- Produces: for a logged-in player who is `ADMIN` of at least one organisation, the account menu lists "Môj profil" (marked ✓ when not acting) and each of their clubs (green initials circle, `správca`), and "＋ Vytvoriť komunitu alebo klub" (links to `/communities` and opens the create dialog); choosing one calls `act-as` and reloads. While acting: a green chip with the club name and `✕` (back to own profile) in the topbar, and `#header-dynamic-items` is replaced by four links `Domov` -> `/community/<slug>`, `Členovia` -> `/community/<slug>#members`, `Udalosti` -> `/community/<slug>#events`, `Profil klubu` -> `/community/<slug>#settings`. A player with no admin role sees no switcher and no extra request cost beyond one `GET /communities/mine` per page load (reuse `loadSession()` caching idea; skip the call for a visitor).

- [ ] **Step 1: Write failing tests** (static, `check-communities-pages.js`): `common.js calls /communities/mine only after a player session` (the string `communities/mine` appears and is guarded by `currentPlayerId`); `common.js contains the act-as call and the acting chip class`; `all new keys exist in SK and EN`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement**; verify in the built-in browser: switch to a club, see the chip and the club menu, click ✕, see the normal menu return; check mobile width.
- [ ] **Step 4: Run** - Expected: all PASS.

### Task 10: Main menu item and final checks

**Files:** Modify `src/seasonSeed.js` (add `ensureCommunitiesMenuItem(db)` exported next to `ensureScheduleMenuItem`, same shape: app_flags key `menu_communities_added`, inserted once after `/harmonogram`'s sibling `/vitazi` else at the end, labels `Komunity a kluby` / `Communities and clubs`, link `/communities`), `server.js` (call it in the same try/catch block style as `ensureWinnersMenuItem`); Test `scripts/check-communities-pages.js`, `scripts/check-seo.js` (extend only if it enumerates pages and now fails).

**Interfaces:**
- Produces: a main menu entry "Komunity a kluby" on every city site that has a menu (the flag is per database; each city's own menu items are managed in Backend > Menu, so the new item is added for the league the existing helpers add to - follow `ensureScheduleMenuItem` exactly).

- [ ] **Step 1: Write failing tests**: `a fresh database has a header item with link /communities and both labels`; `running ensureCommunitiesMenuItem twice adds one item`; `/sitemap.xml lists /communities`; `Backend > SEO lists the communities and community pages` (GET `/api/seo` as admin and look for the two keys).
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the helper and the call; then run the complete suite: `for f in scripts/check-*.js; do node $f || echo "FAILED $f"; done`.
- [ ] **Step 4: Run** the suite - Expected: no `FAILED` line; then show `/communities`, a club page and the Backend page in the built-in browser and report what could not be verified (real admin login, real Render deploy).

## Self-review notes

- Spec coverage (phase 1 of the spec): organisations + types, join policy with approval flow, members/pending/promote/remove, news feed, logo and cover, list and club pages, switcher with club menu, menu item, SEO, Backend list with hide, `cityScope`, rate limit of 3/day, last-admin rule. Deliberately **not** here (later phases): tournaments, `organisation_id` on seasons, `counts_for_rating`, `max_open_tournaments`, permission helper `requireSeasonManager`, Harmonogram integration, friendly "Create match", notifications of join requests.
- Type names match across tasks: `OrgJson`, `memberOf`, `isOrgAdmin`, `actingOrganisation`, `ACTING_ORG_COOKIE`, status `REJECTED` introduced in Task 2 and honoured in Task 1's `serialize`.
