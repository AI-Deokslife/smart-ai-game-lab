// 관리자 인증: 한 번만 Cloudflare ADMIN_KEY로 초기화한 뒤 일반 비밀번호로 로그인합니다.
// 비밀번호: PBKDF2-SHA256 + 개별 salt. 세션: 서버 측 D1 저장 + HttpOnly 쿠키.
const H = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' };
const TTL = 8 * 60 * 60 * 1000;
const BLOCK = 15 * 60 * 1000;
// Cloudflare Workers rejects a single PBKDF2 deriveBits call above 100,000 iterations.
// Keep in sync with tests/admin-auth.test.mjs and the Workers runtime limit.
const ROUNDS = 100000;
const enc = new TextEncoder();
const toHex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2,'0')).join('');
const json = (data, status=200, cookie='') => new Response(JSON.stringify(data), {status,headers:{...H,...(cookie?{'Set-Cookie':cookie}:{})}});
const error = (message, status=400) => json({error:message},status);
const secret = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
const cookieName = 'smart_ai_admin';
const cookie = (token, age=8*60*60) => cookieName+'='+token+'; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
async function sha(text){return toHex(await crypto.subtle.digest('SHA-256',enc.encode(text)));}
function equalHex(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function pbkdf(password,salt){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new Uint8Array(salt.match(/.{2}/g).map(x=>parseInt(x,16))),iterations:ROUNDS,hash:'SHA-256'},key,256));
}
const validPassword = p => typeof p==='string' && p.length>=8 && p.length<=64 && /[A-Za-z]/.test(p) && /[0-9]/.test(p) && !/^\s|\s$/.test(p);
async function readBody(req){
  if(Number(req.headers.get('content-length'))>4096)return null;
  const raw=await req.text();if(raw.length>4096)return null;
  try{return JSON.parse(raw);}catch{return null;}
}
function sameOrigin(req){
  const origin=req.headers.get('origin');
  return (!origin || origin===new URL(req.url).origin) && req.headers.get('x-requested-with')==='SmartAILabAdmin';
}
function tokenFrom(req){
  const value=req.headers.get('cookie')||'';
  const match=value.match(/(?:^|;\s*)smart_ai_admin=([0-9a-f]{64})(?:;|$)/);
  return match?.[1]||null;
}
export async function adminSignedIn(req,env){
  const token=tokenFrom(req);
  if(!token)return false;
  const row=await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').bind(await sha(token)).first();
  return !!row && row.expires_at>Date.now();
}
async function startSession(env){
  const token=secret(),expires=Date.now()+TTL;
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)')
    .bind(await sha(token),Date.now(),expires).run();
  return json({ok:true,expiresInSeconds:TTL/1000},200,cookie(token));
}
async function fingerprint(req,env){
  const ip=req.headers.get('cf-connecting-ip')||'unknown';
  return sha('admin-attempt:'+ip+':'+(env.ADMIN_KEY||'no-key'));
}
async function attemptState(req,env){
  const id=await fingerprint(req,env),row=await env.DB.prepare('SELECT failures,blocked_until,last_failed_at FROM admin_login_attempts WHERE id=?').bind(id).first();
  return {id,row};
}
async function failAttempt(env,state){
  const now=Date.now();
  const previous=state.row && state.row.last_failed_at>now-BLOCK ? state.row.failures : 0;
  const failures=previous+1,blockedUntil=failures>=5?now+BLOCK:0;
  await env.DB.prepare('INSERT INTO admin_login_attempts(id,failures,blocked_until,last_failed_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,last_failed_at=excluded.last_failed_at')
    .bind(state.id,failures,blockedUntil,now).run();
}
async function clearAttempts(env,state){await env.DB.prepare('DELETE FROM admin_login_attempts WHERE id=?').bind(state.id).run();}
export async function adminAuthRoute(req,env,path){
  if(path==='/api/admin/auth/status'&&req.method==='GET'){
    const settings=await env.DB.prepare('SELECT 1 AS configured FROM admin_settings WHERE id=1').first();
    return json({configured:!!settings,loggedIn:!!settings && await adminSignedIn(req,env)});
  }
  if(!['POST'].includes(req.method))return error('지원하지 않는 요청입니다.',405);
  if(!sameOrigin(req))return error('잘못된 요청 출처입니다.',403);
  if(path==='/api/admin/auth/logout'){
    const token=tokenFrom(req);
    if(token)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await sha(token)).run();
    return json({ok:true},200,cookie('',0));
  }
  const input=await readBody(req);
  if(!input||typeof input!=='object')return error('요청 형식이 올바르지 않습니다.');
  if(path==='/api/admin/auth/setup'||path==='/api/admin/auth/login'){
    const configured=await env.DB.prepare('SELECT * FROM admin_settings WHERE id=1').first();
    if(path.endsWith('/setup')&&configured)return error('관리자 비밀번호가 이미 설정되었습니다.',409);
    if(path.endsWith('/login')&&!configured)return error('관리자 비밀번호를 먼저 설정하세요.',409);
    const attempt=await attemptState(req,env);
    if(attempt.row?.blocked_until>Date.now())return error('로그인 시도가 많습니다. 15분 후 다시 시도하세요.',429);
    if(path.endsWith('/setup')){
      const setupKey=input.setupKey;
      if(!env.ADMIN_KEY||typeof setupKey!=='string'||!equalHex(await sha(setupKey),await sha(env.ADMIN_KEY))){
        await failAttempt(env,attempt);return error('초기 설정 확인 키가 일치하지 않습니다.',403);
      }
      if(!validPassword(input.password))return error('비밀번호는 영문과 숫자를 포함한 8~64자로 설정하세요.');
      const salt=toHex(crypto.getRandomValues(new Uint8Array(16))),digest=await pbkdf(input.password,salt);
      const created=await env.DB.prepare('INSERT INTO admin_settings(id,salt,password_hash,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO NOTHING')
        .bind(salt,digest,new Date().toISOString()).run();
      if(created.meta?.changes!==1)return error('이미 관리자가 등록되었습니다.',409);
      await clearAttempts(env,attempt);
      return startSession(env);
    }
    if(typeof input.password!=='string'||input.password.length>512){await failAttempt(env,attempt);return error('관리자 비밀번호가 일치하지 않습니다.',403);}
    const digest=await pbkdf(input.password,configured.salt);
    if(!equalHex(digest,configured.password_hash)){await failAttempt(env,attempt);return error('관리자 비밀번호가 일치하지 않습니다.',403);}
    await clearAttempts(env,attempt);
    return startSession(env);
  }
  if(path==='/api/admin/auth/change-password'){
    if(!(await adminSignedIn(req,env)))return error('관리자 로그인이 필요합니다.',401);
    const settings=await env.DB.prepare('SELECT * FROM admin_settings WHERE id=1').first();
    if(!settings||typeof input.currentPassword!=='string')return error('현재 비밀번호를 확인하세요.');
    const digest=await pbkdf(input.currentPassword,settings.salt);
    if(!equalHex(digest,settings.password_hash))return error('현재 비밀번호가 일치하지 않습니다.',403);
    if(!validPassword(input.newPassword))return error('새 비밀번호는 영문과 숫자를 포함한 8~64자로 설정하세요.');
    if(input.currentPassword===input.newPassword)return error('기존 비밀번호와 다른 비밀번호를 입력하세요.');
    const salt=toHex(crypto.getRandomValues(new Uint8Array(16))),next=await pbkdf(input.newPassword,salt);
    await env.DB.prepare('UPDATE admin_settings SET salt=?,password_hash=?,updated_at=? WHERE id=1')
      .bind(salt,next,new Date().toISOString()).run();
    await env.DB.prepare('DELETE FROM admin_sessions').run();
    return startSession(env);
  }
  return error('API 주소를 찾을 수 없습니다.',404);
}
