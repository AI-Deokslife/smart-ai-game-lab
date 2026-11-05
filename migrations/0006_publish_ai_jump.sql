-- GAME 04 AI 네온 점프 등록 (기존 기록/계정/관리자 정보 변경 없음)
INSERT OR IGNORE INTO game_catalog(id,title,subtitle,path,visual,enabled,sort_order,created_at,updated_at)
VALUES('ai-jump','AI 네온 점프','A·D 이동과 점프로 발판을 올라가는 네온 플랫폼 액션','/games/ai-jump/','jump',1,40,datetime('now'),datetime('now'));
