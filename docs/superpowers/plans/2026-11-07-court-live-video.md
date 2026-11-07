# Court live video (tournaments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tournament organiser adds one YouTube link per court; each court with a link gets a "Live video" button in the Harmonogram, and a "Live video" tab embeds all the videos stacked under each other.

**Architecture:** One new text column `seasons.court_streams` (JSON array of 11-char video ids, index 0 = court 1, `""` = none). A small server module validates links with the existing `src/youtube.js` parser and serializes them as `courtStreams` (array of `{ videoId, url } | null`, length = court count) in the season payload, the schedule payload and the draw overview. The admin form and the draw page show one input per court; the public Harmonogram and tab read `courtStreams`.

**Tech Stack:** Node/Express + `node:sqlite`, vanilla JS pages (no build step), `scripts/check-*.js` assertion scripts that start their own server.

**Spec:** `docs/superpowers/specs/2026-11-07-court-live-video-design.md`

## Global Constraints

- Only tournaments (`kind = 'TOURNAMENT'`) have courts; league and club-season pages change nothing.
- Accepted links = whatever `parseVideoId` in `src/youtube.js` accepts (watch, youtu.be, /live/, /embed/, /shorts/, m.youtube.com); everything else (channel `/@name/live`, playlists, other sites) is refused with an error text containing "YouTube". Reuse that parser, do not write a second one.
- Embeds use `https://www.youtube-nocookie.com/embed/<id>?rel=0`, built from the validated id only (copy the iframe attributes of `public/js/match.js` ~line 877); the button links to `watchUrl(id)` with `target="_blank" rel="noopener"`.
- The "Live video" button is in the timeline and list views of the Harmonogram only, not in the full-screen TV page (`schedule-screen.js`).
- The "Live video" tab is the last tab (after Galéria) and exists only when at least one court has a link.
- Texts: Slovak and English through `tl()` / `i18n.js`; the label is "Live video" in both.
- No new public URL, so nothing to add in Backend > SEO.
- Do NOT commit or push: this project commits only after the user says "deploy" (then `git add` only the changed files). Run `node -c <file>` on every changed JS file.

## Review Focus

- Court count lowered after links were entered: links of the removed courts are dropped, the others keep their court.
- Court count raised: existing links stay on their courts, the new courts have none.
- A body with more links than courts, or a link that is not YouTube (a channel live page, `javascript:`), is refused with 400 and changes nothing.
- Only the 11-character id ever reaches the page (no raw link text in `href`/`src`).
- A gap (court 2 empty, courts 1 and 3 filled): the tab shows "Kurt 1" and "Kurt 3" with the right videos, no empty frame; the empty court has no button.
- A tournament with no links: no tab, no buttons, existing pages unchanged.

---

### Task 1: Storage, validation and API

**Files:**
- Create: `src/courtStreams.js`
- Modify: `src/db.js` (right after the `court_count` migration, ~line 1512), `src/routes/seasons.js` (`serializeSeason` ~line 184, `GET /:id/draw` ~line 612, `PATCH /:id` ~lines 1123-1144), `src/tournamentSchedule.js` (`getSchedule` return object, ~line 225)
- Test: `scripts/check-court-streams.js` (new; copy the server-start/`call`/`admin` scaffolding of `scripts/check-match-video.js`, create a tournament as `check-tournament-schedule.js` line 60 does)

**Interfaces:**
- Produces (`src/courtStreams.js`):
  - `parseCourtStreams(raw, courtCount) -> { ids: string[] } | { error: string }`: `raw` must be an array of strings, at most `courtCount` long; each entry is `''` (no video) or a link `parseVideoId` accepts; `ids` is padded with `''` to exactly `courtCount`. Error texts are English and the link errors contain "YouTube".
  - `streamsOf(season) -> Array<{ videoId: string, url: string } | null>`: length `season.court_count || 0`, built from `season.court_streams` (JSON; bad or missing JSON = no videos; extra entries cut, missing ones `null`); `url` is `watchUrl(videoId)`.
  - `fitToCount(season, newCount) -> string[]`: the stored ids cut or padded to `newCount` (used when the count changes and no list was sent).
- Produces (payloads): `courtStreams` = `streamsOf(season)` in `serializeSeason`, in the `/:id/draw` response and in `getSchedule` (top level, next to `settings`). PATCH `/api/seasons/:id` accepts `courtStreams: string[]`.

