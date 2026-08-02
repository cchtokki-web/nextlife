import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { TAX_LAW_PROFILES } from '@/core/usecases/tax/taxLawProfiles';
import { IsaAccount, SimulationParams } from '@/core/entities/types';

// ISA 납입한도는 계좌가 아니라 사람에게 붙는다(1인 1계좌 원칙, 한도도 1인 기준).
// 예전에는 한도를 계좌마다 새로 계산해, 계좌를 2개 만드는 것만으로 연간 한도의 2배를
// 납입할 수 있었다.

const ANNUAL_LIMIT = TAX_LAW_PROFILES.current.isaAnnualLimitKRW; // 2,000만원

function isa(id: string, monthlyContribution: number): IsaAccount {
  return {
    id, type: 'general', balance: 0, monthlyContribution,
    annualReturn: 0, dividendYield: 0, currency: 'KRW', maturityYears: 100,
  };
}

// 은퇴 전 1년만 돌려 그 해의 납입액을 본다. 수익률·물가를 0으로 두어 잔액 증가분이
// 납입액과 정확히 같아지게 한다(만기는 오지 않도록 maturityYears를 크게 잡았다).
function paramsWith(isaAccounts: IsaAccount[]): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 51, targetMonthlySpending: 0 },
    assets: [],
    isaAccounts,
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };
}

// 이 픽스처에서 ISA 잔액은 totalAssets에만 잡힌다(주식·연금 0).
function firstYearIsaBalance(params: SimulationParams): number {
  const result = new SimulationEngine().run(params);
  return result.yearlyResults[0].totalAssets;
}

describe('SimulationEngine - ISA 연간 납입한도', () => {
  test('계좌 하나가 한도를 넘겨 납입하려 하면 한도까지만 들어간다', () => {
    // 월 300만원 × 12 = 3,600만원을 넣으려 해도 한도는 2,000만원이다.
    const balance = firstYearIsaBalance(paramsWith([isa('isa-1', 3000000)]));

    expect(balance).toBeCloseTo(ANNUAL_LIMIT, 0);
  });

  test('계좌를 나눠도 합산 한도를 넘지 못한다', () => {
    // 각 계좌가 월 150만원(합 월 300만원). 계좌별 한도라면 두 계좌 모두 월 한도
    // (약 167만원) 이하라 전액 들어가 3,600만원이 된다.
    const balance = firstYearIsaBalance(paramsWith([
      isa('isa-1', 1500000),
      isa('isa-2', 1500000),
    ]));

    expect(balance).toBeCloseTo(ANNUAL_LIMIT, 0);
  });

  test('한도에 못 미치는 납입은 그대로 들어간다', () => {
    // 월 50만원 × 2계좌 × 12 = 1,200만원 < 2,000만원
    const balance = firstYearIsaBalance(paramsWith([
      isa('isa-1', 500000),
      isa('isa-2', 500000),
    ]));

    expect(balance).toBeCloseTo(12000000, 0);
  });

  test('앞 계좌가 한도를 다 쓰면 뒤 계좌는 납입하지 못한다', () => {
    // 앞 계좌가 혼자 한도를 채우므로 뒤 계좌 몫은 남지 않는다.
    const result = new SimulationEngine().run(paramsWith([
      isa('isa-1', 3000000),
      isa('isa-2', 3000000),
    ]));

    expect(result.yearlyResults[0].totalAssets).toBeCloseTo(ANNUAL_LIMIT, 0);
  });
});
