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

  // Game constants
  GAME: {
    PULSE_DURATION: 20,        // seconds per planning phase
    MAX_PLAYERS: 4,            // players per room
    MAX_PULSES: 30,            // game ends after 30 pulses (10 min)
    ISLAND_CONTROL_WIN: 0.6,   // 60% island control = instant win
    POINTS: {
      FIRST:  +50,
      SECOND: +20,
      THIRD:  -10,
      FOURTH: -20,
    },
    NAVY_MOVE_RANGE: 1,        // hexes per pulse
    NAVY_DESTROY_MERCHANT: 2,  // navies needed to destroy merchant ship
    NAVY_DESTROY_VILLAGE: 5,   // navies needed to destroy village
    NAVY_DESTROY_CITY: 8,      // navies needed to destroy city
    VILLAGE_PRODUCTION: 1,     // resources per pulse
    CITY_PRODUCTION: 3,        // resources per pulse
  },
};
