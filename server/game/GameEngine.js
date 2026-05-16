/**
 * GameEngine.js — Catan-style game engine.
 * 
 * Game Flow:
 *   1. Setup Phase: Each player places 2 villages + 2 roads (reverse order for 2nd)
 *   2. Main Game: Turn-based with dice rolling
 *      a. Roll dice → distribute resources
 *      b. If 7 → move robber/pirate
 *      c. Active player can: build road, build village, upgrade city, trade, or pass
 *   3. First to 10 VP wins
 */
const config = require('../config');
const HexGrid = require('./HexGrid');
const { v4: uuidv4 } = require('uuid');

// Building costs
const COSTS = {
  road: { wood: 1, stone: 1 },
  village: { wood: 1, stone: 1, food: 1, gold: 1 },
  city: { iron: 3, food: 2 },
  navy_attack: { iron: 1, food: 1, gold: 1 },
};

class GameEngine {
  constructor(room, broadcastFn) {
    this.room = room;
    this.broadcast = broadcastFn;

    // Game state
    this.grid = new HexGrid();
    this.phase = 'waiting'; // 'waiting' | 'setup' | 'roll' | 'build' | 'robber' | 'ended'
    this.currentTurn = 0;   // player index whose turn it is
    this.turnOrder = [];     // array of player IDs in turn order
    this.lastDice = [0, 0]; // [die1, die2]
    this.turnNumber = 0;

    // Setup phase tracking
    this.setupRound = 0;    // 0 = first round, 1 = second round
    this.setupStep = 'village'; // 'village' | 'road'

    // Timer
    this.timer = null;
    this.timeRemaining = 0;

    // Event log
    this.events = [];
  }

  /**
   * Initialize the game.
   */
  initialize(players) {
    this.turnOrder = players.map(p => p.id);
    console.log(`[GameEngine] Catan game initialized with ${players.length} players`);
  }

  /**
   * Start the game — enter setup phase.
   */
  start() {
    this.phase = 'setup';
    this.setupRound = 0;
    this.currentTurn = 0;
    this.setupStep = 'village';

    this.broadcast('game:phaseStart', {
      phase: 'setup',
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
    });

    this._startTurnTimer();
  }

  /**
   * Start a turn timer.
   */
  _startTurnTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timeRemaining = config.GAME.TURN_DURATION || 60;

