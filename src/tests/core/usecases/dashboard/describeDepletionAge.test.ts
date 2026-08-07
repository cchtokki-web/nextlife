import { describe, test, expect } from 'vitest';
import { describeDepletionAge } from '@/core/usecases/dashboard/describeDepletionAge';

// A5: 고갈 판정은 본인 기대수명이 아니라 가구 종료 나이(SimulationResult.householdEndAge)
// 기준이다. PDF의 폴백 문구가 "기대수명 내 고갈 없음"이면, 배우자가 더 오래 사는 계획에서
// 실제로 검사한 구간보다 짧은 구간을 보증한 것처럼 읽힌다.
describe('describeDepletionAge', () => {
  test('고갈 나이가 있으면 그 나이를 그대로 쓴다', () => {
    expect(describeDepletionAge(82, 90, 85, 'depleted')).toBe('82세');
  });

  test('배우자가 없으면(가구 종료 = 본인 기대수명) 기대수명 기준으로 말한다', () => {
    expect(describeDepletionAge(null, 85, 85, 'sustained')).toBe('기대수명(85세)까지 고갈 없음');
  });

  test('가구 종료가 본인 기대수명보다 늦으면 배우자 기준임을 밝힌다', () => {
    expect(describeDepletionAge(null, 95, 85, 'sustained'))
      .toBe('배우자 기대수명 시점(본인 나이 95세)까지 고갈 없음');
  });

  test('undefined도 null과 같게 다룬다', () => {
    expect(describeDepletionAge(undefined, 85, 85, 'sustained')).toBe('기대수명(85세)까지 고갈 없음');
  });

  // 투자자산이 없는 계획은 엔진이 첫 해에 고갈로 판정하므로, 그 나이를 그대로 쓰면
  // PDF 요약이 "자산 고갈 예상 나이: 51세"라고 보고한다.
  test('투자자산 미보유면 고갈 나이 대신 미보유임을 밝힌다', () => {
    expect(describeDepletionAge(51, 90, 90, 'no_investable_asset')).toBe('투자자산 미보유');
  });
});
