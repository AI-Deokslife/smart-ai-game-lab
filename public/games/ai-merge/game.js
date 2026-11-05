import {COLS,ROWS,MAX_TURNS,createMergeGame,dropMergeRobot,mergeScoreSummary,peekNextTier,landingRow} from './engine.js';
const $=id=>document.getElementById(id);
const names=['','새싹봇','번개봇','꿈틀봇','스타봇','그린봇','갤럭시봇','파이어봇','아쿠아봇','레전드봇'];
const colors=['','#73e9de','#9cb3ff','#ffb2d0','#ffd47d','#a8e9a3','#c9aaff','#ffa18d','#8fe1ff','#ffed9e'];
const symbols=['','✦','ϟ','◎','★','❀','✧','▲','≈','♛'];
const fmt=n=>Number(n).toLocaleString('ko-KR');
const localKey=m=>'smart-ai-merge-high-'+m;
let state=null,selected=2,session=null,playing=false,soundEnabled=localStorage.getItem('smart-ai-merge-sound')!=='false',mode='classic',saveBusy=false,audio=null,toastTimer=0;
let animating=false,queuedColumn=null,fastMode=localStorage.getItem('smart-ai-merge-fast')==='true';
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
$('nickname').value=localStorage.getItem('smart-ai-merge-name')||'AI 탐험가';

