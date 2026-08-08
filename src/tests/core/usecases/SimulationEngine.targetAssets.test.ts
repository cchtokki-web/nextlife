import { describe, test, expect } from 'vitest';
import { computeRetirementTargetAssets } from '@/core/usecases/SimulationEngine';

// 은퇴 준비도 100점 중 25점(assetScore)의 분모. 4% 룰(연 필요액 × 25)로 환산한 목표 자산이며,
// "그 계획이 실제로 감당해야 할 필요"를 반영해야 점수가 의미를 갖는다.
//
// spendingFactor 인자는 배우자 개념이 있던 시절의 흔적으로, 현재 엔진은 항상 1을 넘긴다.
// 함수 자체는 여전히 일반적인 계수를 받으므로, 순수 함수 계약은 임의의 계수로도 검증해 둔다.
describe('computeRetirementTargetAssets (4% 룰 목표 자산)', () => {
  const monthly = 3000000;

  test('의료비가 없으면 월 목표 × 12 × 25다', () => {
    expect(computeRetirementTargetAssets(monthly, 1, 0)).toBe(monthly * 12 * 25);
  });

  test('spendingFactor를 반영한다', () => {
    const factor = 0.7;

    expect(computeRetirementTargetAssets(monthly, factor, 0))
      .toBe(monthly * 12 * factor * 25);
  });

  test('의료비를 켜면 실제 필요 자산이 늘어난 만큼 분모도 커진다', () => {
    // 의료비는 반드시 나가는 지출이다. 분모에 넣지 않으면 의료비를 켠 계획이
    // 자산이 충분하다는 같은 점수를 받는다(FIRE 목표에 의료비를 넣은 것과 같은 이유).
    const annualHealthcare = 6000000;

    expect(computeRetirementTargetAssets(monthly, 1, annualHealthcare))
      .toBe((monthly * 12 + annualHealthcare) * 25);
  });

  test('의료비에는 spendingFactor를 다시 곱하지 않는다 (엔진이 이미 곱해 둔 값)', () => {
    const factor = 0.7;
    const annualHealthcare = 4200000; // 이미 0.7이 반영된 금액

    expect(computeRetirementTargetAssets(monthly, factor, annualHealthcare))
      .toBe((monthly * 12 * factor + annualHealthcare) * 25);
  });

  test('계수가 0인 극단 입력에서도 음수가 되지 않는다', () => {
    expect(computeRetirementTargetAssets(monthly, 0, 0)).toBe(0);
  });
});
