/**
 * Room.js — Room class managing the lifecycle of a Catan-style game session.
 * States: 'lobby' → 'playing' → 'ended'
 */
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const Player = require('./Player');
const GameEngine = require('./GameEngine');
const leaderboard = require('../database/leaderboard');

class Room {
  constructor(name, creatorData, broadcastToRoom, sendToPlayerFn) {
    this.id = uuidv4().slice(0, 8).toUpperCase();
    this.name = name || `${creatorData.login}'s Room`;
    this.state = 'lobby';
    this.createdAt = Date.now();
    this.maxPlayers = config.GAME.MAX_PLAYERS;
    this.players = new Map();
    this.playerOrder = [];
    this.engine = null;
    this._broadcastToRoom = broadcastToRoom;
    this._sendToPlayer = sendToPlayerFn;
  }

  addPlayer(userData, socketId) {
    if (this.players.size >= this.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }
    if (this.state !== 'lobby') {
      return { success: false, error: 'Game already in progress' };
    }
    if (this.players.has(userData.id)) {
      const existing = this.players.get(userData.id);
      existing.socketId = socketId;
      existing.isConnected = true;
      return { success: true, reconnected: true };
    }

    const playerIndex = this.playerOrder.length;
    const player = new Player(userData, socketId, playerIndex);
    this.players.set(userData.id, player);
    this.playerOrder.push(userData.id);
    console.log(`[Room ${this.id}] ${userData.login} joined (${this.players.size}/${this.maxPlayers})`);
    return { success: true };
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (this.state === 'lobby') {
      this.players.delete(playerId);
      this.playerOrder = this.playerOrder.filter(id => id !== playerId);
    } else {
      player.isConnected = false;
    }
  }

  checkAutoStart() {
    if (this.state === 'lobby' && this.players.size === this.maxPlayers) {
      this.startGame();
      return true;
    }
    return false;
  }

  startGame() {
    this.state = 'playing';
    this.engine = new GameEngine(this, (event, data) => {
      this._broadcastToRoom(this.id, event, data);
    }, (socketId, event, data) => {
      if (this._sendToPlayer) this._sendToPlayer(socketId, event, data);
    });
    this.engine.initialize(this.getPlayers());
    this._broadcastToRoom(this.id, 'room:gameStart', {
      roomId: this.id,
      gameState: this.engine.getFullState(this.getPlayers()),
    });
    this.engine.start();
    console.log(`[Room ${this.id}] Catan game started!`);
  }

  /**
   * Handle a single command from a player (Catan: one action at a time).
   */
  handleCommand(playerId, command) {
    if (this.state !== 'playing' || !this.engine) return { success: false, error: 'No game' };
    return this.engine.handleCommand(playerId, command);
  }

  // Keep backward compat for batch commands
  submitCommands(playerId, commands) {
    if (!Array.isArray(commands) || commands.length === 0) return false;
    const result = this.handleCommand(playerId, commands[0]);
    return result.success;
  }

  getPlayers() {
    return this.playerOrder.map(id => this.players.get(id)).filter(Boolean);
  }

  onGameEnded(placements) {
    this.state = 'ended';
    try {
      const results = placements.map(p => ({
        playerId: p.playerId,
        placement: p.placement,
        pointsChange: p.pointsChange,
        finalResources: p.resources,
      }));
      leaderboard.recordMatch(this.id, this.engine?.turnNumber || 0, results);
    } catch (err) {
      console.error(`[Room ${this.id}] Failed to record match:`, err);
    }
  }

  isEmpty() { return this.players.size === 0; }

  destroy() {
    if (this.engine) this.engine.destroy();
    this.players.clear();
    this.playerOrder = [];
  }

  toLobbyJSON() {
    return {
      id: this.id, name: this.name, state: this.state,
      playerCount: this.players.size, maxPlayers: this.maxPlayers,
      players: this.getPlayers().map(p => ({
        login: p.login, displayName: p.displayName,
        avatarUrl: p.avatarUrl, coalitionName: p.coalitionName,
        coalitionColor: p.coalitionColor,
      })),
      createdAt: this.createdAt,
    };
  }
}

module.exports = Room;
