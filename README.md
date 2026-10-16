# BLTA

Live score tracking app for the BLTA amateur tennis league, built to run on **score.blta.sk**.

- Plan matches, add players, pick a format (best of 1/3/5 sets, with or without a
  match-tiebreak deciding set), in one of four categories (Elite / Next Gen / Novice / Friendly)
- Score live with big +1 / -1 buttons, undo mistakes, a running match timer
- Share a match by link or WhatsApp, or embed it (or the whole live-matches list)
  on the blta.sk WordPress site via `<iframe>` — every match link is an unguessable random
  token, not a sequential number, so it can't be guessed
- Emails you (robert.sloboda@gmail.com) automatically when a match finishes
- A single **admin** login (§4) can add/rename/delete players and correct a match after it's
  finished — everyone else can still plan matches and score live, same as before
- No build step, no framework — plain Node.js + a SQLite file. Easy to read, easy to edit.

---

## 1. How it's built (so future edits make sense)

```
blta-score/
  server.js                  ← entry point: Express app + Socket.IO + routes
  src/
    db.js                    ← SQLite connection + table schema + migrations
    matchEngine.js            ← tennis scoring rules (sets/games/tiebreaks) — pure logic, no DB/HTTP
    mailer.js                 ← sends the "match finished" email
    auth.js                   ← admin login cookie (sign/check), requireAdmin middleware
    routes/players.js         ← REST API: /api/players
    routes/matches.js         ← REST API: /api/matches/...
    routes/admin.js           ← REST API: /api/admin/login, /logout, /session
  public/                     ← everything the browser loads directly, no build step
    index.html (league overview), matches.html (match list), match.html, new-match.html, players.html, admin.html
    embed-live.html, embed-match.html   ← stripped-down pages made for <iframe>
    css/style.css              ← all styling, using blta.sk's brand colors as CSS variables
    js/*.js                    ← one plain JS file per page, talks to the REST API + Socket.IO
  render.yaml                 ← Render Blueprint (web service + persistent disk config)
  data/blta-score.db          ← the entire database (a single file), unless DATA_DIR
                                 points elsewhere (e.g. a mounted disk on Render). Back this up.
```

There is **no React, no build tool, no TypeScript**. Every page is a plain `.html` file with
a matching `.js` file. To change something you almost always edit exactly one HTML file, one
JS file, and/or `style.css` — restart the app, refresh the browser, done.

Live updates work over Socket.IO: whenever the server changes a match (score, start, finish,
location edit) it broadcasts the new match to everyone currently viewing it, and a lighter
signal to everyone on the home page so lists refresh automatically.

Match formats and the tennis rules (tiebreak at 6-6, match-tiebreak deciding set, etc.) live in
one file: `src/matchEngine.js`. It's covered by hand-written tests you can re-run any time —
see §6.

---

## 2. Run it locally first

You need **Node.js 22.5 or newer** (Node 24 LTS recommended — that's what this was built and
tested against). Check with `node -v`.

```bash
cd blta-score
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000 — you should see the (empty) matches list. Create a player, plan a
match, start it, and click the score buttons to confirm everything works before you touch a
server.

---

## 3. Deploying to score.blta.sk

The app is a small always-on Node.js process (it needs to stay running for live WebSocket
updates), so it needs somewhere that can run Node continuously. **blta.sk's own hosting
(WebSupport shared "Hosting") can't run this** — it's PHP-only, no Node.js support. Three
options, in the order this README recommends them:

- **§3a — Render** (recommended): easiest to set up and maintain, ~$7.25/month, no server to
  patch or SSH into.
- **§3b — a VPS** (e.g. WebSupport's own VPS product, ~€9.90/month with a 7-day free trial):
  more control, marginally cheaper, but you're responsible for OS updates/security yourself.
- **§3c — cPanel "Setup Node.js App"**: only if your host happens to offer it (WebSupport
  doesn't — they use their own "WebAdmin" panel, not cPanel).

### 3a. Render (recommended)

This repo already includes a `render.yaml` **Blueprint** — Render reads it and pre-configures
almost everything (the web service, a 1 GB persistent disk for the database, and the required
environment variables) automatically. You just need a GitHub account and a Render account.

**Step 1 — Push this project to GitHub.**

If you don't already have a repo for it:

```bash
cd blta-score
git add -A
git commit -m "Initial commit"
```

Then create a new **private** repository on https://github.com/new (any name, e.g.
`blta-score`), and push:

```bash
git remote add origin https://github.com/<your-username>/blta-score.git
git branch -M main
git push -u origin main
```

**Step 2 — Deploy the Blueprint on Render.**

1. Sign up / log in at https://dashboard.render.com (free to create an account).
2. **New +** → **Blueprint** → connect your GitHub account → select the `blta-score` repo.
3. Render reads `render.yaml` and shows you a preview: one web service (`blta-score`, Starter
   plan, $7/month) with a 1 GB disk ($0.25/month) attached. Click **Apply**.
4. It'll ask you to fill in the secret values marked `sync: false` in the blueprint —
   `SMTP_USER`, `SMTP_PASS` (see §5 below for getting the Gmail app password) and `ADMIN_PASSWORD`
   (see §4 — pick your own admin password here). You can also skip SMTP for now and add it later
   from the service's **Environment** tab — the app runs fine without it, it just won't be able
   to send the finished-match email (or a login-code reset/request email — see §4b) yet.
   `ADMIN_PASSWORD` is worth setting right away, though, or that login won't work. Player login
   itself needs no setup here — each player logs in with their own phone number, set per-player
   on the Players page once you're logged in as admin.
5. Render builds and deploys automatically. First deploy takes a couple of minutes — watch the
   **Logs** tab for `BLTA score app listening on http://localhost:...`.

**Step 3 — Point score.blta.sk at it.**

In Render: open the `blta-score` service → **Settings** → **Custom Domains** → **Add Custom
Domain** → enter `score.blta.sk`. Render shows you a CNAME target that looks like
`blta-score.onrender.com` (copy the exact value it gives you — it may differ slightly).

Then, on WebSupport: log into **WebAdmin** → click the `blta.sk` domain → left menu **DNS** →
tab **CNAME** → add a record:

```
Subdoména (name): score
Cieľová hodnota (target): blta-score.onrender.com   ← use the exact value Render gave you
TTL: default
```

(Any other DNS provider: same thing, just a CNAME record, host `score`, pointing at the
`.onrender.com` address.) Render automatically issues a free TLS certificate for the domain
once the CNAME resolves — that can take anywhere from a few minutes to a few hours.

**Step 4 — Verify.**

Visit `https://score.blta.sk`. Create a test match, score it live, finish it, and confirm the
email arrives (once SMTP is configured).

