import type { SimulationParams } from '../../entities/types';

export interface ObservedHistoricalReturn {
  assetId: string;
  ticker: string;
  expectedReturn: number;
  expectedDividend: number;
  annualizedReturn: number;
  missingPoints: number;
  endDate: string;
}

/** 조회 중 입력이 바뀌거나 자료가 불완전하면 기존 수익률을 유지한다. */
export function applyHistoricalEtfReturns(params: SimulationParams, quotes: readonly ObservedHistoricalReturn[], today: string): {
  params: SimulationParams; appliedCount: number;
} {
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(now)
    || new Date(now).toISOString().slice(0, 10) !== today) return { params, appliedCount: 0 };
  const counts = new Map<string, number>();
  params.assets.forEach((asset) => counts.set(asset.id, (counts.get(asset.id) ?? 0) + 1));
  let appliedCount = 0;
  const assets = params.assets.map((asset) => {
    const matching = quotes.filter((quote) => quote.assetId === asset.id);
    if (matching.length !== 1 || counts.get(asset.id) !== 1 || asset.type !== 'etf' || asset.autoHistoricalReturn !== true) return asset;
    const quote = matching[0];
    const end = Date.parse(`${quote.endDate}T00:00:00Z`);
    const ageDays = (now - end) / 86400000;
    if (asset.ticker !== quote.ticker || asset.totalReturn !== quote.expectedReturn
      || asset.dividendYield !== quote.expectedDividend || quote.missingPoints !== 0
      || !Number.isFinite(quote.annualizedReturn) || !/^\d{4}-\d{2}-\d{2}$/.test(quote.endDate)
      || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== quote.endDate
      || ageDays < 0 || ageDays > 30) return asset;
    const totalReturn = Number(quote.annualizedReturn.toFixed(1));
    if (totalReturn === asset.totalReturn) return asset;
    appliedCount += 1;
    return { ...asset, totalReturn };
  });
  return { params: appliedCount === 0 ? params : { ...params, assets, yieldPreset: 'custom' }, appliedCount };
}
