import { describe, expect, it } from 'vitest';
import { compareReferenceQuantities } from '@/core/usecases/investmentTracking/compareReferenceQuantities';
import { initialParams } from '@/infrastructure/storage/defaultParams';

const asset = { ...initialParams.assets[0], id: 'a', type: 'etf' as const, ticker: 'VOO', currency: 'USD' as const, quantity: 10 };

describe('동일 시세 기준 수량 비교', () => {
  it('변경된 수량을 같은 시세로 평가하고 차이를 계산한다', () => {
    expect(compareReferenceQuantities(asset, [asset], [{ ...asset, quantity: 12.5 }], 100))
      .toEqual({ currentQuantity: 12.5, currentValue: 1250, difference: 250 });
    expect(compareReferenceQuantities(asset, [asset], [{ ...asset, quantity: 0 }], 100)?.difference).toBe(-1000);
  });
  it('중복, 누락, 종목·통화 변경, 유효하지 않은 값은 비교하지 않는다', () => {
    expect(compareReferenceQuantities(asset, [asset, asset], [asset], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [asset, asset], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [{ ...asset, ticker: 'QQQ' }], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [{ ...asset, currency: 'KRW' }], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [{ ...asset, quantity: -1 }], 100)).toBeNull();
    expect(compareReferenceQuantities(asset, [asset], [asset], NaN)).toBeNull();
  });
});
