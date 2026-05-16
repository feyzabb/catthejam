/**
 * index.js — Main server entry point.
 * Boots Express HTTP server + Socket.IO WebSocket server.
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const config = require('./config');

// Initialize database (runs schema migration)
require('./database/db');

const oauthRouter = require('./auth/oauth42');
const { requireSocketAuth } = require('./auth/middleware');
const RoomManager = require('./managers/RoomManager');
const PlayerManager = require('./managers/PlayerManager');
const { registerSocketHandlers } = require('./socket/handlers');
const leaderboard = require('./database/leaderboard');

// ─── EXPRESS SETUP ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Session middleware (shared between Express and Socket.IO)
const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'database') }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 1 week
});

app.use(sessionMiddleware);
app.use(express.json());

// Serve static client files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Auth routes
app.use('/auth/42', oauthRouter);

// API: Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const top = leaderboard.getTop(20);
  res.json(top);
});

// API: Current user stats
app.get('/api/me/stats', (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  const stats = leaderboard.getPlayerStats(req.session.user.intraId);
  res.json({ authenticated: true, stats });
});

// Catch-all: serve index.html for SPA
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ─── SOCKET.IO SETUP ───────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// Auth middleware for sockets
io.use((socket, next) => {
  const req = socket.request;
  if (req.session && req.session.user) {
    socket.user = req.session.user;
    return next();
  }
  next(new Error('Authentication required'));
});

// ─── MANAGERS ───────────────────────────────────────────────
const roomManager = new RoomManager(io);
const playerManager = new PlayerManager();

// ─── SOCKET CONNECTIONS ─────────────────────────────────────
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, roomManager, playerManager);
});

// ─── START SERVER ───────────────────────────────────────────
server.listen(config.PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   🌊  Deep Sea Pulse: Coalition Wars  🌊          ║
  ║                                                   ║
  ║   Server running on http://localhost:${config.PORT}        ║
  ║   Waiting for players...                          ║
  ╚═══════════════════════════════════════════════════╝
  `);
});
