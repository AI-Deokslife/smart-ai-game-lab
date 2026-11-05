import { GAMES, MODES, liveGame, validName, validateTowerResult, validateRushResult, kstStartUtc } from './validation.js';
import { adminAuthRoute, adminSignedIn } from './admin-auth.js';
import { catalogRoute, listedGames, visibleGame } from './catalog.js';
import { replayMergeGame, mergeScoreSummary } from '../public/games/ai-merge/engine.js';
import { replayJumpGame, jumpSummary, MAX_TICKS, FRAME_MS } from '../public/games/ai-jump/engine.js';

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
async function rankings(db, query) {
  const game = query.get('game') || 'ai-tower';
  const mode = query.get('mode') || 'classic';
  const period = query.get('period') || 'all';
  const view = query.get('view') || 'best';
  if (!liveGame(game) || !MODES.includes(mode) || !['all', 'today'].includes(period) ||
      !['best','all'].includes(view)) return fail('올바르지 않은 랭킹 조건입니다.');
  if (!(await visibleGame(db,game))) return fail('비공개 게임입니다.',404);
  const cutoff = period === 'today' || mode === 'daily' ? kstStartUtc() : '1970-01-01T00:00:00.000Z';
  const select = 'SELECT s.player_id, COALESCE(s.nickname, p.nickname) AS nickname, s.score, s.floors, s.created_at FROM scores s JOIN players p ON p.id = s.player_id WHERE s.game_id = ? AND s.mode = ? AND s.created_at >= ?';
  const sql = view === 'all'
    ? 'SELECT nickname,score,floors,created_at FROM ('+select+') ORDER BY score DESC, floors DESC, created_at ASC LIMIT 10'
    : 'WITH records AS ('+select+'), ranked AS (SELECT player_id,nickname,score,floors,created_at,ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY score DESC, floors DESC, created_at ASC) AS rn FROM records) SELECT nickname,score,floors,created_at FROM ranked WHERE rn=1 ORDER BY score DESC, floors DESC, created_at ASC LIMIT 10';
  const result = await db.prepare(sql).bind(game,mode,cutoff).all();
  return reply({ game, mode, period, view, rankings: (result.results || []).map((r,i)=>({rank:i+1,...r})) });
}
async function api(req, env) {
  if (!env.DB) return fail('D1 데이터베이스 연결이 필요합니다. 배포 설정을 확인하세요.', 503);
  const url = new URL(req.url), path = url.pathname, method = req.method;
  if (path === '/api/health' && method === 'GET') return reply({ ok: true, service: 'SMART AI GAME LAB', games: (await listedGames(env.DB)).length });
  if (path === '/api/games' && method === 'GET') return catalogRoute(req, env, path, bodyJson);
  if (path === '/api/rankings' && method === 'GET') return rankings(env.DB, url.searchParams);
  if (path === '/api/stats' && method === 'GET') {
    const [players, plays] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM players').first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM scores').first(),
    ]);
    return reply({ players: players?.count || 0, plays: plays?.count || 0, games: (await listedGames(env.DB)).length });
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
    // 과거 점수의 닉네임은 scores.nickname 스냅샷으로 보존합니다.
    await env.DB.prepare('UPDATE players SET nickname = ? WHERE id = ?').bind(nickname, player.id).run();
    return reply({ player: { ...player, nickname } });
  }
  if (path === '/api/game/start' && method === 'POST') {
    const player = await playerFor(req, env.DB);
    if (!player) return fail('참가자 등록이 필요합니다.', 401);
    const data = await bodyJson(req), game = data.game, mode = data.mode;
    if (!liveGame(game) || !MODES.includes(mode) || !(await visibleGame(env.DB,game))) return fail('지원하지 않거나 비공개 게임입니다.');
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
    const minMsPerStep = session.game_id === 'ai-rush' ? 100 : session.game_id === 'ai-merge' ? 70 : session.game_id === 'ai-jump' ? 25 : 180;
    if (elapsed < Math.max(250, (Number(data.floors) || 0) * minMsPerStep)) return fail('비정상적으로 빠른 게임 기록입니다.', 422);
    if (!['ai-tower','ai-rush','ai-merge','ai-jump'].includes(session.game_id)) return fail('게임별 검증기가 준비되지 않았습니다.',501);
    let result;
    if(session.game_id==='ai-merge'){
      const seed = session.mode==='daily' ? new Date(session.started_at+9*60*60*1000).toISOString().slice(0,10) : session.id;
      const replay=replayMergeGame(seed,session.mode,data.moves);
      if(!replay)return fail('AI 몬스터 합체 플레이 기록이 올바르지 않습니다.',422);
      const expected=mergeScoreSummary(replay);
      const matches=['score','floors','perfects','combo'].every(key=>Number.isSafeInteger(data[key])&&data[key]===expected[key]);
      result=matches?{ok:true,value:expected}:{ok:false,error:'서버에서 재현한 게임 점수와 제출 기록이 다릅니다.'};
    } else if(session.game_id==='ai-jump'){
      // Web client sends 3-bit packed controls (LEFT/RIGHT/JUMP) for each 40ms tick.
      // The deterministic engine reproduces physics, platform collisions, stars and score.
      // Real session time bounds the trace to prevent faster-than-real-time submissions.
      const ticks=data.ticks;
      if(!Number.isSafeInteger(ticks)||ticks<1||ticks>MAX_TICKS[session.mode]||
          elapsed+1500 < ticks*FRAME_MS)
        return fail('AI 네온 점프의 플레이 시간 또는 입력 기록이 올바르지 않습니다.',422);
      const seed=session.mode==='daily'?
        new Date(session.started_at+9*60*60*1000).toISOString().slice(0,10):session.id;
      const played=replayJumpGame(seed,session.mode,data.trace,ticks);
      if(!played)return fail('AI 네온 점프 입력 기록을 재현할 수 없습니다.',422);
      const expected=jumpSummary(played);
      const matches=['score','floors','perfects','combo'].every(key=>
        Number.isSafeInteger(data[key])&&data[key]===expected[key]);
      result=matches?{ok:true,value:expected}:{ok:false,error:'실제 이동 경로와 제출 점수가 일치하지 않습니다.'};
    } else {
      result=session.game_id==='ai-rush'?validateRushResult(data):validateTowerResult(data);
    }
    if (!result.ok) return fail(result.error, 422);
    const { score, floors, perfects, combo } = result.value, created = nowIso(), scoreId = uid();
    // 한 번 제출된 세션은 원자적으로 완료 처리하며 중복 요청을 방지합니다.
    const updated = await env.DB.prepare('UPDATE game_sessions SET finished_at = ? WHERE id = ? AND player_id = ? AND finished_at IS NULL').bind(Date.now(), session.id, player.id).run();
    if (updated.meta?.changes !== 1) return fail('이미 제출된 기록입니다.', 409);
    await env.DB.prepare('INSERT INTO scores (id, session_id, player_id, game_id, mode, score, floors, perfects, combo, created_at, nickname) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(scoreId, session.id, player.id, session.game_id, session.mode, score, floors, perfects, combo, created, player.nickname).run();
    return reply({ ok: true, score: { id: scoreId, score, floors, created_at: created } }, 201);
  }
  if (path.startsWith('/api/admin/auth/')) return adminAuthRoute(req, env, path);
  if (path.startsWith('/api/admin/')) {
    if (!(await adminSignedIn(req, env))) return fail('관리자 로그인이 필요합니다.', 401);
    if (method !== 'GET') {
      const origin = req.headers.get('origin');
      if ((origin && origin !== url.origin) || req.headers.get('x-requested-with') !== 'SmartAILabAdmin') {
        return fail('잘못된 요청 출처입니다.', 403);
      }
    }
    if (path.startsWith('/api/admin/games')) {
      const res = await catalogRoute(req, env, path, bodyJson);
      if (res) return res;
    }
    if (path === '/api/admin/summary' && method === 'GET') {
      const [players, scores, sessions] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS n FROM players').first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM game_sessions').first(),
      ]);
      return reply({ players: players?.n || 0, scores: scores?.n || 0, sessions: sessions?.n || 0 });
    }
    if (path === '/api/admin/scores' && method === 'GET') {
      const list = await env.DB.prepare('SELECT s.id, COALESCE(s.nickname,p.nickname) AS nickname, s.game_id, s.mode, s.score, s.floors, s.created_at FROM scores s JOIN players p ON p.id = s.player_id ORDER BY s.created_at DESC LIMIT 100').all();
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
    if (!path.startsWith('/api/')) {
      // 비공개 게임은 직접 URL을 입력해도 플레이할 수 없도록 차단합니다.
      if (path.startsWith('/games/')) {
        const slug = path.match(/^\/games\/([a-z][a-z0-9-]*)\//)?.[1] || path.match(/^\/games\/([a-z][a-z0-9-]*)$/)?.[1];
        if (slug && env.DB && !(await visibleGame(env.DB,slug))) {
          return new Response('현재 비공개 상태인 게임입니다.',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
        }
      }
      return env.ASSETS.fetch(request);
    }
    try { return await api(request, env); }
    catch (e) {
      console.error('API error', e);
      if (e.message?.includes('요청 데이터') || e.message?.includes('JSON 형식')) return fail(e.message, 400);
      return fail('서버 처리 중 오류가 발생했습니다. DB 초기화와 배포 설정을 확인하세요.', 500);
    }
  }
};
