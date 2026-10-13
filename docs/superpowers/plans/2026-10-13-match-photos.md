# Match Photos (Google Drive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two players of a match (and admins) can add up to 5 photos to a match; the photos live in the owner's Google Drive, everyone sees them on the match page, and the other player gets a bell notification.

**Architecture:** A new `src/drivePhotos.js` talks to the Drive REST API with the same OAuth credentials the backup uses (`src/backup.js`). A new router `src/routes/matchPhotos.js` (mounted on `/api/matches`) lists/adds/removes photos; only a small `match_photos` row (Drive file id, uploader, time) is stored in SQLite, never the bytes. The match page gets a new client file `public/js/match-photos.js` (photo box, add button, resize-before-upload, lightbox). New-photo notifications reuse the bell with a new `PHOTO` type and a `photo_notifications` table, modelled on `chat_notifications`.

**Tech Stack:** Node/Express, `node:sqlite`, `multer` (memory storage, already installed), `google-auth-library` + plain `fetch` (as in `backup.js`), plain browser JS, node `assert` check scripts in `scripts/check-*.js`.

**Spec:** `docs/superpowers/specs/2026-10-13-match-photos-design.md` (read it first; this plan only records decisions the spec leaves open).

## Global Constraints

- Max **5 photos per match in total** (both players together), enforced on the server.
- Who adds: one of the two players of the match (`auth.getPlayerId(req)` equals `player1_id` or `player2_id`) or an admin. Referees, the match creator who is not playing, and anonymous visitors are refused. Who removes: the uploader or an admin. Anyone (no login) can view.
- Any match status; no restriction on PLANNED/LIVE/FINISHED.
- Files live only in Google Drive: no photo bytes on the data disk, none in the backup zip.
- Drive scope stays `drive.file`; do not change `backup.js` behaviour or the `GOOGLE_DRIVE_BACKUP_FOLDER_ID` variable. New variable: `GOOGLE_DRIVE_PHOTOS_FOLDER_ID`. Feature off (no button, `enabled:false`, POST 503) when it or any `GOOGLE_OAUTH_*` var is missing.
- Each uploaded file is made readable by "anyone with the link"; the page loads images straight from Google by file id.
- Photo box: 16:9, rounded, thin border, between the "Best of…" format line and the scoreboard on the match page only (not cards, home, profiles, embed).
- Notification: bell only (no phone push); the **other** player is notified; if an admin who is not in the match uploads, both players are; uploader never notified; removal notifies nobody.
- All visible text in Slovak and English in `public/js/i18n.js`.
- Delete order for a photo: revoke the public permission → delete the Drive file → delete the DB row; if Drive fails, log it and still delete the row.
- Do not push or deploy; commits stay local.

## Review Focus

1. Two uploads racing when the match has 4 photos: exactly one gets in, the loser's Drive file is deleted, response 409 (Task 2).
2. Empty, non-image, or oversized upload: 400 JSON error, nothing sent to Drive, nothing stored (Task 2).
3. Drive failing during upload: 502 JSON error, no row, no notification (Task 2).
4. Match deleted: its photo rows and photo notifications go away, Drive deletes are attempted, and the bell's unread count does not stay inflated (Tasks 2, 3).
5. Feature not configured (env missing): GET works and says `enabled:false`, no Add button, POST returns 503, nothing else on the match page changes (Tasks 2, 4).
6. A photo removed (or added) by someone else while the page/viewer is open: the page refreshes its list over the socket and the viewer closes or re-indexes instead of showing a dead image (Task 4).

---

### Task 0: Commit the pending chat-notification change on its own

**Files:** Modify (already edited, uncommitted): `src/routes/matches.js` (the chat insert now skips the poster).

- [ ] **Step 1:** `git status` shows only `src/routes/matches.js` modified (plus the design/plan docs). Commit just that file as `Chat: don't notify the player who wrote the message`. Do not push.

### Task 1: Drive photo client + database tables

**Files:**
- Create: `src/drivePhotos.js`, `scripts/check-match-photos-drive.js`
- Modify: `src/backup.js` (export `getAccessToken` only), `src/db.js` (two tables)

