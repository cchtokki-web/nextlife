import { describe, test, expect, vi } from 'vitest';
import {
  isSuccessfulTrial,
  MonteCarloEngine,
  runMonteCarlo,
} from '@/core/usecases/montecarlo/MonteCarloEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { volatilityForStockReturn, resolveMonteCarloConfig, VOLATILITY_BY_YIELD_PRESET } from '@/core/usecases/montecarlo/volatilityPresets';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { MonteCarloConfig } from '@/core/entities/montecarlo';
import { freezeSpendingPlan, runFrozenPlan } from '@/core/usecases/spending/freezeSpendingPlan';
import { buildReturnShockPath } from '@/core/usecases/montecarlo/returnPath';
import { mulberry32, deriveSeed } from '@/core/usecases/montecarlo/rng';
import { simulationYearCount } from '@/core/usecases/montecarlo/horizon';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { explainGoalShortfall } from '@/core/usecases/dashboard/explainGoalShortfall';

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
        totalReturn: 9, dividendYield: 2, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function config(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return { trials: 200, seed: 2026, annualStdDev: 15, ...overrides };
}

describe('runMonteCarlo - 가정 공시', () => {
  // 결과가 «어떤 세계에서 나왔는지»를 결과 자신이 들고 다녀야 한다. 화면과 PDF가 params를
  // 따로 읽어 판정하면 두 곳이 어긋나고, 워커 경계 너머의 화면은 params를 갖고 있지도 않다.
  //
  // 충격 배율은 더 이상 여기 실리지 않는다. 계좌마다 다르고 포트폴리오 구성에서
  // 유도되므로 스칼라 하나로 말할 수 없다 — 문장은 describeMonteCarloAssumptions가
  // «규칙»으로 적는다.
  test('결과에 경제 시나리오와 리스크 성향을 함께 싣는다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 5 }));

    expect(mc.assumptions).toBeDefined();
    expect(mc.assumptions!.economicScenario).toBeDefined();
    expect(mc.assumptions!.riskProfile).toBeDefined();
  });

  // 전략을 저장한 적 없는 계획은 두 축이 모두 미정이다(DEFAULT_RETIREMENT_STRATEGY).
  test('전략이 없으면 두 축 모두 미정으로 싣는다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 5 }));

    expect(mc.assumptions!.economicScenario).toBe('ai_recommended');
    expect(mc.assumptions!.riskProfile).toBe('ai_recommended');
  });

  test('사용자가 고른 축을 그대로 싣는다', () => {
    const chosen = params({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'high_inflation', riskProfile: 'custom' },
    });
    const mc = runMonteCarlo(chosen, engine, config({ trials: 5 }));

    expect(mc.assumptions!.economicScenario).toBe('high_inflation');
    expect(mc.assumptions!.riskProfile).toBe('custom');
  });
});

