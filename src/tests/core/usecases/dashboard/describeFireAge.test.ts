import { describe, test, expect } from 'vitest';
import { describeFireAge } from '@/core/usecases/dashboard/describeFireAge';

// A2: fireAge의 게이트 기준은 가구 종료 나이(householdEndAge)다. 배우자가 본인보다 오래
// 사는 계획에서는 fireAge가 본인 기대수명을 넘을 수 있고, 단서 없이 숫자만 인쇄하면
// 같은 리포트(그리고 같은 AI 프롬프트)가 "80세 사망"과 "85세 FIRE"를 나란히 말하게 된다.
describe('describeFireAge', () => {
  test('달성하지 못하면 달성 불가능으로 표기한다', () => {
    expect(describeFireAge(null, 85)).toBe('달성 불가능');
    expect(describeFireAge(undefined, 85)).toBe('달성 불가능');
  });

  test('본인 기대수명 이내면 나이만 표기한다', () => {
    expect(describeFireAge(60, 85)).toBe('60세');
    expect(describeFireAge(85, 85)).toBe('85세');
  });

  test('본인 기대수명을 넘으면 배우자 생존 기간 기준임을 함께 표기한다', () => {
    const text = describeFireAge(85, 80);

    expect(text).toContain('85세');
    expect(text).toContain('80세');
    expect(text).toContain('배우자 생존 기간');
  });
});
