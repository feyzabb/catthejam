/**
 * HexGrid.js — Catan-style hex board with vertex/edge system.
 * 
 * 19 hex tiles in the classic 3-4-5-4-3 Catan layout.
 * Flat-top hexagons with pointy-top rendering.
 * 
 * Resources: wood(4), stone(4), iron(3), gold(3), food(4), desert(1) = 19
 * Numbers: standard Catan distribution (no 7 on tiles)
 */

class HexGrid {
  constructor() {
    this.hexes = new Map();      // key: "q,r" → hex data
    this.vertices = new Map();   // key: "vX,Y" → vertex data  
    this.edges = new Map();      // key: "eX1,Y1_X2,Y2" → edge data
    this.robberHex = null;       // {q, r} of the robber/pirate position
    this.HEX_SIZE = 50;         // pixel size for vertex calculations
    this.generateCatanBoard();
    this.computeVerticesAndEdges();
  }

  static key(q, r) {
    return `${q},${r}`;
  }

  static parseKey(key) {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  /**
   * Generate the standard Catan 19-hex board.
   * Uses axial coordinates with radius 2.
   */
  generateCatanBoard() {
    // Standard Catan resource distribution (19 tiles)
    const resources = [
      'wood', 'wood', 'wood', 'wood',
      'stone', 'stone', 'stone',
      'iron', 'iron', 'iron',
      'gold', 'gold', 'gold',
      'food', 'food', 'food', 'food',
      'desert'
    ];

    // Standard Catan number tokens (18 numbers for 18 resource hexes)
    // Placed in specific order around the board spiral
    const numberTokens = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

    // Shuffle resources
    this._shuffle(resources);

    // Generate all hexes within radius 2
    const radius = 2;
    const hexCoords = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const s = -q - r;
        if (Math.abs(s) > radius) continue;
        hexCoords.push({ q, r });
      }
    }

    let resourceIndex = 0;
    let numberIndex = 0;

