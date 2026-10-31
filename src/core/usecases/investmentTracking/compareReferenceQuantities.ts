import type { InvestmentAsset } from '../../entities/types';
import { baselineReferenceValue } from './baselineReferenceValue';

/** 같은 자산의 입력 수량을 동일한 시세로 평가한다. 투자 성과나 실제 잔고가 아니다. */
export function compareReferenceQuantities(baseline: InvestmentAsset, baselineAssets: readonly InvestmentAsset[], currentAssets: readonly InvestmentAsset[], price: number): {
  currentQuantity: number; currentValue: number; difference: number;
} | null {
  if (baseline.type !== 'etf' || baselineAssets.filter((item) => item.id === baseline.id).length !== 1) return null;
  const matching = currentAssets.filter((item) => item.id === baseline.id);
  if (matching.length !== 1) return null;
  const current = matching[0];
  if (current.type !== 'etf' || current.ticker !== baseline.ticker || current.currency !== baseline.currency) return null;
  const baselineValue = baselineReferenceValue(baseline.quantity, baseline.currency, price, baseline.currency);
  const currentValue = baselineReferenceValue(current.quantity, current.currency, price, baseline.currency);
  if (baselineValue === null || currentValue === null || !Number.isFinite(currentValue - baselineValue)) return null;
  return { currentQuantity: current.quantity, currentValue, difference: currentValue - baselineValue };
}
