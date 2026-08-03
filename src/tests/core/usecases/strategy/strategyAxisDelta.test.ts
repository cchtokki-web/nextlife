import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { RetirementStrategy, SimulationParams, SimulationResult } from '@/core/entities/types';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

// **전략 축이 실제로 결과를 바꾸는가.**
//
// 이 파일이 "죽은 옵션 살리기" 작업의 정의(definition of done)다.
//
// ## 왜 이 테스트가 없으면 안 되는가
//
// compileStrategy 테스트 5개 파일은 전부 **컴파일 산출물**(파라미터 객체)만 검증한다.
// 그 파라미터로 엔진을 돌려 자산 곡선이 실제로 달라지는지는 아무도 확인하지 않는다.
// 그래서 어떤 축이 조용히 no-op이 되어도 테스트는 전부 초록이다. 실제로 그런 축이
// 여럿 있었다(docs/superpowers/specs/2026-08-02-option-efficacy-baseline.md).
//
// ## 단언은 반드시 현금흐름에 건다
//
// utility.score에만 걸면 지금도 통과해버린다 — 죽은 축들의 증상이 정확히 "점수만 다르고
// 자산 곡선은 같다"이기 때문이다. depletionAge / endingAssets / 연도별 totalAssets
// 시계열을 봐야 검증력이 생긴다. **이 한 줄이 Track B 전체의 방어선이다.**

// useStrategyPipeline과 동일한 배선. 화면이 실제로 쓰는 경로를 그대로 재현해야
// "화면에서 옵션을 바꿨을 때"를 검증하는 것이 된다.
//
// (B1에서 runStrategyPipeline을 코어 순수 함수로 뽑으면 이 헬퍼는 그것을 호출하게 된다.)
function runWithStrategy(params: SimulationParams, strategy: RetirementStrategy): SimulationResult {
  const engine = new SimulationEngine();
  const compiled = compileStrategy({ ...params, strategy });

  let recommendation;
  try {
    recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
  } catch {
    recommendation = undefined;
  }

  const effective = applyAiSentinels(compiled, recommendation).compiled;
  return engine.run(effective.params, effective.utilityConfig);
}

// 현금흐름 지문. 연도별 총자산까지 포함해 "곡선이 같은가"를 정확히 판정한다.
function cashflowFingerprint(result: SimulationResult): string {
  return [
    result.depletionAge ?? 'none',
    Math.round(result.endingAssets),
    ...result.yearlyResults.map((y) => Math.round(y.totalAssets)),
  ].join('|');
}

function distinctCashflows(
  params: SimulationParams,
  axis: keyof RetirementStrategy,
  values: readonly unknown[]
): number {
  const fingerprints = new Set(
    values.map((value) =>
      cashflowFingerprint(
        runWithStrategy(params, { ...DEFAULT_RETIREMENT_STRATEGY, [axis]: value } as RetirementStrategy)
      )
    )
  );
  return fingerprints.size;
}

describe('전략 축이 현금흐름을 바꾼다', () => {
  // 각 축이 만들어야 할 "서로 다른 곡선"의 최소 개수.
  //
  // 선택지 수와 같을 필요는 없다 — 일부 값이 같은 계획으로 수렴하는 것은 정상이다
  // (예: 리스크 성향의 'custom'과 'ai_recommended'는 둘 다 "수익률을 덮어쓰지 않는다").
  // 다만 **하나뿐이면 그 축은 죽어 있다.**
  const AXIS_EXPECTATIONS = [
    {
      axis: 'objective' as const,
      values: ['lifetime_spending', 'tax_minimization', 'wealth_maximization', 'bequest_maximization', 'ai_recommended'],
      // 목표가 다르면 탐색의 argmax가 달라져 인출 계획이 달라져야 한다.
      minDistinct: 3,
    },
    {
      axis: 'spendingChoice' as const,
      values: ['target', 'dividend_only', 'max_sustainable'],
      minDistinct: 3,
    },
    {
      axis: 'bequestStrategy' as const,
      values: ['spend_all', 'leave_some', 'maximize', 'target_amount'],
      // "모두 사용"과 "최대 상속"이 같은 금액을 남기면 안 된다.
      minDistinct: 3,
    },
    {
      axis: 'nationalPensionStrategy' as const,
      values: ['early', 'normal', 'defer_1y', 'defer_2y', 'defer_max'],
      minDistinct: 5,
    },
    {
      axis: 'privatePensionStrategy' as const,
      values: ['tax_first', 'spending_first', 'growth_first', 'minimum'],
      // 인출 비율 100%/50%/25%가 서로 다른 결과를 내야 한다.
      minDistinct: 4,
    },
    {
      axis: 'riskProfile' as const,
      values: ['conservative', 'neutral', 'aggressive'],
      minDistinct: 3,
    },
    {
      axis: 'economicScenario' as const,
      values: ['long_term_average', 'recession', 'high_inflation', 'low_growth'],
      minDistinct: 4,
    },
  ];

  test.each(AXIS_EXPECTATIONS)(
    '$axis: 선택지 $values.length개가 서로 다른 자산 곡선 $minDistinct종 이상을 만든다',
    ({ axis, values, minDistinct }) => {
      const distinct = distinctCashflows(allAxesLiveParams, axis, values);

      expect(
        distinct,
        `${axis} 축의 선택지 ${values.length}개가 자산 곡선 ${distinct}종만 만든다`
        + ` (기대: ${minDistinct}종 이상). 이 축은 현금흐름에 반영되지 않고 있다.`
      ).toBeGreaterThanOrEqual(minDistinct);
    }
  );

  test('ISA 우선 선택이 현금흐름을 바꾼다', () => {
    // preferIsaFirst는 boolean이라 위 표와 형태가 달라 따로 둔다.
    const off = runWithStrategy(allAxesLiveParams, { ...DEFAULT_RETIREMENT_STRATEGY, preferIsaFirst: false });
    const on = runWithStrategy(allAxesLiveParams, { ...DEFAULT_RETIREMENT_STRATEGY, preferIsaFirst: true });

    expect(cashflowFingerprint(on)).not.toBe(cashflowFingerprint(off));
  });
});

