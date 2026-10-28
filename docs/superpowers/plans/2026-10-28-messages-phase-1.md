# Messages (Správy) - Phase 1 (private chats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in player can message other players of his city one-to-one from a Messages page; a first message to somebody he has no connection with arrives as a Request (accept / decline+block); messages arrive live; unread counts show in the inbox and on the "Správy / Messages" menu item.

**Architecture:** Three new tables (`conversations`, `conversation_members`, `direct_messages`) plus `message_blocks`, served by `src/routes/messages.js` (`/api/messages`) with the rules in `src/messages.js`. Live delivery: the server joins each Socket.IO socket to `player:<id>` from the signed `blta_player` cookie of the handshake and emits only to those rooms; the old public `join` event refuses `player:` rooms. One page file `public/messages.html` + `public/js/messages.js` (two panes on a computer, one at a time on a phone).

**Tech Stack:** Node >= 22.5 (`node:sqlite` via `src/db.js`), Express 4, Socket.IO 4 (server only; tests use the `ws` package that Socket.IO already installs), vanilla JS front end, no build step; tests are `scripts/check-*.js` files that start their own server.

**Spec:** `docs/superpowers/specs/2026-10-28-messages-design.md` (phase 1 of its "Phases" list; archive/mute, groups, push come in later plans).

## Global Constraints