function sound(freq=490,duration=.08,kind='sine'){
  if(!soundEnabled)return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    audio ||= new Ctx();
    const oscillator=audio.createOscillator(),gain=audio.createGain();
    oscillator.type=kind;oscillator.frequency.setValueAtTime(freq,audio.currentTime);
    gain.gain.setValueAtTime(.048,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    oscillator.connect(gain);gain.connect(audio.destination);
    oscillator.start();oscillator.stop(audio.currentTime+duration+.01);
  }catch{}
}
function bot(tier,animate=false){
  const b=document.createElement('div');
  b.className='bot lv'+tier+(animate?' pop':'');
  b.setAttribute('aria-label','레벨 '+tier+' '+names[tier]);
  const face=document.createElement('span');face.className='face';
  const mouth=document.createElement('i');mouth.className='mouth';face.append(mouth);
  const label=document.createElement('span');label.className='tier';label.textContent='Lv.'+tier;
  const symbol=document.createElement('span');symbol.className='bot-symbol';symbol.textContent=symbols[tier];symbol.setAttribute('aria-hidden','true');
  b.append(face,symbol,label);return b;
}
function renderGrid(grid){
  const root=$('grid'),fragment=document.createDocumentFragment();
  for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
    const tier=grid[row][col],cell=document.createElement('div');
    cell.className='cell'+(tier?' filled':'')+(selected===col?' drop-focus':'');
    cell.dataset.cell=row+':'+col;
    if(tier)cell.append(bot(tier));
    fragment.append(cell);
  }
  root.replaceChildren(fragment);
}
function updateGhost(){
  const ghost=$('ghostBot');
  const row=state&&playing&&!animating?landingRow(state.grid,selected):-1;
  ghost.hidden=row<0;
  if(row<0)return;
  ghost.style.left=(selected*100/COLS)+'%';
  ghost.style.top=(row*100/ROWS)+'%';
  ghost.replaceChildren(bot(state.next));
}
function draw(){
  if(!state)return;
  renderGrid(state.grid);
  $('nextBot').replaceChildren(bot(state.next));
  $('nextName').textContent='Lv. '+state.next+' · '+names[state.next];
  $('afterNext').textContent='그다음: Lv.'+peekNextTier(state)+' '+names[peekNextTier(state)];
  $('score').textContent=fmt(state.score);
  $('turns').textContent=fmt(state.moves.length)+' / '+MAX_TURNS[mode];
  $('merges').textContent=fmt(state.merges);
  $('best').textContent=fmt(Math.max(state.score,Number(localStorage.getItem(localKey(mode))||0)));
  $('laneArrow').style.transform='translateX('+(selected*100)+'%)';
  updateGhost();
}
function duration(ms){return reduceMotion?0:Math.round(ms*(fastMode?.45:1));}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function screenPoint(pos){
  return {left:pos.col*100/COLS,top:pos.row*100/ROWS};
}
async function fly(tier,from,to,ms,hideOriginal=false){
  const layer=$('fxLayer');
  if(hideOriginal){
    const cell=$('grid').querySelector('[data-cell="'+from.row+':'+from.col+'"]');
    if(cell)cell.classList.add('fx-hide');
  }
  const holder=document.createElement('div');
  holder.className='flight-token';
  const start=screenPoint(from);
  holder.style.left=start.left+'%';holder.style.top=start.top+'%';
  holder.append(bot(tier));
  layer.append(holder);
  try{
    const time=duration(ms);
    if(time){
      const dx=(to.col-from.col)*$('board').clientWidth/COLS;
      const dy=(to.row-from.row)*$('board').clientHeight/ROWS;
      const falling=from.row<0;
      const frames=falling?[
        {offset:0,transform:'translate(0px,0px) scale(.87)',opacity:.65},
        {offset:.75,transform:'translate('+dx+'px,'+(dy+7)+'px) scale(1.08,.9)',opacity:1},
        {offset:.88,transform:'translate('+dx+'px,'+(dy-4)+'px) scale(.96,1.05)',opacity:1},
        {offset:1,transform:'translate('+dx+'px,'+dy+'px) scale(1)',opacity:1}
      ]:[
        {transform:'translate(0px,0px) scale(.98)',opacity:1},
        {transform:'translate('+dx+'px,'+dy+'px) scale(1.12)',opacity:.86}
      ];
      const animation=holder.animate(frames,{
        duration:time,easing:falling?'cubic-bezier(.34,.02,.65,1)':'ease-in-out',fill:'forwards'
      });
      await animation.finished.catch(()=>{});
    }
  }finally{holder.remove();}
}
function impact(){
  const board=$('board');board.classList.remove('impact');void board.offsetWidth;board.classList.add('impact');
}
function burst(frame){
  const node=document.createElement('div');node.className='merge-burst';
  node.style.left=((frame.to.col+.5)*100/COLS)+'%';
  node.style.top=((frame.to.row+.5)*100/ROWS)+'%';
  const text=document.createElement('span');text.textContent='+'+fmt(frame.points);
  node.append(text);$('fxLayer').append(node);
  setTimeout(()=>node.remove(),duration(420)+40);
}
async function playFrames(before,frames){
  animating=true;queuedColumn=null;$('ghostBot').hidden=true;
  renderGrid(before);
  for(const frame of frames){
    if(frame.type==='drop'){
      await fly(frame.tier,frame.from,frame.to,160+(frame.row+1)*30);
      renderGrid(frame.grid);sound(350,.07);impact();
    }else if(frame.type==='merge'){
      await fly(frame.oldTier,frame.from,frame.to,200,true);
      renderGrid(frame.grid);
      burst(frame);impact();sound(450+frame.chain*95,.12);
      await delay(duration(115));
    }else if(frame.type==='gravity'){
      await Promise.all(frame.movements.map(m=>fly(m.tier,m.from,m.to,140+(m.to.row-m.from.row)*45,true)));
      renderGrid(frame.grid);impact();sound(290,.05);
    }
  }
  animating=false;
}
function toast(text){
  const node=$('gameToast');
  node.classList.remove('active');void node.offsetWidth;
  node.textContent=text;node.classList.add('active');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('active'),950);
}
function updateSelected(value){
  selected=(value+COLS)%COLS;
  $('laneArrow').style.transform='translateX('+(selected*100)+'%)';
  if(state&&!animating)draw();
}
function koreaDay(timestamp=Date.now()){return new Date(timestamp+9*3600000).toISOString().slice(0,10);}
async function start(){
  if(saveBusy)return;
  const nickname=$('nickname').value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(nickname.length<2||nickname.length>12||!/^[-_\p{L}\p{N} ]+$/u.test(nickname)){
    $('startMsg').textContent='닉네임은 2~12자 한글·영문·숫자로 입력하세요.';return;
  }
  mode=$('modeSelect').value;
  localStorage.setItem('smart-ai-merge-name',nickname);
  $('startBtn').disabled=true;$('startMsg').textContent='게임을 준비하고 있습니다...';
  session=null;
  let seed=crypto.randomUUID();
  try{
    session=await SmartAILab.begin('ai-merge',mode,nickname);
    seed=mode==='daily'?koreaDay(session.startedAt):session.sessionId;
    $('startMsg').textContent='';
  }catch(error){
    $('startMsg').textContent='네트워크에 연결하지 못해 오프라인으로 시작합니다.';
    if(mode==='daily')seed=koreaDay();
  }
  $('startBtn').disabled=false;
  state=createMergeGame(seed,mode);
  selected=2;playing=true;saveBusy=false;animating=false;queuedColumn=null;
  $('startOverlay').hidden=true;$('endOverlay').hidden=true;
  if($('titleSetupDialog').open)$('titleSetupDialog').close();
  $('titleScreen').hidden=true;
  document.body.classList.add('merge-playing');
  $('modeTag').textContent=mode==='daily'?'오늘의 퍼즐 · 35번':'자유 합체 · 160번';
  $('rankMode').value=mode;
  draw();loadRankings();sound(700,.12);
}
async function drop(column=selected){
  if(!playing||!state)return;
  if(animating){queuedColumn=column;return;}
  selected=column;
  const before=state.grid.map(row=>row.slice());
  const result=dropMergeRobot(state,column);
  if(!result.ok){sound(180,.1,'sawtooth');toast('이 열이 가득 찼습니다!');draw();return;}
  try{
    await playFrames(before,result.last.frames);
  }catch(error){
    console.error('합체 연출 오류',error);
  }finally{
    $('fxLayer').replaceChildren();
    animating=false;
    draw();
  }
  if(result.last.combo){
    toast(result.last.combo>=2?'연쇄 진화 ×'+result.last.combo+' · +'+fmt(result.last.gained)+'점':
      '합체 성공! +'+fmt(result.last.gained)+'점');
    navigator.vibrate?.(result.last.combo>1?[30,40,30]:14);
  }
  if(result.over){queuedColumn=null;finish();return;}
  if(queuedColumn!==null){
    const next=queuedColumn;queuedColumn=null;
    // 한 번의 애니메이션 동안 입력한 다음 열 하나를 예약합니다.
    drop(next);
  }
}
async function finish(){
  if(!playing||!state)return;
  playing=false;animating=false;queuedColumn=null;
  const current=state,summary=mergeScoreSummary(current);
  const key=localKey(mode),highest=Math.max(Number(localStorage.getItem(key)||0),summary.score);
  localStorage.setItem(key,String(highest));
  $('endScore').textContent=fmt(summary.score)+'점';
  $('endDetail').textContent=summary.floors+'번 떨어뜨림 · '+summary.perfects+'회 합체 · 최대 '+summary.combo+'연쇄 · 최고 Lv.'+current.maxTier;
  $('saveState').textContent='온라인 랭킹 저장 중...';
  $('endOverlay').hidden=false;draw();saveBusy=true;
  try{
    if(!session)throw new Error('오프라인 플레이');
    const saved=await SmartAILab.finish({...summary,moves:current.moves},Promise.resolve(session));
    $('saveState').textContent=saved&&saved.ok?'온라인 랭킹에 기록되었습니다.':'점수를 저장하지 못했습니다.';
    loadRankings();
  }catch(error){
    $('saveState').textContent='기기 기록만 저장됨 · '+error.message;
  }finally{saveBusy=false;}
}
async function loadRankings(){
  const list=$('rankingList');list.replaceChildren();
  const busy=document.createElement('li'),p=document.createElement('span');p.className='muted';p.textContent='랭킹 조회 중...';busy.append(p);list.append(busy);
  try{
    const targetMode=$('rankMode').value;
    const results=await SmartAILab.ranking('ai-merge',targetMode,'all',$('rankView').value);
    list.replaceChildren();
    if(!results.rankings.length){
      const li=document.createElement('li'),msg=document.createElement('span');
      msg.className='muted';msg.textContent='아직 기록이 없습니다. 첫 1등에 도전하세요!';li.append(msg);list.append(li);return;
    }
    for(const item of results.rankings){
      const li=document.createElement('li'),rank=document.createElement('b'),name=document.createElement('span'),score=document.createElement('strong');
      rank.textContent=String(item.rank);name.textContent=item.nickname;
      score.textContent=fmt(item.score)+'점';
      const small=document.createElement('small');small.textContent=item.floors+'번 놓음';score.append(small);
      li.append(rank,name,score);list.append(li);
    }
    $('rankMsg').textContent=(targetMode==='daily'?'오늘의 퍼즐':'자유 합체')+' · '+results.rankings.length+'개 기록 · TOP 10';
  }catch(error){
    list.replaceChildren();
    const li=document.createElement('li'),msg=document.createElement('span');
    msg.className='muted';msg.textContent='현재 온라인 랭킹을 불러올 수 없습니다.';
    li.append(msg);list.append(li);$('rankMsg').textContent='네트워크 연결을 확인해 주세요.';
  }
}
function setupEvolution(){
  const list=$('evolution');
  for(let tier=1;tier<=9;tier++){
    const item=document.createElement('div');item.className='evo';
    const dot=document.createElement('span');dot.className='dot';dot.style.setProperty('--tone',colors[tier]);
    const title=document.createElement('span');title.textContent='Lv.'+tier+' '+names[tier];
    item.append(dot,title);list.append(item);
  }
}
$('board').addEventListener('pointerdown',e=>{
  if(!playing||!state)return;
  e.preventDefault();
  const bounds=$('board').getBoundingClientRect();
  const column=Math.max(0,Math.min(COLS-1,Math.floor((e.clientX-bounds.left)/bounds.width*COLS)));
  drop(column);
});
$('leftBtn').addEventListener('click',()=>{if(playing){updateSelected(selected-1);sound(320,.035);}});
$('rightBtn').addEventListener('click',()=>{if(playing){updateSelected(selected+1);sound(390,.035);}});
$('dropBtn').addEventListener('click',()=>drop());
$('board').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&playing){e.preventDefault();drop();}});
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName))return;
  if(!playing||e.repeat)return;
  if(['ArrowLeft','a','A'].includes(e.key)){e.preventDefault();updateSelected(selected-1);}
  if(['ArrowRight','d','D'].includes(e.key)){e.preventDefault();updateSelected(selected+1);}
  if(e.key===' '||e.key==='Enter'){e.preventDefault();drop();}
});
$('startBtn').addEventListener('click',start);
$('againBtn').addEventListener('click',()=>{if(saveBusy)return;$('endOverlay').hidden=true;$('startOverlay').hidden=false;$('startMsg').textContent='';$('titleScreen').hidden=false;document.body.classList.remove('merge-playing');$('titleSetupDialog').showModal();});
$('quitBtn').addEventListener('click',()=>{if(playing&&confirm('지금까지의 점수를 저장하고 종료하시겠습니까?'))finish();});
$('speedBtn').addEventListener('click',()=>{
  fastMode=!fastMode;
  localStorage.setItem('smart-ai-merge-fast',String(fastMode));
  $('speedBtn').textContent=fastMode?'연출 빠름':'연출 보통';
  $('speedBtn').setAttribute('aria-pressed',String(fastMode));
  $('titleSpeedSwitch').checked=fastMode;
});
$('speedBtn').textContent=fastMode?'연출 빠름':'연출 보통';
$('speedBtn').setAttribute('aria-pressed',String(fastMode));
$('soundBtn').addEventListener('click',()=>{soundEnabled=!soundEnabled;localStorage.setItem('smart-ai-merge-sound',String(soundEnabled));$('soundBtn').textContent=soundEnabled?'소리 켜짐':'소리 꺼짐';$('titleSoundSwitch').checked=soundEnabled;});
$('refreshRank').addEventListener('click',loadRankings);
$('rankMode').addEventListener('change',loadRankings);
$('rankView').addEventListener('change',loadRankings);
$('shareBtn').addEventListener('click',async()=>{
  const text='AI 몬스터 합체 '+fmt(state?state.score:0)+'점! 나도 로봇을 진화시켰어요. '+location.href;
  try{if(navigator.share)await navigator.share({title:'AI 몬스터 합체',text});else{await navigator.clipboard.writeText(text);$('saveState').textContent='공유 문구를 복사했습니다.';}}
  catch{}
});

