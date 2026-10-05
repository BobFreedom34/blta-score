require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./src/db');
const engine = require('./src/matchEngine');
const shareImage = require('./src/shareImage');
const badgeEngine = require('./src/badgeEngine');
const backup = require('./src/backup');
const playersRouter = require('./src/routes/players');
const matchesRouter = require('./src/routes/matches');
const adminRouter = require('./src/routes/admin');
const playerAuthRouter = require('./src/routes/player');
const pushRouter = require('./src/routes/push');
const badgesRouter = require('./src/routes/badges');
const rankingsRouter = require('./src/routes/rankings');
const availabilityRouter = require('./src/routes/availability');
const refereeRouter = require('./src/routes/referee');
const headerItemsRouter = require('./src/routes/headerItems');
const courtIQRouter = require('./src/routes/courtiq');
const bracketsRouter = require('./src/routes/brackets');
const venuesRouter = require('./src/routes/venues');
const seasonsRouter = require('./src/routes/seasons');
const scheduleRouter = require('./src/routes/schedule');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
app.set('io', io);

// One-time bootstrap — see badgeEngine.backfillIfNeeded's own comment for
// why this has to run before any real traffic hits the badge notification
// endpoints (routes/player.js) or the matches routes that create new ones.
require('./src/venueSeed').run();
try {
  const seeded = require('./src/seasonSeed').run(db);
  if (!seeded.skipped) console.log('Seasons seeded: tagged ' + seeded.tagged + ' of ' + seeded.total + ' BLTA matches');
} catch (err) {
  console.error('Season seeding failed (will retry on next start):', err);
}
try {
  const fixed = require('./src/seasonSeed').fixWinterStart(db);
  if (!fixed.skipped) console.log('Winter season start corrected: moved ' + fixed.moved + ' matches');
} catch (err) {
  console.error('Winter start fix failed (will retry on next start):', err);
}
try {
  require('./src/seasonSeed').ensureTablesMenuItem(db);
} catch (err) {
  console.error('Tables menu item failed:', err);
}
try {
  require('./src/seasonSeed').ensureHomeMenuItem(db);
} catch (err) {
  console.error('Home menu item failed:', err);
}
try {
  const r = require('./src/seasonRounds').assignAutumn2026Rounds(db);
  if (r.assigned) console.log(`Autumn Finals rounds: set the round of ${r.assigned} matches${r.missing.length ? `; ${r.missing.length} listed pairs have no match in the app` : ''}`);
} catch (err) {
  console.error('Autumn Finals rounds failed (will retry on next start):', err);
}
try {
  require('./src/seasonSeed').ensureSeasonLogos(db);
} catch (err) {
  console.error('Season logos failed:', err);
}
try {
  require('./src/seasonSeed').ensureScheduleMenuItem(db);
} catch (err) {
  console.error('Schedule menu item failed:', err);
}
try {
  require('./src/scheduleSeed').seedScheduleEvents(db);
} catch (err) {
  console.error('Schedule events seed failed (will retry on next start):', err);
}
badgeEngine.backfillIfNeeded();
badgeEngine.startScheduledReminders();
backup.startScheduledBackups();

// Brotli / gzip for everything that compresses well (JSON, HTML, JS, CSS, SVG; images and fonts are skipped by the
// package itself). Registered first, before the static files and every route, so all of them are covered. Responses
// under 1 kB are left alone, and the ETag the next middleware sets still works with it (304 Not Modified).
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-only-insecure-secret'));

