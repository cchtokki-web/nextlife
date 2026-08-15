import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { unusedAssetsRegressionParams } from './fixtures';

describe('retirement-domain-invariants / golden regression', () => {
  test('매도 가능한 대규모 자산을 남겨 둔 채 장기간 생활비 부족을 만들지 않는다', () => {
    // 원래 오류의 신호는 "10년 이상 생활비 부족 + 10억 이상 기말자산"의 동시 발생이었다.
    // 아래 두 단언이 그 복합 조건보다 강하므로(부족 연도 0 + 자산 보존) 따로 검사하지 않는다.
    const result = new SimulationEngine().run(unusedAssetsRegressionParams());
    const shortfallYears = result.yearlyResults.filter((year) => year.shortfall > 0);

    expect(shortfallYears).toHaveLength(0);
    expect(result.endingAssets).toBeGreaterThanOrEqual(1_000_000_000);
    expect(result.yearlyResults.some((year) => year.generalAssetWithdrawal > 0)).toBe(true);
  });
});
