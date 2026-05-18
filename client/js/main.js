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
  privateShields: [], // array of hexKeys
};

// ─── RESOURCE CONSTANTS ────────────────────────────────────────
/** Canonical 5 resource types — must match server RESOURCE_TYPES */
const RESOURCE_TYPES = ['wood', 'stone', 'iron', 'gold', 'food'];
const RESOURCE_EMOJI = { wood: '🪵', stone: '🪨', iron: '⛏️', gold: '🪙', food: '🍞' };
const RESOURCE_LABEL = { wood: 'WOOD', stone: 'STONE', iron: 'IRON', gold: 'GOLD', food: 'FOOD' };

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
    const res = await fetch('/auth/42/me?t=' + Date.now());
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

  s.on('game:privateState', (data) => {
    if (data && data.activeShields) {
      state.privateShields = data.activeShields;
      if (state.gameState) renderGameState(state.gameState);
    }
  });

  s.on('shield_blocked', (data) => {
    addEventLog(`🛡️ Kalkan, saldırıyı engelledi!`);
    
    // Create a visual popup animation
    const popup = document.createElement('div');
    popup.innerHTML = `
      <div style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); 
                  background:rgba(15, 23, 42, 0.95); color:#fff; padding:40px; border-radius:16px;
                  border: 3px solid #38bdf8; text-align:center; z-index:10000;
                  box-shadow: 0 0 50px rgba(56, 189, 248, 0.6), inset 0 0 20px rgba(56, 189, 248, 0.4);
                  animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        <div style="font-size:72px; margin-bottom:15px; text-shadow: 0 0 20px rgba(255,255,255,0.5);">🛡️💥</div>
        <h2 style="color:#38bdf8; margin:0 0 15px 0; font-family:'Outfit',sans-serif; font-size:32px; letter-spacing:1px; text-transform:uppercase;">Saldırı Savuşturuldu!</h2>
        <p style="font-size:18px; margin:0; color:#cbd5e1; line-height:1.5;">Hedef gemi kalkan ile korunuyormuş.<br>Kalkan kırıldı ve saldırı boşa gitti!</p>
      </div>
    `;
    
    // Add keyframes if not exists
    if (!document.getElementById('shield-keyframes')) {
      const style = document.createElement('style');
      style.id = 'shield-keyframes';
      style.textContent = `
        @keyframes popIn {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(popup);
    
    // Auto remove
    setTimeout(() => {
      const inner = popup.firstElementChild;
      if (inner) {
        inner.style.transition = 'all 0.5s ease';
        inner.style.opacity = '0';
        inner.style.transform = 'translate(-50%, -50%) scale(0.8)';
      }
      setTimeout(() => popup.remove(), 500);
    }, 4000);
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
    if (data.gained && data.gained.length > 0) {
      const resString = data.gained.map(r => `+${r.amount} ${RESOURCE_EMOJI[r.type] || r.type}`).join(', ');
      addEventLog(`🌱 ${data.login} got ${resString}`);
    }
    if (data.lost && data.lost.length > 0) {
      const lostStr = data.lost.map(r => `-${r.amount} ${RESOURCE_EMOJI[r.type] || r.type}`).join(', ');
      if (data.playerId === state.user?.id) addEventLog(`🏦 Bankaya verdi: ${lostStr}`);
    }

    // 2. Instant UI update for own player (no page reload)
    if (data.playerId === state.user?.id && data.playerResources) {
      updateResourceBars(data.playerResources);
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

      if (data.total === 7) {
        addEventLog('⚡ Fırtına koptu! Hırsız geliyor...');

        // ── 1. Lightning flashes ──────────────────────────────
        const flash = document.createElement('div');
        flash.style.cssText = `
          position:fixed;inset:0;
          background:#fff;opacity:0;z-index:9000;
          pointer-events:none;transition:opacity 0.08s ease;
        `;
        document.body.appendChild(flash);
        const flashes = [
          [80,  0.9], [160, 0],
          [320, 0.7], [440, 0],
          [600, 1.0], [750, 0],
        ];
        flashes.forEach(([ms, op]) => setTimeout(() => flash.style.opacity = op, ms));
        setTimeout(() => flash.remove(), 900);

        // ── 2. Full-screen storm overlay ─────────────────────
        const storm = document.createElement('div');
        storm.id = 'storm-overlay';
        storm.style.cssText = `
          position:fixed;inset:0;z-index:8500;
          display:flex;flex-direction:column;
          align-items:center;justify-content:center;
          background:radial-gradient(ellipse at center, rgba(30,0,60,0.97) 0%, rgba(0,0,0,0.98) 100%);
          backdrop-filter:blur(6px);
          animation:stormIn 0.3s ease forwards;
          font-family:'Outfit','Inter',sans-serif;
          color:#fff;text-align:center;padding:2rem;
        `;

        // Inject keyframe once
        if (!document.getElementById('storm-style')) {
          const s = document.createElement('style');
          s.id = 'storm-style';
          s.textContent = `
            @keyframes stormIn  { from{opacity:0;transform:scale(1.04)} to{opacity:1;transform:scale(1)} }
            @keyframes stormOut { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(0.96)} }
            @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
            @keyframes pulse7 { 0%,100%{text-shadow:0 0 20px #a855f7,0 0 60px #7c3aed} 50%{text-shadow:0 0 40px #f59e0b,0 0 100px #d97706} }
            @keyframes fadeUpIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          `;
          document.head.appendChild(s);
        }

        const discardList = data.discardList || [];
        const needsDiscard = discardList.length > 0;

        let discardHTML = '';
        if (needsDiscard) {
          discardHTML = `
            <div style="margin-top:1.2rem;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);
                        border-radius:12px;padding:1rem 1.5rem;animation:fadeUpIn 0.4s 0.4s ease both;">
              <p style="font-size:0.8rem;font-weight:700;color:#f87171;letter-spacing:1px;
                         text-transform:uppercase;margin:0 0 0.6rem;">🃏 Kart Feda Etmesi Gerekenler</p>
              ${discardList.map(d => `
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;
                             font-size:0.95rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                  <span style="color:#fbbf24;font-weight:700;">${d.login}</span>
                  <span style="color:#94a3b8;">→</span>
                  <span style="color:#f87171;font-weight:700;">${d.amount} kart feda edecek</span>
                </div>
              `).join('')}
            </div>`;
        }

        storm.innerHTML = `
          <div style="font-size:4.5rem;animation:shake 0.5s 0.2s ease;">⚡</div>
          <h2 style="font-size:2.8rem;font-weight:900;margin:0.4rem 0 0;
                     animation:pulse7 1.5s ease infinite;letter-spacing:2px;">ZAR 7!</h2>
          <p style="font-size:1.15rem;color:#c4b5fd;margin:0.5rem 0 0;
                    animation:fadeUpIn 0.4s 0.2s ease both;">
            ${needsDiscard ? 'Fırtına koptu! Elinde 7\'den fazla kart olanlar feda etmeli.' : 'Fırtına koptu! Hırsız figürünü taşı.'}
          </p>
          ${discardHTML}
          <p style="margin-top:1.5rem;font-size:0.78rem;color:#475569;
                    animation:fadeUpIn 0.4s 0.8s ease both;">
            ${needsDiscard ? 'Oyun kart feda işlemi tamamlanınca devam edecek...' : 'Hırsızı yeni bir karonun üzerine taşı...'}
          </p>
        `;
        document.body.appendChild(storm);

        // Auto-dismiss after 2.8s → stateUpdate discard modal takes over
        setTimeout(() => {
          storm.style.animation = 'stormOut 0.4s ease forwards';
          setTimeout(() => storm.remove(), 400);
        }, 2800);

      } else {
        addEventLog(`🎲 Rolled a ${data.total}!`);
      }
    }, 500);

    // Hide dice overlay (7→ keep longer for drama, others 2.5s)
    setTimeout(() => overlay.classList.add('hidden'), data.total === 7 ? 4000 : 2500);
  });

  s.on('game:ended', ({ placements }) => {
    showGameOverModal(placements);
  });

  s.on('error', ({ code, message }) => {
    addEventLog(`❌ ${message}`);
  });

  // ─── TRADE SOCKET EVENTS ─────────────────────────────────
  s.on('trade_proposed', (data) => {
    if (data.proposerId === state.user?.id) {
      // Proposer's own confirmation — show response tracker
      state._activeProposerTradeId = data.tradeId;
      const list = $('#proposer-responses-list');
      if (list) list.innerHTML = '';
      $('#proposer-responses-section')?.classList.remove('hidden');
      const sendBtn = $('#btn-p2p-send');
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Teklif Bekleniyor...'; }

      const giveStr = Object.entries(data.give).filter(([,v]) => v > 0)
        .map(([k,v]) => `${v}${RESOURCE_EMOJI[k]}`).join(' + ');
      const recStr  = Object.entries(data.receive).filter(([,v]) => v > 0)
        .map(([k,v]) => `${v}${RESOURCE_EMOJI[k]}`).join(' + ');
      addEventLog(`📤 Teklifiniz yayınlandı: ${giveStr} → ${recStr}`);
      return;
    }

    // Show incoming offer popup to other players
    state._pendingTradeId = data.tradeId;
    const giveStr = Object.entries(data.give).filter(([,v]) => v > 0)
      .map(([k,v]) => `${v} ${RESOURCE_EMOJI[k]} ${RESOURCE_LABEL[k]}`).join(', ');
    const receiveStr = Object.entries(data.receive).filter(([,v]) => v > 0)
      .map(([k,v]) => `${v} ${RESOURCE_EMOJI[k]} ${RESOURCE_LABEL[k]}`).join(', ');
    $('#trade-offer-title').textContent = `${data.proposerLogin} takas teklif ediyor`;
    $('#trade-offer-details').textContent = `Veriyor: ${giveStr} — İstiyor: ${receiveStr}`;
    $('#trade-offer-popup').classList.remove('hidden');
    $('#trade-offer-main-actions').classList.remove('hidden');
    $('#counter-offer-section').classList.add('hidden');
    addEventLog(`🤝 ${data.proposerLogin} takas teklifinde bulundu!`);
  });

  s.on('trade_response_update', (data) => {
    // Only the proposer cares about this
    if (state._activeProposerTradeId === data.tradeId) {
      const list = $('#proposer-responses-list');
      const existing = list.querySelector(`.response-item[data-id="${data.responderId}"]`);
      if (existing) existing.remove();

      const el = document.createElement('div');
      el.className = 'response-item';
      el.dataset.id = data.responderId;
      el.style.cssText = 'background:rgba(255,255,255,0.05); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px; border:1px solid rgba(255,255,255,0.08);';

      let text = '';
      if (data.type === 'REJECT') {
        text = `<span style="color:var(--accent-red)">❌ ${data.responderLogin} reddetti</span>`;
      } else if (data.type === 'ACCEPT') {
        text = `<span style="color:var(--accent-green)">✅ ${data.responderLogin} kabul etti!</span>`;
      } else if (data.type === 'COUNTER') {
        const cGive = Object.entries(data.give || {}).filter(([,v]) => v > 0)
          .map(([k,v]) => `${v}${RESOURCE_EMOJI[k] || k}`).join('+');
        const cRec = Object.entries(data.receive || {}).filter(([,v]) => v > 0)
          .map(([k,v]) => `${v}${RESOURCE_EMOJI[k] || k}`).join('+');
        text = `<span style="color:var(--accent-orange);font-size:0.82rem;">🔄 ${data.responderLogin}: Verir&nbsp;<b>${cGive}</b>, İster&nbsp;<b>${cRec}</b></span>`;
      }

      const textDiv = document.createElement('div');
      textDiv.innerHTML = text;
      el.appendChild(textDiv);
      
      if (data.type !== 'REJECT') {
        const btn = document.createElement('button');
        btn.className = 'btn-modal btn-confirm';
        btn.style.cssText = 'padding:5px 12px; font-size:0.78rem; flex-shrink:0;';
        btn.textContent = '✔ Onayla';
        btn.onclick = () => {
          state.socket.emit('accept_trade_response', { tradeId: data.tradeId, responderId: data.responderId });
        };
        el.appendChild(btn);
      }

      list.appendChild(el);
    }
  });

  s.on('trade_completed', (data) => {
    const giveStr = Object.entries(data.give).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${RESOURCE_EMOJI[k] || k.toUpperCase()}`).join(', ');
    const receiveStr = Object.entries(data.receive).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${RESOURCE_EMOJI[k] || k.toUpperCase()}`).join(', ');
    addEventLog(`✅ ${data.proposerLogin} ↔ ${data.responderLogin}: ${giveStr} ↔ ${receiveStr}`);
    _resetTradeUI();
  });

  s.on('trade_cancelled', (data) => {
    addEventLog(`❌ Takas iptal edildi.`);
    _resetTradeUI();
  });

  // Fired when ALL non-proposer players have responded — proposer can now finalize
  s.on('trade_all_responded', (data) => {
    if (state._activeProposerTradeId === data.tradeId) {
      const headerEl = $('#proposer-responses-list')?.previousElementSibling;
      if (headerEl) headerEl.textContent = 'Tüm Yanıtlar Geldi — Birini Seç!';
      addEventLog('✅ Tüm oyuncular yanıt verdi. Bir teklifi onaylayabilirsiniz.');
    }
  });

  // Fired back to proposer to confirm trade was registered on server
  s.on('trade_proposal_sent', (data) => {
    state._activeProposerTradeId = data.tradeId;
  });

  // Bank trade result for instant UI feedback
  s.on('bank_trade_result', (data) => {
    if (data.playerId === state.user?.id) {
      updateResourceBars(data.playerResources);
      addEventLog(`🏦 Banka: ${data.giveAmount}x ${RESOURCE_EMOJI[data.giveType]} → 1x ${RESOURCE_EMOJI[data.receiveType]}`);
      // Flash the resource bar
      const bar = document.getElementById(`res-${data.receiveType}`);
      if (bar) { bar.classList.add('flash'); setTimeout(() => bar.classList.remove('flash'), 600); }
      // Close trade modal
      $('#modal-trade')?.classList.add('hidden');
    } else {
      addEventLog(`🏦 ${data.login}: Banka takası ${data.giveAmount}x ${RESOURCE_EMOJI[data.giveType]} → 1x ${RESOURCE_EMOJI[data.receiveType]}`);
    }
  });

  function _resetTradeUI() {
    $('#trade-offer-popup')?.classList.add('hidden');
    $('#modal-trade')?.classList.add('hidden');
    $('#proposer-responses-section')?.classList.add('hidden');
    const list = $('#proposer-responses-list');
    if (list) list.innerHTML = '';
    const sendBtn = $('#btn-p2p-send');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Teklif Gönder';
    }
    // Reset proposer header
    const header = document.querySelector('#proposer-responses-section h4');
    if (header) header.textContent = 'Gelen Yanıtlar (Bekleniyor...)';
    state._activeProposerTradeId = null;
    state._pendingTradeId = null;
    // Reset all pickers to 0
    $$('#p2p-give .res-count, #p2p-receive .res-count, #counter-give .res-count, #counter-receive .res-count')
      .forEach(el => el.textContent = '0');
  }

  // Helper: update the top resource bars from a resources object
  function updateResourceBars(resources) {
    if (!resources) return;
    const resVal = (id) => document.querySelector(`#res-${id} .res-val`);
    const wood   = resVal('wood');   if (wood)  wood.textContent  = resources.wood  || 0;
    const stone  = resVal('stone');  if (stone) stone.textContent = resources.stone || 0;
    const iron   = resVal('iron');   if (iron)  iron.textContent  = resources.iron  || 0;
    const gold   = resVal('gold');   if (gold)  gold.textContent  = resources.gold  || 0;
    const food   = resVal('food');   if (food)  food.textContent  = resources.food  || 0;
    // Animate the whole bar container
    const bar = document.getElementById('hud-resources');
    if (bar) { bar.classList.add('flash'); setTimeout(() => bar.classList.remove('flash'), 500); }
  }
} // end connectSocket()

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
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // keep logical coords unchanged
  }

  // Helper: re-center camera to canvas center (called on init and resize)
  function recenterCamera() {
    const cW = canvas.clientWidth;
    const cH = canvas.clientHeight;
    // Preserve zoom but always lock position to center
    if (camera) {
      camera.x = cW / 2;
      camera.y = cH / 2;
    } else {
      camera = { x: cW / 2, y: cH / 2, zoom: 1.0 };
    }
  }

  // Delay to let flex layout settle
  requestAnimationFrame(() => {
    resizeCanvas();
    recenterCamera();
    
    // Start continuous animation loop for dynamic water
    if (state.animationId) cancelAnimationFrame(state.animationId);
    function loop() {
      if (state.gameState && screens.game.classList.contains('active')) {
        renderGameState(state.gameState);
      }
      state.animationId = requestAnimationFrame(loop);
    }
    state.animationId = requestAnimationFrame(loop);
  });

  let dragging = false, isPan = false, lastX, lastY;
  
  canvas.addEventListener('mousedown', (e) => { 
    dragging = true; 
    isPan = false; 
    lastX = e.clientX; 
    lastY = e.clientY; 
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    
    // Yalnızca belirgin bir hareket varsa kaydırma (pan) olarak işaretle
    if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2) {
      isPan = true;
    }
    
    camera.x += e.clientX - lastX;
    camera.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    
    // Haritanın tamamen ekran dışına kaymasını engelle
    const cW = canvas.clientWidth;
    const cH = canvas.clientHeight;
    camera.x = Math.max(-cW * 1.5, Math.min(cW * 1.5, camera.x));
    camera.y = Math.max(-cH * 1.5, Math.min(cH * 1.5, camera.y));
    
    if (state.gameState) renderGameState(state.gameState);
  });
  
  canvas.addEventListener('mouseup', () => {
    dragging = false;
    // Tıklamaların heemen çalışabilmesi için ufak bir gecikme
    setTimeout(() => { isPan = false; }, 50);
  });
  canvas.addEventListener('mouseleave', () => dragging = false);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mouseX = e.clientX - r.left;
    const mouseY = e.clientY - r.top;

    // Convert mouse physical position to world coordinates before zoom
    const worldX = (mouseX - camera.x) / camera.zoom;
    const worldY = (mouseY - camera.y) / camera.zoom;

    // Calculate new zoom level
    const newZoom = Math.max(0.5, Math.min(2.5, camera.zoom - e.deltaY * 0.001));

    // Update camera position so the world coordinate under the mouse stays exactly where it is
    camera.x = mouseX - worldX * newZoom;
    camera.y = mouseY - worldY * newZoom;
    camera.zoom = newZoom;

    if (state.gameState) renderGameState(state.gameState);
  });

  canvas.addEventListener('click', (e) => {
    if (isPan) return; // Sürükleme yapıldıysa tıklamayı iptal et
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left - camera.x) / camera.zoom;
    const py = (e.clientY - r.top - camera.y) / camera.zoom;
    handleCanvasClick(px, py);
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    recenterCamera(); // keep islands centered on resize too
    if (state.gameState) renderGameState(state.gameState);
  });
}