- [ ] **Step 1: Write the failing check script** `scripts/check-court-streams.js` with these tests (names and assertions):
  - `parser/helper`: `parseCourtStreams(['https://youtu.be/dQw4w9WgXcQ', ''], 3)` → `{ ids: ['dQw4w9WgXcQ', '', ''] }`; `parseCourtStreams(['a','b'], 1)` → error; `parseCourtStreams(['https://www.youtube.com/@bltatennis/live'], 1)` and `['javascript:alert(1)']` and `['https://vimeo.com/123']` → error containing "YouTube"; `parseCourtStreams('x', 2)` → error; `streamsOf({ court_count: 3, court_streams: '["dQw4w9WgXcQ"]' })` → `[{ videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, null, null]`; `streamsOf({ court_count: 2, court_streams: 'not json' })` → `[null, null]`.
  - `PATCH sets, serves and trims`: as admin make a tournament, PATCH `{ courtCount: 3, courtStreams: ['https://youtu.be/AAAAAAAAAAA', '', 'https://www.youtube.com/live/CCCCCCCCCCC'] }` → 200 and `courtStreams[2].videoId === 'CCCCCCCCCCC'`, `courtStreams[1] === null`; the same list in `GET /api/seasons/<slug>` (public), in the schedule response (find the URL in `routes/seasons.js:726`) and in `/api/seasons/<id>/draw`; then PATCH `{ courtCount: 2 }` alone → `courtStreams` length 2, court 1 still `AAAAAAAAAAA`; then PATCH `{ courtCount: 4 }` → length 4, last two `null`.
  - `bad input is refused and changes nothing`: `courtStreams` with a vimeo link, a `/@name/live` link, and a list longer than `courtCount` → 400 each; the stored list is unchanged afterwards.
  - `only the admin`: PATCH without cookie → 401 (or whatever the neighbouring season PATCH tests expect), nothing changes.
- [ ] **Step 2: Run `node scripts/check-court-streams.js`**; expected: FAIL (module `../src/courtStreams` not found).
- [ ] **Step 3: Implement** `src/courtStreams.js` (signatures above, requires `./youtube`), the migration `if (!seasonInfoColumns.includes('court_streams')) db.exec("ALTER TABLE seasons ADD COLUMN court_streams TEXT NOT NULL DEFAULT '[]'");` with a one-line comment like its neighbours, `courtStreams: courtStreams.streamsOf(s)` in `serializeSeason`, `getSchedule`, and the `/:id/draw` response. In `PATCH /:id`: after `courts` is computed, if `req.body.courtStreams !== undefined` run `parseCourtStreams(req.body.courtStreams, courts)` and return 400 `{ error }` on error, else `ids = fitToCount(season, courts)`; write it with its own `UPDATE seasons SET court_streams = ? WHERE id = ?` (JSON of `ids`) next to the existing `unregister_hours` update, so the long UPDATE statement is not touched.
- [ ] **Step 4: Run `node scripts/check-court-streams.js` and `node scripts/check-tournament-schedule.js` and `node scripts/check-tournaments.js`**; expected: all PASS.

### Task 2: Entering the links (tournament form and draw page)

**Files:**
- Create: `public/js/court-streams.js`
- Modify: `public/js/seasons-admin.js` (field after `courtCount` ~line 457; submit body ~line 641), `public/js/season-draw.js` (`render` ~line 259, the `courts` action ~line 361), the HTML page(s) that load those two scripts (find with `grep -ln "seasons-admin.js\|season-draw.js" public/*.html`), `public/css/style.css` (a few lines for the input list), `public/js/i18n.js` only if a shared label is needed
- Test: extend `scripts/check-court-streams.js`

**Interfaces:**
- Consumes: `courtStreams` from Task 1 (season payload / draw overview); `tl`, `escapeHtml` from `common.js`.
- Produces (`public/js/court-streams.js`, plain globals like the other page scripts):
  - `courtStreamFieldsHtml(count: number, streams: Array<{url}|null>) -> string`: a container `<div class="court-streams" data-court-streams>` with one labelled input per court (label `Kurt n` / `Court n` plus the text "Live video link"), `data-court-stream="n"`, `maxlength="300"`, `placeholder="https://youtube.com/…"`, value = the saved `url` or empty; nothing (empty string) when `count` is 0.
  - `readCourtStreams(root: Element) -> string[]`: the input values in court order, trimmed.
  - `syncCourtStreamFields(root: Element, count: number)`: after the court-count input changes, rebuilds the inputs for the new count keeping the values already typed (cut when fewer, empty when more).

- [ ] **Step 1: Write the failing test**: in `check-court-streams.js` a test `the pages carry the pieces` that fetches `/js/court-streams.js`, `/js/seasons-admin.js`, `/js/season-draw.js` and asserts: the helper file defines the three functions; `seasons-admin.js` contains `courtStreamFieldsHtml(` and `courtStreams: readCourtStreams(`; `season-draw.js` contains `courtStreamFieldsHtml(` and `courtStreams: readCourtStreams(`; and each HTML page that loads `seasons-admin.js` / `season-draw.js` also loads `/js/court-streams.js` before it.
- [ ] **Step 2: Run it**; expected: FAIL (file not found).
- [ ] **Step 3: Implement** the three helpers. In `seasons-admin.js` render `courtStreamFieldsHtml(s.courtCount, s.courtStreams)` right after the `courtCount` field (full-width, `sa-full`), call `syncCourtStreamFields` from an `input` listener on the `courtCount` input, and add `courtStreams: readCourtStreams(e.target)` to the tournament-only part of the PATCH body (the `...(IS_TOURNAMENT ? { venue…, courtCount… } : {})` object). In `season-draw.js` render the same fields inside the "Kurty" section above the save button, sync on the `.sd-courts` input, and send `{ courtCount, courtStreams: readCourtStreams(host) }` in the `courts` action; the note under the section is unchanged. The server error text is already shown by the existing error handling (`toast`/`errorEl`).
- [ ] **Step 4: Run `node scripts/check-court-streams.js`**; expected: PASS. Then `node -c public/js/court-streams.js public/js/seasons-admin.js public/js/season-draw.js`.
- [ ] **Step 5: Browser check** (preview server, throwaway tournament): set 3 courts → 3 inputs appear; type a link in each; save; reload the edit page → values are still there; set 2 courts → the third input disappears; a bad link shows the server's message and nothing is saved.

