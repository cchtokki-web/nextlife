import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { unusedAssetsRegressionParams } from './fixtures';

describe('retirement-domain-invariants / golden regression', () => {
  test('매도 가능한 대규모 자산을 남겨 둔 채 장기간 생활비 부족을 만들지 않는다', () => {
    const result = new SimulationEngine().run(unusedAssetsRegressionParams());
    const shortfallYears = result.yearlyResults.filter((year) => year.shortfall > 0);
    const hasLargeUnusedAssets = result.endingAssets >= 1_000_000_000;
    const hasLongTermShortfall = shortfallYears.length >= 10;

    // 이 복합 상태가 실제 발견된 오류의 실패 신호다.
    expect(hasLongTermShortfall && hasLargeUnusedAssets).toBe(false);
    expect(shortfallYears).toHaveLength(0);
    expect(result.endingAssets).toBeGreaterThanOrEqual(1_000_000_000);
    expect(result.yearlyResults.some((year) => year.generalAssetWithdrawal > 0)).toBe(true);
  });
});
