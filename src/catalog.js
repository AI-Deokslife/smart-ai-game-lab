// 공개 게임 목록과 관리자 게임 메타데이터 CRUD.
// 게임 파일은 GitHub의 public/games/<id>/ 에 배포해야 플레이할 수 있습니다.
import { GAMES } from './validation.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(message,status=400)=>json({error:message},status);
export const THEMES=['tower','rush','merge','neon','puzzle'];
const idOk=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{1,30}$/.test(v)&&!v.endsWith('-');
const txt=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;
export function normalizeGame(input,idOverride=null) {
  if(!input || typeof input!=='object')return {error:'게임 정보가 올바르지 않습니다.'};
  const id=idOverride||input.id;
  if(!idOk(id))return {error:'게임 ID는 영문 소문자로 시작하는 2~31자(영문·숫자·-)만 사용할 수 있습니다.'};
  const title=txt(input.title,40),subtitle=txt(input.subtitle,120);
  if(!title||!subtitle)return {error:'게임 제목(40자 이하)과 설명(120자 이하)을 입력하세요.'};
  const visual=THEMES.includes(input.visual)?input.visual:'neon';
  if(typeof input.enabled!=='boolean')return {error:'공개 여부를 확인하세요.'};
  const sort_order=input.sort_order;
  if(!Number.isInteger(sort_order)||sort_order<0||sort_order>9999)return {error:'정렬 순서는 0~9999 사이 정수여야 합니다.'};
  return {id,title,subtitle,path:'/games/'+id+'/',visual,enabled:input.enabled?1:0,sort_order};
}
export const publicGame = row => ({
  id:row.id,title:row.title,subtitle:row.subtitle,path:row.path,visual:row.visual,
  supportsRanking:GAMES.some(g=>g.id===row.id&&g.live)
});
export async function visibleGame(db,id){
  const game=await db.prepare('SELECT id FROM game_catalog WHERE id=? AND enabled=1').bind(id).first();
  return !!game;
}
export async function listedGames(db,all=false){
  const statement=all?
    'SELECT id,title,subtitle,path,visual,enabled,sort_order FROM game_catalog ORDER BY sort_order,id':
    'SELECT id,title,subtitle,path,visual,enabled,sort_order FROM game_catalog WHERE enabled=1 ORDER BY sort_order,id';
  const result=await db.prepare(statement).all();
  return result.results||[];
}
export async function catalogRoute(req,env,path,parseBody){
  if(path==='/api/games'&&req.method==='GET'){
    return json({games:(await listedGames(env.DB)).map(publicGame)});
  }
  if(path==='/api/admin/games'&&req.method==='GET'){
    const items=await listedGames(env.DB,true);
    return json({games:items.map(row=>({...publicGame(row),enabled:!!row.enabled,sort_order:row.sort_order}))});
  }
  if(path==='/api/admin/games'&&req.method==='POST'){
    const item=normalizeGame(await parseBody(req));
    if(item.error)return err(item.error);
    const found=await env.DB.prepare('SELECT 1 AS existing FROM game_catalog WHERE id=?').bind(item.id).first();
    if(found)return err('이미 사용 중인 게임 ID입니다.',409);
    await env.DB.prepare('INSERT INTO game_catalog(id,title,subtitle,path,visual,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(item.id,item.title,item.subtitle,item.path,item.visual,item.enabled,item.sort_order,new Date().toISOString(),new Date().toISOString()).run();
    return json({ok:true,game:publicGame(item)},201);
  }
  const match=path.match(/^\/api\/admin\/games\/([a-z0-9-]+)$/);
  if(match&&req.method==='PATCH'){
    const item=normalizeGame(await parseBody(req),match[1]);
    if(item.error)return err(item.error);
    const updated=await env.DB.prepare('UPDATE game_catalog SET title=?,subtitle=?,visual=?,enabled=?,sort_order=?,updated_at=? WHERE id=?')
      .bind(item.title,item.subtitle,item.visual,item.enabled,item.sort_order,new Date().toISOString(),item.id).run();
    if(!updated.meta?.changes)return err('게임을 찾을 수 없습니다.',404);
    return json({ok:true,game:publicGame(item)});
  }
  return null;
}
