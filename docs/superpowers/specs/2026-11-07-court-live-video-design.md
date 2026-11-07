# Court live video (tournaments) — short design, approved 2026-11-07

## Intent
Spectators of a tournament can watch each court live. The organiser adds one YouTube link per court when setting up the tournament.

## Goals
- One optional YouTube link per court, saved with the tournament.
- A "Live video" button in the header of each court that has a link (Harmonogram tab, timeline and list views); it opens that court's stream on YouTube in a new browser tab (the user's choice).
- A new "Live video" tab (after Galéria) that embeds every entered video stacked under each other, in court order, each under its court heading.

## Non-goals / anti-goals
- League seasons and club season pages (only tournaments have courts).
- The full-screen TV view of the schedule gets no button (my call: nothing to tap on a TV).
- No change to tournaments that have no links: they look exactly as before.

## Approaches
One sensible way fits the existing code: a text column with a JSON list on `seasons` (like the other per-tournament settings), edited in the existing tournament form and the Harmonogram settings box. A separate `court_streams` table was rejected: a court has no row of its own today, only `court_count`, so a table would add joins for a list of at most 50 strings.

## Decisions (the user approved all of these)
- Storage: `seasons.court_streams` TEXT (JSON array of strings, index 0 = court 1), migration in `src/db.js`; exposed in the season payload; written by the existing season PATCH (`src/routes/seasons.js`) together with `courtCount`.
- Entering: under "Number of courts" in the tournament form (`public/js/seasons-admin.js`) and in the Harmonogram settings box (`public/js/season-draw.js`) a "Live video link" field per court; the count changes the number of fields. Empty is allowed.
- Validation (server): accepted = `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/live/ID`, `youtube.com/embed/ID`; anything else refused with a clear message, including channel live pages (`/@name/live`), which YouTube cannot embed without a video ID. The list is cut to `court_count`.
- Button: in each court header in `public/js/court-schedule.js` (timeline and list), only for courts with a link, `target="_blank" rel="noopener"`.
- Tab: key `live` added to the tournament tab list in `public/js/season.js`; shown only when at least one link exists; iframes via `youtube-nocookie.com/embed/ID`, lazy-loaded.
- Texts in Slovak and English ("Live video" in both), through `tl()`/i18n like the neighbouring code.
- SEO: the tab is part of an existing page (no new public URL), so nothing new for Backend > SEO.

## Left to the builder
Exact markup/CSS of the button and the stacked embeds (match the existing court header and `sv-*` styles); the wording of the validation messages; a small `node scripts/check-court-streams.js` for the parser and the PATCH.
