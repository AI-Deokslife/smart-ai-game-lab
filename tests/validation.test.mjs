import test from 'node:test';
import assert from 'node:assert/strict';
import { validName, validateTowerResult, maxTowerScore, kstToday, kstStartUtc } from '../src/validation.js';

test('한국어 닉네임 등록 및 위험 문자 차단', () => {
  assert.equal(validName('  게임왕  '), '게임왕');
  assert.equal(validName('<script>'), null);
  assert.equal(validName('관리자'), null);
  assert.equal(validName('a'.repeat(13)), null);
});
test('정상적인 게임 기록 허용', () => {
  assert.equal(validateTowerResult({ score: 304, floors: 2, perfects: 1, combo: 1 }).ok, true);
  assert.equal(validateTowerResult({ score: 0, floors: 0, perfects: 0, combo: 0 }).ok, true);
});
test('불가능한 점수 및 속성 거부', () => {
  assert.equal(validateTowerResult({ score: 1000000, floors: 1, perfects: 1, combo: 1 }).ok, false);
  assert.equal(validateTowerResult({ score: 10, floors: 1, perfects: 2, combo: 1 }).ok, false);
  assert.equal(validateTowerResult({ score: 10.5, floors: 1, perfects: 0, combo: 0 }).ok, false);
  assert.equal(maxTowerScore(1), 177);
});
test('KST 날짜 기준 검증', () => {
  assert.equal(kstToday(Date.parse('2026-11-03T15:01:00Z')), '2026-11-04');
  assert.equal(kstStartUtc(Date.parse('2026-11-03T15:01:00Z')), '2026-11-03T15:00:00.000Z');
});
