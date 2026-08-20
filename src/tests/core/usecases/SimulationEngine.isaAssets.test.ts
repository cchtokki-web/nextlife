import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { IsaAccount, InvestmentAsset, SimulationParams } from '@/core/entities/types';

// ISA 잔액은 totalAssets에는 들어 있었지만 별도 필드가 없었다. 그래서
// stockAssets + pensionAssets로 자산 구성을 재구성하는 소비처들이 ISA를 통째로 놓쳤다:
//   - 은퇴 준비도 점수의 인플레이션 헤지 항목(투자 비중 분자)
//   - 자산 추이 차트(주식+연금과 총액 사이가 라벨 없는 공백으로 보였다)

const isa: IsaAccount = {
  id: 'isa-1', type: 'general', balance: 300000000, monthlyContribution: 0,
  totalReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 100,
};

const stock: InvestmentAsset = {
  id: 'a1', type: 'etf', ticker: 'A', name: '주식',
  quantity: 3000, averagePrice: 100000,
  totalReturn: 5, dividendYield: 2,
  monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
};

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 1000000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('SimulationEngine - isaAssets', () => {
  test('자산 구성 4종의 합이 총자산과 같다', () => {
    const result = new SimulationEngine().run(params({
      assets: [stock],
      isaAccounts: [isa],
      privatePensions: [
        { id: 'p1', type: 'irp', balance: 200000000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
      ],
    }));

    for (const year of result.yearlyResults) {
      // 현금(cashAssets)까지 포함해야 총액이 맞는다. 쓰고 남은 돈을 자산에 도로 넣지 않고
      // 별도 버킷에 두기 때문이다 — 넣으면 "배당 재투자 끄기"가 조용히 재투자가 된다.
      expect(year.stockAssets + year.pensionAssets + year.isaAssets + year.cashAssets)
        .toBeCloseTo(year.totalAssets, 6);
    }
  });

  test('ISA만 보유해도 인플레이션 헤지 점수가 0이 아니다', () => {
    // 예전에는 투자 비중 분자가 stockAssets + pensionAssets뿐이라 전 재산이 ISA면
    // investedRatio가 0으로 잡혀 헤지 점수(15점 만점)가 통째로 0이었다.
    const isaOnly = new SimulationEngine().run(params({ isaAccounts: [isa] }));
    const stockOnly = new SimulationEngine().run(params({
      assets: [{ ...stock, quantity: 3000 }],
    }));

    // 같은 규모의 투자 자산을 ISA로 갖든 주식으로 갖든 헤지 점수는 같아야 한다.
    // 점수 전체를 비교하면 다른 항목 차이에 묻히므로, ISA 쪽이 주식 쪽에 근접하는지 본다.
    expect(isaOnly.retirementScore).toBeGreaterThan(0);
    expect(Math.abs(isaOnly.retirementScore - stockOnly.retirementScore)).toBeLessThanOrEqual(2);
  });

  test('ISA가 없으면 isaAssets는 0이다', () => {
    const result = new SimulationEngine().run(params({ assets: [stock] }));

    expect(result.yearlyResults.every((y) => y.isaAssets === 0)).toBe(true);
  });
});