### Task 3: Public side (button in the Harmonogram, "Live video" tab)

**Files:**
- Modify: `public/js/court-schedule.js` (`csTimelineHtml` court heading line 131, `csListHtml` heading line 177), `public/js/season.js` (`availableTabs` ~line 756-775, `panelHtml` ~line 789, a new `liveVideoHtml()`), `public/js/i18n.js` (SK near line 439 and 457, EN near line 1990 and 2008), `public/css/style.css`
- Test: extend `scripts/check-court-streams.js`

**Interfaces:**
- Consumes: `courtStreams` (`Array<{videoId, url}|null>`) from the schedule payload (`csState.data.courtStreams`) and from the season payload (`season.courtStreams`).
- Produces: i18n keys `courts.liveVideo` ("Live video" in SK and EN) and `season.navLive` ("Live video" in SK and EN); `csLiveButtonHtml(court: number) -> string` in `court-schedule.js` (empty string when that court has no link); `liveVideoHtml() -> string` in `season.js`.

- [ ] **Step 1: Write the failing test**: extend `the pages carry the pieces` to assert: `court-schedule.js` contains `csLiveButtonHtml(` used in both the timeline and the list heading, and `target="_blank" rel="noopener"`; it does not appear in `schedule-screen.js`; `season.js` contains `key: 'live'`, `liveVideoHtml`, `youtube-nocookie.com/embed/`; `i18n.js` contains `'courts.liveVideo': 'Live video'` and `'season.navLive': 'Live video'` (twice each, SK and EN); `style.css` contains `.cs-live-btn` and `.sv-live`.
- [ ] **Step 2: Run it**; expected: FAIL.
- [ ] **Step 3: Implement.** `csLiveButtonHtml(court)`: reads `csState.data.courtStreams[court - 1]`, returns `<a class="cs-live-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">▶ ${escapeHtml(t('courts.liveVideo'))}</a>` or `''`; insert it in the court heading of the timeline (between the name span and the count) and of the list. In `season.js` add the tab `{ key: 'live', label: t('season.navLive'), has: (season.courtStreams || []).some(Boolean) }` as the last entry, add `'live'` to the tournament allow-list and to the "hide when empty" list (`['tables', 'playoff', 'final', 'live']`), render `liveVideoHtml()` for `tab === 'live'`: for each court that has a stream, in court order, a `<section class="sv-live-court">` with an `<h3>` `t('courts.court', { n })` and the lazy iframe (16:9 frame class `sv-live-frame`, same iframe attributes as the match page). Style: stacked full-width, 16:9 via `aspect-ratio`, spacing from the neighbouring `sv-*` rules; `.cs-live-btn` is a small pill in the app's orange (`--orange`) with 8px corners.
- [ ] **Step 4: Run `node scripts/check-court-streams.js`** (PASS) and `node -c` on the changed JS files.

### Task 4: Verify in the browser and note it in the README

**Files:**
- Modify: `README.md` (one line in the "how to make future edits" table: court live video → `src/courtStreams.js`, `public/js/court-streams.js`, `court-schedule.js`, `season.js`)

- [ ] **Step 1:** Start the preview (`preview_start` name `blta-score-dev`, or a throwaway server like `blta-seasons-test` if the dev DB has no tournament), log in as admin, make/open a tournament with 3 courts, add links to courts 1 and 3 (any valid 11-character ids), open the public tournament page: courts 1 and 3 show the "Live video" button in timeline and list view, court 2 does not; the button opens `youtube.com/watch?v=…` in a new tab; the "Live video" tab appears last, shows "Kurt 1" and "Kurt 3" with embedded frames stacked; removing all links hides the tab and the buttons; the full-screen page has no button. Check the console for errors and test a phone width (`resize_window` mobile).
- [ ] **Step 2:** Run the related checks once more: `node scripts/check-court-streams.js`, `check-tournament-schedule.js`, `check-schedule-tab.js`, `check-tournaments.js`.
- [ ] **Step 3:** Add the README line; show the user the result (screenshots) and wait for "deploy".
