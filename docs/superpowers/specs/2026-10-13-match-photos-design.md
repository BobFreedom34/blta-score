# Match photos (stored in Google Drive) — design

## Intent and why

The two players of a match should be able to add photos of that match (up to 5), and everyone who opens the match page should see them. The owner does **not** want photo files on the app's own server/disk: the photos live in the owner's Google Drive, and the match page reads the right ones from there.

The site is already connected to the owner's Google Drive for the daily database backup (`src/backup.js`, OAuth2 refresh token as the owner's own account, scope `drive.file`). Photos reuse that same connection.

## What the user sees

Everything below is on the **match page** (`public/match.html` + `public/js/match.js`). Match cards in lists are unchanged.

- **Photo box.** If the match has at least one photo, the first photo shows in its own box directly **between the "Best of 3 sets…" line under the title and the scoreboard**: 16:9 ratio, rounded corners (same radius as the other dark boxes), thin border. The photo fills the box (cover). Matches with no photos show nothing there for visitors.
- **More photos hint.** If there are 2+ photos, a small pill in the bottom-right of the box says e.g. "📷 +3 photos" (text translated SK/EN like the rest of the app).
- **Viewer.** Tapping the box opens a full-screen viewer: counter ("2 / 4"), close button, previous/next arrows and swipe left/right on phones, a thumbnail strip, and a caption "Added by <player name>". The viewer shows a "Remove" action on photos the current user may remove (see rules).
- **Add photo button.** Only a logged-in player who is one of the two players of this match (or an admin) sees "＋ Add photo (n / 5)" under the photo box (or in its place when there are no photos yet). It opens the phone's photo picker/camera; the chosen photo uploads and appears without a page reload. The button disappears (or is disabled) at 5 photos.
- The mockups the owner approved: `.superpowers/brainstorm/1890-1791902272/content/photo-layout.html` (gitignored scratch; the description above is authoritative).

## Rules

- **Who can add:** one of the two players of the match, identified by the player login cookie (`getPlayerId(req)` equals `player1_id` or `player2_id`), or an admin. Not referees, not the match creator unless they are one of the two players, not anonymous visitors. (Same shape as `checkLiveScoreAccess` in `src/routes/matches.js` minus the referee.)
- **Who can remove:** the player who added that photo, and admins. (Owner confirmed removal by the uploader; admin removal is the builder-confirmed default.)
- **When:** any time — planned, live or finished. No status restriction.
- **Limit:** 5 photos per match in total (shared by both players, not 5 each). Enforced on the server, not just by hiding the button.
- **Who can see:** everyone, no login.

## How it is built (decisions made with the owner)

- **Photo files live only in Google Drive**, in a dedicated Drive folder for match photos. The app stores only a small database row per photo: the match, the Drive file id, who added it, and when. Nothing is written to the data disk.
- **Viewing: straight from Google.** Each uploaded file is made readable by "anyone with the link" and the page loads the images directly from Google by file id, so photo views don't go through the app server. The owner accepted that anyone holding a photo's (unguessable) link can open it.
- **Uploading:** the phone sends the photo to the app's server, and the server forwards it to Drive using the existing Drive credentials; the server keeps no copy. (The photo passes through the server in memory during upload only.)
- **Deleting** a photo removes the database row and also deletes the file from Drive.

## Goals

- A player can add a photo from a phone in a couple of taps and it shows to everyone.
- No photo bytes stored on the server disk or in the backup zip.
- Feels like the rest of the match page (dark theme, same radius/border language, SK/EN).

## Non-goals

- Photos on match cards, the home page, player profiles or the embed widget (match page only).
- Notifications (bell/push) when a photo is added.
- Captions, likes, comments, reordering, or per-photo reporting.
- Letting non-players or anonymous visitors upload.
- Video.

## Anti-goals (would be a failure even if it technically works)

- Photos stored on the app server's disk.
- Anyone other than the two players (and admins) being able to add or delete photos.
- Uploading a multi-megabyte phone photo over mobile data with no progress feedback or no size shrinking so that it fails or takes minutes.
- Breaking the existing daily Drive backup (it uses the same Google credentials — do not change its scope handling or folder variable).