describe('runMonteCarlo', () => {
  // **σ=0이면 몬테카를로는 결정론이어야 한다.**
  //
  // 이 테스트가 MC 전체의 회귀 장치다: 확률 계층이 엔진 결과를 어떤 식으로든 왜곡하면
  // 여기서 잡힌다. 분위수도 전부 같은 값이어야 한다(모든 시행이 동일하므로).
  test('변동성이 0이면 모든 시행이 결정론 결과와 정확히 일치한다', () => {
    const deterministic = engine.runSingle(params());
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.endingAssets.p10).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p50).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p90).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.deterministicEndingAssets).toBeCloseTo(deterministic.endingAssets, 6);
  });

  test('같은 시드는 완전히 같은 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config());
    const b = runMonteCarlo(params(), engine, config());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('다른 시드는 다른 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config({ seed: 1 }));
    const b = runMonteCarlo(params(), engine, config({ seed: 2 }));

    expect(a.endingAssets.p50).not.toBe(b.endingAssets.p50);
  });

  test('성공률은 0과 1 사이다', () => {
    const mc = runMonteCarlo(params(), engine, config());

    expect(mc.successRate).toBeGreaterThanOrEqual(0);
    expect(mc.successRate).toBeLessThanOrEqual(1);
  });

  // 예전에는 「모든 해에서 p10 ≤ p50 ≤ p90」으로 연도별 분위수를 지켰다. p50/p90이 사라지면서
  // 그 단언이 성립하지 않게 되어, σ=0에서 하방이 결정론 곡선과 «정확히 일치»함을 대신 고정한다.
  // 근사가 아니라 등식이므로 위 회귀 장치보다 강하다 — 분위수 계산이 한 자리라도 어긋나면 깨진다.
  test('변동성이 0이면 연도별 하방이 결정론 자산 곡선과 일치한다', () => {
    const deterministic = engine.runSingle(params());
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.assetBands.length).toBeGreaterThan(0);
    for (const year of mc.assetBands) {
      const row = deterministic.yearlyResults.find((r) => r.age === year.age);
      expect(row, `${year.age}세 결정론 결과가 없다`).toBeDefined();
      expect(year.p10).toBeCloseTo(row!.totalAssets, 6);
    }
  });

  test('변동성이 커지면 결과 분포가 넓어진다', () => {
    const narrow = runMonteCarlo(params(), engine, config({ annualStdDev: 5 }));
    const wide = runMonteCarlo(params(), engine, config({ annualStdDev: 25 }));

    const spread = (mc: typeof narrow) => mc.endingAssets.p90 - mc.endingAssets.p10;
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });

  // **변동성 손실(volatility drag).**
  //
  // 충격의 기대값이 0이어도 복리로 굴리면 기하평균 < 산술평균이라 중앙값이 결정론보다
  // 낮게 나온다. 이건 버그가 아니라 "연 7%가 30년 내리 유지되는 경우는 거의 없다"는
  // 지적의 정량적 실체다. 숨기지 않고 이 방향을 테스트로 고정한다.
  test('변동성이 있으면 중앙값이 결정론 결과보다 낮다', () => {
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 20, trials: 300 }));

    expect(mc.endingAssets.p50).toBeLessThan(mc.deterministicEndingAssets);
  });

  test('연도별 하방은 시뮬레이션 연수와 같은 길이다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 20 }));

    expect(mc.assetBands).toHaveLength(85 - 55 + 1);
    expect(mc.assetBands[0].age).toBe(55);
    expect(mc.assetBands[mc.assetBands.length - 1].age).toBe(85);
  });

  // 진단 카드의 「N세 예상자산(중앙값)」과 자산 추이 차트의 곡선이 **같은 값**이어야 한다.
  // 기말자산은 마지막 해의 총자산이므로(SimulationEngine의 endingAssets), 같은 시행 집합을
  // 같은 분위수 함수로 자른 두 값은 등식으로 맞는다. 어긋나면 화면 두 곳이 또 다른 숫자를
  // 말하게 되고, 그것이 애초에 이 밴드를 만든 이유다.
  test('마지막 해의 중앙값은 기말자산 중앙값과 정확히 같다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 50 }));

    const last = mc.assetBands[mc.assetBands.length - 1];
    expect(last.age).toBe(85);
    expect(last.p50).toBe(mc.endingAssets.p50);
  });

  test('연도별 밴드의 하방은 중앙값을 넘지 않는다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 50, annualStdDev: 20 }));

    for (const year of mc.assetBands) {
      expect(year.p10, `${year.age}세`).toBeLessThanOrEqual(year.p50);
    }
  });

  test('시행 수와 시드, 변동성을 결과에 남긴다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 37, seed: 99, annualStdDev: 18 }));

    expect(mc.trials).toBe(37);
    expect(mc.seed).toBe(99);
    expect(mc.annualStdDev).toBe(18);
  });

  test('시행이 1회여도 동작한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 1 }));

    expect(mc.trials).toBe(1);
    expect(Number.isFinite(mc.endingAssets.p50)).toBe(true);
  });

  // 성공 기준 나이는 결정론 시뮬레이션이 실제로 돌린 종료 나이와 같아야 한다 —
  // 두 판정이 다른 나이를 보면 몬테카를로의 성공률과 화면의 고갈 문구가 어긋난다.
  test('성공 기준 나이는 결정론 시뮬레이션의 종료 나이(본인 기대수명)와 같다', () => {
    const p = params();

    const mc = runMonteCarlo(p, engine, config({ trials: 10 }));

    const deterministic = engine.runSingle(p);
    const lastSimulatedAge = deterministic.yearlyResults[deterministic.yearlyResults.length - 1].age;
    expect(mc.successAge).toBe(lastSimulatedAge);
    expect(mc.successAge).toBe(p.userProfile.expectancy);
  });

  test('고갈된 시행이 없으면 고갈 통계는 비어 있다', () => {
    // 충격 없이 넉넉한 계획이면 아무도 고갈되지 않는다.
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.depletion.count).toBe(0);
    expect(mc.depletion.earliestAge).toBeNull();
    expect(mc.depletion.medianAge).toBeNull();
  });

  test('고갈된 시행이 있으면 가장 이른 나이를 보고한다', () => {
    // 자산이 거의 없는 계획이면 대부분 고갈된다.
    const poor = params({ assets: [], privatePensions: [], nationalPension: { expectedMonthlyAmount: 0 } });
    const mc = runMonteCarlo(poor, engine, config({ trials: 10 }));

    expect(mc.depletion.count).toBeGreaterThan(0);
    expect(mc.depletion.earliestAge).not.toBeNull();
    expect(mc.successRate).toBeLessThan(1);
  });

  // **max_sustainable은 시행 전에 한 번만 해소한다.**
  //
  // 시행마다 이진탐색을 다시 돌리면 그 시행이 겪을 미래를 미리 알고 생활비를 정하는 셈이라
  // (완벽한 예지력) 성공률이 구조적으로 100%에 붙는다. MC가 묻는 것은 "이 계획이 여러
  // 미래에서 얼마나 견디는가"지 "미래를 알았다면 얼마나 썼을까"가 아니다.
  test('max_sustainable 전략은 시행마다 생활비를 다시 탐색하지 않는다', () => {
    const spy = vi.spyOn(engine, 'runSingle');
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    runMonteCarlo(maxSus, engine, config({ trials: 5 }));

    // 시행마다 30회 이진탐색을 돌면 150회를 훌쩍 넘는다. 한 번만 해소하면
    // (해소 1회 = run() 31회) + 결정론 1회 + 시행 5회 수준에 머문다.
    expect(spy.mock.calls.length).toBeLessThan(60);
    spy.mockRestore();
  });

  test('max_sustainable 전략에서도 성공률이 100%에 고정되지 않는다', () => {
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    const mc = runMonteCarlo(maxSus, engine, config({ annualStdDev: 20, trials: 100 }));

    // 지속가능 최대치로 쓰면서 변동성을 겪으면 상당수 시행이 실패해야 정상이다.
    expect(mc.successRate).toBeLessThan(1);
  });

  test('계획 생활비를 온전히 쓴 시행의 비율을 함께 보고한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 50 }));

    expect(mc.spendingSuccessRate).toBeGreaterThanOrEqual(0);
    expect(mc.spendingSuccessRate).toBeLessThanOrEqual(1);
    // 목표 성공은 「생활비 충족 ∧ 자산 생존 ∧ 기말자산 목표」의 교집합이지만, 생활비 조건이
    // spendingSuccessRate와 «다른 술어»다 —
    //   spendingSuccessRate            : year.unmetSpending > 0        (엔진 원장, 엡실론 없음, 계획 대비)
    //   goalSuccessProbability의 생활비 : goalShortfall ≥ 월 1만원      (재구성, 엡실론 있음, 목표 대비)
    // 두 집합은 포함관계가 아니므로 부등식이 성립하지 않는다. 이 fixture에서는 세 확률이
    // 우연히 모두 0.62로 같아 등식으로 통과할 뿐이다 — fixture가 바뀌면 [AUDIT-003]과 같은
    // 위반이 재현된다. 자산 생존은 같은 술어(isSuccessfulTrial)를 쓰므로 그쪽만 남긴다.
    expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.successRate);
  });

  test('한 번의 부족을 전체 실패로만 접지 않고 평균 목표생활비 충족도를 함께 보고한다', () => {
    const poor = params({
      assets: [],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 1_500_000 },
      userProfile: { currentAge: 59, retirementAge: 60, expectancy: 65, targetMonthlySpending: 2_000_000 },
    });

    const mc = runMonteCarlo(poor, engine, config({ trials: 10, annualStdDev: 0 }));

    expect(mc.spendingSuccessRate).toBe(0);
    expect(mc.averageSpendingFulfillmentRate).toBeGreaterThan(0);
    expect(mc.averageSpendingFulfillmentRate).toBeLessThan(1);
  });

  test('validate는 optimizer용 이름으로 옮기기만 하고 값을 새로 만들지 않는다', () => {
    // **세 확률이 서로 달라야 의미가 있는 테스트다.**
    // 기본 fixture는 successRate = spendingSuccessRate = goalSuccessProbability = 0.62라,
    // 세 필드를 서로 바꿔 연결해도(cross-wiring) 단언이 전부 통과했다. validate()에서 `?? 0`
    // 폴백을 걷어낸 근거가 "이제 순수한 이름 변환"이라는 것이므로, 어느 원본에서 읽는지를
    // 실제로 구분하지 못하면 그 근거를 지키는 장치가 없는 셈이다.
    //
    // assetFloor가 인출을 막아 자산은 100% 보존되지만 생활비는 자주 미달하고(자산 보존 ≠
    // 생활 유지), 그 위의 상속 목표가 다시 걸러진다(목표 성공 ≠ 생활 유지).
    const discriminating = params({
      assetFloor: 200_000_000,
      userProfile: { ...params().userProfile, targetBequest: 700_000_000 },
    });
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(discriminating));
    const cfg = config({ trials: 60 });
    const direct = runMonteCarlo(discriminating, engine, cfg);
    const validated = new MonteCarloEngine(engine).validate(
      input.profile,
      input.goals,
      input.strategy,
      cfg,
    );

    // fixture가 퇴화하면(세 값이 같아지면) 아래 단언들이 무력해지므로 먼저 확인한다.
    expect(new Set([
      direct.successRate,
      direct.spendingSuccessRate,
      direct.goalSuccessProbability,
    ]).size).toBe(3);
    expect(new Set([
      direct.endingAssets.p10,
      direct.endingAssets.p50,
      direct.endingAssets.p90,
    ]).size).toBe(3);

    // 같은 seed·trials이므로 두 실행은 동일해야 한다. 이름만 달라진다.
    expect(validated.spendingSuccessProbability).toBe(direct.spendingSuccessRate);
    expect(validated.averageSpendingFulfillmentRate).toBe(direct.averageSpendingFulfillmentRate);
    expect(validated.assetSurvivalProbability).toBe(direct.successRate);
    expect(validated.goalSuccessProbability).toBe(direct.goalSuccessProbability);
    expect(validated.terminalAssetMedian).toBe(direct.endingAssets.p50);
    expect(validated.terminalAssetP10).toBe(direct.endingAssets.p10);
    expect(validated.terminalAssetP90).toBe(direct.endingAssets.p90);
    expect(validated.shortfallProbability).toBeCloseTo(1 - direct.spendingSuccessRate, 12);
  });

  test('목표 성공확률은 명시된 기말자산 목표까지 같은 시행에서 만족해야 한다', () => {
    const impossibleBequest = params({
      userProfile: {
        ...params().userProfile,
        targetBequest: 10_000_000_000_000,
      },
    });

    const mc = runMonteCarlo(
      impossibleBequest,
      engine,
      config({ annualStdDev: 0, trials: 10 }),
    );

    expect(mc.spendingSuccessRate).toBe(1);
    expect(mc.successRate).toBe(1);
    expect(mc.goalSuccessProbability).toBe(0);
  });

  // **이 테스트가 지표 재정의의 존재 이유다 — 정의 자체를 잠근다.**
  //
  // 옛 정의(fullSpendingRate)는 `succeeded.filter(!hasUnmetSpending)`이었다. 즉 자산이
  // 살아남은 시행 안에서만 결손 없음을 셌고, 그래서 "자산은 바닥났지만 종신연금이 생활비를
  // 끝까지 대는" 경로를 실패로 집계했다. 그 접합(conjunction)에는 의미상 근거가 없다 —
  // 사용자가 묻는 것은 "쓰기로 한 만큼 쓰며 살았는가"이고, 거기에 "그리고 돈이 남았는가"를
  // 덧붙일 이유가 없다.
  //
  // **실측 참고**: 이 엔진에서 두 정의는 대부분의 계획에서 같은 숫자를 낸다. 인출 경로가
  // 매달 `min(잔액, 필요액)`으로 깎기 때문에, 적자 구간에서 자산이 0에 닿는 해는 거의 항상
  // 그 해에 결손도 함께 낸다(300시행 × 자산규모 6종에서 "고갈했으나 결손 없음"이 0건이었다).
  // 갈리는 것은 경계 사례 — 기대수명에 정확히 고갈되는 시행(isSuccessfulTrial은 실패로
  // 보지만 그 해 생활비는 소득이 채운 경우) — 이라 특정 픽스처로 재현하기 어렵다.
  // 그래서 숫자 관계를 단언하는 대신, **집계 모집단이 전체 시행인지**를 직접 검증한다:
  // 같은 시드로 시행을 재현해 결손 없는 시행의 비율을 독립적으로 세고 비교한다.
  test('생활 유지 성공률은 자산 생존 여부와 무관하게 전체 시행에서 센다', () => {
    const cfg = config({ trials: 40, annualStdDev: 20 });
    const target = params();

    const mc = runMonteCarlo(target, engine, cfg);

    // runMonteCarlo와 같은 시드 규칙(deriveSeed(seed, index))으로 같은 시행을 재현한다.
    const planned = freezeSpendingPlan(target, engine);
    const years = simulationYearCount(planned.params);
    let noShortfall = 0;
    let allCoreGoals = 0;
    for (let i = 0; i < cfg.trials; i++) {
      const path = buildReturnShockPath(years, cfg.annualStdDev, mulberry32(deriveSeed(cfg.seed, i)));
      const trial = runFrozenPlan(engine, planned, path);
      // **여기에 depletionAge 조건을 걸지 않는다** — 그것이 이 지표의 정의다.
      if (!trial.yearlyResults.some((y) => y.unmetSpending > 0)) noShortfall++;
      if (
        !trial.yearlyResults.some((y) => y.unmetSpending > 0)
        && isSuccessfulTrial(trial.depletionAge, planned.params.userProfile.expectancy)
      ) allCoreGoals++;
    }

    expect(mc.spendingSuccessRate).toBe(noShortfall / cfg.trials);
    expect(mc.goalSuccessProbability).toBe(allCoreGoals / cfg.trials);
  });

  // 판정 기준이 되는 월 생활비를 함께 실어야 화면이 "계획 생활비 월 223만원 기준"이라고
  // 밝힐 수 있다. 「평생 소비 최적화」에서 이 값은 사용자가 입력한 목표가 아니다.
  test('판정 기준이 된 월 생활비를 함께 보고한다', () => {
    const target = runMonteCarlo(params(), engine, config({ trials: 5 }));
    expect(target.plannedMonthlySpending).toBe(2500000);

    const maxSus = runMonteCarlo(
      params({ spendingStrategy: 'max_sustainable' }), engine, config({ trials: 5 })
    );
    expect(maxSus.plannedMonthlySpending).not.toBe(2500000);
    expect(maxSus.plannedMonthlySpending).toBeGreaterThan(0);
  });
});

