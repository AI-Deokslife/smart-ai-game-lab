import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const base=new URL('../public/',import.meta.url);
const html=readFileSync(new URL('index.html',base),'utf8');
const pixel=readFileSync(new URL('pixel-portal.css',base),'utf8');
const city=readFileSync(new URL('portal-city.svg',base),'utf8');
const app=readFileSync(new URL('app.js',base),'utf8');

test('도트풍 포털 타이틀 화면은 게임 연구소 그림과 3개 메뉴 버튼이 동작하는 링크이다',()=>{
  assert.match(html,/href="\/pixel-portal\.css"/);
  assert.match(pixel,/url\('\/portal-city\.svg'\)/);
  assert.match(city,/<svg[\s\S]*SMART AI GAME LAB/);
  assert.match(html,/class="hero-scene"/);
  assert.match(html,/id="portal-title"/);
  assert.match(html,/id="heroPlay"[^>]*href="#games"/);
  assert.match(html,/class="pixel-action rank-action" href="#ranking"/);
  assert.match(html,/class="pixel-action games-action" href="#games"/);
  assert.match(pixel,/\.pixel-portal \.start-action/);
});
test('메인 페이지의 3개 게임 카드와 랭킹, 학교명, 관리자 링크가 살아 있다',()=>{
  for(const id of ['games','gameGrid','ranking','rankingList','rankGame','rankMode','rankPeriod','rankView','rankingNotice','reloadRanking','playerCount','playCount','gameCount','about']){
    const matches=[...html.matchAll(new RegExp('id="'+id+'"','g'))];
    assert.equal(matches.length,1,'필수 ID가 하나만 있어야 합니다: '+id);
  }
  assert.match(html,/href="\/admin\/"/);
  assert.match(html,/은평메디텍고등학교/);
  assert.match(html,/스마트AI과/);
  assert.match(app,/fetch\(url,\{cache:'no-store'\}\)/);
  assert.match(app,/grid\.replaceChildren\(\)/);
  assert.match(app,/rankings\?game=/);
  assert.doesNotMatch(app,/play\.href=games\[0\]\.path/);
});
test('모바일 화면, 키보드 초점, 움직임 감소 설정 및 자체 리소스만 사용한다',()=>{
  assert.match(pixel,/@media\(max-width:690px\)/);
  assert.match(pixel,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(pixel,/:focus-visible/);
  assert.match(html,/class="skip-link"/);
  assert.doesNotMatch(html,/<script[^>]*src="https?:/);
  assert.doesNotMatch(html,/<link[^>]*href="https?:/);
  assert.doesNotMatch(pixel,/@import\s+url\(["']?https?:/);
  new Script(app,{filename:'app.js'});
});
