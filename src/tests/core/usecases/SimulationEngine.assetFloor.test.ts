import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **상속은 선호가 아니라 제약이다.**
//
// 예전에는 상속 전략이 채점(UtilityEngine)과 경고 문구에만 닿고 SimulationEngine에는
// 참조가 0건이었다. 그래서 「상속 최대화」와 「모두 사용」이 비트 단위로 같은 자산 곡선을
// 만들었다 — 사용자가 고른 것과 정반대의 결과를 보고 있었다.
//
// 제약이므로 하한선(assetFloor)으로 표현한다. 인출이 이 선 아래로 내려가지 못하게 막으면,
// 미충당분은 **기존 경로 그대로** actualMonthlySpending에서 깎여 소비가 줄어든다.
// "상속을 지키려면 생활비를 줄여야 한다"가 새 메커니즘 없이 consumption 원점수 하락으로
// 정직하게 나타난다.

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 85, targetMonthlySpending: 4000000 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'A', name: '자산', quantity: 6000, averagePrice: 100000,
        totalReturn: 3, dividendYield: 1, monthlyContribution: 0,
        reinvestDividend: false, currency: 'KRW',
      },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 200000000, monthlyContribution: 0, totalReturn: 3, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('SimulationEngine - assetFloor (상속 하한선)', () => {
  test('하한선을 세우면 기말자산이 그 아래로 내려가지 않는다', () => {
    const floor = 300000000;
    const withFloor = engine.run(params({ assetFloor: floor }));

    expect(withFloor.endingAssets).toBeGreaterThanOrEqual(floor);
  });

  test('하한선을 세우면 세우지 않은 계획보다 많이 남는다', () => {
    const floor = 300000000;
    const withoutFloor = engine.run(params());
    const withFloor = engine.run(params({ assetFloor: floor }));

    // 전제: 하한선이 없으면 이 시나리오는 실제로 하한선 아래로 내려간다.
    // 그렇지 않으면 아래 비교가 무의미하게 통과한다.
    expect(withoutFloor.endingAssets).toBeLessThan(floor);
    expect(withFloor.endingAssets).toBeGreaterThan(withoutFloor.endingAssets);
  });

  test('지킨 자산만큼 생활비가 깎인다 — 공짜로 남지 않는다', () => {
    const withoutFloor = engine.run(params());
    const withFloor = engine.run(params({ assetFloor: 300000000 }));

    const totalSpending = (r: typeof withFloor) => r.yearlyResults.reduce((s, y) => s + y.spending, 0);

    // 상속을 지키는 유일한 방법은 덜 쓰는 것이다. 소비가 그대로인데 자산만 늘었다면
    // 어딘가에서 돈이 생겨난 것이다(총자산 보존 위반).
    expect(totalSpending(withFloor)).toBeLessThan(totalSpending(withoutFloor));
  });

  test('하한선이 0이면 결과가 하한선 미지정과 완전히 같다', () => {
    // 「모두 사용」이 컴파일하는 값이다. 기존 동작을 한 톨도 바꾸면 안 된다.
    const none = engine.run(params());
    const zero = engine.run(params({ assetFloor: 0 }));

    expect(JSON.stringify(zero.yearlyResults)).toBe(JSON.stringify(none.yearlyResults));
  });

  test('자산보다 큰 하한선은 인출을 전부 막는다(생활비가 소득만큼으로 줄어든다)', () => {
    const huge = engine.run(params({ assetFloor: 999999999999 }));

    // 인출이 막혀도 배당·연금 소득으로 쓸 수 있는 만큼은 쓴다.
    expect(huge.yearlyResults.every((y) => y.spending >= 0)).toBe(true);
    expect(huge.endingAssets).toBeGreaterThan(0);
  });
});

describe('SimulationEngine - assetFloor와 max_sustainable', () => {
  // 예전에는 max_sustainable이 상속 목표를 완전히 무시했다 — "자산이 0이 되지 않는 최대
  // 생활비"만 찾았으므로, 상속 목표를 세운 사용자에게 그 목표를 정확히 파괴하는 생활비를
  // 권했다.
  //
  // 이 전략에서는 생활비 자체가 자유변수이므로, 하한선을 인출 경로에 걸면 이진탐색이
  // 깨진다(인출이 막힐 뿐 자산은 늘 하한선 위에 남아 "성공"으로 읽혀 탐색이 상한까지 올라간다).
  // 그래서 하한선은 **탐색의 성공 조건**으로 표현한다.
  const sustainableParams = (assetFloor?: number) =>
    params({ spendingStrategy: 'max_sustainable', ...(assetFloor === undefined ? {} : { assetFloor }) });

  test('하한선이 높을수록 지속가능 생활비가 낮아진다', () => {
    const noFloor = engine.run(sustainableParams());
    const withFloor = engine.run(sustainableParams(300000000));

    expect(withFloor.calculatedTargetSpending).toBeLessThan(noFloor.calculatedTargetSpending!);
    expect(withFloor.calculatedTargetSpending).toBeGreaterThan(0);
  });

  test('찾아낸 생활비로 살아도 하한선이 지켜진다', () => {
    const floor = 300000000;
    const withFloor = engine.run(sustainableParams(floor));

    expect(withFloor.endingAssets).toBeGreaterThanOrEqual(floor * 0.99);
  });

  test('하한선이 0이면 기존 탐색 결과와 같다', () => {
    const none = engine.run(sustainableParams());
    const zero = engine.run(sustainableParams(0));

    expect(zero.calculatedTargetSpending).toBe(none.calculatedTargetSpending);
  });

  test('목표 생활비를 못 쓴 해가 생기는 상한값을 지속 가능하다고 판정하지 않는다', () => {
    const result = engine.run(params({ spendingStrategy: 'max_sustainable' }));

    expect(result.calculatedTargetSpending).toBeLessThan(50000000);
    expect(result.yearlyResults.every((year) => year.unmetSpending === 0)).toBe(true);
  });
});
