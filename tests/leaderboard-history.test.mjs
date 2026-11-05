import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';

const migration=n=>readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8');
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0001_init.sql','0002_admin_login.sql','0003_game_catalog.sql','0004_score_nickname_snapshot.sql'])sqlite.exec(migration(name));
  return {sqlite,env:{DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};}}}};
}
async function send(env,path,{method='GET',body,token}={}){
  const response=await worker.fetch(new Request('https://example.test'+path,{method,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})}),env);
  return {status:response.status,data:await response.json()};
}
async function score(env,token,game,score,floors,perfects,combo){
  const started=await send(env,'/api/game/start',{method:'POST',token,body:{game,mode:'classic'}});
  assert.equal(started.status,201);
  env.DB._sqlite?.prepare('SELECT 1');
  const sessionId=started.data.sessionId;
  return sessionId;
}
test('기존 점수 마이그레이션은 참가자 닉네임을 채우되 점수는 유지한다',()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(migration('0001_init.sql'));
  sql.prepare('INSERT INTO players(id,token_hash,nickname,created_at) VALUES(?,?,?,?)').run('p1','hash','현재이름','2026-11-05');
  sql.prepare('INSERT INTO game_sessions(id,player_id,game_id,mode,started_at,finished_at) VALUES(?,?,?,?,?,?)')
    .run('session','p1','ai-tower','classic',1,2);
  sql.prepare('INSERT INTO scores(id,session_id,player_id,game_id,mode,score,floors,perfects,combo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('score','session','p1','ai-tower','classic',177,1,1,1,'2026-11-05');
  sql.exec(migration('0004_score_nickname_snapshot.sql'));
  assert.deepEqual({...sql.prepare('SELECT nickname,score FROM scores').get()},{nickname:'현재이름',score:177});
  sql.close();
});
test('같은 참가자의 모든 점수와 최고 점수를 구분하고, 닉네임 변경 후에도 이전 이름을 유지한다',async()=>{
  const {sqlite,env}=fixture();
  const created=await send(env,'/api/players',{method:'POST',body:{nickname:'학생가'}});
  const token=created.data.token;
  for(const [scoreValue,floors,perfects,combo] of [[100,1,0,0],[225,2,1,1]]){
    const started=await send(env,'/api/game/start',{method:'POST',token,body:{game:'ai-rush',mode:'classic'}});
    assert.equal(started.status,201);
    sqlite.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-2000,started.data.sessionId);
    const completed=await send(env,'/api/game/finish',{method:'POST',token,body:{sessionId:started.data.sessionId,score:scoreValue,floors,perfects,combo}});
    assert.equal(completed.status,201);
  }
  const best=await send(env,'/api/rankings?game=ai-rush&view=best');
  const all=await send(env,'/api/rankings?game=ai-rush&view=all');
  assert.equal(best.data.rankings.length,1);
  assert.equal(all.data.rankings.length,2);
  assert.deepEqual(all.data.rankings.map(x=>x.score),[225,100]);
  assert.deepEqual(all.data.rankings.map(x=>x.nickname),['학생가','학생가']);
  const changed=await send(env,'/api/me',{method:'PATCH',token,body:{nickname:'학생나'}});
  assert.equal(changed.status,200);
  const after=await send(env,'/api/rankings?game=ai-rush&view=all');
  assert.deepEqual(after.data.rankings.map(x=>x.nickname),['학생가','학생가']);
  assert.equal((await send(env,'/api/rankings?game=ai-rush&view=unknown')).status,400);
});
test('브라우저에서 다른 닉네임으로 플레이하면 새 프로필이며 과거 기록의 이름이 보존된다',async()=>{
  const {sqlite,env}=fixture();
  const memory=new Map();
  const localStorage={
    getItem:key=>memory.get(key)??null,
    setItem:(key,value)=>memory.set(key,String(value)),
    removeItem:key=>memory.delete(key)
  };
  const window={};
  const fetch=async(path,opts={})=>worker.fetch(new Request('https://example.test'+path,opts),env);
  runInNewContext(readFileSync(new URL('../public/shared/lab-sdk.js',import.meta.url),'utf8'),{window,localStorage,fetch,console});
  const sdk=window.SmartAILab;
  const first=await sdk.ensurePlayer('학생가');
  const session=await sdk.begin('ai-rush','classic','학생가');
  sqlite.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-2000,session.sessionId);
  await sdk.finish({score:100,floors:1,perfects:0,combo:0},Promise.resolve(session));
  const second=await sdk.ensurePlayer('학생나');
  assert.notEqual(first.id,second.id);
  const session2=await sdk.begin('ai-rush','classic','학생나');
  sqlite.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-2000,session2.sessionId);
  await sdk.finish({score:125,floors:1,perfects:1,combo:1},Promise.resolve(session2));
  const firstAgain=await sdk.ensurePlayer('학생가');
  assert.equal(firstAgain.id,first.id);
  const list=await sdk.ranking('ai-rush','classic','all','all');
  assert.deepEqual(Array.from(list.rankings,x=>x.nickname),['학생나','학생가']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM players').get().n,2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get().n,2);
});
