import {COLS,ROWS,MAX_TURNS,createMergeGame,dropMergeRobot,mergeScoreSummary} from './engine.js';
const $=id=>document.getElementById(id);
const names=['','새싹봇','번개봇','꿈틀봇','스타봇','그린봇','갤럭시봇','파이어봇','아쿠아봇','레전드봇'];
const colors=['','#73e9de','#9cb3ff','#ffb2d0','#ffd47d','#a8e9a3','#c9aaff','#ffa18d','#8fe1ff','#ffed9e'];
const fmt=n=>Number(n).toLocaleString('ko-KR');
const localKey=m=>'smart-ai-merge-high-'+m;
let state=null,selected=2,session=null,playing=false,soundEnabled=true,mode='classic',saveBusy=false,audio=null,toastTimer=0;
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
  b.append(face,label);return b;
}
function draw(){
  if(!state)return;
  const grid=$('grid'),fragment=document.createDocumentFragment();
  for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
    const tier=state.grid[row][col],cell=document.createElement('div');
    cell.className='cell'+(tier?' filled':'')+(selected===col?' drop-focus':'');
    if(tier)cell.append(bot(tier,Boolean(state.last&&state.last.chains.length)));
    fragment.append(cell);
  }
  grid.replaceChildren(fragment);
  $('nextBot').replaceChildren(bot(state.next));
  $('nextName').textContent='Lv. '+state.next+' · '+names[state.next];
  $('score').textContent=fmt(state.score);
  $('turns').textContent=fmt(state.moves.length)+' / '+MAX_TURNS[mode];
  $('merges').textContent=fmt(state.merges);
  $('best').textContent=fmt(Math.max(state.score,Number(localStorage.getItem(localKey(mode))||0)));
  $('laneArrow').style.transform='translateX('+(selected*100)+'%)';
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
  if(state)draw();
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
  selected=2;playing=true;saveBusy=false;
  $('startOverlay').hidden=true;$('endOverlay').hidden=true;
  $('modeTag').textContent=mode==='daily'?'오늘의 퍼즐 · 35번':'자유 합체 · 160번';
  $('rankMode').value=mode;
  draw();loadRankings();sound(700,.12);
}
function drop(column=selected){
  if(!playing||!state)return;
  selected=column;
  const result=dropMergeRobot(state,column);
  if(!result.ok){sound(180,.1,'sawtooth');toast('이 열은 가득 찼어요');draw();return;}
  draw();
  if(result.last.combo){
    sound(460,.09);
    setTimeout(()=>sound(660+Math.min(5,result.last.combo)*110,.14),70);
    toast(result.last.combo>=2?'CHAIN ×'+result.last.combo+' · +'+fmt(result.last.gained)+'점':'합체 성공! +'+fmt(result.last.gained)+'점');
    navigator.vibrate?.(result.last.combo>1?[25,35,25]:18);
  }else sound(340,.055);
  if(result.over)finish();
}
async function finish(){
  if(!playing||!state)return;
  playing=false;
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
$('againBtn').addEventListener('click',()=>{if(saveBusy)return;$('endOverlay').hidden=true;$('startOverlay').hidden=false;$('startMsg').textContent='';});
$('quitBtn').addEventListener('click',()=>{if(playing&&confirm('지금까지의 점수를 저장하고 종료하시겠습니까?'))finish();});
$('soundBtn').addEventListener('click',()=>{soundEnabled=!soundEnabled;$('soundBtn').textContent=soundEnabled?'소리 켜짐':'소리 꺼짐';});
$('refreshRank').addEventListener('click',loadRankings);
$('rankMode').addEventListener('change',loadRankings);
$('rankView').addEventListener('change',loadRankings);
$('shareBtn').addEventListener('click',async()=>{
  const text='AI 몬스터 합체 '+fmt(state?state.score:0)+'점! 나도 로봇을 진화시켰어요. '+location.href;
  try{if(navigator.share)await navigator.share({title:'AI 몬스터 합체',text});else{await navigator.clipboard.writeText(text);$('saveState').textContent='공유 문구를 복사했습니다.';}}
  catch{}
});
setupEvolution();loadRankings();
