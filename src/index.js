import { GAMES, MODES, liveGame, validName, validateTowerResult, kstStartUtc } from './validation.js';

const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: BASE_HEADERS });
const fail = (error, status = 400) => reply({ error }, status);
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
async function bodyJson(req) {
  if ((Number(req.headers.get('content-length')) || 0) > 4096) throw new Error('요청 데이터가 너무 큽니다.');
  const text = await req.text();
  if (text.length > 4096) throw new Error('요청 데이터가 너무 큽니다.');
  try { return JSON.parse(text); } catch { throw new Error('JSON 형식이 잘못되었습니다.'); }
}
async function playerFor(req, db) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer [0-9a-f]{64}$/.test(authorization)) return null;
  const digest = await hash(authorization.slice(7));
  return db.prepare('SELECT id, nickname, created_at FROM players WHERE token_hash = ?').bind(digest).first();
}
async function adminFor(req, env) {
  const supplied = req.headers.get('x-admin-key') || '';
  if (!env.ADMIN_KEY || supplied.length < 24 || supplied.length > 512) return false;
  return (await hash(supplied)) === (await hash(env.ADMIN_KEY));
}
async function rankings(db, query) {
  const game = query.get('game') || 'ai-tower';
  const mode = query.get('mode') || 'classic';
  const period = query.get('period') || 'all';
  if (!liveGame(game) || !MODES.includes(mode) || !['all', 'today'].includes(period)) return fail('올바르지 않은 랭킹 조건입니다.');
  const cutoff = period === 'today' || mode === 'daily' ? kstStartUtc() : '1970-01-01T00:00:00.000Z';
  const stmt = db.prepare(`WITH ranked AS (
    SELECT s.player_id, p.nickname, s.score, s.floors, s.created_at,
      ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.score DESC, s.floors DESC, s.created_at ASC) AS rn
    FROM scores s JOIN players p ON p.id = s.player_id
    WHERE s.game_id = ? AND s.mode = ? AND s.created_at >= ?
  ) SELECT nickname, score, floors, created_at FROM ranked WHERE rn = 1
    ORDER BY score DESC, floors DESC, created_at ASC LIMIT 20`);
  const result = await stmt.bind(game, mode, cutoff).all();
  return reply({ game, mode, period, rankings: (result.results || []).map((r, i) => ({ rank: i + 1, ...r })) });
}
async function api(req, env) {
  if (!env.DB) return fail('D1 데이터베이스 연결이 필요합니다. 배포 설정을 확인하세요.', 503);
  const url = new URL(req.url), path = url.pathname, method = req.method;
  if (path === '/api/health' && method === 'GET') return reply({ ok: true, service: 'SMART AI GAME LAB', games: GAMES.filter(x => x.live).length });
  if (path === '/api/games' && method === 'GET') return reply({ games: GAMES });
  if (path === '/api/rankings' && method === 'GET') return rankings(env.DB, url.searchParams);
  if (path === '/api/stats' && method === 'GET') {
    const [players, plays] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM players').first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM scores').first(),
    ]);
    return reply({ players: players?.count || 0, plays: plays?.count || 0, games: GAMES.filter(x => x.live).length });
  }
  if (path === '/api/players' && method === 'POST') {
    const data = await bodyJson(req), nickname = validName(data.nickname);
    if (!nickname) return fail('닉네임은 2~12자의 한글·영문·숫자·공백·_-만 사용할 수 있습니다.');
    const id = uid(), token = randomToken(), created = nowIso();
    await env.DB.prepare('INSERT INTO players (id, token_hash, nickname, created_at) VALUES (?, ?, ?, ?)').bind(id, await hash(token), nickname, created).run();
    return reply({ player: { id, nickname, created_at: created }, token }, 201);
  }
  if (path === '/api/me' && method === 'GET') {
    const player = await playerFor(req, env.DB);
    return player ? reply({ player }) : fail('로그인이 필요합니다.', 401);
  }
  if (path === '/api/me' && method === 'PATCH') {
    const player = await playerFor(req, env.DB);
    if (!player) return fail('로그인이 필요합니다.', 401);
    const data = await bodyJson(req), nickname = validName(data.nickname);
    if (!nickname) return fail('올바른 닉네임을 입력하세요.');
    await env.DB.prepare('UPDATE players SET nickname = ? WHERE id = ?').bind(nickname, player.id).run();
    return reply({ player: { ...player, nickname } });
  }
  if (path === '/api/game/start' && method === 'POST') {
    const player = await playerFor(req, env.DB);
    if (!player) return fail('참가자 등록이 필요합니다.', 401);
    const data = await bodyJson(req), game = data.game, mode = data.mode;
    if (!liveGame(game) || !MODES.includes(mode)) return fail('지원하지 않는 게임 또는 모드입니다.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM game_sessions WHERE player_id = ? AND started_at > ?').bind(player.id, Date.now() - 60000).first();
    if ((count?.n || 0) >= 10) return fail('잠시 후 다시 시도해주세요.', 429);
    const id = uid(), started = Date.now();
    await env.DB.prepare('INSERT INTO game_sessions (id, player_id, game_id, mode, started_at) VALUES (?, ?, ?, ?, ?)').bind(id, player.id, game, mode, started).run();
    return reply({ sessionId: id, startedAt: started, expiresInSeconds: 3600 }, 201);
  }
  if (path === '/api/game/finish' && method === 'POST') {
    const player = await playerFor(req, env.DB);
    if (!player) return fail('참가자 등록이 필요합니다.', 401);
    const data = await bodyJson(req);
    if (typeof data.sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.sessionId)) return fail('게임 세션 정보가 없습니다.');
    const session = await env.DB.prepare('SELECT * FROM game_sessions WHERE id = ? AND player_id = ?').bind(data.sessionId, player.id).first();
    if (!session) return fail('게임 세션을 찾지 못했습니다.', 404);
    if (session.finished_at !== null) return fail('이미 제출된 기록입니다.', 409);
    const elapsed = Date.now() - session.started_at;
    if (elapsed < 0 || elapsed > 3600000) return fail('유효 시간이 지난 게임입니다.', 410);
    if (elapsed < Math.max(250, (Number(data.floors) || 0) * 180)) return fail('비정상적으로 빠른 게임 기록입니다.', 422);
    if (session.game_id !== 'ai-tower') return fail('게임별 검증기가 준비되지 않았습니다.', 501);
    const result = validateTowerResult(data);
    if (!result.ok) return fail(result.error, 422);
    const { score, floors, perfects, combo } = result.value, created = nowIso(), scoreId = uid();
    // 한 번 제출된 세션은 원자적으로 완료 처리하며 중복 요청을 방지합니다.
    const updated = await env.DB.prepare('UPDATE game_sessions SET finished_at = ? WHERE id = ? AND player_id = ? AND finished_at IS NULL').bind(Date.now(), session.id, player.id).run();
    if (updated.meta?.changes !== 1) return fail('이미 제출된 기록입니다.', 409);
    await env.DB.prepare('INSERT INTO scores (id, session_id, player_id, game_id, mode, score, floors, perfects, combo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(scoreId, session.id, player.id, session.game_id, session.mode, score, floors, perfects, combo, created).run();
    return reply({ ok: true, score: { id: scoreId, score, floors, created_at: created } }, 201);
  }
  if (path.startsWith('/api/admin/')) {
    if (!(await adminFor(req, env))) return fail('관리자 인증에 실패했습니다.', 403);
    if (path === '/api/admin/summary' && method === 'GET') {
      const [players, scores, sessions] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS n FROM players').first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM game_sessions').first(),
      ]);
      return reply({ players: players?.n || 0, scores: scores?.n || 0, sessions: sessions?.n || 0 });
    }
    if (path === '/api/admin/scores' && method === 'GET') {
      const list = await env.DB.prepare('SELECT s.id, p.nickname, s.game_id, s.mode, s.score, s.floors, s.created_at FROM scores s JOIN players p ON p.id = s.player_id ORDER BY s.created_at DESC LIMIT 100').all();
      return reply({ scores: list.results || [] });
    }
    const match = path.match(/^\/api\/admin\/scores\/([0-9a-f-]{36})$/);
    if (match && method === 'DELETE') {
      const updated = await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(match[1]).run();
      return reply({ ok: true, deleted: updated.meta?.changes || 0 });
    }
  }
  return fail('API 주소를 찾을 수 없습니다.', 404);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch (e) {
      console.error('API error', e);
      if (e.message?.includes('요청 데이터') || e.message?.includes('JSON 형식')) return fail(e.message, 400);
      return fail('서버 처리 중 오류가 발생했습니다. DB 초기화와 배포 설정을 확인하세요.', 500);
    }
  }
};
