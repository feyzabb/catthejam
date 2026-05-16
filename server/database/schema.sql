-- Deep Sea Pulse: Coalition Wars — Database Schema

-- Players table (populated on first OAuth login)
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intra_id INTEGER UNIQUE NOT NULL,
    login VARCHAR(50) NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    coalition_id INTEGER,
    coalition_name VARCHAR(100),
    coalition_color VARCHAR(7),
    coalition_image_url TEXT,
    elo_points INTEGER DEFAULT 1000,
    matches_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Match history
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code VARCHAR(10) NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    total_pulses INTEGER DEFAULT 0,
    winner_id INTEGER REFERENCES players(id)
);

-- Match results (4 rows per match)
CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER REFERENCES matches(id),
    player_id INTEGER REFERENCES players(id),
    placement INTEGER NOT NULL,
    points_change INTEGER NOT NULL,
    final_resources TEXT,
    UNIQUE(match_id, player_id)
);

-- Indexes for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo_points DESC);
CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
