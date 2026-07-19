import { describe, test, expect } from 'vitest';
import { buildSimulationContextText } from '@/app/api/ai-advisor/route';
import { StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';

const baseUtility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 10, bequestAdequacy: 0 },
};

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0, comprehensiveTaxYears: 0, healthInsuranceTotal: 0,
};

const baseBody = {
  score: 90,
  retirementGrade: '매우 안정' as const,
  monthlyTarget: 3000000,
  depletionAge: null,
};

describe('buildSimulationContextText - Utility Score 반영', () => {
  test('utility/recommendation 미지정 시 기존과 동일하게 Utility 관련 줄이 없다', () => {
    const text = buildSimulationContextText(baseBody);
    expect(text).not.toContain('Lifetime Utility');
  });

  test('utility가 있으면 Lifetime Utility Score 줄과 강점/약점 요약을 포함한다', () => {
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility });
    expect(text).toContain('Lifetime Utility Score');
    expect(text).toContain('76');
    // bequestAdequacy 0/10 -> 약점으로 분류되어야 함
    expect(text).toContain('상속 자산 적정성');
  });

  test('recommendation이 baseline보다 개선되면 추천 이유를 포함한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: { ...baseUtility, score: 83 },
      recommendedUtility: { ...baseUtility, score: 87 },
      recommendedPlan: {},
      reasons: ['62세부터 사적연금 인출을 시작합니다.'],
      deltas: zeroDeltas,
    };
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility, recommendation });

    expect(text).toContain('83');
    expect(text).toContain('87');
    expect(text).toContain('62세부터 사적연금 인출을 시작합니다.');
  });

  test('recommendation이 baseline과 동일하면(개선 없음) 추천 관련 줄을 추가하지 않는다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: { ...baseUtility, score: 83 },
      recommendedUtility: { ...baseUtility, score: 83 },
      recommendedPlan: {},
      reasons: ['현재 전략이 이미 합리적입니다.'],
      deltas: zeroDeltas,
    };
    const text = buildSimulationContextText({ ...baseBody, utility: baseUtility, recommendation });

    expect(text).not.toContain('AI 추천 전략');
  });

  test('기존 필드(은퇴 준비도 점수 등)는 그대로 유지된다', () => {
    const text = buildSimulationContextText(baseBody);
    expect(text).toContain('은퇴 준비도 점수');
    expect(text).toContain('90점');
  });
});