// ─── RENDERING ─────────────────────────────────────────────
const HEX_SIZE = 72;
const DRAW_HEX_SIZE = HEX_SIZE; // match draw size to layout size for crisp islands
const SQRT3 = Math.sqrt(3);

function renderGameState(gs) {
  if (!ctx || !gs) return;
  // Use logical (CSS) dimensions so clearRect works correctly with the DPR transform
  const logW = canvas.clientWidth  || canvas.width;
  const logH = canvas.clientHeight || canvas.height;
  ctx.clearRect(0, 0, logW, logH);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // 0. Draw Dynamic Water Plane (Procedural Ocean Waves & Caustics)
  const time = Date.now() * 0.001;
  
  // A. Deep backdrop radial gradient (Vibrant, high-fidelity marine blue)
  const deepGrad = ctx.createRadialGradient(0, 0, 100, 0, 0, 1500);
  deepGrad.addColorStop(0, '#1e477a'); // rich ocean teal-blue
  deepGrad.addColorStop(0.5, '#102647'); // deep dark blue
  deepGrad.addColorStop(1, '#071328'); // elegant black-blue abyss
  ctx.fillStyle = deepGrad;
  ctx.fillRect(-3000, -3000, 6000, 6000);

  // B. Draw Sea Background — full canvas coverage at native physical resolution
  if (GameAssets.deniz && GameAssets.deniz.complete) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // identity: draw in physical canvas pixels
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // canvas.width/height are the physical pixel dimensions (already DPR-scaled)
    ctx.drawImage(GameAssets.deniz, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    // ctx.restore() already brings back the camera transform (DPR + translate + scale)
    // No re-apply needed — doing so with wrong DPR scaling causes DOM slot misalignment
  } else {
    // Fallback gradient
    const deepGrad = ctx.createRadialGradient(0, 0, 100, 0, 0, 1500);
    deepGrad.addColorStop(0, '#1e477a');
    deepGrad.addColorStop(0.5, '#102647');
    deepGrad.addColorStop(1, '#071328');
    ctx.fillStyle = deepGrad;
    ctx.fillRect(-3000, -3000, 6000, 6000);
  }

  // C. Draw Shimmering Top-Down Sun Caustics (Refracting light networks on the sea)
  ctx.save();
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.08)'; // Soft sun-ray caustics
  ctx.lineWidth = 2.5;
  
  const step = 200; // Elegant spacing for uncluttered caustics
  for (let x = -2000; x <= 2000; x += step) {
    for (let y = -2000; y <= 2000; y += step) {
      const phase = (x * 0.003 + y * 0.005);
      const t = time * 0.6 + phase;
      
      const wx = x + Math.cos(t * 0.7) * 35;
      const wy = y + Math.sin(t * 0.5) * 35;
      
      // Dynamic, fluid refracting light ripples (top-down view, NO seagulls!)
      ctx.beginPath();
      ctx.moveTo(wx - 45, wy);
      ctx.bezierCurveTo(
        wx - 20, wy + Math.sin(t) * 15,
        wx + 20, wy - Math.cos(t * 0.8) * 15,
        wx + 45, wy
      );
      ctx.stroke();
    }
  }
  ctx.restore();

  // 1. Draw Hexes (Islands)
  for (const hex of gs.grid.hexes) {
    const { x, y } = getHexPixel(hex.q, hex.r);
    const img = GameAssets.getIslandTile(hex.resourceType);
    
    if (img && img.complete) {
      const w = SQRT3 * DRAW_HEX_SIZE * 1.05;
      const h = 2   * DRAW_HEX_SIZE * 1.05;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
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

    // Robber overlay: storm tile drawn ON TOP of the normal island tile
    if (hex.hasRobber) {
      // 1. Draw storm overlay covering the whole tile (semi-transparent)
      if (GameAssets.storm_overlay && GameAssets.storm_overlay.complete) {
        const w = SQRT3 * DRAW_HEX_SIZE * 1.05;
        const h = 2   * DRAW_HEX_SIZE * 1.05;
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.drawImage(GameAssets.storm_overlay, x - w/2, y - h/2, w, h);
        ctx.globalAlpha = 1.0;
        ctx.restore();
      }
      // 2. Draw robber icon on top
      if (GameAssets.robber && GameAssets.robber.complete) {
        ctx.drawImage(GameAssets.robber, x - 30, y - 30, 60, 60);
      }
    }
  }

  // 1.5 Draw active private shields (Only owner sees them)
  if (state.privateShields && state.privateShields.length > 0) {
    ctx.save();
    for (const hKey of state.privateShields) {
      const [qStr, rStr] = hKey.split(',');
      const q = parseInt(qStr, 10);
      const r = parseInt(rStr, 10);
      const { x, y } = getHexPixel(q, r);

      // Draw blue shield overlay on the hex
      ctx.beginPath();
      ctx.arc(x, y, HEX_SIZE * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)'; // Light blue
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.stroke();

      // Shield icon in the center
      ctx.font = '30px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔰', x, y + 15);
    }
    ctx.restore();
  }

  // 2. Draw Edges (Merchant Ships)
  for (const edge of gs.grid.edges) {
    if (edge.road) {
      const p = gs.players.find(pl => pl.id === edge.road.playerId);

      // Pick a base ship asset (all are white/neutral so we can tint)
      // Use blue as the universal base; we tint with composite below
      const shipImg = GameAssets.merchant_blue;

      const dx = edge.v2.x - edge.v1.x;
      const dy = edge.v2.y - edge.v1.y;
      const angle = Math.atan2(dy, dx);
      const midX = (edge.v1.x + edge.v2.x) / 2;
      const midY = (edge.v1.y + edge.v2.y) / 2;

      // Out-of-sync dynamic bobbing and rocking calculations
      const phaseOffset = (midX * 0.03 + midY * 0.04);
      const tBob = time * 2.2 + phaseOffset;
      const bobY = Math.sin(tBob) * 2.5;
      const rockAngle = Math.cos(tBob * 0.7) * 0.08;

      const shipWidth = 32;
      const shipHeight = 48;

      ctx.save();
      ctx.translate(midX, midY + bobY);
      ctx.rotate(angle + Math.PI / 2 + rockAngle);

      if (shipImg && shipImg.complete) {
        ctx.drawImage(shipImg, -shipWidth / 2, -shipHeight / 2, shipWidth, shipHeight);
        // Tint the ship with the player's coalition color using 'source-atop'
        if (p && p.color) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = p.color;
          ctx.fillRect(-shipWidth / 2, -shipHeight / 2, shipWidth, shipHeight);
          ctx.globalAlpha = 1.0;
          ctx.globalCompositeOperation = 'source-over';
        }
      } else {
        // Fallback: colored line
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 6;
        ctx.strokeStyle = p ? p.color : '#fff';
        ctx.beginPath();
        ctx.moveTo(-shipWidth / 2, 0);
        ctx.lineTo(shipWidth / 2, 0);
        ctx.stroke();
      }

      ctx.restore();
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
  const setupStep = gs.setupStep;
  const isSetup = gs.phase === 'SETUP';
  
  if (action === 'BUILD_VILLAGE' || action === 'UPGRADE_CITY' || (isSetup && setupStep === 'village')) {
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

  if (action === 'BUILD_SHIP' || (isSetup && setupStep === 'road')) {
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

  if (action === 'NAVY_ATTACK' || gs.phase === 'ROBBER' || gs.phase === 'SHIELD_TARGETING') {
    const isShieldTargeting = gs.phase === 'SHIELD_TARGETING';
    const validShieldSet = new Set(gs.validShieldTargets || []);
    
    for (const hex of gs.grid.hexes) {
      const hexKey = `${hex.q},${hex.r}`;
      
      if (isShieldTargeting) {
        if (validShieldSet.has(hexKey)) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.4)'; // Blue glow for valid shield target
          const { x, y } = getHexPixel(hex.q, hex.r);
          ctx.beginPath();
          ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI*2);
          ctx.fill();
        }
      } else {
        // Red glow for Robber or Navy
        if (!hex.hasRobber) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
          const { x, y } = getHexPixel(hex.q, hex.r);
          ctx.beginPath();
          ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI*2);
          ctx.fill();
        }
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
  if (!state.gameState) return;
  if (!state.selectedAction && state.gameState.phase !== 'ROBBER' && state.gameState.phase !== 'SHIELD_TARGETING') return;

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
  else if (state.gameState.phase === 'ROBBER' && nearestHex) {
    state.socket.emit('game:command', { type: 'MOVE_ROBBER', q: nearestHex.q, r: nearestHex.r });
  }
  else if (state.gameState.phase === 'SHIELD_TARGETING' && nearestHex) {
    const hexKey = `${nearestHex.q},${nearestHex.r}`;
    const validShieldSet = new Set(state.gameState.validShieldTargets || []);
    if (validShieldSet.has(hexKey)) {
      state.socket.emit('game:command', { type: 'APPLY_SHIELD', hexKey });
    }
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

  $('#status-phase').textContent = `${gs.phase} PHASE`;
  const currentPlayer = gs.players.find(p => p.id === gs.currentPlayerId);
  $('#status-turn').textContent = currentPlayer ? `${currentPlayer.login}'s Turn` : '';

  // Styled player cards with coalition info
  $('#hud-players').innerHTML = gs.players.map(p => {
    const isActive = p.id === gs.currentPlayerId;
    const isLongestRoad = p.id === gs.longestRoadPlayerId;
    const isLargestArmy = p.id === gs.largestArmyPlayerId;
    const isMe = p.id === state.user?.id;
    const totalCards = Object.values(p.resources).reduce((a,b) => a+b, 0);
    const armyText = p.knightsPlayed > 0 ? ` <span style="color:var(--accent-cyan); font-size:0.85rem;" title="Donanma Gücü">⚔️x${p.knightsPlayed}</span>` : '';
    const shieldText = p.unplayedShields > 0 ? ` <span style="color:var(--accent-green); font-size:0.85rem;" title="Aktif Kalkan (Envanterde)">🔰x${p.unplayedShields}</span>` : '';
    const coalitionName = p.coalitionName || '';
    const coalitionColor = p.coalitionColor || p.color || '#5B7C99';
    const discardNeeded = gs.discardState && gs.discardState[p.id];
    const discardBadge = discardNeeded ? `<span style="color:var(--accent-red);font-size:0.75rem;" title="Bu oyuncu kart feda etmeli!"> ⚠️-${discardNeeded}</span>` : '';
    const meBorder = isMe ? `box-shadow: 0 0 0 2px ${coalitionColor}, 0 0 10px ${coalitionColor}55;` : '';

    return `<div class="hud-player ${isActive ? 'active-turn' : ''}" style="border-color:${coalitionColor}; ${meBorder}">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${coalitionColor};flex-shrink:0;"></span>
        <span class="p-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.login}${isMe ? ' <span style="opacity:0.6;font-size:0.7rem;">(Sen)</span>' : ''}${armyText}${shieldText}${discardBadge}</span>
        <span class="p-vp">⭐${p.victoryPoints}${isLongestRoad ? ' 🛤️' : ''}${isLargestArmy ? ' 🏆' : ''}</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        ${coalitionName ? `<span style="font-size:0.6rem;font-weight:700;color:${coalitionColor};letter-spacing:0.5px;opacity:0.9;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;">${coalitionName}</span>` : '<span></span>'}
        <span class="p-cards">🃏${totalCards}</span>
      </div>
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
  const validNavySet = new Set(gs.validNavyTargets || []);
  const isNavyTargeting = gs.phase === 'NAVY_TARGETING';

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
        } else if (curGs && curGs.phase === 'NAVY_TARGETING') {
          state.socket.emit('game:command', { type: 'EXECUTE_NAVY_ATTACK', edgeId: e.id });
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
      if (isMyTurn && isNavyTargeting && validNavySet.has(e.id)) {
        slot.classList.remove('built');
        slot.classList.add('visible', 'navy-target');
        slot.style.pointerEvents = 'auto';
      } else {
        slot.classList.add('built');
        slot.classList.remove('visible', 'navy-target');
        slot.style.pointerEvents = 'none';
      }
    } else {
      slot.classList.remove('built', 'navy-target');
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

    // Make sure discard modal shows for non-active players if they need to discard
    if (gs.phase === 'DISCARD') {
      if (gs.discardState && gs.discardState[state.user.id]) {
        const required = gs.discardState[state.user.id];
        $('#discard-target-text').textContent = `Atman Gereken: ${required}`;
        $('#discard-required').textContent = required;
        $('#modal-discard').classList.remove('hidden');
        updateDiscardModal();
      } else {
        $('#modal-discard').classList.add('hidden');
      }
    } else {
      $('#modal-discard').classList.add('hidden');
    }

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
  } else if (gs.phase === 'DISCARD') {
    rollBtn.classList.add('hidden');
    endBtn.classList.add('hidden');
    allBtns.forEach(b => b.classList.add('disabled'));

    if (gs.discardState && gs.discardState[state.user.id]) {
      // Show discard modal for me
      const required = gs.discardState[state.user.id];
      $('#discard-target-text').textContent = `Atman Gereken: ${required}`;
      $('#discard-required').textContent = required;
      $('#modal-discard').classList.remove('hidden');
      updateDiscardModal();
    } else {
      $('#modal-discard').classList.add('hidden');
    }
  } else if (gs.phase === 'GAMEPLAY') {
    rollBtn.classList.add('hidden');
    endBtn.classList.remove('hidden');
  } else if (gs.phase === 'SETUP' || gs.phase === 'ROBBER' || gs.phase === 'NAVY_TARGETING' || gs.phase === 'SHIELD_TARGETING') {
    rollBtn.classList.add('hidden');
    endBtn.classList.add('hidden');
    if (gs.phase !== 'SETUP') {
      allBtns.forEach(b => b.classList.add('disabled'));
    }
  } else {
    rollBtn.classList.add('hidden');
    endBtn.classList.add('hidden');
  }
}

// ─── DISCARD LOGIC ──────────────────────────────────────────
function updateDiscardModal() {
  if (!state.gameState || !state.user) return;
  const myPlayer = state.gameState.players.find(p => p.id === state.user.id);
  if (!myPlayer) return;

  const required = state.gameState.discardState?.[state.user.id] || 0;
  let selected = 0;

  $('#discard-picker').querySelectorAll('.trade-res-row').forEach(row => {
    const type = row.dataset.res;
    const owned = myPlayer.resources[type] || 0;
    const countEl = row.querySelector('.res-count');
    const ownedEl = row.querySelector('.res-owned');
    let count = parseInt(countEl.textContent) || 0;

    // Ensure count doesn't exceed owned
    if (count > owned) count = owned;
    countEl.textContent = count;
    ownedEl.textContent = owned;

    selected += count;

    // Update buttons
    row.querySelector('.res-minus').disabled = (count <= 0);
    // Cannot add more than owned, and cannot add if we reached target
    row.querySelector('.res-plus').disabled = (count >= owned) || (selected >= required);
  });

  $('#discard-selected').textContent = selected;
  const confirmBtn = $('#btn-discard-confirm');
  
  if (selected === required && required > 0) {
    confirmBtn.classList.remove('disabled');
  } else {
    confirmBtn.classList.add('disabled');
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
    'btn-buy-shield': 'BUY_SHIELD',
  };

  Object.entries(actionBtns).forEach(([btnId, action]) => {
    const btn = $(`#${btnId}`);
    if (btn) {
      btn.addEventListener('click', () => {
        if (state.gameState?.currentPlayerId !== state.user.id) return;
        $$('.action-btn').forEach(b => b.classList.remove('active'));
        
        if (action === 'BUY_SHIELD') {
          $('#modal-shield-choice').classList.remove('hidden');
          state.selectedAction = null;
          return;
        }
        
        if (action === 'NAVY_ATTACK') {
          $('#modal-navy-choice').classList.remove('hidden');
          state.selectedAction = null;
          return;
        }

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
    const errorEl = $('#login-error');
    if (errorEl) errorEl.style.display = 'none';

    try {
      const res = await fetch('/auth/42/direct-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginName })
      });
      const data = await res.json();
      if (data.success) {
        window.location.reload(); // Reload the whole page to ensure fresh state
      } else {
        if (errorEl) {
          errorEl.textContent = data.error || 'Giriş yapılamadı.';
          errorEl.style.display = 'block';
        }
      }
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = 'Sunucuya bağlanılamadı.';
        errorEl.style.display = 'block';
      }
    }
  });

  // Guest Coalition Picker click logic
  $$('.coalition-choice').forEach(choice => {
    choice.addEventListener('click', () => {
      $$('.coalition-choice').forEach(c => {
        c.classList.remove('active');
        c.style.borderColor = 'transparent';
        const cColor = c.getAttribute('data-color');
        c.style.background = 'rgba(' + (cColor === '#3B82F6' ? '59,130,246' : cColor === '#EF4444' ? '239,68,68' : cColor === '#22C55E' ? '34,197,94' : '168,85,247') + ', 0.05)';
      });
      choice.classList.add('active');
      const color = choice.getAttribute('data-color');
      choice.style.borderColor = color;
      choice.style.background = 'rgba(' + (color === '#3B82F6' ? '59,130,246' : color === '#EF4444' ? '239,68,68' : color === '#22C55E' ? '34,197,94' : '168,85,247') + ', 0.15)';
    });
  });

  // Guest login button click
  $('#btn-start-singleplayer')?.addEventListener('click', async () => {
    const guestName = $('#guest-name-input').value.trim();
    const errorEl = $('#guest-login-error');
    if (errorEl) errorEl.style.display = 'none';

    if (!guestName) {
      if (errorEl) {
        errorEl.textContent = 'Please enter a name.';
        errorEl.style.display = 'block';
      }
      return;
    }

    const activeChoice = $('.coalition-choice.active');
    const coalitionId = activeChoice ? activeChoice.getAttribute('data-id') : '1';
    const coalitionName = activeChoice ? activeChoice.getAttribute('data-name') : 'The Order';
    const coalitionColor = activeChoice ? activeChoice.getAttribute('data-color') : '#3B82F6';

    try {
      const res = await fetch('/auth/42/guest-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: guestName,
          coalitionId,
          coalitionName,
          coalitionColor
        })
      });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        if (errorEl) {
          errorEl.textContent = data.error || 'Failed to start singleplayer match.';
          errorEl.style.display = 'block';
        }
      }
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = 'Unable to connect to server.';
        errorEl.style.display = 'block';
      }
    }
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
  ['p2p-give', 'p2p-receive', 'counter-give', 'counter-receive'].forEach(containerId => {
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

  // ─── Bank Trade Action ─────────────────────────────────
  $('#btn-trade-confirm')?.addEventListener('click', () => {
    const give    = $('#bank-give-select').value;
    const receive = $('#bank-receive-select').value;

    if (give === receive) {
      addEventLog('❌ Farklı kaynaklar seçmelisiniz.');
      return;
    }

    // Client-side pre-check: need at least 4 of give resource
    const myPlayer = state.gameState?.players?.find(p => p.id === state.user?.id);
    const haveAmount = (myPlayer?.resources?.[give] || 0);
    if (haveAmount < 4) {
      addEventLog(`❌ Banka için yeterli kaynağınız yok! ${RESOURCE_EMOJI[give]} ${RESOURCE_LABEL[give]}: ${haveAmount}/4 gerekli`);
      return;
    }

    state.socket.emit('bank_trade', { giveType: give, receiveType: receive });
    // Modal will be closed by bank_trade_result event handler
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
    // Client-side resource check
    const myPlayer = state.gameState?.players?.find(p => p.id === state.user?.id);
    for (const [type, amount] of Object.entries(give)) {
      const have = myPlayer?.resources?.[type] || 0;
      if (have < amount) {
        addEventLog(`❌ Yeterli kaynak yok: ${RESOURCE_EMOJI[type]} ${RESOURCE_LABEL[type]} (var: ${have}, gereken: ${amount})`);
        return;
      }
    }
    state.socket.emit('start_trade_proposal', { give, receive });
    addEventLog('📤 Takas teklifiniz gönderildi!');
  });

  $('#btn-p2p-cancel')?.addEventListener('click', () => {
    $('#modal-trade').classList.add('hidden');
  });

  $('#btn-cancel-active-trade')?.addEventListener('click', () => {
    if (state._activeProposerTradeId) {
      state.socket.emit('cancel_trade', { tradeId: state._activeProposerTradeId });
    }
  });

  // ─── Incoming Trade Response ────────────────────────────
  $('#btn-accept-trade')?.addEventListener('click', () => {
    if (state._pendingTradeId) {
      state.socket.emit('trade_response', { tradeId: state._pendingTradeId, responseType: 'ACCEPT' });
      state._pendingTradeId = null;
    }
    $('#trade-offer-popup').classList.add('hidden');
  });

  $('#btn-reject-trade')?.addEventListener('click', () => {
    if (state._pendingTradeId) {
      state.socket.emit('trade_response', { tradeId: state._pendingTradeId, responseType: 'REJECT' });
      state._pendingTradeId = null;
    }
    $('#trade-offer-popup').classList.add('hidden');
  });

  $('#btn-show-counter')?.addEventListener('click', () => {
    $('#trade-offer-main-actions').classList.add('hidden');
    $('#counter-offer-section').classList.remove('hidden');
  });

  $('#btn-cancel-counter')?.addEventListener('click', () => {
    $('#counter-offer-section').classList.add('hidden');
    $('#trade-offer-main-actions').classList.remove('hidden');
  });

  $('#btn-send-counter')?.addEventListener('click', () => {
    const give = {};
    const receive = {};
    $('#counter-give').querySelectorAll('.trade-res-row').forEach(row => {
      const count = parseInt(row.querySelector('.res-count').textContent);
      if (count > 0) give[row.dataset.res] = count;
    });
    $('#counter-receive').querySelectorAll('.trade-res-row').forEach(row => {
      const count = parseInt(row.querySelector('.res-count').textContent);
      if (count > 0) receive[row.dataset.res] = count;
    });
    if (Object.keys(give).length === 0 || Object.keys(receive).length === 0) {
      addEventLog('❌ Karşı teklif için kaynak seçin!');
      return;
    }
    if (state._pendingTradeId) {
      state.socket.emit('trade_response', { 
        tradeId: state._pendingTradeId, 
        responseType: 'COUNTER',
        counterGive: give,
        counterReceive: receive
      });
      state._pendingTradeId = null;
    }
    $('#trade-offer-popup').classList.add('hidden');
  });

  $('#btn-back-lobby')?.addEventListener('click', () => {
    $('#modal-game-over').classList.add('hidden');
    state.gameState = null;
    state.socket.emit('leave_room');
    showScreen('lobby');
  });

  // ─── NAVY MODAL ACTIONS ──────────────────────────────────
  $('#btn-navy-modal-army')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'BUY_NAVY', option: 'ARMY' });
    $('#modal-navy-choice').classList.add('hidden');
  });

  $('#btn-navy-modal-attack')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'BUY_NAVY', option: 'ATTACK' });
    $('#modal-navy-choice').classList.add('hidden');
  });

  $('#btn-navy-cancel')?.addEventListener('click', () => {
    $('#modal-navy-choice').classList.add('hidden');
  });

  // ─── SHIELD MODAL ACTIONS ────────────────────────────────
  $('#btn-shield-buy')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'BUY_SHIELD' });
    $('#modal-shield-choice').classList.add('hidden');
  });

  $('#btn-shield-apply')?.addEventListener('click', () => {
    state.socket.emit('game:command', { type: 'PREPARE_SHIELD' });
    $('#modal-shield-choice').classList.add('hidden');
  });

  $('#btn-shield-cancel')?.addEventListener('click', () => {
    $('#modal-shield-choice').classList.add('hidden');
  });

  // ─── DISCARD MODAL ACTIONS ────────────────────────────────
  $('#discard-picker')?.querySelectorAll('.res-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const countEl = e.target.nextElementSibling;
      let count = parseInt(countEl.textContent) || 0;
      if (count > 0) {
        countEl.textContent = count - 1;
        updateDiscardModal();
      }
    });
  });

  $('#discard-picker')?.querySelectorAll('.res-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const countEl = e.target.previousElementSibling;
      let count = parseInt(countEl.textContent) || 0;
      countEl.textContent = count + 1;
      updateDiscardModal();
    });
  });

  $('#btn-discard-confirm')?.addEventListener('click', () => {
    if ($('#btn-discard-confirm').classList.contains('disabled')) return;

    const resources = {};
    $('#discard-picker').querySelectorAll('.trade-res-row').forEach(row => {
      const type = row.dataset.res;
      const count = parseInt(row.querySelector('.res-count').textContent) || 0;
      if (count > 0) resources[type] = count;
    });

    state.socket.emit('game:command', { type: 'DISCARD_RESOURCES', resources });
    $('#modal-discard').classList.add('hidden');
    
    // Reset counters
    $('#discard-picker').querySelectorAll('.res-count').forEach(el => el.textContent = '0');
  });
});

