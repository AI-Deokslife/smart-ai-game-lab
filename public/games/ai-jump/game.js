import {
  WIDTH,HEIGHT,FPS,FRAME_MS,MAX_TICKS,BASE_Y,
  createJumpGame,stepJumpGame,platformX,packJumpInputs,jumpSummary
} from './engine.js';

const $=id=>document.getElementById(id);
const ctx=$('scene').getContext('2d');
ctx.setTransform(2,0,0,2,0,0);ctx.imageSmoothingEnabled=false;
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
function localKey(type){return 'ai-jump-v2-'+mode+'-'+type;}
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
  $('hudFloors').textContent=summary.floors+' m';
  $('stageLabel').textContent='STAGE '+String(1+Math.floor((state.bestX-84)/1600)).padStart(2,'0');
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
  }else if(event==='double'){
    beep(740,.11);addFx(state.x,state.y+15,'#9dfae8','DOUBLE!');
  }else if(event==='checkpoint'){
    beep(1040,.16);addFx(state.x,state.y+35,'#fbe58e','CHECKPOINT');
  }else if(event==='fall'){
    beep(175,.17,'sawtooth');addFx(state.x,state.y+20,'#ff81b0','RETRY');
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
  $('resultMeta').textContent='거리 '+current.floors+'m · 별 '+current.perfects+'개 · 연속 착지 '+current.combo;
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
      floor.textContent=item.floors+'m';points.append(floor);
      li.append(rank,name,points);list.append(li);
    }
  }catch{
    list.replaceChildren();
    const li=document.createElement('li');li.className='empty';li.textContent='온라인 랭킹을 불러올 수 없습니다.';list.append(li);
  }
}
function pix(x,y,w,h,color){
  ctx.fillStyle=color;
  ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
}
function worldX(x){return x-(state?.cameraX||0);}
function worldY(y){return HEIGHT-(y-(state?.cameraY||0));}
function backdrop(timestamp){
  const camera=state?.cameraX||0;
  const stage=1+Math.floor((state?.bestX||84)/1600);
  const hue=(stage%4)*6;
  const sky=ctx.createLinearGradient(0,0,0,HEIGHT);
  sky.addColorStop(0,'#090d30');sky.addColorStop(.35,'#1a195e');
  sky.addColorStop(.68,'#763c89');sky.addColorStop(.81,'#eb719a');sky.addColorStop(1,'#ffab83');
  ctx.fillStyle=sky;ctx.fillRect(0,0,WIDTH,HEIGHT);
  // 달과 거대한 행성 광륜
  ctx.fillStyle='#fca9ce23';ctx.beginPath();ctx.arc(492-camera*.02%90,89,76,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ffe6bd';ctx.beginPath();ctx.arc(492-camera*.02%90,89,43,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ffabc7';ctx.beginPath();ctx.arc(503-camera*.02%90,78,40,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff0da';
  for(let i=0;i<92;i++){
    const x=((i*137+39-camera*.07)%670+670)%670;
    const y=(i*53+15)%300;
    pix(x,y,i%8===0?3:2,i%7===0?3:2,i%4===0?'#aafcff':'#fff2e5a5');
  }
  // 먼 도시: 자주색과 분홍색 점등, 심도에 따라 다른 패럴랙스
  for(let i=-2;i<25;i++){
    const w=41+(i%4+4)%4*6;
    const x=i*56-((camera*.14)%56);
    const h=60+((i*47+340)%111);
    pix(x,HEIGHT-h+48,w,h+50,'#281e628d');
    for(let y=HEIGHT-h+58;y<HEIGHT;y+=14){
      for(let c=0;c<3;c++){
        if((i+y+c)%4!==0)pix(x+7+c*13,y,4,6,(i+c)%3===0?'#ff8ddab6':'#70bdf6a1');
      }
    }
  }
  const farShift=(camera*.28)%83;
  for(let i=-2;i<11;i++){
    const x=i*83-farShift,w=54+((i+9)%3)*8,h=65+((i*67+702)%130);
    pix(x,HEIGHT-h+23,w,h+28,'#101742');
    pix(x+3,HEIGHT-h+18,w-6,5,(i%3===0?'#ff6bb3':'#47b9eb'));
    for(let row=0;row<9;row++){
      const y=HEIGHT-h+36+row*15;if(y>HEIGHT-5)break;
      for(let col=0;col<3;col++){
        if((i+row+col)%4!==1)
          pix(x+9+col*17,y,6,7,(row+i)%3===0?'#fc64a4b8':'#49cdebab');
      }
    }
  }
  // 마지막 레이어의 하단 빛과 네온 표지판
  pix(0,HEIGHT-20,WIDTH,20,'#14183d99');
  const signX=360-((camera*.12)%570);
  ctx.save();ctx.shadowBlur=13;ctx.shadowColor='#fd76c7';
  ctx.strokeStyle='#fd76c7';ctx.lineWidth=2;ctx.strokeRect(signX,252,114,39);
  ctx.fillStyle='#ffd0f7';ctx.font='900 16px monospace';ctx.textAlign='center';
  ctx.fillText('AI CITY',signX+57,277);ctx.restore();
  // 분할선은 실제 픽셀 아트의 리듬을 살리는 가벼운 느낌
  ctx.strokeStyle='#ecb6ff09';ctx.lineWidth=1;
  for(let x=0;x<=WIDTH;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,HEIGHT);ctx.stroke();}
  for(let y=0;y<HEIGHT;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(WIDTH,y);ctx.stroke();}
}
function drawStar(x,y){
  const scale=1+Math.sin(performance.now()*.006)*.10;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.shadowColor='#ffdd6e';ctx.shadowBlur=16;
  ctx.fillStyle='#fff099';ctx.strokeStyle='#ffe1a0';ctx.lineWidth=2;
  ctx.beginPath();
  for(let i=0;i<10;i++){
    const t=-Math.PI/2+i*Math.PI/5,r=i%2?8:16;
    const px=Math.cos(t)*r,py=Math.sin(t)*r;
    if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  }
  ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
function drawDrone(platform){
  const x=worldX(platform.x+Math.sin(state.tick*.065+platform.id)*36);
  const y=worldY(platform.y+65);
  if(x<-38||x>WIDTH+38||y<-70||y>HEIGHT+45)return;
  ctx.save();ctx.shadowBlur=14;ctx.shadowColor='#ff5eae';
  pix(x-18,y-10,36,21,'#bc3677');pix(x-13,y-16,26,7,'#ff70bd');
  pix(x-27,y-5,10,6,'#fa96d4');pix(x+17,y-5,10,6,'#fa96d4');
  pix(x-8,y-2,16,8,'#290f41');pix(x-4,y,9,5,'#ffedfa');
  pix(x-23,y+6,6,3,'#ffb7dc');pix(x+17,y+6,6,3,'#ffb7dc');
  ctx.restore();
}
function platformDraw(p){
  if(!p.active)return;
  const x=worldX(platformX(p,state.tick)),y=worldY(p.y),w=p.w;
  if(x+w/2<-35||x-w/2>WIDTH+35||y<-80||y>HEIGHT+60)return;
  const palette={
    solid:['#70ffe9','#258ba8','#112d67'],
    moving:['#dd94ff','#7a59b8','#342068'],
    fragile:['#ffb18c','#e46c8b','#6c276e'],
    spring:['#d9fc87','#5ebd86','#22586f']
  }[p.type];
  ctx.save();ctx.shadowBlur=17;ctx.shadowColor=palette[0];
  pix(x-w/2-2,y-8,w+4,9,palette[0]);ctx.restore();
  pix(x-w/2,y+1,w,18,palette[2]);
  pix(x-w/2+5,y+3,w-10,7,palette[1]);
  for(let i=0;i<w/25;i++)pix(x-w/2+8+i*25,y+11,12,3,'#98daf88f');
  pix(x-w/2+5,y-7,w-10,3,'#eeffffaa');
  if(p.type==='moving'){
    pix(x-4,y+3,8,15,'#e6bdff');
    pix(x-w/2+8,y+3,7,5,'#f7d4ff');pix(x+w/2-15,y+3,7,5,'#f7d4ff');
  }
  if(p.type==='fragile'){
    pix(x-15,y-8,5,7,'#6d2768');pix(x-5,y-1,5,10,'#6d2768');
    if(p.breakAt!==null)pix(x-w/2,y-8,w,8,'#ffbbbd88');
  }
  if(p.type==='spring'){
    pix(x-24,y-14,48,8,'#d1ffb5');
    pix(x-17,y-21,34,7,'#79f9d0');
  }
  if(p.id>0&&p.id%7===0){
    ctx.save();ctx.shadowColor='#fbe58c';ctx.shadowBlur=8;
    pix(x-4,y-27,9,20,'#ffe695');pix(x-6,y-31,13,5,'#fff3c3');ctx.restore();
  }
  if(p.star&&!p.taken)drawStar(x,y-45+Math.sin(state.tick*.13+p.id)*3);
  if(p.drone)drawDrone(p);
}
function playerDraw(){
  const x=worldX(state.x),y=worldY(state.y);
  if(x<-70||x>WIDTH+70||y<-100||y>HEIGHT+100)return;
  ctx.save();ctx.translate(x,y);ctx.scale(state.facing||1,1);
  if(state.invulnerable>0&&state.tick%4<2)ctx.globalAlpha=.52;
  ctx.shadowColor=state.jumpsUsed===2?'#d18cff':'#79fff1';ctx.shadowBlur=10;
  // 큼직한 측면 로봇: 머리와 한쪽 눈, 앞으로 돌출된 바이저가 명확하게 보임
  const jog=state.grounded?Math.sin(state.tick*.8)*4:0;
  pix(-15,-18+jog,14,18,'#3d459e');pix(3,-18-jog,14,18,'#3d459e');
  pix(-19,-5+jog,19,7,'#ffe6a0');pix(5,-5-jog,20,7,'#ffe6a0');
  if(state.jumpsUsed>0&&!state.grounded){
    pix(-17,3,10,12,'#fca86f');pix(3,3,10,13,'#ffc183');
    pix(-14,16,6,5,'#fff0be');pix(4,16,6,5,'#fff0be');
  }
  pix(-22,-46,11,24,'#6ad2dd');
  pix(-16,-54,36,37,'#e6fffb');
  pix(-10,-47,27,24,'#54cbdc');
  pix(0,-42,10,10,'#324c96');pix(2,-40,6,6,'#ffedb6');
  pix(16,-39,13,19,'#42a8cc');pix(19,-20,13,6,'#fff5d1');
  pix(-23,-92,48,39,'#e9faff');
  pix(-19,-87,42,27,'#273d77');
  pix(2,-81,13,14,'#8bffed');
  pix(18,-77,13,16,'#e6fffa');pix(25,-73,5,6,'#fa8aa9');
  pix(-6,-103,7,12,'#b9d6fb');pix(-10,-107,15,5,'#ffe3a1');
  ctx.restore();
}
function drawFx(){
  for(let i=fx.length-1;i>=0;i--){
    const part=fx[i],x=worldX(part.x),y=worldY(part.y)-(part.total-part.life)*1.3;
    ctx.save();ctx.globalAlpha=Math.max(0,part.life/part.total);
    ctx.fillStyle=part.color;ctx.textAlign='center';
    ctx.font='900 17px monospace';
    if(part.text)ctx.fillText(part.text,x+part.dx,y-32);
    else for(let n=0;n<7;n++){
      const theta=n*Math.PI*2/7,dist=(part.total-part.life)*.4;
      pix(x+Math.cos(theta)*dist,y+Math.sin(theta)*dist,4,4,part.color);
    }
    ctx.restore();part.life-=1;
    if(part.life<=0)fx.splice(i,1);
  }
}
function draw(now){
  backdrop(now);
  if(!state)return;
  for(const p of state.platforms)platformDraw(p);
  playerDraw();drawFx();
  if(state.grounded&&playing&&!paused&&state.tick<95){
    ctx.save();ctx.fillStyle='#b8fff1';ctx.shadowColor='#64e9f8';ctx.shadowBlur=6;
    ctx.font='900 15px monospace';ctx.textAlign='center';
    ctx.fillText('D → RUN   SPACE ↑ JUMP',WIDTH/2,64);ctx.restore();
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
state=createJumpGame('neon-city-preview','classic');loadRanks();requestAnimationFrame(loop);
