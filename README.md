# BLTA Score

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
    index.html, match.html, new-match.html, players.html, admin.html
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
   `SMTP_USER`, `SMTP_PASS` (see §5 below for getting the Gmail app password), `ADMIN_PASSWORD`
   (see §4 — pick your own admin password here), and `ANON_CODE` (a fallback code for anyone
   without a real BLTA account). You can also skip SMTP for now and add it later from the
   service's **Environment** tab — the app runs fine without it, it just won't be able to send
   the finished-match email yet. `ADMIN_PASSWORD` is worth setting right away, though, or that
   login won't work. Player login itself needs no setup here — each player logs in with their
   own phone number, set per-player on the Players page once you're logged in as admin.
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
- `PUBLIC_URL=https://score.blta.sk`
- SMTP settings so the "match finished" email can send (see §5 below for the Gmail setup)
- `ADMIN_PASSWORD` and `SESSION_SECRET` (see §4) so the admin login works
- `ANON_CODE` so the no-account fallback login works (player login itself needs no env var — each
  player logs in with their own phone number, set per-player on the Players page as admin)

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

## 4b. Player login (phone number)

Anyone can still browse matches, view a live score, and chat — no login needed for that. But
**creating a new match, starting a live match, entering a result manually, and setting a match's
date/location** all require being logged in as a **player** first, via the "LOG IN AS PLAYER" link
in the top nav.

Unlike the admin account, this isn't one shared password — each player logs in with their own
phone number (Slovak mobile format, e.g. `0903111222`), which doubles as their identity: a
logged-in player can only manage a match they play in (if an admin created it) or a match they
created themselves — not every match in the league, the way the old shared code used to allow.

There's no self-registration — an admin sets each player's number from their entry on the
**Players** page (logged in as admin, an "Edit phone" control appears there). A player with no
number on file yet simply can't log in until an admin adds one. Nothing to configure in the
environment for this — it's all in the database.

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
MAIL_FROM="BLTA Score <score@blta.sk>"
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
| Home page layout / tabs / filters | `public/index.html` + `public/js/app.js` |
| The "new match" form (fields, format options) | `public/new-match.html` + `public/js/new-match.js` |
| The live scoring screen | `public/match.html` + `public/js/match.js` |
| What the WordPress embeds look like | `public/embed-live.html`, `public/embed-match.html` + matching `.js` files |
| Match formats / tennis scoring rules | `src/matchEngine.js` — see the `FORMATS` object at the top |
| Categories (currently Elite / Next Gen / Novice / Friendly) | Add the new value to `CATEGORIES` in `src/routes/matches.js`, then add a matching `<option>` in `public/new-match.html` and `public/index.html`, and a badge color in `public/css/style.css` (search `badge-FRIENDLY` for the pattern) |
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

- **On Render:** open the service's **Shell** tab (in the dashboard) and download the file, or
  connect via `render disks` in the Render CLI. Render also snapshots persistent disks
  automatically, but for extra safety you can copy `/var/data/blta-score.db` out periodically.
- **On a VPS:** the file is at `/var/www/blta-score/data/blta-score.db`. A nightly cron job
  works well:
  ```bash
  0 3 * * * cp /var/www/blta-score/data/blta-score.db /var/backups/blta-score-$(date +\%F).db
  ```

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
