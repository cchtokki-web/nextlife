import { describe, expect, it } from 'vitest';
import { applyObservedEtfDividends } from '@/core/usecases/investmentTracking/applyObservedEtfDividends';
import { initialParams } from '@/infrastructure/storage/defaultParams';

const asset = { ...initialParams.assets[0], id: 'a', type: 'etf' as const, ticker: 'VOO', dividendYield: 2 };
const params = { ...initialParams, assets: [asset] };
const quote = { assetId: 'a', ticker: 'VOO', expectedDividend: 2, dividendYield: 3.5 };

describe('ETF 배당률 갱신', () => {
  it('배당률만 변경하고 총수익률은 유지한다', () => {
    const result = applyObservedEtfDividends(params, [quote]);
    expect(result.appliedCount).toBe(1);
    expect(result.params.assets[0]).toMatchObject({ dividendYield: 3.5, totalReturn: asset.totalReturn });
  });
  it('중복·종목 변경·조회 중 수정·유효하지 않은 값은 건너뛴다', () => {
    for (const item of [{ ...quote, ticker: 'QQQ' }, { ...quote, expectedDividend: 4 },
      { ...quote, dividendYield: -1 }, { ...quote, dividendYield: NaN }]) {
      expect(applyObservedEtfDividends(params, [item]).appliedCount).toBe(0);
    }
    expect(applyObservedEtfDividends(params, [quote, quote]).appliedCount).toBe(0);
    expect(applyObservedEtfDividends({ ...params, assets: [asset, asset] }, [quote]).appliedCount).toBe(0);
  });
});
