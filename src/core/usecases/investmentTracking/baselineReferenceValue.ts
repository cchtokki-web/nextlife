import type { AssetCurrency } from '../../entities/types';

/** 기준 수량과 동일 통화의 시세만 곱한다. 실제 계좌 잔고나 계획 대비 성과가 아니다. */
export function baselineReferenceValue(
  quantity: number, assetCurrency: AssetCurrency, price: number, quoteCurrency: unknown,
): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price <= 0
    || assetCurrency !== quoteCurrency) return null;
  const value = quantity * price;
  return Number.isFinite(value) ? value : null;
}