**Interfaces:**
- Produces (`src/drivePhotos.js`):
  - `isConfigured(): boolean`
  - `uploadPhoto(buffer: Buffer, mimeType: string, name: string): Promise<{ id: string }>` — uploads into `GOOGLE_DRIVE_PHOTOS_FOLDER_ID`, then adds the `{ type: 'anyone', role: 'reader' }` permission; if the permission call fails it deletes the file and throws.
  - `deletePhoto(fileId: string): Promise<boolean>` — revokes `permissions/anyoneWithLink`, deletes the file; never throws; logs and returns false on failure.
  - `imageUrl(fileId: string, width = 1600): string` and `thumbUrl(fileId: string): string` — both built from one template constant, default `https://drive.google.com/thumbnail?id={id}&sz=w{width}`, overridable by env `PHOTO_IMAGE_URL_TEMPLATE` (placeholders `{id}` `{width}`) so the form can change without a code change.
- Produces (`src/db.js`): `match_photos(id PK, match_id INTEGER NOT NULL, drive_file_id TEXT NOT NULL, uploaded_by_player_id INTEGER NULL, created_at TEXT default now ISO)` with index on `match_id`; `photo_notifications(id PK, player_id INTEGER NOT NULL, match_id INTEGER NOT NULL, photo_id INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT default now ISO)` with index on `player_id`. Same style and `CREATE TABLE IF NOT EXISTS` as `chat_notifications`.
- Consumes: `backup.getAccessToken(): Promise<string>`.

