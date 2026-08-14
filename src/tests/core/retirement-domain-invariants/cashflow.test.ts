import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  calculateFundingGap,
  completeCashFlow,
} from '@/core/usecases/cashflow/CashFlowPipeline';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / cash flow', () => {
  test('가용 자산이 목표 생활비 차액보다 충분하면 shortfall이 발생하지 않는다', () => {
    const result = new SimulationEngine().run(retirementParams({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 65,
        targetMonthlySpending: 5_000_000,
      },
    }));

    expect(result.yearlyResults.every((year) => year.shortfall === 0)).toBe(true);
    expect(result.yearlyResults.every((year) => year.unmetSpending === 0)).toBe(true);
  });

  test('Actual Spending 범위는 세후 소득 + 세후 인출로 목표액까지이며 의료비도 목표액에 포함한다', () => {
    const funding = calculateFundingGap(5_000_000, {
      employment: 0,
      nationalPension: 1_000_000,
      privatePension: 500_000,
      dividend: 250_000,
      other: 250_000,
    });
    const completed = completeCashFlow(funding, 3_000_000);

    expect(completed.availableIncome).toBe(2_000_000);
    expect(completed.actualSpending).toBe(
      completed.availableIncome + completed.withdrawalNetCash
    );
    expect(completed.actualSpending).toBe(completed.targetSpending);
    expect(completed.shortfall).toBe(0);
  });

  test('매년 기초자산 + 투자수익 + 외부유입 - 지출 - 세금 = 기말자산이다', () => {
    const params = retirementParams({
      userProfile: {
        currentAge: 58,
        retirementAge: 60,
        expectancy: 64,
        targetMonthlySpending: 5_000_000,
      },
      assets: [{
        ...retirementParams().assets[0],
        quantity: 5_000,
        annualGrowthRate: 4,
        dividendYield: 2,
        monthlyContribution: 100_000,
      }],
      nationalPension: { expectedMonthlyAmount: 1_000_000 },
      otherIncomes: [{
        id: 'rent',
        label: '임대소득',
        monthlyAmount: 500_000,
        currency: 'KRW',
      }],
    });
    const result = new SimulationEngine().run(params);

    for (const year of result.yearlyResults) {
      // 사적연금 인출은 기존 총자산 안에서 소비 현금으로 이동한 것이므로 외부유입이 아니다.
      const externalPreTaxIncome = year.preTaxTotalIncome - year.privatePensionWithdrawal;
      const newContributions = year.age < params.userProfile.retirementAge
        ? params.assets.reduce((sum, asset) => sum + asset.monthlyContribution * 12, 0)
        : 0;
      const expectedClosing = year.openingAssets
        + year.investmentReturn
        + newContributions
        + externalPreTaxIncome
        - year.actualSpending
        - year.taxes;

      expect(year.closingAssets).toBeCloseTo(expectedClosing, 0);
      expect(year.totalAssets).toBe(year.closingAssets);
    }
  });
});
