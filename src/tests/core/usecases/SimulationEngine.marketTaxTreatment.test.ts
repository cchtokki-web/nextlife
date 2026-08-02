import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { getMarketTaxTreatment } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { AssetMarket, SimulationParams } from '@/core/entities/types';

// 「기타 자산 (비과세 등)」을 고른 사용자는 배당세를 내지 않는데도 금융소득종합과세 문턱과
// 건보료 판정에는 걸리고 있었다. 배당세율 판정(TaxEngine)과 금융소득 합산 판정
// (SimulationEngine)이 서로 다른 곳에 있어 어긋난 결과다.

function paramsWithMarket(market: AssetMarket): SimulationParams {
  return {
    // 은퇴 후 곧바로 배당이 발생하도록 현재 나이 = 은퇴 나이로 둔다.
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 1000000 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'A', name: '고배당 자산',
        // 평가액 20억 × 배당 5% = 연 1억원. 초과분 8,000만원이면 비교과세에서도
        // 누진세액이 원천징수액을 넘어 추가 납부가 실제로 발생한다(더 낮은 금액에서는
        // 원천징수 공제로 0이 되어 "합산되었는가"를 종합과세로는 확인할 수 없다).
        quantity: 20000, averagePrice: 100000,
        annualGrowthRate: 0, dividendYield: 5,
        monthlyContribution: 0, reinvestDividend: false,
        currency: 'KRW', assetMarket: market,
      },
    ],
    isaAccounts: [],
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

describe('getMarketTaxTreatment', () => {
  const ctx = resolveTaxContext();

  test('US_ETF/KR_ETF는 배당세도 내고 금융소득에도 합산된다', () => {
    expect(getMarketTaxTreatment('US_ETF', 'USD', ctx)).toEqual({
      dividendTaxRate: 0.15,
      includedInFinancialIncome: true,
    });
    expect(getMarketTaxTreatment('KR_ETF', 'KRW', ctx)).toEqual({
      dividendTaxRate: 0.154,
      includedInFinancialIncome: true,
    });
  });

  test('OTHER는 배당세도 0이고 금융소득에도 합산되지 않는다', () => {
    expect(getMarketTaxTreatment('OTHER', 'KRW', ctx)).toEqual({
      dividendTaxRate: 0,
      includedInFinancialIncome: false,
    });
  });

  test('연금계좌(IRP/PENSION)의 수익은 금융소득이 아니다', () => {
    // 인출 시 연금소득으로 과세되므로 배당 단계에서 금융소득으로 세면 이중이다.
    expect(getMarketTaxTreatment('IRP', 'KRW', ctx).includedInFinancialIncome).toBe(false);
    expect(getMarketTaxTreatment('PENSION', 'KRW', ctx).includedInFinancialIncome).toBe(false);
  });

  test('market 미지정 시 통화로 폴백하며, 폴백 결과는 과세 대상이다', () => {
    expect(getMarketTaxTreatment(undefined, 'USD', ctx)).toEqual({
      dividendTaxRate: 0.15,
      includedInFinancialIncome: true,
    });
    expect(getMarketTaxTreatment(undefined, 'KRW', ctx)).toEqual({
      dividendTaxRate: 0.154,
      includedInFinancialIncome: true,
    });
  });
});

describe('SimulationEngine - 시장 구분에 따른 금융소득 합산', () => {
  test('KR_ETF는 배당세·종합과세·건보료·경고가 모두 발생한다', () => {
    const result = new SimulationEngine().run(paramsWithMarket('KR_ETF'));
    const firstYear = result.yearlyResults[0];

    expect(firstYear.dividendTaxPaid).toBeGreaterThan(0);
    expect(firstYear.hasTaxWarning).toBe(true);
    expect(firstYear.comprehensiveTaxPaid).toBeGreaterThan(0);
    expect(firstYear.healthInsurancePaid).toBeGreaterThan(0);
  });

  test('OTHER는 배당세뿐 아니라 종합과세·건보료·경고도 발생하지 않는다', () => {
    const result = new SimulationEngine().run(paramsWithMarket('OTHER'));
    const firstYear = result.yearlyResults[0];

    // 같은 규모의 배당이 발생하는데도 전부 0이어야 한다 — 화면이 "비과세"라고 약속했다.
    expect(firstYear.dividendIncome).toBeGreaterThan(0);
    expect(firstYear.dividendTaxPaid).toBe(0);
    expect(firstYear.hasTaxWarning).toBe(false);
    expect(firstYear.comprehensiveTaxPaid).toBe(0);
    expect(firstYear.healthInsurancePaid).toBe(0);
  });
});
