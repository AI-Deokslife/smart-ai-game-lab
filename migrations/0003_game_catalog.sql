-- 게임 메타데이터/공개 여부: 기존 점수·사용자 테이블은 보존합니다.
CREATE TABLE IF NOT EXISTS game_catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  path TEXT NOT NULL,
  visual TEXT NOT NULL DEFAULT 'neon',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_catalog_public ON game_catalog(enabled,sort_order,id);

INSERT OR IGNORE INTO game_catalog(id,title,subtitle,path,visual,enabled,sort_order,created_at,updated_at)
VALUES
 ('ai-tower','AI 타워 챌린지','블록을 쌓아 최고 기록에 도전','/games/ai-tower/','tower',1,10,datetime('now'),datetime('now')),
 ('ai-rush','AI 러시','A·D 또는 좌우 터치! 네온 계단을 달려라','/games/ai-rush/','rush',1,20,datetime('now'),datetime('now')),
 ('ai-merge','AI 몬스터 합체','로봇을 합쳐 진화시키는 퍼즐','/games/ai-merge/','merge',0,30,datetime('now'),datetime('now'));
