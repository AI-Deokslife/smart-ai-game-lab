/**
 * AI 몬스터 합체 — 결정적인 격자 중력 퍼즐 엔진.
 * 브라우저와 Workers가 똑같이 실행해 결과를 검증합니다.
 * drop → collision → merge → gravity 순서로 기록된 프레임은 화면 애니메이션에만 사용합니다.
 */
export const COLS=5;
export const ROWS=7;
export const MAX_TIER=9;
export const MAX_TURNS={classic:160,daily:35};

function seedHash(value){
  let h=2166136261;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h||0x9e3779b9;
}
function rng(state){
  let x=state.rng|0;
  x^=x<<13;x^=x>>>17;x^=x<<5;
  state.rng=x>>>0;
  return state.rng/4294967296;
}
function tierDraw(state){return rng(state)<.81?1:2;}
const gridCopy=grid=>grid.map(row=>row.slice());
export function createMergeGame(seed,mode='classic'){
  if(!Object.hasOwn(MAX_TURNS,mode))throw new Error('올바르지 않은 게임 모드입니다.');
  const state={
    grid:Array.from({length:ROWS},()=>Array(COLS).fill(0)),
    rng:seedHash(seed),mode,moves:[],next:1,score:0,
    merges:0,maxCombo:0,maxTier:1,over:false,
    last:{column:null,chains:[],gained:0,combo:0,frames:[]}
  };
  state.next=tierDraw(state);
  return state;
}
export function peekNextTier(state){
  const previous=state.rng;
  const result=tierDraw(state);
  state.rng=previous;
  return result;
}
export function landingRow(grid,col){
  if(!Number.isInteger(col)||col<0||col>=COLS)return -1;
  for(let row=ROWS-1;row>=0;row--)if(grid[row][col]===0)return row;
  return -1;
}
function neighborPair(grid,focus){
  if(!focus)return null;
  const {row,col}=focus;
  const tier=grid[row]?.[col];
  if(!tier||tier>=MAX_TIER)return null;
  // 위아래, 좌우가 실제로 붙은 경우만 합체하며 내려 있는 이웃부터 확인합니다.
  for(const [dr,dc] of [[1,0],[0,-1],[0,1],[-1,0]]){
    const ry=row+dr,cx=col+dc;
    if(ry>=0&&ry<ROWS&&cx>=0&&cx<COLS&&grid[ry][cx]===tier)
      return {a:{row,col},b:{row:ry,col:cx},tier};
  }
  return null;
}
function firstPair(grid,focus){
  const adjacent=neighborPair(grid,focus);
  if(adjacent)return adjacent;
  // 이전 낙하로 밀려 붙은 쌍이 있으면 아래쪽부터 자연스럽게 합체합니다.
  for(let row=ROWS-1;row>=0;row--){
    for(let col=0;col<COLS;col++){
      const tier=grid[row][col];
      if(!tier||tier>=MAX_TIER)continue;
      if(col+1<COLS&&grid[row][col+1]===tier)
        return {a:{row,col},b:{row,col:col+1},tier};
      if(row+1<ROWS&&grid[row+1][col]===tier)
        return {a:{row,col},b:{row:row+1,col},tier};
    }
  }
  return null;
}
function compact(grid,focus){
  const movements=[];
  let nextFocus=focus?{...focus}:null;
  for(let col=0;col<COLS;col++){
    let write=ROWS-1;
    for(let row=ROWS-1;row>=0;row--){
      const tier=grid[row][col];
      if(tier){
        if(write!==row)movements.push({from:{row,col},to:{row:write,col},tier});
        if(nextFocus&&nextFocus.row===row&&nextFocus.col===col)nextFocus.row=write;
        grid[write--][col]=tier;
      }
    }
    for(let row=write;row>=0;row--)grid[row][col]=0;
  }
  return {movements,focus:nextFocus};
}
/**
 * trace=false는 서버 재현용입니다.
 * 반환된 last.frames는 낙하/합체/중력의 순서와 각 단계의 최종 격자 상태입니다.
 */
export function dropMergeRobot(state,column,trace=true){
  if(state.over||!Number.isInteger(column)||column<0||column>=COLS)
    return {ok:false,error:'선택한 열에 로봇을 놓을 수 없습니다.'};
  const target=landingRow(state.grid,column);
  if(target<0)return {ok:false,error:'이 열은 가득 찼습니다. 다른 열을 선택하세요.'};
  const initialScore=state.score,tier=state.next;
  const frames=[];
  const push=(type,detail)=>{if(trace)frames.push({type,...detail,grid:gridCopy(state.grid)});};
  state.grid[target][column]=tier;
  state.next=tierDraw(state);
  state.moves.push(column);
  push('drop',{column,row:target,tier,from:{row:-1,col:column},to:{row:target,col:column}});
  let focus={row:target,col:column};
  const chains=[];
  for(let count=0;count<ROWS*COLS*5;count++){
    const pair=firstPair(state.grid,focus);
    if(!pair)break;
    const newTier=pair.tier+1;
    state.grid[pair.a.row][pair.a.col]=newTier;
    state.grid[pair.b.row][pair.b.col]=0;
    const points=100*2**(newTier-2); // 이전 랭킹과 점수 공식 호환
    state.score+=points;
    state.merges++;
    state.maxTier=Math.max(state.maxTier,newTier);
    chains.push({tier:newTier,points,from:pair.b,to:pair.a});
    push('merge',{from:pair.b,to:pair.a,oldTier:pair.tier,newTier,points,chain:chains.length});
    const settled=compact(state.grid,pair.a);
    focus=settled.focus;
    if(settled.movements.length)
      push('gravity',{movements:settled.movements});
  }
  state.maxCombo=Math.max(state.maxCombo,chains.length);
  state.over=state.moves.length>=MAX_TURNS[state.mode]||
    state.grid[0].every(tier=>tier!==0);
  state.last={column,row:target,tier,chains,gained:state.score-initialScore,combo:chains.length,frames};
  return {ok:true,last:state.last,over:state.over};
}
export function replayMergeGame(seed,mode,moves){
  if(!Object.hasOwn(MAX_TURNS,mode)||!Array.isArray(moves)||moves.length<1||moves.length>MAX_TURNS[mode])return null;
  const state=createMergeGame(seed,mode);
  for(const column of moves)
    if(!Number.isInteger(column)||!dropMergeRobot(state,column,false).ok)return null;
  return state;
}
export function mergeScoreSummary(state){
  return {score:state.score,floors:state.moves.length,perfects:state.merges,combo:state.maxCombo};
}
