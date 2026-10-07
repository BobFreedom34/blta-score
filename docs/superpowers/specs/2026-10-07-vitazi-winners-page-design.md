# Víťazi (winners) page + admin — design

Date: 2026-10-07 · Status: draft for review · Mockup: `mockups/vitazi-options.html` (layout **B**)

> **Adjustments made while building (2026-10-07):** foreign keys are not enforced in this database, so `ON DELETE CASCADE/SET NULL`
> do nothing — the router deletes children itself and reads a missing player/season as "not linked"; public places also carry
> `playerSlug`; `data/winner-photos/` is gitignored; the check script is committed as `scripts/check-winners.js`; hiding is per edition only.

## 1. Goal

A public page **/vitazi** like https://www.blta.sk/vitazi/, in the app's own style, and a Backend section where an admin
creates editions (seasons/tournaments) and assigns their winners, with photos. Success =

- the page shows, per edition and category, **winner, finalist and two semifinalists** as photo cards in layout B
  (photo, gold/silver/bronze strip, name), newest edition first;
- an admin can create/rename/reorder/hide/delete an edition, add/remove its category blocks, pick the four players of a
  block, and upload a dedicated photo per place — with no code change or deploy;
- the page follows the app's rules: it is listed in Backend > SEO, translated SK/EN, mobile-friendly.

Out of scope (YAGNI, easy to add later): final score, per-category hide switch, copying photos from blta.sk, a separate
"all years" table view (mockup C), comments/sharing.

## 2. Decisions taken (from the brainstorming)

| Topic | Decision |
|---|---|
| Public layout | Mockup B: 4 cards in a row (2×2 on a phone) |
| Season selector | A pill row on top: "Všetko" (default) + one pill per visible edition |
| Photo source | Uploaded photo per place → else the player's profile photo → else initials |
| What an "edition" is | Its own record (not a row of `seasons`), optionally linked to a season |
| Who is a winner | A player picked from `players`, or a typed name for people not in the app |
| Hiding | Per edition only |

## 3. Data model (SQLite, created in `src/db.js` with `CREATE TABLE IF NOT EXISTS`, like the other tables)

```sql
winner_editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                       -- "BLTA Winter Series 2026"
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,  -- optional: heading links to /season/<slug>
  sort_order INTEGER NOT NULL DEFAULT 0,     -- lower = higher on the page; new editions go first
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
winner_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id INTEGER NOT NULL REFERENCES winner_editions(id) ON DELETE CASCADE,
  category TEXT CHECK (category IN ('ELITE','NEXT_GEN','NOVICE')),   -- NULL = free title
  title TEXT NOT NULL DEFAULT '',            -- shown when category is NULL ("Konečné poradie"); ignored otherwise
  sort_order INTEGER NOT NULL DEFAULT 0
);
winner_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL REFERENCES winner_blocks(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),   -- 1 winner, 2 finalist, 3 and 4 semifinalists
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',             -- typed name; used when player_id is NULL (or the player was deleted)
  photo_url TEXT,                            -- uploaded photo, '/winner-photos/<file>'
  UNIQUE (block_id, slot)
);
```

Rules:
- An empty slot is simply not stored and not rendered. A block with no filled slot is not rendered publicly (but stays in the admin).
- Display name = `players.name` when `player_id` is set, else `winner_places.name`. If a place has neither, it is empty.
- Display photo = `winner_places.photo_url` → `players.photo_url` → none (the card shows initials).
- Label of a slot: 1 → "Víťaz" / "Winner"; 2 → "Finalista" / "Finalist"; 3–4 → "Semifinalista" / "Semifinalist".
  Medal tint: gold / silver / bronze (slots 3 and 4 both bronze).
- Heading of a block: the category label (Elite, Next Gen, Novice — the existing category names) or the block `title`.
- The tables are included in the existing backup automatically (same SQLite file); uploaded photos live in
  `<dataDir>/winner-photos/`, which `src/backup.js` already covers by scanning the data directory (to be confirmed in the plan).

## 4. API (`src/routes/winners.js`, mounted at `/api/winners` in `server.js`)

