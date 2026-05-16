/**
 * test_bots.js — Spawns 3 bot players that log in via direct-login,
 * connect via Socket.IO, and join a room.
 *
 * Usage: node test_bots.js <roomId>
 *   roomId is passed as the first CLI argument.
 *   If no roomId, they will create a new room and all join it.
 */
const http = require('http');
const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3001';
const BOTS = ['mcodel', 'fbiber', 'edpolat'];

async function directLogin(login) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ login });
    const req = http.request(`${SERVER}/auth/42/direct-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let body = '';
      // Grab the cookie
      const cookies = res.headers['set-cookie'];
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          console.log(`[${login}] Login response:`, json);
          resolve({ cookies, json });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function connectSocket(login, cookies) {
  const cookieStr = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
  
  const socket = io(SERVER, {
    extraHeaders: { Cookie: cookieStr },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`[${login}] Socket connected: ${socket.id}`);
  });

  socket.on('connect_error', (err) => {
    console.error(`[${login}] Socket error:`, err.message);
  });

  socket.on('player:info', ({ user }) => {
    console.log(`[${login}] Authenticated as: ${user.login}`);
  });

  socket.on('room:updated', (room) => {
    console.log(`[${login}] Room updated: ${room.name} (${room.playerCount}/${room.maxPlayers})`);
  });

  socket.on('room:gameStart', ({ gameState }) => {
    console.log(`[${login}] GAME STARTED! Phase: ${gameState.phase}`);
  });

  socket.on('game:stateUpdate', (gs) => {
    // Auto-play: if it's this bot's turn during setup, place randomly
    const me = gs.players.find(p => p.login === login);
    if (!me) return;

    if (gs.currentPlayerId === me.id) {
      if (gs.phase === 'setup') {
        if (gs.setupStep === 'village') {
          // Pick a random empty vertex
          const emptyVertices = gs.grid.vertices.filter(v => !v.building);
          if (emptyVertices.length > 0) {
            const pick = emptyVertices[Math.floor(Math.random() * emptyVertices.length)];
            console.log(`[${login}] Placing village at ${pick.id}`);
            socket.emit('game:command', { type: 'PLACE_VILLAGE', vertexId: pick.id });
          }
        } else if (gs.setupStep === 'road') {
          // Pick a random edge adjacent to last placed village
          const lastVillage = me.villages[me.villages.length - 1];
          const vertex = gs.grid.vertices.find(v => v.id === lastVillage);
          if (vertex) {
            const emptyEdges = vertex.adjacentEdges.filter(eid => {
              const edge = gs.grid.edges.find(e => e.id === eid);
              return edge && !edge.road;
            });
            if (emptyEdges.length > 0) {
              const pick = emptyEdges[Math.floor(Math.random() * emptyEdges.length)];
              console.log(`[${login}] Placing road at ${pick}`);
              socket.emit('game:command', { type: 'PLACE_ROAD', edgeId: pick });
            }
          }
        }
      } else if (gs.phase === 'roll') {
        console.log(`[${login}] Rolling dice...`);
        socket.emit('game:command', { type: 'ROLL_DICE' });
      } else if (gs.phase === 'build') {
        // Just end turn
        console.log(`[${login}] Ending turn...`);
        socket.emit('game:command', { type: 'END_TURN' });
      } else if (gs.phase === 'robber') {
        // Move robber to a random hex
        const hexes = gs.grid.hexes.filter(h => !h.hasRobber);
        const pick = hexes[Math.floor(Math.random() * hexes.length)];
        console.log(`[${login}] Moving robber to (${pick.q},${pick.r})`);
        socket.emit('game:command', { type: 'MOVE_ROBBER', q: pick.q, r: pick.r });
      }
    }
  });

  socket.on('error', (err) => {
    console.error(`[${login}] Error:`, err.message);
  });

  return socket;
}

async function main() {
  const roomIdArg = process.argv[2];

  const sockets = [];

  for (const login of BOTS) {
    try {
      const { cookies } = await directLogin(login);
      const sock = connectSocket(login, cookies);
      sockets.push({ login, sock });

      // Wait for connection
      await new Promise(r => setTimeout(r, 1500));

      if (roomIdArg) {
        console.log(`[${login}] Joining room ${roomIdArg}...`);
        sock.emit('room:join', { roomId: roomIdArg });
      }
    } catch (err) {
      console.error(`[${login}] Failed:`, err.message);
    }
  }

  console.log('\n=== All 3 bots connected. They will auto-play when the game starts. ===\n');
  console.log('Press Ctrl+C to stop bots.\n');
}

main().catch(console.error);