function showGameOverModal(placements) {
  const modal = $('#modal-game-over');
  const resultsList = $('#results-list');
  const title = modal.querySelector('h3');
  
  if (!modal || !resultsList) return;

  resultsList.innerHTML = '';
  
  // Kendi sonucunu bularak başlığı ayarla
  const myResult = placements.find(p => p.playerId === state.user?.id);
  if (myResult && myResult.placement === 1) {
    title.innerHTML = '🏆 Tebrikler, Kazandın!';
    title.style.color = 'var(--accent-green)';
  } else {
    title.innerHTML = '💀 Maalesef Kaybettin';
    title.style.color = 'var(--accent-red)';
  }

  placements.forEach((p) => {
    const isMe = p.playerId === state.user?.id;
    const row = document.createElement('div');
    row.className = 'result-row';
    if (isMe) row.style.border = '1px solid var(--accent-cyan)';
    
    // ELO değişimi
    const pts = p.pointsChange > 0 ? `+${p.pointsChange}` : p.pointsChange;
    const ptsClass = p.pointsChange > 0 ? 'positive' : (p.pointsChange < 0 ? 'negative' : '');
    
    row.innerHTML = `
      <div class="result-placement">#${p.placement}</div>
      <div class="result-name">${escapeHtml(p.displayName || p.login)} ${isMe ? '(Sen)' : ''}</div>
      <div class="result-score">${p.score} Yıldız</div>
      <div class="result-points ${ptsClass}">${pts} ELO</div>
    `;
    resultsList.appendChild(row);
  });

  modal.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