describe('MonteCarloEngine strategy validation', () => {
  test('같은 seed로 최종 검증 지표 7개를 재현한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(params());
    const validator = new MonteCarloEngine(engine);
    const cfg = config({ trials: 30, seed: 77 });

    const first = validator.validate(input.profile, input.goals, input.strategy, cfg);
    const second = validator.validate(input.profile, input.goals, input.strategy, cfg);

    expect(second).toEqual(first);
    expect(first).toMatchObject({ trials: 30, seed: 77 });
    expect(first.goalSuccessProbability).toBeGreaterThanOrEqual(0);
    expect(first.spendingSuccessProbability).toBeGreaterThanOrEqual(0);
    expect(first.averageSpendingFulfillmentRate).toBeGreaterThanOrEqual(0);
    expect(first.assetSurvivalProbability).toBeGreaterThanOrEqual(0);
    expect(first.terminalAssetP10).toBeLessThanOrEqual(first.terminalAssetMedian);
    expect(first.terminalAssetMedian).toBeLessThanOrEqual(first.terminalAssetP90);
    expect(first.shortfallProbability).toBeCloseTo(1 - first.spendingSuccessProbability, 12);
  });
});

describe('resolveMonteCarloConfig', () => {
  // **더 이상 yieldPreset 분기가 없다.** 화면은 strategy.riskProfile만 바꾸고
  // params.yieldPreset은 그대로 남기므로, 프리셋을 먼저 읽으면 수익률은 사용자 값인데
  // 변동성만 옛 프리셋에 묶인다. 그래서 yieldPreset이 무엇이든 같은 자산 구성이면
  // 같은(실제 수익률에서 유도한) 값이 나와야 한다.
  test('yieldPreset을 무엇으로 바꿔도 실제 수익률에서 유도한 값은 그대로다', () => {
    const derived = resolveMonteCarloConfig(params({ yieldPreset: 'custom' })).annualStdDev;

    expect(resolveMonteCarloConfig(params({ yieldPreset: 'conservative' })).annualStdDev)
      .toBe(derived);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'aggressive' })).annualStdDev)
      .toBe(derived);
  });

  // **예전 이름은 「프리셋이 없거나 custom이면 base 변동성을 쓴다」였다.** 지금은 그 경우
  // 보유 계좌의 수익률에서 유도한다. 유도 규칙 자체는 volatilityPresets.test.ts가 잠근다.
  //
  // 이 픽스처는 유도가 두 번 고쳐진 자리를 함께 지킨다:
  //   ① 기준이 «총수익률»이다. 예전에는 배당을 뺀 가격상승률만 가중해서, 배당이 큰
  //      포트폴리오가 수익률은 배당까지 챙기면서 위험은 배당 없는 자산 취급을 받았다.
  //   ② «사적연금»도 가중에 들어온다. 예전에는 자산과 ISA만 셌고, 연금이 포트폴리오의
  //      절반이어도 변동성 유도에서 통째로 빠졌다.
  test('프리셋이 없거나 custom이면 자산과 연금을 함께 가중해 유도한다', () => {
    // 주식 2억 @ 9% + 연금 5천만 @ 4% → 가중평균 8%
    const derived = volatilityForStockReturn(8);

    expect(resolveMonteCarloConfig(params()).annualStdDev).toBeCloseTo(derived, 10);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'custom' })).annualStdDev)
      .toBeCloseTo(derived, 10);

    // 연금이 평균을 끌어내린 만큼 주식만 봤을 때(9% = 공격형)보다 낮다.
    expect(derived).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.aggressive);

    // 같은 자리에서 수익률만 낮추면 변동성도 따라 내려간다 — 이것이 유도의 핵심이다.
    const conservativeAssets = params().assets.map((a) => ({ ...a, totalReturn: 5 }));
    expect(resolveMonteCarloConfig(params({ assets: conservativeAssets })).annualStdDev)
      .toBeLessThan(derived);
  });

  test('시드는 고정 상수다', () => {
    // 시각 기반이면 아무것도 바꾸지 않았는데 새로고침마다 성공률이 흔들린다.
    expect(resolveMonteCarloConfig(params()).seed).toBe(resolveMonteCarloConfig(params()).seed);
  });

  test('보수적일수록 변동성이 낮다', () => {
    expect(VOLATILITY_BY_YIELD_PRESET.conservative).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.base);
    expect(VOLATILITY_BY_YIELD_PRESET.base).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });
});

