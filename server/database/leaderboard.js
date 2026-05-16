/**
 * leaderboard.js — Leaderboard and player database queries.
 */
const db = require('./db');

const leaderboard = {
  /**
   * Get the top N players by ELO points.
   */
  getTop(limit = 20) {
    return db.prepare(`
      SELECT id, login, display_name, avatar_url,
             coalition_name, coalition_color, coalition_image_url,
             elo_points, matches_played, wins
      FROM players
      ORDER BY elo_points DESC
      LIMIT ?
    `).all(limit);
  },

  /**
   * Get a single player's rank and stats.
   */
  getPlayerStats(intraId) {
    const player = db.prepare(`
      SELECT *, (
        SELECT COUNT(*) + 1 FROM players p2
        WHERE p2.elo_points > players.elo_points
      ) as rank
      FROM players WHERE intra_id = ?
    `).get(intraId);
    return player || null;
  },

  /**
   * Get recent match history for a player.
   */
  getMatchHistory(playerId, limit = 10) {
    return db.prepare(`
      SELECT mr.placement, mr.points_change, mr.final_resources,
             m.room_code, m.started_at, m.ended_at, m.total_pulses
      FROM match_results mr
      JOIN matches m ON mr.match_id = m.id
      WHERE mr.player_id = ?
      ORDER BY m.started_at DESC
      LIMIT ?
    `).all(playerId, limit);
  },

  /**
   * Record a completed match and update player ELO.
   * @param {string} roomCode
   * @param {number} totalPulses
   * @param {Array<{playerId, placement, pointsChange, finalResources}>} results
   */
  recordMatch(roomCode, totalPulses, results) {
    const insertMatch = db.prepare(`
      INSERT INTO matches (room_code, ended_at, total_pulses, winner_id)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?)
    `);

    const insertResult = db.prepare(`
      INSERT INTO match_results (match_id, player_id, placement, points_change, final_resources)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateElo = db.prepare(`
      UPDATE players
      SET elo_points = MAX(0, elo_points + ?),
          matches_played = matches_played + 1,
          wins = wins + ?
      WHERE id = ?
    `);

    // Run in a transaction for atomicity
    const transaction = db.transaction(() => {
      const winnerId = results.find(r => r.placement === 1)?.playerId;
      const matchInfo = insertMatch.run(roomCode, totalPulses, winnerId);
      const matchId = matchInfo.lastInsertRowid;

      for (const result of results) {
        insertResult.run(
          matchId,
          result.playerId,
          result.placement,
          result.pointsChange,
          JSON.stringify(result.finalResources || {})
        );

        updateElo.run(
          result.pointsChange,
          result.placement === 1 ? 1 : 0,
          result.playerId
        );
      }

      return matchId;
    });

    return transaction();
  },
};

module.exports = leaderboard;
