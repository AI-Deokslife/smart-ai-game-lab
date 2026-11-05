-- AI 몬스터 합체를 기존 게임 포털에 공개합니다.
-- 사용자 및 점수 기록은 수정하지 않습니다.
INSERT OR IGNORE INTO game_catalog(id,title,subtitle,path,visual,enabled,sort_order,created_at,updated_at)
VALUES('ai-merge','AI 몬스터 합체','로봇을 떨어뜨려 같은 등급끼리 합체! 연쇄 진화 퍼즐','/games/ai-merge/','merge',1,30,datetime('now'),datetime('now'));
UPDATE game_catalog SET enabled=1,subtitle='로봇을 떨어뜨려 같은 등급끼리 합체! 연쇄 진화 퍼즐',
 path='/games/ai-merge/',visual='merge',updated_at=datetime('now') WHERE id='ai-merge';
