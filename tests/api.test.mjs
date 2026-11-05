import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

function mockD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_admin_login.sql', import.meta.url), 'utf8'));
  return {
    raw: sqlite,
    prepare(query) {
      let values = [];
      return {
        bind(...params) { values = params; return this; },
        async first() { return sqlite.prepare(query).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(query).all(...values) }; },
        async run() { const result = sqlite.prepare(query).run(...values); return { meta: { changes: result.changes } }; }
      };
    }
  };
}
const post = (path, body, token, method = 'POST', headers = {}) => new Request('https://example.test' + path, {
  method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: JSON.stringify(body)
});
const get = (path, token, headers = {}) => new Request('https://example.test' + path, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } });
const call = async (request, env) => { const res = await worker.fetch(request, env); return { status: res.status, data: await res.json() }; };

test('신규 사용자→게임 시작→점수 저장→랭킹→중복 방지→관리자 삭제', async () => {
  const db = mockD1(), env = { DB: db, ADMIN_KEY: 'safe-admin-secret-very-long-random-token-ABC123' };
  const register = await call(post('/api/players', { nickname: '스마트AI' }), env);
  assert.equal(register.status, 201);
  const token = register.data.token, playerId = register.data.player.id;
  assert.equal((await call(get('/api/me', token), env)).data.player.id, playerId);
  const start = await call(post('/api/game/start', { game:'ai-tower', mode:'classic' }, token), env);
  assert.equal(start.status, 201);
  const sessionId = start.data.sessionId;
  db.raw.prepare('UPDATE game_sessions SET started_at = ? WHERE id = ?').run(Date.now()-2500, sessionId);
  const result = { sessionId, score: 177, floors: 1, perfects: 1, combo: 1 };
  const finish = await call(post('/api/game/finish', result, token), env);
  assert.equal(finish.status, 201);
  assert.equal((await call(post('/api/game/finish', result, token), env)).status, 409);
  const leaderboard = await call(get('/api/rankings?game=ai-tower&mode=classic&period=all'), env);
  assert.equal(leaderboard.data.rankings.length, 1);
  assert.equal(leaderboard.data.rankings[0].score, 177);
  const loginSetup = await worker.fetch(post('/api/admin/auth/setup', { setupKey:env.ADMIN_KEY, password:'SmartAI2026!' },null,'POST',{'X-Requested-With':'SmartAILabAdmin'}),env);
  assert.equal(loginSetup.status, 200);
  const sessionCookie=loginSetup.headers.get('set-cookie').split(';')[0];
  const summary = await call(get('/api/admin/summary', null, { Cookie:sessionCookie }), env);
  assert.equal(summary.data.scores, 1);
  assert.equal((await call(get('/api/admin/summary'), env)).status, 401);
  const deleted = await call(new Request('https://example.test/api/admin/scores/'+finish.data.score.id, { method:'DELETE',headers:{Cookie:sessionCookie,'X-Requested-With':'SmartAILabAdmin'} }), env);
  assert.equal(deleted.data.deleted, 1);
  assert.equal((await call(get('/api/rankings?game=ai-tower'), env)).data.rankings.length, 0);
});

test('비정상 기록은 거부', async () => {
  const db = mockD1(), env = { DB: db };
  const register = await call(post('/api/players', { nickname:'타워장인' }), env);
  const token = register.data.token;
  const start = await call(post('/api/game/start', {game:'ai-tower',mode:'daily'},token), env);
  db.raw.prepare('UPDATE game_sessions SET started_at = ? WHERE id = ?').run(Date.now()-2500,start.data.sessionId);
  const invalid = await call(post('/api/game/finish', {sessionId:start.data.sessionId,score:9999,floors:1,perfects:1,combo:1},token), env);
  assert.equal(invalid.status, 422);
  const health = await call(get('/api/health'),env);
  assert.equal(health.data.ok,true);
});
