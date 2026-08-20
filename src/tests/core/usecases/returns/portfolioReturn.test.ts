import { describe, test, expect } from 'vitest';
import { weightedAverageTotalReturn, shockBeta } from '@/core/usecases/returns/portfolioReturn';
import type { InvestmentAsset, IsaAccount, PrivatePension, SimulationParams } from '@/core/entities/types';

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 0 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'nominal',
    baseExchangeRate: 1000,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function asset(over: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: 'a', type: 'etf', ticker: 'A', name: 'A',
    quantity: 1, averagePrice: 100, totalReturn: 7, dividendYield: 0,
    monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    ...over,
  };
}

function pension(over: Partial<PrivatePension> = {}): PrivatePension {
  return { id: 'p', type: 'irp', balance: 100, monthlyContribution: 0, totalReturn: 4, currency: 'KRW', ...over };
}

function isa(over: Partial<IsaAccount> = {}): IsaAccount {
  return {
    id: 'i', type: 'general', balance: 100, monthlyContribution: 0,
    totalReturn: 7, dividendYield: 0, currency: 'KRW', maturityYears: 3, ...over,
  };
}

describe('weightedAverageTotalReturn', () => {
  // 예전에는 자산과 ISA만 셌다. 사적연금이 포트폴리오의 절반이어도 변동성 유도에서
  // 통째로 빠졌고, 그만큼 성공률이 낙관 쪽으로 치우쳤다.
  test('사적연금을 포함한다', () => {
    const withPension = weightedAverageTotalReturn(params({
      assets: [asset({ quantity: 1, averagePrice: 100, totalReturn: 10 })],
      privatePensions: [pension({ balance: 100, totalReturn: 4 })],
    }));

    expect(withPension).toBeCloseTo(7, 10);
  });

  test('세 계좌 유형을 잔액으로 가중한다', () => {
    const average = weightedAverageTotalReturn(params({
      assets: [asset({ quantity: 1, averagePrice: 300, totalReturn: 10 })],
      privatePensions: [pension({ balance: 100, totalReturn: 2 })],
      isaAccounts: [isa({ balance: 100, totalReturn: 6 })],
    }));

    // (300×10 + 100×2 + 100×6) / 500 = 7.6
    expect(average).toBeCloseTo(7.6, 10);
  });

  // USD 계좌는 환율로 환산해야 «무게»가 맞는다. 환산하지 않으면 1주짜리 미국 ETF가
  // 같은 숫자의 원화 계좌와 같은 비중을 갖는다.
  test('USD 잔액을 환율로 환산해 가중한다', () => {
    const average = weightedAverageTotalReturn(params({
      baseExchangeRate: 1000,
      assets: [
        asset({ id: 'usd', quantity: 1, averagePrice: 1, currency: 'USD', totalReturn: 10 }),
        asset({ id: 'krw', quantity: 1, averagePrice: 1000, currency: 'KRW', totalReturn: 0 }),
      ],
    }));

    // USD 1 × 1000 = KRW 1000, 원화 계좌도 1000 → 반반
    expect(average).toBeCloseTo(5, 10);
  });

  test('잔액이 하나도 없으면 null이다', () => {
    expect(weightedAverageTotalReturn(params())).toBeNull();
    expect(weightedAverageTotalReturn(params({ assets: [asset({ quantity: 0 })] }))).toBeNull();
  });
});

describe('shockBeta', () => {
  test('기대수익률이 포트폴리오 평균과 같으면 1이다', () => {
    expect(shockBeta(7, 7)).toBeCloseTo(1, 10);
  });

  test('평균보다 높으면 1보다 크고, 낮으면 1보다 작다', () => {
    expect(shockBeta(10, 5)).toBeCloseTo(2, 10);
    expect(shockBeta(4, 8)).toBeCloseTo(0.5, 10);
  });

  // 단일 요인 모델에서 계좌가 시장과 «반대로» 움직일 수는 없다. 음수 배율은
  // 하락장에 그 계좌만 오르게 만든다.
  test('기대수익률이 음수면 0이다', () => {
    expect(shockBeta(-3, 7)).toBe(0);
  });

  // 나눌 수 없는 평균에서는 종전처럼 모든 계좌에 같은 폭을 준다.
  test('평균이 0 이하면 1이다', () => {
    expect(shockBeta(5, 0)).toBe(1);
    expect(shockBeta(5, -2)).toBe(1);
  });
});

describe('β의 잔액가중 평균', () => {
  // **이중 보수가 생기지 않는 근거.** 포트폴리오 전체가 받는 충격은 유도된 변동성
  // 그대로이고, 계좌 간 분산만 기대수익률을 따라간다. 이 성질이 깨지면 연금의 낮은
  // 수익률이 변동성을 낮추고 배율이 «또» 낮추는 예전 구조로 되돌아간다.
  test('정확히 1.0이다', () => {
    const accounts = [
      { balance: 300, totalReturn: 10 },
      { balance: 100, totalReturn: 2 },
      { balance: 100, totalReturn: 6 },
    ];
    const average = weightedAverageTotalReturn(params({
      assets: [asset({ id: 'a1', quantity: 1, averagePrice: 300, totalReturn: 10 })],
      privatePensions: [pension({ balance: 100, totalReturn: 2 })],
      isaAccounts: [isa({ balance: 100, totalReturn: 6 })],
    }))!;

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
    const weightedBeta = accounts
      .reduce((s, a) => s + a.balance * shockBeta(a.totalReturn, average), 0) / totalBalance;

    expect(weightedBeta).toBeCloseTo(1, 10);
  });
});