**Future updates:** commit your changes and `git push` — Render redeploys automatically
(`autoDeploy: true` in the blueprint). No SSH, no PM2, no Nginx to manage.

### 3b. VPS path (Ubuntu, e.g. WebSupport VPS or any other provider)

**You'll need:** a VPS as above, and access to `blta.sk`'s DNS settings.

**Step 1 — Point the subdomain at the server.**

On WebSupport specifically: log into **WebAdmin** → click on the `blta.sk` domain in your
service list → left menu **DNS** → tab **A** → add a record:

```
Subdoména (name): score
Cieľová IP (target IP): <your VPS's public IPv4 address>
TTL: default
```

(On any other DNS provider, the equivalent is just: add an **A record**, host `score`,
pointing at the VPS's IP.)

DNS changes can take a few minutes to a few hours to propagate.

**Step 2 — Install Node.js on the VPS.**

```bash
ssh root@your-server-ip

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
node -v   # confirm 22.5+ (24.x recommended)
```

**Step 3 — Get the code onto the server.**

The easiest way is to push this project to a private GitHub repo and clone it — that also
makes future updates a one-line `git pull`. If you'd rather not use git, `scp -r` the
`blta-score` folder to the server instead.

```bash
cd /var/www
sudo git clone <your-repo-url> blta-score
cd blta-score
sudo chown -R $USER:$USER /var/www/blta-score
npm install --omit=dev
```

**Step 4 — Configure environment variables.**

```bash
cp .env.example .env
nano .env
```

Set at minimum:
- `PUBLIC_URL=https://blta.sk` (the one address of the site: share links, emails, canonical links, the sitemap)
- `REDIRECT_HOSTS=score.blta.sk,blta-score.onrender.com` (optional: the old addresses; a page request on one of them is sent on to `PUBLIC_URL` with a
  301, same path and query. `/api/`, `/socket.io/` and `/healthz` still answer there, and POST is never redirected. Check: `node scripts/check-redirect.js`)
- SMTP settings so the "match finished" email — and a player's login-code reset/request emails,
  see §4b — can send (see §5 below for the Gmail setup)
- `ADMIN_PASSWORD` and `SESSION_SECRET` (see §4) so the admin login works
- Player login itself needs no env var — each player logs in with their own phone number, set
  per-player on the Players page as admin

**Step 5 — Run it permanently with PM2** (keeps it running, restarts it if it crashes or the
server reboots).

```bash
sudo npm install -g pm2
pm2 start server.js --name blta-score
pm2 save
pm2 startup   # run the one command it prints, then `pm2 save` again
```

**Step 6 — Nginx reverse proxy** (so the public internet reaches your app over port
80/443, and so WebSockets — used for live score updates — work correctly).

```bash
sudo nano /etc/nginx/sites-available/score.blta.sk
```

```nginx
server {
    listen 80;
    server_name score.blta.sk;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/score.blta.sk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
```

**Step 7 — Free HTTPS certificate.**

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d score.blta.sk
```

Certbot edits the Nginx config to redirect HTTP → HTTPS and auto-renews every 90 days.

**Step 8 — Verify.**

Visit `https://score.blta.sk` — you should see the live matches list load with the padlock
icon. Create a test match and score a point to confirm the live update and, once you finish a
match, that the notification email arrives.

### 3c. If your host uses cPanel with "Setup Node.js App"

Some hosts (not WebSupport — they use their own WebAdmin panel, not cPanel) offer a built-in
Node.js app manager. If yours does, it's a shorter path that skips Nginx/PM2/certbot entirely:

1. Upload the `blta-score` folder (minus `node_modules`) via File Manager or SFTP.
2. cPanel → **Setup Node.js App** → Create Application:
   - Node.js version: 22.x or newer
   - Application root: the folder you uploaded
   - Application URL: `score.blta.sk`
   - Application startup file: `server.js`
3. Open the app's "Run NPM Install" button (or SSH in and run `npm install --omit=dev`).
4. Add the environment variables from `.env.example` in the "Environment variables" section
   of the same page (or upload a `.env` file — either works, `.env` takes priority if present).
5. Press **Restart**. cPanel handles the reverse proxy and HTTPS certificate for you.

Note: not every shared-hosting Node.js integration proxies WebSockets correctly — if live
score updates don't appear instantly after following this path, that's the first thing to
check with your host.

---

## 4. The admin account

Once someone is logged in as a player (see §4b below) or as admin, they can still score a live
match, pause/resume/restart it, undo points, and chat — that's unchanged. Only two things require
logging in as **admin** at `/admin` (a single password, no username — visible as an "Admin" link
in the top nav on every page):

- Adding, renaming, or deleting a player from the **Players** page
- Editing the location/category, or correcting the score, of a match that's already **finished**
  (once a match is finished it's normally locked, so a mistake caught later needs an admin to fix it)

Set the password via the `ADMIN_PASSWORD` environment variable:
- **On Render:** service → **Environment** tab → set `ADMIN_PASSWORD`. `SESSION_SECRET` (used to
  cryptographically sign the login cookie) is auto-generated by the Render Blueprint — you don't
  need to set it yourself.
- **On a VPS:** set both `ADMIN_PASSWORD` and `SESSION_SECRET` in `.env`. Generate a random
  secret with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

The login is a single long-lived cookie (30 days) scoped to whichever browser/device you log in
on — there's no separate account system, so treat the password like you would a shared door key.
An admin session automatically counts as being logged in as a player too, everywhere.

---

## 4b. Player login (phone number + 5-digit code)

Anyone can still browse matches, view a live score, and read a match's chat — no login needed for that. But
**writing in a match's chat (the name on a message is the login's own, "Admin" for an admin who is not also a player), creating a new match, starting a live match, entering a result manually, and setting a match's
date/location** all require being logged in as a **player** first, via the "LOG IN AS PLAYER" link
in the top nav. There's no anonymous/no-account login tier anymore — a phone number on file (or
admin) is the only way in.

Unlike the admin account, this isn't one shared password — each player logs in with their own
phone number (Slovak mobile format, e.g. `0903111222`), which doubles as their identity: a
logged-in player can only manage a match they play in (if an admin created it) or a match they
created themselves — not every match in the league.

**First login vs. every login after that:** the very first time (phone number alone), they're
logged in immediately and prompted to create a 5-digit code on the spot. Every login after that
needs both the phone number and that code. Five wrong codes in a row locks the account until it's
reset (see below) — this also applies to any existing player who hasn't logged in again since
this shipped, since they don't have a code yet either.

