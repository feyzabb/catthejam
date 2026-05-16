/**
 * main.js — Client-side application bootstrap for Deep Sea Pulse: Catan Edition.
 */

// ─── STATE ─────────────────────────────────────────────────
const state = {
  user: null,
  currentRoom: null,
  gameState: null,
  selectedAction: null,
  socket: null,
  myPlayerIndex: -1,
};

// ─── DOM REFS ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const screens = {
  login: $('#screen-login'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
};

// ─── SCREEN MANAGEMENT ────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'game') initGameCanvas();
}

// ─── AUTH CHECK ────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/auth/42/me');
    const data = await res.json();
    if (data.authenticated) {
      state.user = data.user;
      updateUserBadge();
      showScreen('lobby');
      connectSocket();
      loadLeaderboard();
    } else {
      showScreen('login');
    }
  } catch (e) {
    console.error('Auth check failed:', e);
    showScreen('login');
  }
}

function updateUserBadge() {
  if (!state.user) return;
  const avatar = $('#user-avatar');
  if (state.user.avatarUrl) avatar.src = state.user.avatarUrl;
  else avatar.style.display = 'none';
  $('#user-login').textContent = state.user.login;
  $('#user-elo').textContent = `${state.user.eloPoints || 1000} ELO`;
}

// ─── LEADERBOARD ───────────────────────────────────────────
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const players = await res.json();
    renderLeaderboard(players);
  } catch (e) {
    console.error('Failed to load leaderboard:', e);
  }
}

function renderLeaderboard(players) {
  const list = $('#leaderboard-list');
  if (!players.length) {
    list.innerHTML = '<div class="empty-state">No players yet. Be the first!</div>';
    return;
  }
  list.innerHTML = players.map((p, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const coalColor = p.coalition_color || '#5B7C99';
    return `
      <div class="lb-row">
        <span class="lb-rank ${rankClass}">#${i + 1}</span>
        <img class="lb-avatar" src="${p.avatar_url || ''}" alt="" onerror="this.style.display='none'">
        <span class="lb-name">${p.login}</span>
        <span class="lb-coalition" style="background:${coalColor}">${p.coalition_name || '—'}</span>
        <span class="lb-elo">${p.elo_points}</span>
      </div>`;
  }).join('');
}

// ─── SOCKET.IO ─────────────────────────────────────────────
function connectSocket() {
  state.socket = io();
  const s = state.socket;

  s.on('connect', () => console.log('[Socket] Connected'));
  
  s.on('player:info', ({ user }) => {
    state.user = user;
    updateUserBadge();
  });

  s.on('room:list', (rooms) => renderRoomList(rooms));
  s.on('room:updated', (room) => {
    state.currentRoom = room;
    updateRoomLobby(room);
  });

  s.on('room:gameStart', ({ roomId, gameState }) => {
    state.gameState = gameState;
    const me = gameState.players.find(p => p.id === state.user.id);
    state.myPlayerIndex = me ? me.playerIndex : -1;
    showScreen('game');
    renderGameState(gameState);
    addEventLog('Game Started! Setup Phase.');
  });

  s.on('game:stateUpdate', (gs) => {
    state.gameState = gs;
    renderGameState(gs);
    updateUIControls(gs);
  });

  s.on('game:phaseStart', (data) => {
    addEventLog(`Phase: ${data.phase.toUpperCase()}`);
  });

  s.on('game:turnChanged', (data) => {
    addEventLog(`Turn ${data.turnNumber}: Player ${data.currentTurn + 1}`);
    if (data.currentPlayerId === state.user.id) {
      addEventLog('🎲 It is your turn! Please roll the dice.');
    }
  });

  s.on('game:dice', (data) => {
    const hudDice = $('#hud-dice');
    hudDice.classList.remove('hidden');
    $('#die1').textContent = data.dice[0];
    $('#die2').textContent = data.dice[1];
    addEventLog(`🎲 Rolled a ${data.total}!`);
    setTimeout(() => hudDice.classList.add('hidden'), 3000);
  });

  s.on('game:ended', ({ placements }) => {
    showGameOverModal(placements);
  });

  s.on('error', ({ code, message }) => {
    addEventLog(`❌ ${message}`);
  });
}

