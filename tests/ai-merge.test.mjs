import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Script} from 'node:vm';
import worker from '../src/index.js';
import {COLS,ROWS,MAX_TURNS,createMergeGame,dropMergeRobot,replayMergeGame,mergeScoreSummary,landingRow,peekNextTier} from '../public/games/ai-merge/engine.js';

const fixture=()=>{
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0001_init.sql','0002_admin_login.sql','0003_game_catalog.sql','0004_score_nickname_snapshot.sql','0005_publish_ai_merge.sql','0006_publish_ai_jump.sql','0007_jump_side_scroll_season.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  return {sqlite,env:{DB:{prepare(sql){
    let bound=[];return {
      bind(...params){bound=params;return this;},
      async first(){return sqlite.prepare(sql).get(...bound)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...bound)};},
      async run(){return {meta:{changes:sqlite.prepare(sql).run(...bound).changes}};}
    };
  }}}};
};
async function api(env,path,{method='GET',body,token}={}){
  const response=await worker.fetch(new Request('https://example.test'+path,{
    method,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  }),env);
  return {status:response.status,data:await response.json()};
}
function movesFor(seed,mode='classic',limit=26){
  const state=createMergeGame(seed,mode);
  for(let turn=0;turn<limit&&!state.over;turn++){
    const viable=[0,1,2,3,4].filter(x=>state.grid[0][x]===0);
    if(!viable.length)break;
    const col=viable[turn%viable.length];
    assert.equal(dropMergeRobot(state,col).ok,true);
  }
  return state;
}

