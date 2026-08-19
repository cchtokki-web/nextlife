import { describe, test, expect } from 'vitest';
import { calculateCapitalGainsTaxKRW } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { AssetMarket, SimulationParams } from '@/core/entities/types';

// 해외주식·ETF 양도소득세 골든 테스트.
//
// 세법: 연간 손익통산 후 기본공제 250만원을 빼고 22%(지방소득세 포함)를 곱한다.
// 국내상장 주식·국내주식형 ETF의 매매차익은 대주주가 아닌 개인에게 비과세다.
//
// 이 앱은 예전에 매도차익 과세가 통째로 없었다. 은퇴 후 생활비를 자산 매도로 충당하는
// 계획에서 잔여자산·고갈나이가 낙관 방향으로 계통 편향돼 있었다.

const ctx = resolveTaxContext();

describe('calculateCapitalGainsTaxKRW', () => {
  test('차익이 기본공제(250만원) 이하이면 0', () => {
    expect(calculateCapitalGainsTaxKRW(2_000_000, ctx)).toBe(0);
    expect(calculateCapitalGainsTaxKRW(2_500_000, ctx)).toBe(0);
  });

  test('차익 2,000만원 → (2,000만 − 250만) × 22% = 385만원', () => {
    expect(calculateCapitalGainsTaxKRW(20_000_000, ctx)).toBeCloseTo(3_850_000, -2);
  });

  test('손실(음수 차익)이면 0이고 이월되지 않는다', () => {
    // 한국 세법상 해외주식 양도차손은 연도 내 통산만 되고 이월공제가 없다.
    expect(calculateCapitalGainsTaxKRW(-5_000_000, ctx)).toBe(0);
  });

  test('스위치를 끄면 0', () => {
    const off = resolveTaxContext({ enableCapitalGainsTax: false });
    expect(calculateCapitalGainsTaxKRW(20_000_000, off)).toBe(0);
  });

  test('사용자가 세율을 지정하면 그 값을 쓴다', () => {
    const custom = resolveTaxContext({ capitalGainsTaxRate: 10 });
    expect(calculateCapitalGainsTaxKRW(20_000_000, custom)).toBeCloseTo(17_500_000 * 0.1, -2);
  });
});

