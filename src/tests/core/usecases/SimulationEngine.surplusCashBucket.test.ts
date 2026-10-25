import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { InvestmentAsset, SimulationParams } from '@/core/entities/types';

// 잉여 현금 버킷 회귀 가드.
//
// [[잉여 현금 버킷]] 계약 1문("첫 번째 투자자산에 재투자하지 않는다")을 지키는 테스트다.
// 예전에 이 계약을 지킨다고 주장했던 SimulationEngine.isaAssets.test.ts 49~53행의 총자산
// 항등식(stockAssets + pensionAssets + isaAssets + cashAssets === totalAssets)은
// SimulationEngine.ts 2127행의 totalAssetsDisplay 정의를 그대로 되풀이한 것이라 실패할 수
// 없다 — 잉여를 activeAssets[0]에 되돌려도 stockAssets가 그만큼 오르고 cashAssets가 그만큼
// 줄 뿐 합계는 바뀌지 않는다. 이 테스트는 대신 reinvestDividend 스위치가 실제로 결과를
// 바꾸는지를 직접 본다.
//
// 자산을 하나만 두고, 다른 소득(otherIncomes)이 목표 생활비를 정확히 채우도록 만든다. 그러면
// 배당을 재투자하지 않을 때(reinvestDividend: false) 배당 전액이 잉여가 되어 현금 버킷에
// 쌓이고, 재투자할 때(true)는 배당이 소득으로 잡히지 않아 잉여가 0으로 남는다. 잉여를 첫
// 번째 자산에 도로 넣는 옛 버그가 되살아나면 false 실행도 배당을 주식에 얹게 되어 두 실행이
// (docs/releases/2026-08-05-option-efficacy-and-tax-accuracy.md가 기록한 대로) 비트 단위로
// 같아진다 — 이 테스트는 그 상태에서 실패해야 한다.

const stock: InvestmentAsset = {
  id: 'a1', type: 'etf', ticker: 'A', name: '주식',
  quantity: 1000, averagePrice: 100000,
  totalReturn: 5, dividendYield: 4,
  monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
};

function params(reinvestDividend: boolean): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 1000000 },
    assets: [{ ...stock, reinvestDividend }],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [
      { id: 'rent', label: '임대소득', monthlyAmount: 1000000, currency: 'KRW' },
    ],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };
}

describe('SimulationEngine - 잉여 현금 버킷', () => {
  test('배당 재투자 스위치가 잉여 현금의 행선지를 실제로 바꾼다', () => {
    const noReinvest = new SimulationEngine().run(params(false));
    const reinvest = new SimulationEngine().run(params(true));

    const lastNo = noReinvest.yearlyResults[noReinvest.yearlyResults.length - 1];
    const lastYes = reinvest.yearlyResults[reinvest.yearlyResults.length - 1];

    // 재투자를 끄면 목표 생활비를 채우고 남은 배당이 잉여로 현금 버킷에 쌓인다.
    expect(lastNo.cashAssets).toBeGreaterThan(0);
    // 재투자를 켜면 그 배당은 소득으로 잡히지 않는다. otherIncomes가 목표 생활비를 정확히
    // 채우도록 설계했으므로 잉여가 남지 않는다.
    expect(lastYes.cashAssets).toBeCloseTo(0, 6);

    // 재투자를 끈 실행은 배당을 자산에 얹지 않으므로 재투자 실행보다 stockAssets가 낮아야
    // 한다. 옛 버그처럼 잉여를 첫 번째 자산에 도로 넣으면 이 차이가 사라진다.
    expect(lastNo.stockAssets).toBeLessThan(lastYes.stockAssets);

    // 두 실행의 연도별 결과 전체가 달라야 한다 — "배당 재투자 끄기"가 실제로 스위치로
    // 작동한다는 뜻이다. 옛 버그에서는 자산이 하나뿐이면 이 스위치가 켜지든 꺼지든 결과가
    // 비트 단위로 같았다.
    expect(JSON.stringify(noReinvest.yearlyResults)).not.toBe(JSON.stringify(reinvest.yearlyResults));
  });
});