    for (const coord of hexCoords) {
      const resType = resources[resourceIndex++];
      const isDesert = resType === 'desert';

      const hex = {
        q: coord.q,
        r: coord.r,
        terrain: isDesert ? 'desert' : 'island',
        resourceType: isDesert ? null : resType,
        diceNumber: isDesert ? 0 : numberTokens[numberIndex++],
        hasRobber: isDesert, // robber starts on desert
      };

      if (isDesert) {
        this.robberHex = { q: coord.q, r: coord.r };
      }

      this.hexes.set(HexGrid.key(coord.q, coord.r), hex);
    }
  }

  /**
   * Compute all unique vertices and edges from the hex grid.
   * Vertices are intersection points where 2-3 hexes meet.
   * Edges connect adjacent vertices along hex borders.
   */
  computeVerticesAndEdges() {
    const vertexMap = new Map(); // rounded id → vertex data
    const edgeMap = new Map();

    for (const [key, hex] of this.hexes) {
      const verts = this._getHexVertices(hex.q, hex.r);

      // Register each vertex
      for (const v of verts) {
        if (!vertexMap.has(v.id)) {
          vertexMap.set(v.id, {
            id: v.id,
            x: v.x,
            y: v.y,
            adjacentHexes: [],
            adjacentVertices: [],
            adjacentEdges: [],
            building: null,    // null | { type: 'village'|'city', playerId }
          });
        }
        const vData = vertexMap.get(v.id);
        if (!vData.adjacentHexes.find(h => h.q === hex.q && h.r === hex.r)) {
          vData.adjacentHexes.push({ q: hex.q, r: hex.r });
        }
      }

      // Register edges (pairs of adjacent vertices)
      for (let i = 0; i < 6; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % 6];
        const edgeId = this._makeEdgeId(v1.id, v2.id);

        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            v1Id: v1.id,
            v2Id: v2.id,
            v1: { x: v1.x, y: v1.y },
            v2: { x: v2.x, y: v2.y },
            road: null,        // null | { playerId }
          });
        }
      }
    }

    // Build vertex adjacency lists
    for (const [edgeId, edge] of edgeMap) {
      const v1 = vertexMap.get(edge.v1Id);
      const v2 = vertexMap.get(edge.v2Id);
      if (v1 && v2) {
        if (!v1.adjacentVertices.includes(edge.v2Id)) v1.adjacentVertices.push(edge.v2Id);
        if (!v2.adjacentVertices.includes(edge.v1Id)) v2.adjacentVertices.push(edge.v1Id);
        if (!v1.adjacentEdges.includes(edgeId)) v1.adjacentEdges.push(edgeId);
        if (!v2.adjacentEdges.includes(edgeId)) v2.adjacentEdges.push(edgeId);
      }
    }

    this.vertices = vertexMap;
    this.edges = edgeMap;
  }

  /**
   * Get the 6 vertices of a pointy-top hex at axial (q,r).
   */
  _getHexVertices(q, r) {
    const { x: cx, y: cy } = this.hexToPixel(q, r);
    const vertices = [];
    for (let i = 0; i < 6; i++) {
      // Pointy-top: first vertex at 30 degrees
      const angle = (Math.PI / 180) * (60 * i - 30);
      const vx = cx + this.HEX_SIZE * Math.cos(angle);
      const vy = cy + this.HEX_SIZE * Math.sin(angle);
      // Round to avoid floating point issues
      const rx = Math.round(vx * 10) / 10;
      const ry = Math.round(vy * 10) / 10;
      vertices.push({ x: rx, y: ry, id: `v${rx},${ry}` });
    }
    return vertices;
  }

  _makeEdgeId(v1Id, v2Id) {
    return [v1Id, v2Id].sort().join('_');
  }

  /**
   * Convert axial hex coordinates to pixel position (pointy-top).
   */
  hexToPixel(q, r) {
    const x = this.HEX_SIZE * Math.sqrt(3) * (q + r / 2);
    const y = this.HEX_SIZE * (3 / 2) * r;
    return { x, y };
  }

  /**
   * Get hex data at coordinates.
   */
  getHex(q, r) {
    return this.hexes.get(HexGrid.key(q, r)) || null;
  }

  /**
   * Get all hexes adjacent to a vertex.
   */
  getHexesForVertex(vertexId) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex) return [];
    return vertex.adjacentHexes.map(h => this.getHex(h.q, h.r)).filter(Boolean);
  }

  /**
   * Place a building (village or city) at a vertex.
   * Returns true if successful.
   */
  placeBuilding(vertexId, playerId, type) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex) return false;
    if (vertex.building) return false; // already occupied

    // Distance rule: no adjacent vertex can have a building
    for (const adjId of vertex.adjacentVertices) {
      const adj = this.vertices.get(adjId);
      if (adj && adj.building) return false;
    }

    vertex.building = { type, playerId };
    return true;
  }

  /**
   * Upgrade a village to a city at a vertex.
   */
  upgradeToCity(vertexId, playerId) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex || !vertex.building) return false;
    if (vertex.building.playerId !== playerId) return false;
    if (vertex.building.type !== 'village') return false;

    vertex.building.type = 'city';
    return true;
  }

  /**
   * Place a road on an edge.
   */
  placeRoad(edgeId, playerId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    if (edge.road) return false; // already occupied

    // Must be adjacent to player's existing road or building
    const v1 = this.vertices.get(edge.v1Id);
    const v2 = this.vertices.get(edge.v2Id);

    const hasConnection = (v1 && v1.building && v1.building.playerId === playerId) ||
                          (v2 && v2.building && v2.building.playerId === playerId) ||
                          this._hasAdjacentRoad(edge.v1Id, playerId) ||
                          this._hasAdjacentRoad(edge.v2Id, playerId);

    if (!hasConnection) return false;

    edge.road = { playerId };
    return true;
  }

  /**
   * Place a road without adjacency checks (for setup phase).
   */
  placeRoadFree(edgeId, playerId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;
    if (edge.road) return false;
    edge.road = { playerId };
    return true;
  }

  /**
   * Place a building without distance rule checks (for setup phase).
   */
  placeBuildingFree(vertexId, playerId, type) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex) return false;
    if (vertex.building) return false;
    vertex.building = { type, playerId };
    return true;
  }

  /**
   * Check if a vertex has an adjacent road owned by a player.
   */
  _hasAdjacentRoad(vertexId, playerId) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex) return false;
    for (const edgeId of vertex.adjacentEdges) {
      const edge = this.edges.get(edgeId);
      if (edge && edge.road && edge.road.playerId === playerId) return true;
    }
    return false;
  }

  /**
   * Distribute resources based on a dice roll.
   * Returns array of { playerId, resourceType, amount } objects.
   */
  distributeResources(diceTotal) {
    const distributions = [];

    for (const [key, hex] of this.hexes) {
      if (hex.diceNumber !== diceTotal) continue;
      if (hex.hasRobber) continue; // robber blocks production
      if (!hex.resourceType) continue;

      // Find all vertices of this hex that have buildings
      const verts = this._getHexVertices(hex.q, hex.r);
      for (const v of verts) {
        const vertex = this.vertices.get(v.id);
        if (!vertex || !vertex.building) continue;

        const amount = vertex.building.type === 'city' ? 2 : 1;
        distributions.push({
          playerId: vertex.building.playerId,
          resourceType: hex.resourceType,
          amount,
          hex: { q: hex.q, r: hex.r },
        });
      }
    }

    return distributions;
  }

  /**
   * Move the robber/pirate to a new hex.
   */
  moveRobber(q, r) {
    // Remove from old position
    if (this.robberHex) {
      const oldHex = this.getHex(this.robberHex.q, this.robberHex.r);
      if (oldHex) oldHex.hasRobber = false;
    }

    const newHex = this.getHex(q, r);
    if (newHex) {
      newHex.hasRobber = true;
      this.robberHex = { q, r };
    }
  }

  /**
   * Get the 6 neighbors of a hex.
   */
  getNeighbors(q, r) {
    const directions = [
      { q: 1, r: 0 }, { q: -1, r: 0 },
      { q: 0, r: 1 }, { q: 0, r: -1 },
      { q: 1, r: -1 }, { q: -1, r: 1 },
    ];
    return directions
      .map(d => this.getHex(q + d.q, r + d.r))
      .filter(h => h !== null);
  }

  /**
   * Calculate hex distance between two hexes.
   */
  hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
  }

  /**
   * Get all vertices that belong to an edge.
   */
  getEdgeVertices(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return [];
    return [this.vertices.get(edge.v1Id), this.vertices.get(edge.v2Id)].filter(Boolean);
  }

  /**
   * Check if a vertex is on the coast (adjacent to fewer than 3 hexes).
   */
  isCoastalVertex(vertexId) {
    const vertex = this.vertices.get(vertexId);
    if (!vertex) return false;
    return vertex.adjacentHexes.length < 3;
  }

  /**
   * Count victory points for a player.
   */
  getPlayerVP(playerId) {
    let vp = 0;
    for (const [id, vertex] of this.vertices) {
      if (vertex.building && vertex.building.playerId === playerId) {
        vp += vertex.building.type === 'city' ? 2 : 1;
      }
    }
    return vp;
  }

  /**
   * Count longest road for a player (simplified).
   */
  getPlayerRoadLength(playerId) {
    let count = 0;
    for (const [id, edge] of this.edges) {
      if (edge.road && edge.road.playerId === playerId) count++;
    }
    return count;
  }

  /**
   * Fisher-Yates shuffle.
   */
  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Serialize for client broadcast.
   */
  toJSON() {
    const hexArray = [];
    for (const [key, hex] of this.hexes) {
      hexArray.push({ ...hex });
    }

    const vertexArray = [];
    for (const [id, v] of this.vertices) {
      vertexArray.push({
        id: v.id,
        x: v.x,
        y: v.y,
        adjacentHexes: v.adjacentHexes,
        adjacentVertices: v.adjacentVertices,
        adjacentEdges: v.adjacentEdges,
        building: v.building,
      });
    }

    const edgeArray = [];
    for (const [id, e] of this.edges) {
      edgeArray.push({
        id: e.id,
        v1Id: e.v1Id,
        v2Id: e.v2Id,
        v1: e.v1,
        v2: e.v2,
        road: e.road,
      });
    }

    return {
      hexes: hexArray,
      vertices: vertexArray,
      edges: edgeArray,
      robberHex: this.robberHex,
    };
  }
}

module.exports = HexGrid;
