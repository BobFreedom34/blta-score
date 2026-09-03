---
name: sync-match-league
description: Look up each ELITE/NEXT_GEN/NOVICE match's League field (e.g. "Autumn Finals Series 2026") on its blta.sk event page and write it to the matching score.blta.sk match. Manual only — run with /sync-match-league whenever there are matches missing a league (a fresh backfill, or after new ones are added on blta.sk).
---

# Sync each match's League from blta.sk to score.blta.sk

Backend-only field for now (no UI reads it yet) — `league` on the `matches`
table (see `src/db.js`), written via `PATCH /api/matches/:token/league`
(admin-only). Only ever set for the three official-league categories
(`ELITE`, `NEXT_GEN`, `NOVICE`) — `FRIENDLY`/`VIP_CUP`/`ATA_TENNIS` matches
don't have a blta.sk league to look up at all, so never touch them.

**Important — this is unlike `sync-player-bios`, which fetches everything
via plain `curl`.** A blta.sk event page's League/Season/Date/Time table
(look for the "PODROBNOSTI" heading) is rendered client-side by JavaScript
— it is NOT present in the raw HTML `curl` sees. You need the browser tool
(`mcp__Claude_Browser__*`) for every lookup in this skill, not `curl`.

This is also fundamentally a matching problem, not a fixed lookup — unlike
a player (one WordPress profile page per player, 1:1), the same two players
can have played each other many times, each a separate blta.sk event with
its own URL. Expect to use judgment on ambiguous cases exactly as described
below, the same spirit as sync-player-bios's Step 4 data-quality checks —
don't silently guess wrong.

## Step 1 — Get the matches that need a league

```
GET https://score.blta.sk/api/matches?category=ELITE,NEXT_GEN,NOVICE
```

(The `category` filter accepts a comma-separated list — see `routes/matches.js`.)

Filter client-side to rows where `league` is falsy. That's your work list —
each item has `token`, `player1.name`, `player2.name`, `scheduledAt` (may be
`null` — a still-TBD app-side match), and `status`.

## Step 2 — Find each match's blta.sk event page

For each match in the work list:

1. **Try the natural slug first**, cheap and often right for a pair's
   only/most-recent meeting: `https://www.blta.sk/event/<slugify(player1.name)>-vs-<slugify(player2.name)>/`
   — slugify the same way the site does (lowercase, strip diacritics,
   spaces → hyphens). Load it with the browser tool.
2. Confirm it's genuinely the right page: read the page text/DOM and check
   both player names actually appear (a 404, or a page for different
   players entirely, means this exact slug guess didn't land — go to step 3).
   If it's the right pair but this pair has met more than once, also check
   whether it's the *specific* meeting you're looking for — see the
   disambiguation note below before trusting it.
3. **If the slug guess doesn't resolve to the right single match**, use
   blta.sk's own search instead: `https://www.blta.sk/?s=<player1 name>+<player2 name>`
   (URL-encode). This surfaces every event between them as separate result
   entries/links — visit the candidates.
4. **Disambiguating a pair with multiple meetings**: this is the same
   problem the blta.sk→score.blta.sk prelink script (kept elsewhere,
   pasted into blta.sk's own Custom HTML) already solves, and the same
   principle applies here — use `scheduledAt` to pick the right one within
   a couple of days' tolerance, wherever it's set. If the app-side match is
   itself TBD (`scheduledAt: null`) and there's exactly one blta.sk event
   for this pair that's *also* showing "TBD" in its own PODROBNOSTI time
   cell, that's your match. If more than one candidate is plausible and
   nothing distinguishes them, don't guess — skip it and report it as
   ambiguous (see Step 4).

## Step 3 — Read the League value

On the matched event page, find the "PODROBNOSTI" details table (columns:
Dátum, Čas, Liga, Sezóna). Read the **Liga** cell's text exactly as shown
(e.g. `Autumn Finals Series 2026`) — that's the value to write, unmodified
(don't try to normalize or shorten it).

## Step 4 — Write it back

Requires an admin session — log in first if you don't already have one
this session (`POST /api/admin/login`; ask the user for the password if
you don't have it, the same as any other admin-gated action — never type a
password into a request yourself if the user pastes one in chat, direct
them to log in in their own browser instead):

```
PATCH https://score.blta.sk/api/matches/<token>/league
  { "league": "Autumn Finals Series 2026" }
```

## Step 5 — Report

Summarize: how many matches were in the work list, how many got a league
written, and — same as sync-player-bios's own Step 6 — don't just say
"done": list every match skipped and why (no blta.sk event found at all,
vs. genuinely ambiguous between multiple candidates), so the user can
decide what to do about those by hand.
