export type AssetSellOrderStrategy = 'input_order' | 'low_dividend_first' | 'high_dividend_first';

// 자산 매도(인출) 순서를 결정하는 순수 함수. 원본 배열은 변경하지 않고 사본을 정렬해 반환한다.
// dividendYield는 시간에 따라 변하지 않으므로 시뮬레이션 시작 시 한 번만 계산해 재사용할 수 있다.
export function sortAssetsForWithdrawal<T extends { dividendYield: number }>(
  assets: T[],
  strategy: AssetSellOrderStrategy | undefined
): T[] {
  if (!strategy || strategy === 'input_order') return assets;

  const sorted = [...assets];
  if (strategy === 'low_dividend_first') {
    sorted.sort((a, b) => a.dividendYield - b.dividendYield);
  } else if (strategy === 'high_dividend_first') {
    sorted.sort((a, b) => b.dividendYield - a.dividendYield);
  }
  return sorted;
}
