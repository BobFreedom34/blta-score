# Add a match to a tournament by hand — short design (approved 2026-11-08; the "re-attach a detached match" part was left out by the user)

## Intent
The matches of a group or Swiss round are made only by the draw. When a round is wrong or a match is missing (the organiser made a mistake), there was no way to add a match to the tournament: the "Nový zápas" form makes an ordinary league match.

## Goals
- **Harmonogram tab, admin part** (next to "Poskladať rozvrh"): the button "+ Pridať zápas" opens a small form: group (when there are several), round (default: the last round), player 1 and player 2 (the players of that group), optionally a court and a time. Without a court and time the court planner places it by itself (when "Rozvrh skladá systém sám" is on and there is room), else it stays in "Nerozvrhnuté".
- The new match is a real match of the tournament's group in that round (category "Iné", the group's match format): it counts in the group table / Swiss standing and in the state of the round.
- Rules: both players are in the group and differ; a pair that already has a match in the group is refused unless the admin ticks "aj keď už hrali"; a player already in a match of that round is refused unless the same tick; a court that is taken at that time is refused and nothing is created. Allowed for who may manage the tournament (admin; the organiser of a club tournament), like placing a match.

## Non-goals
Knockout brackets and doubles tournaments (their structure is fixed); re-attaching matches that were left behind (the user dropped it); deleting a match (exists elsewhere).

## Approaches
One sensible way: a new endpoint pair on the season (`GET /:id/match-options`, `POST /:id/matches`) in a small module `src/tournamentMatches.js` that reuses `tournamentGroups.insertGroupMatch` (the one function that makes group matches) and `tournamentSchedule.placeMatch` / the planner, and a form in `court-schedule.js`.

## My calls
The round is limited to 1–99; a Swiss tournament accepts at most its number of rounds + nothing more (the extra match is for a round that exists). The player lists show "name" only. Creation and placing are one step: when the court or time is refused, nothing is created.
