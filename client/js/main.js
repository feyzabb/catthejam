/**
 * main.js — Client-side application bootstrap.
 * Handles screen management, Socket.IO events, lobby UI, and game canvas.
 */

// ─── STATE ─────────────────────────────────────────────────
const state = {
  user: null,
  currentRoom: null,
  gameState: null,
  selectedAction: null,
  commandQueue: [],
  socket: null,
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
  s.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message);
    if (err.message === 'Authentication required') showScreen('login');
  });

  // Player info
  s.on('player:info', ({ user }) => {
    state.user = user;
    updateUserBadge();
  });

  // Room list updates
  s.on('room:list', (rooms) => renderRoomList(rooms));

  // Room state updated
  s.on('room:updated', (room) => {
    state.currentRoom = room;
    updateRoomLobby(room);
  });

  // Game started!
  s.on('room:gameStart', ({ roomId, gameState }) => {
    console.log('[Game] Starting!', gameState);
    state.gameState = gameState;
    showScreen('game');
    renderGameState(gameState);
  });

  // Planning phase
  s.on('game:phaseStart', ({ phase, pulseNumber, timer }) => {
    if (state.gameState) {
      state.gameState.phase = phase;
      state.gameState.pulseNumber = pulseNumber;
      state.gameState.timeRemaining = timer;
    }
    state.commandQueue = [];
    updatePulseHUD(pulseNumber, timer);
    startTimerCountdown(timer);
  });

  // Pulse result
  s.on('game:pulseResult', (result) => {
    state.gameState = { ...state.gameState, ...result, phase: 'planning' };
    renderGameState(state.gameState);
    renderPulseEvents(result.events);
  });

  // Game ended
  s.on('game:ended', ({ placements }) => {
    showGameOverModal(placements);
  });

  // Errors
  s.on('error', ({ code, message }) => {
    console.error(`[Error] ${code}: ${message}`);
  });
}

// ─── ROOM LIST ─────────────────────────────────────────────
function renderRoomList(rooms) {
  const list = $('#room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="empty-state">No rooms available. Create one!</div>';
    return;
  }
  list.innerHTML = rooms.map(r => {
    const fullClass = r.playerCount >= r.maxPlayers ? 'full' : '';
    return `
      <div class="room-card" data-room-id="${r.id}">
        <div class="room-info">
          <h4>${escapeHtml(r.name)}</h4>
          <p>${r.players.map(p => p.login).join(', ') || 'Empty'}</p>
        </div>
        <span class="room-players-count ${fullClass}">${r.playerCount}/${r.maxPlayers}</span>
      </div>`;
  }).join('');

  // Click to join
  list.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      const roomId = card.dataset.roomId;
      state.socket.emit('room:join', { roomId });
    });
  });
}

// ─── ROOM LOBBY ────────────────────────────────────────────
function updateRoomLobby(room) {
  const panel = $('#panel-room-lobby');
  panel.classList.remove('hidden');
  $('#room-lobby-title').textContent = room.name;
  $('#room-status-text').textContent = `${room.playerCount}/${room.maxPlayers} players — ${room.playerCount < room.maxPlayers ? 'Waiting...' : 'Starting!'}`;

  // Update slots
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
          <div class="slot-coalition" style="color:${player.coalitionColor}">${player.coalitionName || ''}</div>
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
  canvas.height = window.innerHeight - 120;
  camera = { x: canvas.width / 2, y: canvas.height / 2, zoom: 1 };

  // Mouse drag for panning
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

  // Zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom = Math.max(0.3, Math.min(2, camera.zoom - e.deltaY * 0.001));
    if (state.gameState) renderGameState(state.gameState);
  });

  // Click to select hex
  canvas.addEventListener('click', (e) => {
    if (dragging) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left - camera.x) / camera.zoom;
    const py = (e.clientY - rect.top - camera.y) / camera.zoom;
    const hex = pixelToHex(px, py);
    handleHexClick(hex);
  });

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 120;
    if (state.gameState) renderGameState(state.gameState);
  });
}

// ─── HEX RENDERING ────────────────────────────────────────
const HEX_SIZE = 40;
const SQRT3 = Math.sqrt(3);

function hexToPixel(q, r) {
  const x = HEX_SIZE * SQRT3 * (q + r / 2);
  const y = HEX_SIZE * (3 / 2) * r;
  return { x, y };
}

function pixelToHex(px, py) {
  const q = (SQRT3 / 3 * px - 1 / 3 * py) / HEX_SIZE;
  const r = (2 / 3 * py) / HEX_SIZE;
  // Round
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const qd = Math.abs(rq - q), rd = Math.abs(rr - r), sd = Math.abs(rs - s);
  if (qd > rd && qd > sd) rq = -rr - rs;
  else if (rd > sd) rr = -rq - rs;
  return { q: rq, r: rr };
}

