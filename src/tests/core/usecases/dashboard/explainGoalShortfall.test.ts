import { describe, test, expect } from 'vitest';
import { explainGoalShortfall } from '@/core/usecases/dashboard/explainGoalShortfall';
import type { GoalFailureBreakdown } from '@/core/entities/montecarlo';
import type { SimulationParams } from '@/core/entities/types';

const formatValue = (value: number) => `${Math.round(value / 10_000).toLocaleString()}만원`;

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function breakdown(overrides: Partial<GoalFailureBreakdown> = {}): GoalFailureBreakdown {
  const merged = {
    spendingShortfall: 0,
    assetDepletion: 0,
    terminalShortfall: 0,
    medianFirstShortfallAge: null,
    terminalAssetGoal: 0,
    ...overrides,
  };
  // 관측 고갈 수를 따로 주지 않으면 「자산 고갈 방지」를 고른 계획으로 본다(관측 = 판정).
  // 게이트가 닫힌 계획은 이 값을 명시적으로 넘겨 두 값을 갈라 놓는다.
  const observedAssetDepletionCount = overrides.observedAssetDepletionCount ?? merged.assetDepletion;
  return {
    ...merged,
    observedAssetDepletionCount,
    // 개수와 «같은 술어»에서 나와야 하는 값이라, 개수가 0이면 나이도 없다.
    // `??`가 아니라 키 유무로 가른다 — null을 «명시적으로» 넘긴 경우를 기본값으로 덮으면
    // "나이가 없는 상태"를 테스트할 방법이 사라진다.
    observedEarliestDepletionAge: 'observedEarliestDepletionAge' in overrides
      ? (overrides.observedEarliestDepletionAge ?? null)
      : (observedAssetDepletionCount > 0 ? 70 : null),
  };
}

// P1-3. headline은 지배적인 원인 하나만 말한다. 나머지 원인이 어디에도 남지 않으면
// 사용자는 「무엇을 고쳐야 하는가」를 구성으로 볼 수 없다.
describe('실패 원인 분해', () => {
  test('판정에 반영된 원인이 둘 이상이면 원인별 횟수를 함께 낸다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 800, assetDepletion: 300, medianFirstShortfallAge: 62,
      }),
      trials: 1000, params: params(), formatValue,
    });

    expect(result.cause).toBe('spending');
    expect(result.breakdown).toContain('생활비 부족 800회');
    expect(result.breakdown).toContain('자산 고갈 300회');
    // 한 시행이 두 원인에 함께 해당할 수 있다는 사실을 밝히지 않으면 합계(1,100 > 1,000)가
    // 계산 오류로 읽힌다.
    expect(result.breakdown).toContain('합계가 시행 수를 넘을 수 있습니다');
  });

  test('원인이 하나뿐이면 같은 숫자를 두 번 적지 않는다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 1000, medianFirstShortfallAge: 60 }),
      trials: 1000, params: params(), formatValue,
    });

    expect(result.headline).toContain('1,000회');
    expect(result.breakdown).toBeUndefined();
  });

  test('판정에 반영되지 않은 관측 고갈은 원인 분해에 넣지 않는다', () => {
    // 「자산 고갈 방지」를 고르지 않은 계획. 실제 고갈은 400회지만 확률을 깎지 않았으므로
    // 원인 목록에 넣으면 합이 맞지 않는 것처럼 보인다.
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 600, assetDepletion: 0, observedAssetDepletionCount: 400,
        medianFirstShortfallAge: 63,
      }),
      trials: 1000, params: params(), formatValue,
    });

    expect(result.breakdown).toBeUndefined();
  });
});

