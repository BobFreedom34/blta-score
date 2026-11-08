# Court scoreboard overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, transparent overlay page per court that shows the live match of that court (names + set scores), plus the overlay URL (with a Copy button) under the YouTube link of each court that has one.

**Architecture:** `tournamentSchedule.getCourtLive` picks the match (LIVE on that court, else the one finished in the last 3 minutes); a public endpoint `GET /api/seasons/by-slug/:slug/court/:n/live` serves it (404 for a court without a YouTube link); a standalone page `overlay.html` + `overlay.js` + `overlay.css` (no `common.js`, so no header, footer or menus) draws design A at 80% on a 1920x1080 stage and follows the score by Socket.IO `matches:changed` plus a 15 s poll; `court-streams.js` shows the URL in the admin pages.

**Tech Stack:** Node/Express + `node:sqlite`, vanilla JS, `scripts/check-*.js` check scripts that start their own server.

**Spec:** `docs/superpowers/specs/2026-11-08-court-overlay-design.md` (look: `mockups/court-overlay.html` design A, scaled by 0.8)

## Global Constraints

- Overlay URL: `/overlay/<tournament-slug>/<court>`; the page is public, `noindex`, fully transparent background, nothing drawn when there is no match to show.
- Only a court that has a saved YouTube link (`courtStreams.streamsOf(season)[court-1]` not null) has an overlay: the endpoint answers 404 for any other court (also for a court number outside 1..court_count, and for a hidden club tournament or another city's tournament, like `GET /api/seasons/by-slug/:slug`).
- Two matches LIVE on one court: the one that started last. After a match finishes its final score stays 3 minutes (`FINISHED_SHOW_MS = 180000`), then `match` is null. A LIVE match has precedence over a finished one.
- Sizes are design A of the mockup times 0.8: panel `left 56px / bottom 50px` on the stage, tag height 35px / 18px text, row height 59px, name 29px / 800, digits 32px / 800, set column 67px, panel min-width 512px, name padding 0 22px. Colours: panel `rgba(10,10,10,.84)`, lime `#b2fa06` (set in progress), orange `#ff5500` (court tab), loser's number `rgba(255,255,255,.5)`, loser's number in the lime column `rgba(10,10,10,.72)`, font Montserrat (as the app loads it). Tie-break points small superscript; a match tie-break set carries the label "MTB".
- Slovak texts ("Kurt n"); `?demo=1` draws a sample (Róbert Sloboda 6 3 / Peter Pálenek 1 2, tournament "Live Cup 2027", Kurt 1) whatever the data says.
- Do NOT commit or push until the user says "deploy" (then `git add` only the changed files). `node -c` every changed JS file. Mockups stay uncommitted.

## Review Focus

- A court without a YouTube link, a court number 0 / 99 / "abc", an unknown slug: 404, no data leaked.
- No live match and none finished in the last 3 minutes: the page is empty (transparent), not an error message on top of the video.
- A match that is LIVE but has no `court_no`, or is on another court: not shown on this court.
- Two LIVE matches on one court: the one that started last.
- A doubles match: both names ("A / B") fit one row without breaking the panel (long names are cut with an ellipsis, not wrapped).
- Names, tournament name and court come from the data and must be escaped; the page never puts raw text in HTML.
- The page must not pull in the app's header/footer/bottom bar or any cookie/install prompt (it does not load `common.js`).

---

### Task 1: Which match, and the endpoint

**Files:**
- Modify: `src/tournamentSchedule.js` (new `getCourtLive`, exported), `src/routes/seasons.js` (new route next to `GET /by-slug/:slug`, ~line 271)
- Test: `scripts/check-court-overlay.js` (new; copy the server-start / `call` / `admin` scaffolding of `scripts/check-court-streams.js`)

**Interfaces:**
- Consumes: `courtStreams.streamsOf(season)`, `serializeMatch(row, settings, now)`, `loadMatches(seasonId)` (all in `src/tournamentSchedule.js` / `src/courtStreams.js`).
- Produces: `getCourtLive(season, court: number, now = Date.now()) -> { court, tournament: string, match: null | { token, status: 'LIVE'|'FINISHED', player1: { name }, player2: { name }, winnerId, state: { currentSet, sets: [{ p1, p2, tiebreak, isSuperTiebreak, winner }] } } }`; `GET /api/seasons/by-slug/:slug/court/:n/live` returns that object (200) or `{ error }` (404).

- [ ] **Step 1: Write the failing check script** `scripts/check-court-overlay.js` with tests: (a) endpoint 404 for an unknown slug, for a tournament whose court has no link, and for court `0`, `99`, `abc`; (b) with courts=2 and a link on court 1 only: court 1 answers 200 `{ court: 1, tournament: 'Overlay Cup 2099', match: null }` (no match yet), court 2 answers 404; (c) create two players, a match in the tournament (`POST /api/matches` with `seasonId`; find how `check-tournament-schedule.js` makes matches of a tournament and puts one on a court through `PUT /api/seasons/:id/schedule/matches/:token { courtNo, scheduledAt }`), put it on court 1 as PLANNED → `match: null`; start it (find the start route in `routes/matches.js`) and score a couple of games → `match.status === 'LIVE'`, names correct, `state.sets[0]` has the games; a second LIVE match on court 1 started later wins; a LIVE match on court 2 does not show on court 1; (d) finish the match: still returned with `status: 'FINISHED'`; unit-call `getCourtLive(season, 1, Date.now() + 4 * 60000)` (require `../src/tournamentSchedule` and read the season row through `node:sqlite`, or test the 3-minute rule through a direct call with a fake row set if simpler) → `match: null`; (e) a LIVE match with `court_no` NULL never shows.
- [ ] **Step 2: Run `node scripts/check-court-overlay.js`**; expected: FAIL (404 / `getCourtLive` not a function).
- [ ] **Step 3: Implement** `getCourtLive` (rows of `loadMatches(season.id)` with both players and `court_no === court`; LIVE ones sorted by start (`ms(start_time) ?? ms(scheduled_at)`) descending, first wins; else the FINISHED one with the latest end (`ms(end_time) ?? ms(result_at)`) if `now - end <= FINISHED_SHOW_MS`; shape from `serializeMatch`) and the route (same city/hidden-club checks as `GET /by-slug/:slug`; court integer 1..`court_count` with a stream, else 404 `{ error: 'No live video on this court' }`).
- [ ] **Step 4: Run `node scripts/check-court-overlay.js` and `node scripts/check-court-streams.js` and `node scripts/check-tournament-schedule.js`**; expected: all PASS.

### Task 2: The overlay page

**Files:**
- Create: `public/overlay.html`, `public/js/overlay.js`, `public/css/overlay.css`
- Modify: `src/seo.js` (a utility-page entry like `screen`, key `overlay`, path `/overlay/:slug/:court`, file `overlay.html`, `noindex: true`, slugSk `prenos-skore`), `server.js` (template map entry like `screen: () => ({ name: 'Live screen' })`, ~line 445)
- Test: extend `scripts/check-court-overlay.js`

**Interfaces:**
- Consumes: the endpoint of Task 1.
- Produces: `GET /overlay/<slug>/<n>` serves `overlay.html` (noindex); `overlay.js` exposes nothing globally.

- [ ] **Step 1: Write the failing test**: `GET /overlay/some-slug/1` answers 200 HTML containing `/js/overlay.js` and `/css/overlay.css`, does NOT contain `common.js`, contains a noindex robots meta (or the `X-Robots-Tag` header the other noindex pages use; copy what `check-match-screen.js` asserts for `/screen/:token`); `GET /css/overlay.css` contains `background: transparent` and `.ov-tag`; `GET /js/overlay.js` contains `matches:changed`, `?demo=1` handling (`demo`), `escapeHtml` and `15000`.
- [ ] **Step 2: Run it**; expected: FAIL (404 for the page).
- [ ] **Step 3: Implement.** `overlay.js`: `slug` and `court` from the path; `load()` fetches the endpoint, 404 / error / `match: null` => empty stage; `render(data)` builds the panel (tag "Kurt n" + tournament name; one grid row per player: name, then a cell per started set; finished set: winner's number white, loser's dim; the set in progress (`state.currentSet`, status LIVE) is the lime column with the loser's number at 72% ink; a tie-break set shows the loser's tie-break points as a small `<sup>`; a super tie-break set gets a small "MTB" label; the finished match shows all sets finished, the winner row's numbers white); `scale()` sets `transform: scale(innerWidth / 1920)` on the stage (anchored bottom-left); `io()` `matches:changed` => debounced (300 ms) `load()`, plus `setInterval(load, 15000)`; `?demo=1` renders the sample and never fetches. Long names: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 560px`. All text through a local `escapeHtml`.
- [ ] **Step 4: Run the check** (PASS) and `node -c public/js/overlay.js`.
- [ ] **Step 5: Browser check** (preview server): `/overlay/<slug>/1?demo=1` shows design A at 80% on a transparent page (check `getComputedStyle(document.body).backgroundColor` is transparent and nothing else is drawn); with a real live match (use the throwaway server `blta-seasons-test`, make a tournament with court 1 + a link, a match on court 1, start it, score games) the page follows the score without a reload; with no live match it is empty.

### Task 3: Overlay URL in the admin pages

**Files:**
- Modify: `public/js/court-streams.js` (`courtStreamFieldsHtml(count, streams, slug)`, `courtStreamInputsHtml`, `syncCourtStreamFields`, copy handler), `public/js/seasons-admin.js` (the call, ~line 458: pass `s.slug`), `public/js/season-draw.js` (the call: pass `overview.slug`), `public/css/style.css` (a few lines)
- Test: extend `scripts/check-court-overlay.js`

**Interfaces:**
- Consumes: `courtStreams` (`[{ videoId, url } | null]`) and the tournament `slug`.
- Produces: `courtStreamFieldsHtml(count, streams, slug)`; for every court whose SAVED stream is non-null a read-only input with `${location.origin}/overlay/${slug}/${n}` and a button `data-copy-overlay`; a court without a saved link (also one with a link typed but not saved yet) shows no URL. The container keeps `data-slug` and `data-saved` (JSON array of booleans) so `syncCourtStreamFields` can redraw the URLs when the count changes.

- [ ] **Step 1: Write the failing test**: `court-streams.js` contains `data-copy-overlay`, `/overlay/`, `data-saved`; `seasons-admin.js` and `season-draw.js` call `courtStreamFieldsHtml(` with a third argument (`s.slug`, `overview.slug`); `style.css` contains `.court-overlay-url`.
- [ ] **Step 2: Run it**; expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces; the copy button uses `copyToClipboard` from `common.js` then `toast(tl('Odkaz skopírovaný', 'Link copied'))`, delegated on `document` once. Labels: "Odkaz na overlay pre PRISM / OBS" / "Overlay link for PRISM / OBS".
- [ ] **Step 4: Run the check** (PASS), `node -c` the three JS files.
- [ ] **Step 5: Browser check** on the throwaway server: a tournament with 3 courts and links on courts 1 and 3 shows URLs under those two only; Copy puts the URL on the clipboard and shows the toast; changing the court count to 2 removes court 3's URL; an unsaved typed link shows no URL until saved.

### Task 4: Docs and verification

**Files:**
- Modify: `README.md` (a line under "Live video of the courts")

- [ ] **Step 1:** README: the overlay page, URL form, the rules (only courts with a link, a match must be placed on a court, 3 minutes after the end, `?demo=1`, what PRISM needs: Web page source 1920x1080), the check script.
- [ ] **Step 2:** Run `node scripts/check-court-overlay.js`, `check-court-streams.js`, `check-tournament-schedule.js`, `check-tournaments.js`, `check-seo.js`, `check-match-screen.js`; expected: all PASS.
- [ ] **Step 3:** Show the user the result (screenshots of the demo overlay, a live overlay following a score, the admin URL rows) and wait for "deploy".
