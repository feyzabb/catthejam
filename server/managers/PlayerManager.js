/**
 * PlayerManager.js — Tracks online players and their socket connections.
 */
class PlayerManager {
  constructor() {
    this.onlinePlayers = new Map(); // playerId → { socketId, userData }
    this.socketToPlayer = new Map(); // socketId → playerId
  }

  addPlayer(socketId, userData) {
    this.onlinePlayers.set(userData.id, { socketId, userData });
    this.socketToPlayer.set(socketId, userData.id);
  }

  removeBySocket(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (playerId) {
      this.onlinePlayers.delete(playerId);
      this.socketToPlayer.delete(socketId);
    }
    return playerId;
  }

  getBySocket(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    return playerId ? this.onlinePlayers.get(playerId) : null;
  }

  getById(playerId) {
    return this.onlinePlayers.get(playerId) || null;
  }

  getOnlineCount() {
    return this.onlinePlayers.size;
  }
}

module.exports = PlayerManager;