// ─── ROOM LIST & LOBBY ────────────────────────────────────
function renderRoomList(rooms) {
  const list = $('#room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="empty-state">No rooms available. Create one!</div>';
    return;
  }
  list.innerHTML = rooms.map(r => `
    <div class="room-card" data-room-id="${r.id}">
      <div class="room-info">
        <h4>${escapeHtml(r.name)}</h4>
        <p>${r.players.map(p => p.login).join(', ') || 'Empty'}</p>
      </div>
      <span class="room-players-count ${r.playerCount >= r.maxPlayers ? 'full' : ''}">${r.playerCount}/${r.maxPlayers}</span>
    </div>`).join('');

  list.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      state.socket.emit('room:join', { roomId: card.dataset.roomId });
    });
  });
}

function updateRoomLobby(room) {
  const panel = $('#panel-room-lobby');
  panel.classList.remove('hidden');
  $('#room-lobby-title').textContent = room.name;
  $('#room-status-text').textContent = `${room.playerCount}/${room.maxPlayers} players — ${room.playerCount < room.maxPlayers ? 'Waiting...' : 'Starting!'}`;

  for (let i = 0; i < 4; i++) {
    const slot = $(`#slot-${i}`);
    const player = room.players[i];
    if (player) {
      slot.classList.add('filled');
      slot.style.borderColor = player.coalitionColor || '#5B7C99';
      slot.innerHTML = `
        <div class="slot-player">
          <img src="${player.avatarUrl || ''}" alt="" onerror="this.style.display='none'" style="width:48px;height:48px;border-radius:50%">
          <div class="slot-name">${player.login}</div>
        </div>`;
    } else {
      slot.classList.remove('filled');
      slot.style.borderColor = '';
      slot.innerHTML = '<div class="slot-empty">?</div>';
    }
  }
}

// ─── GAME CANVAS ───────────────────────────────────────────
let canvas, ctx, camera;

function initGameCanvas() {
  canvas = $('#game-canvas');
  ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 150;
  camera = { x: canvas.width / 2, y: canvas.height / 2, zoom: 1.2 };

  let dragging = false, lastX, lastY;
  canvas.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camera.x += e.clientX - lastX;
    camera.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (state.gameState) renderGameState(state.gameState);
  });
  canvas.addEventListener('mouseup', () => dragging = false);
  canvas.addEventListener('mouseleave', () => dragging = false);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom = Math.max(0.5, Math.min(2.5, camera.zoom - e.deltaY * 0.001));
    if (state.gameState) renderGameState(state.gameState);
  });

  canvas.addEventListener('click', (e) => {
    if (dragging) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left - camera.x) / camera.zoom;
    const py = (e.clientY - rect.top - camera.y) / camera.zoom;
    handleCanvasClick(px, py);
  });

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 150;
    if (state.gameState) renderGameState(state.gameState);
  });
}

// ─── RENDERING ─────────────────────────────────────────────
const HEX_SIZE = 50;
const SQRT3 = Math.sqrt(3);

