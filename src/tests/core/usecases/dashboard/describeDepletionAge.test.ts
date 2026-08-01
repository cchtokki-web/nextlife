import { describe, test, expect } from 'vitest';
import { describeDepletionAge } from '@/core/usecases/dashboard/describeDepletionAge';

// A5: 고갈 판정은 본인 기대수명이 아니라 가구 종료 나이(SimulationResult.householdEndAge)
// 기준이다. PDF의 폴백 문구가 "기대수명 내 고갈 없음"이면, 배우자가 더 오래 사는 계획에서
// 실제로 검사한 구간보다 짧은 구간을 보증한 것처럼 읽힌다.
describe('describeDepletionAge', () => {
  test('고갈 나이가 있으면 그 나이를 그대로 쓴다', () => {
    expect(describeDepletionAge(82, 90, 85)).toBe('82세');
  });

  test('배우자가 없으면(가구 종료 = 본인 기대수명) 기대수명 기준으로 말한다', () => {
    expect(describeDepletionAge(null, 85, 85)).toBe('기대수명(85세)까지 고갈 없음');
  });

  test('가구 종료가 본인 기대수명보다 늦으면 배우자 기준임을 밝힌다', () => {
    expect(describeDepletionAge(null, 95, 85))
      .toBe('배우자 기대수명 시점(본인 나이 95세)까지 고갈 없음');
  });

  test('undefined도 null과 같게 다룬다', () => {
    expect(describeDepletionAge(undefined, 85, 85)).toBe('기대수명(85세)까지 고갈 없음');
  });
});
