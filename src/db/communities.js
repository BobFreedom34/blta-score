const { db } = require('./core');

// Komunity a kluby (communities and clubs): a group of players with its own page, news and members (src/routes/communities.js). type is CLUB or
// COMMUNITY (only the label differs); join_policy is OPEN (anyone joins at once) or APPROVAL (a request an admin of the group decides); a member's
// status is ACTIVE, PENDING or REJECTED (kept so a rejected request can be sent again only after 7 days). hidden is set by an admin (moderation).
db.exec(`
  CREATE TABLE IF NOT EXISTS organisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL CHECK (type IN ('CLUB', 'COMMUNITY')),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    logo_url TEXT,
    cover_url TEXT,
    join_policy TEXT NOT NULL DEFAULT 'OPEN' CHECK (join_policy IN ('OPEN', 'APPROVAL')),
    hidden INTEGER NOT NULL DEFAULT 0,
    approved INTEGER NOT NULL DEFAULT 1,
    created_by_player_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_organisations_league ON organisations(league_id);
  CREATE TABLE IF NOT EXISTS organisation_members (
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING', 'REJECTED')),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    decided_at TEXT,
    PRIMARY KEY (organisation_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_organisation_members_player ON organisation_members(player_id);
  -- the earlier addresses of an organisation that was renamed (its address follows its name): they still lead to it, see src/communities.js
  CREATE TABLE IF NOT EXISTS organisation_old_slugs (
    slug TEXT PRIMARY KEY,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE
  );
  -- the own ranking of a community or club (its tab Rebríček): the points of a player, set by hand by an admin of the organisation
  CREATE TABLE IF NOT EXISTS organisation_ranking (
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (organisation_id, player_id)
  );
  -- what the events of a community paid into its ranking (src/communityPoints.js): one row per award, so a corrected or deleted result takes back exactly that
  CREATE TABLE IF NOT EXISTS organisation_ranking_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    match_id INTEGER,
    player_id INTEGER NOT NULL,
    points INTEGER NOT NULL,
    kind TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_ranking_awards_match ON organisation_ranking_awards(match_id);
  CREATE INDEX IF NOT EXISTS idx_org_ranking_awards_season ON organisation_ranking_awards(season_id);
  CREATE TABLE IF NOT EXISTS organisation_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    author_player_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_organisation_posts_org ON organisation_posts(organisation_id, id);
  CREATE TABLE IF NOT EXISTS organisation_post_reactions (
    post_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (post_id, player_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_organisation_post_reactions_post ON organisation_post_reactions(post_id);
`);
// Comments under a news post of a community or club: written by its members and admins (src/routes/communities.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS organisation_post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    organisation_id INTEGER NOT NULL,
    author_player_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_organisation_post_comments_post ON organisation_post_comments(post_id, id);
`);
// The bell notification for the author of a post when somebody comments on it (src/routes/player.js lists them).
db.exec(`
  CREATE TABLE IF NOT EXISTS post_comment_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_post_comment_notifications_player ON post_comment_notifications(player_id, seen);
`);
// A post of a community that shows the winners of one of its tournaments (the organiser shares them from the page of the tournament): the id of that season.
if (!db.prepare('PRAGMA table_info(organisation_posts)').all().some((c) => c.name === 'winners_season_id')) db.exec('ALTER TABLE organisation_posts ADD COLUMN winners_season_id INTEGER');
// 1 = the post was written by the super admin of the site: the notifications about it say "Admin" instead of his name.
if (!db.prepare('PRAGMA table_info(organisation_posts)').all().some((c) => c.name === 'by_admin')) db.exec('ALTER TABLE organisation_posts ADD COLUMN by_admin INTEGER NOT NULL DEFAULT 0');
// The bell notification for a player who was tagged with @Name in a comment (src/mentions.js finds the names, src/routes/player.js lists them).
db.exec(`
  CREATE TABLE IF NOT EXISTS mention_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    actor_player_id INTEGER,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mention_notifications_player ON mention_notifications(player_id, seen);
`);
// The bell notifications of the news of a community or club: POST = a new post (to every member but its author; actor = the author), REACTION = somebody
// put an emoji on a post (to its author; actor = who, one per person and emoji). src/routes/player.js lists them, src/routes/communities.js writes them.
db.exec(`
  CREATE TABLE IF NOT EXISTS community_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('POST', 'REACTION')),
    post_id INTEGER NOT NULL,
    actor_player_id INTEGER,
    emoji TEXT,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_community_notifications_player ON community_notifications(player_id, seen);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_community_notifications_reaction ON community_notifications(player_id, post_id, actor_player_id, emoji) WHERE kind = 'REACTION';
`);
// The bell notification of the admins of a community or club when somebody registers for one of its tournaments or seasons (to every ACTIVE admin of the
// organisation; the name is kept in the row, the registration itself may be deleted since). substitute = the maximum of players was reached. src/routes/seasons.js
// writes them, src/routes/player.js lists them.
db.exec(`
  CREATE TABLE IF NOT EXISTS registration_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    substitute INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_registration_notifications_player ON registration_notifications(player_id, seen);
