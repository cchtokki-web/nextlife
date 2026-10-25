import { describe, test, expect } from 'vitest';
import { sortAssetsForWithdrawal } from '@/core/usecases/strategy/assetOrdering';

interface FakeAsset {
  id: string;
  dividendYield: number;
}

const assets: FakeAsset[] = [
  { id: 'growth', dividendYield: 0.5 },
  { id: 'balanced', dividendYield: 2 },
  { id: 'highdiv', dividendYield: 4 },
];

describe('sortAssetsForWithdrawal', () => {
  test('전략 미지정 시 원본 배열 순서를 그대로 반환한다', () => {
    const sorted = sortAssetsForWithdrawal(assets, undefined);
    expect(sorted.map((a) => a.id)).toEqual(['growth', 'balanced', 'highdiv']);
  });

  test('input_order 전략도 원본 배열 순서를 그대로 반환한다', () => {
    const sorted = sortAssetsForWithdrawal(assets, 'input_order');
    expect(sorted.map((a) => a.id)).toEqual(['growth', 'balanced', 'highdiv']);
  });

  test('low_dividend_first는 배당수익률 낮은 자산부터 정렬한다', () => {
    const sorted = sortAssetsForWithdrawal(assets, 'low_dividend_first');
    expect(sorted.map((a) => a.id)).toEqual(['growth', 'balanced', 'highdiv']);
  });

  test('high_dividend_first는 배당수익률 높은 자산부터 정렬한다', () => {
    const sorted = sortAssetsForWithdrawal(assets, 'high_dividend_first');
    expect(sorted.map((a) => a.id)).toEqual(['highdiv', 'balanced', 'growth']);
  });

  test('원본 배열은 변경되지 않는다 (사본 정렬)', () => {
    const original = [...assets];
    sortAssetsForWithdrawal(assets, 'high_dividend_first');
    expect(assets.map((a) => a.id)).toEqual(original.map((a) => a.id));
  });

  test('빈 배열도 안전하게 처리한다', () => {
    expect(sortAssetsForWithdrawal([], 'high_dividend_first')).toEqual([]);
  });
});
