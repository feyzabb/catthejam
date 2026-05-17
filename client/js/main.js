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
  state.socket = io({ transports: ['websocket'] });
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
    updateUIControls(gameState);
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

  // Explicit listeners requested by user architecture
  s.on('settlement_built', ({ nodeId, playerId, playerColor }) => {
    addEventLog(`🏠 Settlement built at ${nodeId}`);
    // State sync will naturally re-render the canvas with playerColor
  });

  s.on('road_built', ({ edgeId, playerId, playerColor }) => {
    addEventLog(`🛤️ Road built at ${edgeId}`);
    // State sync will naturally re-render the canvas with playerColor
  });

  s.on('dice_rolled', ({ dice1, dice2, total, currentTurn }) => {
    // Add logic handled in game:dice normally
    addEventLog(`🎲 ${dice1} and ${dice2} rolled (Total: ${total})`);
  });

  s.on('turn_changed', ({ nextPlayerId }) => {
    if (nextPlayerId === state.user.id) {
      addEventLog('👉 Your turn started!');
    }
  });

  s.on('resources_updated', (data) => {
    // 1. Log event
    const resString = data.gained.map(r => `+${r.amount} ${r.type}`).join(', ');
    addEventLog(`🌱 ${data.login} got ${resString}`);

    // 2. Anında UI Güncellemesi (Sayfa yenilemeden)
    if (data.playerId === state.user.id) {
      if ($('#res-wood .res-val')) $('#res-wood .res-val').textContent = data.playerResources.wood || 0;
      if ($('#res-stone .res-val')) $('#res-stone .res-val').textContent = data.playerResources.stone || 0;
      if ($('#res-iron .res-val')) $('#res-iron .res-val').textContent = data.playerResources.iron || 0;
      if ($('#res-gold .res-val')) $('#res-gold .res-val').textContent = data.playerResources.gold || 0;
      if ($('#res-food .res-val')) $('#res-food .res-val').textContent = data.playerResources.food || 0;
      
      // Flash effect (opsiyonel)
      const resContainer = $('#res-container') || $('.game-hud-top');
      if (resContainer) {
        resContainer.classList.add('flash');
        setTimeout(() => resContainer.classList.remove('flash'), 500);
      }
    }
  });

  s.on('game:dice', (data) => {
    const overlay = $('#dice-overlay');
    const d1 = $('#die1'), d2 = $('#die2');
    overlay.classList.remove('hidden');
    d1.classList.add('rolling'); d2.classList.add('rolling');
    d1.textContent = '?'; d2.textContent = '?';
    setTimeout(() => {
      d1.classList.remove('rolling'); d2.classList.remove('rolling');
      d1.textContent = data.dice[0]; d2.textContent = data.dice[1];
      $('#dice-total').textContent = `Total: ${data.total}`;
    }, 500);
    addEventLog(`🎲 Rolled a ${data.total}!`);
    setTimeout(() => overlay.classList.add('hidden'), 3500);
  });

  s.on('game:ended', ({ placements }) => {
    showGameOverModal(placements);
  });

  s.on('error', ({ code, message }) => {
    addEventLog(`❌ ${message}`);
  });

  // ─── TRADE SOCKET EVENTS ─────────────────────────────────
  s.on('trade_proposed', (data) => {
    // Don't show popup to the proposer
    if (data.proposerId === state.user.id) return;

    state._pendingTradeId = data.tradeId;
    const giveStr = Object.entries(data.give).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
    const receiveStr = Object.entries(data.receive).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
    $('#trade-offer-title').textContent = `${data.proposerLogin} takas teklif ediyor`;
    $('#trade-offer-details').textContent = `Veriyor: ${giveStr} — İstiyor: ${receiveStr}`;
    $('#trade-offer-popup').classList.remove('hidden');
    addEventLog(`🤝 ${data.proposerLogin} takas teklifinde bulundu!`);
  });

  s.on('trade_completed', (data) => {
    const giveStr = Object.entries(data.give).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
    const receiveStr = Object.entries(data.receive).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
    addEventLog(`✅ ${data.proposerLogin} ↔ ${data.responderLogin}: ${giveStr} <-> ${receiveStr}`);
    $('#trade-offer-popup').classList.add('hidden');
    $('#modal-trade').classList.add('hidden');
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
  const wrap = $('#canvas-wrap');

  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  // Delay to let flex layout settle
  requestAnimationFrame(() => {
    resizeCanvas();
    camera = { x: canvas.width / 2, y: canvas.height / 2.5, zoom: 1.0 };
    if (state.gameState) renderGameState(state.gameState);
  });

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
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left - camera.x) / camera.zoom;
    const py = (e.clientY - r.top - camera.y) / camera.zoom;
    handleCanvasClick(px, py);
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
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
      const w = SQRT3 * HEX_SIZE * 0.97; // Slightly reduced from 1.05 to create an aesthetic gap
      const h = 2 * HEX_SIZE * 0.97;
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
    }
  }

  // 4. Draw Highlights based on selected action or setup phase
  const action = state.selectedAction;
  const step = gs.setupStep;
  const isSetup = gs.phase === 'SETUP';
  
  if (action === 'BUILD_VILLAGE' || action === 'UPGRADE_CITY' || (isSetup && step === 'village')) {
    ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'; // Green glow
    ctx.shadowColor = '#22C55E';
    ctx.shadowBlur = 15;
    for (const v of gs.grid.vertices) {
      if (!v.building && (action !== 'UPGRADE_CITY')) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 10, 0, Math.PI*2);
        ctx.fill();
      } else if (action === 'UPGRADE_CITY' && v.building && v.building.type === 'village' && v.building.playerId === state.user?.id) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.6)'; // Blue glow for upgrade
        ctx.beginPath();
        ctx.arc(v.x, v.y, 15, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'; // Reset
      }
    }
    ctx.shadowBlur = 0;
  }

  if (action === 'BUILD_SHIP' || (isSetup && step === 'road')) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)'; // Blue glow
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 8;
    for (const edge of gs.grid.edges) {
      if (!edge.road) {
        ctx.beginPath();
        ctx.moveTo(edge.v1.x, edge.v1.y);
        ctx.lineTo(edge.v2.x, edge.v2.y);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }

  if (action === 'NAVY_ATTACK' || gs.phase === 'ROBBER') {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; // Red glow over hexes
    for (const hex of gs.grid.hexes) {
      if (!hex.hasRobber) {
        const { x, y } = getHexPixel(hex.q, hex.r);
        ctx.beginPath();
        ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI*2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
  updateHUD(gs);
  renderDOMSlots(gs);
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
  let minDistV = 35; // Increased hit detection range

  for (const v of state.gameState.grid.vertices) {
    const dist = Math.hypot(px - v.x, py - v.y);
    if (dist < minDistV) {
      minDistV = dist;
      nearestVertex = v.id;
    }
  }

  // Find nearest edge (for roads)
  let nearestEdge = null;
  let minDistE = 30; // Increased hit detection range

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

  // Find nearest hex (for navy attack / robber)
  let nearestHex = null;
  let minDistH = HEX_SIZE * 0.8;
  for (const h of state.gameState.grid.hexes) {
    const {x, y} = getHexPixel(h.q, h.r);
    const dist = Math.hypot(px - x, py - y);
    if (dist < minDistH) {
      minDistH = dist;
      nearestHex = h;
    }
  }

  // Send command based on action
  if (state.selectedAction === 'BUILD_VILLAGE' && nearestVertex) {
    state.socket.emit('build_settlement', { nodeId: nearestVertex });
  } 
  else if (state.selectedAction === 'BUILD_SHIP' && nearestEdge) {
    state.socket.emit('build_road', { edgeId: nearestEdge });
  }
  else if (state.selectedAction === 'UPGRADE_CITY' && nearestVertex) {
    state.socket.emit('game:command', { type: 'UPGRADE_CITY', vertexId: nearestVertex });
  }
  else if (state.selectedAction === 'NAVY_ATTACK' && nearestHex) {
    // If it's robber phase, move robber
    if (state.gameState.phase === 'ROBBER') {
      state.socket.emit('game:command', { type: 'MOVE_ROBBER', q: nearestHex.q, r: nearestHex.r });
    } else {
      // If buying a new navy attack
      state.socket.emit('game:command', { type: 'BUY_NAVY_ATTACK' });
      // We will place it when the phase shifts to robber automatically
    }
  }

  // Deselect after click (unless we just bought a navy attack and need to place it)
  if (state.selectedAction !== 'NAVY_ATTACK' || state.gameState.phase === 'ROBBER') {
    state.selectedAction = null;
    $$('.action-btn').forEach(b => b.classList.remove('active'));
  }
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

  $('#status-phase').textContent = `${gs.phase} PHASE`;
  const currentPlayer = gs.players.find(p => p.id === gs.currentPlayerId);
  $('#status-turn').textContent = currentPlayer ? `${currentPlayer.login}'s Turn` : '';

  // Styled player cards
  $('#hud-players').innerHTML = gs.players.map(p => {
    const isActive = p.id === gs.currentPlayerId;
    const totalCards = Object.values(p.resources).reduce((a,b) => a+b, 0);
    return `<div class="hud-player ${isActive ? 'active-turn' : ''}" style="border-color:${p.color}">
      <span class="p-name">${p.login}</span>
      <span class="p-vp">⭐${p.victoryPoints}</span>
      <span class="p-cards">🃏${totalCards}</span>
    </div>`;
  }).join('');

  // Turn timer
  if (gs.timeRemaining != null) {
    const maxTime = 60;
    const pct = Math.max(0, (gs.timeRemaining / maxTime) * 100);
    const bar = $('#turn-timer-bar');
    bar.style.width = pct + '%';
    bar.classList.toggle('warning', pct < 25);
  }

  // Build phase glow
  const wrap = $('#canvas-wrap');
  if (wrap) wrap.classList.toggle('build-glow', gs.phase === 'GAMEPLAY');
}

// ─── DOM SLOTS OVERLAY ──────────────────────────────────────
function renderDOMSlots(gs) {
  const wrap = $('#canvas-wrap');
  if (!wrap) return;

  let container = wrap.querySelector('.slots-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'slots-container';
    wrap.appendChild(container);
  }

  const isSetup = gs.phase === 'SETUP';
  const isMyTurn = gs.currentPlayerId === state.user?.id;
  const showNodes = state.selectedAction === 'BUILD_VILLAGE' || state.selectedAction === 'UPGRADE_CITY' || (isSetup && gs.setupStep === 'village');
  const showEdges = state.selectedAction === 'BUILD_SHIP' || (isSetup && gs.setupStep === 'road');

  // Use server-provided valid slot lists
  const validNodeSet = new Set(gs.validNodes || []);
  const validEdgeSet = new Set(gs.validEdges || []);

  // Vertices (Nodes)
  for (const v of gs.grid.vertices) {
    let slot = container.querySelector(`.node-slot[data-node-id="${v.id}"]`);
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'node-slot';
      slot.dataset.nodeId = v.id;
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        const curGs = state.gameState;
        const curSetup = curGs && curGs.phase === 'SETUP';
        if (state.selectedAction === 'BUILD_VILLAGE' || (curSetup && curGs.setupStep === 'village')) {
          state.socket.emit('build_settlement', { nodeId: v.id });
        } else if (state.selectedAction === 'UPGRADE_CITY') {
          state.socket.emit('game:command', { type: 'UPGRADE_CITY', vertexId: v.id });
        }
      });
      container.appendChild(slot);
    }
    
    slot.style.left = `${v.x * camera.zoom + camera.x}px`;
    slot.style.top = `${v.y * camera.zoom + camera.y}px`;
    
    if (v.building) {
      slot.classList.add('built');
      slot.classList.remove('visible');
      slot.style.pointerEvents = 'none';
    } else {
      slot.classList.remove('built');
      const isValid = isMyTurn && showNodes && validNodeSet.has(v.id);
      slot.classList.toggle('visible', isValid);
      slot.style.pointerEvents = isValid ? 'auto' : 'none';
    }
  }

  // Edges
  for (const e of gs.grid.edges) {
    let slot = container.querySelector(`.edge-slot[data-edge-id="${e.id}"]`);
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'edge-slot';
      slot.dataset.edgeId = e.id;
      slot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const curGs = state.gameState;
        const curSetup = curGs && curGs.phase === 'SETUP';
        if (state.selectedAction === 'BUILD_SHIP' || (curSetup && curGs.setupStep === 'road')) {
          state.socket.emit('build_road', { edgeId: e.id });
        }
      });
      container.appendChild(slot);
    }
    
    const midX = (e.v1.x + e.v2.x) / 2;
    const midY = (e.v1.y + e.v2.y) / 2;
    const dx = e.v2.x - e.v1.x;
    const dy = e.v2.y - e.v1.y;
    const angle = Math.atan2(dy, dx);
    const length = Math.hypot(dx, dy) * camera.zoom;
    
    slot.style.left = `${midX * camera.zoom + camera.x}px`;
    slot.style.top = `${midY * camera.zoom + camera.y}px`;
    slot.style.width = `${length}px`;
    slot.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    
    if (e.road) {
      slot.classList.add('built');
      slot.classList.remove('visible');
      slot.style.pointerEvents = 'none';
    } else {
      slot.classList.remove('built');
      const isValid = isMyTurn && showEdges && validEdgeSet.has(e.id);
      slot.classList.toggle('visible', isValid);
      slot.style.pointerEvents = isValid ? 'auto' : 'none';
    }
  }
}

