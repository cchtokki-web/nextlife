import { describe, test, expect } from 'vitest';
import { computeRetirementTargetAssets } from '@/core/usecases/SimulationEngine';

// 은퇴 준비도 100점 중 25점(assetScore)의 분모. 4% 룰(연 필요액 × 25)로 환산한 목표 자산이며,
// "그 계획이 실제로 감당해야 할 필요"를 반영해야 점수가 의미를 갖는다.
describe('computeRetirementTargetAssets (4% 룰 목표 자산)', () => {
  const monthly = 3000000;

  test('의료비가 없으면 월 목표 × 12 × 25다', () => {
    expect(computeRetirementTargetAssets(monthly, 0)).toBe(monthly * 12 * 25);
  });

  test('의료비를 켜면 실제 필요 자산이 늘어난 만큼 분모도 커진다', () => {
    // 의료비는 반드시 나가는 지출이다. 분모에 넣지 않으면 의료비를 켠 계획이
    // 자산이 충분하다는 같은 점수를 받는다(FIRE 목표에 의료비를 넣은 것과 같은 이유).
    const annualHealthcare = 6000000;

    expect(computeRetirementTargetAssets(monthly, annualHealthcare))
      .toBe((monthly * 12 + annualHealthcare) * 25);
  });

  test('음수가 되지 않는다', () => {
    expect(computeRetirementTargetAssets(0, 0)).toBe(0);
  });
});