// 엔진 통합: 원가 회계가 매도 경로에 실제로 붙었는지, 1년 이연이 동작하는지 확인한다.
function sellingScenario(market: AssetMarket, acquisitionCostBasis?: number): SimulationParams {
  return {
    // 은퇴 직후부터 생활비를 자산 매도로 충당한다. 소득원이 없어 전액 매도로 나간다.
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 64, targetMonthlySpending: 5_000_000 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'A', name: '해외 ETF',
        // 평가액 10억. 성장·배당 0으로 두어 매도만 일어나게 한다.
        quantity: 10000, averagePrice: 100000,
        totalReturn: 0, dividendYield: 0,
        monthlyContribution: 0, reinvestDividend: false,
        currency: 'KRW', assetMarket: market,
        ...(acquisitionCostBasis !== undefined ? { acquisitionCostBasis } : {}),
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

describe('SimulationEngine - 양도소득세 통합', () => {
  test('취득원가 미입력이면 미실현이익이 0이라 매도해도 양도세가 없다', () => {
    // acquisitionCostBasis 미지정 → 원가 = 현재 평가액. 성장률도 0이라 차익이 생길 여지가 없다.
    // "확정되지 않은 숫자를 지어내지 않는다"는 선택의 결과이며, 폼에 그 뜻을 명시한다.
    const result = new SimulationEngine().run(sellingScenario('US_ETF'));

    expect(result.yearlyResults.every((y) => y.capitalGainsTaxPaid === 0)).toBe(true);
  });

  test('취득원가가 평가액의 절반이면 매도액의 절반이 차익으로 실현된다', () => {
    // 원가 5억 / 평가 10억 → 원가비율 0.5.
    // 세후 생활비 6,000만원을 확보해야 하므로 매도액은 6,000만원보다 크다.
    // 원가비율 0.5일 때 G - (0.5G - 250만원) × 22% = 6,000만원을 역산한다.
    // 세액은 매도대금 중 유보했다가 **다음 해**에 납부한다.
    const result = new SimulationEngine().run(sellingScenario('US_ETF', 500_000_000));

    const firstYear = result.yearlyResults[0];
    const secondYear = result.yearlyResults[1];

    // 1년차에는 아직 내지 않는다(실제 확정신고가 다음 해 5월이다).
    expect(firstYear.capitalGainsTaxPaid).toBe(0);
    const expectedGrossWithdrawal = (60_000_000 - 550_000) / 0.89;
    expect(secondYear.capitalGainsTaxPaid).toBeCloseTo(
      expectedGrossWithdrawal - 60_000_000,
      -3
    );
  });

  test('국내 ETF는 같은 차익이 나도 양도세가 붙지 않는다', () => {
    const overseas = new SimulationEngine().run(sellingScenario('US_ETF', 500_000_000));
    const domestic = new SimulationEngine().run(sellingScenario('KR_ETF', 500_000_000));

    const totalTax = (r: typeof overseas) =>
      r.yearlyResults.reduce((s, y) => s + y.capitalGainsTaxPaid, 0);

    expect(totalTax(overseas)).toBeGreaterThan(0);
    expect(totalTax(domestic)).toBe(0);
    // 세금을 더 내므로 기말자산도 더 적다 — 이것이 예전 모델의 낙관 편향이었다.
    expect(overseas.endingAssets).toBeLessThan(domestic.endingAssets);
  });

  test('생활비 매도와 다른 세금 납부 매도의 차익은 연간 기본공제를 한 번만 적용한다', () => {
    const initialWithdrawalAsset = 1_000_000_000;
    const params: SimulationParams = {
      ...sellingScenario('US_ETF', initialWithdrawalAsset / 2),
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 62,
        targetMonthlySpending: 20_000_000,
      },
      assets: [
        {
          ...sellingScenario('US_ETF', initialWithdrawalAsset / 2).assets[0],
          id: 'withdrawal-asset',
        },
        {
          id: 'dividend-asset', type: 'etf', ticker: 'DIV', name: '국내 고배당 ETF',
          quantity: 20_000, averagePrice: 100_000,
          totalReturn: 5, dividendYield: 5,
          monthlyContribution: 0, reinvestDividend: false,
          currency: 'KRW', assetMarket: 'KR_ETF',
        },
      ],
    };

    const result = new SimulationEngine().run(params);
    const firstYear = result.yearlyResults[0];
    const secondYear = result.yearlyResults[1];

    // 첫 번째 자산이 생활비와 종합과세·건보료 납부에 모두 먼저 매도된다. 성장률이 0이고
    // 원가비율이 0.5로 유지되므로 평가액 감소분의 절반이 그 해 전체 실현차익이다.
    const firstYearGrossSales = initialWithdrawalAsset - firstYear.stockAssets + 2_000_000_000;
    const expectedTax = calculateCapitalGainsTaxKRW(firstYearGrossSales * 0.5, ctx);

    expect(firstYear.comprehensiveTaxPaid + firstYear.healthInsurancePaid).toBeGreaterThan(0);
    expect(secondYear.capitalGainsTaxPaid).toBeCloseTo(expectedTax, -2);
  });

  test('마지막 해에 실현된 차익도 과세된다 (이연분이 사라지지 않는다)', () => {
    // 이연만 하고 마지막 해 정산을 빼먹으면 마지막 해 차익이 영원히 과세되지 않는다.
    const result = new SimulationEngine().run(sellingScenario('US_ETF', 500_000_000));
    const lastYear = result.yearlyResults[result.yearlyResults.length - 1];

    // 마지막 해에는 이월분 + 당해 실현분을 함께 내므로, 중간 해보다 세액이 크다.
    const midYear = result.yearlyResults[1];
    expect(lastYear.capitalGainsTaxPaid).toBeGreaterThan(midYear.capitalGainsTaxPaid);
  });

  test('스위치를 끄면 예전 동작(양도세 0)으로 돌아간다', () => {
    const params = sellingScenario('US_ETF', 500_000_000);
    const withTax = new SimulationEngine().run(params);
    const withoutTax = new SimulationEngine().run({
      ...params,
      taxSettings: { ...params.taxSettings, enableCapitalGainsTax: false } as SimulationParams['taxSettings'],
    });

    expect(withoutTax.yearlyResults.every((y) => y.capitalGainsTaxPaid === 0)).toBe(true);
    expect(withoutTax.endingAssets).toBeGreaterThan(withTax.endingAssets);
  });
});
