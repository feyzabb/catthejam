/**
 * GameEngine.js — Core game loop: Pulse timer, command batching, and resolution.
 * 
 * Resolution order per Pulse:
 *   1. Navy Movement
 *   2. Combat Resolution (stacking)
 *   3. Merchant Ship Placement
 *   4. Building Phase
 *   5. Resource Collection
 *   6. Victory Check
 */
const config = require('../config');
const HexGrid = require('./HexGrid');
const { v4: uuidv4 } = require('uuid');

class GameEngine {
  /**
   * @param {Room} room — The parent room instance
   * @param {Function} broadcastFn — Function to broadcast events to the room
   */
  constructor(room, broadcastFn) {
    this.room = room;
    this.broadcast = broadcastFn;

    // Game state
    this.grid = new HexGrid(2); // Radius 2 creates exactly 19 hexes
    this.pulseNumber = 0;
    this.phase = 'waiting'; // 'waiting' | 'planning' | 'resolving' | 'ended'
    this.timer = null;
    this.timeRemaining = config.GAME.PULSE_DURATION;

    // All merchant ships in the game (across all players)
    this.allMerchantShips = [];

    // Event log for animations
    this.pulseEvents = [];
  }

  /**
   * Initialize the game: assign capitals, give starting units.
   */
  initialize(players) {
    // Assign capitals to each player
    players.forEach((player, index) => {
      const capitalPos = this.grid.assignCapital(index, player.id);
      player.capitalHex = capitalPos;

      // Starting navy at capital
      const navyId = uuidv4();
      player.navies.push({ id: navyId, hex: { ...capitalPos } });

      // Place the navy on the grid
      const hex = this.grid.getHex(capitalPos.q, capitalPos.r);
      if (hex) {
        hex.units.push({ playerId: player.id, type: 'navy', id: navyId });
      }
    });

    console.log(`[GameEngine] Game initialized with ${players.length} players`);
  }

  /**
   * Start the game loop — first planning phase.
   */
  start() {
    this.phase = 'planning';
    this.pulseNumber = 1;
    this._startPlanningPhase();
  }

