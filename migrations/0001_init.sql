-- 학생 이름·연락처를 수집하지 않는 익명 게임 플랫폼
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_recent ON game_sessions(player_id, started_at);
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES game_sessions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0),
  floors INTEGER NOT NULL CHECK(floors >= 0),
  perfects INTEGER NOT NULL CHECK(perfects >= 0),
  combo INTEGER NOT NULL CHECK(combo >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_ranking ON scores(game_id, mode, score DESC, floors DESC);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id, game_id, mode);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(created_at);
