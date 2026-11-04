export const GAMES = [
  { id: 'ai-tower', title: 'AI 타워 챌린지', subtitle: '블록을 쌓아 최고 기록에 도전', path: '/games/ai-tower/', live: true },
  { id: 'ai-rush', title: 'AI 러시', subtitle: '순발력을 시험하는 계단 달리기', path: null, live: false },
  { id: 'ai-merge', title: 'AI 몬스터 합체', subtitle: '로봇을 합쳐 진화시키는 퍼즐', path: null, live: false },
];
export const MODES = ['classic', 'daily'];
export const liveGame = id => GAMES.some(game => game.id === id && game.live);
export function validName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 12 || !/^[\p{L}\p{N}_ -]+$/u.test(name)) return null;
  const reserved = ['관리자', '운영자', 'admin', 'administrator', 'official', '스마트AI과'];
  if (reserved.some(word => name.toLowerCase() === word.toLowerCase())) return null;
  return name;
}
export function integer(value, lo, hi) {
  if (!Number.isSafeInteger(value) || value < lo || value > hi) return null;
  return value;
}
export function maxTowerScore(floors) {
  // 각 층을 모두 PERFECT로 쌓았을 때 가능한 이론상 최대 점수.
  return 120 * floors + 12 * floors * (floors + 1) / 2 +
    45 * (Math.min(floors, 10) * (Math.min(floors, 10) + 1) / 2 + Math.max(0, floors - 10) * 10);
}
export function validateTowerResult(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: '기록 형식이 올바르지 않습니다.' };
  const score = integer(data.score, 0, 10000000);
  const floors = integer(data.floors, 0, 500);
  const perfects = integer(data.perfects, 0, 500);
  const combo = integer(data.combo, 0, 500);
  if ([score, floors, perfects, combo].some(x => x === null)) return { ok: false, error: '점수 데이터 범위가 올바르지 않습니다.' };
  if (perfects > floors || combo > perfects || score > maxTowerScore(floors) || (floors === 0 && score > 0)) return { ok: false, error: '게임 기록을 검증할 수 없습니다.' };
  return { ok: true, value: { score, floors, perfects, combo } };
}
export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function kstStartUtc(now = Date.now()) {
  return new Date(kstToday(now) + 'T00:00:00+09:00').toISOString();
}