  /**
   * Begin a planning phase with a countdown timer.
   */
  _startPlanningPhase() {
    this.timeRemaining = config.GAME.PULSE_DURATION;
    this.phase = 'planning';

    this.broadcast('game:phaseStart', {
      phase: 'planning',
      pulseNumber: this.pulseNumber,
      timer: this.timeRemaining,
    });

    // Countdown timer — tick every second
    this.timer = setInterval(() => {
      this.timeRemaining--;

      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this._executePulse();
      }
    }, 1000);
  }

  /**
   * Execute the Pulse — resolve all batched commands.
   */
  _executePulse() {
    this.phase = 'resolving';
    this.pulseEvents = [];
    const players = this.room.getPlayers();

    console.log(`[GameEngine] Pulse #${this.pulseNumber} — Resolving commands`);

    // Gather all commands from all players
    const allCommands = [];
    for (const player of players) {
      allCommands.push(...player.pendingCommands);
    }

    // === RESOLUTION ORDER ===

    // 1. Navy Movement
    this._resolveNavyMovement(allCommands, players);

    // 2. Combat Resolution (stacking)
    this._resolveCombat(players);

    // 3. Merchant Ship Placement
    this._resolveMerchantPlacement(allCommands, players);

    // 4. Building Phase
    this._resolveBuilding(allCommands, players);

    // 5. Resource Collection
    this._resolveResourceCollection(players);

    // 6. Clear commands
    for (const player of players) {
      player.clearCommands();
    }

    // 7. Victory Check
    const victor = this._checkVictory(players);

    // Broadcast pulse result
    this.broadcast('game:pulseResult', {
      pulseNumber: this.pulseNumber,
      grid: this.grid.toJSON(),
      players: players.map(p => p.toPublicJSON()),
      events: this.pulseEvents,
      victor: victor ? victor.toPublicJSON() : null,
    });

    if (victor) {
      this._endGame(players);
      return;
    }

    // Check max pulses
    if (this.pulseNumber >= config.GAME.MAX_PULSES) {
      this._endGame(players);
      return;
    }

    // Next pulse
    this.pulseNumber++;
    this._startPlanningPhase();
  }

  /**
   * Step 1: Resolve Navy movement commands.
   */
  _resolveNavyMovement(commands, players) {
    const moveCommands = commands.filter(c => c.type === 'MOVE_NAVY');

    for (const cmd of moveCommands) {
      const player = players.find(p => p.id === cmd.playerId);
      if (!player) continue;

      const navy = player.navies.find(n => n.id === cmd.navyId);
      if (!navy) continue;

      const target = cmd.targetHex;
      if (!target) continue;

      // Validate: target is within 1 hex range
      const dist = this.grid.hexDistance(navy.hex, target);
      if (dist > config.GAME.NAVY_MOVE_RANGE) continue;

      // Validate: target hex exists
      const targetHex = this.grid.getHex(target.q, target.r);
      if (!targetHex) continue;

      // Remove from old hex
      const oldHex = this.grid.getHex(navy.hex.q, navy.hex.r);
      if (oldHex) {
        oldHex.units = oldHex.units.filter(u => u.id !== navy.id);
      }

      // Move to new hex
      navy.hex = { q: target.q, r: target.r };
      targetHex.units.push({ playerId: player.id, type: 'navy', id: navy.id });

      this.pulseEvents.push({
        type: 'NAVY_MOVED',
        playerId: player.id,
        navyId: navy.id,
        from: { q: oldHex?.q, r: oldHex?.r },
        to: target,
      });
    }
  }

  /**
   * Step 2: Resolve combat via stacking — count navies per hex per player.
   */
  _resolveCombat(players) {
    // Check each hex for multi-player navy presence
    for (const [key, hex] of this.grid.hexes) {
      const naviesOnHex = hex.units.filter(u => u.type === 'navy');
      if (naviesOnHex.length === 0) continue;

      // Group navies by player
      const byPlayer = {};
      for (const navy of naviesOnHex) {
        if (!byPlayer[navy.playerId]) byPlayer[navy.playerId] = [];
        byPlayer[navy.playerId].push(navy);
      }

      const playerIds = Object.keys(byPlayer).map(Number);
      if (playerIds.length <= 1) continue; // No conflict

      // Find the dominant player (most navies)
      let maxNavies = 0;
      let dominantPlayer = null;
      for (const [pid, navies] of Object.entries(byPlayer)) {
        if (navies.length > maxNavies) {
          maxNavies = navies.length;
          dominantPlayer = Number(pid);
        }
      }

      // Destroy enemy merchant ships on this hex
      const merchantsOnHex = this.allMerchantShips.filter(
        m => (HexGrid.key(m.fromHex.q, m.fromHex.r) === key ||
              HexGrid.key(m.toHex.q, m.toHex.r) === key) &&
             m.playerId !== dominantPlayer
      );

      for (const merchant of merchantsOnHex) {
        if (maxNavies >= config.GAME.NAVY_DESTROY_MERCHANT) {
          this._destroyMerchant(merchant, players);
          this.pulseEvents.push({
            type: 'MERCHANT_DESTROYED',
            playerId: merchant.playerId,
            hex: { q: hex.q, r: hex.r },
            destroyedBy: dominantPlayer,
          });
        }
      }

      // Destroy enemy structures
      if (hex.owner && hex.owner !== dominantPlayer) {
        if (hex.structure === 'village' && maxNavies >= config.GAME.NAVY_DESTROY_VILLAGE) {
          // Loot resources
          this._lootStructure(hex, dominantPlayer, players);
          hex.structure = null;
          hex.owner = null;
          this.pulseEvents.push({
            type: 'VILLAGE_DESTROYED',
            hex: { q: hex.q, r: hex.r },
            destroyedBy: dominantPlayer,
          });
        } else if (hex.structure === 'city' && maxNavies >= config.GAME.NAVY_DESTROY_CITY) {
          this._lootStructure(hex, dominantPlayer, players);
          hex.structure = null;
          hex.owner = null;
          this.pulseEvents.push({
            type: 'CITY_DESTROYED',
            hex: { q: hex.q, r: hex.r },
            destroyedBy: dominantPlayer,
          });
        }
      }
    }
  }

  /**
   * Destroy a merchant ship.
   */
  _destroyMerchant(merchant, players) {
    // Remove from global list
    this.allMerchantShips = this.allMerchantShips.filter(m => m.id !== merchant.id);

    // Remove from player
    const owner = players.find(p => p.id === merchant.playerId);
    if (owner) {
      owner.merchantShips = owner.merchantShips.filter(m => m.id !== merchant.id);
    }

    // Remove from hex units
    const fromHex = this.grid.getHex(merchant.fromHex.q, merchant.fromHex.r);
    const toHex = this.grid.getHex(merchant.toHex.q, merchant.toHex.r);
    if (fromHex) fromHex.units = fromHex.units.filter(u => u.id !== merchant.id);
    if (toHex) toHex.units = toHex.units.filter(u => u.id !== merchant.id);
  }

  /**
   * Loot resources from a destroyed structure.
   */
  _lootStructure(hex, looterPlayerId, players) {
    const looter = players.find(p => p.id === looterPlayerId);
    if (!looter || !hex.resourceType) return;

    const amount = hex.structure === 'city' ? 5 : 2;
    looter.addResource(hex.resourceType, amount);
    this.pulseEvents.push({
      type: 'RESOURCES_LOOTED',
      playerId: looterPlayerId,
      resourceType: hex.resourceType,
      amount,
      hex: { q: hex.q, r: hex.r },
    });
  }

  /**
   * Step 3: Resolve merchant ship placement.
   */
  _resolveMerchantPlacement(commands, players) {
    const placeCommands = commands.filter(c => c.type === 'PLACE_MERCHANT');

    for (const cmd of placeCommands) {
      const player = players.find(p => p.id === cmd.playerId);
      if (!player) continue;

      const fromHex = this.grid.getHex(cmd.fromHex?.q, cmd.fromHex?.r);
      const toHex = this.grid.getHex(cmd.toHex?.q, cmd.toHex?.r);
      if (!fromHex || !toHex) continue;

      // Validate: hexes must be adjacent
      if (!this.grid.isAdjacent(cmd.fromHex, cmd.toHex)) continue;

      // Cost: 2 wood per merchant ship
      if (!player.spendResource('wood', 2)) continue;

      const merchantId = uuidv4();
      const merchant = {
        id: merchantId,
        playerId: player.id,
        fromHex: { ...cmd.fromHex },
        toHex: { ...cmd.toHex },
      };

      player.merchantShips.push(merchant);
      this.allMerchantShips.push(merchant);

      // Place on grid
      fromHex.units.push({ playerId: player.id, type: 'merchant', id: merchantId });
      toHex.units.push({ playerId: player.id, type: 'merchant', id: merchantId });

      this.pulseEvents.push({
        type: 'MERCHANT_PLACED',
        playerId: player.id,
        fromHex: cmd.fromHex,
        toHex: cmd.toHex,
      });
    }
  }

  /**
   * Step 4: Resolve building commands (villages and cities).
   */
  _resolveBuilding(commands, players) {
    // Build villages
    const villageCommands = commands.filter(c => c.type === 'BUILD_VILLAGE');
    for (const cmd of villageCommands) {
      const player = players.find(p => p.id === cmd.playerId);
      if (!player) continue;

      const hex = this.grid.getHex(cmd.hex?.q, cmd.hex?.r);
      if (!hex || hex.terrain !== 'island') continue;
      if (hex.structure) continue; // already built

      // Cost: 5 wood + 3 stone
      if (!player.spendResource('wood', 5)) continue;
      if (!player.spendResource('stone', 3)) {
        player.addResource('wood', 5); // refund wood
        continue;
      }

      hex.structure = 'village';
      hex.owner = player.id;
      player.villages.push({ id: uuidv4(), hex: { ...cmd.hex }, resourceType: hex.resourceType });

      this.pulseEvents.push({
        type: 'VILLAGE_BUILT',
        playerId: player.id,
        hex: cmd.hex,
        resourceType: hex.resourceType,
      });
    }

    // Upgrade to city
    const cityCommands = commands.filter(c => c.type === 'UPGRADE_CITY');
    for (const cmd of cityCommands) {
      const player = players.find(p => p.id === cmd.playerId);
      if (!player) continue;

      const hex = this.grid.getHex(cmd.hex?.q, cmd.hex?.r);
      if (!hex || hex.structure !== 'village' || hex.owner !== player.id) continue;

      // Cost: 10 stone + 5 iron
      if (!player.spendResource('stone', 10)) continue;
      if (!player.spendResource('iron', 5)) {
        player.addResource('stone', 10); // refund
        continue;
      }

      hex.structure = 'city';
      // Move from villages to cities
      player.villages = player.villages.filter(
        v => !(v.hex.q === cmd.hex.q && v.hex.r === cmd.hex.r)
      );
      player.cities.push({ id: uuidv4(), hex: { ...cmd.hex }, resourceType: hex.resourceType });

      this.pulseEvents.push({
        type: 'CITY_UPGRADED',
        playerId: player.id,
        hex: cmd.hex,
      });
    }

    // Build Navy at capital
    const navyCommands = commands.filter(c => c.type === 'BUILD_NAVY');
    for (const cmd of navyCommands) {
      const player = players.find(p => p.id === cmd.playerId);
      if (!player) continue;

      // Cost: 5 wood + 3 iron
      if (!player.spendResource('wood', 5)) continue;
      if (!player.spendResource('iron', 3)) {
        player.addResource('wood', 5);
        continue;
      }

      const navyId = uuidv4();
      const capitalHex = player.capitalHex;
      player.navies.push({ id: navyId, hex: { ...capitalHex } });

      const hex = this.grid.getHex(capitalHex.q, capitalHex.r);
      if (hex) {
        hex.units.push({ playerId: player.id, type: 'navy', id: navyId });
      }

      this.pulseEvents.push({
        type: 'NAVY_BUILT',
        playerId: player.id,
        hex: capitalHex,
      });
    }
  }

  /**
   * Step 5: Resource collection — villages/cities produce resources
   * only if connected to capital via merchant ship chain.
   */
  _resolveResourceCollection(players) {
    for (const player of players) {
      // Villages
      for (const village of player.villages) {
        const connected = this.grid.isConnectedToCapital(
          player.id, village.hex, this.allMerchantShips
        );
        if (connected && village.resourceType) {
          player.addResource(village.resourceType, config.GAME.VILLAGE_PRODUCTION);
          this.pulseEvents.push({
            type: 'RESOURCE_PRODUCED',
            playerId: player.id,
            hex: village.hex,
            resourceType: village.resourceType,
            amount: config.GAME.VILLAGE_PRODUCTION,
          });
        }
      }

      // Cities
      for (const city of player.cities) {
        const connected = this.grid.isConnectedToCapital(
          player.id, city.hex, this.allMerchantShips
        );
        if (connected && city.resourceType) {
          player.addResource(city.resourceType, config.GAME.CITY_PRODUCTION);
          this.pulseEvents.push({
            type: 'RESOURCE_PRODUCED',
            playerId: player.id,
            hex: city.hex,
            resourceType: city.resourceType,
            amount: config.GAME.CITY_PRODUCTION,
          });
        }
      }
    }
  }

  /**
   * Step 6: Check for victory conditions.
   */
  _checkVictory(players) {
    const totalIslands = this.grid.islands.length;
    if (totalIslands === 0) return null;

    for (const player of players) {
      // Check island control percentage
      const ownedIslands = Array.from(this.grid.hexes.values()).filter(
        h => h.terrain === 'island' && h.owner === player.id
      ).length;

      if (ownedIslands / totalIslands >= config.GAME.ISLAND_CONTROL_WIN) {
        return player;
      }
    }

    return null;
  }

  /**
   * End the game — determine placements and record results.
   */
  _endGame(players) {
    this.phase = 'ended';
    clearInterval(this.timer);

    // Rank players by total resources
    const ranked = players
      .map(p => ({ player: p, score: p.getTotalResources() }))
      .sort((a, b) => b.score - a.score);

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
      placement: index + 1,
      score: entry.score,
      pointsChange: pointsTable[index] || 0,
      resources: { ...entry.player.resources },
    }));

    this.broadcast('game:ended', {
      pulseNumber: this.pulseNumber,
      placements,
    });

    // Return placements for Room to record in DB
    return placements;
  }

  /**
   * Get the current game state for a newly connected/reconnecting player.
   */
  getFullState(players) {
    return {
      phase: this.phase,
      pulseNumber: this.pulseNumber,
      timeRemaining: this.timeRemaining,
      grid: this.grid.toJSON(),
      players: players.map(p => p.toPublicJSON()),
    };
  }

  /**
   * Cleanup when game is destroyed.
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