describe('explainGoalShortfall', () => {
  test('실패 시행이 없고 고갈도 없으면 모두 만족했다고만 말한다', () => {
    const result = explainGoalShortfall({ goalFailure: breakdown(), trials: 1000, params: params(), formatValue });
    expect(result.cause).toBe('none');
    expect(result.headline).toBe('모든 시행에서 목표 조건을 만족했습니다.');
    expect(result.hint).toBeUndefined();
    // 제목이 없으면 화면·PDF 모두 아무것도 그리지 않는다. 할 말이 없는 계획에까지 문장을
    // 새로 찍기 시작하면 소음만 는다.
    expect(result.label).toBeUndefined();
  });

  // PDF에서 이 문장은 「자산이 먼저 바닥난 경우가 N회…」 «바로 아래»에 찍힌다. 목표를 다
  // 지킨 것은 사실이지만 그 사실«만» 적으면 한 쪽이 서로 다른 두 말을 한다.
  //
  // **문장 전문을 고정한다.** cause enum만 검사하면 개수·나이가 틀려도 통과한다 —
  // 고갈을 생활비 미달로 설명하던 버그(78d19dc)가 그렇게 오래 살아남았다.
  test('고른 목표를 다 지켰어도 자산이 실제로 고갈됐으면 두 사실을 함께 적는다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ observedAssetDepletionCount: 420, observedEarliestDepletionAge: 62 }),
      trials: 1000,
      params: params(),
      formatValue,
    });

    expect(result.cause).toBe('none');
    // 실패한 시행이 «한 번도 없으므로» 실패 원인 제목을 붙이면 아래 문장을 정면으로 부정한다.
    expect(result.label).toBe('확률에 반영되지 않은 사실');
    expect(result.headline).toBe(
      '고른 목표는 1,000회 모두 달성했습니다. 다만 420회(가장 이른 62세)에서 자산이 기대수명 전에'
      + ' 바닥났습니다. 「자산 고갈 방지」를 목표로 고르지 않아 이 확률에는 반영되지 않았습니다.'
    );
    // 행동 유도 문장을 붙이지 않는다 — 목표를 추가하면 확률은 오히려 떨어진다.
    expect(result.hint).toBeUndefined();
  });

  test('관측 고갈 나이가 없으면 괄호를 통째로 뺀다', () => {
    // 없는 나이를 지어내지 않는다. 개수와 나이는 같은 술어에서 오므로 실제로는 함께 있거나
    // 함께 없지만, 타입이 그것을 모르는 이상 문장이 「가장 이른 null세」가 되어서는 안 된다.
    const result = explainGoalShortfall({
      goalFailure: breakdown({ observedAssetDepletionCount: 3, observedEarliestDepletionAge: null }),
      trials: 1000,
      params: params(),
      formatValue,
    });

    expect(result.headline).toBe(
      '고른 목표는 1,000회 모두 달성했습니다. 다만 3회에서 자산이 기대수명 전에 바닥났습니다.'
      + ' 「자산 고갈 방지」를 목표로 고르지 않아 이 확률에는 반영되지 않았습니다.'
    );
  });

  test('자산 고갈이 지배적이면 고갈을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 610, assetDepletion: 610, terminalShortfall: 620, medianFirstShortfallAge: 74 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.label).toBe('목표를 달성하지 못한 시행의 원인');
    expect(result.headline).toContain('610회');
  });

  test('생활비 미달이 고갈보다 뚜렷이 많으면 미달을 원인으로 말하고 시작 나이를 밝힌다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 761, assetDepletion: 0, terminalShortfall: 1, medianFirstShortfallAge: 80 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toContain('761회');
    expect(result.headline).toContain('80세부터');
  });

  test('사적연금 인출 상한이 있으면 그 설정을 지목한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 761, assetDepletion: 0, medianFirstShortfallAge: 80 }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.hint).toContain('사적연금');
    expect(result.hint).toContain('31만원');
  });

  test('고갈이 미달의 원인일 때는 인출 설정을 지목하지 않는다', () => {
    // 미달 시행 수가 고갈 시행 수를 넘지 않으면 "자산은 남는데 못 쓴다"가 아니다.
    // 그때 인출 상한을 원인으로 말하면 사실과 다른 조치를 유도한다.
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 300, assetDepletion: 300, medianFirstShortfallAge: 78 }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.hint).toBeUndefined();
  });

  test('인출 상한이 없고 자산 하한선만 있으면 하한선을 지목한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 994, assetDepletion: 0, medianFirstShortfallAge: 70 }),
      trials: 1000,
      params: params({ assetFloor: 3_000_000_000 }),
      formatValue,
    });
    expect(result.hint).toContain('자산 하한선');
    expect(result.hint).toContain('300,000만원');
  });

  test('지목할 설정이 없으면 hint를 만들지 않는다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 500, assetDepletion: 0, medianFirstShortfallAge: 70 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.hint).toBeUndefined();
  });

  // 아래 네 개는 「원인은 관측값으로 가른다」를 고정한다.
  //
  // 실제 리포트에서 화면은 「420회에서 목표 생활비를 채우지 못합니다」, PDF는 「자산이 먼저
  // 바닥난 경우가 420회」라고 같은 시행을 다르게 설명했다. 원인 판정이 목표 게이트가 닫힌
  // assetDepletion(=0)을 「고갈이 없었다」로 읽었기 때문이다. 개수까지 함께 고정한다 —
  // cause만 보면 「1,000회 중 0회에서 자산이 고갈됩니다」 같은 문장이 그대로 통과한다.
  test('자산 고갈 방지를 고르지 않아도 실제로 고갈됐으면 고갈을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      // 게이트가 닫혀 assetDepletion은 0이지만 실제로는 420회 고갈됐다.
      goalFailure: breakdown({
        spendingShortfall: 420, assetDepletion: 0, observedAssetDepletionCount: 420,
        medianFirstShortfallAge: 73,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.headline).toBe('1,000회 중 420회에서 기대수명 전에 자산이 고갈됩니다.');
    // 고갈이 원인이면 인출 설정을 지목하지 않는다 — 있지도 않은 조치를 유도한다.
    expect(result.hint).toBeUndefined();
  });

  test('자산 고갈 방지를 골랐고 실제로 고갈됐으면 같은 문장을 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 420, assetDepletion: 420, observedAssetDepletionCount: 420,
        medianFirstShortfallAge: 73,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.headline).toBe('1,000회 중 420회에서 기대수명 전에 자산이 고갈됩니다.');
    expect(result.hint).toBeUndefined();
  });

  test('생활비 미달이 관측된 고갈보다 많으면 미달을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 700, assetDepletion: 0, observedAssetDepletionCount: 200,
        medianFirstShortfallAge: 78,
      }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toBe('1,000회 중 700회에서 목표 생활비를 채우지 못합니다 (평균적으로 78세부터).');
  });

  test('고갈이 한 번도 없으면 미달을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 500, assetDepletion: 0, observedAssetDepletionCount: 0,
        medianFirstShortfallAge: 70,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toBe('1,000회 중 500회에서 목표 생활비를 채우지 못합니다 (평균적으로 70세부터).');
    // 자산이 남는데도 못 쓰는 시행이니 이때는 설정을 지목한다.
    expect(result.hint).toContain('사적연금');
  });

  test('기말자산 미달이 지배적이면 상속 목표액을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 100, assetDepletion: 50, terminalShortfall: 436, terminalAssetGoal: 3_000_000_000 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('terminal');
    expect(result.headline).toContain('300,000만원');
  });
});
