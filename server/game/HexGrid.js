/**
 * HexGrid.js — Hex coordinate system using axial coordinates (q, r).
 * 
 * Flat-top hex grid. Each hex stores terrain type, owner, structures, and units.
 */

class HexGrid {
  /**
   * @param {number} radius — Grid radius (number of rings from center)
   */
  constructor(radius = 7) {
    this.radius = radius;
    this.hexes = new Map(); // key: "q,r" → hex data
    this.islands = [];       // list of resource island hexes
    this.generateMap();
  }

  static key(q, r) {
    return `${q},${r}`;
  }

  static parseKey(key) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  // Pointy-topped coordinate conversion
  static hexToPixel(q, r, size = 50) {
    const x = size * Math.sqrt(3) * (q + r / 2);
    const y = size * (3 / 2) * r;
    return { x, y };
  }

  static pixelToHex(px, py, size = 50) {
    const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / size;
    const r = ((2 / 3) * py) / size;
    return HexGrid.axialRound(q, r);
  }

  static getHexVertices(q, r, size = 50) {
    const { x, y } = HexGrid.hexToPixel(q, r, size);
    const vertices = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const vx = x + size * Math.cos(angle);
      const vy = y + size * Math.sin(angle);
      const id = `${Math.round(vx)},${Math.round(vy)}`;
      vertices.push({ x: vx, y: vy, id });
    }
    return vertices;
  }

  static getHexEdges(q, r, size = 50) {
    const vertices = HexGrid.getHexVertices(q, r, size);
    const edges = [];
    for (let i = 0; i < 6; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % 6];
      const arr = [v1.id, v2.id].sort();
      edges.push({ id: `e_${arr[0]}_${arr[1]}`, v1, v2 });
    }
    return edges;
  }

  generateMap() {
    // 19 Hexes total (radius = 2)
    const resourceDistribution = [
      'wood', 'wood', 'wood', 'wood',
      'stone', 'stone', 'stone', 'stone',
      'iron', 'iron', 'iron', 'iron',
      'gold', 'gold', 'gold', 'gold',
      'sea', 'sea', 'sea'
    ];
    // Numbers: 2 to 12 (18 tokens for resources, seas get 0)
    const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
    
    const shuffledResources = resourceDistribution.sort(() => Math.random() - 0.5);
    const shuffledNumbers = numbers.sort(() => Math.random() - 0.5);

    let hexIndex = 0;
    let numberIndex = 0;

    for (let q = -this.radius; q <= this.radius; q++) {
      for (let r = -this.radius; r <= this.radius; r++) {
        const s = -q - r;
        if (Math.abs(s) > this.radius) continue;

        const resType = shuffledResources[hexIndex++];
        let num = 0;
        if (resType !== 'sea') {
          num = shuffledNumbers[numberIndex++];
        }

        const hex = {
          q,
          r,
          terrain: resType === 'sea' ? 'sea' : 'island',
          resourceType: resType === 'sea' ? null : resType,
          diceNumber: num,
          owner: null,
          structure: null,
          units: [],
        };

        this.hexes.set(HexGrid.key(q, r), hex);
      }
    }
    
    // We will store structures in vertices and roads in edges in the GameEngine instead of HexGrid to decouple.
  }

  // Island/Capital placement logic is removed since Catan mode distributes resources directly in generateMap

  getCapitalPositions() {
    const r = this.radius;
    return [
      { q: -r, r: 0 },
      { q: r, r: 0 },
      { q: 0, r: -r },
      { q: 0, r: r },
    ];
  }

  assignCapital(playerIndex, playerId) {
    const positions = this.getCapitalPositions();
    const pos = positions[playerIndex];
    // We don't change hex owner, capitals are on vertices now in Catan
    return pos;
  }

  /**
   * Get hex data at coordinates.
   */
  getHex(q, r) {
    return this.hexes.get(HexGrid.key(q, r)) || null;
  }

  /**
   * Get the 6 neighbors of a hex.
   */
  getNeighbors(q, r) {
    const directions = [
      { q: 1, r: 0 },  { q: -1, r: 0 },
      { q: 0, r: 1 },  { q: 0, r: -1 },
      { q: 1, r: -1 }, { q: -1, r: 1 },
    ];

    return directions
      .map(d => this.getHex(q + d.q, r + d.r))
      .filter(h => h !== null);
  }

  /**
   * Calculate hex distance between two hexes (axial coordinates).
   */
  _hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs((q1 + r1) - (q2 + r2))) / 2;
  }

  /**
   * Public hex distance.
   */
  hexDistance(a, b) {
    return this._hexDistance(a.q, a.r, b.q, b.r);
  }

  /**
   * Check if a hex is adjacent to another.
   */
  isAdjacent(a, b) {
    return this._hexDistance(a.q, a.r, b.q, b.r) === 1;
  }

  /**
   * BFS: Check if a hex is connected to a player's capital via merchant ship chain.
   */
  isConnectedToCapital(playerId, targetHex, merchantShips) {
    const capitalHex = Array.from(this.hexes.values()).find(
      h => h.owner === playerId && h.structure === 'capital'
    );
    if (!capitalHex) return false;

    // Build adjacency from merchant ships owned by this player
    const playerMerchants = merchantShips.filter(m => m.playerId === playerId);
    const connections = new Map(); // hex key → Set of connected hex keys

    for (const merchant of playerMerchants) {
      const fromKey = HexGrid.key(merchant.fromHex.q, merchant.fromHex.r);
      const toKey = HexGrid.key(merchant.toHex.q, merchant.toHex.r);

      if (!connections.has(fromKey)) connections.set(fromKey, new Set());
      if (!connections.has(toKey)) connections.set(toKey, new Set());
      connections.get(fromKey).add(toKey);
      connections.get(toKey).add(fromKey);
    }

    // BFS from capital to target
    const capitalKey = HexGrid.key(capitalHex.q, capitalHex.r);
    const targetKey = HexGrid.key(targetHex.q, targetHex.r);

    if (capitalKey === targetKey) return true;

    const visited = new Set([capitalKey]);
    const queue = [capitalKey];

    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = connections.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (neighbor === targetKey) return true;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return false;
  }

  // Pixel conversion functions moved to static methods at the top

  /**
   * Round fractional hex coordinates to nearest hex.
   */
  static axialRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);

    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);

    if (qDiff > rDiff && qDiff > sDiff) {
      rq = -rr - rs;
    } else if (rDiff > sDiff) {
      rr = -rq - rs;
    }

    return { q: rq, r: rr };
  }

  /**
   * Serialize the full grid for client broadcast.
   */
  toJSON() {
    const hexArray = [];
    for (const [key, hex] of this.hexes) {
      hexArray.push({ ...hex });
    }
    return {
      radius: this.radius,
      hexes: hexArray,
      islands: this.islands,
      capitalPositions: this.getCapitalPositions(),
    };
  }
}

module.exports = HexGrid;
