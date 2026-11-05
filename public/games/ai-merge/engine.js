/**
 * AI 몬스터 합체 공통 퍼즐 규칙.
 * 브라우저와 Cloudflare Worker가 같은 파일을 불러서 입력 기록을 재현하고 검증합니다.
 * 외부 라이브러리·네트워크 의존성이 없습니다.
 */
export const COLS = 5;
export const ROWS = 7;
export const MAX_TIER = 9;
export const MAX_TURNS = { classic: 160, daily: 35 };

function hashSeed(value) {
  let h=2166136261;
  for(const char of String(value)){
    h ^= char.charCodeAt(0);
    h=Math.imul(h,16777619)>>>0;
  }
  return h||0x9e3779b9;
}
function random(state) {
  let x=state.rng|0;
  x^=x<<13;x^=x>>>17;x^=x<<5;
  state.rng=x>>>0;
  return state.rng/4294967296;
}
function nextTier(state) {
  return random(state)<.81?1:2;
}
export function createMergeGame(seed,mode='classic') {
  if(!Object.hasOwn(MAX_TURNS,mode))throw new Error('올바르지 않은 게임 모드입니다.');
  const state={
    grid:Array.from({length:ROWS},()=>Array(COLS).fill(0)),
    rng:hashSeed(seed),mode,moves:[],next:1,score:0,
    merges:0,maxCombo:0,maxTier:1,over:false,
    last:{column:null,chains:[],gained:0,combo:0}
  };
  state.next=nextTier(state);
  return state;
}
function compact(grid) {
  for(let x=0;x<COLS;x++){
    let write=ROWS-1;
    for(let y=ROWS-1;y>=0;y--){
      const tier=grid[y][x];
      if(tier)grid[write--][x]=tier;
    }
    for(let y=write;y>=0;y--)grid[y][x]=0;
  }
}
function firstPair(grid) {
  // 아래에서 위로, 왼쪽에서 오른쪽 순서로 합체하여 재현 결과를 고정합니다.
  for(let y=ROWS-1;y>=0;y--){
    for(let x=0;x<COLS;x++){
      const tier=grid[y][x];
      if(!tier||tier>=MAX_TIER)continue;
      // 오른쪽 이웃 또는 바로 아래 이웃이 같으면 합체합니다.
      if(x+1<COLS&&grid[y][x+1]===tier)return {a:[y,x],b:[y,x+1],tier};
      if(y+1<ROWS&&grid[y+1][x]===tier)return {a:[y,x],b:[y+1,x],tier};
    }
  }
  return null;
}
export function dropMergeRobot(state,column) {
  if(state.over||!Number.isInteger(column)||column<0||column>=COLS)return {ok:false,error:'선택한 열에 로봇을 놓을 수 없습니다.'};
  let target=-1;
  for(let y=ROWS-1;y>=0;y--){
    if(state.grid[y][column]===0){target=y;break;}
  }
  if(target<0)return {ok:false,error:'이 열은 가득 찼습니다. 다른 열을 선택하세요.'};
  const startScore=state.score;
  state.grid[target][column]=state.next;
  state.next=nextTier(state);
  state.moves.push(column);
  const chains=[];
  for(let i=0;i<ROWS*COLS*5;i++){
    const pair=firstPair(state.grid);
    if(!pair)break;
    const [ay,ax]=pair.a, [by,bx]=pair.b;
    const next=pair.tier+1;
    state.grid[ay][ax]=next;
    state.grid[by][bx]=0;
    compact(state.grid);
    const points=100*2**(next-2);
    state.score+=points;
    state.merges++;
    state.maxTier=Math.max(state.maxTier,next);
    chains.push({tier:next,points});
  }
  state.maxCombo=Math.max(state.maxCombo,chains.length);
  state.over=state.moves.length>=MAX_TURNS[state.mode]||
    state.grid[0].every(tier=>tier!==0);
  state.last={column,chains,gained:state.score-startScore,combo:chains.length};
  return {ok:true,last:state.last,over:state.over};
}
export function replayMergeGame(seed,mode,moves){
  if(!Array.isArray(moves)||moves.length<1||moves.length>MAX_TURNS[mode])return null;
  const state=createMergeGame(seed,mode);
  for(const col of moves){
    if(!Number.isInteger(col)||!dropMergeRobot(state,col).ok)return null;
  }
  return state;
}
export function mergeScoreSummary(state){
  return {score:state.score,floors:state.moves.length,perfects:state.merges,combo:state.maxCombo};
}
