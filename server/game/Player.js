/**
 * Player.js — Player class for Catan-style game.
 * 
 * Tracks identity, resources (wood, stone, iron, gold, food),
 * buildings, roads, victory points, and turn commands.
 */
const config = require('../config');

class Player {
  constructor(userData, socketId, playerIndex) {
    // Identity
    this.id = userData.id;
    this.intraId = userData.intraId;
    this.login = userData.login;
    this.displayName = userData.displayName;
    this.avatarUrl = userData.avatarUrl;
    this.socketId = socketId;

    // Coalition theming
    this.coalitionId = userData.coalitionId;
    this.coalitionName = userData.coalitionName;
    this.coalitionColor = userData.coalitionColor || '#5B7C99';
    this.coalitionImageUrl = userData.coalitionImageUrl;

    // Game state
    this.playerIndex = playerIndex;
    this.isReady = false;
    this.isConnected = true;

    // Player color for the board (fixed per seat)
    const colors = ['#3B82F6', '#EF4444', '#22C55E', '#A855F7'];
    this.color = colors[playerIndex] || '#5B7C99';

    // Resources (Catan-style, 5 types)
    this.resources = {
      wood: 0,
      stone: 0,
      iron: 0,
      gold: 0,
      food: 0,
    };

    // Victory points
    this.victoryPoints = 0;
    this.devCardsVp = 0;
    this.knightsPlayed = 0;

    // Buildings & Roads (tracked by vertex/edge ID)
    this.villages = [];    // vertex IDs
    this.cities = [];      // vertex IDs
    this.roads = [];       // edge IDs

    // Pending command for current turn
    this.pendingCommand = null;

    // Setup phase: how many settlements placed (0, 1, or 2)
    this.setupPlaced = 0;
  }

  /**
   * Add resources.
   */
  addResource(type, amount) {
    if (this.resources.hasOwnProperty(type)) {
      this.resources[type] += amount;
    }
  }

  /**
   * Spend resources — returns false if insufficient.
   */
  spendResource(type, amount) {
    if (this.resources[type] >= amount) {
      this.resources[type] -= amount;
      return true;
    }
    return false;
  }

  /**
   * Check if player can afford a cost object { wood: N, stone: N, ... }.
   */
  canAfford(cost) {
    for (const [type, amount] of Object.entries(cost)) {
      if ((this.resources[type] || 0) < amount) return false;
    }
    return true;
  }

  /**
   * Spend a cost object.
   */
  spendCost(cost) {
    for (const [type, amount] of Object.entries(cost)) {
      this.resources[type] -= amount;
    }
  }

  /**
   * Get total resource count (for robber: discard half if > 7).
   */
  getTotalResources() {
    return Object.values(this.resources).reduce((a, b) => a + b, 0);
  }

  /**
   * Calculate victory points.
   */
  calculateVP(longestRoadId = null, largestArmyId = null) {
    this.victoryPoints = this.villages.length + (this.cities.length * 2) + this.devCardsVp;
    if (this.id === longestRoadId) this.victoryPoints += 2;
    if (this.id === largestArmyId) this.victoryPoints += 2;
    return this.victoryPoints;
  }

  /**
   * Set pending command.
   */
  setCommand(command) {
    this.pendingCommand = { ...command, playerId: this.id };
  }

  /**
   * Clear pending command after resolution.
   */
  clearCommand() {
    this.pendingCommand = null;
  }

  /**
   * Serialize for client broadcast.
   */
  toPublicJSON() {
    return {
      id: this.id,
      login: this.login,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      coalitionName: this.coalitionName,
      coalitionColor: this.coalitionColor,
      coalitionImageUrl: this.coalitionImageUrl,
      playerIndex: this.playerIndex,
      color: this.color,
      isReady: this.isReady,
      isConnected: this.isConnected,
      resources: { ...this.resources },
      victoryPoints: this.victoryPoints, // Computed by GameEngine before broadcast
      villages: [...this.villages],
      cities: [...this.cities],
      roads: [...this.roads],
      knightsPlayed: this.knightsPlayed,
      setupPlaced: this.setupPlaced,
    };
  }

  /**
   * Minimal info for lobby.
   */
  toLobbyJSON() {
    return {
      id: this.id,
      login: this.login,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      coalitionName: this.coalitionName,
      coalitionColor: this.coalitionColor,
    };
  }
}

module.exports = Player;
