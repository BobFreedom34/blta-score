# Court scoreboard overlay for the YouTube streams (tournaments) — short design, awaiting approval

## Intent
The organiser streams each court with PRISM Live Studio (connected to YouTube). PRISM can show a web page as a source on top of the camera picture. The app provides, per court, an overlay page with the live scoreboard of the match played on that court, so viewers on YouTube see names and score inside the video.

## Goals
- A public overlay page per court: `/overlay/<tournament-slug>/<court>` (e.g. `/overlay/live-cup-2027/1`), fully transparent background, drawn on a 1920 x 1080 stage scaled to the window (fits any source size).
- It shows the match that is LIVE on that court (`matches.court_no` = court, status LIVE) and follows the score by itself (Socket.IO `matches:changed` plus a poll every 15 s as a fallback).
- The look is design A of `mockups/court-overlay.html` at 80% of its first size: bottom-left panel, orange tab "Kurt n · <tournament name>", two rows (names, one column per set), finished sets quiet (loser's number dim), the set in progress as one lime column, tie-break points as a small superscript, "MTB" label for a match tie-break. Colours: panel rgba(10,10,10,.84), lime #b2fa06, orange #ff5500, Montserrat; the digits of the loser in the lime column keep 72% ink for contrast.
- Only courts that have a YouTube link get an overlay: in the tournament form and the Kurty box, under the link input of such a court, the overlay URL is shown (read-only, "Copy" button). A court without a link shows no URL, and its overlay route answers 404.
- Setup helper: `?demo=1` draws a sample scoreboard so the overlay can be placed in PRISM before any match is live.

## Non-goals / anti-goals
- Points inside a game (15/30/40) and a serve indicator: the app scores games, not points, so the overlay cannot show them.
- Putting the scoreboard on the stream without PRISM/OBS (server-side video compositing), controlling PRISM from the app, creating YouTube broadcasts through the API.
- Designs B and C of the mockup.
- Must not show anything over an empty court: with no live match the page is empty and transparent.

## Constraints
- A match appears only when it is placed on a court (`court_no`), which the court planner or the organiser does; a LIVE match with no court shows on no overlay. (Stated in the README.)
- The overlay page is public like all scores; it adds no new private data.
- noindex, like the other screen pages; no new public page for Backend > SEO beyond the existing "screen" style entry (the route is a utility page).

## Approaches
One sensible way fits the existing code: a small public endpoint `GET /api/seasons/by-slug/:slug/court/:n/live` returning the live match of that court (players, sets with tie-breaks, current set, status, tournament name, court) built with the same serializer as the schedule (`tournamentSchedule.serializeMatch`), and a static page + script like `screen.html`/`screen.js`. Reusing the whole schedule payload (`/api/seasons/:id/schedule`) was rejected: it sends every match of the tournament on each point.

## My calls (change if wrong)
- After a match finishes the final score stays on screen for 3 minutes, then the overlay empties.
- If two matches are LIVE on one court (a data slip), the one that started last is shown.
- Language: Slovak ("Kurt n"), no language switch.
- A paused match keeps showing its score (no "paused" mark).

## Left to the builder
Exact CSS values of the 80% size (scale every dimension of the mockup by 0.8; panel min-width, row height 59 px, name 29 px, digits 32 px), the endpoint's field names, the copy button wording, a `scripts/check-court-overlay.js`.
