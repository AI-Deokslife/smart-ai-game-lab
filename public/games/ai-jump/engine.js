/**
 * AI 네온 점프 시즌 2 — 네온 시티 횡스크롤 플랫폼 게임.
 * 25fps 결정적 엔진: 브라우저와 Cloudflare Worker가 동일한 조작을 재생합니다.
 * 입력 비트: 1 LEFT, 2 RIGHT, 4 JUMP.
 */
export const WIDTH=640, HEIGHT=440, FPS=25, FRAME_MS=40;
export const BASE_Y=92, PLATFORM_GAP=180, MAX_TICKS={classic:7500,daily:1500};
export const PLAYER_RADIUS=14;
const SPEED=6.1,GRAVITY=.76,JUMP_V=16.3,MAX_PLATFORMS=350;
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
function seedHash(str){
  let h=2166136261;
  for(const char of String(str)){h^=char.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h||0x7a6ab9f1;
}
function random(state){
  let x=state.rng|0;
  x^=x<<13;x^=x>>>17;x^=x<<5;
  state.rng=x>>>0;
  return state.rng/4294967296;
}
function platformGenerate(state,id){
  const last=state.platforms.at(-1);
  const width=122+Math.floor(random(state)*90);
  const gap=42+Math.floor(random(state)*57);
  const slope=(random(state)-.5)*94;
  const y=clamp(last.y+slope,86,223);
  const x=last.x+last.w/2+gap+width/2;
  const chance=random(state);
  const type=id<3||id%7===0?'solid':id%11===0?'spring':
    chance<.14?'moving':chance<.29?'fragile':'solid';
  const star=random(state)<.71;
  const drone=id>3&&id%6===0;
  return {id,x,y,w:width,type,star,drone,taken:false,active:true,breakAt:null};
}
function ensurePlatforms(state){
  const ahead=state.x+WIDTH*1.6;
  while(state.platforms.at(-1).x<ahead && state.platforms.length<MAX_PLATFORMS){
    state.platforms.push(platformGenerate(state,state.platforms.length));
  }
}
export function platformX(platform,tick){
  return platform.type==='moving'?platform.x+Math.sin(tick*.07+platform.id*.73)*24:platform.x;
}
export function jumpSummary(state){
  const floors=Math.max(0,Math.floor((state.bestX-84)/PLATFORM_GAP));
  return {score:floors*100+state.stars*75+state.bestCombo*25,
    floors,perfects:state.stars,combo:state.bestCombo};
}
export function createJumpGame(seed,mode='classic'){
  if(!Object.hasOwn(MAX_TICKS,mode))throw new Error('지원하지 않는 게임 모드입니다.');
  const state={
    mode,rng:seedHash(seed),tick:0,x:84,y:BASE_Y,vy:0,
    grounded:true,groundId:0,facing:1,previousJump:false,
    coyote:5,jumpBuffer:0,jumpsUsed:0,invulnerable:0,hearts:3,
    platforms:[{id:0,x:150,y:BASE_Y,w:300,type:'solid',star:false,drone:false,
      taken:false,active:true,breakAt:null}],
    stars:0,landings:0,combo:0,bestCombo:0,lastLanding:0,
    bestX:84,bestY:BASE_Y,cameraX:0,cameraY:0,
    checkpoint:{id:0,x:84,y:BASE_Y},over:false,reason:'',event:'',
  };
  ensurePlatforms(state);
  return state;
}
function loseHeart(state,reason){
  if(state.invulnerable>0&&reason!=='fall')return false;
  state.hearts--;
  state.event=reason;
  if(state.hearts<=0){
    state.over=true;
    state.reason=reason==='fall'?'발판 아래로 떨어졌습니다.':'드론과 충돌해 에너지를 모두 잃었습니다.';
    return true;
  }
  state.x=state.checkpoint.x;
  state.y=state.checkpoint.y+2;
  state.vy=0;
  state.grounded=false;
  state.groundId=null;
  state.coyote=3;
  state.jumpsUsed=0;
  state.jumpBuffer=0;
  state.invulnerable=45;
  state.combo=0;
  return false;
}
function droneCollision(state,p){
  if(!p.drone||state.invulnerable>0)return false;
  const dx=p.x+Math.sin(state.tick*.065+p.id)*36;
  const dy=p.y+65;
  return Math.abs(state.x-dx)<23&&Math.abs(state.y+34-dy)<32;
}
export function stepJumpGame(state,inputMask){
  if(state.over)return false;
  if(!Number.isInteger(inputMask)||inputMask<0||inputMask>7)throw new Error('조작 입력이 올바르지 않습니다.');
  state.tick++;
  state.event='';
  const jumping=!!(inputMask&4);
  const direction=(inputMask&2?1:0)-(inputMask&1?1:0);
  if(direction)state.facing=direction;
  if(jumping&&!state.previousJump)state.jumpBuffer=5;
  state.previousJump=jumping;
  if(state.jumpBuffer>0)state.jumpBuffer--;
  if(state.invulnerable>0)state.invulnerable--;
  for(const p of state.platforms){
    if(p.breakAt!==null&&state.tick>=p.breakAt)p.active=false;
  }
  const support=state.platforms[state.groundId];
  if(state.grounded&&support?.type==='moving')
    state.x+=platformX(support,state.tick)-platformX(support,state.tick-1);
  state.x=clamp(state.x+SPEED*direction,PLAYER_RADIUS,MAX_PLATFORMS*300);
  if(state.grounded&&(!support||!support.active||
      Math.abs(state.x-platformX(support,state.tick))>support.w/2+PLAYER_RADIUS*.8)){
    state.grounded=false;state.groundId=null;state.coyote=5;
  }
  if(state.grounded)state.coyote=5;
  else state.coyote=Math.max(0,state.coyote-1);
  if(state.jumpBuffer>0&&(state.grounded||state.coyote>0||state.jumpsUsed<2)){
    const wasGround=state.grounded||state.coyote>0;
    state.vy=wasGround?JUMP_V:JUMP_V*.84;
    state.grounded=false;
    state.groundId=null;
    state.coyote=0;
    state.jumpBuffer=0;
    state.jumpsUsed=wasGround?1:2;
    state.event=wasGround?'jump':'double';
  }
  if(!state.grounded){
    const previousY=state.y;
    state.y+=state.vy;
    state.vy-=GRAVITY;
    if(state.vy<=0){
      let landing=null;
      for(const p of state.platforms){
        if(!p.active||p.y>previousY+.01||p.y<state.y-.01)continue;
        if(Math.abs(state.x-platformX(p,state.tick))>p.w/2+PLAYER_RADIUS*.75)continue;
        if(!landing||p.y>landing.y)landing=p;
      }
      if(landing){
        state.y=landing.y;
        state.vy=0;
        state.grounded=true;
        state.groundId=landing.id;
        state.jumpsUsed=0;
        state.coyote=5;
        state.landings++;
        if(landing.id>state.lastLanding){
          state.combo++;state.lastLanding=landing.id;
          state.bestCombo=Math.max(state.bestCombo,state.combo);
        }else state.combo=0;
        state.event='land';
        if(landing.type==='fragile')landing.breakAt=state.tick+20;
        if(landing.type==='spring'){
          state.vy=21.5;state.grounded=false;state.groundId=null;
          state.jumpsUsed=1;state.event='spring';
        }
        if(landing.id>0 && landing.id%7===0 && landing.id>state.checkpoint.id){
          state.checkpoint={id:landing.id,x:platformX(landing,state.tick),y:landing.y};
          state.event='checkpoint';
        }
      }
    }
  }
  state.bestX=Math.max(state.bestX,state.x);
  state.bestY=Math.max(state.bestY,state.y);
  ensurePlatforms(state);
  for(const p of state.platforms){
    if(p.star&&!p.taken&&Math.abs(state.x-platformX(p,state.tick))<28&&
        Math.abs(state.y-(p.y+45))<29){
      p.taken=true;state.stars++;state.event='star';
    }
    if(droneCollision(state,p)){
      loseHeart(state,'hit');
      break;
    }
  }
  if(state.y<-45||state.y<state.cameraY-130)loseHeart(state,'fall');
  // 카메라는 앞으로 이동할 때만 부드럽게 따라갑니다. 돌아갈 수 있는 체크포인트 위치까지 허용합니다.
  const targetX=Math.max(0,state.x-WIDTH*.35);
  state.cameraX+=(targetX-state.cameraX)*.14;
  const targetY=Math.max(0,state.y-230);
  state.cameraY+=(targetY-state.cameraY)*.12;
  if(state.tick>=MAX_TICKS[state.mode]&&!state.over){
    state.over=true;
    state.reason=state.mode==='daily'?'오늘의 60초 도전 완료!':'5분 자유 도전 완료!';
  }
  return true;
}
export function packJumpInputs(inputs){
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_TICKS.classic)
    throw new Error('입력 기록 길이가 올바르지 않습니다.');
  const output=new Uint8Array(Math.ceil(inputs.length*3/8));
  for(let i=0;i<inputs.length;i++){
    const value=inputs[i];
    if(!Number.isInteger(value)||value<0||value>7)throw new Error('조작 입력 기록이 올바르지 않습니다.');
    const bit=i*3,offset=bit>>3,shift=bit&7;
    output[offset]|=(value<<shift)&255;
    if(shift>5)output[offset+1]|=value>>(8-shift);
  }
  let binary='';
  for(const value of output)binary+=String.fromCharCode(value);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function decodeInputs(trace,ticks){
  if(typeof trace!=='string'||!Number.isSafeInteger(ticks)||ticks<1||
     ticks>MAX_TICKS.classic||!/^[A-Za-z0-9_-]+$/.test(trace))return null;
  const bytesNeeded=Math.ceil(ticks*3/8);
  if(trace.length!==Math.ceil(bytesNeeded/3)*4-(bytesNeeded%3?(3-bytesNeeded%3):0))return null;
  let raw;
  try{raw=atob(trace.replace(/-/g,'+').replace(/_/g,'/'));}catch{return null;}
  if(raw.length!==bytesNeeded)return null;
  const bytes=Uint8Array.from(raw,ch=>ch.charCodeAt(0));
  const unused=bytesNeeded*8-ticks*3;
  if(unused>0&&(bytes[bytes.length-1]>>(8-unused))!==0)return null;
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