describe('전략 축의 방향성', () => {
  // 절대값이 아니라 부등식으로 고정한다. 세율이나 가중치가 조정돼도 "많이 남기려는 계획이
  // 더 많이 남긴다"는 성질은 유지되어야 한다.
  const run = (overrides: Partial<RetirementStrategy>, params: SimulationParams = allAxesLiveParams) =>
    runWithStrategy(params, { ...DEFAULT_RETIREMENT_STRATEGY, ...overrides } as RetirementStrategy);

  test('상속 목표 금액을 세우면 다 쓰고 가는 계획보다 많이 남긴다', () => {
    const target = 500_000_000;
    const withTarget = runWithStrategy(
      { ...allAxesLiveParams, userProfile: { ...allAxesLiveParams.userProfile, targetBequest: target } },
      { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' }
    );
    const spendAll = run({ bequestStrategy: 'spend_all' });

    expect(withTarget.endingAssets).toBeGreaterThan(spendAll.endingAssets);
  });

  test('상속 최대화가 평생 생활비 최대화보다 많이 남긴다', () => {
    const bequest = run({ objective: 'bequest_maximization' });
    const spending = run({ objective: 'lifetime_spending' });

    expect(bequest.endingAssets).toBeGreaterThan(spending.endingAssets);
  });

  test('국민연금을 늦게 받을수록 기말자산이 많다', () => {
    const early = run({ nationalPensionStrategy: 'early' });
    const normal = run({ nationalPensionStrategy: 'normal' });
    const deferMax = run({ nationalPensionStrategy: 'defer_max' });

    expect(normal.endingAssets).toBeGreaterThan(early.endingAssets);
    expect(deferMax.endingAssets).toBeGreaterThan(normal.endingAssets);
  });

  test('공격적 수익률 가정이 보수적 가정보다 기말자산이 많다', () => {
    const conservative = run({ riskProfile: 'conservative' });
    const aggressive = run({ riskProfile: 'aggressive' });

    expect(aggressive.endingAssets).toBeGreaterThan(conservative.endingAssets);
  });
});

describe('기본 전략은 결과를 바꾸지 않는다 (baseline 보존)', () => {
  // compileStrategy의 핵심 불변식. 전략을 한 번도 저장한 적 없는 시나리오와
  // 기본 전략으로 컴파일한 시나리오가 같은 결과를 내야 한다 — 그래야 패널에서 아무 필드나
  // 건드려 전략이 실체화되는 순간 계획이 조용히 뒤집히지 않는다.
  test('DEFAULT_RETIREMENT_STRATEGY로 컴파일한 결과가 strategy 없는 원본과 같다', () => {
    const engine = new SimulationEngine();

    const withoutStrategy = engine.run(allAxesLiveParams);
    const withDefault = engine.run(
      compileStrategy({ ...allAxesLiveParams, strategy: DEFAULT_RETIREMENT_STRATEGY }).params
    );

    expect(cashflowFingerprint(withDefault)).toBe(cashflowFingerprint(withoutStrategy));
  });
});