describe('goalFailure — 목표 달성 확률을 떨어뜨린 원인', () => {
  test('원인별 시행 수를 goalSuccessProbability와 같은 판정으로 집계한다', () => {
    const config: MonteCarloConfig = { trials: 60, seed: 7, annualStdDev: 18 };
    const result = runMonteCarlo(params(), engine, config);

    // 세 조건을 모두 통과한 시행 수 = goalSuccessProbability * trials.
    // 어느 원인에도 걸리지 않은 시행이 그보다 적으면 집계가 판정과 갈라진 것이다.
    const succeeded = Math.round(result.goalSuccessProbability * config.trials);
    const { spendingShortfall, assetDepletion, terminalShortfall } = result.goalFailure;
    for (const count of [spendingShortfall, assetDepletion, terminalShortfall]) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(config.trials);
      expect(count).toBeLessThanOrEqual(config.trials - succeeded);
    }
    // 실패한 시행은 반드시 어떤 원인에든 잡혀야 한다.
    if (succeeded < config.trials) {
      expect(Math.max(spendingShortfall, assetDepletion, terminalShortfall)).toBeGreaterThan(0);
    }
  });

  test('사적연금 인출 상한이 걸린 계획은 자산이 남는데도 생활비 미달로 실패한다', () => {
    // 자산 대부분이 사적연금에 있고 월 인출 상한이 낮으면, 일반계좌를 다 쓴 뒤로는 목표
    // 생활비를 채울 방법이 없다. 그런데 연금 잔액은 그대로 남으므로 고갈로는 잡히지 않는다.
    // 이 조합이 "기말자산은 큰데 목표 달성 확률만 바닥"의 원인이다.
    const capped = runMonteCarlo(params({
      privatePensions: [
        { id: 'p1', type: 'irp', balance: 1_500_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
      ],
      withdrawalPlan: { privatePensionMonthlyTarget: 300_000 },
    }), engine, { trials: 30, seed: 7, annualStdDev: 12 });

    expect(capped.goalFailure.spendingShortfall).toBeGreaterThan(capped.goalFailure.assetDepletion);
    expect(capped.goalFailure.medianFirstShortfallAge).not.toBeNull();
  });

  test('생활비 미달 시행이 없으면 medianFirstShortfallAge는 null이다', () => {
    // 목표 생활비가 국민연금만으로도 덮이는 계획.
    const easy = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 500_000 },
    }), engine, { trials: 20, seed: 7, annualStdDev: 5 });

    expect(easy.goalFailure.spendingShortfall).toBe(0);
    expect(easy.goalFailure.medianFirstShortfallAge).toBeNull();
  });
});

