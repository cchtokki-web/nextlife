import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { computeSustainableSpendingAdvice } from '@/core/usecases/dashboard/computeSustainableSpendingAdvice';
import { SimulationParams } from '@/core/entities/types';

// 지속 가능한 생활비가 HARD 바닥보다 «낮은» 계획.
//
// 수익률·물가를 0으로 두어 지속가능액이 (자산 ÷ 은퇴 기간)으로 결정되게 한다. 취득원가를
// 평가액과 같게 두어 양도세도 0이다 — 탐색이 무엇을 재는지만 남기려는 구성이다.
function floorAboveSustainable(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 2_500_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 109_000_000,
      totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
    }],
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    taxSettings: {},
    spendingStrategy: 'max_sustainable',
    hardSpendingFloor: 2_500_000,
    ...over,
  } as unknown as SimulationParams;
}

// 저율과세 한도가 인출을 막는 연금 계획. 이 계획의 «지속 가능한 생활비»는 두 개다:
//   - 선호(한도)를 지키면    월 1,181,250원
//   - 선호를 깨면            월 3,446,597원
// 바닥을 시행에 건 채로 탐색하면 이 둘 중 어느 것도 나오지 않는다. 1단계가 바닥까지는
// 한도를 깨고 그 위로는 지키므로, 시행 ≤ 바닥은 전부 성공하고 시행 > 바닥은 전부 실패해
// 탐색이 **바닥을 그대로 되돌려 준다**. 사용자가 넣은 값을 계산 결과라고 내놓는 셈이다.
function pensionCapped(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    taxSettings: { limitPrivatePensionToTaxLimit: true },
    spendingStrategy: 'max_sustainable',
    ...over,
  } as unknown as SimulationParams;
}

describe('생활비 자체를 탐색하는 계산에서는 바닥을 뗀다', () => {
  test('탐색이 바닥을 되돌려 주지 않는다', () => {
    const engine = new SimulationEngine();
    const withFloor = engine.run(
      pensionCapped({ hardSpendingFloor: 2_500_000 } as Partial<SimulationParams>)
    );
    const withoutFloor = engine.run(pensionCapped());

    // 바닥(250만원)은 두 실제 용량 사이에 있다. 예전에는 탐색이 정확히 바닥으로 수렴해
    // 「월 250만원까지 쓸 수 있습니다」라고 답했지만, 그 값은 측정된 적이 없는 입력값이다.
    expect(withFloor.calculatedTargetSpending).not.toBeCloseTo(2_500_000, -3);
    // 바닥은 탐색에 아무 영향도 주지 않는다.
    expect(withFloor.calculatedTargetSpending).toBe(withoutFloor.calculatedTargetSpending);
  });

  test('바닥의 크기가 탐색 결과를 흔들지 않는다', () => {
    const engine = new SimulationEngine();
    const values = [undefined, 1_000_000, 2_500_000, 10_000_000].map(
      (floor) => engine.run(pensionCapped(
        (floor === undefined ? {} : { hardSpendingFloor: floor }) as Partial<SimulationParams>
      )).calculatedTargetSpending
    );

    // 예전에는 바닥마다 다른 값이 나왔다(1,181,250 / 1,181,250 / 2,499,999 / 3,446,596).
    expect(new Set(values).size).toBe(1);
  });

  test('바닥은 이진탐색을 붕괴시키지 않는다', () => {
    const result = new SimulationEngine().run(floorAboveSustainable());

    // 탐색이 0으로 붕괴하지 않는다. 바닥을 건 채로 돌면 모든 시행이 바닥까지 인출해
    // 똑같이 고갈되므로 어떤 생활비도 성공 판정을 받지 못한다.
    expect(result.calculatedTargetSpending).toBeGreaterThan(0);
    // 그리고 탐색은 «시험한 금액»을 잰다 — 바닥이 아니다.
    expect(result.calculatedTargetSpending!).toBeLessThan(2_500_000);
  });

  test('바닥이 없을 때와 같은 값을 낸다 — 바닥은 탐색에 아무 영향도 주지 않는다', () => {
    const withFloor = new SimulationEngine().run(floorAboveSustainable());
    const withoutFloor = new SimulationEngine().run(
      floorAboveSustainable({ hardSpendingFloor: undefined } as Partial<SimulationParams>)
    );

    expect(withFloor.calculatedTargetSpending).toBe(withoutFloor.calculatedTargetSpending);
  });

  test("'target' 전략의 부수 탐색도 같은 값을 낸다", () => {
    const withFloor = new SimulationEngine().run(
      floorAboveSustainable({ spendingStrategy: 'target' })
    );
    const withoutFloor = new SimulationEngine().run(
      floorAboveSustainable({ spendingStrategy: 'target', hardSpendingFloor: undefined } as Partial<SimulationParams>)
    );

    expect(withFloor.calculatedTargetSpending).toBeGreaterThan(0);
    expect(withFloor.calculatedTargetSpending).toBe(withoutFloor.calculatedTargetSpending);
  });
});

describe('바닥 미달은 탐색 실패가 아니라 사후 비교로 보고된다', () => {
  test('지속가능 227만원 / 바닥 250만원 → 월 23만원 부족', () => {
    const advice = computeSustainableSpendingAdvice(
      'max_sustainable', 2_500_000, 2_270_000, 2_500_000
    );

    expect(advice).toEqual({
      kind: 'below_hard_floor',
      sustainableMonthly: 2_270_000,
      hardFloorMonthly: 2_500_000,
      difference: 230_000,
    });
  });

  test('탐색이 실제로 낸 값으로도 미달이 보고된다', () => {
    const params = floorAboveSustainable();
    const result = new SimulationEngine().run(params);
    const advice = computeSustainableSpendingAdvice(
      params.spendingStrategy,
      params.userProfile.targetMonthlySpending,
      result.calculatedTargetSpending,
      params.hardSpendingFloor
    );

    expect(advice?.kind).toBe('below_hard_floor');
    expect(advice!.difference).toBeGreaterThan(0);
    expect(advice!.difference)
      .toBeCloseTo(2_500_000 - result.calculatedTargetSpending!, 6);
  });

  test('바닥이 없으면 종전 판정 그대로다', () => {
    expect(computeSustainableSpendingAdvice('max_sustainable', 2_500_000, 2_270_000)).toBeNull();
    expect(computeSustainableSpendingAdvice('target', 2_500_000, 2_270_000, undefined)?.kind)
      .toBe('overspending');
  });

  test('지속가능액이 바닥 이상이면 바닥 판정은 서지 않는다', () => {
    expect(computeSustainableSpendingAdvice('max_sustainable', 2_500_000, 2_500_000, 2_500_000))
      .toBeNull();
    expect(computeSustainableSpendingAdvice('target', 2_500_000, 3_000_000, 2_500_000)?.kind)
      .toBe('can_spend_more');
  });

  test('탐색이 0으로 수렴해도 바닥 미달은 침묵하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('target', 2_500_000, 0, 2_500_000)).toEqual({
      kind: 'below_hard_floor',
      sustainableMonthly: 0,
      hardFloorMonthly: 2_500_000,
      difference: 2_500_000,
    });
  });
});
