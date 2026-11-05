import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../public/games/ai-rush/index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

test('AI 러시 아케이드 화면에는 세로 계단·로봇·좌우 조작 버튼이 포함된다',()=>{
  assert.match(html,/<canvas id="scene"/);
  assert.match(html,/class="stage"/);
  assert.match(html,/id="leftBtn"/);
  assert.match(html,/id="rightBtn"/);
  assert.match(html,/function prism\(/);
  assert.match(html,/function robot\(/);
  assert.match(html,/const prevX=/);
  assert.match(html,/const x=prevX\+\(nextX-prevX\)\*p/);
  assert.match(html,/queuedDir=dir/);
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
});
test('AI 러시 인라인 게임 스크립트 문법과 외부 리소스 의존성 검사',()=>{
  assert.equal(scripts.length,1);
  for(const source of scripts)new Script(source,{filename:'ai-rush/index.html'});
  assert.doesNotMatch(html,/(?:<script[^>]*src=["']https?:|<link[^>]*href=["']https?:)/i);
});