- [ ] **Step 1: Write the failing check** `scripts/check-match-photos-drive.js`, in the style of `scripts/check-backup.js` (temp `DATA_DIR`, fake `google-auth-library`, fake `global.fetch` recording calls). Tests: `isConfigured` is false until all five env vars are set; `uploadPhoto` posts the file into folder `photos1`, then POSTs a permission `{type:'anyone',role:'reader'}` and returns `{id}`; a failing permission call makes it delete the file and reject; `deletePhoto` calls `DELETE …/permissions/anyoneWithLink` before `DELETE …/files/{id}` and returns true; a failing Drive call makes it return false without throwing; `imageUrl('abc')` contains `abc` and `w1600`, and honours `PHOTO_IMAGE_URL_TEMPLATE`.
- [ ] **Step 2:** Run `node scripts/check-match-photos-drive.js`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/drivePhotos.js` per Interfaces (hand-built multipart like `backup.js`'s `uploadFile`; reuse `getAccessToken`), export `getAccessToken` from `backup.js`, add the two tables to `src/db.js`.
- [ ] **Step 4:** Run the new check and `node scripts/check-backup.js`. Expected: both pass.
- [ ] **Step 5: Commit** `Match photos: Drive client and tables`.

### Task 2: Photo routes (list, add, remove) and match-delete cleanup

**Files:**
- Create: `src/routes/matchPhotos.js`, `scripts/lib/fake-drive-preload.js`, `scripts/check-match-photos.js`
- Modify: `server.js` (mount `app.use('/api/matches', matchPhotosRouter)` next to the matches router), `src/routes/matches.js` (inside `router.delete('/:token')`, before `DELETE FROM matches`)

**Interfaces:**
- Consumes: `drivePhotos.*` (Task 1), `auth.getPlayerId`, `auth.isAdmin`, tables from Task 1.
- Produces:
  - `GET /api/matches/:token/photos` → `200 { enabled: boolean, max: 5, canAdd: boolean, photos: [{ id, url, thumbUrl, addedBy: string|null, createdAt, canRemove: boolean }] }` ordered oldest first; `addedBy` is the uploader's player name or `null` for an admin upload; `canAdd` already accounts for access, configuration and the 5 limit; 404 for an unknown token.
  - `POST /api/matches/:token/photos` multipart field `photo` → `201` with one photo object as above. Errors as JSON `{ error }`: 401/403 (no access), 400 (missing/not jpeg-png-webp/empty/over 10 MB), 409 (already 5), 502 (Drive failed), 503 (not configured).
  - `DELETE /api/matches/:token/photos/:id` → `204`; 403 if neither uploader nor admin; 404 if not on that match.
  - `module.exports.removeAllForMatch(matchId: number): void` — deletes the match's `match_photos` and `photo_notifications` rows and fires `drivePhotos.deletePhoto` for each file without awaiting.
  - Socket: after a successful add or remove, `req.app.get('io').to('match:' + token).emit('photos:changed', { token })`.
  - Notifications on add (rows in `photo_notifications`): recipients = both players minus the uploader's player id (an admin uploader has none, so both are notified).
- Race rule: check the count before uploading (fast fail) and again right before inserting (SQLite is synchronous there); if the second check fails, delete the just-uploaded Drive file and answer 409.

- [ ] **Step 1: Write `scripts/lib/fake-drive-preload.js`** — a Node `--require` preload for a child server: patches `google-auth-library` (fixed token) and `global.fetch` for `googleapis.com` Drive calls (upload, permission create/delete, file delete), keeps files in memory, appends each call as a JSON line to the file named by env `FAKE_DRIVE_LOG`, and can be told to fail by the presence of a file named by env `FAKE_DRIVE_FAIL`.
- [ ] **Step 2: Write the failing checks** `scripts/check-match-photos.js`, modelled on `scripts/check-match-video.js` (own server on a temp data dir with `NODE_OPTIONS=--require …/fake-drive-preload.js` and the `GOOGLE_*` + `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` env set; forged signed admin and player cookies). Tests, each named for its behaviour: unconfigured server → GET `enabled:false`, POST 503; logged-out visitor can GET but POST is 401/403; a player not in the match gets 403; player 1 adds a JPEG → 201 and appears in GET with `canRemove:true` for them and `false` for the other player; the other player (player 2) gets a `photo_notifications` row and player 1 does not; an admin upload makes `addedBy:null` and notifies both players; the 6th photo → 409; two simultaneous uploads with 4 existing → one 201, one 409, and the loser's file is gone from the fake Drive; text file / empty file / 11 MB file → 400 and no Drive upload in the log; Drive failure flag → 502 and no row and no notification; DELETE by uploader and by admin → 204, log shows permission revoke before file delete, row gone; DELETE by the other player → 403; deleting the match removes photo rows and notifications and logs Drive deletes.
- [ ] **Step 3:** Run `node scripts/check-match-photos.js`. Expected: FAIL (404 on the routes).
- [ ] **Step 4:** Implement `src/routes/matchPhotos.js` per Interfaces (multer memory storage, 10 MB, called manually so errors come back as JSON as in `routes/badges.js`), mount it in `server.js`, call `removeAllForMatch(row.id)` in the match delete route.
- [ ] **Step 5:** Run the check. Expected: all pass. Also run `node scripts/check-match-video.js` to confirm nothing else broke.
- [ ] **Step 6: Commit** `Match photos: routes, notifications rows, match-delete cleanup`.

### Task 3: Bell notifications for new photos

**Files:**
- Modify: `src/routes/player.js` (`countUnreadNotifications`, `GET /notifications`, the read route's type→table map), `public/js/common.js` (bell list rendering ~line 2867, read/click handler ~line 3011), `public/js/i18n.js`
- Test: extend `scripts/check-match-photos.js`

**Interfaces:**
- Consumes: `photo_notifications`, `match_photos` (Task 1/2).
- Produces: notification item `{ type: 'PHOTO', id, seen, createdAt, photo: { matchToken, uploaderName: string|null } }`; `POST /api/player/notifications/photo/:id/read` marks it read. Count and list must use the same joins (`matches` and `match_photos`) so a deleted match/photo neither shows nor inflates the count — as the chat query does.
- i18n keys (SK and EN): `notif.photoTitle` = "📷 {name} added a photo to your match" / "📷 {name} pridal fotku k tvojmu zápasu"; reuse `common.admin` when `uploaderName` is null. Tapping opens `/match/<token>` and marks it read, like chat.

- [ ] **Step 1: Add failing tests** to `check-match-photos.js`: after player 1 uploads, `GET /api/player/notifications` as player 2 contains one `PHOTO` item with the match token and player 1's name; the session payload's `unreadNotificationCount` includes it; the read route sets it seen and lowers the count; after the photo is removed the item is gone and the count is back to 0; the same after the match is deleted.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement the server side in `player.js` and the client rendering/click/read mapping in `common.js` plus the i18n keys.
- [ ] **Step 4:** Run `node scripts/check-match-photos.js`; expected pass. Syntax-check changed JS with `node --check`.
- [ ] **Step 5: Commit** `Match photos: bell notification`.

### Task 4: Match page UI

**Files:**
- Create: `public/js/match-photos.js`
- Modify: `public/match.html` (load the script before `match.js`), `public/js/match.js` (state load in `init()`, markup between the `.match-header` block and `scoreboardHtml(m, durationHtml)` in `render()`, binding after `root.innerHTML` is set, `photos:changed` socket handler), `public/css/style.css`, `public/js/i18n.js`

**Interfaces:**
- Produces in `match-photos.js` (globals, the project's style): `loadMatchPhotos(token): Promise<void>` (fills module state; on error keeps `enabled:false`), `matchPhotosHtml(): string` (empty string when there are no photos and the viewer cannot add; otherwise the photo box and/or Add button), `bindMatchPhotos(token, onChange: () => void): void`, `resizeImageForUpload(file: File, maxSide = 1800, quality = 0.85): Promise<Blob>` (canvas → JPEG; returns the original file if decoding fails), `openPhotoViewer(startIndex: number): void`.
- Behaviour to build (details in the spec): first photo fills a 16:9 `border-radius` box (cover); with 2+ photos a pill "📷 +N" (Slovak plural forms 1 fotka / 2–4 fotky / 5+ fotiek, like `attemptsWord` in `common.js`; English "+N photos"); clicking the box opens the viewer (counter "2 / 4", close button, prev/next arrows, swipe, thumbnail strip, caption "Added by <name>" or "Added by admin", Remove for photos with `canRemove`, Esc and backdrop close); Add button shows "＋ Add photo (n / 5)", opens `<input type="file" accept="image/*">`, shows an uploading state, toasts errors from the API, and hides at 5; after add/remove call `loadMatchPhotos` then re-render. `match.js` must not lose the photo state on its frequent `render()` calls (state lives in `match-photos.js`, markup is regenerated each render like the chat card).
- i18n keys (SK/EN): `match.photoAdd`, `match.photoUploading`, `match.photoMore`, `match.photoAddedBy`, `match.photoAddedByAdmin`, `match.photoRemove`, `match.photoRemoveConfirm`, `match.photoClose`.

- [ ] **Step 1:** Implement the client pieces above and CSS (dark box, `var(--radius)`-style rounding as the other dark cards, thin border like `.statistics-card`'s, responsive at phone width).
- [ ] **Step 2: Verify in the browser** with `preview_start` `blta-score-dev`-style local server started with `node -r ./scripts/lib/fake-drive-preload.js server.js` and `PHOTO_IMAGE_URL_TEMPLATE` pointing at a local test image path served from `public/`, logged in as a player of a match: Add button visible only for the two players and admins; uploading shows the box; 2+ photos show the pill; the viewer opens, swipes/arrows, removes; logged-out view shows photos but no button; unset `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` shows nothing new. Check the console for errors and view at 375px width.
- [ ] **Step 3:** `node --check` every changed JS file; run all `scripts/check-match-photos*.js`.
- [ ] **Step 4: Commit** `Match photos: match page UI`.

### Task 5: Configuration and docs

**Files:** Modify `.env.example`, `README.md`

- [ ] **Step 1:** In `.env.example` document `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` (make a Drive folder for match photos, copy its id from the URL; same Google account/credentials as the backup; feature stays off without it) and optional `PHOTO_IMAGE_URL_TEMPLATE`.
- [ ] **Step 2:** Add a short "Match photos" section to `README.md` (what it does, rules, the env var, that photos are not part of the backup, how to run the checks), and add a line to the scripts/checks list if one exists.
- [ ] **Step 3:** Write the owner's first-real-test checklist at the end of the README section: set the variable on Render, deploy, log in as a player of a match, add one photo, open the match logged out and confirm the photo shows, remove it and confirm it disappears from the Drive folder; if the image does not show logged out, change `PHOTO_IMAGE_URL_TEMPLATE` (alternative form `https://lh3.googleusercontent.com/d/{id}=w{width}`) before considering a server-side image proxy.
- [ ] **Step 4: Commit** `Match photos: config and docs`.

---

## Self-review notes

- Spec coverage: box/pill/viewer/add button (T4); rules, limit, race, who removes (T2); Drive-only storage and public-link viewing (T1); notification (T3); feature switch/env (T1, T5); no-local-credentials caveat and first real test (T2 fake Drive, T5 checklist); URL fallback single place (T1 template + T5).
- Types match across tasks: `match_photos`/`photo_notifications` columns (T1) are what T2/T3 query; photo object shape (T2) is what T4 reads; `PHOTO` item shape (T3) is what `common.js` renders.
