import type { SimulationParams } from '../../entities/types';

export interface ObservedEtfDividend {
  assetId: string;
  ticker: string;
  expectedDividend: number;
  dividendYield: number;
}

/** 조회된 분배율만 반영하며 조회 중 바뀐 종목과 배당률은 유지한다. */
export function applyObservedEtfDividends(params: SimulationParams, observations: readonly ObservedEtfDividend[]): {
  params: SimulationParams; appliedCount: number;
} {
  let appliedCount = 0;
  const assets = params.assets.map((asset) => {
    const matches = observations.filter((item) => item.assetId === asset.id);
    if (asset.type !== 'etf' || params.assets.filter((item) => item.id === asset.id).length !== 1 || matches.length !== 1) return asset;
    const observation = matches[0];
    if (asset.ticker !== observation.ticker || asset.dividendYield !== observation.expectedDividend
      || !Number.isFinite(observation.dividendYield) || observation.dividendYield < 0
      || observation.dividendYield === asset.dividendYield) return asset;
    appliedCount++;
    return { ...asset, dividendYield: observation.dividendYield };
  });
  return { params: appliedCount ? { ...params, assets } : params, appliedCount };
}