**Forgotten code:** the login popup's "Forgot your code?" link emails a one-time reset link if
that player has an email on file (set from their own profile, or by an admin) — SMTP has to be
configured for this to actually send (see §5). With no email on file, a "Send request to admin"
button emails `NOTIFY_EMAIL` instead; an admin then clears their code from the player's own
profile page (**Upraviť profil** → **Resetovať prihlasovací kód**, admin-only), which lets them
log in with just their phone number again and re-prompts them to set a new code.

There's no self-registration — an admin sets each player's number from their entry on the
**Players** page (logged in as admin, an "Edit phone" control appears there). A player with no
number on file yet simply can't log in until an admin adds one. Nothing to configure in the
environment for any of this — it's all in the database.

---

## 5. Setting up the "match finished" email

The app emails **robert.sloboda@gmail.com** automatically whenever a match is marked finished,
with the players, score, category, location and duration. It sends *from* the blta.sk mailbox
(`score@blta.sk`, hosted by WebSupport) — find that mailbox's credentials in WebAdmin under
the mailbox's **Prihlasovacie údaje** (login details) page: it shows the outgoing mail server
(`smtp.m1.websupport.sk`), port (`465`), and security (`SSL/TLS`), which already match what's
hardcoded in `render.yaml`. You only need to supply the mailbox password:

- **On Render:** service → **Environment** tab → set `SMTP_USER=score@blta.sk` and
  `SMTP_PASS=<the score@blta.sk mailbox password>` → **Save Changes** (triggers a redeploy
  automatically). The other SMTP values are already set by `render.yaml`.
- **On a VPS:** edit `.env` on the server (see the full block below), then
  `pm2 restart blta-score`.

```
SMTP_HOST=smtp.m1.websupport.sk
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=score@blta.sk
SMTP_PASS=<the score@blta.sk mailbox password>
NOTIFY_EMAIL=robert.sloboda@gmail.com
MAIL_FROM="BLTA <score@blta.sk>"
```

Finish a test match to confirm the email arrives — if SMTP isn't configured, the app logs a
warning and simply skips sending, it never crashes.

Using a different mailbox (e.g. a personal Gmail) instead is just as easy — swap in that
provider's SMTP host/port and an app-specific password if it requires one (Gmail: Google
Account → Security → 2-Step Verification → App Passwords).

---

## 6. Making future adjustments

**Restart after any change** (nothing is hot-reloaded):

