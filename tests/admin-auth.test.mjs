import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

test('암호화 반복 횟수는 Cloudflare Workers PBKDF2 최대 10만 회를 초과하지 않는다',()=>{
  const source=readFileSync(new URL('../src/admin-auth.js',import.meta.url),'utf8');
  const rounds=Number(source.match(/const ROUNDS = (\d+);/)?.[1]);
  assert.ok(Number.isSafeInteger(rounds) && rounds >= 10000 && rounds <= 100000);
});

function envFixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const filename of ['0001_init.sql','0002_admin_login.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'));
  const db = {
    raw:sqlite,
    prepare(sql){
      let params=[];
      return {
        bind(...values){params=values;return this;},
        async first(){return sqlite.prepare(sql).get(...params)||null;},
        async all(){return {results:sqlite.prepare(sql).all(...params)};},
        async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:r.changes}};}
      };
    }
  };
  return {DB:db,ADMIN_KEY:'short-key-123'};
}
function req(path,method='GET',body=null,cookie=''){
  return new Request('https://example.test'+path,{
    method,
    headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'||method==='DELETE'?{'X-Requested-With':'SmartAILabAdmin','Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}
async function send(env,path,method='GET',body=null,cookie=''){
  const response=await worker.fetch(req(path,method,body,cookie),env);
  const data=await response.json();
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('관리자 최초 설정, 비밀번호 변경, 로그아웃 및 쿠키 세션',async()=>{
  const env=envFixture();
  assert.deepEqual((await send(env,'/api/admin/auth/status')).data,{configured:false,loggedIn:false});
  assert.equal((await send(env,'/api/admin/auth/setup','POST',{setupKey:'wrong',password:'SmartAI2026'})).status,403);
  assert.equal((await send(env,'/api/admin/auth/setup','POST',{setupKey:env.ADMIN_KEY,password:'short'})).status,400);
  const setup=await send(env,'/api/admin/auth/setup','POST',{setupKey:env.ADMIN_KEY,password:'SmartAI2026'});
  assert.equal(setup.status,200);assert.ok(setup.cookie.startsWith('smart_ai_admin='));
  const firstCookie=setup.cookie;
  assert.equal((await send(env,'/api/admin/auth/status','GET',null,firstCookie)).data.loggedIn,true);
  assert.equal((await send(env,'/api/admin/summary','GET',null,firstCookie)).status,200);
  assert.equal((await send(env,'/api/admin/summary')).status,401);
  assert.equal((await send(env,'/api/admin/auth/setup','POST',{setupKey:env.ADMIN_KEY,password:'Another2026'})).status,409);
  const badChange=await send(env,'/api/admin/auth/change-password','POST',{currentPassword:'bad',newPassword:'Another2026'},firstCookie);
  assert.equal(badChange.status,403);
  const change=await send(env,'/api/admin/auth/change-password','POST',{currentPassword:'SmartAI2026',newPassword:'Another2026'},firstCookie);
  assert.equal(change.status,200);
  assert.equal((await send(env,'/api/admin/summary','GET',null,firstCookie)).status,401);
  const nextCookie=change.cookie;
  assert.equal((await send(env,'/api/admin/summary','GET',null,nextCookie)).status,200);
  assert.equal((await send(env,'/api/admin/auth/login','POST',{password:'SmartAI2026'})).status,403);
  const logout=await send(env,'/api/admin/auth/logout','POST',null,nextCookie);
  assert.equal(logout.status,200);
  assert.equal((await send(env,'/api/admin/summary','GET',null,nextCookie)).status,401);
  const login=await send(env,'/api/admin/auth/login','POST',{password:'Another2026'});
  assert.equal(login.status,200);
  assert.equal((await send(env,'/api/admin/summary','GET',null,login.cookie)).status,200);
});
test('관리자 로그인 5회 실패 후 일시 차단',async()=>{
  const env=envFixture();
  await send(env,'/api/admin/auth/setup','POST',{setupKey:env.ADMIN_KEY,password:'SmartAI2026'});
  for(let i=0;i<5;i++){
    const r=await send(env,'/api/admin/auth/login','POST',{password:'wrongpass'+i});
    assert.equal(r.status,403);
  }
  assert.equal((await send(env,'/api/admin/auth/login','POST',{password:'SmartAI2026'})).status,429);
});
test('다른 출처의 관리자 변경 요청 차단',async()=>{
  const env=envFixture();
  const response=await worker.fetch(new Request('https://example.test/api/admin/auth/setup',{method:'POST',headers:{Origin:'https://attacker.test','X-Requested-With':'SmartAILabAdmin','Content-Type':'application/json'},body:JSON.stringify({setupKey:env.ADMIN_KEY,password:'SmartAI2026'})}),env);
  assert.equal(response.status,403);
});