function renderGameState(gs) {
  if (!ctx || !gs) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // 1. Draw Hexes (Islands)
  for (const hex of gs.grid.hexes) {
    const { x, y } = getHexPixel(hex.q, hex.r);
    const img = GameAssets.getIslandTile(hex.resourceType);
    
    if (img && img.complete) {
      const w = SQRT3 * HEX_SIZE * 1.05;
      const h = 2 * HEX_SIZE * 1.05;
      ctx.drawImage(img, x - w/2, y - h/2, w, h);
    }

    // Number token
    if (hex.diceNumber) {
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = (hex.diceNumber === 6 || hex.diceNumber === 8) ? '#ef4444' : '#0f172a';
      ctx.font = 'bold 16px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hex.diceNumber, x, y);
    }

    // Robber
    if (hex.hasRobber && GameAssets.robber.complete) {
      ctx.drawImage(GameAssets.robber, x - 20, y - 20, 40, 40);
    }
  }

  // 2. Draw Edges (Merchant Ships)
  for (const edge of gs.grid.edges) {
    if (edge.road) {
      const p = gs.players.find(pl => pl.id === edge.road.playerId);
      
      // Select the right merchant ship asset based on player color/index
      let shipImg = GameAssets.merchant_blue;
      if (p) {
        if (p.color.includes('EF4444')) shipImg = GameAssets.merchant_red;
        else if (p.color.includes('22C55E')) shipImg = GameAssets.merchant_green;
        else if (p.color.includes('A855F7')) shipImg = GameAssets.merchant_purple;
      }
      
      if (shipImg && shipImg.complete) {
        const dx = edge.v2.x - edge.v1.x;
        const dy = edge.v2.y - edge.v1.y;
        const angle = Math.atan2(dy, dx);
        const midX = (edge.v1.x + edge.v2.x) / 2;
        const midY = (edge.v1.y + edge.v2.y) / 2;
        
        ctx.save();
        ctx.translate(midX, midY);
        // Add 90 degrees (Math.PI / 2) because ship assets usually point upwards
        ctx.rotate(angle + Math.PI / 2);
        const shipWidth = 32;
        const shipHeight = 48;
        ctx.drawImage(shipImg, -shipWidth / 2, -shipHeight / 2, shipWidth, shipHeight);
        ctx.restore();
      } else {
        // Fallback to line
        ctx.lineWidth = 6;
        ctx.strokeStyle = p ? p.color : '#fff';
        ctx.beginPath();
        ctx.moveTo(edge.v1.x, edge.v1.y);
        ctx.lineTo(edge.v2.x, edge.v2.y);
        ctx.stroke();
      }
    }
  }

  // 3. Draw Vertices (Buildings)
  for (const v of gs.grid.vertices) {
    if (v.building) {
      const p = gs.players.find(pl => pl.id === v.building.playerId);
      const img = v.building.type === 'city' ? GameAssets.city_blue : GameAssets.village_blue;
      
      if (img && img.complete) {
        // Draw building
        const s = v.building.type === 'city' ? 48 : 36;
        ctx.drawImage(img, v.x - s/2, v.y - s/2, s, s);
        
        // Draw player color circle underneath to identify owner
        if (p) {
          ctx.beginPath();
          ctx.arc(v.x, v.y + 10, 8, 0, Math.PI*2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    } else if (state.selectedAction === 'BUILD_VILLAGE') {
      // Highlight empty vertices if building a village
      ctx.beginPath();
      ctx.arc(v.x, v.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
    }
  }

  ctx.restore();
  updateHUD(gs);
}

function getHexPixel(q, r) {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r
  };
}

// ─── CLICK HANDLING ────────────────────────────────────────
function handleCanvasClick(px, py) {
  if (!state.gameState || !state.selectedAction) return;

  // Find nearest vertex (for villages/cities)
  let nearestVertex = null;
  let minDistV = 20; // 20px snap distance

  for (const v of state.gameState.grid.vertices) {
    const dist = Math.hypot(px - v.x, py - v.y);
    if (dist < minDistV) {
      minDistV = dist;
      nearestVertex = v.id;
    }
  }

  // Find nearest edge (for roads)
  let nearestEdge = null;
  let minDistE = 15;

  for (const e of state.gameState.grid.edges) {
    // Distance from point to line segment
    const dist = distToSegment(
      {x: px, y: py},
      {x: e.v1.x, y: e.v1.y},
      {x: e.v2.x, y: e.v2.y}
    );
    if (dist < minDistE) {
      minDistE = dist;
      nearestEdge = e.id;
    }
  }

  // Send command based on action
  if (state.selectedAction === 'BUILD_VILLAGE' && nearestVertex) {
    state.socket.emit('game:command', { type: 'PLACE_VILLAGE', vertexId: nearestVertex });
  } 
  else if (state.selectedAction === 'BUILD_ROAD' && nearestEdge) {
    state.socket.emit('game:command', { type: 'PLACE_ROAD', edgeId: nearestEdge });
  }
  else if (state.selectedAction === 'UPGRADE_CITY' && nearestVertex) {
    state.socket.emit('game:command', { type: 'UPGRADE_CITY', vertexId: nearestVertex });
  }

  // Deselect after click
  state.selectedAction = null;
  $$('.action-btn').forEach(b => b.classList.remove('active'));
  renderGameState(state.gameState);
}

// Math util for line segment distance
function distToSegment(p, v, w) {
  const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

// ─── HUD & UI ──────────────────────────────────────────────
function updateHUD(gs) {
  const me = gs.players.find(p => p.id === state.user?.id);
  if (me) {
    $('#res-wood .res-val').textContent = me.resources.wood || 0;
    $('#res-stone .res-val').textContent = me.resources.stone || 0;
    $('#res-iron .res-val').textContent = me.resources.iron || 0;
    $('#res-gold .res-val').textContent = me.resources.gold || 0;
    $('#res-food .res-val').textContent = me.resources.food || 0;
  }

  $('#status-phase').textContent = `${gs.phase.toUpperCase()} PHASE`;
  
  const currentPlayer = gs.players.find(p => p.id === gs.currentPlayerId);
  $('#status-turn').textContent = currentPlayer ? `${currentPlayer.login}'s Turn` : '';

  $('#hud-players').innerHTML = gs.players.map(p => `
    <div class="hud-player" style="border-color:${p.color}">
      <span>${p.login} (${p.victoryPoints} VP)</span>
    </div>`).join('');
}

function updateUIControls(gs) {
  const isMyTurn = gs.currentPlayerId === state.user.id;
  $('#hud-actions').style.display = 'flex';
  
  const rollBtn = $('#btn-roll-dice');
  const buildBtns = [$('#btn-build-road'), $('#btn-build-village'), $('#btn-upgrade-city')];
  const endBtn = $('#btn-end-turn');

  if (!isMyTurn) {
    rollBtn.style.display = 'none';
    buildBtns.forEach(b => b.style.opacity = '0.5');
    endBtn.style.display = 'none';
    return;
  }

  buildBtns.forEach(b => b.style.opacity = '1');

  if (gs.phase === 'roll') {
    rollBtn.style.display = 'flex';
    endBtn.style.display = 'none';
  } else if (gs.phase === 'build' || gs.phase === 'setup') {
    rollBtn.style.display = 'none';
    endBtn.style.display = 'flex';
  } else {
    rollBtn.style.display = 'none';
    endBtn.style.display = 'none';
  }
}

// ─── EVENTS ────────────────────────────────────────────────
function addEventLog(msg) {
  const log = $('#event-log');
  const div = document.createElement('div');
  div.className = 'event-item';
  div.textContent = msg;
  log.prepend(div);
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Map action buttons
  const actionBtns = {
    'btn-build-road': 'BUILD_ROAD',
    'btn-build-village': 'BUILD_VILLAGE',
    'btn-upgrade-city': 'UPGRADE_CITY',
  };

  Object.entries(actionBtns).forEach(([btnId, action]) => {
    const btn = $(`#${btnId}`);
    if (btn) {
      btn.addEventListener('click', () => {
        if (state.gameState?.currentPlayerId !== state.user.id) return;
        
        $$('.action-btn').forEach(b => b.classList.remove('active'));
        if (state.selectedAction === action) {
          state.selectedAction = null;
        } else {
          state.selectedAction = action;
          btn.classList.add('active');
        }
        if (state.gameState) renderGameState(state.gameState); // re-render to show highlights
      });
    }
  });

  // End turn & Roll
  $('#btn-roll-dice')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'ROLL_DICE' });
  });
  
  $('#btn-end-turn')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'END_TURN' });
    state.selectedAction = null;
    $$('.action-btn').forEach(b => b.classList.remove('active'));
  });

  // Login
  $('#btn-login')?.addEventListener('click', async () => {
    const loginName = $('#intra-login-input').value.trim();
    if (!loginName) return;
    try {
      const res = await fetch('/auth/42/direct-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginName })
      });
      const data = await res.json();
      if (data.success) await checkAuth();
    } catch (e) {}
  });

  // Room creation
  $('#btn-create-room')?.addEventListener('click', () => {
    $('#modal-create-room').classList.remove('hidden');
  });
  $('#btn-confirm-create')?.addEventListener('click', () => {
    const name = $('#input-room-name').value.trim() || 'Room';
    state.socket.emit('room:create', { name });
    $('#modal-create-room').classList.add('hidden');
  });
  $('#btn-cancel-create')?.addEventListener('click', () => $('#modal-create-room').classList.add('hidden'));
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