function drawHexImage(ctx, x, y, img, ownerColor) {
  if (!img || !img.complete) return;
  
  // Pointy-topped hex dimensions
  const width = SQRT3 * HEX_SIZE;
  const height = 2 * HEX_SIZE; 
  
  // Scale slightly to prevent tiny gaps between hexes
  const scale = 1.05; 
  
  ctx.drawImage(img, x - (width * scale) / 2, y - (height * scale) / 2, width * scale, height * scale);

  // We no longer draw the hex stroke border, giving it a pure island/asset look
}

function renderGameState(gs) {
  if (!ctx || !gs) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // Draw hexes
  for (const hex of gs.grid.hexes) {
    const { x, y } = hexToPixel(hex.q, hex.r);
    
    let img = GameAssets.sea;
    let ownerColor = null;

    if (hex.terrain === 'island') {
      img = GameAssets[hex.resourceType];
      if (hex.owner) ownerColor = getPlayerColor(hex.owner, gs.players, 1);
    } else if (hex.terrain === 'capital') {
      img = GameAssets.capital;
      if (hex.owner) ownerColor = getPlayerColor(hex.owner, gs.players, 1);
    } else {
      img = GameAssets.sea;
    }

    drawHexImage(ctx, x, y, img, ownerColor);

    // Draw Catan-style dice numbers for resources
    if (hex.terrain === 'island' && hex.diceNumber) {
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 14px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hex.diceNumber, x, y);
    }

    // Draw structures if any (villages/cities)
    if (hex.structure === 'village') {
      ctx.drawImage(GameAssets.village, x - 16, y - 24, 32, 32);
    } else if (hex.structure === 'city') {
      ctx.drawImage(GameAssets.city, x - 20, y - 28, 40, 40);
    }

    // Draw units
    if (hex.units && hex.units.length > 0) {
      const navies = hex.units.filter(u => u.type === 'navy');
      const merchants = hex.units.filter(u => u.type === 'merchant');
      if (navies.length > 0) {
        ctx.drawImage(GameAssets.navy, x - 16, y + 4, 32, 32);
        if (navies.length > 1) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 14px Outfit';
          ctx.textAlign = 'center';
          ctx.fillText(navies.length, x + 20, y + 16);
        }
      }
      if (merchants.length > 0) {
        ctx.drawImage(GameAssets.merchant, x + 8, y - 24, 24, 24);
      }
    }
  }

  ctx.restore();

  // Update HUD
  updateResourceHUD(gs);
  updatePlayersHUD(gs);
  updateCommandCount();
}

