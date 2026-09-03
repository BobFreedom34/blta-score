---
name: sync-player-bios
description: Sync player bio info (category, nationality, racket, forehand, backhand, seasons, birthday) from blta.sk's WordPress player pages into score.blta.sk profiles. Manual only — run with /sync-player-bios whenever blta.sk player data has changed.
---

# Sync player bios from blta.sk to score.blta.sk

Pulls each player's bio fields from their old WordPress profile page
(`https://www.blta.sk/player/<wp-slug>/`) and writes them to the matching
player's profile on `https://score.blta.sk` via `PATCH /api/players/:slug/bio`.

This mirrors the process used to backfill all 91 players on 2026-08-26 —
follow it exactly, including the validation step, since the source site has
known data-quality issues (see Step 4).

## Step 1 — Get the current roster with WordPress URLs

Fetch the roster page raw (not through a browser, so the original WordPress
`<a href>` links are intact, not already rewritten by the player-links script
installed on blta.sk):

```bash
curl -s "https://www.blta.sk/hraci/" -o /tmp/hraci.html
```

Parse `name` + `url` pairs out of it:

```js
const cellRe = /<td class="data-name[^"]*"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>/g;
```

## Step 2 — Get the current score.blta.sk player list

```
GET https://score.blta.sk/api/players
```

Match each WordPress name to a score.blta.sk player by normalizing both
(strip diacritics, lowercase, trim) and comparing. A few players are known to
use a nickname on blta.sk but a full name on score.blta.sk — check this
override map first, then fall back to exact normalized match:

```js
const NICKNAME_MAP = {
  'branislav blozon': 'brano blozon',
  'guilllaume raoux': 'guillaume raoux', // typo on the WP site (triple L)
  'vilo alaksa': 'viliam alaksa',
  'robo sloboda': 'robert sloboda',
};
```

If a WordPress name has no match at all (new player never created on
score.blta.sk), stop and ask the user whether to create them — don't
silently skip or silently create; this is the same judgment call made when
the 91-player roster was first backfilled.

## Step 3 — Fetch and parse each player's WordPress bio

```bash
curl -s "<player-wp-url>"
```

The bio fields live in one `<dl class="sp-player-details">` with alternating
`<dt>label</dt><dd>value</dd>` pairs. Strip any `<img>` tag inside a `<dd>`
(the nationality field has a flag icon before the text).

Map WordPress labels/values to the score.blta.sk bio fields:

| WP label (Slovak) | score.blta.sk field | Value mapping |
|---|---|---|
| Kategória | `category` | contains "ELITE"→`ELITE`, "NEXT GEN"→`NEXT_GEN`, "NOVICE"→`NOVICE` |
| Národnosť | `nationality` | pass through as-is (strip the flag `<img>`) |
| Raketa | `racket` | pass through as-is |
| Forehand | `forehand` | contains "prav"→`Right-handed`, contains "lav"/"ľav"→`Left-handed` |
| Backhand | `backhand` | contains "obojruc"/"obojruč"→`Two-handed`, contains "jednoruc"/"jednoruč"→`One-handed` |
| Sezóny | `seasons` | pass through as-is |
| Narodeniny | `birthday` | `D.M.YYYY` → `YYYY-MM-DD` |

`Výška`, `Hmotnosť`, `Meno`, `Vek` are ignored — weight/height were
deliberately dropped from the score.blta.sk schema, name and age are already
shown elsewhere (age is computed from birthday, not stored).

## Step 4 — Validate before writing (important)

The source WordPress data has real errors — e.g. several players share the
obviously-wrong placeholder birthdate `2025-08-01` or similar, which computes
to an age under 10. Flag and null out (don't write) any birthday where the
computed age is under 10 or over 90:

```js
function isSuspiciousBirthday(birthday) {
  const year = parseInt(birthday.slice(0, 4), 10);
  const age = new Date().getFullYear() - year;
  return age < 10 || age > 90;
}
```

Report every field skipped this way to the user in the final summary — don't
silently drop bad data without saying so.

## Step 5 — Write each player's bio

Requires an authenticated session (admin login, or the `PROFILE_CODE`
player-editor login):

```
POST https://score.blta.sk/api/admin/login   { "password": "<see memory/ask user>" }
PATCH https://score.blta.sk/api/players/<slug>/bio
  { "category", "nationality", "racket", "forehand", "backhand", "seasons", "birthday" }
```

Only send fields that have a value — omit (don't send `null` for) fields the
WordPress page left blank, so an existing score.blta.sk value for that field
(if a player already had one manually edited in) isn't overwritten with
nothing. Fields present in the WP `<dl>` with real values should still be
sent even if they duplicate what's already there — this is a sync, not a
one-time fill.

## Step 6 — Report

Summarize: how many players processed, how many matched/updated, any
unmatched names (need a create/skip decision), and any fields skipped for
data-quality reasons (Step 4). Don't just say "done" — the whole point of
this skill is to catch source-data problems, so surface them every time.
