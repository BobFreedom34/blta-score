# Seasons of communities and clubs - design

Status: built locally, not deployed. Builds on [communities and clubs](2026-10-28-communities-and-clubs-design.md), which listed "no club leagues" as a non-goal; this lifts it.

## Intent and why

A community or club could only run tournaments. A club that plays a longer, league-style competition (a Tuesday group playing each other over a few months) had no way to do it without a site admin. It can now make a **season**: a period with groups of its members and a table that builds up from the matches the members arrange themselves.

## Goals

- An admin of a public community or club makes a season on the front end (button "Vytvoriť sezónu" on the Events tab), then adds groups and their players on a manage page.
- Members arrange their own matches in the season (button "Dohodnúť zápas" on the season page, only for a member of a group); the table comes from the results.
- One season system: a club season is an ordinary `seasons` row with `kind = 'LEAGUE'` and an `organisation_id`, so groups, group members, standings, schedule generation, PATCH and DELETE are the existing routes (already `requireSeasonManager`).

## Non-goals and anti-goals

- No public registration and no play-off brackets for a club season (the club admin adds players to groups; the manage page hides those tabs).
- A club season must never appear in the league's season list, Harmonogram, matches lists, home page, "running season" of a city, SEO sitemap or ratings (same gate as club tournaments: `counts_for_rating`).
- A member must never be able to put a match into a season of the Backend, create a new player, or make a match he does not play.

## Approaches

- **A (chosen): reuse the season machinery.** New create/list routes plus UI; one permission addition for member-made matches.
- B: a separate light "club ladder" table. Rejected: duplicates groups, standings and match tagging.
- Match entry: organiser-only (no new permission) was the alternative; the user chose "members arrange their own matches".

## Design

- `POST /api/communities/:id/seasons` (admin of a public community/club): name, dates, venue, description; counts towards `max_open_tournaments` together with tournaments (open = end date empty or not past). `GET /api/communities/:id/seasons` lists them. `GET .../my-events` and `/feed` now also return seasons, told apart by `kind` (`LEAGUE` | `TOURNAMENT`).
- Member-made match (`POST /api/matches`, `clubTournaments.memberGroupFor`): allowed when the logged-in player is an active (not withdrawn) member of the `groupId` named, the group's season is a `LEAGUE` season of a public organisation, the match is singles, the player is one of the two, both are members of the group, and nobody new is created. The stage stays admin-only. Players then finish the match through the normal match access.
- Standings: a club season's table lists every group member from the start (0 played), not only players with matches. Each pair still counts once (first finished match), as in all tables.
- Group categories are Elite / Next Gen / Novice or **Bez kategórie** (`OPEN`, like a tournament without categories; only for a season of a club, the Backend's league seasons keep the three). The matches of an OPEN group have the category `OTHER` (`matchCategoryOf` in `seasons.js` and `matches.js`). Groups have free names. Default BLTA scoring.
- Season page: crumb shows the club, chip "Sezóna", no play-off phase in the progress bar, no registration button.
- Deleting: the club admin deletes a season with its matches while none is finished (an admin of the site always).
- Fixed leaks found on the way: `currentSeasonOf` and the city checklist ignored `organisation_id`; the sitemap and the share preview of `/season/<slug>` ignored a hidden or unapproved club.

## Calls I made (please check)

1. Seasons share the open-event limit (default 5) with tournaments.
2. A new season shows as a news card of the club and in the members' events.
3. Entry fee and prize text of the season form stay; draw date, registration switch and payment link are hidden for a club season.
4. Both players of a member-made match must be in the same group; a club admin can still enter any match of the season himself.

## Checks

`node scripts/check-club-seasons.js` (11 tests, own server on a temporary data directory); the older club and community checks were adjusted only where they looked for the exact tournament link or text.
