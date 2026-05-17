/**
 * handlers.js — Socket.IO event handlers.
 * Routes all WebSocket events to the appropriate managers.
 */
const E = require('./events');

function registerSocketHandlers(io, socket, roomManager, playerManager) {
  const user = socket.user; // Set by auth middleware

  // Register player as online
  playerManager.addPlayer(socket.id, user);
  console.log(`[Socket] ${user.login} connected (${playerManager.getOnlineCount()} online)`);

  // Check if player requested a Singleplayer bot match
  if (user && user.wantsSingleplayer) {
    user.wantsSingleplayer = false;

    // Leave any existing rooms first
    const existingRoom = roomManager.getPlayerRoom(user.id);
    if (existingRoom) {
      socket.leave(existingRoom.id);
      roomManager.leaveRoom(user.id);
    }

    // 1. Create a singleplayer solo room
    const roomName = `Solo: ${user.login}'s War`;
    const room = roomManager.createRoom(roomName, user);
    
    // 2. Join the guest player
    const joinRes = roomManager.joinRoom(room.id, user, socket.id);
    if (joinRes.success) {
      socket.join(room.id);

      // 3. Auto-populate with 3 Bot players representing the other 3 coalitions
      const allCoalitions = [
        { id: 1, name: 'The Order', color: '#3B82F6' },
        { id: 2, name: 'The Assembly', color: '#EF4444' },
        { id: 3, name: 'The Alliance', color: '#22C55E' },
        { id: 4, name: 'The Federation', color: '#A855F7' }
      ];

      // Exclude user's coalition
      const botCoalitions = allCoalitions.filter(c => c.id !== parseInt(user.coalitionId));
      const botNames = ['Bot Sirac', 'Bot Codel', 'Bot Polat'];

      botNames.forEach((botName, idx) => {
        const botCoalition = botCoalitions[idx] || botCoalitions[0];
        const botUser = {
          id: `bot-user-${room.id}-${idx + 1}`,
          intraId: `bot-intra-${room.id}-${idx + 1}`,
          login: botName,
          displayName: botName,
          avatarUrl: null,
          coalitionId: botCoalition.id,
          coalitionName: botCoalition.name,
          coalitionColor: botCoalition.color,
          isBot: true
        };
        roomManager.joinRoom(room.id, botUser, null);
      });

      // 4. Force start the game immediately
      room.startGame();

      // 5. Notify the lobby
      io.emit(E.ROOM_LIST, roomManager.getRoomList());
    }
  }

  // Send initial data
  socket.emit(E.PLAYER_INFO, { user });
  socket.emit(E.ROOM_LIST, roomManager.getRoomList());

  // ─── ROOM EVENTS ──────────────────────────────────────────

  socket.on(E.ROOM_CREATE, ({ name }) => {
    // Leave any existing room first
    const existingRoom = roomManager.getPlayerRoom(user.id);
    if (existingRoom) {
      socket.leave(existingRoom.id);
      roomManager.leaveRoom(user.id);
    }

    const room = roomManager.createRoom(name, user);
    const result = roomManager.joinRoom(room.id, user, socket.id);

    if (result.success) {
      socket.join(room.id);
      socket.emit(E.ROOM_UPDATED, room.toLobbyJSON());
      io.emit(E.ROOM_LIST, roomManager.getRoomList());
    } else {
      socket.emit(E.ERROR, { code: 'CREATE_FAILED', message: result.error });
    }
  });

  socket.on(E.ROOM_JOIN, ({ roomId }) => {
    // Leave any existing room first
    const existingRoom = roomManager.getPlayerRoom(user.id);
    if (existingRoom) {
      socket.leave(existingRoom.id);
      roomManager.leaveRoom(user.id);
    }

    const result = roomManager.joinRoom(roomId, user, socket.id);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'JOIN_FAILED', message: result.error });
      return;
    }

    socket.join(roomId);
    const room = roomManager.getRoom(roomId);

    // Notify all in room
    io.to(roomId).emit(E.ROOM_UPDATED, room.toLobbyJSON());
    io.emit(E.ROOM_LIST, roomManager.getRoomList());

    // Auto-start if full
    if (room.checkAutoStart()) {
      console.log(`[Socket] Room ${roomId} auto-starting — 4 players joined`);
    }
  });

  socket.on(E.ROOM_LEAVE, () => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room) return;

    socket.leave(room.id);
    roomManager.leaveRoom(user.id);

    if (!room.isEmpty()) {
      io.to(room.id).emit(E.ROOM_UPDATED, room.toLobbyJSON());
    }
    io.emit(E.ROOM_LIST, roomManager.getRoomList());
  });

  // ─── GAME EVENTS ──────────────────────────────────────────

  const handleGameAction = (command) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room) return;

    const result = room.handleCommand(user.id, command);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'COMMAND_FAILED', message: result.error || 'Cannot execute command' });
    }
  };

  socket.on('build_settlement', ({ nodeId }) => {
    handleGameAction({ type: 'PLACE_VILLAGE', vertexId: nodeId });
  });

  socket.on('build_road', ({ edgeId }) => {
    handleGameAction({ type: 'PLACE_ROAD', edgeId });
  });

  socket.on('roll_dice', () => {
    handleGameAction({ type: 'ROLL_DICE' });
  });

  socket.on('end_turn', () => {
    handleGameAction({ type: 'END_TURN' });
  });

  // ─── TRADE EVENTS ──────────────────────────────────────────

  // Primary P2P trade proposal handler
  const handleProposeTrade = ({ give, receive }) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room || !room.engine) return;
    const result = room.engine.proposeTrade(user.id, give, receive);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'TRADE_FAILED', message: result.error });
    } else {
      // Confirm back to proposer with their tradeId
      socket.emit('trade_proposal_sent', { tradeId: result.tradeId });
    }
  };

  socket.on('propose_trade', handleProposeTrade);
  // Alias used in the architecture spec
  socket.on('start_trade_proposal', handleProposeTrade);

  socket.on('trade_response', ({ tradeId, responseType, counterGive, counterReceive }) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room || !room.engine) return;
    const result = room.engine.handleTradeResponse(user.id, tradeId, responseType, counterGive, counterReceive);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'TRADE_FAILED', message: result.error });
    }
  });

  socket.on('accept_trade_response', ({ tradeId, responderId }) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room || !room.engine) return;
    const result = room.engine.acceptTradeResponse(user.id, tradeId, responderId);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'TRADE_FAILED', message: result.error });
    }
  });

  socket.on('bank_trade', ({ giveType, receiveType }) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room || !room.engine) return;
    const result = room.engine.bankTrade(user.id, giveType, receiveType);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'BANK_TRADE_FAILED', message: result.error });
    }
    // Success broadcast is handled inside GameEngine.bankTrade via room broadcast
  });

  socket.on('cancel_trade', ({ tradeId }) => {
    const room = roomManager.getPlayerRoom(user.id);
    if (!room || !room.engine) return;
    const result = room.engine.cancelTrade(user.id, tradeId);
    if (!result.success) {
      socket.emit(E.ERROR, { code: 'TRADE_FAILED', message: result.error });
    }
  });

  // Keep for other commands (trade, upgrade city, navy attack)
  socket.on('game:command', handleGameAction);

  // ─── CHAT ─────────────────────────────────────────────────

  socket.on(E.CHAT_MESSAGE, ({ text }) => {
    if (!text || text.length > 200) return;
    const room = roomManager.getPlayerRoom(user.id);
    const target = room ? room.id : 'lobby';

    io.to(target).emit(E.CHAT_MESSAGE, {
      login: user.login,
      coalitionColor: user.coalitionColor,
      text,
      timestamp: Date.now(),
    });
  });

  // ─── DISCONNECT ───────────────────────────────────────────

  socket.on('disconnect', () => {
    const room = roomManager.getPlayerRoom(user.id);
    if (room) {
      roomManager.leaveRoom(user.id);
      if (!room.isEmpty()) {
        io.to(room.id).emit(E.ROOM_UPDATED, room.toLobbyJSON());
      }
      io.emit(E.ROOM_LIST, roomManager.getRoomList());
    }
    playerManager.removeBySocket(socket.id);
    console.log(`[Socket] ${user.login} disconnected (${playerManager.getOnlineCount()} online)`);
  });
}

module.exports = { registerSocketHandlers };
