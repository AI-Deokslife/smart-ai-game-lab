import {
  WIDTH,HEIGHT,FPS,FRAME_MS,MAX_TICKS,BASE_Y,
  createJumpGame,stepJumpGame,platformX,packJumpInputs,jumpSummary
} from './engine.js';

const $=id=>document.getElementById(id);
const ctx=$('scene').getContext('2d');
ctx.setTransform(2,0,0,2,0,0);
const fmt=n=>Number(n).toLocaleString('ko-KR');
const held={left:false,right:false,jump:false};
const fx=[];
const KST=9*60*60*1000;
let state=null,mode='classic',session=null,trace=[],playing=false,paused=false;
let count=0,countTime=0,lastTime=0,accum=0,saving=false,finishOnce=false;
let queuedJump=false,audio=null,soundOn=localStorage.getItem('ai-jump-muted')!=='true';
$('nickname').value=localStorage.getItem('ai-jump-nickname')||'AI 점퍼';
$('soundBtn').textContent=soundOn?'♪ 소리 켜짐':'♪ 소리 꺼짐';

function gameDate(t=Date.now()){return new Date(t+KST).toISOString().slice(0,10);}
function localKey(type){return 'ai-jump-'+mode+'-'+type;}
function savedStats(){
  $('localHigh').textContent=fmt(Number(localStorage.getItem(localKey('score'))||0));
  $('localFloor').textContent=fmt(Number(localStorage.getItem(localKey('floors'))||0));
}
savedStats();
function beep(frequency=510,duration=.08,type='triangle'){
  if(!soundOn)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    audio ||=new AC();
    if(audio.state==='suspended')audio.resume().catch(()=>{});
    const osc=audio.createOscillator(),gain=audio.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(frequency,audio.currentTime);
    gain.gain.setValueAtTime(.045,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    osc.connect(gain);gain.connect(audio.destination);
    osc.start();osc.stop(audio.currentTime+duration+.015);
  }catch{}
}
function clearInputs(){
  held.left=false;held.right=false;held.jump=false;queuedJump=false;
  for(const button of ['leftBtn','rightBtn','jumpBtn'])$(button).classList.remove('held');
}
function inputMask(){
  let mask=(held.left?1:0)|(held.right?2:0);
  if(held.jump||queuedJump)mask|=4;
  queuedJump=false;
  return mask;
}
function hud(){
  if(!state)return;
  const summary=jumpSummary(state);
  $('hudScore').textContent=fmt(summary.score);
  $('hudFloors').textContent=summary.floors+' F';
  $('hudStars').textContent=state.stars+' ★';
  $('hudTime').textContent=Math.ceil(Math.max(0,MAX_TICKS[mode]-state.tick)/FPS);
  $('modeLabel').textContent=mode==='daily'?'오늘의 60초 도전':'자유 도전';
  $('hearts').textContent='♥ '.repeat(state.hearts)+'♡ '.repeat(3-state.hearts);
  $('timeMeter').style.transform='scaleX('+Math.max(0,(MAX_TICKS[mode]-state.tick)/MAX_TICKS[mode])+')';
}
function overlay(id,visible){$(id).hidden=!visible;}
async function start(){
  if(saving||playing)return;
  const nickname=$('nickname').value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(nickname.length<2||nickname.length>12||!/^[-_\p{L}\p{N} ]+$/u.test(nickname)){
    $('startMessage').textContent='닉네임은 한글·영문·숫자 2~12자로 입력하세요.';return;
  }
  localStorage.setItem('ai-jump-nickname',nickname);
  mode=$('modeSelect').value;
  $('startBtn').disabled=true;$('startMessage').textContent='게임 준비 중...';
  let seed=crypto.randomUUID();
  session=null;
  try{
    session=await SmartAILab.begin('ai-jump',mode,nickname);
    seed=mode==='daily'?gameDate(session.startedAt):session.sessionId;
    $('startMessage').textContent='';
  }catch(error){
    if(mode==='daily')seed=gameDate();
    $('startMessage').textContent='온라인 연결 없이 연습 모드로 실행합니다.';
  }
  state=createJumpGame(seed,mode);
  trace=[];fx.length=0;clearInputs();accum=0;finishOnce=false;
  playing=false;paused=false;saving=false;
  overlay('startOverlay',false);overlay('endOverlay',false);overlay('pauseOverlay',false);
  overlay('countOverlay',true);
  count=3;countTime=0;$('countNumber').textContent=String(count);
  $('rankMode').value=mode;loadRanks();hud();
  $('startBtn').disabled=false;
  beep(620,.1);
}
function pause(toggle){
  if(count>0&&!playing)return;
  if(finishOnce||!state||saving)return;
  if(toggle===undefined)paused=!paused;else paused=toggle;
  if(paused)clearInputs();
  overlay('pauseOverlay',paused);
  lastTime=performance.now();accum=0;
}
function addFx(x,y,color,text=''){
  fx.push({x,y,color,text,life:38,total:38,dx:(Math.random()-.5)*2.5});
  if(fx.length>50)fx.shift();
}
function onEvent(){
  const event=state.event;
  if(!event)return;
  if(event==='jump'){
    beep(420,.07);addFx(state.x,state.y-9,'#99ffec');
  }else if(event==='land'){
    beep(280,.045);addFx(state.x,state.y,'#9ae9fb');
  }else if(event==='spring'){
    beep(820,.14);addFx(state.x,state.y,'#99ffa3','SPRING!');
  }else if(event==='star'){
    beep(960,.11);addFx(state.x,state.y+50,'#ffe594','+75');
    navigator.vibrate?.(13);
  }else if(event==='hit'){
    beep(155,.2,'sawtooth');addFx(state.x,state.y,'#ff83aa','OUCH!');
    navigator.vibrate?.([65,45,60]);
  }
}
async function finish(){
  if(finishOnce||!state)return;
  finishOnce=true;playing=false;paused=false;count=0;clearInputs();
  overlay('pauseOverlay',false);overlay('countOverlay',false);overlay('endOverlay',true);
  const current=jumpSummary(state);
  $('resultScore').textContent=fmt(current.score)+'점';
  $('resultReason').textContent=state.reason||'도전을 종료했습니다.';
  $('resultMeta').textContent=current.floors+'층 · 별 '+current.perfects+'개 · 최고 연속 '+current.combo;
  const best=Math.max(Number(localStorage.getItem(localKey('score'))||0),current.score);
  const floors=Math.max(Number(localStorage.getItem(localKey('floors'))||0),current.floors);
  localStorage.setItem(localKey('score'),String(best));
  localStorage.setItem(localKey('floors'),String(floors));
  savedStats();
  $('onlineMessage').textContent='온라인 점수를 확인하는 중입니다...';
  saving=true;
  try{
    if(!session)throw new Error('오프라인 모드로 플레이했습니다.');
    if(!trace.length)throw new Error('게임 기록이 충분하지 않습니다.');
    const result=await SmartAILab.finish(
      {...current,ticks:trace.length,trace:packJumpInputs(trace)},
      Promise.resolve(session));
    $('onlineMessage').textContent=result?.ok?'온라인 TOP 10 랭킹에 기록되었습니다.':'기록을 저장하지 못했습니다.';
    loadRanks();
  }catch(error){
    $('onlineMessage').textContent='이 기기의 기록은 저장했습니다. 온라인 저장: '+error.message;
  }finally{saving=false;}
}
async function loadRanks(){
  const list=$('rankList');list.replaceChildren();
  const wait=document.createElement('li');wait.className='empty';wait.textContent='랭킹 조회 중...';list.append(wait);
  const mode=$('rankMode').value,period=$('rankPeriod').value,view=$('rankView').value;
  try{
    const data=await SmartAILab.ranking('ai-jump',mode,period,view);
    if(mode!==$('rankMode').value||period!==$('rankPeriod').value||view!==$('rankView').value)return;
    list.replaceChildren();
    if(!data.rankings.length){
      const li=document.createElement('li');li.className='empty';li.textContent='아직 등록된 기록이 없습니다. 첫 기록에 도전하세요!';list.append(li);return;
    }
    for(const item of data.rankings.slice(0,10)){
      const li=document.createElement('li'),rank=document.createElement('b'),name=document.createElement('span'),points=document.createElement('strong'),floor=document.createElement('small');
      rank.textContent=item.rank;name.textContent=item.nickname;
      points.textContent=fmt(item.score)+'점';
      floor.textContent=item.floors+'층';points.append(floor);
      li.append(rank,name,points);list.append(li);
    }
  }catch{
    list.replaceChildren();
    const li=document.createElement('li');li.className='empty';li.textContent='온라인 랭킹을 불러올 수 없습니다.';list.append(li);
  }
}
function pix(x,y,w,h,color){
  ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
}
function worldY(value){return HEIGHT-(value-state.cameraY);}
function backdrop(timestamp){
  const gradient=ctx.createLinearGradient(0,0,0,HEIGHT);
  gradient.addColorStop(0,'#15244e');gradient.addColorStop(.52,'#303f87');gradient.addColorStop(1,'#744e95');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,WIDTH,HEIGHT);
  const camera=state?state.cameraY:0;
  for(let i=0;i<46;i++){
    const x=((i*91+27)%397);
    const y=((i*137-camera*.14)%730+730)%730;
    pix(x,y,2+(i%3===0?2:0),2,'#bdefff86');
  }
  for(let i=0;i<14;i++){
    const x=i*33-13,width=23+(i%4)*9,height=80+(i*47)%130;
    const offset=(camera*.19)%80;
    pix(x,HEIGHT-height+offset,width,height+85,'#14254d98');
    for(let row=0;row<5;row++)for(let col=0;col<2;col++){
      if((i+row+col)%3!==0)pix(x+5+col*10,HEIGHT-height+offset+14+row*19,4,6,'#80bee76a');
    }
  }
  ctx.strokeStyle='#a7e8ff12';ctx.lineWidth=1;
  for(let x=0;x<=WIDTH;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,HEIGHT);ctx.stroke();}
}
function platformDraw(platform){
  if(!platform.active)return;
  const y=worldY(platform.y),x=platformX(platform,state.tick),w=platform.w;
  if(y<-110||y>HEIGHT+70)return;
  const palette={
    solid:['#7fffe6','#30b9bf','#164c84'],
    moving:['#c3a6ff','#846cce','#4c4a9d'],
    fragile:['#ffca91','#ef8d75','#9b5276'],
    spring:['#bdfb91','#68d48e','#277b6e']
  }[platform.type];
  // 그림자와 입체 두께
  pix(x-w/2+5,y+9,w,12,'#0616367b');
  pix(x-w/2,y-1,w,17,palette[2]);
  pix(x-w/2-2,y-7,w+4,10,palette[0]);
  pix(x-w/2+6,y-5,w-12,3,'#f2fffac9');
  pix(x-w/2+4,y+7,w-8,5,palette[1]);
  if(platform.type==='fragile'){
    ctx.strokeStyle='#713f6a';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x-16,y-4);ctx.lineTo(x-9,y+1);ctx.lineTo(x-1,y-2);ctx.lineTo(x+4,y+5);ctx.stroke();
    if(platform.breakAt!==null)pix(x-w/2,y-7,w+4,10,'#f8b7c077');
  }else if(platform.type==='spring'){
    pix(x-23,y-15,46,8,'#c5ffb4');
    ctx.strokeStyle='#ccffb8';ctx.lineWidth=2;
    ctx.beginPath();for(let j=0;j<6;j++)ctx.lineTo(x-17+j*7,y-15-(j%2)*6);ctx.stroke();
  }else if(platform.type==='moving'){
    pix(x-3,y+9,6,7,'#dec3ff');
    pix(x-w/2+2,y+12,6,4,'#d2bfff');
  }
  if(platform.star&&!platform.taken)drawStar(x,y-44+Math.sin(state.tick*.19+platform.id)*3);
  if(platform.drone)drawDrone(platform);
}
function drawStar(x,y){
  const scale=1+Math.sin(performance.now()*.006)*.09;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.fillStyle='#ffe795';ctx.strokeStyle='#fff9d4';ctx.lineWidth=2;
  ctx.beginPath();
  for(let i=0;i<10;i++){
    const theta=-Math.PI/2+i*Math.PI/5,rad=i%2?8:17;
    const xx=Math.cos(theta)*rad,yy=Math.sin(theta)*rad;
    if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);
  }
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.restore();
}
function drawDrone(platform){
  const x=platform.x+Math.sin(state.tick*.065+platform.id)*47;
  const y=worldY(platform.y+66);
  if(y<-35||y>HEIGHT+35)return;
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(state.tick*.17)*.18);
  ctx.shadowColor='#ff729e';ctx.shadowBlur=17;
  pix(-15,-10,30,19,'#953757');pix(-10,-13,20,5,'#ff8493');
  pix(-21,-3,8,5,'#fb83b2');pix(13,-3,8,5,'#fb83b2');
  pix(-6,-1,12,7,'#ffeded');pix(-3,0,6,4,'#ed4357');
  ctx.restore();
}
function playerDraw(){
  const x=state.x,y=worldY(state.y),facing=state.facing||1;
  if(y<-110||y>HEIGHT+110)return;
  ctx.save();ctx.translate(x,y);ctx.scale(facing,1);
  if(state.invulnerable>0&&state.tick%4<2)ctx.globalAlpha=.45;
  if(!state.grounded&&state.vy>0){
    pix(-12,0,9,14,'#ffb963');pix(3,0,9,14,'#ffb963');
    pix(-9,14,5,6,'#ffe3a0');pix(5,14,5,6,'#ffe3a0');
  }
  const sway=state.grounded?Math.sin(state.tick*.6)*3:Math.min(7,Math.abs(state.vy)*.3);
  pix(-17,-16+sway,14,15,'#324f92');pix(4,-16-sway,14,15,'#324f92');
  pix(-20,-8+sway,17,8,'#ffcf86');pix(5,-8-sway,18,8,'#ffcf86');
  pix(-24,-49,12,31,'#5bb0dc');
  pix(-16,-54,37,38,'#e9f9ff');pix(-12,-47,30,25,'#74dedc');
  pix(-2,-44,13,13,'#295c96');pix(0,-42,9,9,'#ffedb5');
  // 작은 측면 로봇 머리: 한쪽으로 튀어나온 마스크와 한쪽 눈
  pix(-23,-100,48,50,'#f5fcff');
  pix(-18,-92,42,33,'#33497d');
  pix(3,-86,13,15,'#9dffed');
  pix(20,-79,11,18,'#f5fcff');
  pix(23,-74,5,4,'#ff8faf');
  pix(-6,-112,6,12,'#aacaff');pix(-7,-117,9,6,'#ffe3a0');
  pix(17,-45,12,27,'#61cde4');
  pix(18,-21,14,8,'#edfaff');
  ctx.restore();
}
function drawFx(){
  for(let i=fx.length-1;i>=0;i--){
    const part=fx[i],y=worldY(part.y)-(part.total-part.life)*1.3;
    ctx.save();ctx.globalAlpha=Math.max(0,part.life/part.total);
    ctx.fillStyle=part.color;
    ctx.font='900 18px system-ui';ctx.textAlign='center';
    if(part.text)ctx.fillText(part.text,part.x+part.dx,y-35);
    else for(let n=0;n<6;n++){
      const theta=n*Math.PI/3,dist=(part.total-part.life)*.4;
      pix(part.x+Math.cos(theta)*dist,y+Math.sin(theta)*dist,4,4,part.color);
    }
    ctx.restore();
    part.life-=1;
    if(part.life<=0)fx.splice(i,1);
  }
}
function draw(now){
  backdrop(now);
  if(!state)return;
  for(const platform of state.platforms)platformDraw(platform);
  if(state.cameraY>0){
    ctx.fillStyle='#ff6da64a';
    ctx.fillRect(0,HEIGHT-12,WIDTH,12);
  }
  playerDraw();drawFx();
  if(state.grounded&&playing&&!paused){
    ctx.fillStyle='#a6ffe8b8';ctx.font='900 12px system-ui';ctx.textAlign='center';
    ctx.fillText('SPACE / ↑ 점프',state.x,worldY(state.y)-122);
  }
}
function loop(now){
  const elapsed=Math.min(120,now-(lastTime||now));
  lastTime=now;
  if(state){
    if(count>0){
      countTime+=elapsed;
      if(countTime>=900){
        countTime=0;count--;
        if(count>0){$('countNumber').textContent=count;beep(670,.05);}
        else{overlay('countOverlay',false);playing=true;beep(960,.11);accum=0;clearInputs();}
      }
    }else if(playing&&!paused&&!finishOnce){
      accum+=elapsed;
      let loops=0;
      while(accum>=FRAME_MS&&loops<4&&playing){
        const mask=inputMask();
        trace.push(mask);
        stepJumpGame(state,mask);
        onEvent();
        accum-=FRAME_MS;loops++;
        if(state.over){finish();break;}
      }
      hud();
    }
  }
  draw(now);
  requestAnimationFrame(loop);
}
function bindControl(id,key){
  const button=$(id);
  const press=event=>{
    if(event.type==='pointerdown'){
      event.preventDefault();
      try{button.setPointerCapture(event.pointerId);}catch{}
    }
    if(key==='jump'&&!held.jump)queuedJump=true;
    held[key]=true;button.classList.add('held');
  };
  const release=()=>{
    held[key]=false;button.classList.remove('held');
  };
  button.addEventListener('pointerdown',press);
  for(const eventName of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(eventName,release);
  button.addEventListener('click',event=>{
    if(event.detail===0){
      if(key==='jump')queuedJump=true;
      else{
        held[key]=true;
        setTimeout(()=>{held[key]=false;},110);
      }
    }
  });
}
bindControl('leftBtn','left');bindControl('rightBtn','right');bindControl('jumpBtn','jump');
document.addEventListener('keydown',event=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  const key=event.key.toLowerCase();
  if(['a','d','arrowleft','arrowright',' ','arrowup','escape','p'].includes(key))event.preventDefault();
  if(key==='a'||key==='arrowleft')held.left=true;
  if(key==='d'||key==='arrowright')held.right=true;
  if(key===' '||key==='arrowup'){
    if(!held.jump)queuedJump=true;
    held.jump=true;
  }
  if((key==='escape'||key==='p')&&!event.repeat&&playing)pause();
});
document.addEventListener('keyup',event=>{
  const key=event.key.toLowerCase();
  if(key==='a'||key==='arrowleft')held.left=false;
  if(key==='d'||key==='arrowright')held.right=false;
  if(key===' '||key==='arrowup')held.jump=false;
});
window.addEventListener('blur',()=>{if(playing&&!paused)pause(true);clearInputs();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing&&!paused)pause(true);});
$('startBtn').addEventListener('click',start);
$('resumeBtn').addEventListener('click',()=>pause(false));
$('pauseBtn').addEventListener('click',()=>{if(playing)pause();});
$('pauseQuitBtn').addEventListener('click',()=>{if(playing)finish();});
$('againBtn').addEventListener('click',()=>{if(saving)return;state=null;playing=false;paused=false;clearInputs();overlay('endOverlay',false);overlay('startOverlay',true);});
$('soundBtn').addEventListener('click',()=>{
  soundOn=!soundOn;localStorage.setItem('ai-jump-muted',String(!soundOn));
  $('soundBtn').textContent=soundOn?'♪ 소리 켜짐':'♪ 소리 꺼짐';
});
for(const id of ['rankMode','rankPeriod','rankView'])$(id).addEventListener('change',loadRanks);
$('reloadRanks').addEventListener('click',loadRanks);
loadRanks();requestAnimationFrame(loop);
