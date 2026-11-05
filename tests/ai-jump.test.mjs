import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {
  FPS,FRAME_MS,MAX_TICKS,WIDTH,HEIGHT,
  createJumpGame,stepJumpGame,jumpSummary,
  packJumpInputs,replayJumpGame,platformX
} from '../public/games/ai-jump/engine.js';

const fixture=()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_init.sql','0002_admin_login.sql','0003_game_catalog.sql','0004_score_nickname_snapshot.sql','0005_publish_ai_merge.sql','0006_publish_ai_jump.sql','0007_jump_side_scroll_season.sql']){
    db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  return {db,env:{DB:{prepare(sql){
    let args=[];
    return {bind(...values){args=values;return this;},
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}};}
    };
  }}}};
};
async function api(env,path,{method='GET',token,body}={}){
  const response=await worker.fetch(new Request('https://game.example'+path,{
    method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  }),env);
  return {status:response.status,data:await response.json()};
}
const play=(seed,mode='classic',max=300)=>{
  const state=createJumpGame(seed,mode),inputs=[];
  for(let i=0;i<max&&!state.over;i++){
    const support=state.platforms[state.groundId];
    const nearEdge=state.grounded&&support&&state.x>platformX(support,state.tick)+support.w/2-65;
    const mask=nearEdge?6:2;
    inputs.push(mask);stepJumpGame(state,mask);
  }
  return {state,inputs,trace:packJumpInputs(inputs)};
};

test('AI 네온 점프: 기본 발판·물리 낙하·점프 판정',()=>{
  const state=createJumpGame('physics-test','classic');
  assert.equal(state.x,84);
  assert.equal(state.grounded,true);
  assert.equal(state.platforms[0].y,92);
  stepJumpGame(state,4);
  assert.ok(state.y>92);
  assert.ok(state.vy>0);
  const beginning=state.y;
  for(let i=0;i<10;i++)stepJumpGame(state,2);
  assert.ok(state.y>beginning);
  assert.ok(state.x>84);
  assert.ok(state.platforms.length>5);
  assert.equal(WIDTH,640);assert.equal(HEIGHT,440);
});
test('정해진 25fps 엔진은 같은 씨앗/조작으로 항상 동일한 높이와 점수를 낸다',()=>{
  assert.equal(FPS,25);assert.equal(FRAME_MS,40);
  for(let i=0;i<15;i++){
    const {state,inputs,trace}=play('same-seed-'+i,'classic',340);
    const replay=replayJumpGame('same-seed-'+i,'classic',trace,inputs.length);
    assert.ok(replay,'중간 종료까지 포함해 모든 조작을 재생할 수 있어야 합니다.');
    assert.deepEqual(jumpSummary(replay),jumpSummary(state));
    assert.equal(replay.tick,state.tick);
    assert.equal(replay.hearts,state.hearts);
    assert.equal(replay.x,state.x);
    assert.equal(replay.y,state.y);
  }
});
test('짧게 누른 점프와 길게 누른 점프는 정상 동작하고, 방향 입력이 모두 눌리면 정지한다',()=>{
  const s=createJumpGame('input');
  stepJumpGame(s,4);
  assert.ok(s.vy>0);
  const x=s.x;
  for(let i=0;i<10;i++)stepJumpGame(s,3);
  assert.equal(s.x,x);
  const t=createJumpGame('input');
  stepJumpGame(t,4);
  for(let i=0;i<10;i++)stepJumpGame(t,4);
  assert.equal(t.tick,11);
  assert.equal(t.x,x);
});
test('움직이는 발판과 부서지는 발판은 다른 동작을 갖는다',()=>{
  const s=createJumpGame('platform-types');
  const m=s.platforms.find(p=>p.type==='moving');
  if(m){assert.notEqual(platformX(m,100),platformX(m,101));}
  const f=s.platforms.find(p=>p.type==='fragile');
  if(f){
    f.breakAt=2;stepJumpGame(s,0);assert.equal(f.active,true);
    stepJumpGame(s,0);assert.equal(f.active,false);
  }
});

