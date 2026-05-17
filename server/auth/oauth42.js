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
    req.session.save(() => {
      res.redirect('/');
    });
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
    let userData, coalition;
    let fetched = false;

    // Try 42 API if credentials exist
    if (config.FORTYTWO.CLIENT_ID && config.FORTYTWO.CLIENT_SECRET) {
      try {
        const tokenResponse = await fetch(config.FORTYTWO.TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: config.FORTYTWO.CLIENT_ID,
            client_secret: config.FORTYTWO.CLIENT_SECRET,
          }),
          timeout: 5000,
        });

        const tokenData = await tokenResponse.json();
        if (tokenData.access_token) {
          const userResponse = await fetch(`${config.FORTYTWO.API_BASE}/users/${login.toLowerCase()}`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
            timeout: 5000,
          });

          if (userResponse.ok) {
            userData = await userResponse.json();
            coalition = { id: null, name: 'Unaffiliated', color: '#5B7C99', imageUrl: null };

            try {
              const coalResponse = await fetch(`${config.FORTYTWO.API_BASE}/users/${userData.id}/coalitions`, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
                timeout: 5000,
              });
              if (coalResponse.ok) {
                const coalitions = await coalResponse.json();
                if (coalitions && coalitions.length > 0) {
                  coalition = {
                    id: coalitions[0].id,
                    name: coalitions[0].name || 'Unknown',
                    color: coalitions[0].color || '#5B7C99',
                    imageUrl: coalitions[0].image_url || null,
                  };
                }
              }
            } catch (e) { /* coalition fetch failed, use default */ }
            fetched = true;
          }
        }
      } catch (apiErr) {
        console.warn(`[OAuth] 42 API unreachable, falling back to mock for ${login}:`, apiErr.code || apiErr.message);
      }
    }

    // Fallback: mock user data
    if (!fetched) {
      // Deterministic ID from login string (so same login = same user)
      let hash = 0;
      for (let i = 0; i < login.length; i++) {
        hash = ((hash << 5) - hash) + login.charCodeAt(i);
        hash |= 0;
      }
      const mockId = Math.abs(hash) % 100000 + 1000;

      const colors = ['#3B82F6', '#EF4444', '#22C55E', '#A855F7', '#38bdf8', '#fb923c'];
      const names = ['The Order', 'The Assembly', 'The Alliance', 'The Federation'];
      const idx = mockId % colors.length;

      userData = {
        id: mockId,
        login: login,
        displayname: login,
        image: { link: null },
      };
      coalition = {
        id: (mockId % 4) + 1,
        name: names[mockId % names.length],
        color: colors[idx],
        imageUrl: null,
      };
      console.log(`[OAuth] Mock login: ${login} (id=${mockId}, coalition=${coalition.name})`);
    }

    // Upsert player in database
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

    console.log(`[OAuth] Login OK: ${player.login} (${coalition.name})`);
    req.session.save(() => {
      res.json({ success: true });
    });
  } catch (err) {
    console.error('[OAuth] Direct login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * Quick mock login — GET /auth/42/mock/:login
 * Instant session creation, no API calls. For local/jam testing.
 */
router.get('/mock/:login', (req, res) => {
  const login = req.params.login;
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = ((hash << 5) - hash) + login.charCodeAt(i);
    hash |= 0;
  }
  const mockId = Math.abs(hash) % 100000 + 1000;
  const colors = ['#3B82F6', '#EF4444', '#22C55E', '#A855F7', '#38bdf8', '#fb923c'];
  const names = ['The Order', 'The Assembly', 'The Alliance', 'The Federation'];

  const upsertStmt = db.prepare(`
    INSERT INTO players (intra_id, login, display_name, avatar_url,
                         coalition_id, coalition_name, coalition_color, coalition_image_url,
                         last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(intra_id) DO UPDATE SET
      display_name = excluded.display_name,
      last_login = CURRENT_TIMESTAMP
  `);
  upsertStmt.run(mockId, login, login, null, (mockId % 4) + 1, names[mockId % names.length], colors[mockId % colors.length], null);
  const player = db.prepare('SELECT * FROM players WHERE intra_id = ?').get(mockId);

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

  console.log(`[Mock] Instant login: ${login}`);
  req.session.save(() => {
    res.redirect('/');
  });
});

/**
 * Guest Login — POST /auth/42/guest-login
 * Allows local guest players to log in with a custom name and coalition,
 * then auto-starts a singleplayer match with bots.
 */
router.post('/guest-login', (req, res) => {
  const { login, coalitionId, coalitionName, coalitionColor } = req.body;
  if (!login) return res.status(400).json({ error: 'Name is required' });

  // Generate unique numeric ID for the guest player
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = ((hash << 5) - hash) + login.charCodeAt(i);
    hash |= 0;
  }
  const mockId = Math.abs(hash) % 100000 + 500000; // distinct range for guests

  const upsertStmt = db.prepare(`
    INSERT INTO players (intra_id, login, display_name, avatar_url,
                         coalition_id, coalition_name, coalition_color, coalition_image_url,
                         last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(intra_id) DO UPDATE SET
      display_name = excluded.display_name,
      coalition_id = excluded.coalition_id,
      coalition_name = excluded.coalition_name,
      coalition_color = excluded.coalition_color,
      last_login = CURRENT_TIMESTAMP
  `);
  upsertStmt.run(
    mockId,
    login,
    login,
    null,
    parseInt(coalitionId) || 1,
    coalitionName || 'The Order',
    coalitionColor || '#3B82F6',
    null
  );

  const player = db.prepare('SELECT * FROM players WHERE intra_id = ?').get(mockId);

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
    wantsSingleplayer: true // Flag to automatically launch bot match
  };

  req.session.save(() => {
    res.json({ success: true });
  });
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