function updateUIControls(gs) {
  const isMyTurn = gs.currentPlayerId === state.user.id;
  const panel = $('#action-panel');
  const rollBtn = $('#btn-roll-dice');
  const endBtn = $('#btn-end-turn');
  const allBtns = panel.querySelectorAll('.action-btn:not(.end-turn)');

  // Show action panel once game starts
  panel.classList.remove('hidden');

  if (!isMyTurn) {
    rollBtn.classList.add('hidden');
    allBtns.forEach(b => b.classList.add('disabled'));
    endBtn.classList.add('disabled');
    return;
  }

  allBtns.forEach(b => b.classList.remove('disabled'));
  endBtn.classList.remove('disabled');

  // Auto-select for setup phase
  if (gs.phase === 'SETUP') {
    if (gs.setupStep === 'village' && state.selectedAction !== 'BUILD_VILLAGE') {
      state.selectedAction = 'BUILD_VILLAGE';
      $$('.action-btn').forEach(b => b.classList.remove('active'));
      $('#btn-build-village').classList.add('active');
    } else if (gs.setupStep === 'road' && state.selectedAction !== 'BUILD_SHIP') {
      state.selectedAction = 'BUILD_SHIP';
      $$('.action-btn').forEach(b => b.classList.remove('active'));
      $('#btn-build-ship').classList.add('active');
    }
  }

  if (gs.phase === 'ROLL') {
    rollBtn.classList.remove('hidden');
    endBtn.classList.add('hidden');
  } else if (gs.phase === 'GAMEPLAY' || gs.phase === 'SETUP' || gs.phase === 'ROBBER') {
    rollBtn.classList.add('hidden');
    endBtn.classList.remove('hidden');
  } else {
    rollBtn.classList.add('hidden');
    endBtn.classList.add('hidden');
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
    'btn-build-ship': 'BUILD_SHIP',
    'btn-build-village': 'BUILD_VILLAGE',
    'btn-upgrade-city': 'UPGRADE_CITY',
    'btn-navy-attack': 'NAVY_ATTACK',
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
        if (state.gameState) renderGameState(state.gameState);
      });
    }
  });

  // Roll dice
  $('#btn-roll-dice')?.addEventListener('click', () => {
    state.socket.emit('roll_dice');
  });

  // End turn
  $('#btn-end-turn')?.addEventListener('click', () => {
    state.socket.emit('end_turn');
    state.selectedAction = null;
    $$('.action-btn').forEach(b => b.classList.remove('active'));
  });

  // Trade modal
  $('#btn-trade')?.addEventListener('click', () => {
    if (state.gameState?.currentPlayerId !== state.user.id) return;
    $('#modal-trade').classList.remove('hidden');
  });
  $('#btn-trade-cancel')?.addEventListener('click', () => {
    $('#modal-trade').classList.add('hidden');
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

  // ─── Trade Tab Switching ────────────────────────────────
  $$('.trade-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.trade-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.trade-tab-content').forEach(c => c.classList.remove('active'));
      $(`#trade-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ─── P2P Trade +/- Buttons ─────────────────────────────
  ['p2p-give', 'p2p-receive'].forEach(containerId => {
    const container = $(`#${containerId}`);
    if (!container) return;
    container.querySelectorAll('.res-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const countEl = btn.parentElement.querySelector('.res-count');
        countEl.textContent = parseInt(countEl.textContent) + 1;
      });
    });
    container.querySelectorAll('.res-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const countEl = btn.parentElement.querySelector('.res-count');
        const val = parseInt(countEl.textContent);
        if (val > 0) countEl.textContent = val - 1;
      });
    });
  });

  // ─── P2P Trade Send ────────────────────────────────────
  $('#btn-p2p-send')?.addEventListener('click', () => {
    const give = {};
    const receive = {};
    $('#p2p-give').querySelectorAll('.trade-res-row').forEach(row => {
      const count = parseInt(row.querySelector('.res-count').textContent);
      if (count > 0) give[row.dataset.res] = count;
    });
    $('#p2p-receive').querySelectorAll('.trade-res-row').forEach(row => {
      const count = parseInt(row.querySelector('.res-count').textContent);
      if (count > 0) receive[row.dataset.res] = count;
    });
    if (Object.keys(give).length === 0 || Object.keys(receive).length === 0) {
      addEventLog('❌ Takas için en az 1 kaynak ver ve 1 kaynak iste!');
      return;
    }
    state.socket.emit('propose_trade', { give, receive });
    $('#modal-trade').classList.add('hidden');
    // Reset counts
    $$('#p2p-give .res-count, #p2p-receive .res-count').forEach(el => el.textContent = '0');
    addEventLog('📤 Takas teklifiniz gönderildi!');
  });

  $('#btn-p2p-cancel')?.addEventListener('click', () => {
    $('#modal-trade').classList.add('hidden');
  });

  // ─── Incoming Trade Response ────────────────────────────
  $('#btn-accept-trade')?.addEventListener('click', () => {
    if (state._pendingTradeId) {
      state.socket.emit('trade_response', { tradeId: state._pendingTradeId, accept: true });
      state._pendingTradeId = null;
    }
    $('#trade-offer-popup').classList.add('hidden');
  });

  $('#btn-reject-trade')?.addEventListener('click', () => {
    if (state._pendingTradeId) {
      state.socket.emit('trade_response', { tradeId: state._pendingTradeId, accept: false });
      state._pendingTradeId = null;
    }
    $('#trade-offer-popup').classList.add('hidden');
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
