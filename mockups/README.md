# Mockups

Design previews that are NOT part of the live app (this folder is not served by the server).

## autumn-finals-series-2026.html
How the blta.sk page https://www.blta.sk/project/autumn-finals-series-2026/ would look in the app's style:
header with category pills and facts, category cards, round schedule, group standings tables
(category + group tabs, all 11 groups) and the tiebreak rules.

- Open the file directly in a browser (it links to `../public/css/style.css`), or copy it to
  `public/` and open `http://localhost:3000/<name>.html` with the dev server running.
- Content and numbers were copied from blta.sk on 2026-10-03 and are a snapshot, not live data.
- To turn it into a real page: a route in `server.js`, data from the DB or a sheet instead of the
  hard-coded `DATA` object in the inline script, and the `.series-*` / `.grp-*` styles moved into
  `public/css/style.css`.

## home-1-player-hub.html, home-2-league-pulse.html, home-3-bento.html
Three homepage proposals (2026-10-04), sharing `home-shared.css`. Sample data only (names and numbers are made up
or copied from the tables, venue/times invented).
- A (player hub): personal view — next match, own group table, live matches, results, open opponent requests, top 5.
- B (league pulse): live match as the hero, season progress, league numbers, group leaders by category, results/schedule, ranking movers.
- C (bento): tile grid, everything at a glance on one screen.
To view with styles: copy the files into `public/` (e.g. `public/_mock/`) and change `../public/` to `/` and `home-shared.css` to `/_mock/home-shared.css`, then open via the dev server.
