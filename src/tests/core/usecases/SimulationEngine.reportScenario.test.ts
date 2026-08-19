import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { InvestmentAsset, SimulationParams } from '@/core/entities/types';

/**
 * 2026-08-19 리포트의 실제 입력. 이 저장소가 총수익률 통일을 하게 만든 시나리오다.
 *
 * 예전 엔진에서는 이 조합이 90세 21.3억으로 "고갈 없음"이었다 — 표시된 7%·4%에
 * 배당이 통째로 더해져 SCHD 10%, JEPI 14.9%, 커버드콜 ISA 28.2%로 굴렀기 때문이다.
 * 표시값을 총수익률로 읽으면 기대수명 전에 고갈된다.
 *
 * 잔액을 정확히 고정하지 않고 «고갈이 일어난다»만 고정하는 이유: 세법 프로필이나
 * 지출 곡선 기본값이 바뀌면 잔액은 움직여도 되지만, 이 시나리오가 다시 "평생 유지"로
 * 돌아가는 것은 배당이 어딘가에서 또 더해지고 있다는 뜻이다.
 */
function etf(
  id: string, ticker: string, quantity: number, averagePrice: number,
  totalReturn: number, dividendYield: number, monthlyContribution: number,
): InvestmentAsset {
  return {
    id, type: 'etf', ticker, name: ticker,
    quantity, averagePrice, totalReturn, dividendYield,
    monthlyContribution, reinvestDividend: true,
    currency: 'KRW', assetMarket: 'US_ETF',
  };
}

function reportScenario(): SimulationParams {
  return {
    userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [
      etf('q', 'QQQ', 9.133318, 986_945, 7, 0.4, 456_250),
      etf('s', 'SCHD', 569.795937, 48_860, 7, 3, 0),
      etf('j', 'JEPI', 117.346339, 82_122, 7, 7.9, 0),
      etf('p', 'SPYM', 15.453288, 129_353, 7, 1, 304_167),
    ],
    isaAccounts: [{
      id: 'isa', type: 'general', investmentType: 'custom',
      balance: 3_772_550, monthlyContribution: 200_000,
      totalReturn: 7, dividendYield: 21.2, currency: 'KRW', maturityYears: 3,
    }],
    // 개시 나이는 NationalPension이 아니라 withdrawalPlan이 갖는다. 미지정이면
    // NATIONAL_PENSION_NORMAL_START_AGE(65세)이며, 리포트가 쓴 값과 같으므로 비워 둔다.
    nationalPension: { expectedMonthlyAmount: 2_000_000 },
    privatePensions: [
      { id: 'p1', type: 'irp', name: 'SOL 미국배당다우존스', balance: 33_868_515,
        monthlyContribution: 350_000, totalReturn: 4, investmentType: 'etf', dividendYield: 3.3, currency: 'KRW' },
      { id: 'p2', type: 'irp', name: 'SOL 미국배당미국채혼합50', balance: 7_040_880,
        monthlyContribution: 150_000, totalReturn: 4, investmentType: 'etf', dividendYield: 3.0, currency: 'KRW' },
      { id: 'p3', type: 'retirement', name: 'TIGER 미국배당다우존스타겟커버드콜2호', balance: 12_145_140,
        monthlyContribution: 500_000, totalReturn: 4, investmentType: 'etf', dividendYield: 10.0, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2.5,
    inflationMode: 'real',
    baseExchangeRate: 1414.4,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };
}

describe('2026-08-19 리포트 시나리오', () => {
  test('표시값을 총수익률로 읽으면 기대수명 전에 고갈된다', () => {
    const result = new SimulationEngine().run(reportScenario());

    expect(result.depletionAge).not.toBeNull();
    expect(result.depletionAge!).toBeLessThan(90);
  });

  // 연금은 분해하지 않으므로 배당률이 결과에 닿지 않는다. 예전에는 이 세 계좌의
  // 배당률(3.3/3.0/10.0)이 4%에 통째로 더해져 실효 7~14%로 굴렀고, 그것이 이
  // 시나리오를 "평생 유지"로 만든 가장 큰 몫이었다.
  test('사적연금의 배당률은 결과를 바꾸지 않는다', () => {
    const base = reportScenario();
    const withoutPensionDividends: SimulationParams = {
      ...base,
      privatePensions: base.privatePensions.map((p) => ({ ...p, dividendYield: 0 })),
    };

    expect(new SimulationEngine().run(withoutPensionDividends).depletionAge)
      .toBe(new SimulationEngine().run(base).depletionAge);
  });
});
