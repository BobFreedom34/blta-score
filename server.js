require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./src/db');
const engine = require('./src/matchEngine');
const playersRouter = require('./src/routes/players');
const matchesRouter = require('./src/routes/matches');
const adminRouter = require('./src/routes/admin');
const playerAuthRouter = require('./src/routes/player');
const pushRouter = require('./src/routes/push');
const badgesRouter = require('./src/routes/badges');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-only-insecure-secret'));

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
// Uploaded badge icons live on the persistent disk (see src/db.js's
// dataDir), not under public/, so they survive redeploys.
app.use('/badge-icons', express.static(path.join(db.dataDir, 'badge-icons')));

app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/player', playerAuthRouter);
app.use('/api/push', pushRouter);
app.use('/api/badges', badgesRouter);

// Pretty routes -> static HTML pages (the page JS reads the share token from the URL).
const matchTemplate = fs.readFileSync(path.join(PUBLIC_DIR, 'match.html'), 'utf8');
const MATCH_TITLE_TAG = '<title>BLTA Score — Match</title>';

function escapeHtmlAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Chat apps (WhatsApp, etc.) read Open Graph tags from the raw HTML response
// without running any JS, so the title/description shown in a shared link
// preview has to be baked in server-side here rather than set later by
// match.js — by the time that runs, the crawler is long gone.
app.get('/match/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM matches WHERE share_token = ?').get(req.params.token);
  if (!row) return res.send(matchTemplate);

  const p1 = db.prepare('SELECT * FROM players WHERE id = ?').get(row.player1_id);
  const p2 = db.prepare('SELECT * FROM players WHERE id = ?').get(row.player2_id);
  const title = `${p1.name} vs ${p2.name} — BLTA Score`;

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
  const metaTags = `<title>${escapeHtmlAttr(title)}</title>
<meta property="og:title" content="${escapeHtmlAttr(title)}">
<meta property="og:description" content="${escapeHtmlAttr(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtmlAttr(origin)}/match/${row.share_token}">
<meta property="og:image" content="${escapeHtmlAttr(origin)}/img/blta-logo.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtmlAttr(title)}">
<meta name="twitter:description" content="${escapeHtmlAttr(description)}">`;

  res.send(matchTemplate.replace(MATCH_TITLE_TAG, metaTags));
});
app.get('/player/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/embed/match/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-match.html')));
app.get('/embed/live', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-live.html')));

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
