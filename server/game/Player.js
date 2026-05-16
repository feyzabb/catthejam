/**
 * Player.js — Player class representing a connected user in a game room.
 * 
 * Tracks the player's identity, resources, units, structures, 
 * and the commands they queue during each planning phase.
 */
const config = require('../config');

class Player {
  /**
   * @param {object} userData — Session user object from OAuth
   * @param {string} socketId — Socket.IO socket id
   * @param {number} playerIndex — 0-3 seat index in the room
   */
  constructor(userData, socketId, playerIndex) {
    // Identity
    this.id = userData.id;                       // DB player id
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
    this.playerIndex = playerIndex;              // 0-3 seat position
    this.isReady = false;
    this.isConnected = true;

    // Resources
    this.resources = {
      wood: 10,
      stone: 10,
      iron: 5,
      gold: 0,
    };

    // Capital hex (assigned at game start)
    this.capitalHex = null;

    // Command queue for current pulse
    this.pendingCommands = [];

    // Units & structures tracked by hex position
    this.navies = [];           // Array of { id, hex: {q, r} }
    this.merchantShips = [];    // Array of { id, fromHex, toHex }
    this.villages = [];         // Array of { id, hex: {q, r}, resourceType }
    this.cities = [];           // Array of { id, hex: {q, r}, resourceType }
  }

  /**
   * Queue commands for this pulse's planning phase.
   * Validates basic command structure before accepting.
   */
  addCommands(commands) {
    if (!Array.isArray(commands)) return;

    const validTypes = [
      'MOVE_NAVY', 'PLACE_MERCHANT', 'BUILD_VILLAGE',
      'UPGRADE_CITY', 'BUILD_NAVY',
    ];

    for (const cmd of commands) {
      if (cmd && validTypes.includes(cmd.type)) {
        this.pendingCommands.push({ ...cmd, playerId: this.id });
      }
    }
  }

  /**
   * Clear the command queue after pulse resolution.
   */
  clearCommands() {
    this.pendingCommands = [];
  }

  /**
   * Add resources to the player's stockpile.
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
   * Calculate total resource value (for scoring/victory).
   */
  getTotalResources() {
    return this.resources.wood + this.resources.stone +
           this.resources.iron + (this.resources.gold * 2);
  }

  /**
   * Serialize player data for client broadcast.
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
      isReady: this.isReady,
      isConnected: this.isConnected,
      resources: { ...this.resources },
      capitalHex: this.capitalHex,
      navies: this.navies.map(n => ({ ...n })),
      merchantShips: this.merchantShips.map(m => ({ ...m })),
      villages: this.villages.map(v => ({ ...v })),
      cities: this.cities.map(c => ({ ...c })),
    };
  }

  /**
   * Minimal info for lobby display.
   */
  toLobbyJSON() {
    return {
      id: this.id,
      login: this.login,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      coalitionName: this.coalitionName,
      coalitionColor: this.coalitionColor,
      eloPoints: this.resources ? undefined : undefined, // fetched separately
    };
  }
}

module.exports = Player;
