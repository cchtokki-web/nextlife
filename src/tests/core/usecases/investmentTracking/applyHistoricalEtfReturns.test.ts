import { describe, expect, it } from 'vitest';
import { applyHistoricalEtfReturns, type ObservedHistoricalReturn } from '@/core/usecases/investmentTracking/applyHistoricalEtfReturns';
import { initialParams } from '@/infrastructure/storage/defaultParams';

const asset = { ...initialParams.assets[0], id: 'a', ticker: 'VOO', type: 'etf' as const,
  totalReturn: 7, dividendYield: 2, autoHistoricalReturn: true };
const params = { ...initialParams, assets: [asset] };
const quote: ObservedHistoricalReturn = { assetId: 'a', ticker: 'VOO', expectedReturn: 7,
  expectedDividend: 2, annualizedReturn: -3.45, missingPoints: 0, endDate: '2026-10-30' };

describe('과거 수익률 자동 반영', () => {
  it('선택한 ETF의 총수익률만 적용하고 음수를 보존한다', () => {
    const result = applyHistoricalEtfReturns(params, [quote], '2026-10-31');
    expect(result.appliedCount).toBe(1);
    expect(result.params.assets[0].totalReturn).toBe(Number((-3.45).toFixed(1)));
    expect(result.params.assets[0].dividendYield).toBe(2);
    expect(result.params.assets[0].quantity).toBe(asset.quantity);
    expect(params.assets[0].totalReturn).toBe(7);
  });

  it('누락·오래된 자료나 조회 중 변경된 값은 반영하지 않는다', () => {
    for (const item of [
      { ...quote, missingPoints: 1 }, { ...quote, endDate: '2026-09-01' },
      { ...quote, endDate: '2026-11-01' }, { ...quote, expectedReturn: 8 },
      { ...quote, expectedDividend: 3 }, { ...quote, ticker: 'QQQ' },
    ]) expect(applyHistoricalEtfReturns(params, [item], '2026-10-31').appliedCount).toBe(0);
    expect(applyHistoricalEtfReturns(params, [quote, quote], '2026-10-31').appliedCount).toBe(0);
    expect(applyHistoricalEtfReturns({ ...params, assets: [{ ...asset, autoHistoricalReturn: false }] }, [quote], '2026-10-31').appliedCount).toBe(0);
  });
});