- **On Render:** `git push` — it redeploys automatically (`autoDeploy: true`). Watch progress
  in the **Events**/**Logs** tabs of the service.
- **On a VPS:**
  ```bash
  cd /var/www/blta-score
  git pull            # if you edited locally and pushed, or edited directly with nano/File Manager
  pm2 restart blta-score
  ```

**Common edits and where to make them:**

| What you want to change | File |
|---|---|
| Colors, fonts, spacing, look & feel | `public/css/style.css` (all colors are CSS variables at the top) |
| Season maker (players of each group, round-robin schedule, withdrawals → walkovers) | `src/roundRobin.js` (schedule maths), season routes in `src/routes/seasons.js`, admin screen `public/js/seasons-admin.js` (tables `season_group_members`, `matches.round`) |
| Link-preview picture of a finished match (WhatsApp etc., 1200×630 PNG at `/match/:token/preview.png`) | `src/shareImage.js` (fonts in `assets/fonts`), meta tags in `server.js` |
| Match list layout / tabs / filters (page `/matches`) | `public/matches.html` + `public/js/app.js` |
| Home page (league overview: series progress, group leaders, results, rankings…) | `public/index.html` + `public/js/home.js` (styles: `/* Home: league overview */` in `public/css/style.css`) |
| The "new match" form (fields, format options) | `public/new-match.html` + `public/js/new-match.js` |
| The live scoring screen | `public/match.html` + `public/js/match.js` |
| What the WordPress embeds look like | `public/embed-live.html`, `public/embed-match.html` + matching `.js` files |
| Match formats / tennis scoring rules | `src/matchEngine.js` — see the `FORMATS` object at the top |
| Categories (currently Elite / Next Gen / Novice / Friendly) | Add the new value to `CATEGORIES` in `src/routes/matches.js`, then add a matching `<option>` in `public/new-match.html` and `public/matches.html`, and a badge color in `public/css/style.css` (search `badge-FRIENDLY` for the pattern) |
| The finished-match email content | `src/mailer.js` |
| What the admin account can do | `src/routes/matches.js` and `src/routes/players.js` — search for `isAdmin`/`requireAdmin` to see every gated action |

**Adding a 4th match format** (e.g. "Best of 3, no-ad scoring"): add an entry to the `FORMATS`
object in `src/matchEngine.js`, then add a matching entry to the `FORMATS` array in
`public/js/new-match.js` (label + short description) so it shows up as an option on the New
Match page.

**Re-running the scoring engine tests** after changing `src/matchEngine.js` — there's no
test framework wired in (kept dependency-free), but you can sanity-check changes quickly:

```bash
node -e "
const e = require('./src/matchEngine');
let s = e.initState('BO3');
for (let i=0;i<6;i++) s = e.applyDelta(s,'BO3',1,1);
console.log(e.describeMatch(s)); // → 6-0
"
```

**Backups.** The entire database is one file: `blta-score.db` (plus `-wal`/`-shm` companions
while the server is running), living wherever `DATA_DIR` points.

- **Google Drive (automatic):** `src/backup.js` makes **one backup a day** — `blta-score-backup-<date>.db` plus
  `blta-score-files-<date>.zip` (the photos and images on the disk). The server checks hourly and a few minutes after a start;
  from `BACKUP_HOUR_UTC` (default 1, i.e. 02:00/03:00 in Bratislava) the first check of the day makes the backup, every later check
  finds today's files in the Drive folder and does nothing — so **a restart or a deploy never uploads again** (it used to upload
  a full ~38 MB backup after every deploy). A half-made day (only the .db is there) gets just the missing file; a day the app was
  down at night is made up for at the next check. If Drive cannot be asked, nothing is uploaded blindly and the failure e-mail goes
  out once a day. The admin's "Back up now" button always uploads (`runBackup({ force: true })`).
  Check: `node scripts/check-backup.js` (fake Drive, no network).

- **On Render:** open the service's **Shell** tab (in the dashboard) and download the file, or
  connect via `render disks` in the Render CLI. Render also snapshots persistent disks
  automatically, but for extra safety you can copy `/var/data/blta-score.db` out periodically.
- **On a VPS:** the file is at `/var/www/blta-score/data/blta-score.db`. A nightly cron job
  works well:
  ```bash
  0 3 * * * cp /var/www/blta-score/data/blta-score.db /var/backups/blta-score-$(date +\%F).db
  ```

### Rankings (the app's own tables)

The Rankings page (BLTA overall, Elite / Next Gen / Novice race, Tournaments) is calculated and stored by the app itself — nothing
is read from or sent to blta.sk any more.

- **Points rule** (`src/rankingPoints.js`, from the Propozície): win 2:0 → 3, win 2:1 → 2, loss 1:2 → 1, loss 0:2 → 0, times 10 for
  Elite, 7 for Next Gen, 4 for Novice (so 30 / 20 / 10 / 0 in Elite). Both players get the points in the overall BLTA table and in
  the race table of the category. A walkover or retirement is a clean 3 / 0. Only Elite, Next Gen and Novice matches count, and only
  those decided in two sets.
- **When:** a finished match adds its points at once. A corrected score, a restarted match or a deleted match first takes back
  exactly what it added (the ledger is the `ranking_awards` table), so nothing is ever counted twice.
- **Bonus points, tournament points, any correction:** Rankings page, logged in as admin → *Upraviť* on a row, or the form under the
  table (it also works for a player who is not in that table yet).
- **Where the starting numbers came from:** `src/rankingsBaseline.json`, a saved copy of the blta.sk tables (taken on the day the
  app took over). `src/rankingsSeed.js` loads it once, on the first start, and rebuilds the ledger of the matches that were already
  counted. After that the file is never read again.
- **Check:** `node scripts/check-rankings.js`.

### Winners page (`/vitazi`)

The public winners page and its editor. Edit it in **Backend → Winners** (`/winners-admin`): an *edition* is a series or
tournament, it has a *block* per category (or an own title such as "Konečné poradie"), and a block has four places — winner,
finalist, two semifinalists — each a player from the list or a typed name, with an optional own photo (otherwise the player's
profile photo is shown). Hiding an edition removes it from the page without deleting it.

- Files: `src/routes/winners.js` (API, `/api/winners`), `src/winnersSeed.js` (one-time load of the blta.sk winners of
  2026-10-07), `public/vitazi.html` + `public/js/vitazi.js`, `public/winners-admin.html` + `public/js/winners-admin.js`,
  `.win-*` styles at the end of `public/css/style.css`.
- Own photos are saved in `<data dir>/winner-photos/` (the persistent disk, included in the Drive backup), not in `public/`.
- Foreign keys are not enforced in this database, so the router deletes an edition's blocks, places and photo files itself.
- Check it: `node scripts/check-winners.js` (starts its own server on a temporary data folder; nothing else is touched).

### Tennis courts list (`/courts`, Backend → Courts `/venues-admin`)

The venues are edited in Backend → Courts. `src/venueSeed.js` fills in details once (per venue / per database, `venues.seeded_at`) and **adds venues from the code once each** (`NEW_VENUES`, flags `venue_added_*` in `app_flags`, so a venue an admin deletes stays deleted): TK Pro Set, TK Dúbravka - Lysákova, Top Tenis - Budatínska, Love4Tennis, TK Júliusa Pántika - Senec, Tenis Club 26, Matchball — details from the clubs' own sites or Facebook pages (contact, prices, booking link, hours; a surface, a court count or an address a source does not state is left empty — Tenis Club 26 has the street (Stavbárska) but no house number and no map pin yet). A venue the admin already made as "Proset", "Dúbravka"… gets the details instead of a twin. A match's free-text location finds a venue by its name or a part of it; a name of several words is also known written together ("Pro Set" = "Proset"). To add another venue, add an entry to `NEW_VENUES`.
- Check: `node scripts/check-venue-seed.js`.
- **Venue photos:** the card on `/courts` shows a photo above the venue's name (column `venues.image_url`, alt text "Kurty - <name>"), always in a **16:9 frame — 768 × 432 px**. In Backend → Courts → Edit details → **Photo** an admin uploads or removes one: the page cuts a bigger or differently shaped picture to 16:9 from its centre and shrinks it to 768 × 432 (JPG) before sending it (`POST/DELETE /api/venues/:id/photo`, JPG/PNG/WebP up to 6 MB; the file lives on the persistent disk in `venue-photos/`, served from `/venue-photos/`, and is part of the Drive backup zip). The photos shipped with the app are in `public/img/courts/` and set once per venue by `VENUE_IMAGES` in `src/venueSeed.js`; removing such a photo in the admin never deletes the file. The photos come from the venues' own sites and directories — they are not licensed to the league, so ask the venue (or use their own picture) when in doubt.
- Check: `node scripts/check-venue-photos.js`.

### Court reservations (`/rezervacie-kurtov`, code address `/reservations`)

A grid of the next 7 days (always from today; the arrows move 7 days at a time, never into the past; a "Dnes" button next to them jumps back to today): the days across the top, the time down
the left in 30-minute rows, a column per court (or one court via the filter chips). A **green** block is a free spot the admin opened —
`Thursday 10:00–12:00` is **one** block that one player takes; it turns **orange** with the player's short name ("Tomáš P."), and is outlined
white for the player's own. Spots that have started are grey. The grid updates live for everybody (socket `reservations:changed`).

- **Home page, "Voľné kurty":** the third column of the ranking row (Rebríček | Hľadajú súpera | Voľné kurty, side by side; two columns when one of them has nothing to show) lists the free spots of the next 10 days (`GET /api/reservations/free-soon?days=10`: free = not taken, not started, grouped by day; `courts: 0` hides the block): a row per day with the first two spots and "+n", four days at most; a row opens the reservations page on that day (`/rezervacie-kurtov?from=YYYY-MM-DD`). It refreshes on the socket event `reservations:changed`.
- **Only BLTA players can reserve:** a player needs a category (Elite, Next Gen or Novice) assigned in Backend → Players. Without one the server refuses
  (403, code `NOT_BLTA`), the page says so under the calendar and when a spot is clicked, and `me.canReserve` is false. The admin can still put anybody into a spot.
- **E-mails:** when a player reserves a spot the admin (`NOTIFY_EMAIL`, reply goes to the player) gets "Nová rezervácia kurtu" and the player — if they have an
  e-mail on file — a confirmation (court, date, time, price, until when it can be cancelled, a link to Moje rezervácie). The texts are in
  `courtReservationTexts` in `src/mailer.js`. A cancellation sends "Zrušená rezervácia kurtu" to the admin and a confirmation to the player (`courtCancellationTexts`); when the admin cancels a player's
  reservation only the player hears ("zrušil administrátor BLTA"). Nothing is sent when the admin puts a player into a spot, and a failed e-mail never fails the action.
- **Admin** (Backend → Reservations, `/reservations-admin`): courts (add, rename, reorder, delete, and a **colour per court** for its free spots — column `reservation_courts.color`, `#rrggbb` or empty = the site's green; the text on it turns dark or white automatically); an **hour rate** per court in euro (`reservation_courts.hour_rate`, 0 = no price): a free spot shows rate × length under its time (18 €/h → 1.5 h = 27 €; not on 30-minute spots, too small) and in the reserve dialog — it is information only, nothing is charged; a court can also have other prices for **weekday morning / weekday afternoon / weekend** (columns `rate_wd_am`, `rate_wd_pm`, `rate_we`, empty = the hour rate; the weekend has one price all day) — the afternoon starts at a time set under Rules (`afternoonFrom`, default 16:00), weekend = Saturday and Sunday (public holidays are not special), and a spot is priced half hour by half hour, so one that crosses the change is priced half and half; **add times** once or every week on chosen
  weekdays, one block or split into 30 / 60 / 90 / 120-minute spots, on several courts at once (a time that overlaps an existing spot is skipped);
  **change many times at once** (pick courts, a period, weekdays and a start-time window, then shift them earlier or later in 30-minute
  steps, set or change their length (set to 30 min–4 h, or 30 min–2 h longer/shorter) and/or move them to another court — e.g. every Thursday evening one hour later; "Preview" shows the result first, reserved spots stay unless
  asked, and a spot that would overlap another, cross midnight or land in the past is left alone); a single spot is edited on the public page;
  **remove free times** of a period; **rules**: how many reservations a player may hold at once (default 2, 0 = no limit) and how late a player
  may cancel (default 2 h before the start). On the public page the admin clicks any spot to put a player or a guest in it, cancel a reservation
  or delete the spot (full names are shown to the admin only).
