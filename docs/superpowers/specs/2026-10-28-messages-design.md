# Správy / Messages - design

Status: waiting for approval. Nothing is built yet.

## Intent and why

Players of the league can arrange matches, but only through the chat of a match or through phone numbers. Ace (aceplay.app/messages) has a clean inbox for talking to other players. This feature gives BLTA / SLTA players the same: a **Messages** page where a logged-in player talks one-to-one with other players, with a protected way for strangers to get in touch (the **Requests** tab).

Looked at on aceplay.app (read-only, nothing sent): a two-pane page (inbox on the left with tabs Main / Requests / Archived and a "+", the chat on the right), message bubbles with date separators and clickable links, a message box with a send button, a ⋮ menu with "Mute notifications" and "Archive chat", unread counts in the inbox and a red dot on the menu item, "New message" (search a player by name) and "New group" (add up to 20 people, then Next). On a phone the inbox and the chat are separate screens.

## Goals

- A logged-in player can message any other player of his city from the Messages page; the conversation is private to its members.
- A first message to somebody you have no connection with arrives as a **Request** on his side; accepting it moves it to Main, declining deletes it and blocks the sender.
- Messages arrive live (no reload), unread counts are shown in the inbox and on the "Messages" menu item.
- Looks like the rest of the site (black cards, grey borders and fills, orange send button, lime unread badge), two panes on a computer and one pane at a time on a phone.

## Non-goals (phase 1)

- Archive, mute, groups, club chats, images/files, reactions, typing indicators, read receipts shown to the other side, e-mail or push notifications, message search, editing or deleting a sent message.
- A conversation with an admin who has no player identity (a message needs a real player on both sides).

## Anti-goals

- Nobody can read, join, listen to or write in a conversation he is not a member of - including through the live connection. A bug here is worse than the feature missing.
- A stranger cannot flood somebody: before a request is accepted the sender has a small allowance of messages.
- Nothing about a player is exposed that is not already public (the search shows names only: no phone, no e-mail).

## Constraints from the code

- Identity is the signed cookie `blta_player` (`auth.getPlayerId`); an admin without a player cookie is not a player. A club admin is not a site admin; nothing here changes `auth.isAdmin`.
- The live connection (`server.js`, Socket.IO) today lets **any** client `join` **any** room by name (fine for public match scores, fatal for private chats). Private messages therefore must not use client-chosen rooms: the server puts each socket into `player:<id>` from the signed cookie in the handshake, and only emits to those rooms.
- The match chat (`messages` table, `routes/matches.js`) is tied to a match and stores an author name as text; it stays as it is.
- Multi-city: a player belongs to a league (`players.league_id`); the search is limited to the viewer's city.
- Every new public page is listed in `src/seo.js` (here with `noindex`), texts go through `t()` in `public/js/i18n.js` (SK and EN), the main menu item is added by an `ensure*MenuItem` helper like the others.
- Tests are `scripts/check-*.js` files that start their own server.

## Approaches considered

- **A. Real conversations with per-player live rooms (chosen by the user).** New tables for conversations, members and messages; the server joins sockets to `player:<id>` rooms from the signed cookie and emits only there.
- B. Reuse the match-chat table. Rejected: tied to a match, author is free text; generalising it risks the working match chat.
- C. Polling instead of live updates. Rejected: slow chats and constant requests.

## Design (approach A)

### Data

- `conversations(id, type 'DIRECT'|'GROUP', title, created_by_player_id, created_at, last_message_at)`. Phase 1 uses `DIRECT` only (the column is there for groups).
- `conversation_members(conversation_id, player_id, state 'MAIN'|'REQUEST'|'ARCHIVED', muted, last_read_message_id, joined_at)`, PK (conversation_id, player_id). The recipient's state is `REQUEST` when the sender is a stranger, else `MAIN`; the sender's is always `MAIN`.
- `direct_messages(id, conversation_id, sender_player_id, body, created_at)`, index (conversation_id, id).
- `message_blocks(blocker_player_id, blocked_player_id, created_at)`, PK both.
- A direct conversation between two players is unique: `POST` finds the existing one instead of making a second.

### Who is a stranger

A player B is **not** a stranger to A when any of these is true: they already share a conversation whose state for A is `MAIN`; they have a match together (any status); they are active members of the same community or club. Otherwise A's first message to B makes a `REQUEST` conversation for B.

### Rules for requests and limits (calls I made, see below)