Public:
- `GET /api/winners` → visible editions ordered by `sort_order, id`, each with its blocks (by `sort_order, id`) and
  resolved places `{ slot, name, playerId, photoUrl }` (name/photo already resolved per §3). Edition also carries
  `seasonSlug` when linked.

Admin (`requireAdmin`):
- `GET /api/winners/all` → same shape, hidden editions included, plus raw place fields (`player_id`, typed `name`, own `photoUrl`) for editing.
- `POST /api/winners/editions` `{ title, seasonId? }` → creates it with `sort_order` = (min existing) − 1 so it appears first.
- `PATCH /api/winners/editions/:id` `{ title?, seasonId?, sortOrder?, visible? }`
- `DELETE /api/winners/editions/:id` → also deletes its blocks/places and their uploaded photo files.
- `POST /api/winners/editions/:id/blocks` `{ category?, title? }`; `PATCH /api/winners/blocks/:id` `{ category?, title?, sortOrder? }`; `DELETE /api/winners/blocks/:id`.
- `PUT /api/winners/blocks/:id/places` `{ places: [{ slot, playerId?, name? } × up to 4] }` — saves the four places of a block at
  once (upsert per slot; a slot sent empty is removed). When `playerId` is given, the server also stores that player's current
  name in `name` (a snapshot, used if the player is later deleted). Does not touch photos.
- `POST /api/winners/places/:id/photo` (multipart field `photo`; PNG/JPG/WebP, ≤ 6 MB, as the carousel) and
  `DELETE /api/winners/places/:id/photo`. A new upload deletes the previous file. Because a place may not exist yet when its
  photo is chosen, the admin saves the block first, then uploads (the upload buttons are enabled for saved places).

Validation (400 with a plain `{ error }`, in the style of `schedule.js`): title required, ≤ 120 chars; `category` in the
enum or null; `slot` 1–4 and unique per block; `playerId` must exist; typed `name` ≤ 120 chars; `seasonId` must exist or be null; a block with
`category` NULL needs a `title`.

## 5. Public page `/vitazi`

Files: `public/vitazi.html`, `public/js/vitazi.js`, styles appended to `public/css/style.css` with a `.win-` prefix; page
registered in `src/seo.js` `PAGES` (so it is served, listed in Backend > SEO, and included in the sitemap).

- Heading + one-line description (the existing `.home-sub` pattern, like Harmonogram).
- Pill row: "Všetko" + the edition titles (same pill style as the tabs on Matches/Harmonogram). Selecting one shows only that edition.
- Per edition: an edition heading (`.home-sec-title`, 20px, linked to the season page when `seasonSlug` is set); per block a category
  badge (existing `badge-ELITE/NEXT_GEN/NOVICE` styles) or the free title, then the 4 cards.
- Card (from the mockup): 4:5 photo area on a dark gradient, BLTA logo bottom-right, medal-coloured border/glow, strip with
  label + name in capitals. No photo → large initials in a medal-coloured circle. A linked player's card is an `<a>` to
  `/player/<id>`; typed-name cards are not links.
- Responsive: 4 columns above 760px, 2 columns below. No horizontal scroll at 375px.
- Empty state (no visible edition): "Zatiaľ tu nie sú žiadni víťazi." / English equivalent.
- Texts through `public/js/i18n.js` (SK + EN) under `winners.*`.

## 6. Admin page `/winners-admin`

Files: `public/winners-admin.html`, `public/js/winners-admin.js`; a new **Winners** tab added to the tab bar of every existing
admin page (`admin.html`, `badges-admin`, `bracket-admin`, `carousel-admin`, `header-admin`, `login-history`, `rules-admin`,
`schedule-admin`, `seasons-admin`, `seo-admin`, `venues-admin`, plus the new one). Layout follows the mockup's admin section:

- Top bar: edition select (hidden ones marked), **+ New edition**, rename, link-to-season select, visible checkbox, up/down (reorder), delete (confirm).
- Per block: category select (or free title), four rows (Winner / Finalist / Semifinalist ×2), each with a player select
  (searchable, from `/api/players`) *or* a typed-name field, and a photo control (shows current photo, "Upload", "Remove").
  **Save block** sends the PUT of §4. **+ Add category block** / delete block.
