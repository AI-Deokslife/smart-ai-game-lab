/**
 * AI 네온 점프 — 25fps 고정 시간 간격과 결정적 플랫폼 생성 규칙.
 * 동일한 입력 프레임을 서버에서 재실행하여 순위 점수를 검증합니다.
 * 입력 비트: 1=왼쪽, 2=오른쪽, 4=점프.
 */
export const WIDTH=400;
export const HEIGHT=650;
export const FPS=25;
export const FRAME_MS=1000/FPS;
export const BASE_Y=76;
export const PLATFORM_GAP=102;
export const MAX_TICKS={classic:7500,daily:1500};
export const PLAYER_RADIUS=15;
const SPEED=6.3;
const GRAVITY=.74;
const JUMP_V=17.5;

function seedHash(value){
  let h=2166136261;
  for(const char of String(value)){
    h^=char.charCodeAt(0);
    h=Math.imul(h,16777619)>>>0;
  }
  return h||0x7a6ab9f1;
}
function nextRandom(state){
  let v=state.rng|0;
  v^=v<<13;v^=v>>>17;v^=v<<5;
  state.rng=v>>>0;
  return state.rng/4294967296;
}
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
function makePlatform(state,index){
  const last=state.platforms[state.platforms.length-1];
  const drift=(nextRandom(state)-.5)*184;
  const x=clamp(last.x+drift,70,330);
  const chance=nextRandom(state);
  const type=index>2 && index%12===0?'spring':
    index>3 && chance<.16?'moving':
    index>3 && chance<.32?'fragile':'solid';
  const w=clamp(115-index*.16,80,115);
  const star=nextRandom(state)<.63;
  const drone=index>4 && index%9===0;
  return {id:index,x,y:BASE_Y+index*PLATFORM_GAP,w,type,star,drone,
    taken:false,active:true,breakAt:null};
}
function ensurePlatforms(state){
  const horizon=Math.max(state.bestY,state.y)+HEIGHT*1.4;
  while(state.platforms[state.platforms.length-1].y<horizon &&
        state.platforms.length<300){
    const id=state.platforms.length;
    state.platforms.push(makePlatform(state,id));
  }
}
export function platformX(platform,tick){
  if(platform.type!=='moving')return platform.x;
  return clamp(platform.x+Math.sin(tick*.055+platform.id*.8)*30,51,349);
}
export function jumpSummary(state){
  const floors=Math.max(0,Math.floor((state.bestY-BASE_Y)/PLATFORM_GAP));
  return {score:floors*100+state.stars*75+state.bestCombo*25,
    floors,perfects:state.stars,combo:state.bestCombo};
}
export function createJumpGame(seed,mode='classic'){
  if(!Object.hasOwn(MAX_TICKS,mode))throw new Error('지원하지 않는 점프 모드입니다.');
  const state={
    mode,rng:seedHash(seed),tick:0,x:200,y:BASE_Y,vy:0,
    grounded:true,groundId:0,facing:1,previousJump:false,coyote:5,
    jumpBuffer:0,invulnerable:0,hearts:3,
    platforms:[{id:0,x:200,y:BASE_Y,w:190,type:'solid',star:false,
      drone:false,taken:false,active:true,breakAt:null}],
    stars:0,landings:0,combo:0,bestCombo:0,lastLanding:-1,
    bestY:BASE_Y,cameraY:0,over:false,reason:'',event:'',
  };
  ensurePlatforms(state);
  return state;
}
function hitDrone(state,platform){
  if(!platform.drone||state.invulnerable>0)return false;
  const droneX=platform.x+Math.sin(state.tick*.065+platform.id)*47;
  const droneY=platform.y+66;
  return Math.abs(state.x-droneX)<25&&Math.abs(state.y-droneY)<30;
}
export function stepJumpGame(state,inputMask){
  if(state.over)return false;
  if(!Number.isInteger(inputMask)||inputMask<0||inputMask>7)throw new Error('조작 입력이 올바르지 않습니다.');
  state.tick++;
  state.event='';
  const jump=!!(inputMask&4);
  const horizontal=(inputMask&1)?-1:0;
  const direction=horizontal+((inputMask&2)?1:0);
  if(direction)state.facing=direction;
  const previousX=state.x;
  state.x=clamp(state.x+SPEED*direction,PLAYER_RADIUS,WIDTH-PLAYER_RADIUS);
  if(state.grounded&&state.groundId!==null){
    const support=state.platforms[state.groundId];
    if(support&&support.type==='moving'){
      state.x=clamp(state.x+platformX(support,state.tick)-platformX(support,state.tick-1),
        PLAYER_RADIUS,WIDTH-PLAYER_RADIUS);
    }
  }
  if(jump&&!state.previousJump)state.jumpBuffer=5;
  state.previousJump=jump;
  if(state.jumpBuffer>0)state.jumpBuffer--;
  if(state.invulnerable>0)state.invulnerable--;

  for(const platform of state.platforms){
    if(platform.breakAt!==null&&state.tick>=platform.breakAt)platform.active=false;
  }
  const support=state.platforms[state.groundId];
  if(state.grounded&&(!support||!support.active||
       Math.abs(state.x-platformX(support,state.tick))>support.w/2+PLAYER_RADIUS*.7)){
    state.grounded=false;
    state.groundId=null;
    state.coyote=5;
  }
  if(state.grounded)state.coyote=5;
  else state.coyote=Math.max(0,state.coyote-1);
  if(state.jumpBuffer>0&&(state.grounded||state.coyote>0)){
    state.vy=JUMP_V;
    state.grounded=false;
    state.groundId=null;
    state.coyote=0;
    state.jumpBuffer=0;
    state.event='jump';
  }
  if(!state.grounded){
    const prevY=state.y;
    state.y+=state.vy;
    state.vy-=GRAVITY;
    if(state.vy<=0){
      let hit=null;
      for(const platform of state.platforms){
        if(!platform.active||platform.y>prevY+.01||platform.y<state.y-.01)continue;
        const px=platformX(platform,state.tick);
        if(Math.abs(state.x-px)>platform.w/2+PLAYER_RADIUS*.65)continue;
        if(!hit||platform.y>hit.y)hit=platform;
      }
      if(hit){
        state.y=hit.y;
        state.vy=0;
        state.grounded=true;
        state.groundId=hit.id;
        state.coyote=5;
        state.landings++;
        if(hit.id>state.lastLanding){
          state.combo++;
          state.lastLanding=hit.id;
          state.bestCombo=Math.max(state.bestCombo,state.combo);
        } else state.combo=0;
        state.event='land';
        if(hit.type==='fragile')hit.breakAt=state.tick+23;
        if(hit.type==='spring'){
          state.vy=23;
          state.grounded=false;
          state.groundId=null;
          state.event='spring';
        }
      }
    }
  }
  state.bestY=Math.max(state.bestY,state.y);
  state.cameraY=Math.max(state.cameraY,state.y-240);
  ensurePlatforms(state);

  for(const platform of state.platforms){
    if(platform.star&&!platform.taken&&Math.abs(state.x-platformX(platform,state.tick))<28 &&
       Math.abs(state.y-(platform.y+44))<29){
      platform.taken=true;
      state.stars++;
      state.event='star';
    }
    if(hitDrone(state,platform)){
      state.hearts--;
      state.invulnerable=32;
      state.vy=Math.max(10,state.vy);
      state.grounded=false;
      state.groundId=null;
      state.event='hit';
      if(state.hearts<=0){state.over=true;state.reason='에너지가 모두 소진됐습니다.';}
      break;
    }
  }
  if(state.y<state.cameraY-90 || state.y< -50){
    state.over=true;
    state.reason='발판 아래로 떨어졌습니다.';
  }
  if(state.tick>=MAX_TICKS[state.mode]){
    state.over=true;
    state.reason=state.mode==='daily'?'오늘의 60초 도전 완료!':'5분 기록 도전 완료!';
  }
  return true;
}
export function packJumpInputs(inputs){
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_TICKS.classic)
    throw new Error('입력 기록 길이가 올바르지 않습니다.');
  const output=new Uint8Array(Math.ceil(inputs.length*3/8));
  for(let i=0;i<inputs.length;i++){
    const value=inputs[i];
    if(!Number.isInteger(value)||value<0||value>7)throw new Error('입력 기록 값이 잘못되었습니다.');
    const bit=i*3,offset=bit>>3,shift=bit&7;
    output[offset]|=(value<<shift)&255;
    if(shift>5)output[offset+1]|=value>>(8-shift);
  }
  let binary='';
  for(let i=0;i<output.length;i++)binary+=String.fromCharCode(output[i]);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function decodeInputs(trace,ticks){
  if(typeof trace!=='string'||!Number.isSafeInteger(ticks)||ticks<1||
     ticks>MAX_TICKS.classic || !/^[A-Za-z0-9_-]+$/.test(trace))return null;
  const need=Math.ceil(ticks*3/8);
  if(trace.length!==Math.ceil(need/3)*4-(need%3?(3-need%3):0))return null;
  let binary;
  try{binary=atob(trace.replace(/-/g,'+').replace(/_/g,'/'));}catch{return null;}
  if(binary.length!==need)return null;
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const unused=need*8-ticks*3;
  if(unused>0 && (bytes[need-1]>>(8-unused))!==0)return null;
  return bytes;
}
export function replayJumpGame(seed,mode,trace,ticks){
  if(!Object.hasOwn(MAX_TICKS,mode)||ticks>MAX_TICKS[mode])return null;
  const bytes=decodeInputs(trace,ticks);
  if(!bytes)return null;
  const state=createJumpGame(seed,mode);
  for(let i=0;i<ticks;i++){
    if(state.over)return null;
    const bit=i*3,offset=bit>>3,shift=bit&7;
    const mask=((bytes[offset]|((bytes[offset+1]||0)<<8))>>shift)&7;
    stepJumpGame(state,mask);
  }
  return state;
}
