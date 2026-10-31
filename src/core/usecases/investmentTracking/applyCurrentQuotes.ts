import type { AssetCurrency, SimulationParams } from '../../entities/types';

export interface ObservedQuote {
  assetId: string;
  ticker: string;
  currency: AssetCurrency;
  price: number;
  marketTime: number;
}

/** 사용자가 조회한 시세만 현재 계획에 반영한다. 수량·취득원가·기준 계획은 보존한다. */
export function applyCurrentQuotes(params: SimulationParams, quotes: readonly ObservedQuote[]): {
  params: SimulationParams; appliedCount: number;
} {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const quote of quotes) {
    if (seen.has(quote.assetId)) duplicates.add(quote.assetId);
    seen.add(quote.assetId);
  }
  const assetCounts = new Map<string, number>();
  for (const asset of params.assets) assetCounts.set(asset.id, (assetCounts.get(asset.id) ?? 0) + 1);
  let appliedCount = 0;
  const assets = params.assets.map((asset) => {
    if (assetCounts.get(asset.id) !== 1 || duplicates.has(asset.id) || asset.type !== 'etf') return asset;
    const quote = quotes.find((item) => item.assetId === asset.id);
    if (!quote || quote.ticker !== asset.ticker || quote.currency !== asset.currency
      || !Number.isFinite(quote.price) || quote.price <= 0
      || !Number.isFinite(quote.marketTime) || quote.marketTime <= 0
      || quote.price === asset.averagePrice) return asset;
    appliedCount += 1;
    return { ...asset, averagePrice: quote.price };
  });
  return { params: appliedCount === 0 ? params : { ...params, assets }, appliedCount };
}
