/**
 * oauth42.js — 42 Intra OAuth 2.0 authentication flow.
 * 
 * Flow:
 *   1. GET /auth/42/login → Redirect to 42 authorize URL
 *   2. 42 redirects back → GET /auth/42/callback?code=XXX
 *   3. Exchange code for access_token
 *   4. Fetch user profile + coalition data from 42 API
 *   5. Upsert player in database
 *   6. Set session, redirect to lobby
 */
const express = require('express');
const fetch = require('node-fetch');
const config = require('../config');
const db = require('../database/db');

const router = express.Router();

/**
 * Step 1: Redirect to 42 Intra authorization page.
 */
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: config.FORTYTWO.CLIENT_ID,
    redirect_uri: config.FORTYTWO.CALLBACK_URL,
    response_type: 'code',
    scope: 'public',
  });
  res.redirect(`${config.FORTYTWO.AUTHORIZE_URL}?${params.toString()}`);
});

/**
 * Step 2: Handle the callback from 42 Intra.
 */
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    // Step 3: Exchange code for access token
    const tokenResponse = await fetch(config.FORTYTWO.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: config.FORTYTWO.CLIENT_ID,
        client_secret: config.FORTYTWO.CLIENT_SECRET,
        code,
        redirect_uri: config.FORTYTWO.CALLBACK_URL,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('[OAuth] Token exchange failed:', tokenData);
      return res.status(401).json({ error: 'Failed to obtain access token' });
    }

    const accessToken = tokenData.access_token;

    // Step 4: Fetch user profile
    const userResponse = await fetch(`${config.FORTYTWO.API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userResponse.json();

    // Step 5: Extract coalition data (first active coalition)
    let coalition = {
      id: null,
      name: 'Unaffiliated',
      color: '#5B7C99',
      imageUrl: null,
    };

    if (userData.coalitions && userData.coalitions.length > 0) {
      // Find the user's active coalition from coalitions_users
      const activeCoalition = userData.coalitions[0];
      coalition = {
        id: activeCoalition.id,
        name: activeCoalition.name || 'Unknown',
        color: activeCoalition.color || '#5B7C99',
        imageUrl: activeCoalition.image_url || null,
      };
    }

    // Step 6: Upsert player in database
    const upsertStmt = db.prepare(`
      INSERT INTO players (intra_id, login, display_name, avatar_url,
                           coalition_id, coalition_name, coalition_color, coalition_image_url,
                           last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(intra_id) DO UPDATE SET
        login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        coalition_id = excluded.coalition_id,
        coalition_name = excluded.coalition_name,
        coalition_color = excluded.coalition_color,
        coalition_image_url = excluded.coalition_image_url,
        last_login = CURRENT_TIMESTAMP
    `);

    upsertStmt.run(
      userData.id,
      userData.login,
      userData.displayname || userData.login,
      userData.image?.link || null,
      coalition.id,
      coalition.name,
      coalition.color,
      coalition.imageUrl
    );

    // Get the full player record
    const player = db.prepare('SELECT * FROM players WHERE intra_id = ?').get(userData.id);

    // Step 7: Set session
    req.session.user = {
      id: player.id,
      intraId: player.intra_id,
      login: player.login,
      displayName: player.display_name,
      avatarUrl: player.avatar_url,
      coalitionId: player.coalition_id,
      coalitionName: player.coalition_name,
      coalitionColor: player.coalition_color,
      coalitionImageUrl: player.coalition_image_url,
      eloPoints: player.elo_points,
    };

    console.log(`[OAuth] Player logged in: ${player.login} (${coalition.name})`);

    // Redirect to lobby
    res.redirect('/');
  } catch (err) {
    console.error('[OAuth] Error during authentication:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Direct Login for Game Jam (Client Credentials Grant)
 * Bypasses OAuth redirect, logs in any valid 42 intra user by login name.
 */
router.post('/direct-login', async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ error: 'Login required' });

  try {
    // 1. Get an App Token using Client Credentials
    const tokenResponse = await fetch(config.FORTYTWO.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.FORTYTWO.CLIENT_ID,
        client_secret: config.FORTYTWO.CLIENT_SECRET,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error('[OAuth] Client Credentials failed:', tokenData);
      return res.status(500).json({ error: 'Backend Auth Failed' });
    }

    // 2. Fetch User Profile
    const userResponse = await fetch(`${config.FORTYTWO.API_BASE}/users/${login.toLowerCase()}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (userResponse.status === 404) {
      return res.status(404).json({ error: 'User not found in 42 Intra' });
    }

    const userData = await userResponse.json();

    // 3. Extract coalition data (first active coalition)
    let coalition = { id: null, name: 'Unaffiliated', color: '#5B7C99', imageUrl: null };
    
    // To get the actual coalition, we hit /users/:id/coalitions
    const coalResponse = await fetch(`${config.FORTYTWO.API_BASE}/users/${userData.id}/coalitions`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (coalResponse.ok) {
      const coalitions = await coalResponse.json();
      if (coalitions && coalitions.length > 0) {
        const activeCoalition = coalitions[0];
        coalition = {
          id: activeCoalition.id,
          name: activeCoalition.name || 'Unknown',
          color: activeCoalition.color || '#5B7C99',
          imageUrl: activeCoalition.image_url || null,
        };
      }
    }

    // 4. Upsert player in database
    const upsertStmt = db.prepare(`
      INSERT INTO players (intra_id, login, display_name, avatar_url,
                           coalition_id, coalition_name, coalition_color, coalition_image_url,
                           last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(intra_id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        coalition_id = excluded.coalition_id,
        coalition_name = excluded.coalition_name,
        coalition_color = excluded.coalition_color,
        coalition_image_url = excluded.coalition_image_url,
        last_login = CURRENT_TIMESTAMP
    `);

    upsertStmt.run(
      userData.id,
      userData.login,
      userData.displayname || userData.login,
      userData.image?.link || null,
      coalition.id,
      coalition.name,
      coalition.color,
      coalition.imageUrl
    );

    const player = db.prepare('SELECT * FROM players WHERE intra_id = ?').get(userData.id);

    // 5. Set session
    req.session.user = {
      id: player.id,
      intraId: player.intra_id,
      login: player.login,
      displayName: player.display_name,
      avatarUrl: player.avatar_url,
      coalitionId: player.coalition_id,
      coalitionName: player.coalition_name,
      coalitionColor: player.coalition_color,
      coalitionImageUrl: player.coalition_image_url,
      eloPoints: player.elo_points,
    };

    console.log(`[OAuth] Direct Login Success: ${player.login} (${coalition.name})`);
    res.json({ success: true });
  } catch (err) {
    console.error('[OAuth] Error during direct login:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Logout — destroy session.
 */
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/**
 * Get current authenticated user (API endpoint for client).
 */
router.get('/me', (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
