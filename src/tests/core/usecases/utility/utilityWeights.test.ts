import { describe, test, expect } from 'vitest';
import { DEFAULT_UTILITY_CONFIG, createUtilityConfig } from '@/core/usecases/utility/utilityWeights';

describe('DEFAULT_UTILITY_CONFIG.weights', () => {
  test('6개 구성요소 가중치의 합은 100이어야 한다', () => {
    const sum = Object.values(DEFAULT_UTILITY_CONFIG.weights).reduce((acc, w) => acc + w, 0);
    expect(sum).toBe(100);
  });
});

describe('createUtilityConfig', () => {
  const rest = {
    pensionUtilizationSubWeights: {
      nationalPension: 0.4,
      privatePensionWithdrawal: 0.4,
      privatePensionTaxEfficiency: 0.2,
    },
    privatePensionEffectiveTaxCeiling: 0.1,
    appropriateBequestMonths: 24,
    survivalBaseScore: 0.7,
    fullBufferYears: 5,
    taxBurdenCeiling: 0.3,
    healthInsuranceCeiling: 0.05,
  };

  test('합이 100이면 정상적으로 UtilityConfig를 생성한다', () => {
    const config = createUtilityConfig(
      { consumption: 40, depletionSafety: 20, pensionUtilization: 15, taxEfficiency: 10, taxationRisk: 10, bequestAdequacy: 5 },
      rest
    );
    expect(config.weights.consumption).toBe(40);
  });

  test('합이 100이 아니면 예외를 던진다', () => {
    expect(() =>
      createUtilityConfig(
        { consumption: 40, depletionSafety: 20, pensionUtilization: 15, taxEfficiency: 10, taxationRisk: 10, bequestAdequacy: 10 },
        rest
      )
    ).toThrow(/100/);
  });

  test('pensionUtilizationSubWeights 합이 1이 아니면 예외를 던진다', () => {
    expect(() =>
      createUtilityConfig(
        { consumption: 40, depletionSafety: 20, pensionUtilization: 15, taxEfficiency: 10, taxationRisk: 10, bequestAdequacy: 5 },
        { ...rest, pensionUtilizationSubWeights: { nationalPension: 0.5, privatePensionWithdrawal: 0.4, privatePensionTaxEfficiency: 0.2 } }
      )
    ).toThrow(/pensionUtilizationSubWeights/);
  });
});
