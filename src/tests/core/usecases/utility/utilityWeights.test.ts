import { describe, test, expect } from 'vitest';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

describe('DEFAULT_UTILITY_CONFIG.weights', () => {
  test('6개 구성요소 가중치의 합은 100이어야 한다', () => {
    const sum = Object.values(DEFAULT_UTILITY_CONFIG.weights).reduce((acc, w) => acc + w, 0);
    expect(sum).toBe(100);
  });
});