- **Players** (logged in): click a green spot → confirm → reserved. One click wins when two players are quick (a single UPDATE decides); no
  second reservation at the same time on any court; "My reservations" lists theirs with a cancel button until the cancel limit.
- Times are local Slovak text (`Europe/Bratislava`, no time-zone arithmetic); `RESERVATIONS_NOW="YYYY-MM-DD HH:MM"` fixes the clock for checks.
- Files: `src/routes/reservations.js` (API `/api/reservations`, tables `reservation_courts` and `court_slots`), `public/reservations.html` +
  `public/js/reservations.js`, `public/reservations-admin.html` + `public/js/reservations-admin.js`, `.rv-*` styles at the end of `style.css`.
  The page is in Backend → SEO (Slovak address `rezervacie-kurtov`, English `court-booking`) and in the menu picker of Backend → Menu.
- Check: `node scripts/check-reservations.js`.

### Points log (`/changelog-admin`)

**Backend → Points log** shows, newest first, what each match changed after it was finished, corrected (restarted and finished again),
restarted or deleted: the **ranking points** (per player and table: before → after, +/−) and the **league group table** (points, matches
played and position of the players in the group, also the others whose position moved). A manual correction of the ranking points is
logged too. A row is written only when something really changed — a live score, a friendly or a match without a group writes nothing —
and it keeps its own text, so it stays readable after the match or the players are gone. Search for a player, filter by kind, "Show older".

- `src/changeLog.js` (table `change_log`) is called from `routes/matches.js` (after every write and on delete) and `routes/rankings.js`;
  `rankingPoints.reconcile` returns the net change per player and table. Matches of a season with saved official tables (`frozenStandings`) get no group part.
- Check: `node scripts/check-changelog.js`.

### Tournaments (seasons of the type TOURNAMENT)

A tournament is a **season with `kind = 'TOURNAMENT'`** (column on `seasons`), so it has everything a season has — its page
(`/season/<slug>`: info tiles, description, registration, brackets, matches, gallery) and its winners (Backend → Winners, pick it
in "Add winners for…") — and is edited in **Backend → Tournaments** (`/tournaments-admin`, the same editor as Seasons with a venue and the categories it is played in;
groups are optional). The schedule (`/api/schedule`, `/harmonogram`) lists it with the "Turnaj" tag and the "Viac info" link to its page.
League-only places (home overview, season timeline, tables page) leave tournaments out (tables show one only if it has groups).

- `src/tournamentsSeed.js` moved the old schedule events into seasons once (flag `tournaments_as_seasons`) and linked a winners
  edition with the same title. `schedule_events` / Backend → Schedule stay for plain events that need no page.
- Check: `node scripts/check-tournaments.js`.

### Registration to a series / tournament = registration to the app

`POST /api/seasons/:id/registrations` (`openAccount()` in `src/routes/seasons.js`) also makes the visitor an app player: a name nobody has
becomes a `players` row (phone `0…`/`+…`, e-mail, slug from the surname, **no category** — the admin assigns it, until then no court
reservations), the visitor is logged in and the page's thank-you says an account was made and then opens the "create your 5-digit code"
step (`pinSetupRequired` in the answer). Invite links (`blta_ref`) are credited as with the normal registration.
A roster player **without** a phone is claimed (phone + e-mail filled in). An existing player **with** a phone is never touched or
logged in (anybody can type a name). A phone that already belongs to another player: the entry is saved, no account is made, and the
e-mail to the admin says so. `account` in the answer: `created | claimed | exists | phoneTaken | none`.
- Check: `node scripts/check-season-account.js`.

### Addresses and SEO in two languages (`/seo-admin`)

**Backend → SEO** edits, per public page and **per language** (Slovenčina / English tab): the address (slug), the title,
description, keywords and the link-preview texts and picture. Hiding a page from search engines (noindex) is one switch for both
languages. The Slovak page lives at `/<slug>` (`/rebricek`), the English one at `/en/<slug>` (`/en/rankings`); the home page is `/`
and `/en`. The first English texts and slugs are built in (`ENGLISH` in `src/seo.js`) and go in once per page.

- **The code keeps one name per page** — its *code address* (`/rankings`, `/player/<slug>`): menu items in Backend → Menu, links in
  the page scripts and in stored texts are all written with it. `public/js/localize.js` turns a code address into the address of the
  language in use: the server uses it for routing, canonical / `hreflang` links and the sitemap; the browser gets it from
  `GET /js/localize.js` (with the routes of the site added) and rewrites every link of the page (also those added later), the active
  menu item, the bottom menu and the language switch (it jumps to the same page in the other language). A new link in the code
  just uses the code address, or `siteUrl('/rankings')` where it is set from a script.
- **Language comes from the address** on these pages (`/en/…` is English, anything else Slovak); on the pages without an address per
  language (a match, the backend) the last choice is used.
- **Changing a slug retires the old address at once: 404, no redirect, no alias** (the backend asks first). The code address of a
  page (`/rankings`, `/rankings.html`) is retired the same way, and no other page may take it as its slug. The words the app itself
  uses (`api`, `css`, `admin`, `en`, `match`…) are refused as slugs.