    this.timer = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this._autoPass();
      }
    }, 1000);
  }

  /**
   * Auto-pass when timer expires.
   */
  _autoPass() {
    if (this.phase === 'setup') {
      // Skip this player's setup turn
      this._advanceSetup();
    } else if (this.phase === 'roll') {
      // Auto-roll
      this._rollDice();
    } else if (this.phase === 'build' || this.phase === 'robber') {
      // End turn
      this._endTurn();
    }
  }

  /**
   * Handle a player command.
   */
  handleCommand(playerId, command) {
    const players = this.room.getPlayers();
    const player = players.find(p => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };

    // Check if it's this player's turn
    if (this.turnOrder[this.currentTurn] !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    switch (command.type) {
      case 'PLACE_VILLAGE':
        return this._handlePlaceVillage(player, command, players);
      case 'PLACE_ROAD':
        return this._handlePlaceRoad(player, command, players);
      case 'UPGRADE_CITY':
        return this._handleUpgradeCity(player, command, players);
      case 'ROLL_DICE':
        return this._handleRollDice(player, players);
      case 'MOVE_ROBBER':
        return this._handleMoveRobber(player, command, players);
      case 'END_TURN':
        return this._handleEndTurn(player, players);
      case 'BUY_NAVY_ATTACK':
        return this._handleBuyNavyAttack(player, players);
      default:
        return { success: false, error: 'Unknown command' };
    }
  }

  // ─── SETUP PHASE HANDLERS ─────────────────────────────────

  _handlePlaceVillage(player, command, players) {
    const vertexId = command.vertexId;
    if (!vertexId) return { success: false, error: 'No vertex specified' };

    if (this.phase === 'setup') {
      if (this.setupStep !== 'village') return { success: false, error: 'Place a road first' };

      // In setup, use free placement (no distance rule enforcement except via grid)
      const success = this.grid.placeBuildingFree(vertexId, player.id, 'village');
      if (!success) return { success: false, error: 'Cannot place village here' };

      player.villages.push(vertexId);
      this.events.push({ type: 'VILLAGE_BUILT', playerId: player.id, vertexId });

      // In second setup round, give initial resources from adjacent hexes
      if (this.setupRound === 1) {
        const adjHexes = this.grid.getHexesForVertex(vertexId);
        for (const hex of adjHexes) {
          if (hex.resourceType) {
            player.addResource(hex.resourceType, 1);
          }
        }
      }

      this.setupStep = 'road';
      this._broadcastState(players);
      return { success: true };

    } else if (this.phase === 'build') {
      // Normal game: check cost and rules
      if (!player.canAfford(COSTS.village)) return { success: false, error: 'Cannot afford village' };

      // Must be adjacent to player's road
      const vertex = this.grid.vertices.get(vertexId);
      if (!vertex) return { success: false, error: 'Invalid vertex' };

      const hasRoad = this.grid._hasAdjacentRoad(vertexId, player.id);
      if (!hasRoad) return { success: false, error: 'Must be connected to your road network' };

      const success = this.grid.placeBuilding(vertexId, player.id, 'village');
      if (!success) return { success: false, error: 'Cannot place village here (distance rule)' };

      player.spendCost(COSTS.village);
      player.villages.push(vertexId);
      this.events.push({ type: 'VILLAGE_BUILT', playerId: player.id, vertexId });

      this._checkVictory(player, players);
      this._broadcastState(players);
      return { success: true };
    }

    return { success: false, error: 'Cannot place village now' };
  }

  _handlePlaceRoad(player, command, players) {
    const edgeId = command.edgeId;
    if (!edgeId) return { success: false, error: 'No edge specified' };

    if (this.phase === 'setup') {
      if (this.setupStep !== 'road') return { success: false, error: 'Place a village first' };

      // In setup, road must be adjacent to the just-placed village
      const lastVillage = player.villages[player.villages.length - 1];
      const edge = this.grid.edges.get(edgeId);
      if (!edge) return { success: false, error: 'Invalid edge' };
      if (edge.v1Id !== lastVillage && edge.v2Id !== lastVillage) {
        return { success: false, error: 'Road must be adjacent to your village' };
      }

      const success = this.grid.placeRoadFree(edgeId, player.id);
      if (!success) return { success: false, error: 'Cannot place road here' };

      player.roads.push(edgeId);
      this.events.push({ type: 'ROAD_BUILT', playerId: player.id, edgeId });

      // Advance setup
      this._advanceSetup();
      this._broadcastState(players);
      return { success: true };

    } else if (this.phase === 'build') {
      // Normal game: check cost
      if (!player.canAfford(COSTS.road)) return { success: false, error: 'Cannot afford road' };

      const success = this.grid.placeRoad(edgeId, player.id);
      if (!success) return { success: false, error: 'Cannot place road here' };

      player.spendCost(COSTS.road);
      player.roads.push(edgeId);
      this.events.push({ type: 'ROAD_BUILT', playerId: player.id, edgeId });

      this._broadcastState(players);
      return { success: true };
    }

    return { success: false, error: 'Cannot place road now' };
  }

  _handleUpgradeCity(player, command, players) {
    if (this.phase !== 'build') return { success: false, error: 'Not in build phase' };

    const vertexId = command.vertexId;
    if (!vertexId) return { success: false, error: 'No vertex specified' };

    if (!player.canAfford(COSTS.city)) return { success: false, error: 'Cannot afford city upgrade' };

    const success = this.grid.upgradeToCity(vertexId, player.id);
    if (!success) return { success: false, error: 'Cannot upgrade here' };

    player.spendCost(COSTS.city);
    player.villages = player.villages.filter(v => v !== vertexId);
    player.cities.push(vertexId);
    this.events.push({ type: 'CITY_UPGRADED', playerId: player.id, vertexId });

    this._checkVictory(player, players);
    this._broadcastState(players);
    return { success: true };
  }

  _handleBuyNavyAttack(player, players) {
    if (this.phase !== 'build') return { success: false, error: 'Not in build phase' };

    if (!player.canAfford(COSTS.navy_attack)) return { success: false, error: 'Cannot afford navy attack' };

    player.spendCost(COSTS.navy_attack);
    this.events.push({ type: 'NAVY_ATTACK_BOUGHT', playerId: player.id });
    
    // Change phase to robber so the player can place the Navy (Robber)
    this.phase = 'robber';
    this._broadcastState(players);
    return { success: true };
  }

  // ─── DICE ROLLING ──────────────────────────────────────────

  _handleRollDice(player, players) {
    if (this.phase !== 'roll') return { success: false, error: 'Not in roll phase' };
    this._rollDice();
    return { success: true };
  }

  _rollDice() {
    const players = this.room.getPlayers();
    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const total = die1 + die2;
    this.lastDice = [die1, die2];

    this.events.push({ type: 'DICE_ROLLED', dice: [die1, die2], total });

    if (total === 7) {
      // Robber! Players with > 7 resources must discard half (auto for now)
      for (const p of players) {
        const totalRes = p.getTotalResources();
        if (totalRes > 7) {
          const toDiscard = Math.floor(totalRes / 2);
          let discarded = 0;
          const types = ['wood', 'stone', 'iron', 'gold', 'food'];
          while (discarded < toDiscard) {
            for (const type of types) {
              if (p.resources[type] > 0 && discarded < toDiscard) {
                p.resources[type]--;
                discarded++;
              }
            }
          }
        }
      }

      // Move to robber phase
      this.phase = 'robber';
      this._broadcastState(players);
      this.broadcast('game:dice', { dice: [die1, die2], total, phase: 'robber' });
      return;
    }

    // Distribute resources
    const distributions = this.grid.distributeResources(total);
    for (const dist of distributions) {
      const p = players.find(pl => pl.id === dist.playerId);
      if (p) {
        p.addResource(dist.resourceType, dist.amount);
        this.events.push({
          type: 'RESOURCE_PRODUCED',
          playerId: dist.playerId,
          resourceType: dist.resourceType,
          amount: dist.amount,
        });
      }
    }

    this.phase = 'build';
    this._broadcastState(players);
    this.broadcast('game:dice', { dice: [die1, die2], total, distributions, phase: 'build' });
  }

  // ─── ROBBER ────────────────────────────────────────────────

  _handleMoveRobber(player, command, players) {
    if (this.phase !== 'robber') return { success: false, error: 'Not in robber phase' };

    const { q, r } = command;
    const hex = this.grid.getHex(q, r);
    if (!hex) return { success: false, error: 'Invalid hex' };

    // Can't place robber back on same hex
    if (this.grid.robberHex && this.grid.robberHex.q === q && this.grid.robberHex.r === r) {
      return { success: false, error: 'Must move robber to a different hex' };
    }

    this.grid.moveRobber(q, r);
    this.events.push({ type: 'ROBBER_MOVED', playerId: player.id, hex: { q, r } });

    this.phase = 'build';
    this._broadcastState(players);
    return { success: true };
  }

  // ─── TURN MANAGEMENT ──────────────────────────────────────

  _handleEndTurn(player, players) {
    if (this.phase !== 'build') return { success: false, error: 'Cannot end turn now' };
    this._endTurn();
    return { success: true };
  }

  _endTurn() {
    const players = this.room.getPlayers();

    // Advance to next player
    this.currentTurn = (this.currentTurn + 1) % this.turnOrder.length;
    this.turnNumber++;
    this.phase = 'roll';

    this.broadcast('game:turnChanged', {
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
      turnNumber: this.turnNumber,
    });

    this._broadcastState(players);
    this._startTurnTimer();
  }

  // ─── SETUP PHASE MANAGEMENT ───────────────────────────────

  _advanceSetup() {
    const players = this.room.getPlayers();
    const numPlayers = this.turnOrder.length;

    if (this.setupRound === 0) {
      // First round: go forward
      this.currentTurn++;
      if (this.currentTurn >= numPlayers) {
        // Start second round (reverse order)
        this.setupRound = 1;
        this.currentTurn = numPlayers - 1;
      }
    } else {
      // Second round: go backward
      this.currentTurn--;
      if (this.currentTurn < 0) {
        // Setup complete! Start main game
        this._startMainGame(players);
        return;
      }
    }

    this.setupStep = 'village';

    this.broadcast('game:phaseStart', {
      phase: 'setup',
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
    });

    this._startTurnTimer();
  }

  _startMainGame(players) {
    this.phase = 'roll';
    this.currentTurn = 0;
    this.turnNumber = 1;

    this.broadcast('game:mainStart', {
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
    });

    this._broadcastState(players);
    this._startTurnTimer();
  }

  // ─── VICTORY CHECK ─────────────────────────────────────────

  _checkVictory(player, players) {
    const vp = player.calculateVP();
    if (vp >= config.GAME.VP_WIN) {
      this._endGame(player, players);
    }
  }

  _endGame(winner, players) {
    this.phase = 'ended';
    if (this.timer) clearInterval(this.timer);

    const ranked = players
      .map(p => ({ player: p, vp: p.calculateVP() }))
      .sort((a, b) => b.vp - a.vp);

    const pointsTable = [
      config.GAME.POINTS.FIRST,
      config.GAME.POINTS.SECOND,
      config.GAME.POINTS.THIRD,
      config.GAME.POINTS.FOURTH,
    ];

    const placements = ranked.map((entry, index) => ({
      playerId: entry.player.id,
      login: entry.player.login,
      displayName: entry.player.displayName,
      coalitionColor: entry.player.coalitionColor,
      color: entry.player.color,
      placement: index + 1,
      score: entry.vp,
      pointsChange: pointsTable[index] || 0,
      resources: { ...entry.player.resources },
    }));

    this.broadcast('game:ended', {
      turnNumber: this.turnNumber,
      winner: winner ? winner.toPublicJSON() : null,
      placements,
    });

    return placements;
  }

  // ─── STATE BROADCAST ───────────────────────────────────────

  _broadcastState(players) {
    this.broadcast('game:stateUpdate', this.getFullState(players));
  }

  /**
   * Get the full game state.
   */
  getFullState(players) {
    return {
      phase: this.phase,
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
      turnNumber: this.turnNumber,
      timeRemaining: this.timeRemaining,
      lastDice: this.lastDice,
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      grid: this.grid.toJSON(),
      players: players.map(p => p.toPublicJSON()),
      events: this.events.slice(-10),
      costs: COSTS,
    };
  }

  /**
   * Cleanup.
   */
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.phase = 'ended';
  }
}

module.exports = GameEngine;
