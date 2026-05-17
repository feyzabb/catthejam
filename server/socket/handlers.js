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

  // Keep for other commands (trade, upgrade city, navy attack)
  socket.on(E.GAME_COMMAND, handleGameAction);

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
