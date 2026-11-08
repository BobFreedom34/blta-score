# Playing times per day of a tournament; no registration after the start — short design, approved 2026-11-08

## Intent
A tournament had ONE playing day (start and end time) for all its days, so the court planner could not follow a different time on a different day. And a tournament that already started could still take registrations while the Backend switch was on.

## Goals
1. **Per day times (Backend).** In the tournament form, section "Plánovanie turnaja", under the general Začiatok dňa / Koniec dňa: a list of the days of the tournament (from its start date to its end date), each with its own Začiatok and Koniec. An empty day uses the general times, so existing tournaments behave as before. The planner, the manual placement window, the timeline and the whole-screen schedule use the window of each day.
2. **No registration after the start.** A tournament has *started* when the start time of its first day has passed (that day's own start time if set, else the general one, else 09:00 — the same moment `src/unregister.js` already calls the start). From then on the server refuses the public registration (403 `REGISTRATION_CLOSED`, message says the tournament has started) even when the Backend switch is on; the public page hides the Registration button; the Backend shows a note. The switch itself is not changed.

## Non-goals
- League seasons: unchanged. The admin adding a player by hand: still allowed. The general times of the Harmonogram panel stay the one general setting (per-day times are entered in the Backend form only).
- A warning when the planner finds no free time (offered separately).

## Constraints
- Times are Bratislava time (`localToUtcMs`); a day's end is after its start and the day is at least one match long (same rules as the general day).
- Stored in a new column `seasons.day_times` (JSON `{ "2027-05-01": { "start": "10:00", "end": "18:00" } }`, only days with their own times); nothing stored = nothing changes.

## Approaches
One sensible way fits the code: a JSON column next to `day_start`/`day_end`, read by `settingsOf` and applied where the day window is used (`autoPlan` windows, the timeline). A separate `tournament_days` table was rejected: a tournament has at most 14 days and the times are only read with the tournament.

## My calls
- The start of the tournament for registration and for "withdraw until N hours before" is the same moment (the first day's start time).
- `registrationOpen` stays the Backend switch (raw); a new `registrationAvailable` is what the public page and the server use.
- A day with only a start or only an end typed is refused (both or none).

## Left to the builder
The look of the day rows (the same inputs as the general ones), the exact texts, the check script `scripts/check-tournament-day-times.js`.
