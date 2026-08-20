import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { calculateComprehensiveTaxAndHealthInsuranceKRW, calculatePensionIncomeTaxKRW } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { SimulationParams } from '@/core/entities/types';
import { sumTotalTaxesAndLevies } from '@/core/usecases/tax/annualTaxTotals';

// 단조성 property 테스트.
//
// 골든값은 "이 입력에서 이 답이 나온다"만 고정한다. 단조성은 **전 구간에 걸친 성질**을
// 고정하므로, 골든이 짚지 않은 지점에서 생긴 계단·역전을 잡는다.
//
// 두 번째 성질(목표 지출 ↑ → 고갈 ↓)은 단순한 상식이 아니라 이 엔진의 **아키텍처 전제**다.
// findMaxSustainableValue와 findMaxSustainable이 이 단조성을 30회 이진탐색으로 이용한다.
// 계단이 생기면 이진탐색이 잘못된 값에 수렴하고 추천 후보 비교도 불안정해진다.
//
// 이 테스트가 건강보험료에 피부양자 절벽(cliff)을 넣지 않기로 한 결정을 **코드가 강제**하게
// 만든다 — 누군가 나중에 계단을 도입하면 여기서 걸린다.

const ctx = resolveTaxContext();

describe('세금 단조성', () => {
  test('금융소득이 늘면 종합과세·건보료가 줄지 않는다', () => {
    const points = 100;
    const step = 2_000_000;

    let prevComprehensive = -1;
    let prevHealth = -1;
    const violations: string[] = [];

    for (let i = 0; i <= points; i++) {
      const income = i * step;
      const r = calculateComprehensiveTaxAndHealthInsuranceKRW(
        {
          annualRawFinancialIncomeKRW: income,
          annualPublicPensionIncomeKRW: 0,
          annualWithheldFinancialTaxKRW: income * 0.154,
        },
        ctx
      );

      if (r.comprehensiveTaxKRW < prevComprehensive - 1) {
        violations.push(`금융소득 ${income.toLocaleString()}에서 종합과세가 감소`);
      }
      if (r.healthInsuranceKRW < prevHealth - 1) {
        violations.push(`금융소득 ${income.toLocaleString()}에서 건보료가 감소`);
      }
      prevComprehensive = r.comprehensiveTaxKRW;
      prevHealth = r.healthInsuranceKRW;
    }

    expect(violations).toEqual([]);
  });

  test('연금소득이 늘면 연금소득세가 줄지 않고, 실효세율도 줄지 않는다', () => {
    // 실효세율 단조성이 특히 중요하다. 연금소득공제가 구간별로 다른 비율을 쓰므로,
    // 구간 경계에서 공제가 과하게 늘면 "더 받는데 실효세율이 떨어지는" 역전이 생길 수 있다.
    const violations: string[] = [];
    let prevTax = -1;
    let prevRate = -1;

    for (let annual = 1_000_000; annual <= 200_000_000; annual += 1_000_000) {
      const tax = calculatePensionIncomeTaxKRW(annual, ctx);
      const rate = tax / annual;

      if (tax < prevTax - 1) violations.push(`연금 ${annual.toLocaleString()}에서 세액 감소`);
      if (rate < prevRate - 1e-9) violations.push(`연금 ${annual.toLocaleString()}에서 실효세율 감소`);

      prevTax = tax;
      prevRate = rate;
    }

    expect(violations).toEqual([]);
  });
});

describe('시뮬레이션 단조성 (이진탐색의 전제)', () => {
  const baseParams: SimulationParams = {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 0 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'A', name: '해외 ETF',
        quantity: 10000, averagePrice: 100000,
        totalReturn: 4, dividendYield: 3,
        monthlyContribution: 0, reinvestDividend: false,
        currency: 'KRW', assetMarket: 'US_ETF',
        acquisitionCostBasis: 400000000,
      },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1500000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 300000000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  const runAtSpending = (monthly: number) =>
    new SimulationEngine().run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: monthly },
    });

  test('목표 지출이 늘면 기말자산이 줄고 고갈이 늦어지지 않는다', () => {
    const violations: string[] = [];
    let prevEnding = Infinity;
    let prevDepletion = Infinity; // null(고갈 없음)을 가장 늦은 것으로 본다

    for (let monthly = 1_000_000; monthly <= 20_000_000; monthly += 500_000) {
      const r = runAtSpending(monthly);
      const depletion = r.depletionAge ?? Infinity;

      // 기말자산은 0에서 바닥을 치므로 "줄지 않는다"가 아니라 "늘지 않는다"를 본다.
      if (r.endingAssets > prevEnding + 1) {
        violations.push(`월 ${(monthly / 10000).toLocaleString()}만원에서 기말자산이 증가`);
      }
      if (depletion > prevDepletion) {
        violations.push(`월 ${(monthly / 10000).toLocaleString()}만원에서 고갈이 늦어짐`);
      }

      prevEnding = r.endingAssets;
      prevDepletion = depletion;
    }

    expect(violations).toEqual([]);
  });

  test('목표 지출이 늘면 총 세부담이 계단 없이 변한다 (급격한 역전이 없다)', () => {
    // 세금은 인출 구성이 바뀌면서 오르내릴 수 있으므로 단조성을 요구하지 않는다.
    // 대신 인접 구간 사이의 급변(직전 대비 3배 이상)이 없는지 본다 — 절벽이 도입되면 걸린다.
    const violations: string[] = [];
    let prevTotal = 0;

    for (let monthly = 2_000_000; monthly <= 12_000_000; monthly += 250_000) {
      const total = sumTotalTaxesAndLevies(runAtSpending(monthly).yearlyResults);

      if (prevTotal > 1_000_000 && total > prevTotal * 3) {
        violations.push(
          `월 ${(monthly / 10000).toLocaleString()}만원에서 총 세부담이 급증 `
          + `(${Math.round(prevTotal).toLocaleString()} → ${Math.round(total).toLocaleString()})`
        );
      }
      prevTotal = total;
    }

    expect(violations).toEqual([]);
  });
});