function getPlayerColor(playerId, players, alpha) {
  const p = players.find(pl => pl.id === playerId);
  if (!p) return `rgba(91,124,153,${alpha})`;
  const color = p.coalitionColor || '#5B7C99';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── HUD UPDATES ───────────────────────────────────────────
function updateResourceHUD(gs) {
  const me = gs.players.find(p => p.id === state.user?.id);
  if (!me) return;
  $('#res-wood .res-val').textContent = me.resources.wood;
  $('#res-stone .res-val').textContent = me.resources.stone;
  $('#res-iron .res-val').textContent = me.resources.iron;
  $('#res-gold .res-val').textContent = me.resources.gold;
}

function updatePlayersHUD(gs) {
  const hud = $('#hud-players');
  hud.innerHTML = gs.players.map(p => `
    <div class="hud-player" style="border-color:${p.coalitionColor}">
      <span>${p.login}</span>
    </div>`).join('');
}

function updatePulseHUD(pulseNumber, timer) {
  $('#pulse-number').textContent = pulseNumber;
  $('#pulse-timer').textContent = timer;
  $('#pulse-timer').classList.toggle('urgent', timer <= 5);
}

function updateCommandCount() {
  $('#queue-count').textContent = state.commandQueue.length;
}

let timerInterval;
function startTimerCountdown(seconds) {
  clearInterval(timerInterval);
  let t = seconds;
  updatePulseHUD(state.gameState?.pulseNumber || 1, t);
  timerInterval = setInterval(() => {
    t--;
    if (t < 0) { clearInterval(timerInterval); return; }
    updatePulseHUD(state.gameState?.pulseNumber || 1, t);
    if (t === 0) {
      // Send commands
      if (state.commandQueue.length > 0) {
        state.socket.emit('game:command', { commands: state.commandQueue });
      }
    }
  }, 1000);
}

// ─── HEX CLICK HANDLER ────────────────────────────────────
function handleHexClick(hexCoords) {
  if (!state.selectedAction || !state.gameState) return;
  const action = state.selectedAction;
  
  // Find the actual hex object from the game state to check its contents
  const hex = state.gameState.grid.hexes.find(h => h.q === hexCoords.q && h.r === hexCoords.r) || hexCoords;
  const me = state.user;

  if (action === 'BUILD_NAVY') {
    // Sadece başkentte üretilebilir
    const playerState = state.gameState.players.find(p => p.id === me.id);
    if (playerState && playerState.capitalHex.q === hex.q && playerState.capitalHex.r === hex.r) {
      state.commandQueue.push({ type: 'BUILD_NAVY', capitalHex: hexCoords });
      addEventLog(`Queued: Build Navy at Capital`);
    } else {
      addEventLog(`⚠️ Navies can only be built at your Capital`);
    }
  } else if (action === 'BUILD_VILLAGE') {
    state.commandQueue.push({ type: 'BUILD_VILLAGE', hex: hexCoords });
    addEventLog(`Queued: Build Village at (${hexCoords.q},${hexCoords.r})`);
  } else if (action === 'UPGRADE_CITY') {
    state.commandQueue.push({ type: 'UPGRADE_CITY', hex: hexCoords });
    addEventLog(`Queued: Upgrade City at (${hexCoords.q},${hexCoords.r})`);
  } else if (action === 'MOVE_NAVY') {
    if (!state.selectedNavyId) {
      // Step 1: Select a Navy
      const myNavy = hex.units?.find(u => u.type === 'navy' && u.playerId === me.id);
      if (myNavy) {
        state.selectedNavyId = myNavy.id;
        state.selectedHex = hexCoords;
        addEventLog(`Selected Navy at (${hexCoords.q},${hexCoords.r}). Click target.`);
      } else {
        addEventLog(`⚠️ No friendly Navy found here`);
      }
    } else {
      // Step 2: Select Target
      state.commandQueue.push({ type: 'MOVE_NAVY', navyId: state.selectedNavyId, targetHex: hexCoords });
      addEventLog(`Queued: Move Navy to (${hexCoords.q},${hexCoords.r})`);
      state.selectedNavyId = null;
      state.selectedHex = null;
      // İsteğe bağlı: Seçimi sıfırlayabiliriz
      // $$('.action-btn').forEach(b => b.classList.remove('active'));
      // state.selectedAction = null;
    }
  } else if (action === 'PLACE_MERCHANT') {
    if (!state.selectedHex) {
      // Step 1: Select first hex
      state.selectedHex = hexCoords;
      addEventLog(`Selected start for Trade Route. Click adjacent hex.`);
    } else {
      // Step 2: Select second hex
      state.commandQueue.push({ type: 'PLACE_MERCHANT', fromHex: state.selectedHex, toHex: hexCoords });
      addEventLog(`Queued: Trade Route (${state.selectedHex.q},${state.selectedHex.r}) → (${hexCoords.q},${hexCoords.r})`);
      state.selectedHex = null;
    }
  }

  updateCommandCount();
}

// ─── PULSE EVENTS LOG ──────────────────────────────────────
function addEventLog(message) {
  const log = $('#event-log');
  const div = document.createElement('div');
  div.className = 'event-item';
  div.textContent = message;
  log.prepend(div);
  while (log.children.length > 15) log.removeChild(log.lastChild);
}

function renderPulseEvents(events) {
  if (!events || !events.length) return;
  for (const ev of events.slice(-5)) {
    addEventLog(formatEvent(ev));
  }
}

function formatEvent(ev) {
  switch (ev.type) {
    case 'NAVY_MOVED': return `⛵ Navy moved to (${ev.to.q},${ev.to.r})`;
    case 'MERCHANT_PLACED': return `🚢 Trade route established`;
    case 'VILLAGE_BUILT': return `🏘️ Village built (${ev.resourceType})`;
    case 'CITY_UPGRADED': return `🏰 City upgraded!`;
    case 'NAVY_BUILT': return `⛵ New navy deployed`;
    case 'MERCHANT_DESTROYED': return `💥 Merchant ship destroyed!`;
    case 'VILLAGE_DESTROYED': return `💥 Village razed!`;
    case 'RESOURCE_PRODUCED': return `📦 +${ev.amount} ${ev.resourceType}`;
    default: return ev.type;
  }
}

// ─── GAME OVER MODAL ───────────────────────────────────────
function showGameOverModal(placements) {
  const modal = $('#modal-game-over');
  const list = $('#results-list');
  const medals = ['🥇', '🥈', '🥉', '4th'];

  list.innerHTML = placements.map((p, i) => {
    const sign = p.pointsChange >= 0 ? '+' : '';
    const cls = p.pointsChange >= 0 ? 'positive' : 'negative';
    return `
      <div class="result-row">
        <span class="result-placement">${medals[i]}</span>
        <span class="result-name" style="color:${p.coalitionColor}">${p.displayName || p.login}</span>
        <span class="result-score">${p.score} pts</span>
        <span class="result-points ${cls}">${sign}${p.pointsChange}</span>
      </div>`;
  }).join('');

  modal.classList.remove('hidden');
}

// ─── EVENT LISTENERS ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  // Update UI emojis to custom PNG assets
  if (typeof GameAssets !== 'undefined') {
    $('#res-wood .res-icon').innerHTML = `<img src="${GameAssets.icon_wood.src}" width="16" height="16" style="vertical-align: middle;">`;
    $('#res-stone .res-icon').innerHTML = `<img src="${GameAssets.icon_stone.src}" width="16" height="16" style="vertical-align: middle;">`;
    $('#res-iron .res-icon').innerHTML = `<img src="${GameAssets.icon_iron.src}" width="16" height="16" style="vertical-align: middle;">`;
    $('#res-gold .res-icon').innerHTML = `<img src="${GameAssets.icon_gold.src}" width="16" height="16" style="vertical-align: middle;">`;

    $('#btn-build-navy .action-icon').innerHTML = `<img src="${GameAssets.icon_build_navy.src}" width="24" height="24">`;
    $('#btn-place-merchant .action-icon').innerHTML = `<img src="${GameAssets.icon_place_merchant.src}" width="24" height="24">`;
    $('#btn-build-village .action-icon').innerHTML = `<img src="${GameAssets.icon_build_village.src}" width="24" height="24">`;
    $('#btn-upgrade-city .action-icon').innerHTML = `<img src="${GameAssets.icon_upgrade_city.src}" width="24" height="24">`;
  }

  // Direct Login Handler
  const loginBtn = $('#btn-login');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const loginName = $('#intra-login-input').value.trim();
      const errorDiv = $('#login-error');
      
      if (!loginName) {
        errorDiv.textContent = 'Please enter your 42 Intra login';
        errorDiv.style.display = 'block';
        return;
      }
      
      loginBtn.disabled = true;
      loginBtn.innerHTML = 'Connecting to 42...';
      errorDiv.style.display = 'none';

      try {
        const res = await fetch('/auth/42/direct-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: loginName })
        });
        const data = await res.json();
        
        if (data.success) {
          await checkAuth(); // Reload user state and switch to lobby
        } else {
          errorDiv.textContent = data.error || 'User not found in 42 Intra';
          errorDiv.style.display = 'block';
          loginBtn.disabled = false;
          loginBtn.innerHTML = 'Enter Game';
        }
      } catch (err) {
        errorDiv.textContent = 'Network error';
        errorDiv.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Enter Game';
      }
    });
  }

  // Create room modal
  $('#btn-create-room').addEventListener('click', () => {
    $('#modal-create-room').classList.remove('hidden');
    $('#input-room-name').focus();
  });
  $('#btn-cancel-create').addEventListener('click', () => {
    $('#modal-create-room').classList.add('hidden');
  });
  $('#btn-confirm-create').addEventListener('click', () => {
    const name = $('#input-room-name').value.trim() || `${state.user.login}'s Room`;
    state.socket.emit('room:create', { name });
    $('#modal-create-room').classList.add('hidden');
    $('#input-room-name').value = '';
  });

  // Leave room
  $('#btn-leave-room').addEventListener('click', () => {
    state.socket.emit('room:leave');
    state.currentRoom = null;
    $('#panel-room-lobby').classList.add('hidden');
  });

  // Back to lobby from game over
  $('#btn-back-lobby').addEventListener('click', () => {
    $('#modal-game-over').classList.add('hidden');
    showScreen('lobby');
    loadLeaderboard();
    state.socket.emit('room:leave');
  });

  // Action buttons
  const actionBtns = {
    'btn-build-navy': 'BUILD_NAVY',
    'btn-place-merchant': 'PLACE_MERCHANT',
    'btn-build-village': 'BUILD_VILLAGE',
    'btn-upgrade-city': 'UPGRADE_CITY',
  };
  Object.entries(actionBtns).forEach(([btnId, action]) => {
    $(`#${btnId}`).addEventListener('click', () => {
      $$('.action-btn').forEach(b => b.classList.remove('active'));
      if (state.selectedAction === action) {
        state.selectedAction = null;
      } else {
        state.selectedAction = action;
        $(`#${btnId}`).classList.add('active');
      }
    });
  });
});

// ─── UTILS ─────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
