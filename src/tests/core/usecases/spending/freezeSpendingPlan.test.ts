import { describe, test, expect } from 'vitest';
import { freezeSpendingPlan, runFrozenPlan } from '@/core/usecases/spending/freezeSpendingPlan';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 리포트가 문제를 드러낸 시나리오를 그대로 쓴다: 51세 / 60세 은퇴 / 90세 기대수명 /
// 목표 월 350만원 / 평생 소비 최적화. 이 계획은 기준 수익률에서 90세에 딱 소진된다.
function maxSustainableParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
    assets: [
      {
        id: 'a1', type: 'etf', ticker: 'QQQ', name: 'QQQ', quantity: 100, averagePrice: 1000000,
        annualGrowthRate: 7, dividendYield: 1.5, monthlyContribution: 1000000,
        reinvestDividend: true, currency: 'KRW',
      },
    ],
    nationalPension: { expectedMonthlyAmount: 2000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 60000000, monthlyContribution: 300000, annualReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2.5,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingStrategy: 'max_sustainable',
    ...overrides,
  };
}

describe('freezeSpendingPlan', () => {
  test('max_sustainable이 아닌 전략은 params를 그대로 통과시킨다', () => {
    const engine = new SimulationEngine();
    const params = maxSustainableParams({ spendingStrategy: 'target' });

    const plan = freezeSpendingPlan(params, engine);

    expect(plan.params).toBe(params); // 참조까지 동일 — 새 객체를 만들지 않는다
    expect(plan.monthlyTargetSpending).toBe(3500000);
  });

  test('spendingStrategy 미지정도 통과시킨다', () => {
    const engine = new SimulationEngine();
    const params = maxSustainableParams();
    delete params.spendingStrategy;

    expect(freezeSpendingPlan(params, engine).params).toBe(params);
  });

  test('max_sustainable은 이진탐색 결과를 목표 생활비로 못박는다', () => {
    const engine = new SimulationEngine();
    const params = maxSustainableParams();
    const sustainable = engine.run(params).calculatedTargetSpending!;

    const plan = freezeSpendingPlan(params, engine);

    expect(sustainable).toBeGreaterThan(0);
    expect(plan.monthlyTargetSpending).toBe(sustainable);
    expect(plan.params.userProfile.targetMonthlySpending).toBe(sustainable);
  });

  // **전략 문자열을 'target'으로 바꾸면 안 된다.**
  //
  // 엔진은 사적연금 정상 인출액을 전략에 따라 다르게 정한다(SimulationEngine.ts:882):
  // max_sustainable/dividend_only는 그 달의 운용수익만큼(max(0, growth)), target은
  // 잔액 ÷ 잔여개월. 전략을 바꾸면 생활비는 같아도 연금이 녹는 속도가 달라져
  // 고정된 계획이 기준 시나리오와 다른 경로를 돈다.
  test('전략 문자열은 max_sustainable 그대로 둔다', () => {
    const engine = new SimulationEngine();

    const plan = freezeSpendingPlan(maxSustainableParams(), engine);

    expect(plan.params.spendingStrategy).toBe('max_sustainable');
  });

  // findMaxSustainable은 assetFloor를 떼어 낸 시행(sustainabilityTrialParams)의 결과를
  // 기준 시나리오로 돌려준다. 고정 계획에 하한선이 남아 있으면 인출이 막혀 다른 경로가 된다.
  test('상속 하한선(assetFloor)은 떼어 낸다', () => {
    const engine = new SimulationEngine();
    const params = maxSustainableParams({ assetFloor: 100000000 });

    const plan = freezeSpendingPlan(params, engine);

    expect('assetFloor' in plan.params).toBe(false);
    expect(params.assetFloor).toBe(100000000); // 입력은 건드리지 않는다
  });

  // 이 모듈이 존재하는 이유 그 자체. 고정 계획을 다시 돌린 결과가 기준 시나리오와
  // 연도별로 일치해야, 민감도·몬테카를로가 "같은 계획에 변수 하나만 바꾼 것"이 된다.
  describe('고정 계획 재실행 = 기준 시나리오', () => {
    test.each([
      ['하한선 없음', undefined],
      ['하한선 있음', 100000000],
    ])('%s', (_label, assetFloor) => {
      const engine = new SimulationEngine();
      const params = maxSustainableParams(assetFloor === undefined ? {} : { assetFloor });

      const baseline = engine.run(params);
      const frozen = runFrozenPlan(engine, freezeSpendingPlan(params, engine));

      expect(frozen.yearlyResults).toHaveLength(baseline.yearlyResults.length);
      expect(frozen.yearlyResults.map((y) => y.totalAssets))
        .toEqual(baseline.yearlyResults.map((y) => y.totalAssets));
      expect(frozen.yearlyResults.map((y) => y.spending))
        .toEqual(baseline.yearlyResults.map((y) => y.spending));
      expect(frozen.depletionAge).toBe(baseline.depletionAge);
      expect(frozen.endingAssets).toBe(baseline.endingAssets);
    });
  });

  test('runFrozenPlan은 수익률 경로를 그대로 넘긴다', () => {
    const engine = new SimulationEngine();
    const plan = freezeSpendingPlan(maxSustainableParams(), engine);

    const flat = runFrozenPlan(engine, plan);
    const crashed = runFrozenPlan(engine, plan, new Array(40).fill(-10));

    expect(crashed.endingAssets).toBeLessThan(flat.endingAssets);
  });
});
