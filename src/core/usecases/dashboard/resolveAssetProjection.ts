import type { MonteCarloAssetBandYear } from '../../entities/montecarlo';
import type { SimulationResult } from '../../entities/types';

export type AssetProjectionBasis = 'monte_carlo_median' | 'deterministic';

export interface AssetProjection {
  basis: AssetProjectionBasis;
  totalAssetsByAge: ReadonlyMap<number, number>;
}

/**
 * 화면 차트와 PDF 연령별 표가 사용할 연도별 총자산 기준을 한 곳에서 정한다.
 *
 * 모든 나이에 Monte Carlo 밴드가 있을 때만 중앙값 경로를 사용한다. 일부 나이만 중앙값이고
 * 나머지는 기준 수익률인 혼합 경로는 실제로 존재하지 않는 경로이므로, 하나라도 빠지면 전체를
 * 결정론 결과로 되돌린다.
 */
export function resolveAssetProjection(
  yearlyResults: SimulationResult['yearlyResults'],
  bandByAge: ReadonlyMap<number, MonteCarloAssetBandYear> | undefined,
): AssetProjection {
  const usesMedian = bandByAge !== undefined
    && bandByAge.size > 0
    && yearlyResults.every((result) => bandByAge.has(result.age));

  return {
    basis: usesMedian ? 'monte_carlo_median' : 'deterministic',
    totalAssetsByAge: new Map(yearlyResults.map((result) => [
      result.age,
      usesMedian ? bandByAge!.get(result.age)!.p50 : result.totalAssets,
    ])),
  };
}
