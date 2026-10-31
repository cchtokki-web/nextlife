import { describe, expect, it } from 'vitest';
import { historicalAdjustedReturn } from '@/core/usecases/returns/historicalAdjustedReturn';

describe('수정 종가 연환산', () => {
  it('실제 기간으로 복리 환산하며 9.5% 상한을 적용하지 않는다', () => {
    const result = historicalAdjustedReturn([
      { date: '2020-01-01', adjustedClose: 100 },
      { date: '2025-01-01', adjustedClose: 200 },
    ]);
    expect(result?.cumulativeReturn).toBe(100);
    expect(result?.annualizedReturn).toBeCloseTo(14.87, 1);
    expect(result?.startDate).toBe('2020-01-01');
    expect(result?.endDate).toBe('2025-01-01');
  });

  it('손실을 0으로 자르지 않고 누락 관측치를 알린다', () => {
    const result = historicalAdjustedReturn([
      { date: '2020-01-01', adjustedClose: 100 },
      { date: '2020-02-01', adjustedClose: null },
      { date: '2021-01-01', adjustedClose: 80 },
    ]);
    expect(result?.annualizedReturn).toBeLessThan(0);
    expect(result?.missingPoints).toBe(1);
  });

  it('1년 미만·잘못된 날짜·중복 날짜·잘못된 종가는 계산하지 않는다', () => {
    expect(historicalAdjustedReturn([{ date: '2020-01-01', adjustedClose: 1 }, { date: '2020-12-30', adjustedClose: 2 }])).toBeNull();
    expect(historicalAdjustedReturn([{ date: '2020-02-30', adjustedClose: 1 }, { date: '2022-01-01', adjustedClose: 2 }])).toBeNull();
    expect(historicalAdjustedReturn([{ date: '2020-01-01', adjustedClose: 1 }, { date: '2020-01-01', adjustedClose: 2 }])).toBeNull();
    expect(historicalAdjustedReturn([{ date: '2020-01-01', adjustedClose: 1 }, { date: '2022-01-01', adjustedClose: 0 }])).toBeNull();
  });
});