describe('goalSuccessProbability — 선택한 목표가 판정 조건을 정한다', () => {
  const config: MonteCarloConfig = { trials: 40, seed: 7, annualStdDev: 15 };
  // 이 fixture가 절대 도달할 수 없는 기말자산 목표액.
  const unreachableBequest = 100_000_000_000_000;

  test('레거시 시나리오(목표 없음)는 목표 도입 이전과 같은 조건을 쓴다', () => {
    const legacy = runMonteCarlo(
      params({ userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000, targetBequest: unreachableBequest } }),
      engine, config,
    );

    expect(legacy.goalConditions.basis).toBe('legacy_plan');
    expect(legacy.goalConditions.terminalAssetGoal).toBe(unreachableBequest);
    expect(legacy.goalSuccessProbability).toBe(0);
  });

  test('상속을 고르지 않았으면 남아 있는 상속 목표액이 확률을 깎지 않는다', () => {
    // 구 UI에서 넣어 둔 금액이 목표 화면을 거친 뒤에도 조건으로 살아 있으면, 사용자는
    // 화면 어디에도 보이지 않는 값 때문에 0%를 받는다.
    const withGoals = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000, targetBequest: unreachableBequest },
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(withGoals.goalConditions.basis).toBe('selected_goals');
    expect(withGoals.goalConditions.terminalAssetGoal).toBe(0);
    expect(withGoals.goalFailure.terminalShortfall).toBe(0);
    expect(withGoals.goalSuccessProbability).toBeGreaterThan(0);
  });

  test('고르지 않은 조건은 실패 사유로도 세지 않는다', () => {
    // 생활비만 골랐으면 고갈은 이 확률이 묻는 것이 아니다. 판정하지 않은 조건을 사유로만
    // 보고하면 확률과 화면이 어긋난다.
    const spendingOnly = runMonteCarlo(params({
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(spendingOnly.goalConditions.requireAssetSurvival).toBe(false);
    expect(spendingOnly.goalFailure.assetDepletion).toBe(0);
    // 원본 지표는 그대로 남는다 — 조건에서 빠졌다고 자산 보존 성공률까지 지우지 않는다.
    expect(spendingOnly.successRate).toBeLessThanOrEqual(1);
  });

  // 판정에서 빠진 조건이라도 **관측은 지워지지 않는다.** 예전에는 게이트가 닫히면 고갈
  // 시행 수가 0으로만 남아, 원인 진단이 420회 고갈을 「목표 생활비 미달」로 설명하고
  // 있지도 않은 인출 설정 문제를 지목했다(explainGoalShortfall).
  test('자산 고갈 방지를 고르지 않아도 실제 고갈 시행 수는 관측값으로 남는다', () => {
    const depleting = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 8_000_000 },
      privatePensions: [],
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, { trials: 20, seed: 7, annualStdDev: 15 });

    expect(depleting.goalConditions.requireAssetSurvival).toBe(false);
    // 목표 판정값은 게이트가 닫혀 있으므로 0 그대로다.
    expect(depleting.goalFailure.assetDepletion).toBe(0);
    // 관측값은 실제 개수다.
    expect(depleting.goalFailure.observedAssetDepletionCount).toBeGreaterThan(0);
    // 술어가 다르므로 등식은 아니다(depletion.count는 successAge를 묻지 않는다). 관측값은
    // 언제나 그 부분집합이어야 한다.
    expect(depleting.goalFailure.observedAssetDepletionCount)
      .toBeLessThanOrEqual(depleting.depletion.count);
    // 확률은 이 필드와 무관하다 — 이번 변경은 보고 값만 더한 것이다.
    expect(depleting.successRate).toBe(1 - depleting.goalFailure.observedAssetDepletionCount / 20);
  });

  // 「판정 카운트가 전부 0인데 자산은 고갈됐다」는 모순처럼 보이지만 실제로 도달한다.
  // depletionAge는 «중간에» 0을 찍은 나이이고 endingAssets는 «마지막» 잔액이다. 연금이
  // 후반 생활비를 덮으면 잔액이 다시 쌓여, 고갈과 「생활비 미달 없음」·「기말자산 통과」가
  // 동시에 성립한다(MonteCarloResult.spendingSuccessRate 주석의 79세 경로).
  //
  // 이 상태를 만들어 두는 이유: explainGoalShortfall이 이 조합에 붙이는 문장이
  // 손으로 만든 breakdown에서만 성립하는 가짜 상태가 아님을 고정하기 위해서다.
  test('연금이 후반 생활비를 덮으면 고갈이 있어도 판정 카운트가 전부 0이 된다', () => {
    // 65세 은퇴, 국민연금이 70대 생활비를 «거의» 덮는다(부족분이 판정 엡실론 미만).
    // 60대 적자로 자산이 73세에 마르고, 80세에 생활비 곡선이 내려가면서 잉여가 다시 쌓인다.
    const pensionCarried = params({
      userProfile: { currentAge: 65, retirementAge: 65, expectancy: 90, targetMonthlySpending: 2_500_000 },
      assets: [
        { id: 'a1', type: 'etf', ticker: 'X', name: '예금', quantity: 1, averagePrice: 22_000_000,
          totalReturn: 0, dividendYield: 0, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' },
      ],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 2_275_000 },
      inflationRate: 0,
      spendingCurve: resolveSpendingCurve('front_loaded'),
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    });
    // 변동성 0. 이 조합은 «생활비 부족분이 엡실론 미만»이라는 좁은 조건 위에 서 있어서,
    // 충격을 주면 시행마다 다른 이야기가 되어 고정할 것이 없어진다.
    const mc = runMonteCarlo(pensionCarried, engine, { trials: 20, seed: 2026, annualStdDev: 0 });

    expect(mc.goalFailure.spendingShortfall).toBe(0);
    expect(mc.goalFailure.assetDepletion).toBe(0);
    expect(mc.goalFailure.terminalShortfall).toBe(0);
    expect(mc.goalSuccessProbability).toBe(1);
    // 그런데 자산은 실제로 바닥났고, 기말에는 다시 쌓여 있다.
    expect(mc.goalFailure.observedAssetDepletionCount).toBe(20);
    expect(mc.goalFailure.observedEarliestDepletionAge).toBe(73);
    expect(mc.endingAssets.p50).toBeGreaterThan(0);

    // 화면·PDF가 이 상태에 붙이는 문장(문구 자체는 explainGoalShortfall 테스트가 고정한다).
    const explanation = explainGoalShortfall({
      goalFailure: mc.goalFailure,
      trials: mc.trials,
      params: pensionCarried,
      formatValue: (v) => `${Math.round(v / 10_000).toLocaleString()}만원`,
    });
    expect(explanation.headline).toContain('20회(가장 이른 73세)');
    expect(explanation.headline).not.toBe('모든 시행에서 목표 조건을 만족했습니다.');
  });

  // 개수와 나이가 «같은 술어»에서 나와야 한다. depletion.earliestAge는 successAge를 묻지
  // 않는 다른 술어라, 한 문장 안에서 개수는 이쪽 나이는 저쪽에서 가져오면 경계가 갈라지는
  // 날 조용히 어긋난다(GoalFailureBreakdown 주석).
  test('관측 고갈이 없으면 관측 고갈 나이도 없다', () => {
    const safe = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 500_000 },
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, { trials: 20, seed: 7, annualStdDev: 5 });

    expect(safe.goalFailure.observedAssetDepletionCount).toBe(0);
    expect(safe.goalFailure.observedEarliestDepletionAge).toBeNull();
  });

  test('자산 고갈 방지를 고른 계획에서는 관측값과 판정값이 같다', () => {
    const guarded = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 8_000_000 },
      privatePensions: [],
      retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
    }), engine, { trials: 20, seed: 7, annualStdDev: 15 });

    expect(guarded.goalConditions.requireAssetSurvival).toBe(true);
    expect(guarded.goalFailure.observedAssetDepletionCount).toBeGreaterThan(0);
    expect(guarded.goalFailure.assetDepletion).toBe(guarded.goalFailure.observedAssetDepletionCount);
  });

  test('판정할 수 없는 목표만 골라도 100%가 되지 않는다', () => {
    const qualitativeOnly = runMonteCarlo(params({
      retirementGoals: [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(qualitativeOnly.goalConditions.basis).toBe('plan_defaults');
    expect(qualitativeOnly.goalConditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION']);
    expect(qualitativeOnly.goalConditions.requireSpendingTarget).toBe(true);
    expect(qualitativeOnly.goalConditions.requireAssetSurvival).toBe(true);
  });

  // 「자산 성장」은 판정 가능한 «유형»이지만 목표액을 묻는 UI가 없어(goalCatalog에 target이
  // 없다) 단독으로 고르면 세 조건이 모두 빈다. 유형만 보는 가드는 그것을 'selected_goals'로
  // 통과시켰고, 그래서 은퇴 직후 자산이 바닥나는 계획도 **언제나 100%**를 받았다.
  //
  // **이 테스트가 고정하는 것은 확률 그 자체다.** basis만 검사하면 조건은 켜졌는데 확률이
  // 100% 그대로인 상태를 놓친다.
  test('자산 성장만 고른 계획도 100%가 되지 않는다', () => {
    const doomed = params({
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 4_000_000 },
      assets: [
        { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 100, averagePrice: 1_000_000,
          totalReturn: 4, dividendYield: 0, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' },
      ],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 500_000 },
      retirementGoals: [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }],
    });
    const mc = runMonteCarlo(doomed, engine, { trials: 100, seed: 2026, annualStdDev: 15 });

    // 전 시행이 실제로 고갈되는 계획이다 — 100%가 나올 여지가 없다.
    expect(mc.goalFailure.observedAssetDepletionCount).toBe(100);
    expect(mc.goalConditions.basis).toBe('plan_defaults');
    expect(mc.goalSuccessProbability).toBeLessThan(1);
  });

  // 목표를 고르지 않은 계획은 이 변경과 무관하다(legacy_plan). 목표 화면을 거친 적 없는
  // 시나리오까지 건드리면 저장된 모든 계획의 확률이 움직인다.
  test('목표 키가 없는 계획은 예전 조건 그대로다', () => {
    const legacy = runMonteCarlo(params(), engine, config);

    expect(legacy.goalConditions.basis).toBe('legacy_plan');
    expect(legacy.goalConditions.requireSpendingTarget).toBe(true);
    expect(legacy.goalConditions.requireAssetSurvival).toBe(true);
  });

  test('상속을 고르면 그 목표액이 다시 조건이 된다', () => {
    const withInheritance = runMonteCarlo(params({
      retirementGoals: [{
        type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: unreachableBequest, targetValueSource: 'user',
      }],
    }), engine, config);

    expect(withInheritance.goalConditions.terminalAssetGoal).toBe(unreachableBequest);
    expect(withInheritance.goalSuccessProbability).toBe(0);
  });
});
