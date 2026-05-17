/**
 * config.js — Central configuration loaded from environment variables.
 * All 42 OAuth and server settings are accessed from here.
 */
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-me',

  // 42 Intra OAuth 2.0
  FORTYTWO: {
    CLIENT_ID: process.env.FORTYTWO_CLIENT_ID,
    CLIENT_SECRET: process.env.FORTYTWO_CLIENT_SECRET,
    CALLBACK_URL: process.env.FORTYTWO_CALLBACK_URL || 'http://localhost:3000/auth/42/callback',
    AUTHORIZE_URL: 'https://api.intra.42.fr/oauth/authorize',
    TOKEN_URL: 'https://api.intra.42.fr/oauth/token',
    API_BASE: 'https://api.intra.42.fr/v2',
  },

  // Database
  DB_PATH: process.env.DB_PATH || './server/database/deep_sea_pulse.sqlite',

  // Game constants (Catan-style)
  GAME: {
    TURN_DURATION: 60,         // seconds per turn
    MAX_PLAYERS: parseInt(process.env.MAX_PLAYERS) || 4, // players per room
    VP_WIN: 10,                // victory points to win
    POINTS: {
      FIRST:  +50,
      SECOND: +20,
      THIRD:  -10,
      FOURTH: -20,
    },
  },
};
