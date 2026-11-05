import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script, createContext} from 'node:vm';

const html=readFileSync(new URL('../public/games/ai-rush/index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(source=>source.trim().length>0);

test('AI 러시 아케이드 화면에는 세로 계단·로봇·좌우 조작 버튼이 포함된다',()=>{
  assert.match(html,/<canvas id="scene"/);
  assert.match(html,/class="stage"/);
  assert.match(html,/id="leftBtn"/);
  assert.match(html,/id="rightBtn"/);
  assert.match(html,/function prism\(/);
  assert.match(html,/function robot\(/);
  assert.match(html,/stairX=\[0\]/);
  assert.match(html,/for\(const dir of goal\)stairX\.push/);
  assert.match(html,/const worldX=/);
  assert.match(html,/const dir=action==='turn'\?-heading:heading/);
  assert.match(html,/queuedAction=action/);
  assert.match(html,/aria-label="방향 전환 A"/);
  assert.match(html,/aria-label="오르기 D"/);
  assert.match(html,/43\.9svh/);
});
test('AI 러시 기존 온라인 랭킹·점수 저장·모드·PC 키 입력 유지',()=>{
  assert.match(html,/SmartAILab\.begin\('ai-rush',mode,nickname\)/);
  assert.match(html,/SmartAILab\.finish\(\{score,floors:steps,perfects,combo:bestCombo\}/);
  assert.match(html,/SmartAILab\.ranking\('ai-rush',mode/);
  assert.match(html,/score=steps\*100\+perfects\*25/);
  assert.match(html,/value="classic"/);
  assert.match(html,/value="daily"/);
  assert.match(html,/key==='a'/);
  assert.match(html,/key==='d'/);
  assert.match(html,/act\('turn'\)/);
  assert.match(html,/act\('climb'\)/);
});
test('오르기 버튼은 방향 유지, 방향 전환은 반대로 회전하면서 한 계단 이동',()=>{
  const fn=scripts[0].match(/function act\(action\)\{[\s\S]*?\n\}(?=\nasync function finish)/)?.[0];
  assert.ok(fn,'게임 입력 처리 함수가 존재해야 합니다');
  const sandbox=createContext({
    state:'playing',anim:0,queuedAction:'',heading:1,goal:[1,-1,-1,1],
    steps:0,stepLeft:3200,perfects:0,combo:0,bestCombo:0,score:0,
    previousDirection:1,lastDirection:1,flash:'',flashTime:0,finishOnce:false,
    beep(){},hud(){},navigator:{vibrate(){}},stepDuration(){return 3500;},
    finish(reason){sandbox.lastError=reason;}
  });
  new Script(fn).runInContext(sandbox);
  sandbox.act('climb');assert.equal(sandbox.steps,1);assert.equal(sandbox.heading,1);
  sandbox.anim=0;sandbox.act('turn');assert.equal(sandbox.steps,2);assert.equal(sandbox.heading,-1);
  sandbox.anim=0;sandbox.act('climb');assert.equal(sandbox.steps,3);assert.equal(sandbox.heading,-1);
  sandbox.anim=0;sandbox.act('climb');assert.equal(sandbox.steps,3);assert.match(sandbox.lastError,/계단/);
});
test('로봇은 좌우 이동 방향에 따라 실제로 다른 쪽을 바라본다',()=>{
  const snippet=scripts[0].match(/function robot\(x,y,angle,facing=1\)\{[\s\S]*?\n\}(?=\nfunction draw)/)?.[0];
  assert.ok(snippet,'방향 인수가 있는 로봇 그리기 함수를 찾지 못했습니다');
  assert.match(scripts[0],/robot\(playerX,playerY,[^\n]+,heading\)/);
  assert.match(snippet,/ctx\.scale\(facing<0\?-1:1,1\)/);
  const scales=[];
  const drawingContext=new Proxy({}, {
    get(_target,key){
      if(key==='scale')return (...args)=>scales.push(args);
      return ()=>{};
    },
    set(){return true;}
  });
  const sandbox=createContext({ctx:drawingContext,Math});
  new Script(snippet).runInContext(sandbox);
  sandbox.robot(100,200,0,1);
  sandbox.robot(100,200,0,-1);
  assert.deepEqual(Array.from(scales[0]),[1,1]);
  assert.deepEqual(Array.from(scales[1]),[-1,1]);
  // 한쪽만 보이는 눈과 앞으로 튀어나온 얼굴을 그려 단순한 대칭 반전에 그치지 않아야 합니다.
  assert.match(snippet,/roundRect\(18,-88,21,24,6\)/);
  assert.match(snippet,/roundRect\(10,-87,11,14,4\)/);
});

test('AI 러시 인라인 게임 스크립트 문법과 외부 리소스 의존성 검사',()=>{
  assert.equal(scripts.length,1);
  for(const source of scripts)new Script(source,{filename:'ai-rush/index.html'});
  assert.doesNotMatch(html,/(?:<script[^>]*src=["']https?:|<link[^>]*href=["']https?:)/i);
});