`);
// a picture in a news post: the address of a file this community uploaded (/community-images/<org id>-post-...)
// the time a post was last edited (null = never): the page says "upravené" beside the date
if (!db.prepare('PRAGMA table_info(organisation_posts)').all().some((c) => c.name === 'edited_at')) db.exec('ALTER TABLE organisation_posts ADD COLUMN edited_at TEXT');
if (!db.prepare('PRAGMA table_info(organisation_posts)').all().some((c) => c.name === 'image_url')) db.exec('ALTER TABLE organisation_posts ADD COLUMN image_url TEXT');
// the reactions and comments under a tournament in the news hang on a hidden post of its own (season_id), made the first time somebody reacts or comments
if (!db.prepare('PRAGMA table_info(organisation_posts)').all().some((c) => c.name === 'season_id')) db.exec('ALTER TABLE organisation_posts ADD COLUMN season_id INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_organisation_posts_season ON organisation_posts(season_id) WHERE season_id IS NOT NULL');
// An invitation an admin sent to a player (a message with a Join button, see src/routes/communities.js): the player joins from it without the approval.
db.exec(`
  CREATE TABLE IF NOT EXISTS organisation_invites (
    organisation_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    invited_by_player_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (organisation_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_organisation_invites_by ON organisation_invites(invited_by_player_id, created_at);
`);
// Správy / Messages: private one-to-one chats between players (src/routes/messages.js, src/messages.js). A conversation is private to its members;
// direct_key ("<smaller id>:<larger id>") keeps it to one direct conversation per pair. A member's state is MAIN, REQUEST (a first message from a
// stranger that he has not accepted yet) or ARCHIVED (later); last_read_message_id is how unread messages are counted.
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'DIRECT' CHECK (type IN ('DIRECT', 'GROUP')),
    title TEXT,
    direct_key TEXT UNIQUE,
    created_by_player_id INTEGER NOT NULL,
    started_as_request INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_message_at TEXT
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'MAIN' CHECK (state IN ('MAIN', 'REQUEST', 'ARCHIVED')),
    muted INTEGER NOT NULL DEFAULT 0,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (conversation_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_conversation_members_player ON conversation_members(player_id);
  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_player_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(conversation_id, id);
  CREATE TABLE IF NOT EXISTS message_request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_message_request_log_player ON message_request_log(player_id, created_at);
  CREATE TABLE IF NOT EXISTS message_blocks (
    blocker_player_id INTEGER NOT NULL,
    blocked_player_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (blocker_player_id, blocked_player_id)
  );
`);
// a message that is an invitation to a community or club names it (the chat shows a card with a Join button)
if (!db.prepare('PRAGMA table_info(direct_messages)').all().some((c) => c.name === 'invite_org_id')) db.exec('ALTER TABLE direct_messages ADD COLUMN invite_org_id INTEGER');
// a message that asks the chosen player to approve a new club names it (the chat shows a card with an Approve button)
if (!db.prepare('PRAGMA table_info(direct_messages)').all().some((c) => c.name === 'approval_org_id')) db.exec('ALTER TABLE direct_messages ADD COLUMN approval_org_id INTEGER');

// approved: a COMMUNITY is public at once (1); a CLUB is made with 0 and goes public when the super admin approves it (until then only its own
// admins and the admins of the site see it). A database that had the table before this column keeps its rows public.
if (!db.prepare('PRAGMA table_info(organisations)').all().some((c) => c.name === 'approved')) {
  db.exec('ALTER TABLE organisations ADD COLUMN approved INTEGER NOT NULL DEFAULT 1');
}
// The web page, the Facebook page and the Instagram page of a community or club (shown on its Info tab).
['website_url', 'facebook_url', 'instagram_url'].forEach((col) => {
  if (!db.prepare('PRAGMA table_info(organisations)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE organisations ADD COLUMN ${col} TEXT`);
});
// The private invitation link of a community or club (src/routes/communities.js): whoever follows it joins at once, whatever the join policy.
if (!db.prepare('PRAGMA table_info(organisations)').all().some((c) => c.name === 'invite_token')) {
  db.exec('ALTER TABLE organisations ADD COLUMN invite_token TEXT');
}
// Club tournaments (phase 2): a tournament season made by a community or club has organisation_id (null for the league and for the tournaments an admin
// makes); counts_for_rating (default 0, only the super admin) says whether its results move the ratings; max_open_tournaments is the limit of open ones.
[['seasons', 'organisation_id', 'INTEGER'], ['organisations', 'counts_for_rating', 'INTEGER NOT NULL DEFAULT 0'], ['organisations', 'max_open_tournaments', 'INTEGER NOT NULL DEFAULT 5']].forEach(([table, column, ddl]) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
});
db.exec('CREATE INDEX IF NOT EXISTS idx_seasons_organisation ON seasons(organisation_id)');

// The draw in front of the camera (src/liveDraw.js): every time the organiser starts one, the lot is made from a fresh random key (seed) and written here (PLANNED); the draw that
// was saved into the tournament is COMMITTED. The key is public once the draw is saved: anybody can check the shuffle from it, and the number of PLANNED + COMMITTED rows of a
// category says how many times a draw was started (a draw that was started and thrown away is not hidden).
db.exec(`
  CREATE TABLE IF NOT EXISTS draw_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PLANNED',
    seed TEXT NOT NULL,
    seed_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '{}',
    args TEXT NOT NULL DEFAULT '{}',
    plan TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    committed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_draw_records_season ON draw_records(season_id, category);
`);
