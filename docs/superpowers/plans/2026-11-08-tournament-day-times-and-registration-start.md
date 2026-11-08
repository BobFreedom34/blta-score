# Per-day playing times and registration closing at the start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (done inline). Steps use checkbox syntax.

**Goal:** Each day of a tournament can have its own playing window (Backend), used by the planner and the schedule pages; the public registration of a tournament closes when its first day starts.

**Architecture:** `seasons.day_times` JSON; `src/tournamentSchedule.js` gets `dayWindowOf(settings, day)` and `tournamentStartMs(season)`; `autoPlan` windows use per-day windows; `src/routes/seasons.js` computes `registrationAvailable`; clients read `settings.dayTimes[day]`.

**Spec:** `docs/superpowers/specs/2026-11-08-tournament-day-times-and-registration-start-design.md`

## Global Constraints
- Times `HH:MM` Bratislava; day end after start; day >= one match. Both start and end for a day, or none. Days without their own times use `dayStart`/`dayEnd` (default 09:00–20:00).
- Started = now >= `localToUtcMs(firstDay, thatDayStart)`; a tournament without a start date never counts as started. League seasons unchanged. Admin-added registrations (`/registrations/admin`) stay allowed.
- Do NOT commit/push until the user says "deploy". `node -c` changed JS; null-byte scan. Files edited with CRLF endings (tournamentSchedule.js) must keep them.

## Review Focus
- Old tournaments (no `day_times`) plan exactly as before; a day typed for a date outside the tournament is ignored; changing the dates of the tournament keeps the typed days that still exist.
- Start day crossing: the first day with its own later start (e.g. 14:00) is NOT started at 10:00 that day, started at 14:00.
- Existing checks that register players in a tournament whose first day is in the past must still pass (fix the fixtures only if the new rule is the reason).
- `registrationOpen` raw switch value in the form stays what the admin set.

## Tasks
1. **Server — settings and planner.** `db.js` migration `day_times`; `tournamentSchedule.js`: `dayTimesOf(season)`, `settingsOf` adds `dayTimes` (effective `{start,end}` for every day of the tournament) and keeps `dayStart/dayEnd`; `readSettings` accepts `dayTimes` (validation above) → `next.dayTimes` (only the typed ones); `storeSettings` writes `day_times`; `SETTING_KEYS` += `dayTimes`; `autoPlan` windows per day; exports `tournamentStartMs(season)`. `routes/seasons.js` `serializeSeason`: `planning.dayTimes` = the typed ones. Check: `scripts/check-tournament-day-times.js` (validation, effective times in the schedule data, planner uses each day's window with 1 court / short day 1 so day 2 starts at its own start).
2. **Server — registration closes at the start.** `routes/seasons.js`: `registrationOpen(season)` false once started (message differs), `serializeSeason` adds `registrationAvailable`; `unregister.js` uses `tournamentStartMs`. Checks: started (past first day) → 403 for the public route, admin route 201; not started → 201; first day's own start later today → open before it, closed after (use today and times relative to now); raw `registrationOpen` unchanged; fix fixtures of older checks only if needed.
3. **Backend form + schedule pages.** `seasons-admin.js`: day rows under the general times (built from the date inputs, typed values kept when dates change, sent as `dayTimes` with only filled rows; a row with one time is refused on the client), note when `registrationStarted`; `court-schedule.js` and `schedule-screen.js`: per-day window via `settings.dayTimes[day]`; `season.js`: Registration button on `season.registrationAvailable`. i18n texts (SK/EN via `tl`). Checks: string-level checks of the pieces + browser check.
4. **Docs and regression.** README paragraph; run all related checks; show the user.
