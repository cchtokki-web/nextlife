import { describe, test, expect } from 'vitest';
import { analyzeCurrentStrategy } from '@/core/usecases/utility/utilityAnalysis';
import { UtilityBreakdown } from '@/core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

function makeUtility(components: UtilityBreakdown['components']): UtilityBreakdown {
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return { score, components };
}

describe('analyzeCurrentStrategy', () => {
  test('배점 대비 80% 이상인 항목은 강점으로 분류한다', () => {
    // consumption 배점 35 -> 80% = 28
    const utility = makeUtility({
      consumption: 30, // 30/35 ≈ 85.7% -> 강점
      depletionSafety: 5, // 5/20 = 25% -> 약점
      pensionUtilization: 8, // 8/15 ≈ 53% -> 중간(강점도 약점도 아님)
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.strengths.some((s) => s.includes('소비 만족도'))).toBe(true);
    expect(analysis.weaknesses.some((s) => s.includes('자산 고갈 방지'))).toBe(true);
  });

  test('배점 대비 50% 이하인 항목은 약점으로 분류한다', () => {
    const utility = makeUtility({
      consumption: 17, // 17/35 = 48.57% -> 약점
      depletionSafety: 18,
      pensionUtilization: 8,
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.weaknesses.some((s) => s.includes('소비 만족도'))).toBe(true);
  });

  test('강점이 하나도 없으면 폴백 문구를 반환한다', () => {
    const utility = makeUtility({
      consumption: 20, // 20/35 ≈ 57% -> 중간
      depletionSafety: 10, // 10/20 = 50% -> 약점(경계값 포함)
      pensionUtilization: 8,
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.strengths.length).toBe(1);
    expect(analysis.strengths[0]).toContain('균형');
  });

  test('약점이 하나도 없으면 폴백 문구를 반환한다', () => {
    const utility = makeUtility({
      consumption: 35,
      depletionSafety: 20,
      pensionUtilization: 15,
      taxEfficiency: 10,
      taxationRisk: 10,
      bequestAdequacy: 10,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.weaknesses.length).toBe(1);
    expect(analysis.weaknesses[0]).toContain('약점');
  });

  test('배점이 0인 커스텀 cfg가 주어져도 0으로 나누기 오류 없이 안전하게 처리한다', () => {
    const zeroWeightCfg = {
      ...DEFAULT_UTILITY_CONFIG,
      weights: { ...DEFAULT_UTILITY_CONFIG.weights, consumption: 0 },
    };
    const utility = makeUtility({
      consumption: 0,
      depletionSafety: 20,
      pensionUtilization: 15,
      taxEfficiency: 10,
      taxationRisk: 10,
      bequestAdequacy: 10,
    });

    expect(() => analyzeCurrentStrategy(utility, zeroWeightCfg)).not.toThrow();
  });
});
