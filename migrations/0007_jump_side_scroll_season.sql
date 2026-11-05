-- 네온 점프 시즌 2: 게임 규칙이 세로→횡스크롤로 달라 기존 점수와 랭킹을 분리합니다.
-- 기존 시즌 1 게임 세션과 점수는 rules_version=1로 그대로 유지합니다.
ALTER TABLE game_sessions ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scores ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_scores_version_rank
  ON scores(game_id, rules_version, mode, score DESC, floors DESC);
