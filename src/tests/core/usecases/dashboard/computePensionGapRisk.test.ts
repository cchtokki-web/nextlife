import { describe, test, expect } from 'vitest';
import { computePensionGapRisk } from '@/core/usecases/dashboard/computePensionGapRisk';
import { computeMonthlySpendingComposition } from '@/core/usecases/MonthlySpendingComposition';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    // 60세 은퇴 / 국민연금 65세 개시 — 리뷰가 지적한 60~64세 공백 구조 그대로.
    userProfile: { currentAge: 59, retirementAge: 60, expectancy: 90, targetMonthlySpending: 2500000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 600, averagePrice: 500000,
        annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 2000000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('computePensionGapRisk', () => {
  test('은퇴부터 국민연금 개시 전까지를 공백 구간으로 잡는다', () => {
    const p = params();
    const gap = computePensionGapRisk(p, engine.run(p));

    expect(gap).not.toBeNull();
    expect(gap!.fromAge).toBe(60);
    expect(gap!.toAge).toBe(64);
    expect(gap!.years).toBe(5);
  });

  test('Bridge 자금은 공백기 자산인출과 미충족 생활비의 합이다', () => {
    const p = params();
    const result = engine.run(p);
    const gap = computePensionGapRisk(p, result)!;

    const rows = computeMonthlySpendingComposition(result.yearlyResults, p, result)
      .filter((row) => row.age >= 60 && row.age < 65);
    const expectedWithdrawal = rows.reduce((sum, row) => sum + row.assetWithdrawal * 12, 0);
    const expectedShortfall = rows.reduce((sum, row) => sum + row.shortfall * 12, 0);

    expect(gap.assetWithdrawalAmount).toBe(Math.round(expectedWithdrawal));
    expect(gap.shortfallAmount).toBe(Math.round(expectedShortfall));
    expect(gap.bridgeAmount).toBe(Math.round(expectedWithdrawal + expectedShortfall));
    expect(gap.bridgeAmount).toBeGreaterThan(0);
  });

  test('월 평균 자산인출액을 함께 보고한다', () => {
    const p = params();
    const gap = computePensionGapRisk(p, engine.run(p))!;

    expect(gap.monthlyAssetWithdrawal).toBeGreaterThan(0);
    expect(gap.monthlyAssetWithdrawal).toBeCloseTo(gap.assetWithdrawalAmount / (gap.years * 12), -4);
  });

  test('일반자산 인출이 막혀도 생활비 부족분을 필요자금으로 보고한다', () => {
    const p = params({
      withdrawalPlan: { generalAssetWithdrawalStartAge: 65 },
      userProfile: { currentAge: 59, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
      privatePensions: [{
        id: 'p1', name: 'IRP', type: 'irp', balance: 100000000, monthlyContribution: 0,
        annualReturn: 5, dividendYield: 0, investmentType: 'etf', currency: 'KRW',
      }],
    });
    const gap = computePensionGapRisk(p, engine.run(p))!;

    expect(gap.shortfallYears).toBeGreaterThan(0);
    expect(gap.shortfallAmount).toBeGreaterThan(0);
    expect(gap.bridgeAmount).toBeGreaterThan(gap.assetWithdrawalAmount);
  });

  // 「공백」은 개시 시점이 뒤에 있을 때만 성립한다. 끝까지 없는 것은 공백이 아니라 부재이고,
  // 처방도 다르다(개시 시점 조정이 아니라 다른 소득원 확보).
  test('국민연금이 없으면 null이다', () => {
    const p = params({ nationalPension: { expectedMonthlyAmount: 0 } });

    expect(computePensionGapRisk(p, engine.run(p))).toBeNull();
  });

  test('은퇴와 동시에 연금이 시작되면 null이다', () => {
    const p = params({
      userProfile: { currentAge: 64, retirementAge: 65, expectancy: 90, targetMonthlySpending: 2500000 },
    });

    expect(computePensionGapRisk(p, engine.run(p))).toBeNull();
  });
});
