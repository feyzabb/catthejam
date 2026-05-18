/**
 * RoomManager.js — Manages all active game rooms.
 */
const Room = require('../game/Room');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId → Room
    this.playerRooms = new Map(); // playerId → roomId
  }

  createRoom(name, creatorData) {
    const broadcastFn = (roomId, event, data) => {
      this.io.to(roomId).emit(event, data);
    };
    const sendToPlayerFn = (socketId, event, data) => {
      this.io.to(socketId).emit(event, data);
    };
    const room = new Room(name, creatorData, broadcastFn, sendToPlayerFn);
    this.rooms.set(room.id, room);
    console.log(`[RoomManager] Room created: ${room.id} "${room.name}"`);
    return room;
  }

  joinRoom(roomId, userData, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Check if player is already in another room
    const currentRoomId = this.playerRooms.get(userData.id);
    if (currentRoomId && currentRoomId !== roomId) {
      return { success: false, error: 'Already in another room' };
    }

    const result = room.addPlayer(userData, socketId);
    if (result.success) {
      this.playerRooms.set(userData.id, roomId);
    }
    return result;
  }

  leaveRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRooms.delete(playerId);
      return null;
    }

    room.removePlayer(playerId);
    this.playerRooms.delete(playerId);

    // Cleanup empty lobby rooms
    if (room.isEmpty() && room.state === 'lobby') {
      room.destroy();
      this.rooms.delete(roomId);
      console.log(`[RoomManager] Room ${roomId} destroyed (empty)`);
    }

    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  getRoomList() {
    return Array.from(this.rooms.values())
      .filter(r => r.state === 'lobby')
      .map(r => r.toLobbyJSON());
  }

  getAllRoomsList() {
    return Array.from(this.rooms.values()).map(r => r.toLobbyJSON());
  }
}

module.exports = RoomManager;