test('합체 엔진은 같은 씨앗·입력으로 완전히 같은 결과를 재현한다',()=>{
  const a=movesFor('seed-hello','classic',32);
  const b=replayMergeGame('seed-hello','classic',a.moves);
  assert.ok(b);
  assert.deepEqual(a.grid,b.grid);
  assert.deepEqual(mergeScoreSummary(a),mergeScoreSummary(b));
  assert.ok(a.moves.length<=MAX_TURNS.classic);
  assert.equal(a.grid.length,ROWS);
  assert.equal(a.grid[0].length,COLS);
  assert.equal(replayMergeGame('seed-hello','classic',[0,1,-1]),null);
  assert.equal(replayMergeGame('seed-hello','daily',Array(36).fill(0)),null);
  assert.equal(replayMergeGame('seed-hello','classic',[]),null);
});
test('붙은 로봇은 합체하고, 연쇄 합체 시 점수가 정확히 추가된다',()=>{
  const g=createMergeGame('chain');
  g.grid[6][0]=1;g.grid[6][1]=2;g.next=1;
  const step=dropMergeRobot(g,0);
  assert.equal(step.ok,true);
  assert.equal(g.grid[6][0],3);
  assert.equal(g.grid[6][1],0);
  assert.equal(g.merges,2);
  assert.equal(g.score,300);
  assert.equal(g.maxCombo,2);
  assert.equal(g.maxTier,3);
  assert.equal(g.moves.length,1);
});
test('열이 가득 차면 낙하 거부하고 이전 점수·입력 기록 유지',()=>{
  const g=createMergeGame('columns');
  for(let y=0;y<ROWS;y++)g.grid[y][0]=9;
  const result=dropMergeRobot(g,0);
  assert.equal(result.ok,false);
  assert.equal(g.moves.length,0);
  assert.equal(g.score,0);
});
test('클래식의 온라인 점수는 서버가 입력 경로를 재현해 검사한다',async()=>{
  const {sqlite,env}=fixture();
  const created=await api(env,'/api/players',{method:'POST',body:{nickname:'합체연구자'}});
  const token=created.data.token;
  const start=await api(env,'/api/game/start',{method:'POST',token,body:{game:'ai-merge',mode:'classic'}});
  assert.equal(start.status,201);
  const seed=start.data.sessionId,client=movesFor(seed);
  sqlite.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-30000,seed);
  const expected=mergeScoreSummary(client);
  const invalid=await api(env,'/api/game/finish',{method:'POST',token,body:{sessionId:seed,...expected,score:expected.score+100,moves:client.moves}});
  assert.equal(invalid.status,422);
  const good=await api(env,'/api/game/finish',{method:'POST',token,body:{sessionId:seed,...expected,moves:client.moves}});
  assert.equal(good.status,201);
  assert.equal(good.data.score.score,expected.score);
  const again=await api(env,'/api/game/finish',{method:'POST',token,body:{sessionId:seed,...expected,moves:client.moves}});
  assert.equal(again.status,409);
  const ranking=await api(env,'/api/rankings?game=ai-merge&mode=classic');
  assert.equal(ranking.status,200);
  assert.equal(ranking.data.rankings[0].nickname,'합체연구자');
  assert.equal(ranking.data.rankings[0].score,expected.score);
  const tower=await api(env,'/api/rankings?game=ai-tower');
  assert.equal(tower.data.rankings.length,0);
});
test('오늘의 퍼즐은 한국 날짜의 동일한 로봇 순서를 공유하고 서버가 검증한다',async()=>{
  const {sqlite,env}=fixture();
  const register=await api(env,'/api/players',{method:'POST',body:{nickname:'데일리왕'}});
  const token=register.data.token;
  const start=await api(env,'/api/game/start',{method:'POST',token,body:{game:'ai-merge',mode:'daily'}});
  assert.equal(start.status,201);
  sqlite.prepare('UPDATE game_sessions SET started_at=? WHERE id=?').run(Date.now()-5000,start.data.sessionId);
  const session=sqlite.prepare('SELECT * FROM game_sessions WHERE id=?').get(start.data.sessionId);
  const day=new Date(session.started_at+9*3600000).toISOString().slice(0,10);
  const g=movesFor(day,'daily',22);
  const result=await api(env,'/api/game/finish',{method:'POST',token,body:{sessionId:session.id,...mergeScoreSummary(g),moves:g.moves}});
  assert.equal(result.status,201);
  assert.deepEqual(createMergeGame(day,'daily').next,createMergeGame(day,'daily').next);
});
test('랭킹은 게임·모드와 무관하게 항상 최대 10위까지만 반환한다',async()=>{
  const {sqlite,env}=fixture();
  for(let i=1;i<=13;i++){
    const id='p'+i,sess='s'+i,score='score'+i;
    sqlite.prepare('INSERT INTO players(id,token_hash,nickname,created_at) VALUES(?,?,?,?)').run(id,'hash-'+i,'선수'+i,'2026-11-05');
    sqlite.prepare('INSERT INTO game_sessions(id,player_id,game_id,mode,started_at,finished_at) VALUES(?,?,?,?,?,?)')
      .run(sess,id,'ai-merge','classic',1,2);
    sqlite.prepare('INSERT INTO scores(id,session_id,player_id,game_id,mode,score,floors,perfects,combo,created_at,nickname) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(score,sess,id,'ai-merge','classic',i*100,i,0,0,'2026-11-05','선수'+i);
  }
  for(const view of ['all','best']){
    const result=await api(env,'/api/rankings?game=ai-merge&mode=classic&view='+view);
    assert.equal(result.status,200);
    assert.equal(result.data.rankings.length,10);
    assert.equal(result.data.rankings[0].rank,1);
    assert.equal(result.data.rankings[9].rank,10);
  }
});

test('낙하→접촉 합체→중력 낙하→연쇄 합체가 단계별 프레임으로 기록된다',()=>{
  const g=createMergeGame('visual-effects');
  g.grid[6][0]=1;g.grid[6][1]=2;g.next=1;
  const before=g.grid.map(row=>row.slice());
  const result=dropMergeRobot(g,0);
  assert.equal(result.ok,true);
  const frames=result.last.frames;
  assert.deepEqual(frames.map(x=>x.type),['drop','merge','gravity','merge']);
  assert.deepEqual(frames[0].to,{row:5,col:0});
  assert.equal(frames[0].grid[5][0],1);
  assert.equal(frames[1].grid[5][0],2);
  assert.equal(frames[1].grid[6][0],0);
  assert.deepEqual(frames[2].movements,[{from:{row:5,col:0},to:{row:6,col:0},tier:2}]);
  assert.equal(frames[2].grid[6][0],2);
  assert.equal(frames[3].grid[6][0],3);
  assert.equal(frames[3].grid[6][1],0);
  assert.deepEqual(g.grid,frames.at(-1).grid);
  assert.equal(before[5][0],0);
  assert.equal(g.score,300);
});
test('다음 로봇 미리보기는 난수 상태를 바꾸지 않아 서버 재현과 항상 동일하다',()=>{
  const a=createMergeGame('preview-determinism','classic');
  const b=createMergeGame('preview-determinism','classic');
  for(let i=0;i<12&&!a.over;i++){
    assert.equal(peekNextTier(a),peekNextTier(a));
    const col=[2,3,1,4,0][i%5];
    assert.equal(dropMergeRobot(a,col,false).ok,true);
    assert.equal(dropMergeRobot(b,col,false).ok,true);
    assert.equal(a.next,b.next);
    assert.deepEqual(mergeScoreSummary(a),mergeScoreSummary(b));
  }
});
test('중력 물리 규칙: 모든 로봇은 빈칸 위에 떠 있지 않고 같은 등급 충돌만 합체한다',()=>{
  for(let seedIndex=0;seedIndex<60;seedIndex++){
    const game=createMergeGame('seed-'+seedIndex,'classic');
    for(let turn=0;turn<100&&!game.over;turn++){
      let col=-1;
      for(let offset=0;offset<COLS;offset++){
        const testCol=(turn+offset+seedIndex)%COLS;
        if(landingRow(game.grid,testCol)>=0){col=testCol;break;}
      }
      if(col<0)break;
      assert.equal(dropMergeRobot(game,col,false).ok,true);
      for(let x=0;x<COLS;x++){
        let seenEmpty=false;
        for(let y=ROWS-1;y>=0;y--){
          const tier=game.grid[y][x];
          assert.ok(tier>=0&&tier<=9);
          if(!tier)seenEmpty=true;
          else assert.equal(seenEmpty,false,'빈 공간 위에 로봇이 공중에 떠 있으면 안 됩니다');
        }
      }
    }
    assert.deepEqual(mergeScoreSummary(replayMergeGame('seed-'+seedIndex,'classic',game.moves)),mergeScoreSummary(game));
  }
});
test('게임 화면은 낙하 궤적, 합체, 중력 프레임을 실제로 재생한다',()=>{
  const html=readFileSync(new URL('../public/games/ai-merge/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/games/ai-merge/game.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/games/ai-merge/styles.css',import.meta.url),'utf8');
  for(const id of ['ghostBot','fxLayer','speedBtn','afterNext'])assert.match(html,new RegExp('id="'+id+'"'));
  for(const event of ['drop','merge','gravity'])assert.match(js,new RegExp("frame.type==='"+event+"'"));
  assert.match(js,/holder\.animate/);
  assert.match(js,/frame\.movements/);
  assert.match(js,/landingRow\(state\.grid,selected\)/);
  assert.match(js,/peekNextTier\(state\)/);
  assert.match(css,/\.merge-burst/);
  assert.match(css,/\.flight-token/);
});

test('HTML/CSS/JS 게임 파일과 공통 점수 SDK 경로는 일치한다',()=>{
  const html=readFileSync(new URL('../public/games/ai-merge/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/games/ai-merge/game.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/games/ai-merge/styles.css',import.meta.url),'utf8');
  assert.match(html,/game\.js/);assert.match(html,/styles\.css/);
  assert.match(html,/\/shared\/lab-sdk\.js/);
  assert.match(html,/id="dropBtn"/);assert.match(html,/id="board"/);
  assert.match(css,/grid-template-columns:repeat\(5/);
  assert.match(js,/SmartAILab\.begin\('ai-merge'/);
  assert.match(js,/SmartAILab\.finish\(/);
  assert.match(js,/SmartAILab\.ranking\('ai-merge'/);
  new Script(js.replace(/^import .* from '\.\/engine\.js';/m,''),{filename:'game.js'});
});


test('도트풍 타이틀 화면 버튼·모달과 게임 기능이 실제 DOM 요소로 연결된다',()=>{
  const html=readFileSync(new URL('../public/games/ai-merge/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/games/ai-merge/game.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/games/ai-merge/styles.css',import.meta.url),'utf8');
  const art=readFileSync(new URL('../public/games/ai-merge/title-city.svg',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const known=new Set(ids);
  assert.equal(ids.length,known.size,'HTML ID가 중복되면 안 됩니다.');
  for(const m of js.matchAll(/\$\('([^']+)'\)/g)){
    assert.ok(known.has(m[1]),'게임 JS가 참조하는 DOM 요소가 없습니다: '+m[1]);
  }
  for(const id of ['titleScreen','titlePlayBtn','titleRankBtn','titleSettingsBtn',
    'titleSetupDialog','titleRankDialog','titleSettingsDialog','titleSetupHost',
    'titleRankMode','titleRankView','titleSoundSwitch','titleSpeedSwitch']){
    assert.ok(known.has(id));
  }
  assert.match(css,/title-city\.svg/);
  assert.match(css,/max-aspect-ratio:9\/11/);
  assert.match(css,/\.pixel-title-screen\[hidden\]/);
  assert.match(art,/<svg[\s\S]*viewBox="0 0 1600 900"/);
  assert.match(art,/<\/svg>\s*$/);
  assert.match(js,/\$\('titleSetupHost'\)\.append\(\$\('startOverlay'\)\)/);
  assert.match(js,/\$\('titleScreen'\)\.hidden=true/);
  assert.match(js,/SmartAILab\.ranking\('ai-merge',mode,'all',view\)/);
  assert.match(js,/loadTitleRanks/);
  assert.match(js,/localStorage\.setItem\('smart-ai-merge-sound'/);
});
