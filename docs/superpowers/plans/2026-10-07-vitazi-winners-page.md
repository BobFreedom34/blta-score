# Víťazi (winners) page + admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/vitazi` page (photo cards, layout B) and a Backend `/winners-admin` editor so an admin can create editions and assign winners with photos, no deploy needed.

**Architecture:** Three SQLite tables (editions → blocks → places) in `src/db.js`, one Express router `src/routes/winners.js` at `/api/winners`, two static pages with their own JS, the same upload/serve pattern as the carousel. No new dependency.

**Tech Stack:** Node ≥ 22.5 (`node:sqlite` `DatabaseSync`), Express 4, multer 2, vanilla JS front end (`api()`, `t()`, `escapeHtml()` from `public/js/common.js` / `i18n.js`).

**Spec:** `docs/superpowers/specs/2026-10-07-vitazi-winners-page-design.md` (mockup: `mockups/vitazi-options.html`, option B + its admin section). Read both. Where this plan differs from the spec it says so under "Spec adjustments".

## Spec adjustments (found while reading the code)

- `PRAGMA foreign_keys = OFF` in `src/db.js`: `ON DELETE CASCADE / SET NULL` do **nothing**. All cascades are done explicitly in the router (delete places → blocks → edition, and their photo files). A deleted player or season leaves a dangling `player_id` / `season_id`; reads must use `LEFT JOIN` and treat a missing row as "not linked".
- `data/winner-photos/` must be added to `.gitignore` (like `data/player-photos/`).
- Public place objects also carry `playerSlug` (profile URL is `/player/<slug || id>`).
- The verification script is **committed** as `scripts/check-winners.js` (spec §9 said throw-away): it is what makes the TDD steps repeatable. Run: `node scripts/check-winners.js`.
- `src/backup.js` already zips everything under `dataDir` except the DB files (its comment says so) → no change needed; verified by reading, not by a run.

## Global Constraints

