// 공개 게임 카드·랭킹은 D1 게임 카탈로그에서 불러옵니다.
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('ko-KR');
let games=[];
async function json(url) {
  const res=await fetch(url,{cache:'no-store'});
  const data=await res.json();
  if(!res.ok)throw new Error(data.error||'서버 연결 오류');
  return data;
}
const el=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
};
function drawCard(g,index){
  const card=el('article','game-card live');
  const art=el('div','game-art '+(['tower','rush','merge'].includes(g.visual)?g.visual+'-art':'neon-art'));
  const label=el('span','art-bubble',g.supportsRanking?'NEW · 플레이 가능':'플레이 가능');
  art.append(label);
  if(g.visual==='tower'){
    const stack=el('div','art-stack');
    for(let i=0;i<5;i++)stack.append(el('i'));
    art.append(stack,el('span','art-stars','✦ ✦ ✦'));
  } else if(g.visual==='rush'){
    const stairs=el('div','rush-steps');
    for(let i=0;i<4;i++)stairs.append(el('i'));
    art.append(stairs,el('span','rush-runner','⚡'));
  } else if(g.visual==='merge'){
    const bots=el('div','merge-bots');
    for(const symbol of ['●','✚','◆'])bots.append(el('span','',symbol));
    art.append(bots);
  } else art.append(el('div','visual-mark',g.visual==='puzzle'?'◈':'✦'));
  const meta=el('div','game-meta');
  meta.append(el('span','game-number','GAME '+String(index+1).padStart(2,'0')),el('h3','',g.title),el('p','',g.subtitle));
  const tags=el('div','tags');
  for(const tag of (g.supportsRanking?['모바일','온라인 랭킹']:['신규 작품','바로 실행']))tags.append(el('span','',tag));
  if(g.id==='ai-rush')tags.append(el('span','','A · D'));
  meta.append(tags);
  const link=el('a','game-go','플레이하기 ↗');link.href=g.path;meta.append(link);
  card.append(art,meta);
  return card;
}
async function loadGames(){
  const grid=$('gameGrid');
  try{
    games=(await json('/api/games')).games;
    grid.replaceChildren();
    games.forEach((game,i)=>grid.append(drawCard(game,i)));
    if(!games.length)grid.append(el('p','empty-rank','현재 공개된 게임이 없습니다.'));
    const play=$('heroPlay');
    if(games.length){play.href=games[0].path;play.textContent=games[0].title+' 시작 ↗';}
    else{play.href='#games';play.textContent='게임 둘러보기 ↗';}
    const current=$('rankGame').value,select=$('rankGame');select.replaceChildren();
    for(const game of games.filter(x=>x.supportsRanking)){
      const option=el('option','',game.title);option.value=game.id;select.append(option);
    }
    if([...select.options].some(x=>x.value===current))select.value=current;
    if(!select.options.length){select.append(el('option','','랭킹 준비 중'));select.disabled=true;}
    else select.disabled=false;
    $('gameCount').textContent=fmt(games.length);
    loadRanking();
  }catch(e){grid.replaceChildren();grid.append(el('p','empty-rank','게임 목록을 불러오지 못했습니다. 잠시 후 새로고침해주세요.'));}
}
async function loadStats(){
  try{
    const stats=await json('/api/stats');
    $('playerCount').textContent=fmt(stats.players);
    $('playCount').textContent=fmt(stats.plays);
    $('gameCount').textContent=fmt(stats.games);
  }catch{$('playerCount').textContent='—';$('playCount').textContent='—';}
}
async function loadRanking(){
  const list=$('rankingList'),game=$('rankGame').value,mode=$('rankMode').value,period=$('rankPeriod').value;
  list.replaceChildren();
  const wait=el('li','empty-rank','온라인 순위를 불러오는 중입니다.');list.append(wait);
  const selected=games.find(x=>x.id===game);
  $('rankTitle').textContent=selected?selected.title+' 랭킹':'게임별 랭킹';
  if(!game||!selected){list.replaceChildren();list.append(el('li','empty-rank','랭킹이 제공되는 게임이 없습니다.'));return;}
  try{
    const data=await json('/api/rankings?game='+encodeURIComponent(game)+'&mode='+encodeURIComponent(mode)+'&period='+encodeURIComponent(period));
    list.replaceChildren();
    if(!data.rankings.length){list.append(el('li','empty-rank','아직 기록이 없습니다. 첫 번째 주인공이 되어 보세요!'));return;}
    for(const item of data.rankings){
      const li=el('li',''),rank=el('span','rank-number',item.rank),name=el('span','rank-name',item.nickname);
      const score=el('span','rank-score',fmt(item.score)+'점');
      const steps=el('small','',item.floors+(game==='ai-rush'?'계단':'층'));
      score.append(steps);li.append(rank,name,score);list.append(li);
    }
    $('rankingNotice').textContent='온라인 TOP '+data.rankings.length+' · 플레이어별 최고 점수';
  }catch{
    list.replaceChildren();list.append(el('li','empty-rank','온라인 랭킹을 불러올 수 없습니다.'));
    $('rankingNotice').textContent='온라인 연결 대기 중';
  }
}
for(const id of ['rankGame','rankMode','rankPeriod'])$(id).addEventListener('change',loadRanking);
$('reloadRanking').addEventListener('click',loadRanking);
loadGames();loadStats();