const PUBLIC_DIR = path.join(__dirname, 'public');
// The match list (with all its filters) lives at /matches now; / is the league overview. Old links to the list
// carry a query (/?view=my, shared filter links), so any / with a query is forwarded there.
app.get('/', (req, res, next) => {
  const q = req.originalUrl.indexOf('?');
  if (q === -1) return next();
  res.redirect(302, '/matches' + req.originalUrl.slice(q));
});
// Static files. ETag and Last-Modified stay on (the defaults, spelled out), so anything that is revalidated costs a
// 304 and no body. Cache lifetimes:
//  - fonts: a year, immutable (they never change under the same name);
//  - images and icons: 30 days (brand assets that rarely change; replace one by giving it a new file name);
//  - JS and CSS: these files are NOT versioned by name, so by default they are revalidated on every load (ETag) and a
//    deploy reaches everyone at once. A script or stylesheet requested with a version in the URL (/js/home.js?v=abc)
//    is fixed content by definition and is kept for a year, immutable. No page uses that yet.
//  - HTML pages: revalidated on every load.
const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|avif|ico)$/i;
const staticFiles = express.static(PUBLIC_DIR, {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (IMAGE_FILE.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=2592000');
  },
});
app.use((req, res, next) => {
  if (req.query.v && /\.(js|css)$/.test(req.path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  staticFiles(req, res, next);
});
// Uploaded badge icons live on the persistent disk (see src/db.js's
// dataDir), not under public/, so they survive redeploys.
app.use('/badge-icons', express.static(path.join(db.dataDir, 'badge-icons')));
app.use('/player-photos', express.static(path.join(db.dataDir, 'player-photos')));

app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/player', playerAuthRouter);
app.use('/api/push', pushRouter);
app.use('/api/badges', badgesRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/referee', refereeRouter);
app.use('/api/header-items', headerItemsRouter);
app.use('/api/courtiq', courtIQRouter);
app.use('/api/brackets', bracketsRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/schedule', scheduleRouter);

// Pretty routes -> static HTML pages (the page JS reads the share token from the URL).
const matchTemplate = fs.readFileSync(path.join(PUBLIC_DIR, 'match.html'), 'utf8');
// A regex, not an exact string match — an exact literal here previously
// went stale the moment match.html's own <title> text/attributes changed
// (e.g. gaining data-i18n, or its fallback text being edited) and the
// .replace() below silently no-outed, meaning shared match links quietly
// stopped getting a real per-match preview and nobody would notice short
// of checking the raw HTML response.
const MATCH_TITLE_RE = /<title[^>]*>[^<]*<\/title>/;

function escapeHtmlAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The data the result image is drawn from (see src/shareImage.js).
function matchImageData(row) {
  const player = (id) => db.prepare('SELECT id, name FROM players WHERE id = ?').get(id);
  return {
    player1: player(row.player1_id),
    player2: player(row.player2_id),
    winnerId: row.winner_id,
    endReason: row.end_reason,
    category: row.category,
    league: row.league,
    season: row.season_id ? db.prepare('SELECT name FROM seasons WHERE id = ?').get(row.season_id) : null,
    group: row.group_id ? db.prepare('SELECT name FROM season_groups WHERE id = ?').get(row.group_id) : null,
    startTime: row.start_time,
    endTime: row.end_time,
    scheduledAt: row.scheduled_at,
    location: row.location,
    state: JSON.parse(row.state),
  };
}

// 1200x630 result picture used as the link preview (WhatsApp, Messenger…) of a finished match. The link's ?v= is the
// match's updated_at, so the picture is cached for a long time but a corrected result gets a new address.
app.get('/match/:token/preview.png', (req, res) => {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) return res.status(404).end();
  try {
    const png = shareImage.cachedPng(row.share_token, row.updated_at, matchImageData(row));
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return res.send(png);
  } catch (err) {
    console.error('Result image failed for match', row.share_token, err);
    return res.redirect(302, '/img/blta-logo.png');
  }
});

// Chat apps (WhatsApp, etc.) read Open Graph tags from the raw HTML response
// without running any JS, so the title/description shown in a shared link
// preview has to be baked in server-side here rather than set later by
// match.js — by the time that runs, the crawler is long gone.
app.get('/match/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) return res.send(matchTemplate);

  const p1 = db.prepare('SELECT * FROM players WHERE id = ?').get(row.player1_id);
  const p2 = db.prepare('SELECT * FROM players WHERE id = ?').get(row.player2_id);
  const title = `${p1.name} vs ${p2.name} — Tennis SCORE`;

  let description;
  if (row.status === 'PLANNED') {
    description = engine.FORMATS[row.format] ? engine.FORMATS[row.format].label : 'Upcoming BLTA match';
  } else {
    const scoreSummary = engine.describeMatch(JSON.parse(row.state));
    description = row.status === 'LIVE'
      ? `🔴 Live now${scoreSummary ? ` — ${scoreSummary}` : ''}`
      : (scoreSummary ? `Final score: ${scoreSummary}` : 'Match finished');
  }

  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  // A finished match shows its result as the preview picture; anything else keeps the BLTA logo.
  const hasResultImage = row.status === 'FINISHED' && !!row.winner_id;
  const imageUrl = hasResultImage
    ? `${origin}/match/${row.share_token}/preview.png?v=${encodeURIComponent(row.updated_at || '')}`
    : `${origin}/img/blta-logo.png`;
  const imageTags = hasResultImage
    ? `<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${shareImage.WIDTH}">
<meta property="og:image:height" content="${shareImage.HEIGHT}">
<meta property="og:image:alt" content="${escapeHtmlAttr(title)}">
`
    : '';
  const metaTags = `<title>${escapeHtmlAttr(title)}</title>
<meta property="og:title" content="${escapeHtmlAttr(title)}">
<meta property="og:description" content="${escapeHtmlAttr(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtmlAttr(origin)}/match/${row.share_token}">
<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}">
${imageTags}<meta name="twitter:card" content="${hasResultImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}">
<meta name="twitter:title" content="${escapeHtmlAttr(title)}">
<meta name="twitter:description" content="${escapeHtmlAttr(description)}">`;

  res.send(matchTemplate.replace(MATCH_TITLE_RE, metaTags));
});
app.get('/player/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/bracket/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bracket.html')));
app.get('/season/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'season.html')));
app.get('/courts/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'court.html')));
app.get('/embed/match/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-match.html')));
app.get('/embed/live', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-live.html')));
app.get('/embed/compact', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-compact.html')));
app.get('/embed/rankings', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-rankings.html')));
app.get('/embed/bracket/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-bracket.html')));
app.get('/compact', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'compact.html')));
app.get('/compactblta', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'compactblta.html')));

// Live viewer count for a match room — everyone in the room gets the
// updated headcount whenever someone joins, leaves, or disconnects.
function broadcastViewerCount(room) {
  const count = io.sockets.adapter.rooms.get(room)?.size || 0;
  io.to(room).emit('viewers:count', { room, count });
}

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (typeof room === 'string' && room.length < 100) {
      socket.join(room);
      if (room.startsWith('match:')) broadcastViewerCount(room);
    }
  });
  socket.on('leave', (room) => {
    if (typeof room === 'string') {
      socket.leave(room);
      if (room.startsWith('match:')) broadcastViewerCount(room);
    }
  });
  // Fires while the socket is still a member of its rooms, so the room size
  // read here still includes this socket — subtract 1 to report the count
  // as it will be right after the disconnect completes.
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('match:')) {
        const count = Math.max(0, (io.sockets.adapter.rooms.get(room)?.size || 1) - 1);
        io.to(room).emit('viewers:count', { room, count });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BLTA score app listening on http://localhost:${PORT}`);
});