- Errors from the API are shown inline (same pattern as the other admin pages).

## 7. App integration

- `server.js`: `require` the router, `app.use('/api/winners', …)`, `app.use('/winner-photos', express.static(<dataDir>/winner-photos))`,
  create the directory at startup. `/vitazi` and `/winners-admin` are served by the existing static handler (`extensions: ['html']`) / `PAGES`.
- `src/seo.js`: new `PAGES` entry `key: 'vitazi'`, path `/vitazi`, `blta: 'https://www.blta.sk/vitazi/'`, Slovak title
  `Víťazi - BLTA - Bratislavská Liga Tenisových Amatérov` and a description; add `Disallow: /winners-admin` to `robots.txt`.
- Header menu: `ensureWinnersMenuItem(db)` in `src/seasonSeed.js` (same pattern as `ensureScheduleMenuItem`, guarded by an `app_flags` key
  `menu_winners_added`), inserting "Víťazi" / "Winners" → `/vitazi` after "Harmonogram". The admin can rename/move/delete it afterwards.
- `public/js/header-admin.js`: add `/vitazi` to the list of known page links (next to `/harmonogram`, line 27) so it can be chosen when editing the menu.
- Seed (`src/winnersSeed.js`, run once from `server.js` next to the other seeds, guarded by `app_flags` key `winners_seeded`):
  the winners listed on blta.sk on 2026-10-07 —
  "BLTA nultý ročník 2025" (block "Konečné poradie": Róbert Sloboda, Pavol Piroha, Tomáš Podhorný, Michal Bori) and
  "BLTA Winter Series 2026" Elite (Róbert Sloboda, Branislav Ivan, Pavol Piroha, Pavol Blahut), Next Gen (Peter Bicko, Artur Hlukhota, Yurii Yumashev,
  Volodymyr Sadykov), Novice (Ján Beňo, Radko Cíger, Ladislav Nagy, Juraj Urblík). Each name is matched to `players.name`
  case-insensitively; a match sets `player_id`, otherwise the name is stored as typed. Editions link to the season whose
  name matches when one exists. Photos are **not** imported.
  Note: blta.sk calls the second edition "Winter Series 2026"; the app's season is "Winter Opening Series 2026" — the seed does
  **not** guess a link when names differ; the admin links it.
- README: a short "Winners page" section (where the files are, how to edit in Backend).

## 8. Error handling / edge cases

- Deleting a player used in a place → `player_id` becomes NULL and the typed `name` is used; the seed and the admin store the
  typed name alongside a picked player (the name of the picked player at save time) so the card still shows a name.
- Deleting an edition/block deletes uploaded photo files of its places (best effort, like carousel `deleteFile`).
- Upload of a wrong type or > 6 MB → 400 with a readable message, no file written.
- The seed never overwrites: if `winners_seeded` is set it does nothing, even if the admin deleted the seeded data.
- Public GET returns only visible editions; hidden ones never leave the server on the public endpoint.

## 9. Verification (there is no test framework in this repo — `package.json` has no test script)

- A throw-away Node script (not committed) exercising the API with the dev server: create → add block → PUT places → upload a
  photo → public GET (check name/photo fallback order, hidden edition absent) → delete cascades. Run it against a temp data dir.
- Browser check with the dev server: `/vitazi` on desktop and 375px, light data (seeded) and empty state; `/winners-admin`
  full flow including photo upload; Backend > SEO lists the page; the menu item appears.
- No new dependency (multer and express are already used).

## 10. Risks / open points for the plan

- Confirm `src/backup.js` really picks up a new directory under `dataDir` (its comment says it does).
- The tab bar exists as copy-pasted markup in ~12 HTML files; the plan lists them explicitly so none is missed.
- Seed name matching depends on the players' spelling in the app (e.g. diacritics); unmatched names fall back to typed text, which is safe.
