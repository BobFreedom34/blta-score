require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const playersRouter = require('./src/routes/players');
const matchesRouter = require('./src/routes/matches');
const adminRouter = require('./src/routes/admin');

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

app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/admin', adminRouter);

// Pretty routes -> static HTML pages (the page JS reads the share token from the URL).
app.get('/match/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'match.html')));
app.get('/embed/match/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-match.html')));
app.get('/embed/live', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'embed-live.html')));

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (typeof room === 'string' && room.length < 100) socket.join(room);
  });
  socket.on('leave', (room) => {
    if (typeof room === 'string') socket.leave(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BLTA score app listening on http://localhost:${PORT}`);
});