## Constraints and things known about the project

- Stack: Node/Express, SQLite (`src/db.js`, tables created with `CREATE TABLE IF NOT EXISTS`), plain JS front end (`public/js/*.js`, `i18n.js` for SK/EN text), `multer` already a dependency (`src/routes/badges.js` shows the in-memory upload pattern), `google-auth-library` already used by `src/backup.js` with plain `fetch` calls to the Drive REST API.
- The existing Google OAuth refresh token was minted with scope `https://www.googleapis.com/auth/drive.file` (`scripts/get-drive-refresh-token.js`). That scope only lets the app touch files **it created itself**, which is exactly what is needed here (the app creates the photo files; making them link-readable is a permission change on those same files). If a different scope turns out to be needed, the owner must re-run that script once — tell them.
- Env vars: the backup uses `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` and `GOOGLE_DRIVE_BACKUP_FOLDER_ID`. Match photos need their own folder id (suggested: `GOOGLE_DRIVE_PHOTOS_FOLDER_ID`), documented in `.env.example`; if it is not set, the feature is simply off (no Add button, nothing breaks) — same "not configured → skip" convention as the backup.
- The server sets no Content-Security-Policy, so loading images from Google needs no header change.
- Deploys happen by `git push` to `main` (Render auto-deploys); the new env var must be set on Render by the owner before the feature turns on.
- Delete handling: `src/db.js` has a routine that deletes matches together with child rows (see the comment near line 20 about child tables); photo rows must be removed with their match, and their Drive files should be deleted too (best effort).

## Left to the builder

- Exact table/column names and the API shape (e.g. `GET /api/matches/:token/photos`, `POST …/photos`, `DELETE …/photos/:id`), and whether photo info is included in the existing match payload.
- Which Google image URL form to use (`https://drive.google.com/thumbnail?id=<id>&sz=w1600` vs `https://lh3.googleusercontent.com/d/<id>=w1600` etc.). **Verify early, with a real upload from this account, that the chosen form actually renders in an `<img>` for an anonymous visitor** and is not blocked or rate-limited; this is the main technical risk.
- Shrinking the photo on the phone before upload (suggested: canvas resize to about 1600–2000 px on the long side, JPEG ~0.85) plus a server-side size cap and file-type check (JPEG/PNG/WebP/HEIC handling is the builder's call).
- Upload progress/spinner and error toasts, translations, viewer implementation details (own small lightbox, no new library needed).
- Behavior when Drive is unreachable (clear error toast, nothing saved) and when a photo's Drive file has vanished (hide the broken image gracefully).
- Tests/check script in the style of `scripts/check-backup.js` (fake Drive, no network) if sensible.

## Calls made without the owner (for the owner to check)

Added after the builder check:

- **No local Google credentials.** The local `.env` has no `GOOGLE_*` values, so the builder cannot test against the real Drive. Build and check everything against a fake Drive (as `scripts/check-backup.js` does). The first real upload happens after the owner deploys and sets the photos folder env var on Render; the plan should include a short "first real test" step for the owner (upload one photo, confirm it shows for a logged-out visitor).
- **If Google's direct image link doesn't render for anonymous visitors:** keep the image URL in one single place in the code so it is a one-line change, and if no direct form works, fall back to the server streaming the image from Drive on request (no disk copy, small cache header) and tell the owner this is what happened. Never store files on disk as a fallback.
- **Admin uploads:** the uploader column is nullable. A photo added by an admin who is not one of the two players is shown as "Added by admin"; admins can remove any photo.
- **Deleting a photo:** first remove the public "anyone with the link" permission on the Drive file, then delete the file, then the database row. If Drive fails, log it, still remove the row so the photo disappears from the page, and accept that a rare orphan file may remain in the (private-by-default, link-unknown) folder. No cleanup sweep.
- **Deleting a whole match:** same as above for each of its photos, best effort.
- **Privacy:** the owner accepted link-readable photos; no extra consent flow is built.

- 5 photos is a total per match, not per player.
- Admins can also add and remove photos.
- Match page only; no notifications.
- Feature stays off until the photos folder id env var is set.