- **A court can keep the address it had on the old website** (`/kurty-tennis-one`, `/en/tennis-one-courts`…): Backend → SEO → *Court addresses* sets a
  whole address (one segment) per language for a court; empty = the pattern `/tenisove-kurty/<court>`. The code address stays `/courts/<slug>`,
  the page is served at its own address (canonical, `hreflang` and the sitemap use it) and the pattern address of that court is retired (404,
  no redirect, like every retired address). The addresses of the old website's ten courts (`OLD_COURT_ADDRESSES` in `src/seo.js`) go in once, on the first start, for the courts
  that exist; the *Old website address* button fills them in for a court added later. Table `seo_custom_paths`; the matching code is in
  `localize.js` (`overrides`).
- A page file added to `public/` shows up here by itself (see `discoverPages` in `src/seo.js`) with the same slug in both languages.
- Tables: `seo_pages` (Slovak texts, `slug`, `slug_en`, `noindex`) and `seo_pages_en` (English texts). An old database is upgraded on
  the first start.
- Check it: `node scripts/check-seo.js` (starts its own server on a temporary data folder; nothing else is touched).

### Tournament registration, payment window and sorting into categories (Backend → Tournaments, `/tournaments-admin`)

A tournament is a season of type TOURNAMENT. Players register on its page as before, **without choosing a category** (`season_registrations.category` stays empty).
- **Window after registering:** "Ďakujeme…", then the Stripe button "Úhrada štartovného online" (the link is typed in the tournament's **Payment link (Stripe)** field; no link = no button) and a **bank transfer** block: the IBAN and recipient from Backend → Contact (with a Copy button), the entry fee of the tournament and the reminder "Do poznámky platby uveď názov turnaja: <name>". Only tournaments get the transfer block; no IBAN in the contact = no block.
- **Sorting players into categories:** in a tournament's card, **Zaradenie do kategórií** (`public/js/season-assign.js`) lists the registered players not sorted yet and the three categories with each player's BLTA rank, CourtIQ and the category written in their profile; E / N / V moves a player, × puts one back to "not sorted". **Navrhnúť automaticky** fills in the players not sorted yet (the profile's category, else by strength — the CourtIQ and BLTA-rank places averaged: strongest third Elite, middle third Next Gen, the rest Novice, nobody known = Novice); nothing is saved until **Uložiť zaradenie** (`POST /api/seasons/:id/registrations/categories`, all or nothing). The per-player Edit in Registrations still works.
- Check: `node scripts/check-tournament-categories.js`.

### Tournament draw: courts, seeds, main bracket and consolation bracket (Backend → Tournaments → **Pavúk turnaja**)

`public/js/season-draw.js` (panel), `src/tournamentDraw.js` (seeds, draw, deleting a draw), `src/bracketEngine.js` (`buildConsolation`, `dropLoser`), routes in `src/routes/seasons.js` and `src/routes/brackets.js`.
- **Courts:** `seasons.court_count` ("Kurt 1" … "Kurt n"), set in the panel (`PATCH /api/seasons/:id` with `courtCount`, 0–50). The schedule (part C) will use it.
- **Seeds:** `season_registrations.seed` per category, 1 = best, each number once, gaps are closed; `POST /api/seasons/:id/seeds` `{ category, seeds: [{ id, seed }] }`. Moving a player to another category drops the seed. The panel shows how many places stay empty (byes): a draw is the next power of two, the byes go to the highest seeds (standard seeding), so **seeded players skip round 1 only where the draw cannot be filled**; with fewer seeds than byes, the rest of the byes go to players drawn by lot (the panel warns).
- **Main bracket:** `POST /api/seasons/:id/draw` `{ category, mode: 'AUTO' | 'MANUAL', mainFormat, consolationFormat }`. AUTO places seeded players by the standard seed order and draws the others by lot; MANUAL makes an empty bracket the organiser seats in *Upraviť pavúk* (`/bracket-admin`). Brackets are `kind = 'MAIN'`, tied to the season and category, so their matches are play-off matches of that category as before. `GET /api/seasons/:id/draw` gives the per-category overview, `DELETE /api/seasons/:id/draw/:category` removes a draw while all its matches are still planned.
- **Consolation bracket ("útecha"):** `brackets.kind = 'CONSOLATION'`, `parent_bracket_id` = the main bracket. Whoever **loses a round-1 match** of the main bracket drops into it (`bracket_matches.consolation_seed` on the round-1 node = the seed its loser takes; the consolation bracket has one entrant per real round-1 match and byes only where it cannot be filled); who loses in round 2 or later is out; who had a bye has nothing to drop from. It is made together with an AUTO main bracket, or by `POST /api/brackets/:id/consolation` `{ format }` once every round-1 match of a MANUAL bracket is seated (losers already decided are dropped in at once). With fewer than two round-1 matches (e.g. 3 or 5 players) there is no consolation bracket.
- **Formats:** the main and the consolation bracket each have their own match format (`brackets.format`). The new `BO3_G4_STB` (consolation default): two winning sets, each set to **4 games** (a tie-break at 3-3, so a set ends 4-0, 4-1, 4-2 or 4-3), the deciding set a 10-point match tie-break. The rules are stamped on every set (`gameTarget`, `tiebreakAt`) so the scoring functions that only get a set know them; live scoring, manual results and the result form (`FORMAT_META` in `public/js/match.js`) all handle it.
- Checks: `node scripts/check-tournament-draw.js`, `node scripts/check-match-format-g4.js`.

### Trying a tournament out without touching the live site

`node scripts/demo-tournament.js` starts a local copy of the app (http://localhost:3055, admin password `test`) on a temporary data directory with a "Demo Open" tournament: 4 courts, 12 Elite (4 seeded), 8 Next Gen and 5 Novice players, the Elite and Next Gen draws made and the matches placed on the courts (Novice is left without a draw to try making one). Nothing is connected to score.blta.sk; Ctrl+C stops it and throws the data away.

### Tournament timetable ("Harmonogram" tab of the tournament page, court schedule)

`src/tournamentSchedule.js` (planner, placing by hand, settings), `public/js/court-schedule.js` (the tab), routes in `src/routes/seasons.js`.
- **Tab:** `/season/<slug>#courts`, the "Harmonogram" tab (a tournament page has the tabs Základné info, Harmonogram, Pavúky, Galéria — no Výsledky; finished scores are in the timetable), shown for a tournament that has courts (`court_count` > 0). **Live scores:** a strip "Naživo" at the top lists the matches being played with the score so far, and the live score is also in the timeline block and the list row; the tab reloads only its own data when a match changes (socket `matches:changed`). Everybody sees a **timeline** (a column per court, the playing day top to bottom, a block per match coloured by category) and a **list** (a section per court), with a pill per day of the tournament; the day shown first is today when it has matches, else the first day that has any. Matches without a time wait in **Nerozvrhnuté**.
- **Admin (logged-in admin only, on the same tab):** drag a planned match onto a court at a time (snaps to 15 minutes; `PUT /api/seasons/:id/schedule/matches/:token` `{ courtNo, scheduledAt }`); it is then **locked** (lock icon) and the planner never moves it. Click the lock icon to **unlock** it (`PUT .../schedule/matches/:token` `{ locked: false }` — it stays where it is but the planner may move it on "rebuild"), or **Odomknúť všetky zápasy** (`POST .../schedule/auto` `{ mode: 'unlock' }`). Drag it back to Nerozvrhnuté to take it off (`courtNo: null`). A taken court is refused (409); a player who is already on court or has less than the rest around that time is a warning, not a refusal. Below the timeline: match length, playing day (Bratislava time), rest between two matches of a player, "Rozvrh skladá systém sám", and the buttons **Poskladať rozvrh** (place the matches without a time), **Prepočítať odznova** (take off everything the planner placed, locked ones stay, then place again) and **Vyčistiť rozvrh** (everything planned off, locked too). Settings: `PATCH /api/seasons/:id/schedule/settings` (`seasons.match_minutes`, `day_start`, `day_end`, `rest_minutes`, `auto_schedule`); the number of courts is in Backend → Tournaments → Pavúk turnaja.
- **Planner (`autoPlan`):** every planned match with two players and no time is placed — earlier rounds first, and within a round the pair whose players have rested longest first — at the earliest 15-minute slot where a court is free **and** both players are free with their rest around it, and a player who already has the **maximum matches per day** (`seasons.max_matches_per_day`, 0 = no limit; set in the tournament form "Max. matches per player per day" or in the timetable settings) gets no further match that day — it goes to the next day (matches already played or scheduled count; a hand placement over the limit is allowed with a warning) (real finished times count, so a late match pushes its players' next match later). A match is stored as `matches.scheduled_at` + `matches.court_no` (+ `location` "Kurt n", `slot_locked`). With "automatic" on and courts set it runs by itself whenever a draw is made, a consolation draw is made or a bracket match is finished (`bracketEngine.planCourts`); the match length is the same for every match (also the shorter consolation format).
- **Early finish and match length:** a finished match is drawn from its **real start to its real end** (a short block shows one line); the court and the players are free from the real end, so the planner's "compact" pass (`mode: 'compact'`, run by itself after every finished match when "automatic" is on, and by the button **Zhustiť rozvrh**) moves the unlocked planned matches forward into the freed time (and later where a running match overran its court). The organiser can change the length of one match: drag the bottom edge of its block (steps of 5 minutes, 15–300; `PUT .../schedule/matches/:token` `{ durationMinutes }`, double-click the edge or `null` = the tournament's length again; `matches.duration_minutes`). A match whose real end is not known (a result entered by hand) occupies its court for its length — shorten it to free the court. Locked matches are never moved by compaction.
- Check: `node scripts/check-tournament-schedule.js`.

### Head-to-head, "Rivali" and "Zápas týždňa"

- **Match page:** a compact "Vzájomné" card above the chat when the two players have met before: the record from player 1's side ("3 — 2"), the number of meetings, the last result, the last five meetings as V/P dots (tooltips give the score and date) and a green/red bar. Only finished matches with a winner count (no walkovers or unfinished ones), in every category. Built in the browser from `GET /api/matches?playerId=…&status=FINISHED` by `public/js/h2h.js` (also used by the profile).
- **Player profile:** a "Rivali" card above the head-to-head list with up to four tiles, each a different opponent: *Najväčší súper* (loses to most, at least 2 losses), *Obľúbený súper* (beats most, at least 2 wins), *Najtesnejšia rivalita* (at least 3 meetings, the most even record) and *Najviac odohraných* (at least 3 meetings). A tile nobody qualifies for is left out; the card is hidden when there are none.
- **Home page, "Zápas týždňa":** `GET /api/match-of-the-week` (`src/routes/matchOfTheWeek.js`) names the most interesting **league** match (Elite / Next Gen / Novice) that is live or planned within the next 7 days; it is shown as the first, highlighted row of "Najbližšie zápasy" with the head-to-head record. Score: live +50; category Elite +30 / Next Gen +20 / Novice +10; CourtIQ rating gap up to +30 (closer is more); having met before +10 and up to +20 more the more even the record. A tie goes to the earlier match. Friendlies are never chosen. Nothing is pinned by hand.
- Checks: `node scripts/check-match-of-the-week.js`.

### Home page extras: invite a friend, player of the month

- **Invite a friend** (last section of the home page, logged-in players): every player has a personal link `/pozvanka/<their slug>`
  (`src/routes/invites.js`). Opening it is counted once per browser (`invite_visits`), puts the inviter in the cookie `blta_ref` for 30 days
  and goes to the home page; when that visitor registers as a **new** player (`POST /api/player/register`, not the claim of an existing
  profile) `players.invited_by` is set. The card shows opened / registered / played (an invited player with a finished match) and sends the
  link by WhatsApp or e-mail. Backend → Players ends with *Kto koho pozval* (who invited whom, best recruiters). `pozvanka` is a reserved
  address word. Check: `node scripts/check-invites.js`.
- **Player of the month** (a slim card under the stats tiles, `GET /api/highlights/month`, `src/routes/highlights.js`): the player of the last
  *full* calendar month — most BLTA points won in that month (the points ledger joined to the month's finished BLTA matches), then wins; at
  least two matches and a win; hidden players never. It also shows the longest run of wins and the player with the biggest courtIQ progress
  (band at the end of the month against the band before it; somebody other than the player of the month). Nothing is entered by hand; with
  no match in that month the card is not shown. `HIGHLIGHTS_NOW=YYYY-MM-DD` fixes the date for the checks. Check:
  `node scripts/check-highlights.js`.

### Blog (`/blog`, Backend → Blog `/blog-admin`)

- **Articles** live in the table `articles` (`src/blog.js`): a Slovak and an English version of the title, the short text for the list, the text (HTML), the
  title tag / description / keywords for search engines, one featured picture, the date and a status (published / draft). An English text left
  empty falls back to the Slovak one (like on the old website).
- **Every article has a whole address of its own per language** (one segment: `/nove-tricka-pre-blta`, `/en/nove-tricka-pre-blta`) — the same mechanism as
  the courts' own addresses (`src/seo.js`, `overrides()`, `localize.js`). The code address is `/article/<slovak address>`; the pattern address
  (`/clanok/<x>`) and the code address are 404. A draft or deleted article is a real 404. The address is checked against the pages, the courts, the
  other articles and the words the app uses (`checkWholeAddress`).
- **The four articles of the old website** (Čo je BLTA a prečo vznikla?, Nové tričká pre BLTA, Tenisové turnaje pre amatérov, Rozhovor s Tomášom Podhorným)
  are put in once, at the first start (`src/blogSeed.json`, pictures in `public/img/blog/`), with the addresses, title tags, descriptions, link-preview
  texts and dates they had on old.blta.sk, in both languages — also the English ones as the old site served them (three of them have the Slovak
  title tag there; they can be edited in Backend → Blog). Links to the old season pages / the schedule inside the texts point to the new pages.
- **Rendered on the server**: the list and the article text are in the HTML a crawler gets (`<!--PAGE_CONTENT-->` in `public/blog.html` / `article.html`), with
  `og:type=article`, `article:published_time`, hreflang alternates and Article structured data. The sitemap lists the blog and the published articles.
  The blog list (`blog`) and the article template (`article`) are in Backend → SEO like every page.
- **The text is cleaned** on save (`src/htmlSanitize.js`, an allow-list: headings, paragraphs, lists, quotes, links, pictures, tables — no scripts, styles,
  frames, event handlers or `javascript:` addresses). Pictures an admin uploads are kept on the persistent disk (`blog-images/`, shown at `/blog-images/…`).
- The menu item is added in Backend → Menu (the picker offers *Blog*). Check: `node scripts/check-blog.js`.

### YouTube video of a match

- The admin can put a **YouTube link** on a match (the match page → the *Live video* tile next to Miesto / Dátum / Kategória → *Pridať* / *Upraviť*; admin only,
  `PATCH /api/matches/:token/video`, column `matches.video_url`). Any usual form is accepted (`watch?v=`, `youtu.be/`, `/live/`, `/embed/`, `/shorts/`; `src/youtube.js`) and
  kept as the watch address; an empty value takes the video away. Anything that is not a YouTube video address is refused.
- With a link the match page shows the video **embedded** (`youtube-nocookie.com`, 16:9) between the buttons and the info tiles — for everybody, also live for people
  who already have the page open — and every match card (lists, player pages, the compact lists) gets a red outline pill **Live video**. Without a link nothing is
  shown, and a visitor never sees the tile. Check: `node scripts/check-match-video.js`.

### Match photos

- **What it does:** the match page has a photo box. The two players of the match (or an admin) can add pictures; everybody, logged in or not,
  can look at them and open them bigger. Code: `src/drivePhotos.js` (Drive client), `src/routes/matchPhotos.js` (`GET` / `POST` / `DELETE /api/matches/:token/photos`).
- **Rules:** only the two players of the match or an admin add; only the person who added a photo or an admin removes it. At most **5 photos per
  match**, JPEG / PNG / WebP, up to 10 MB each (the type the browser declares and the file's first bytes both have to be one of these; the file name is not used). Photos can be added at any time,
  also after the match is finished. Deleting a match deletes its photos from Drive as well.
- **Where they live:** in a **Google Drive folder of their own**, not on the server disk and **not in the backup zip**. The database only stores the
  Drive file id (`match_photos.drive_file_id`). The app makes each file itself and makes it readable by anyone with the link, so the page
  shows it straight from Google with a plain `<img>`; removing a photo revokes the link and deletes the file. After a backup restore the list of
  photos comes back, and the pictures work as long as the files are still in the Drive folder.
- **Notification:** the *other* player gets a line in the bell ("X added a photo to your match", opens the match page). The person who added it
  is not notified; if an admin who is not one of the two players adds a photo, both players are. Bell only: no phone push, no e-mail. Removing a
  photo notifies nobody.
- **Switching it on:** set `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` (the id of a Drive folder for the photos; same Google account and credentials as the backup,
  see `.env.example`). Without it the feature is off and nothing else is affected; while it is off the whole photo box is hidden, including photos that were added earlier. Optional `PHOTO_IMAGE_URL_TEMPLATE` changes the form of the
  picture link (`{id}`, `{width}`) without a code change. The scope is still `drive.file` (files the app made itself), so no new authorization
  should be needed, but *if* Google refuses to make the files link-readable, the refresh token may have to be made again with
  `node scripts/get-drive-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>` (and the new one set on Render).
- **Checks:** `node scripts/check-match-photos-drive.js` (the Drive client) and `node scripts/check-match-photos.js` (the routes, rules, limit,
  notifications, clean-up). Both run against a fake Drive, no network.
- **First real test** (the checks use a fake Drive, so this is the first time the real one is asked):
  1. On Render add `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` and deploy.
  2. Log in as one of the two players of a match and add one photo.
  3. Open the same match **logged out** (a private window) and check the photo shows.
  4. Remove the photo and check it disappears from the Drive folder.
  5. If the picture does not show when logged out, set `PHOTO_IMAGE_URL_TEMPLATE=https://lh3.googleusercontent.com/d/{id}=w{width}` and try again,
     before thinking of a server-side image proxy.

---

## 7. Embedding on the blta.sk WordPress site

- **Full live-matches list**, always up to date:
  ```html
  <iframe src="https://score.blta.sk/embed/live" width="100%" height="600" frameborder="0"></iframe>
  ```
- **A single match** — the exact snippet (with the match's unguessable link) is generated for
  you: open any match on score.blta.sk and click **🧩 Embed**, then paste the code into a
  WordPress "Custom HTML" block.

Both embeds update live via WebSocket — no page refresh needed on the WordPress side either.

---

## 8. Notes on scope / things intentionally left out

- **Live scoring stays open to everyone**, by design — anyone with a match link can plan
  matches, start them, and score live, matching "everyone can add matches" from the brief. Only
  player management and editing a *finished* match require the admin login (§4). If live
  scoring itself becomes a problem later (e.g. random visitors messing with an in-progress match
  from the public embed), the natural next step is a shared PIN for scoring too; ask and it can
  be added.
- **Match links are unguessable** (a random token, not a sequential number) but the home page
  still lists every match publicly, by design — it's a public scoreboard. The token mainly stops
  someone who only received one specific share link from finding *other* matches by editing the
  URL; it doesn't hide that matches exist.
- **`-1` correcting a mistake** only adjusts the game/point currently in progress — it can't
  undo a set that has already been won and closed out. For that, use **↺ Undo last point**,
  which restores the exact previous state and works across set boundaries too (keeps the last
  30 actions per match).
