import { describe, expect, it } from 'vitest';
import { applyCurrentQuotes, type ObservedQuote } from '@/core/usecases/investmentTracking/applyCurrentQuotes';
import { initialParams } from '@/infrastructure/storage/defaultParams';

const asset = { ...initialParams.assets[0], id: 'a', ticker: 'VOO', type: 'etf' as const,
  currency: 'USD' as const, quantity: 10, averagePrice: 100, acquisitionCostBasis: 500 };
const params = { ...initialParams, assets: [asset] };
const quote: ObservedQuote = { assetId: 'a', ticker: 'VOO', currency: 'USD', price: 120, marketTime: 1700000000 };

describe('조회 시세 반영', () => {
  it('일치하는 자산의 가격만 바꾸고 수량·취득원가·기준 계획을 보존한다', () => {
    const baseline = { capturedAt: '2026-01-01T00:00:00.000Z', params };
    const input = { ...params, investmentBaseline: baseline };
    const result = applyCurrentQuotes(input, [quote]);
    expect(result.appliedCount).toBe(1);
    expect(result.params.assets[0]).toEqual({ ...asset, averagePrice: 120 });
    expect(result.params.investmentBaseline).toBe(baseline);
    expect(input.assets[0].averagePrice).toBe(100);
  });

  it('종목·통화·가격·시각이 맞지 않으면 기존 계획을 보존한다', () => {
    const invalid = [
      { ...quote, ticker: 'QQQ' }, { ...quote, currency: 'KRW' as const },
      { ...quote, price: NaN }, { ...quote, price: 0 }, { ...quote, marketTime: 0 },
    ];
    for (const item of invalid) expect(applyCurrentQuotes(params, [item])).toEqual({ params, appliedCount: 0 });
    expect(applyCurrentQuotes(params, [quote, quote])).toEqual({ params, appliedCount: 0 });
    const duplicateAssets = { ...params, assets: [asset, asset] };
    expect(applyCurrentQuotes(duplicateAssets, [quote])).toEqual({ params: duplicateAssets, appliedCount: 0 });
  });
});
