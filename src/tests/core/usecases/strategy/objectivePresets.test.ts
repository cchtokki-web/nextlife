import { describe, test, expect } from 'vitest';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { createUtilityConfig } from '@/core/usecases/utility/utilityWeights';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { ObjectivePriority } from '@/core/entities/types';

const ALL: ObjectivePriority[] = [
  'lifetime_spending', 'tax_minimization', 'wealth_maximization',
  'bequest_maximization', 'ai_recommended',
];

describe('OBJECTIVE_WEIGHT_PRESETS', () => {
  test('모든 우선순위에 대해 가중치 합이 100이다', () => {
    for (const key of ALL) {
      const sum = Object.values(OBJECTIVE_WEIGHT_PRESETS[key]).reduce((a, b) => a + b, 0);
      expect(sum, `${key} 가중치 합`).toBe(100);
    }
  });

  test('모든 프리셋이 createUtilityConfig 불변식을 통과하고 weights가 보존된다', () => {
    // createUtilityConfig는 `{ weights, ...rest }`를 반환하므로 rest에 weights가
    // 섞여 있으면 나중에 스프레드되어 방금 고른 프리셋을 덮어쓴다. rest는 반드시 weights를
    // 떼어낸 것이어야 한다 — 이 테스트가 그 회귀를 잡는다.
    const { weights: _unused, ...rest } = DEFAULT_UTILITY_CONFIG;

    for (const key of ALL) {
      const cfg = createUtilityConfig(OBJECTIVE_WEIGHT_PRESETS[key], rest);

      expect(cfg.weights, `${key} weights`).toEqual(OBJECTIVE_WEIGHT_PRESETS[key]);
      expect(cfg.appropriateBequestMonths).toBe(DEFAULT_UTILITY_CONFIG.appropriateBequestMonths);
    }
  });

  test('세금 최소화는 기본값보다 taxEfficiency 가중치가 높다', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.tax_minimization.taxEfficiency)
      .toBeGreaterThan(DEFAULT_UTILITY_CONFIG.weights.taxEfficiency);
  });

  test('상속 최대화는 기본값보다 bequestAdequacy 가중치가 높다', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.bequest_maximization.bequestAdequacy)
      .toBeGreaterThan(DEFAULT_UTILITY_CONFIG.weights.bequestAdequacy);
  });

  test('AI 추천은 기본 가중치와 동일하다 (AI가 별도로 제안하므로 중립 유지)', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.ai_recommended).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });
});

