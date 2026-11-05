-- 점수 등록 당시 닉네임을 보존합니다. 기존 기록은 현재 플레이어 닉네임으로 1회 채웁니다.
-- 과거에 이미 바뀐 이름의 원래 값은 DB에 남아 있지 않아 복원할 수 없습니다.
ALTER TABLE scores ADD COLUMN nickname TEXT;
UPDATE scores
  SET nickname = (SELECT p.nickname FROM players p WHERE p.id = scores.player_id)
  WHERE nickname IS NULL;
CREATE INDEX IF NOT EXISTS idx_scores_game_mode_created ON scores(game_id,mode,created_at DESC);