- Slovak is the default language; every visible text goes through `public/js/i18n.js` in **both** `sk` and `en` (keys under `winners.*`, plus `page.winnersTitle`).
- Page `<title>` for SEO: `Víťazi - BLTA - Bratislavská Liga Tenisových Amatérov` (`${SUFFIX}` in `src/seo.js`).
- Section headings are 20px (`.home-sec-title`); medal colours gold `#ffb802`, silver `#c9ccd3`, bronze `#c97a3d`.
- Upload: PNG/JPG/WebP, ≤ 6 MB, files in `<dataDir>/winner-photos/`, served at `/winner-photos/<file>`.
- Slots: 1 = winner ("Víťaz"/"Winner"), 2 = finalist ("Finalista"/"Finalist"), 3 and 4 = semifinalist ("Semifinalista"/"Semifinalist"); 3 and 4 both bronze.
- Validation limits: edition/block title ≤ 120 chars; typed name ≤ 120 chars; 4 slots max; categories `ELITE|NEXT_GEN|NOVICE` or null.
- Backend rule (user's standing request): the new public page must show up in Backend > SEO.
- Admin endpoints use `requireAdmin` from `src/auth.js` (401 JSON `{ error }` otherwise); errors are `{ error: '<plain sentence>' }` with 400/404.
- No new npm dependency. Commit per task; **do not push or deploy** until the user says so.

## Review Focus

1. A player deleted after being picked → the card still shows the stored name, no crash (Task 2 test `dangling player`).
2. A hidden edition never appears in the public `GET /api/winners` but does in `/all` (Task 1 test).
3. Wrong file type or > 6 MB upload → 400 and **no file written** (Task 3 test).
4. A block whose slots are all empty is not in the public output (Task 2 test).
5. Seed names with different case/diacritics match the players table; unmatched names are kept as typed text (Task 4 test).
6. Titles/names containing `<` and `&` are shown as text, not HTML (Task 5/6 browser check).

## File Structure

| File | Responsibility |
|---|---|
| `src/db.js` (modify) | the three tables |
| `src/routes/winners.js` (create) | public + admin API, photo upload, explicit cascades |
| `src/winnersSeed.js` (create) | one-time seed of the blta.sk winners |
| `src/seasonSeed.js` (modify) | `ensureWinnersMenuItem(db)` |
| `src/seo.js` (modify) | `PAGES` entry `vitazi`, `Disallow: /winners-admin` |
| `server.js` (modify) | mount router, serve `/winner-photos`, run seeds |
| `public/vitazi.html`, `public/js/vitazi.js` (create) | public page |
| `public/winners-admin.html`, `public/js/winners-admin.js` (create) | admin editor |
| `public/css/style.css` (modify) | `.win-*` styles |
| `public/js/i18n.js`, `public/js/header-admin.js` (modify) | texts; `/vitazi` in `SITE_PAGES` |
| 11 existing `public/*-admin.html`/`admin.html`/`login-history.html` (modify) | "Winners" tab |
| `scripts/check-winners.js` (create) | API + seed + menu checks |
| `README.md`, `.gitignore` (modify) | docs; ignore `data/winner-photos/` |

---

### Task 1: Tables, check harness, public list and edition CRUD

**Files:**
- Modify: `src/db.js` (append after the `schedule_events` block, ~line 1306), `server.js` (require + `app.use('/api/winners', winnersRouter)` next to the schedule router, line ~191), `.gitignore`
- Create: `src/routes/winners.js`, `scripts/check-winners.js`

**Interfaces:**
- Produces (db): tables `winner_editions(id, title, season_id, sort_order, visible, created_at)`, `winner_blocks(id, edition_id, category, title, sort_order)`, `winner_places(id, block_id, slot, player_id, name, photo_url, UNIQUE(block_id, slot))` exactly as spec §3 (keep the `REFERENCES`/`CHECK` text; FKs are not enforced).
- Produces (router, `module.exports = router`): in `src/routes/winners.js`
  - `serializeEdition(row, admin: boolean) -> object`. Public shape `{ id, title, seasonSlug: string|null, blocks: [{ id, category: string|null, title, places: [{ slot, name, playerId: number|null, playerSlug: string|null, photoUrl: string|null }] }] }`; places sorted by slot, empty slots absent, blocks with no places omitted **only in the public shape**. Admin shape adds `seasonId, sortOrder, visible`, keeps empty blocks, and each place also has `placeId` and the raw `own: { playerId, name, photoUrl }` besides the resolved fields.
  - Resolution: name = joined `players.name` if the player row exists, else `winner_places.name`; photoUrl = `winner_places.photo_url` → `players.photo_url` → null.
  - `GET /` (public, visible editions by `sort_order, id`), `GET /all` (admin), `POST /editions` `{title, seasonId?}` → 201 edition (admin shape), `sort_order` = min existing − 1 (0 if none), `PATCH /editions/:id` `{title?, seasonId?, sortOrder?, visible?}`, `DELETE /editions/:id` (explicit cascade, see Spec adjustments; returns `{ ok: true }`).
  - helper `deletePhotoFile(url)` is added in Task 3; Task 1's delete just deletes rows.
- Produces (script): `scripts/check-winners.js` harness — `test(name, async fn)` registry run in order, exit code 1 on any failure; starts `node server.js` with env `DATA_DIR=<mkdtemp>`, `PORT=<3100+random>`, `ADMIN_PASSWORD=test`, `SESSION_SECRET=test`, waits for the stdout line `listening`; `call(method, path, { body, cookie, form })` → `{ status, json }`; `adminCookie` from `POST /api/admin/login {password:'test'}` (`set-cookie` header); `fixtures.insertPlayer(name, slug, photoUrl = null) -> id` writing to the child's DB file with `DatabaseSync` (WAL, so concurrent open is fine). Kills the child and deletes the temp dir at the end.

- [ ] **Step 1: Write the harness and failing tests** in `scripts/check-winners.js`: `unauthenticated admin calls`: `GET /api/winners/all`, `POST /api/winners/editions` without cookie → 401. `create edition goes first`: create "A" then "B" → `GET /api/winners/all` lists B before A (B.sortOrder < A.sortOrder). `title validation`: empty title and 121-char title → 400. `hidden edition`: PATCH `visible:false` on A → absent from public `GET /api/winners`, present in `/all`. `season link`: insert a season row via fixtures, PATCH `seasonId` → public edition has `seasonSlug` equal to that season's slug; delete the season row from the DB → `seasonSlug` is `null`, no 500. `delete edition`: DELETE → 200 `{ok:true}`, second DELETE → 404, and `winner_blocks`/`winner_places` rows for it are gone (checked through fixtures).
- [ ] **Step 2: Run** `node scripts/check-winners.js` — Expected: FAIL (route missing, 404s).
- [ ] **Step 3: Implement** the tables (`CREATE TABLE IF NOT EXISTS`, same style as neighbours), the router per the Interfaces block (validation messages in the style of `src/routes/schedule.js`; use `db.exec('BEGIN')/COMMIT/ROLLBACK` for the cascade), mount it in `server.js`, add `data/winner-photos/` to `.gitignore`.
- [ ] **Step 4: Run** `node scripts/check-winners.js` — Expected: all tests print PASS, exit code 0.
- [ ] **Step 5: Commit** — `git add scripts/check-winners.js src/db.js src/routes/winners.js server.js .gitignore && git commit -m "Winners: tables, editions API and check script"`

---

### Task 2: Blocks and places

**Files:**
- Modify: `src/routes/winners.js`, `scripts/check-winners.js`

**Interfaces:**
- Consumes: `serializeEdition`, harness from Task 1.
- Produces (router): `POST /editions/:id/blocks` `{category?, title?}` → 201 edition (admin shape); `PATCH /blocks/:id` `{category?, title?, sortOrder?}` → edition; `DELETE /blocks/:id` → `{ok:true}` (explicit cascade to places); `PUT /blocks/:id/places` `{ places: [{ slot, playerId?, name? }] }` → edition. New block `sort_order` = max in its edition + 1. A block with `category` null must have a non-empty `title` (400 otherwise); with a category the title is stored as given (may be empty). PUT semantics: the body lists the slots to keep; stored slots not in the body are deleted; a listed slot with neither `playerId` nor non-empty `name` is deleted; with `playerId` the server verifies the player exists (400 `Player not found`) and stores that player's current name in `name`; `slot` outside 1–4 or repeated → 400; photos are never touched.

- [ ] **Step 1: Add failing tests**: `block needs title without category` (400), `block with category ok` (201, appears in `/all`), `put places happy path` (four slots; public output lists slots 1–4 sorted, names resolved from players, `playerSlug` present), `put places replaces`: a second PUT with two slots removes the other two, `typed name only` (no playerId → `playerId` null, name as typed, no link fields), `validation`: slot 5, duplicate slot, unknown playerId, 121-char name → 400, **`dangling player`**: delete the player row via fixtures → place still returns the stored name and `playerId: null`, **`empty block hidden`**: block whose places were all removed is absent in public output but present in `/all`, `photo fallback order` (player with photo, place without → player photo; set `winner_places.photo_url` via fixtures → place photo wins; neither → `photoUrl: null`), `delete block` removes its places.
- [ ] **Step 2: Run** `node scripts/check-winners.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the endpoints above in `src/routes/winners.js`; reuse one shared `loadEdition(id)` that both write endpoints return through `serializeEdition(row, true)`.
- [ ] **Step 4: Run** — Expected: all PASS.
- [ ] **Step 5: Commit** — `git add scripts/check-winners.js src/routes/winners.js && git commit -m "Winners: blocks and places API"`

---

### Task 3: Photo upload and file cleanup

**Files:**
- Modify: `src/routes/winners.js`, `server.js` (`app.use('/winner-photos', express.static(path.join(db.dataDir, 'winner-photos'), { maxAge: '30d' }))` next to `/carousel-images`), `scripts/check-winners.js`

**Interfaces:**
- Consumes: `serializeEdition`, `loadEdition`.
- Produces (router): `POST /places/:id/photo` (multipart field `photo`, same multer config/error wrapper as `src/routes/carousel.js`; PNG/JPG/WebP, 6 MB; messages `The picture must be under 6 MB` / `Upload a PNG, JPG or WebP picture`) → edition (admin shape); replaces and deletes the previous file; file name `win-<Date.now()>-<5 random bytes hex><ext>`, url `/winner-photos/<name>`. `DELETE /places/:id/photo` → edition, deletes the file, sets `photo_url` NULL. `deletePhotoFile(url: string|null)` only unlinks files whose url starts with `/winner-photos/` (basename only). Edition/block/place deletion (Tasks 1–2) now also call it for every affected place; PUT places that removes a slot deletes that slot's photo file too.
- Directory `<dataDir>/winner-photos/` is created at router load (as carousel does).

- [ ] **Step 1: Add failing tests** (build a 1×1 PNG buffer inline; send with `FormData`/`Blob` through `call(..., { form })`): `upload sets photo` (200, place `own.photoUrl` starts `/winner-photos/`, file exists in the temp data dir, `GET /winner-photos/<file>` → 200), `second upload replaces and deletes the old file`, **`wrong type`** (text/plain → 400, no new file in the dir), **`too big`** (6 MB + 1 byte → 400, no new file), `delete photo` (file gone, `photoUrl` back to the fallback), `removing a slot via PUT deletes its photo`, `deleting an edition deletes its photo files`, `upload needs admin` (401).
- [ ] **Step 2: Run** — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the endpoints, `deletePhotoFile`, and the cleanup calls; mount the static route in `server.js`.
- [ ] **Step 4: Run** — Expected: all PASS.
- [ ] **Step 5: Commit** — `git add scripts/check-winners.js src/routes/winners.js server.js && git commit -m "Winners: photo upload"`

---

### Task 4: Seed and menu item

**Files:**
- Create: `src/winnersSeed.js`
- Modify: `src/seasonSeed.js`, `server.js` (two `try { … } catch (err) { console.error(…) }` blocks after the schedule seed, line ~101, same style), `scripts/check-winners.js`

**Interfaces:**
- Produces: `seedWinners(db) -> { skipped: true } | { editions: number }` in `src/winnersSeed.js`; guarded by `app_flags` key `winners_seeded`, set inside the same transaction. Data = spec §7 (2 editions, 4 blocks, 16 places): edition "BLTA Winter Series 2026" (`sort_order` 0) with blocks ELITE, NEXT_GEN, NOVICE and "BLTA nultý ročník 2025" (`sort_order` 1) with one block `category` null, `title` "Konečné poradie"; names in slot order exactly as in the spec. Player match: `require('./nameMatch').findSimilar(name, players).exact` over `SELECT id, name FROM players`; matched → `player_id` + the player's name; else `player_id` NULL + name as in the seed. `season_id` set only when exactly one season has `name` equal (case-insensitive) to the edition title; otherwise NULL.
- Produces: `ensureWinnersMenuItem(db)` exported from `src/seasonSeed.js`: same pattern as `ensureScheduleMenuItem` (flag `menu_winners_added`; "Víťazi" / "Winners" → `/vitazi`; inserted right after the `/harmonogram` top-level item, or at the end if absent; later items shift by +1).
- Consumes: the check script gets a second section that sets `process.env.DATA_DIR` to another temp dir **before** requiring `../src/db`, then requires `../src/winnersSeed` and `../src/seasonSeed`.

- [ ] **Step 1: Add failing tests** (in-process): `seed inserts 2 editions, 4 blocks, 16 places` (counts), `seed matches players` (insert player "RÓBERT SLOBODA" with slug `sloboda` first → the seeded winner place of Elite has that `player_id`; players are matched case/diacritics-insensitively; "Ján Beňo" without a player row → `player_id` NULL, name `Ján Beňo`), `seed is idempotent` (second call → `{ skipped: true }`, counts unchanged, also after deleting all editions), `season link only on exact name` (season named "BLTA Winter Series 2026" → linked; none → NULL), `menu item placed after Harmonogram` (insert header items Tabuľky, Harmonogram, Propozície → Víťazi sits between Harmonogram and Propozície, once; second call adds nothing).
- [ ] **Step 2: Run** — Expected: new tests FAIL (module missing).
- [ ] **Step 3: Implement** `src/winnersSeed.js`, `ensureWinnersMenuItem`, and the two `server.js` calls.
- [ ] **Step 4: Run** — Expected: all PASS.
- [ ] **Step 5: Commit** — `git add src/winnersSeed.js src/seasonSeed.js server.js scripts/check-winners.js && git commit -m "Winners: one-time seed and menu item"`

---

### Task 5: Public page `/vitazi`

**Files:**
- Create: `public/vitazi.html`, `public/js/vitazi.js`
- Modify: `src/seo.js` (entry in `PAGES` after `harmonogram`; **the HTML file must exist first**, `TEMPLATES` reads every page file at load), `public/css/style.css` (append a `/* ---------- Winners page (/vitazi) ---------- */` section), `public/js/i18n.js`, `public/js/header-admin.js` (add `{ sk: 'Víťazi', en: 'Winners', link: '/vitazi' }` after Harmonogram in `SITE_PAGES`)

**Interfaces:**
- Consumes: `GET /api/winners` (Task 1–3 shape).
- Produces: `vitazi.html` = copy of `harmonogram.html` structure (topbar, login modal block, footer scripts as in that file) with `<h1 data-i18n="winners.heading">`, `<p class="home-sub" data-i18n="winners.sub">`, `<div class="tabs" id="win-tabs">`, `<div id="win-root">`; scripts `i18n.js`, `common.js`, `vitazi.js`.
- `vitazi.js` (same bootstrap and language-change handling as `harmonogram.js`): `loadWinners()`, `render()`; state `selected = 'ALL' | editionId`. Edition heading via the `.home-sec-title` markup (`<div class="home-sec-title"><span class="l">…</span></div>`), linked to `/season/<seasonSlug>` when present; per block: `categoryBadge(category)` from `common.js` or the free title in a `.v-cat`-style pill; then `.win-grid` of cards. Card = `<a class="win-card win-gold|win-silver|win-bronze" href="/player/<slug||id>">` when `playerId` is set, `<div>` otherwise; photo area `.win-ph` (4:5, `<img class="win-img">` or a `.win-av` initials circle via `initials(name)` from `common.js`), BLTA logo `/favicon-64.png` bottom-right, strip `.win-lab` with `<small>` label (`winners.winner|finalist|semifinalist`) and `<b>` name. Every dynamic string through `escapeHtml`. Empty → `winners.empty`; fetch error → `winners.loadError`.
- CSS: port the mockup's `.pb`, `.pb-c`, `.pb-ph`, `.pb-lab`, `.av`, medal vars (`.gold/.silver/.bronze`) from `mockups/vitazi-options.html` renamed to `.win-grid`, `.win-card`, `.win-ph`, `.win-lab`, `.win-av`, `.win-gold/.win-silver/.win-bronze`; 4 columns, 2 below 760px; add `.win-img { width:100%; height:100%; object-fit:cover }`.
- i18n keys (sk / en): `page.winnersTitle` "Tennis SCORE — Víťazi" / "Tennis SCORE — Winners"; `winners.heading` "Víťazi" / "Winners"; `winners.sub` "Víťazi sérií a turnajov BLTA" / "Winners of BLTA series and tournaments"; `winners.all` "Všetko" / "All"; `winners.winner` "Víťaz" / "Winner"; `winners.finalist` "Finalista" / "Finalist"; `winners.semifinalist` "Semifinalista" / "Semifinalist"; `winners.empty` "Zatiaľ tu nie sú žiadni víťazi." / "No winners here yet."; `winners.loadError` "Víťazov sa nepodarilo načítať." / "Could not load the winners."
- SEO entry: `key: 'vitazi', label: 'Winners (Víťazi)', path: '/vitazi', file: 'vitazi.html', blta: 'https://www.blta.sk/vitazi/'`, `title: \`Víťazi${SUFFIX}\``, `description: 'Víťazi BLTA - Bratislavskej Ligy Tenisových Amatérov: víťazi, finalisti a semifinalisti jednotlivých sérií a turnajov v kategóriách Elite, Next Gen a Novice.'`.

- [ ] **Step 1: Create** `vitazi.html` and `vitazi.js`, the CSS, i18n keys, `header-admin.js` entry, then the `seo.js` entry.
- [ ] **Step 2: Verify in the browser** — start `blta-score-dev` (`preview_start`), then with the dev DB add data through the API (log in with the dev `ADMIN_PASSWORD`, `POST /api/winners/editions`, blocks, places — or temporarily run the seed): open `/vitazi`. Expected: cards render in layout B with medal strips, season pills filter, linked names open `/player/<slug>`, no console errors (`read_console_messages`), no horizontal scroll at 375px (`resize_window` mobile, check `document.documentElement.scrollWidth <= 375`), language switch to EN relabels strips, empty state shows when nothing is visible, an edition titled `<b>x</b> & y` shows literally. `GET /sitemap.xml` contains `/vitazi`; Backend > SEO lists "Winners (Víťazi)".
- [ ] **Step 3: Commit** — `git add public/vitazi.html public/js/vitazi.js public/css/style.css public/js/i18n.js public/js/header-admin.js src/seo.js && git commit -m "Winners: public /vitazi page"`

---

### Task 6: Admin page `/winners-admin` and the Winners tab

**Files:**
- Create: `public/winners-admin.html`, `public/js/winners-admin.js`
- Modify: `src/seo.js` (`Disallow: /winners-admin` after `/schedule-admin`), the 11 admin pages — `admin.html`, `badges-admin.html`, `bracket-admin.html`, `carousel-admin.html`, `header-admin.html`, `login-history.html`, `rules-admin.html`, `schedule-admin.html`, `seasons-admin.html`, `seo-admin.html`, `venues-admin.html` — each gets `<a href="/winners-admin" class="tab">Winners</a>` on the line after its Schedule tab

**Interfaces:**
- Consumes: all `/api/winners/*` endpoints (Tasks 1–3), `GET /api/players` (rows with `id, name, slug, photo_url`), `GET /api/seasons` (for the link select; use the existing shape — read `public/js/seasons-admin.js` for the field names).
- Produces: `winners-admin.html` = `schedule-admin.html` structure with the 12-tab bar (new one `class="tab active"`), `<h2>Winners</h2>` + one-line help text, `<div id="winners-admin-root">Loading…</div>`, scripts `i18n.js`, `common.js`, `winners-admin.js`. `winners-admin.js` follows `events-admin.js` style (IIFE, inline field styles, `api()`; admin-only English text, no i18n): edition select (hidden ones marked "(hidden)") + **+ New edition** (prompt for title) + rename, season select ("— none —" + seasons), visible checkbox, up/down (swap `sortOrder` with the neighbour via two PATCHes), delete (confirm). Per block: category select (Elite/Next Gen/Novice/"Own title…" showing a title input), four rows (Winner/Finalist/Semifinalist/Semifinalist) each with a player `<select>` (first option "— typed name —" showing a text input), a thumbnail of the resolved photo, **Upload** (hidden `<input type="file">`, disabled with hint "save first" while the place has no `placeId`) and **Remove**; **Save block** → `PUT /blocks/:id/places`; **Delete block**; **+ Add category block**. API errors shown inline in a `.error` div like `events-admin.js`.

- [ ] **Step 1: Create** the page and script, add the tab line to all 12 pages (11 + new), add the robots line.
- [ ] **Step 2: Verify the tabs** — `grep -c 'href="/winners-admin"' public/*.html` shows 1 in each of the 12 files; `GET /robots.txt` contains `Disallow: /winners-admin`.
- [ ] **Step 3: Verify the flow in the browser** (logged in as admin on the dev server): create an edition → add Elite block → pick 2 players + type 1 name → Save block → upload a PNG on slot 1 → open `/vitazi`: new edition first, uploaded photo on the winner card, typed-name card not a link, picked-player card links to the profile, other slots show the player's profile photo or initials. Hide the edition → gone from `/vitazi`. Delete it → its photo file is removed from `data/winner-photos/`. Wrong file type shows the server error inline. No console errors.
- [ ] **Step 4: Commit** — `git add public/winners-admin.html public/js/winners-admin.js public/*.html src/seo.js && git commit -m "Winners: admin page and Winners tab"`

---

### Task 7: Docs, cleanup and final verification

**Files:**
- Modify: `README.md` (a "Winners page" section: files, how to edit in Backend > Winners, photo storage on the persistent disk, `node scripts/check-winners.js`), `docs/superpowers/specs/2026-10-07-vitazi-winners-page-design.md` (apply the "Spec adjustments" above)
- Delete: `public/_mock/` (temporary mockup copy; it would otherwise be deployed)

- [ ] **Step 1: Delete** `public/_mock/`, update the README and the spec.
- [ ] **Step 2: Run** `node scripts/check-winners.js` — Expected: every test PASS, exit code 0.
- [ ] **Step 3: Smoke test the whole app** on the dev server: `/`, `/harmonogram`, `/matches`, `/vitazi`, `/winners-admin`, `/seo-admin` load without console errors; header menu shows "Víťazi" after "Harmonogram" (after a restart with a fresh `DATA_DIR` so the seed and menu item run).
- [ ] **Step 4: Commit** — `git add README.md docs && git commit -m "Winners: docs"`; then report to the user and **wait for approval before pushing** (push to `main` deploys on Render).