/* 시작 화면: 기존 플레이 기능·ID·닉네임·서버 API를 그대로 재사용합니다. */
$('titleSetupHost').append($('startOverlay'));
$('titlePlayBtn').addEventListener('click',()=>{
  $('titleSetupDialog').showModal();
  $('nickname').focus();
});
$('titleSetupClose').addEventListener('click',()=>$('titleSetupDialog').close());

/* 도트 시작화면 랭킹: 기존 온라인 TOP 10을 동일하게 조회합니다. */
async function loadTitleRanks(){
  const list=$('titleRankList');
  list.replaceChildren();
  const waiting=document.createElement('li');
  waiting.textContent='온라인 랭킹을 불러오는 중...';list.append(waiting);
  try{
    const mode=$('titleRankMode').value,view=$('titleRankView').value;
    const data=await SmartAILab.ranking('ai-merge',mode,'all',view);
    if(mode!==$('titleRankMode').value||view!==$('titleRankView').value)return;
    list.replaceChildren();
    if(!data.rankings.length){
      const li=document.createElement('li');
      li.textContent='아직 기록이 없습니다. 첫 번째 도전에 참여하세요!';list.append(li);
      return;
    }
    for(const item of data.rankings.slice(0,10)){
      const row=document.createElement('li');
      const number=document.createElement('strong'),name=document.createElement('span'),score=document.createElement('strong');
      number.textContent=String(item.rank).padStart(2,'0');
      name.textContent=item.nickname;
      score.textContent=fmt(item.score)+'점';
      row.append(number,name,score);
      list.append(row);
    }
  }catch(error){
    list.replaceChildren();
    const message=document.createElement('li');
    message.textContent='현재 랭킹을 조회할 수 없습니다. 연결을 확인해 주세요.';
    list.append(message);
  }
}
$('titleRankBtn').addEventListener('click',()=>{
  $('titleRankDialog').showModal();
  loadTitleRanks();
});
$('titleRankClose').addEventListener('click',()=>$('titleRankDialog').close());
$('titleRankReload').addEventListener('click',loadTitleRanks);
$('titleRankMode').addEventListener('change',loadTitleRanks);
$('titleRankView').addEventListener('change',loadTitleRanks);

