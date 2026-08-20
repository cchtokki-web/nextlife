import { describe, test, expect } from 'vitest';
import { priceGrowthRate } from '@/core/usecases/returns/decomposeReturn';

describe('priceGrowthRate', () => {
  test('배당이 총수익률보다 작으면 나머지가 가격상승분이다', () => {
    expect(priceGrowthRate(10.5, 3.5)).toBeCloseTo(7, 10);
  });

  test('배당이 없으면 총수익률 전부가 가격상승분이다', () => {
    expect(priceGrowthRate(7, 0)).toBeCloseTo(7, 10);
  });

  test('배당이 총수익률과 같으면 가격상승분이 0이다', () => {
    expect(priceGrowthRate(7, 7)).toBeCloseTo(0, 10);
  });

  // 커버드콜·고배당 ETF는 분배금이 총수익률을 넘고 그만큼 NAV가 줄어든다.
  // 0으로 자르면 그 상품을 표현할 수 없다.
  test('배당이 총수익률보다 크면 음수가 된다', () => {
    expect(priceGrowthRate(7, 21.2)).toBeCloseTo(-14.2, 10);
  });

  test('총수익률이 음수여도 그대로 계산한다', () => {
    expect(priceGrowthRate(-3, 2)).toBeCloseTo(-5, 10);
  });
});