- Until the recipient accepts, the sender may send at most **3** messages in that conversation (the 4th is refused with a clear message); the recipient can answer at any time, which accepts it.
- A player may start at most **20 new conversations per day** that end up as requests.
- A player may send at most **30 messages per minute** in all.
- Declining a request deletes the conversation (for both) and adds a block: the blocked player's later attempts to message him are refused with "You can't message this player" (no hint that he is blocked beyond that).
- A message is plain text, 1-2000 characters, trimmed; links are made clickable by the page (escaped first, only http/https).

### API (all under `/api/messages`, all need a logged-in player: 401 otherwise)

- `GET /conversations?box=main|requests` -> `{ items: [{ id, other: { playerId, name, slug, photoUrl }, lastMessage: { body, createdAt, mine }, unread, state }] }`, newest first.
- `GET /unread` -> `{ main: n, requests: n }` (counts of conversations with unread messages; `requests` counts waiting requests).
- `GET /players?q=` -> `{ items: [{ playerId, name, slug, photoUrl }] }`: names containing q (2+ characters), same city, not himself, not blocked either way, only players who can log in (a phone on file); max 20.
- `POST /conversations` body `{ playerId }` -> `{ id }` (finds or creates the direct conversation; 403 if blocked; 404 unknown player).
- `GET /conversations/:id` -> the conversation as above plus `canWrite`, `requestAllowanceLeft`; 404 for a non-member (never 403: a non-member must not learn that it exists).
- `GET /conversations/:id/messages?before=<id>` -> `{ items: [{ id, body, createdAt, mine }], more }`, 30 per page, oldest first within the page.
- `POST /conversations/:id/messages` body `{ body }` -> 201 message; enforces membership, blocks, the request allowance and the rate limits; moves the recipient's unread; emits live events.
- `POST /conversations/:id/read` -> marks everything read for the caller.
- `POST /conversations/:id/accept` (recipient of a request) -> state `MAIN`.
- `POST /conversations/:id/decline` (recipient of a request) -> deletes the conversation, adds the block.

### Live delivery

- On connect the server reads the `blta_player` cookie from the handshake, verifies the signature (the same secret as `cookieParser`), and joins the socket to `player:<id>`. No cookie or a bad signature: no private room.
- Events emitted only to `player:<id>` rooms of the members: `dm:message { conversationId, message, other }` and `dm:unread { main, requests }`.
- The existing `join` / `leave` events keep working for match rooms but refuse any room that starts with `player:` (a client can never join one).

### Pages

- `/messages` (SK `/spravy`, EN `/messages`) and `/messages/<id>`: the same page file. On a computer two panes (inbox with tabs Main / Requests and the "+", the chat); on a phone the inbox, and tapping a chat opens it full screen with a back arrow.
- `/messages/new`: "New message" - search by name, tap a player to open (or create) the conversation.
- A request shows a banner in the chat: "<name> wants to message you" with Accept / Decline; the composer is hidden until accepted (answering is also accepting).
- The main menu gets the item "Správy / Messages" (flag-guarded helper), with the unread count as a small badge when the player is logged in; the page itself asks a visitor to log in.
- Pages are `noindex` and listed in Backend > SEO.

### Deleted players

Deleting a player (Backend) removes his memberships; a direct conversation that loses a member is deleted with its messages.

## Phases (each can ship on its own)

1. **Private chats**: tables, API, live delivery, inbox and chat pages, "New message", Requests with accept / decline / block, unread counts and the menu badge.
2. Archive and mute (the `ARCHIVED` state and `muted` flag are already in the table), the ⋮ menu.
3. Groups of up to 20 people (`New group`), group titles, adding and leaving.
4. Push notifications (the existing web-push) and the bell.

## Calls I made (please check)

1. **Who is a stranger:** a shared match or a shared community/club or an earlier accepted chat makes two players "connected"; everyone else goes through Requests.
2. **Before acceptance the sender has 3 messages**, 20 new request conversations a day, 30 messages a minute overall.
3. **Search is limited to the viewer's city** and to players who have a phone on file (those who can log in).
4. **No notifications outside the page in phase 1** (the unread badge and the live update only); push and the bell are phase 4.
5. **Declining blocks the sender** (there is no separate "block" button in phase 1).
6. **A message cannot be edited or deleted** after it is sent (phase 1).
7. Plain text up to 2000 characters, links clickable, no images or files.

## Left to the builder

Column and file names and migrations; the markup and CSS (follow the site's classes and the Ace layout); the exact rate-limit mechanism (in memory is fine for one server process); how the Slovak address `/spravy` is declared in `src/seo.js` (follow `reservations`); i18n keys; tests for each task in the style of `scripts/check-*.js`, including the permission tests (member, non-member, stranger, blocked player, visitor) and a live-delivery test that a non-member's socket never receives a message.