/* 설정: 타이틀과 게임 중 버튼을 연동하고 브라우저에 유지합니다. */
$('titleSettingsBtn').addEventListener('click',()=>{
  $('titleSoundSwitch').checked=soundEnabled;
  $('titleSpeedSwitch').checked=fastMode;
  $('titleSettingsDialog').showModal();
});
$('titleSettingsClose').addEventListener('click',()=>$('titleSettingsDialog').close());
$('titleSettingsDone').addEventListener('click',()=>$('titleSettingsDialog').close());
$('titleSoundSwitch').addEventListener('change',()=>{
  soundEnabled=$('titleSoundSwitch').checked;
  localStorage.setItem('smart-ai-merge-sound',String(soundEnabled));
  $('soundBtn').textContent=soundEnabled?'소리 켜짐':'소리 꺼짐';
});
$('titleSpeedSwitch').addEventListener('change',()=>{
  fastMode=$('titleSpeedSwitch').checked;
  localStorage.setItem('smart-ai-merge-fast',String(fastMode));
  $('speedBtn').textContent=fastMode?'연출 빠름':'연출 보통';
  $('speedBtn').setAttribute('aria-pressed',String(fastMode));
});
$('soundBtn').textContent=soundEnabled?'소리 켜짐':'소리 꺼짐';
$('titleSoundSwitch').checked=soundEnabled;
$('titleSpeedSwitch').checked=fastMode;

setupEvolution();loadRankings();