test('첫 장면부터 횡스크롤 네온 시티의 넓은 가로 발판이 연결되며 오른쪽으로 진행한다',()=>{
  const state=createJumpGame('horizontal-city','classic');
  assert.ok(state.platforms.length>=3);
  assert.equal(state.platforms[0].w,300);
  assert.ok(state.platforms[1].x>state.platforms[0].x+state.platforms[0].w/2);
  assert.ok(state.platforms[1].x-state.platforms[0].x>140);
  for(let i=0;i<22;i++)stepJumpGame(state,2);
  assert.ok(state.x>175);
  assert.ok(state.bestX>175);
  assert.ok(state.cameraX>=0);
});
test('두 번 점프 버튼을 누르면 공중에서 2단 점프가 발생하고 착지하면 충전된다',()=>{
  const s=createJumpGame('double-jump','classic');
  assert.equal(s.jumpsUsed,0);
  stepJumpGame(s,4);assert.equal(s.jumpsUsed,1);
  stepJumpGame(s,0);
  stepJumpGame(s,4);
  assert.equal(s.jumpsUsed,2);
  assert.equal(s.event,'double');
  const vy=s.vy;
  stepJumpGame(s,0);stepJumpGame(s,4);
  assert.ok(s.vy<vy,'2단 점프 이후에는 세 번째 점프가 발생하지 않습니다.');
});
test('추락하면 체크포인트에서 재개하고, 에너지 3칸이 소진되면 종료된다',()=>{
  const s=createJumpGame('respawn','classic');
  s.checkpoint={id:7,x:1200,y:190};
  for(let i=0;i<3;i++){
    s.x=1500;s.y=-80;s.vy=-10;s.grounded=false;s.groundId=null;
    stepJumpGame(s,0);
    assert.equal(s.hearts,2-i);
    if(i<2){
      assert.equal(s.x,1200);assert.equal(s.y,192);
    }
  }
  assert.equal(s.over,true);
});
test('시즌 2 네온 점프 랭킹은 기존 기록을 보존하면서 새 기록만 표시한다',async()=>{
  const {db,env}=fixture();
  db.prepare('INSERT INTO players(id,token_hash,nickname,created_at) VALUES(?,?,?,?)').run('legacy','old-hash','예전점퍼','2026-11-05');
  db.prepare('INSERT INTO game_sessions(id,player_id,game_id,mode,started_at,finished_at) VALUES(?,?,?,?,?,?)')
    .run('old-session','legacy','ai-jump','classic',100,200);
  db.prepare('INSERT INTO scores(id,session_id,player_id,game_id,mode,score,floors,perfects,combo,created_at,nickname) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('old-score','old-session','legacy','ai-jump','classic',99999,110,0,0,'2026-11-05','예전점퍼');
  const previous=db.prepare('SELECT score,rules_version FROM scores WHERE id=?').get('old-score');
  assert.equal(previous.score,99999);assert.equal(previous.rules_version,1);
  const ranked=await api(env,'/api/rankings?game=ai-jump');
  assert.equal(ranked.status,200);assert.equal(ranked.data.rankings.length,0);
  const player=await api(env,'/api/players',{method:'POST',body:{nickname:'새점퍼'}});
  const begun=await api(env,'/api/game/start',{method:'POST',token:player.data.token,body:{game:'ai-jump',mode:'classic'}});
  assert.equal(begun.status,201);
  assert.equal(db.prepare('SELECT rules_version FROM game_sessions WHERE id=?').get(begun.data.sessionId).rules_version,2);
});
test('압축한 입력 기록은 4096자 이하의 서버 요청으로 전송할 수 있다',()=>{
  const input=Array(MAX_TICKS.classic).fill(0).map((_,i)=>i%17===0?4:(i%3));
  const encoded=packJumpInputs(input);
  assert.match(encoded,/^[A-Za-z0-9_-]+$/);
  assert.ok(encoded.length<3800);
  assert.ok(JSON.stringify({ticks:input.length,trace:encoded,score:0,floors:0,perfects:0,combo:0,sessionId:'0'.repeat(36)}).length<4096);
  assert.equal(replayJumpGame('invalid','daily',encoded,MAX_TICKS.classic),null);
  assert.equal(replayJumpGame('invalid','classic',encoded,MAX_TICKS.classic+1),null);
  assert.equal(replayJumpGame('invalid','classic','a!*',1),null);
  assert.equal(replayJumpGame('invalid','classic',packJumpInputs([0,1,2])+'A',3),null);
});
test('등록한 점수와 서버 재계산 점수가 다르면 거부하고 정상 기록만 저장한다',async()=>{
  const {db,env}=fixture();
  const player=await api(env,'/api/players',{method:'POST',body:{nickname:'점프장인'}});
  assert.equal(player.status,201);
  const token=player.data.token;
  const started=await api(env,'/api/game/start',{method:'POST',token,body:{game:'ai-jump',mode:'classic'}});
  assert.equal(started.status,201);
  const id=started.data.sessionId;
  const {state,trace,inputs}=play(id,'classic',75);
  db.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-inputs.length*FRAME_MS-2500,id);
  const payload={sessionId:id,ticks:inputs.length,trace,...jumpSummary(state)};
  const invalid=await api(env,'/api/game/finish',{method:'POST',token,body:{...payload,score:payload.score+1000}});
  assert.equal(invalid.status,422);
  const good=await api(env,'/api/game/finish',{method:'POST',token,body:payload});
  assert.equal(good.status,201);
  assert.equal(good.data.score.score,jumpSummary(state).score);
  const duplicate=await api(env,'/api/game/finish',{method:'POST',token,body:payload});
  assert.equal(duplicate.status,409);
  const ranks=await api(env,'/api/rankings?game=ai-jump');
  assert.equal(ranks.data.rankings[0].nickname,'점프장인');
  assert.equal(ranks.data.rankings[0].score,jumpSummary(state).score);
  assert.equal((await api(env,'/api/rankings?game=ai-rush')).data.rankings.length,0);
});
test('실제 세션 시간보다 빠르게 전송한 기록은 서버가 거부한다',async()=>{
  const {env}=fixture();
  const reg=await api(env,'/api/players',{method:'POST',body:{nickname:'날짜점프'}});
  const token=reg.data.token;
  const started=await api(env,'/api/game/start',{method:'POST',token,body:{game:'ai-jump',mode:'classic'}});
  const id=started.data.sessionId,{state,inputs,trace}=play(id,'classic',150);
  assert.equal((await api(env,'/api/game/finish',{method:'POST',token,body:{sessionId:id,ticks:inputs.length,trace,...jumpSummary(state)}})).status,422);
});
test('오늘의 도전은 같은 한국 날짜에서 같은 발판 배치가 재생된다',()=>{
  const s1=createJumpGame('2026-11-05','daily'),s2=createJumpGame('2026-11-05','daily');
  assert.deepEqual(s1.platforms,s2.platforms);
  assert.equal(MAX_TICKS.daily,1500);
  assert.equal(MAX_TICKS.classic,7500);
});
test('실행 화면은 모바일 조작과 도트 그래픽, 온라인 TOP10 기록을 갖는다',()=>{
  const html=readFileSync(new URL('../public/games/ai-jump/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/games/ai-jump/game.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/games/ai-jump/styles.css',import.meta.url),'utf8');
  for(const id of ['scene','leftBtn','rightBtn','jumpBtn','startBtn','rankList','endOverlay','pauseOverlay','nickname']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(js,/SmartAILab\.begin\('ai-jump'/);
  assert.match(js,/SmartAILab\.ranking\('ai-jump'/);
  assert.match(js,/packJumpInputs\(trace\)/);
  assert.match(js,/requestAnimationFrame\(loop\)/);
  assert.match(css,/touch-action:none/);
  assert.match(html,/width="1280" height="880"/);
  assert.match(html,/NEON CITY/);
  assert.match(js,/function backdrop/);
  assert.match(js,/function platformDraw/);
  assert.match(html,/TOP 10/);
  // ESM import만 제거하면 다른 문법 오류도 Node가 판별할 수 있습니다.
  new Script(js.replace(/^import \{[\s\S]*?\} from '\.\/engine\.js';/m,''),{filename:'game.js'});
});
