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

// Active trade offers: Map<tradeId, { proposerId, give, receive, roomId }>
const activeTrades = new Map();

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
    this.currentPhase = 'WAITING'; // 'WAITING' | 'SETUP' | 'ROLL' | 'GAMEPLAY' | 'ROBBER' | 'ENDED'
    this.currentTurn = 0;   // player index whose turn it is
    this.turnOrder = [];     // array of player IDs in turn order
    this.lastDice = [0, 0]; // [die1, die2]
    this.turnNumber = 0;

    // Setup phase tracking
    this.setupRound = 0;    // 0 = first round, 1 = second round
    this.setupStep = 'village'; // 'village' | 'road'

    // Special Titles
    this.longestRoadPlayerId = null;
    this.longestRoadLength = 4; // Must be >= 5
    this.largestArmyPlayerId = null;
    this.largestArmyCount = 2; // Must be >= 3

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
    this.currentPhase = 'SETUP';
    this.setupRound = 0;
    this.currentTurn = 0;
    this.setupStep = 'village';

    this.broadcast('game:phaseStart', {
      phase: 'SETUP',
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
    });

    this._broadcastState(this.room.getPlayers()); // Fix lockup: immediately tell clients it is SETUP
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
    if (this.currentPhase === 'SETUP') {
      // Skip this player's setup turn
      this._advanceSetup();
    } else if (this.currentPhase === 'ROLL') {
      // Auto-roll
      this._rollDice();
    } else if (this.currentPhase === 'GAMEPLAY' || this.currentPhase === 'ROBBER') {
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
      case 'BUY_DEV_CARD':
        return this._handleBuyDevCard(player, players);
      default:
        return { success: false, error: 'Unknown command' };
    }
  }

  // ─── SETUP PHASE HANDLERS ─────────────────────────────────

  _handlePlaceVillage(player, command, players) {
    const vertexId = command.vertexId;
    if (!vertexId) return { success: false, error: 'No vertex specified' };

    if (this.currentPhase === 'SETUP') {
      if (this.setupStep !== 'village') return { success: false, error: 'Place a road first' };

      // In setup, use free placement (no distance rule enforcement except via grid)
      const success = this.grid.placeBuildingFree(vertexId, player.id, 'village');
      if (!success) return { success: false, error: 'Cannot place village here' };

      player.villages.push(vertexId);
      this.events.push({ type: 'VILLAGE_BUILT', playerId: player.id, vertexId });

      // In second setup round, give initial resources from adjacent hexes
      if (this.setupRound === 1) {
        const adjHexes = this.grid.getHexesForVertex(vertexId);
        const given = [];
        for (const hex of adjHexes) {
          if (hex.resourceType) {
            player.addResource(hex.resourceType, 1);
            given.push({ type: hex.resourceType, amount: 1 });
          }
        }
        if (given.length > 0) {
          this.broadcast('resources_updated', {
            playerId: player.id,
            login: player.login,
            playerResources: player.resources,
            gained: given,
            reason: 'setup_yield'
          });
        }
      }

      this.setupStep = 'road';
      this.broadcast('settlement_built', { nodeId: vertexId, playerId: player.id, playerColor: player.color });
      this._broadcastState(players);
      return { success: true };

    } else if (this.currentPhase === 'GAMEPLAY') {
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
      this.broadcast('settlement_built', { nodeId: vertexId, playerId: player.id, playerColor: player.color });
      this._broadcastState(players);
      return { success: true };
    }

    return { success: false, error: 'Cannot place village now' };
  }

  _handlePlaceRoad(player, command, players) {
    const edgeId = command.edgeId;
    if (!edgeId) return { success: false, error: 'No edge specified' };

    if (this.currentPhase === 'SETUP') {
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
      this.broadcast('road_built', { edgeId, playerId: player.id, playerColor: player.color });
      this._advanceSetup();
      this._broadcastState(players);
      return { success: true };

    } else if (this.currentPhase === 'GAMEPLAY') {
      // Normal game: check cost
      if (!player.canAfford(COSTS.road)) return { success: false, error: 'Cannot afford road' };

      const success = this.grid.placeRoad(edgeId, player.id);
      if (!success) return { success: false, error: 'Cannot place road here' };

      player.spendCost(COSTS.road);
      player.roads.push(edgeId);
      this.events.push({ type: 'ROAD_BUILT', playerId: player.id, edgeId });

      this._updateLongestRoad(players);
      this._checkVictory(player, players);

      this.broadcast('road_built', { edgeId, playerId: player.id, playerColor: player.color });
      this._broadcastState(players);
      return { success: true };
    }

    return { success: false, error: 'Cannot place road now' };
  }

  _handleUpgradeCity(player, command, players) {
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Not in build phase' };

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
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Not in build phase' };

    if (!player.canAfford(COSTS.navy_attack)) return { success: false, error: 'Cannot afford navy attack' };

    player.spendCost(COSTS.navy_attack);
    player.knightsPlayed++;
    this.events.push({ type: 'NAVY_ATTACK_BOUGHT', playerId: player.id });
    
    this._updateLargestArmy(players);
    this._checkVictory(player, players);

    // Change phase to robber so the player can place the Navy (Robber)
    this.currentPhase = 'ROBBER';
    this._broadcastState(players);
    return { success: true };
  }

  _handleBuyDevCard(player, players) {
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Not in build phase' };

    const cost = { iron: 1, food: 1, gold: 1 };
    if (!player.canAfford(cost)) return { success: false, error: 'Cannot afford dev card' };

    player.spendCost(cost);
    
    // 33% chance for VP, 67% chance for 2 random resources (Year of Plenty)
    const rand = Math.random();
    if (rand < 0.33) {
      player.devCardsVp++;
      this.events.push({ type: 'DEV_CARD_BOUGHT', playerId: player.id, card: 'Victory Point' });
    } else {
      const types = ['wood', 'stone', 'iron', 'gold', 'food'];
      const r1 = types[Math.floor(Math.random() * types.length)];
      const r2 = types[Math.floor(Math.random() * types.length)];
      player.addResource(r1, 1);
      player.addResource(r2, 1);
      this.events.push({ type: 'DEV_CARD_BOUGHT', playerId: player.id, card: 'Year of Plenty' });
      this.broadcast('resources_updated', {
        playerId: player.id,
        login: player.login,
        playerResources: player.resources,
        gained: [{ type: r1, amount: 1 }, { type: r2, amount: 1 }],
        reason: 'dev_card'
      });
    }

    this._checkVictory(player, players);
    this._broadcastState(players);
    return { success: true };
  }

  // ─── DICE ROLLING ──────────────────────────────────────────

  _handleRollDice(player, players) {
    if (this.currentPhase !== 'ROLL') return { success: false, error: 'Not in roll phase' };
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
      this.currentPhase = 'ROBBER';
      this.broadcast('dice_rolled', { dice1: die1, dice2: die2, total, currentTurn: this.turnOrder[this.currentTurn] });
      this._broadcastState(players);
      this.broadcast('game:dice', { dice: [die1, die2], total, phase: 'ROBBER' });
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
        this.broadcast('resources_updated', {
          playerId: p.id,
          login: p.login,
          playerResources: p.resources,
          gained: [{ type: dist.resourceType, amount: dist.amount }],
          reason: 'dice_roll'
        });
      }
    }

    this.currentPhase = 'GAMEPLAY';
    this.broadcast('dice_rolled', { dice1: die1, dice2: die2, total, currentTurn: this.turnOrder[this.currentTurn] });
    this._broadcastState(players);
    this.broadcast('game:dice', { dice: [die1, die2], total, distributions, phase: 'GAMEPLAY' });
  }

  // ─── ROBBER ────────────────────────────────────────────────

  _handleMoveRobber(player, command, players) {
    if (this.currentPhase !== 'ROBBER') return { success: false, error: 'Not in robber phase' };

    const { q, r } = command;
    const hex = this.grid.getHex(q, r);
    if (!hex) return { success: false, error: 'Invalid hex' };

    // Can't place robber back on same hex
    if (this.grid.robberHex && this.grid.robberHex.q === q && this.grid.robberHex.r === r) {
      return { success: false, error: 'Must move robber to a different hex' };
    }

    this.grid.moveRobber(q, r);
    this.events.push({ type: 'ROBBER_MOVED', playerId: player.id, hex: { q, r } });

    this.currentPhase = 'GAMEPLAY';
    this._broadcastState(players);
    return { success: true };
  }

  // ─── TURN MANAGEMENT ──────────────────────────────────────

  _handleEndTurn(player, players) {
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Cannot end turn now' };
    this._endTurn();
    return { success: true };
  }

  _endTurn() {
    const players = this.room.getPlayers();

    // Advance to next player
    this.currentTurn = (this.currentTurn + 1) % this.turnOrder.length;
    this.turnNumber++;
    this.currentPhase = 'ROLL';

    this.broadcast('turn_changed', { nextPlayerId: this.turnOrder[this.currentTurn] });
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
      phase: 'SETUP',
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      currentTurn: this.currentTurn,
      currentPlayerId: this.turnOrder[this.currentTurn],
    });

    this._startTurnTimer();
  }

  _startMainGame(players) {
    this.currentPhase = 'ROLL';
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

  _updateLongestRoad(players) {
    // Simple approximation: player with most roads >= 5
    for (const p of players) {
      if (p.roads.length > this.longestRoadLength) {
        this.longestRoadLength = p.roads.length;
        this.longestRoadPlayerId = p.id;
      }
    }
  }

  _updateLargestArmy(players) {
    for (const p of players) {
      if (p.knightsPlayed > this.largestArmyCount) {
        this.largestArmyCount = p.knightsPlayed;
        this.largestArmyPlayerId = p.id;
      }
    }
  }

  _checkVictory(player, players) {
    // Update all VPs first
    players.forEach(p => p.calculateVP(this.longestRoadPlayerId, this.largestArmyPlayerId));
    
    const vp = player.victoryPoints;
    if (vp >= 10) { // Changed to 10 points
      this._endGame(player, players);
    }
  }

  _endGame(winner, players) {
    this.currentPhase = 'ENDED';
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
    // Ensure VPs are up to date before broadcast
    players.forEach(p => p.calculateVP(this.longestRoadPlayerId, this.largestArmyPlayerId));
    this.broadcast('game:stateUpdate', this.getFullState(players));
  }

  /**
   * Get the full game state.
   */
  getFullState(players) {
    const currentPlayerId = this.turnOrder[this.currentTurn];
    const requireRoad = this.currentPhase === 'GAMEPLAY';

    return {
      phase: this.currentPhase,
      currentTurn: this.currentTurn,
      currentPlayerId,
      turnNumber: this.turnNumber,
      timeRemaining: this.timeRemaining,
      lastDice: this.lastDice,
      setupRound: this.setupRound,
      setupStep: this.setupStep,
      longestRoadPlayerId: this.longestRoadPlayerId,
      largestArmyPlayerId: this.largestArmyPlayerId,
      grid: this.grid.toJSON(),
      players: players.map(p => p.toPublicJSON()),
      events: this.events.slice(-10),
      costs: COSTS,
      validEdges: this.grid.getValidEdgesForPlayer(currentPlayerId),
      validNodes: this.grid.getValidNodesForPlayer(currentPlayerId, requireRoad),
    };
  }

  // ─── TRADE SYSTEM ──────────────────────────────────────────

  proposeTrade(playerId, give, receive) {
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Cannot trade now' };
    if (this.turnOrder[this.currentTurn] !== playerId) return { success: false, error: 'Not your turn' };

    const players = this.room.getPlayers();
    const proposer = players.find(p => p.id === playerId);
    if (!proposer) return { success: false, error: 'Player not found' };

    // Verify proposer has the resources they want to give
    for (const [type, amount] of Object.entries(give)) {
      if ((proposer.resources[type] || 0) < amount) {
        return { success: false, error: `Not enough ${type}` };
      }
    }

    const tradeId = uuidv4();
    activeTrades.set(tradeId, {
      tradeId,
      proposerId: playerId,
      proposerLogin: proposer.login,
      give,
      receive,
      responses: {} // map of responderId -> { type: 'ACCEPT'|'REJECT'|'COUNTER', give, receive }
    });

    // Broadcast to everyone except proposer
    this.broadcast('trade_proposed', {
      tradeId,
      proposerId: playerId,
      proposerLogin: proposer.login,
      give,
      receive,
    });

    return { success: true, tradeId };
  }

  handleTradeResponse(responderId, tradeId, responseType, counterGive, counterReceive) {
    const trade = activeTrades.get(tradeId);
    if (!trade) return { success: false, error: 'Trade expired or does not exist' };
    
    const players = this.room.getPlayers();
    const responder = players.find(p => p.id === responderId);
    if (!responder) return { success: false, error: 'Player not found' };

    // If counter-offer or accept, verify responder has the resources THEY are giving
    const giveObj = responseType === 'COUNTER' ? counterGive : trade.receive;
    if (responseType !== 'REJECT') {
      for (const [type, amount] of Object.entries(giveObj)) {
        if ((responder.resources[type] || 0) < amount) {
          return { success: false, error: `You don't have enough ${type}` };
        }
      }
    }

    trade.responses[responderId] = {
      responderLogin: responder.login,
      type: responseType, // 'ACCEPT' | 'REJECT' | 'COUNTER'
      give: responseType === 'COUNTER' ? counterGive : trade.receive,
      receive: responseType === 'COUNTER' ? counterReceive : trade.give
    };

    // Send the response update back to the proposer
    this.broadcast('trade_response_update', {
      tradeId,
      responderId,
      responderLogin: responder.login,
      type: responseType,
      give: trade.responses[responderId].give,
      receive: trade.responses[responderId].receive
    });

    return { success: true };
  }

  acceptTradeResponse(proposerId, tradeId, responderId) {
    const trade = activeTrades.get(tradeId);
    if (!trade) return { success: false, error: 'Trade expired' };
    if (trade.proposerId !== proposerId) return { success: false, error: 'Not your trade' };

    const response = trade.responses[responderId];
    if (!response || response.type === 'REJECT') return { success: false, error: 'Invalid response selected' };

    const players = this.room.getPlayers();
    const proposer = players.find(p => p.id === proposerId);
    const responder = players.find(p => p.id === responderId);
    if (!proposer || !responder) return { success: false, error: 'Player not found' };

    // Re-verify proposer has resources (they are giving `response.receive`)
    for (const [type, amount] of Object.entries(response.receive)) {
      if ((proposer.resources[type] || 0) < amount) {
        return { success: false, error: `${proposer.login} no longer has enough ${type}` };
      }
    }

    // Re-verify responder has resources (they are giving `response.give`)
    for (const [type, amount] of Object.entries(response.give)) {
      if ((responder.resources[type] || 0) < amount) {
        return { success: false, error: `${responder.login} no longer has enough ${type}` };
      }
    }

    // Execute trade
    for (const [type, amount] of Object.entries(response.receive)) {
      proposer.resources[type] -= amount;
      responder.resources[type] = (responder.resources[type] || 0) + amount;
    }
    for (const [type, amount] of Object.entries(response.give)) {
      responder.resources[type] -= amount;
      proposer.resources[type] = (proposer.resources[type] || 0) + amount;
    }

    activeTrades.delete(tradeId);

    this.broadcast('trade_completed', {
      tradeId,
      proposerId: trade.proposerId,
      proposerLogin: trade.proposerLogin,
      responderId,
      responderLogin: responder.login,
      give: response.receive, // What proposer gave
      receive: response.give, // What proposer received
    });

    // Send updated resources
    this.broadcast('resources_updated', {
      playerId: proposer.id,
      login: proposer.login,
      playerResources: proposer.resources,
      gained: [],
      reason: 'trade'
    });
    this.broadcast('resources_updated', {
      playerId: responder.id,
      login: responder.login,
      playerResources: responder.resources,
      gained: [],
      reason: 'trade'
    });

    this._broadcastState(players);
    return { success: true };
  }

  bankTrade(playerId, giveType, receiveType) {
    if (this.currentPhase !== 'GAMEPLAY') return { success: false, error: 'Cannot trade now' };
    if (this.turnOrder[this.currentTurn] !== playerId) return { success: false, error: 'Not your turn' };

    const players = this.room.getPlayers();
    const player = players.find(p => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };

    if ((player.resources[giveType] || 0) < 4) {
      return { success: false, error: `You need 4 ${giveType} for bank trade` };
    }

    player.resources[giveType] -= 4;
    player.addResource(receiveType, 1);

    this.events.push({ type: 'BANK_TRADE', playerId: player.id, give: giveType, receive: receiveType });

    this.broadcast('resources_updated', {
      playerId: player.id,
      login: player.login,
      playerResources: player.resources,
      gained: [{ type: receiveType, amount: 1 }],
      reason: 'bank_trade'
    });

    this._broadcastState(players);
    return { success: true };
  }

  cancelTrade(playerId, tradeId) {
    const trade = activeTrades.get(tradeId);
    if (trade && trade.proposerId === playerId) {
      activeTrades.delete(tradeId);
      this.broadcast('trade_cancelled', { tradeId });
      return { success: true };
    }
    return { success: false, error: 'Invalid trade' };
  }

  /**
   * Cleanup.
   */
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentPhase = 'ENDED';
  }
}

module.exports = GameEngine;