- Feature name: **"Správy"** (EN "Messages"); menu item labels `Správy` / `Messages`, link `/messages`; Slovak page address `/spravy`, English `/messages`; the pages are `noindex`.
- A conversation is private to its members: for a non-member **every** route answers **404** (never 403), including its messages, read, accept and decline.
- Limits: a message is plain text **1-2000** characters (trimmed); before a request is accepted the sender may send at most **3** messages in it; a player may start at most **20** conversations per day that begin as requests; at most **30** messages per minute per player in all.
- Pages: inbox lists newest first; messages come **30** per page (`before` cursor); the player search needs **2+** characters, returns at most **20**, names only (no phone, no e-mail), same city only, never himself, never a blocked player (either way), only players with a phone on file.
- A player is **connected** to another (so a first message goes to Main, not to Requests) when they have a match together (any status, singles or doubles) or are active members of the same community or club; everyone else is a stranger and the recipient's membership starts as `REQUEST`.
- Declining a request deletes the conversation (for both) and blocks the sender; a blocked pair cannot message each other (403 "You can't message this player").
- A club admin is not a site admin; nothing here touches `adminSession`, `requireAdmin` or `canSeePrivateFields`. An admin without a player cookie is not a player (401 on every route).
- The existing match chat (`messages` table, `routes/matches.js`) is not changed.
- Look: the site's own classes and tokens (black cards, `--border-grey`, `--fill-grey`, orange send button, lime `--status-green` unread badge, radii `--radius`, `--radius-md`, `--radius-sm`); Ace's layout is the model.
- Every user-visible string goes through `t()` in `public/js/i18n.js`, in both the SK block and the EN block; every new page is listed in `src/seo.js` (with `noindex`).
- Do not commit or push; the owner says "deploy" when ready. Run the check script after each task and the whole `scripts/check-*.js` set before reporting the plan done. After any web page change, show the page in the built-in browser preview (owner's standing rule).

## Review Focus

1. A non-member (another player, a visitor, a blocked player) guessing conversation ids: 404 on read, write, mark-read, accept, decline and on the messages list - and no difference in the answer between "does not exist" and "not yours".
2. Listening in: a client that sends `join` for `player:<someone else>`, a socket with no cookie, a forged or unsigned cookie, a cookie of a deleted player - none may receive a private event.
3. Two players messaging each other for the first time at the same moment (A->B and B->A), and `POST /conversations` called twice: exactly one direct conversation (unique pair key), and the second caller joins it instead of creating another; messaging yourself is refused.
4. Block and decline cannot be bypassed: after B declines A, A cannot restart a conversation with B (`POST /conversations` and messages both 403), and B cannot be reached through an old conversation id.
5. Message text: `<script>`, `<img onerror>`, `javascript:` and `data:` links, a 2000-character boundary (counted in characters, not bytes, with emoji), whitespace-only and empty text, and a very long unbroken word on a 375 px screen.

---

### Task 1: Schema, strangers, blocks, start a conversation, player search

**Files:**
- Modify: `src/db.js` (append the tables before `module.exports = db;`, same style as `organisations`)
- Create: `src/messages.js` (rules and serializers), `src/routes/messages.js`
- Modify: `server.js` (`require` the router near the other routers; `app.use('/api/messages', messagesRouter);` next to `/api/communities`)
- Test: `scripts/check-messages.js` (new; copy the server-spawn / `call` / `cookieOf` skeleton and `makePlayer(name)` helper from `scripts/check-communities.js` - admin creates the player, sets a phone, the player logs in with the phone code; the helper returns `{ id, name, cookie }`; add `makeMatch(a, b)` that creates a finished or planned match between two players through `POST /api/matches` as admin)

**Interfaces:**
- Consumes: `auth.getPlayerId(req)`, `db`, `leagues`/`players.league_id`, `organisation_members`.
- Produces (tables): `conversations(id, type 'DIRECT'|'GROUP' DEFAULT 'DIRECT', title, direct_key TEXT UNIQUE, created_by_player_id, started_as_request INTEGER DEFAULT 0, created_at, last_message_at)`; `conversation_members(conversation_id REFERENCES conversations ON DELETE CASCADE, player_id, state 'MAIN'|'REQUEST'|'ARCHIVED' DEFAULT 'MAIN', muted INTEGER DEFAULT 0, last_read_message_id INTEGER DEFAULT 0, joined_at, PRIMARY KEY (conversation_id, player_id))` + index on `player_id`; `direct_messages(id, conversation_id, sender_player_id, body, created_at)` + index `(conversation_id, id)`; `message_blocks(blocker_player_id, blocked_player_id, created_at, PRIMARY KEY (blocker_player_id, blocked_player_id))`.
- Produces (`src/messages.js`): `directKey(a: number, b: number): string` (`"<min>:<max>"`); `areConnected(a: number, b: number): boolean` (shared match incl. `player1b_id`/`player2b_id`, or both ACTIVE members of one organisation); `isBlocked(a, b): boolean` (either direction); `memberOf(conversationId, playerId): row | undefined`; `otherPlayer(conversationId, playerId): { playerId, name, slug, photoUrl } | null`.
- Produces (HTTP): `POST /api/messages/conversations` body `{ playerId }` -> `{ id }` (200 when it already existed, 201 when new; 400 himself, 404 unknown player or another city, 403 blocked; creates the recipient membership as `REQUEST` and sets `started_as_request = 1` when `!areConnected`, else `MAIN`; the creator's membership is `MAIN`; 429 when he already started 20 request conversations in the last 24 h); `GET /api/messages/conversations/:id` -> `{ id, other, state, canWrite, requestAllowanceLeft }` (404 for a non-member); `GET /api/messages/players?q=` -> `{ items: [{ playerId, name, slug, photoUrl }] }`.

- [ ] **Step 1: Write failing tests** in `scripts/check-messages.js`: `a visitor gets 401 on every messages route`; `a player starts a conversation: 201, the other side is a REQUEST for a stranger and MAIN after a shared match`; `a shared community makes two players connected`; `starting twice (also from the other side) returns the same id with 200: one conversation only`; `messaging himself is 400, an unknown player 404, a player of another city 404`; `a non-member gets 404 on GET /conversations/:id, also for an id that does not exist`; `search needs 2+ characters, finds by part of the name, excludes himself, players without a phone and blocked players, answers names only (no phone/email keys)`; `the 21st request conversation in a day is 429 (back-date created_at in the temp database with node:sqlite DatabaseSync to avoid the limit in other tests)`.
- [ ] **Step 2: Run** `node scripts/check-messages.js` - Expected: FAIL (404 on `/api/messages`).
- [ ] **Step 3: Implement** the tables, `src/messages.js`, the three routes and the mount; find-or-create inside one `BEGIN`/`COMMIT` using `direct_key` UNIQUE (on a UNIQUE violation re-read and return the existing id).
- [ ] **Step 4: Run** `node scripts/check-messages.js` - Expected: all PASS.

### Task 2: Messages, read marks, requests, inbox, unread, deleted players

**Files:** Modify `src/routes/messages.js`, `src/messages.js`, `src/routes/players.js` (player DELETE); Test `scripts/check-messages.js`.

**Interfaces:**
- Consumes: Task 1's tables and helpers.
- Produces (`src/messages.js`): `rateLimitOk(playerId: number): boolean` (in-memory sliding window, 30 per 60 s; a module-level `Map`); `serializeMessage(row, viewerId): { id, body, createdAt, mine }`.
- Produces (HTTP): `POST /conversations/:id/messages` body `{ body }` -> 201 `{ id, body, createdAt, mine: true }` (trims; 400 empty or over 2000 characters; 404 non-member; 403 blocked; 409 `{ error }` when the sender is in a conversation whose other member is still a `REQUEST` and he already sent 3 messages; 429 over 30 per minute; sets the recipient's unread by leaving his `last_read_message_id` behind; updates `last_message_at`; a reply by the recipient of a `REQUEST` sets his state to `MAIN` (answering accepts)); `GET /conversations/:id/messages?before=<id>` -> `{ items, more }` (30 per page, oldest first inside the page; marks nothing read); `POST /conversations/:id/read` -> `{ ok: true }` (sets `last_read_message_id` to the newest message); `POST /conversations/:id/accept` (only the recipient of a `REQUEST`; else 404) -> `{ ok: true }`; `POST /conversations/:id/decline` (same guard) -> deletes messages, members and the conversation and inserts the block (blocker = decliner); `GET /conversations?box=main|requests` -> `{ items: [{ id, other, state, lastMessage: { body, createdAt, mine } | null, unread: number }] }` newest first (`box` absent = main; the sender never sees his own unanswered request in Requests, it is in his Main); `GET /unread` -> `{ main: number, requests: number }` (`main` counts MAIN conversations with at least one unread message from the other side, `requests` counts REQUEST conversations of the caller).
- Player DELETE: remove his `conversation_members` and `message_blocks` rows, then delete every direct conversation left with fewer than two members (with its messages).

- [ ] **Step 1: Write failing tests**: `send and read a message, mine flag and trimming`; `empty, whitespace-only and 2001-character texts are 400; exactly 2000 characters (including emoji counted as characters) is 201`; `a stranger's 4th message before acceptance is 409, after the recipient answers (state MAIN) the sender may write again`; `accept moves a request to Main, decline deletes the conversation and blocks: the decliner and the sender both get 403 on POST /conversations and 404 on the old id`; `only the recipient may accept or decline (the sender and a stranger get 404)`; `unread: counts per box, drops to 0 after /read, the sender's own message is never unread for him`; `inbox: newest first, lastMessage and unread per item, Requests shows only conversations waiting for the caller`; `before-paging: 30 per page with more:true and the right cursor`; `the 31st message within a minute is 429 (use the real limit)`; `a non-member gets 404 on messages, read, accept, decline`; `deleting a player removes him from his conversations and deletes the direct ones that lose a member`.
- [ ] **Step 2: Run** `node scripts/check-messages.js` - Expected: new tests FAIL (404).
- [ ] **Step 3: Implement** the routes. Every handler loads the caller's membership first and answers 404 when it is missing; text is stored as written (the pages escape it); `unread` is computed from `last_read_message_id` and `sender_player_id != caller`.
- [ ] **Step 4: Run** the same command - Expected: all PASS.

### Task 3: Live delivery

**Files:** Modify `server.js` (the `io.on('connection')` block and `join` handler), `src/messages.js` (`playerIdFromSocket`), `src/routes/messages.js` (emit after send / accept / decline / read); Test `scripts/check-messages.js`.

**Interfaces:**
- Produces (`src/messages.js`): `playerIdFromSocket(socket): number | null` (reads `socket.request.headers.cookie`, takes `blta_player`, URL-decodes it, verifies it with `require('cookie-parser').signedCookie(value, process.env.SESSION_SECRET || 'dev-only-insecure-secret')`, returns the id only when it is a positive integer and that player exists); `emitToPlayers(io, playerIds: number[], event: string, payload: object): void` (emits to each `player:<id>` room).
- Events (emitted only to the `player:<id>` rooms of the conversation's members): `dm:message { conversationId, message: { id, body, createdAt, senderPlayerId }, other: { playerId, name, slug, photoUrl } }` (the payload carries `senderPlayerId`, the page decides `mine`), `dm:unread { main, requests }` (to the recipient after a new message, accept or decline; to the caller after `read`), `dm:removed { conversationId }` (to both when a request is declined).
- `server.js`: on `connection`, `const id = playerIdFromSocket(socket); if (id) socket.join(\`player:${id}\`)`; the existing `join` handler refuses any room starting with `player:` (and `dm:`).

- [ ] **Step 1: Write failing tests** with the `ws` package (`require('ws')`, engine.io v4 text protocol: connect to `ws://localhost:<port>/socket.io/?EIO=4&transport=websocket` with the header `Cookie: <the player's cookie>`; the server sends `0{...}`; send `40`; wait for a packet starting with `40`; events arrive as `42["name",{...}]`; the test sends `42["join","player:<id>"]` as an attacker): `the recipient and the sender's own socket receive dm:message and the recipient dm:unread`; `a third player's socket, a socket with no cookie, a socket with an unsigned cookie value and a socket that sends join for player:<recipient id> receive nothing within 700 ms`; `accept and decline send dm:unread / dm:removed to the right people only`; `the old join still works for a match room`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the handshake join, the guard and the emits (`req.app.get('io')`).
- [ ] **Step 4: Run** - Expected: all PASS.

### Task 4: The Messages page (inbox, chat, new message, request banner)

**Files:**
- Create: `public/messages.html` (skeleton copied from `public/communities.html`, `<title data-i18n="page.messagesTitle">`, root `#msg-root`), `public/js/messages.js`
- Modify: `public/css/style.css` (append a `/* messages */` block: `.msg-layout`, `.msg-list`, `.msg-row`, `.msg-badge`, `.msg-chat`, `.msg-bubble`, `.msg-bubble.mine`, `.msg-day`, `.msg-compose`, `.msg-request`), `public/js/i18n.js` (SK + EN keys with prefix `msg.` and `page.messagesTitle`), `src/seo.js` (`PAGES` entries: `{ key: 'messages', label: 'Messages', path: '/messages', file: 'messages.html', slugSk: 'spravy', noindex: true, ... }` and a template entry `{ key: 'conversation', path: '/messages/:id', file: 'messages.html', template: true, slugSk: 'spravy', noindex: true }` (follow `reservations` and `community`), `ENGLISH` entries), `server.js` (`TEMPLATE_ENTITY.conversation = () => ({ name: 'Messages' })`)
- Test: `scripts/check-messages-pages.js` (new, static file checks and a spawned-server check in the style of `scripts/check-communities-pages.js`)

**Interfaces:**
- Consumes: the Task 1-3 endpoints and events, `loadSession()`, `api()`, `escapeHtml()`, `t()`, `requirePlayerAuth()`, `currentPlayerId`, the Socket.IO client the other pages already load (`/socket.io/socket.io.min.js`).
- Produces: on a computer two panes (inbox with tabs "Hlavné / Main" and "Žiadosti / Requests" with a count, a "+" button; the chat to the right with a header, the messages in bubbles - mine on the right, orange-tinted - date separators, a message box with a send button, Enter sends, Shift+Enter a new line); on a phone (<= 760 px) the inbox first and a chat as a full screen with a back arrow, the URL `/messages/<id>` opens a chat directly; "+" opens `/messages/new` (search box, tap a result -> `POST /conversations` -> the chat); a request chat shows the banner "<name> wants to message you" with Accept / Decline and no message box until accepted; the sender of an unanswered request sees a note and a disabled box after 3 messages; links in messages become `<a>` only for `http://` and `https://` after escaping; the open chat marks itself read when shown and on every live message; live events update the inbox, the chat, the tab count; a visitor sees a login prompt (`requirePlayerAuth`).

- [ ] **Step 1: Write failing tests**: `messages.html exists with its scripts (common.js, i18n.js, socket.io, messages.js) and the login popup`; `every msg.* key used by messages.js exists in both the SK and EN blocks of i18n.js`; `messages.js escapes every field written by a player (no raw ${m.body} / ${o.name} in a template) and only turns http/https text into links`; `/spravy and /en/messages answer 200 and are noindex (X-Robots-Tag or the meta robots tag, as the other noindex pages do); /messages/123 answers 200 with the same page`.
- [ ] **Step 2: Run** `node scripts/check-messages-pages.js` - Expected: FAIL.
- [ ] **Step 3: Implement** the page; verify in the built-in browser with a throwaway server (`DATA_DIR` a temp folder, `ADMIN_PASSWORD=test`, port 3559) and three seeded players: inbox, a chat, a request with the banner, the phone width (375 px) and the long-word case.
- [ ] **Step 4: Run** `node scripts/check-messages-pages.js` - Expected: all PASS.

### Task 5: Menu item with unread badge, and the final checks

**Files:** Modify `src/seasonSeed.js` (`ensureMessagesMenuItem(db)`, exported, same shape as `ensureCommunitiesMenuItem`: flag `menu_messages_added`, labels `Správy` / `Messages`, link `/messages`, placed after `/communities` else after `/harmonogram` else at the end), `server.js` (call it in the same try/catch style), `public/js/common.js` (after the session is known, for a logged-in player ask `GET /messages/unread` once and put `main + requests` as a small lime badge on the nav item whose link is `/messages`, keep it current from `dm:unread` events on the socket every page already opens, otherwise remove the badge), `public/css/style.css` (`.nav-msg-badge`); Test `scripts/check-messages-pages.js`.

**Interfaces:**
- Consumes: `GET /api/messages/unread`, the `dm:unread` event, `playerAuthed`, `currentPlayerId`, the nav items built by `renderHeaderNav()` (find the item by its `href`).
- Produces: the badge element `<span class="nav-msg-badge">N</span>` appended to that nav item; hidden when the count is 0; the call is skipped for a visitor.

- [ ] **Step 1: Write failing tests**: `a fresh database has the menu item with both labels once, running the helper again keeps one, a deleted item does not come back` (run the helper with `node -e` against the temp database as `check-communities-pages.js` does); `common.js asks for /messages/unread only after a player session and handles dm:unread`; `the sitemap does not list /spravy (noindex)`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the call and the badge; then run the whole suite: `for f in scripts/check-*.js; do node $f || echo "FAILED $f"; done` (a script that fails under load must be re-run alone before it counts as failed).
- [ ] **Step 4: Run** the suite - Expected: no `FAILED` line (re-runs excepted); then show `/messages` in the built-in browser with a live message arriving between two logged-in browsers if possible, and report what could not be verified (real Render deploy, push).

## Self-review notes

- Spec coverage (phase 1): tables incl. unique direct key, strangers rule, requests with accept/decline/block, limits (3 / 20 per day / 30 per minute, 2000 characters), search, live delivery on private rooms with the old `join` guarded, inbox + unread + menu badge, pages (two panes / phone), noindex SEO, deleted players. Not here (later plans): archive and mute, groups, push and the bell, editing or deleting messages, images.
- Names used across tasks: `directKey`, `areConnected`, `isBlocked`, `memberOf`, `otherPlayer`, `rateLimitOk`, `serializeMessage`, `playerIdFromSocket`, `emitToPlayers`, events `dm:message` / `dm:unread` / `dm:removed`.
