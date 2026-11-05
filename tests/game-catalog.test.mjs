import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import worker from '../src/index.js';
import { normalizeGame } from '../src/catalog.js';
import { validateRushResult, rushScore } from '../src/validation.js';

function fixture(){
  const raw=new DatabaseSync(':memory:');
  for(const name of ['0001_init.sql','0002_admin_login.sql','0003_game_catalog.sql','0004_score_nickname_snapshot.sql','0005_publish_ai_merge.sql'])
    raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const DB={raw,prepare(sql){
    let params=[];
    return {bind(...p){params=p;return this;},
      async first(){return raw.prepare(sql).get(...params)||null;},
      async all(){return {results:raw.prepare(sql).all(...params)};},
      async run(){const r=raw.prepare(sql).run(...params);return {meta:{changes:r.changes}};}
    };
  }};
  return {DB,ADMIN_KEY:'setup-key-2026-separate-secret'};
}
const request=(path,{method='GET',body,token,cookie}={})=>new Request('https://example.test'+path,{
  method,headers:{...(body?{'Content-Type':'application/json'}:{}),
  ...(method!=='GET'?{'X-Requested-With':'SmartAILabAdmin'}:{}),
  ...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
});
async function run(env,path,opts={}){
  const response=await worker.fetch(request(path,opts),env);
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('기본 게임 카탈로그는 AI 타워·AI 러시·AI 몬스터 합체를 공개한다',async()=>{
  const env=fixture(),result=await run(env,'/api/games');
  assert.equal(result.status,200);
  assert.deepEqual(result.data.games.map(g=>g.id),['ai-tower','ai-rush','ai-merge']);
  assert.equal(result.data.games[1].supportsRanking,true);
  const stats=await run(env,'/api/stats');assert.equal(stats.data.games,3);
});
test('관리자 게임 등록, 정렬 변경, 비공개 처리 및 기존 기록 보존',async()=>{
  const env=fixture();
  const setup=await run(env,'/api/admin/auth/setup',{method:'POST',body:{setupKey:env.ADMIN_KEY,password:'SmartAI2026!'}});
  assert.equal(setup.status,200);
  const cookie=setup.cookie;
  assert.equal((await run(env,'/api/admin/games')).status,401);
  const before=await run(env,'/api/admin/games',{cookie});
  assert.equal(before.data.games.length,3);
  const newGame={id:'student-jump',title:'학생 점프',subtitle:'학생 제작 새 게임',visual:'puzzle',sort_order:4,enabled:false};
  const created=await run(env,'/api/admin/games',{method:'POST',cookie,body:newGame});
  assert.equal(created.status,201);
  assert.equal(created.data.game.path,'/games/student-jump/');
  assert.equal((await run(env,'/api/admin/games',{method:'POST',cookie,body:newGame})).status,409);
  assert.equal((await run(env,'/api/games')).data.games.length,3);
  const invalid=await run(env,'/api/admin/games/student-jump',{method:'PATCH',cookie,body:{...newGame,title:'<script>',enabled:true}});
  assert.equal(invalid.status,200); // 제목은 textContent로 안전하게 출력됨
  const published=await run(env,'/api/games');
  assert.equal(published.data.games[0].id,'student-jump');
  assert.equal((await run(env,'/api/game/start',{method:'POST',body:{game:'student-jump',mode:'classic'}})).status,401);
  const hidden=await run(env,'/api/admin/games/student-jump',{method:'PATCH',cookie,body:{...newGame,enabled:false}});
  assert.equal(hidden.status,200);
  assert.equal((await run(env,'/api/games')).data.games.length,3);
  assert.equal((await run(env,'/api/admin/games/student-jump',{method:'PATCH',body:{...newGame,enabled:true}})).status,401);
  const attempted=await run(env,'/api/admin/games',{method:'POST',cookie,body:{...newGame,id:'../../../admin'}});
  assert.equal(attempted.status,400);
});
test('AI 러시 점수는 정확한 공식으로만 인정된다',()=>{
  assert.equal(rushScore(4,3),475);
  assert.equal(validateRushResult({floors:4,perfects:3,combo:2,score:475}).ok,true);
  assert.equal(validateRushResult({floors:4,perfects:3,combo:2,score:476}).ok,false);
  assert.equal(validateRushResult({floors:2,perfects:3,combo:1,score:200}).ok,false);
});
test('AI 러시 기록 저장은 AI 타워와 별도로 집계된다',async()=>{
  const env=fixture();
  const player=await run(env,'/api/players',{method:'POST',body:{nickname:'러시장인'}});
  assert.equal(player.status,201);
  const token=player.data.token;
  const started=await run(env,'/api/game/start',{method:'POST',token,body:{game:'ai-rush',mode:'classic'}});
  assert.equal(started.status,201);
  env.DB.raw.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-3000,started.data.sessionId);
  const finished=await run(env,'/api/game/finish',{method:'POST',token,body:{sessionId:started.data.sessionId,floors:4,perfects:3,combo:2,score:475}});
  assert.equal(finished.status,201);
  const aiRush=await run(env,'/api/rankings?game=ai-rush&mode=classic&period=all');
  assert.equal(aiRush.data.rankings[0].score,475);
  assert.equal((await run(env,'/api/rankings?game=ai-tower&mode=classic&period=all')).data.rankings.length,0);
  const duplicate=await run(env,'/api/game/finish',{method:'POST',token,body:{sessionId:started.data.sessionId,floors:4,perfects:3,combo:2,score:475}});
  assert.equal(duplicate.status,409);
  const setup=await run(env,'/api/admin/auth/setup',{method:'POST',body:{setupKey:env.ADMIN_KEY,password:'SmartAI2026'}});
  const cookie=setup.cookie;
  const hide=await run(env,'/api/admin/games/ai-rush',{method:'PATCH',cookie,body:{id:'ai-rush',title:'AI 러시',subtitle:'신나는 게임',visual:'rush',sort_order:20,enabled:false}});
  assert.equal(hide.status,200);
  assert.equal((await run(env,'/api/rankings?game=ai-rush')).status,404);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS c FROM scores').get().c,1);
});
test('새 게임 HTML의 인라인 JavaScript 구문 검사',()=>{
  for(const path of ['../public/games/ai-rush/index.html','../public/admin/index.html']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length>0,path);
    for(const s of scripts)new Script(s[1],{filename:path});
  }
});
