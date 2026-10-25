import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **쓰고 남은 현금의 수익률.**
//
// 현금 버킷을 도입할 때 수익률을 0%로 두었다. 임의의 이율을 지어내지 않는다는 원칙에
// 따른 선택이었지만, 실제로는 예금 이자 정도는 붙으므로 보수적이다. 그래서 값을 사용자에게
// 넘긴다 — 이 저장소가 다른 가정(물가·수익률·환율)을 다루는 방식과 같다.
//
// **기본값 0은 절대 바뀌면 안 된다.** 저장된 모든 시나리오가 그 값으로 계산돼 있고,
// 기본값을 올리는 순간 사용자가 아무것도 건드리지 않았는데 숫자가 달라진다.

const engine = new SimulationEngine();

// 소득이 목표 생활비를 크게 웃도는 시나리오. 매달 잉여가 남아 현금이 쌓인다.
//
// 잉여를 사적연금 인출이 아니라 고정 기타소득으로 만든다. 연금은 물가를 반영한 실질
// 수익률로 굴러가므로 물가를 올리면 잔액이 줄어 잉여 자체가 사라진다 — 그러면 "현금
// 이자율" 테스트가 연금 소진 동작에 가려진다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 1000000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [
      { id: 'rent', label: '임대소득', monthlyAmount: 3000000, currency: 'KRW' },
    ],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('SimulationEngine - cashYieldRate', () => {
  test('미지정과 0%는 결과가 비트 단위로 같다', () => {
    // 저장된 모든 시나리오가 이 경로를 탄다. 여기가 어긋나면 아무것도 건드리지 않은
    // 사용자의 숫자가 달라진다.
    const unset = engine.run(params());
    const zero = engine.run(params({ cashYieldRate: 0 }));

    expect(JSON.stringify(zero.yearlyResults)).toBe(JSON.stringify(unset.yearlyResults));
  });

  test('전제 확인: 이 시나리오는 실제로 현금이 쌓인다', () => {
    // 현금이 0이면 아래 테스트들이 무의미하게 통과한다.
    const result = engine.run(params());
    const last = result.yearlyResults[result.yearlyResults.length - 1];

    expect(last.cashAssets).toBeGreaterThan(0);
  });

  test('수익률을 올리면 현금이 더 많이 쌓인다', () => {
    const flat = engine.run(params());
    const yielding = engine.run(params({ cashYieldRate: 3 }));

    const cashOf = (r: typeof flat) => r.yearlyResults[r.yearlyResults.length - 1].cashAssets;

    expect(cashOf(yielding)).toBeGreaterThan(cashOf(flat));
    expect(yielding.endingAssets).toBeGreaterThan(flat.endingAssets);
  });

  // 아래 두 테스트는 물가를 3%로 **고정하고 이율만** 바꾼다. 물가가 다른 두 실행을 비교하면
  // 현금 이자 말고도 여러 값이 함께 움직여, 무엇 때문에 차이가 났는지 알 수 없다.
  const cashAt = (cashYieldRate: number, inflationMode: 'real' | 'nominal') => {
    const r = engine.run(params({ inflationMode, inflationRate: 3, cashYieldRate }));
    return r.yearlyResults[r.yearlyResults.length - 1].cashAssets;
  };

  test('실질 기준에서 이율은 물가를 기준으로 갈린다', () => {
    // 물가 3% 기준: 이율 0%는 실질 −3%(구매력 손실), 3%는 실질 0%, 6%는 실질 +3%.
    // 다른 자산과 같은 규칙이다. 실질 모드에서 명목 이율을 그대로 붙이면 현금만 물가를
    // 공짜로 이기는 셈이 되어, 같은 화면에 놓인 주식·연금과 기준이 어긋난다.
    expect(cashAt(0, 'real')).toBeLessThan(cashAt(3, 'real'));
    expect(cashAt(3, 'real')).toBeLessThan(cashAt(6, 'real'));
  });

  test('실질 기준에서 물가에 못 미치는 이율은 구매력을 깎는다', () => {
    // 현금을 쌓아 두는 것의 실제 대가다. 이 방향이 표현되지 않으면 "현금도 알아서 지켜진다"는
    // 잘못된 안심을 준다.
    //
    // 물가 3%에서 이율 3%(실질 0%)를 기준선으로 삼는다. 이율 1%는 실질 −2%이므로
    // 잉여를 그대로 쌓아 둔 것보다 적게 남아야 한다.
    expect(cashAt(1, 'real')).toBeLessThan(cashAt(3, 'real'));
  });

  test('명목 기준에서는 입력한 이율이 그대로 붙는다', () => {
    // 명목 모드에서는 물가를 빼지 않는다 — 0%면 이자 없이 그대로다.
    expect(cashAt(3, 'nominal')).toBeGreaterThan(cashAt(0, 'nominal'));
  });

  test('같은 이율이라도 실질 기준이 명목 기준보다 적게 남는다', () => {
    // 두 모드의 차이가 정확히 물가만큼이라는 사실을 방향으로 고정한다.
    expect(cashAt(3, 'real')).toBeLessThan(cashAt(3, 'nominal'));
  });

  test('총자산 보존은 유지된다 — 현금 이자가 어디선가 새지 않는다', () => {
    const result = engine.run(params({ cashYieldRate: 3 }));

    for (const year of result.yearlyResults) {
      expect(year.stockAssets + year.pensionAssets + year.isaAssets + year.cashAssets)
        .toBeCloseTo(year.totalAssets, 6);
    }
  });
});
