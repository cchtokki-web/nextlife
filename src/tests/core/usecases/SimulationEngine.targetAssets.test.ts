import { describe, test, expect } from 'vitest';
import { computeRetirementTargetAssets } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';

// 은퇴 준비도 100점 중 25점(assetScore)의 분모. 4% 룰(연 필요액 × 25)로 환산한 목표 자산이며,
// "그 계획이 실제로 감당해야 할 필요"를 반영해야 점수가 의미를 갖는다.
describe('computeRetirementTargetAssets (4% 룰 목표 자산)', () => {
  const monthly = 3000000;

  test('배우자·의료비가 없으면 기존과 동일하게 월 목표 × 12 × 25다', () => {
    expect(computeRetirementTargetAssets(monthly, 1, 0)).toBe(monthly * 12 * 25);
  });

  test('은퇴 시점 가구 규모 계수를 반영한다', () => {
    // 배우자가 나이가 많아 은퇴 전에 사망하면 은퇴 기간 전체의 필요가 0.7배다.
    // 분모를 2인 기준으로 두면 assetScore가 약 30% 과소평가된다.
    expect(computeRetirementTargetAssets(monthly, SINGLE_SURVIVOR_SPENDING_FACTOR, 0))
      .toBe(monthly * 12 * SINGLE_SURVIVOR_SPENDING_FACTOR * 25);
  });

  test('의료비를 켜면 실제 필요 자산이 늘어난 만큼 분모도 커진다', () => {
    // 의료비는 반드시 나가는 지출이다. 분모에 넣지 않으면 의료비를 켠 계획이
    // 자산이 충분하다는 같은 점수를 받는다(FIRE 목표에 의료비를 넣은 것과 같은 이유).
    const annualHealthcare = 6000000;

    expect(computeRetirementTargetAssets(monthly, 1, annualHealthcare))
      .toBe((monthly * 12 + annualHealthcare) * 25);
  });

  test('의료비에는 가구 규모 계수를 다시 곱하지 않는다 (엔진이 이미 곱해 둔 값)', () => {
    const annualHealthcare = 4200000; // 이미 0.7이 반영된 금액

    expect(computeRetirementTargetAssets(monthly, SINGLE_SURVIVOR_SPENDING_FACTOR, annualHealthcare))
      .toBe((monthly * 12 * SINGLE_SURVIVOR_SPENDING_FACTOR + annualHealthcare) * 25);
  });

  test('계수가 0인(가구 소멸) 극단 입력에서도 음수가 되지 않는다', () => {
    expect(computeRetirementTargetAssets(monthly, 0, 0)).toBe(0);
  });
});
